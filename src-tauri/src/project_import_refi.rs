//! REFI-QDA conversion works on extracted files and writes records directly to staging.
use super::*;
use project_import_stream::{Progress, StagedProject};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use std::io::{BufRead, BufReader};

type Result<T> = std::result::Result<T, String>;
#[derive(Default)]
struct Node {
    tag: String,
    attrs: HashMap<String, String>,
    text: String,
    children: Vec<Node>,
}
impl Node {
    fn attr(&self, name: &str) -> &str {
        self.attrs.get(name).map(String::as_str).unwrap_or_default()
    }
    fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|n| n.tag == name)
    }
    fn text(&self, name: &str) -> &str {
        self.child(name)
            .map(|n| n.text.as_str())
            .unwrap_or_default()
    }
    fn id(&self) -> String {
        if self.attr("guid").is_empty() {
            generate_identifier()
        } else {
            self.attr("guid").into()
        }
    }
    fn refs(&self, tag: &str, values: &mut HashSet<String>) {
        if self.tag == tag {
            values.insert(self.attr("targetGUID").into());
        }
        for child in &self.children {
            child.refs(tag, values);
        }
    }
}
fn start_node(start: &BytesStart, reader: &Reader<impl BufRead>) -> Result<Node> {
    let mut node = Node {
        tag: String::from_utf8_lossy(start.local_name().as_ref()).into_owned(),
        ..Default::default()
    };
    for attr in start.attributes() {
        let attr = attr.map_err(|e| e.to_string())?;
        node.attrs.insert(
            String::from_utf8_lossy(attr.key.as_ref()).into_owned(),
            attr.decode_and_unescape_value(reader.decoder())
                .map_err(|e| e.to_string())?
                .into_owned(),
        );
    }
    Ok(node)
}
fn read_node(
    reader: &mut Reader<impl BufRead>,
    mut node: Node,
    depth: usize,
    progress: &Progress,
) -> Result<Node> {
    if depth > 128 {
        return Err("REFI-QDA XML is nested too deeply.".into());
    }
    let mut buffer = Vec::new();
    loop {
        progress.check()?;
        match reader
            .read_event_into(&mut buffer)
            .map_err(|e| e.to_string())?
        {
            Event::Start(start) => {
                let child = start_node(&start, reader)?;
                node.children
                    .push(read_node(reader, child, depth + 1, progress)?);
            }
            Event::Empty(start) => node.children.push(start_node(&start, reader)?),
            Event::Text(text) => node.text.push_str(
                &quick_xml::escape::unescape(&text.xml_content().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
            ),
            Event::CData(text) => node
                .text
                .push_str(&text.xml_content().map_err(|e| e.to_string())?),
            Event::GeneralRef(reference) => {
                let value = reference.decode().map_err(|e| e.to_string())?;
                node.text.push_str(
                    &quick_xml::escape::unescape(&format!("&{value};"))
                        .map_err(|e| e.to_string())?,
                );
            }
            Event::DocType(_) => {
                return Err("Project XML must not contain document type declarations.".into())
            }
            Event::End(_) => return Ok(node),
            Event::Eof => return Err("Truncated project XML.".into()),
            _ => {}
        }
        buffer.clear();
    }
}

fn scan(
    path: &Path,
    tags: &[&str],
    progress: &Progress,
    mut consume: impl FnMut(Node, usize) -> Result<()>,
) -> Result<Node> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let total = file.metadata().map_err(|e| e.to_string())?.len();
    let mut reader = Reader::from_reader(BufReader::new(file));
    let mut buffer = Vec::new();
    let mut root = None;
    let mut depth = 0usize;
    let mut closed = false;
    loop {
        progress.report("reading", reader.buffer_position(), total)?;
        match reader
            .read_event_into(&mut buffer)
            .map_err(|e| e.to_string())?
        {
            Event::Start(start) if root.is_none() => {
                let node = start_node(&start, &reader)?;
                if node.tag != "Project" {
                    return Err("Invalid REFI-QDA project XML.".into());
                }
                root = Some(node);
                depth = 1;
            }
            Event::Empty(start) if root.is_none() => {
                let node = start_node(&start, &reader)?;
                if node.tag != "Project" {
                    return Err("Invalid REFI-QDA project XML.".into());
                }
                root = Some(node);
                closed = true;
            }
            Event::Start(start) => {
                if closed {
                    return Err("Multiple XML roots.".into());
                }
                let node = start_node(&start, &reader)?;
                if tags.contains(&node.tag.as_str())
                    || (tags.contains(&"TextSource") && node.tag.ends_with("Source"))
                {
                    let node = read_node(&mut reader, node, 0, progress)?;
                    consume(node, depth)?;
                } else {
                    depth += 1;
                }
            }
            Event::Empty(start) => {
                if closed {
                    return Err("Multiple XML roots.".into());
                }
                let node = start_node(&start, &reader)?;
                if tags.contains(&node.tag.as_str())
                    || (tags.contains(&"TextSource") && node.tag.ends_with("Source"))
                {
                    consume(node, depth)?;
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or("Invalid project XML nesting.")?;
                if depth == 0 {
                    closed = true;
                }
            }
            Event::DocType(_) => {
                return Err("Project XML must not contain document type declarations.".into())
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    if depth != 0 {
        return Err("Truncated project XML.".into());
    }
    root.ok_or("Missing REFI-QDA project.".into())
}

struct Converter<'a> {
    files: &'a HashMap<String, PathBuf>,
    folder: String,
    stage: &'a mut StagedProject,
    variables: HashMap<String, Node>,
    added_variables: HashSet<String>,
    users: HashSet<String>,
    ids: HashSet<String>,
    kanqual: bool,
}
impl Converter<'_> {
    fn warning(&mut self, text: &str) {
        if !self.stage.warnings.iter().any(|w| w == text) {
            self.stage.warnings.push(text.into());
        }
    }
    fn identify(&mut self, node: &Node) -> Result<String> {
        let id = node.id();
        if !self.ids.insert(id.clone()) {
            return Err(format!("Duplicate REFI-QDA identifier: {id}"));
        }
        Ok(id)
    }
    fn author(&mut self, node: &Node) -> Result<Value> {
        let id = node.attr("creatingUser");
        if id.is_empty() {
            return Ok(Value::Null);
        }
        if self.users.insert(id.into()) {
            self.stage.append(
                "project_users",
                &serde_json::json!({"id":id,"name":"Imported user"}),
            )?;
        }
        Ok(Value::String(id.into()))
    }
    fn path(&mut self, path: &str) -> Result<Option<(String, PathBuf)>> {
        if path.is_empty() {
            return Ok(None);
        }
        let Some(name) = path.strip_prefix("internal://") else {
            self.warning(
                "External source files are not included in the package and were not imported.",
            );
            return Ok(None);
        };
        // URI percent-decoding without treating '+' as a space.
        let mut decoded = Vec::new();
        let mut i = 0;
        while i < name.len() {
            if name.as_bytes()[i] == b'%' {
                let hex = name.get(i + 1..i + 3).ok_or("Invalid package URI.")?;
                decoded.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
                i += 3;
            } else {
                decoded.push(name.as_bytes()[i]);
                i += 1;
            }
        }
        let name = String::from_utf8(decoded).map_err(|e| e.to_string())?;
        project_import::portable_path(&name)?;
        for candidate in [
            format!("{}Sources/{name}", self.folder),
            format!("{}{name}", self.folder),
            format!("Sources/{name}"),
            name.clone(),
        ] {
            if let Some(path) = self.files.get(&candidate) {
                return Ok(Some((candidate, path.clone())));
            }
        }
        Err(format!("The package is missing a referenced file: {name}"))
    }
    fn attach(&mut self, file: &Option<(String, PathBuf)>) -> String {
        if let Some((name, path)) = file {
            self.stage
                .assets
                .entry(name.clone())
                .or_insert(path.clone());
            name.clone()
        } else {
            String::new()
        }
    }
    fn code(&mut self, node: &Node, parent: Option<&str>) -> Result<()> {
        let id = self.identify(node)?;
        let author = self.author(node)?;
        let mut row = serde_json::json!({"id":id,"label":node.attr("name"),"description":node.text("Description"),"color":if node.attr("color").is_empty(){"#355070"}else{node.attr("color")},"parent_code_id":parent,"created_by_project_user_id":author});
        add_dates(node, &mut row);
        self.stage.append("codes", &row)?;
        for child in node.children.iter().filter(|n| n.tag == "Code") {
            self.code(child, Some(&id))?;
        }
        Ok(())
    }
    fn variables(&mut self, node: &Node, id: &str, scope: &str) -> Result<()> {
        for value in node.children.iter().filter(|n| n.tag == "VariableValue") {
            let reference = value
                .child("VariableRef")
                .ok_or("Variable reference missing.")?
                .attr("targetGUID");
            let def = self
                .variables
                .get(reference)
                .ok_or("A variable value refers to a missing variable.")?;
            let variable_id = format!("{scope}:{reference}");
            if self.added_variables.insert(variable_id.clone()) {
                let kind = def.attr("typeOfVariable").to_lowercase();
                let mut row = serde_json::json!({"id":variable_id,"name":def.attr("name"),"data_type":match kind.as_str(){"integer"|"float"=>"number","datetime"=>"datetime",_=>"text"}});
                if scope == "object" {
                    row["object_type_id"] = "refi-case".into();
                    row["object_type"] = "Case".into();
                }
                self.stage
                    .append(&format!("{scope}_attribute_definitions"), &row)?;
            }
            let content = value
                .children
                .iter()
                .find(|n| n.tag != "VariableRef")
                .map(|n| n.text.as_str())
                .unwrap_or_default();
            self.stage.append(&format!("{scope}_attribute_values"),&serde_json::json!({"id":generate_identifier(),format!("{scope}_id"):id,"attribute_definition_id":variable_id,"value":content}))?;
        }
        Ok(())
    }
    fn source(&mut self, node: &Node) -> Result<()> {
        let kind = match node.tag.as_str() {
            "TextSource" => "text",
            "PDFSource" => "pdf",
            "PictureSource" => "image",
            "AudioSource" => "audio",
            "VideoSource" => "video",
            _ => return Err(format!("Unsupported REFI-QDA source: {}", node.tag)),
        };
        let id = self.identify(node)?;
        let plain = self.path(node.attr("plainTextPath"))?;
        // Text is one database record. Media bytes remain exclusively on disk.
        let content = match &plain {
            Some((_, path)) => fs::read_to_string(path).map_err(|e| e.to_string())?,
            None => node.text("PlainTextContent").to_string(),
        };
        let file = if kind == "text" {
            if plain.is_some() {
                plain.clone()
            } else {
                self.path(node.attr("richTextPath"))?
            }
        } else {
            self.path(node.attr("path"))?
        };
        let storage = self.attach(&file);
        let mut row = serde_json::json!({"id":id,"title":node.attr("name"),"source_kind":kind,"text_content":content,"storage_path":storage,"original_file_name":storage.rsplit('/').next().unwrap_or_default(),"notes":node.text("Description")});
        add_dates(node, &mut row);
        self.stage.append("sources", &row)?;
        self.variables(node, &id, "source")?;
        for selection in node
            .children
            .iter()
            .filter(|n| n.tag.ends_with("Selection"))
        {
            let annotation = self.identify(selection)?;
            let author = self.author(selection)?;
            let mut row = serde_json::json!({"id":annotation,"source_id":id,"source_kind":kind,"note":selection.text("Description"),"created_by_project_user_id":author});
            match selection.tag.as_str() {
                "PlainTextSelection" => {
                    if self.kanqual
                        && (selection.attr("startPosition").is_empty()
                            || selection.attr("endPosition").is_empty())
                    {
                        self.warning("This older KanQual export omits some media coding positions. Those selections cannot be restored from this file.");
                        continue;
                    }
                    if plain.is_none()
                        && content.is_empty()
                        && !node.attr("plainTextPath").is_empty()
                    {
                        self.warning(
                            "Text selections requiring external source files were not imported.",
                        );
                        continue;
                    }
                    let start = selection
                        .attr("startPosition")
                        .parse::<usize>()
                        .map_err(|_| "Invalid text selection start.")?;
                    let end = selection
                        .attr("endPosition")
                        .parse::<usize>()
                        .map_err(|_| "Invalid text selection end.")?;
                    let (start_offset, end_offset, quote) =
                        text_selection(&content, start, end, self.kanqual)?;
                    row["anchor_kind"] = "text_span".into();
                    row["start_offset"] = start_offset.into();
                    row["end_offset"] = end_offset.into();
                    row["quote"] = quote.into();
                }
                "AudioSelection" | "VideoSelection" => {
                    let start = selection
                        .attr("begin")
                        .parse::<f64>()
                        .map_err(|_| "Invalid media time.")?;
                    let end = selection
                        .attr("end")
                        .parse::<f64>()
                        .map_err(|_| "Invalid media time.")?;
                    if !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
                        return Err("Invalid media selection times.".into());
                    }
                    row["anchor_kind"] = "time_range".into();
                    row["time_start_ms"] = (start.round() as i64).into();
                    row["time_end_ms"] = (end.round() as i64).into();
                }
                "PictureSelection" if file.is_some() => {
                    let Some((width, height)) = image_dimensions(&file.as_ref().unwrap().1)? else {
                        self.warning("Picture dimensions could not be read; available source files are preserved.");
                        continue;
                    };
                    let coordinates = ["firstX", "firstY", "secondX", "secondY"]
                        .map(|key| selection.attr(key).parse::<f64>());
                    let [Ok(x1), Ok(y1), Ok(x2), Ok(y2)] = coordinates else {
                        return Err("Invalid picture coordinates.".into());
                    };
                    let region = PostgresExperimentImageRegionSelector {
                        x: x1.min(x2),
                        y: y1.min(y2),
                        width: (x2 - x1).abs(),
                        height: (y2 - y1).abs(),
                        image_width: width as f64,
                        image_height: height as f64,
                        page_number: None,
                    };
                    validate_postgres_experiment_annotation_image_region(&region)?;
                    row["anchor_kind"] = "image_rect".into();
                    row["region_selector_json"] = serde_json::to_string(&region)
                        .map_err(|e| e.to_string())?
                        .into();
                }
                _ => {
                    self.warning(&format!(
                        "{} regions could not be imported; available source files are preserved.",
                        selection.tag
                    ));
                    continue;
                }
            }
            add_dates(selection, &mut row);
            self.stage.append("annotations", &row)?;
            let mut refs = HashSet::new();
            selection.refs("CodeRef", &mut refs);
            for code in refs {
                self.stage.append(
                    "annotation_codes",
                    &serde_json::json!({"annotation_id":annotation,"code_id":code}),
                )?;
            }
        }
        if node.child("Transcript").is_some() {
            self.warning("Media transcripts are not imported.");
        }
        Ok(())
    }
    fn case(&mut self, node: &Node) -> Result<()> {
        if !self.stage.tables.contains_key("object_types") {
            self.stage.append(
                "object_types",
                &serde_json::json!({"id":"refi-case","name":"Case"}),
            )?;
        }
        let id = self.identify(node)?;
        let mut row = serde_json::json!({"id":id,"object_type_id":"refi-case","object_type":"Case","title":node.attr("name"),"description":node.text("Description")});
        add_dates(node, &mut row);
        self.stage.append("research_objects", &row)?;
        self.variables(node, &id, "object")?;
        for reference in node.children.iter().filter(|n| n.tag == "SourceRef") {
            self.stage.append(
                "source_objects",
                &serde_json::json!({"source_id":reference.attr("targetGUID"),"object_id":id}),
            )?;
        }
        if node.child("SelectionRef").is_some() {
            self.warning("Case links to individual selections are not imported.");
        }
        Ok(())
    }
    fn note(&mut self, node: &Node) -> Result<()> {
        let content = if !node.text("PlainTextContent").is_empty() {
            node.text("PlainTextContent").to_string()
        } else if let Some((_, path)) = self.path(node.attr("plainTextPath"))? {
            fs::read_to_string(path).map_err(|e| e.to_string())?
        } else {
            node.text("Description").into()
        };
        if node.attr("name") == "Kanqual export supplement" {
            self.supplement(&content)?;
        }
        let id = self.identify(node)?;
        let author = self.author(node)?;
        let mut row = serde_json::json!({"id":id,"title":node.attr("name"),"body":content,"created_by_project_user_id":author});
        add_dates(node, &mut row);
        self.stage.append("memos", &row)
    }
    fn supplement(&mut self, content: &str) -> Result<()> {
        let supplement: Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
        if supplement["format"] != "kanqual-refi-qda-supplement" || supplement["version"] != 1 {
            return Err("Invalid KanQual REFI-QDA supplement.".into());
        }
        let assets = supplement["assets"]
            .as_array()
            .ok_or("Invalid supplement attachments.")?;
        for asset in assets {
            let name = asset["fileName"]
                .as_str()
                .ok_or("Invalid attachment filename.")?;
            project_import::portable_path(name)?;
            let package = asset["packagePath"]
                .as_str()
                .ok_or("Invalid attachment path.")?;
            let path = self
                .files
                .get(package)
                .ok_or_else(|| format!("Missing KanQual attachment: {package}"))?;
            self.stage.assets.insert(name.into(), path.clone());
        }
        if let Some(file) = self.stage.tables.get("sources").cloned() {
            let replacement = self.stage.temporary();
            let mut output =
                std::io::BufWriter::new(fs::File::create(&replacement).map_err(|e| e.to_string())?);
            let mut source_ids = HashSet::new();
            for row in project_import_stream::rows(&file)? {
                let mut row = row?;
                source_ids.insert(row["id"].as_str().unwrap_or_default().to_string());
                let package = row["notes"]
                    .as_str()
                    .unwrap_or_default()
                    .lines()
                    .find_map(|line| line.strip_prefix("Primary source file: "));
                if let Some(asset) = assets
                    .iter()
                    .find(|asset| asset["packagePath"].as_str() == package && package.is_some())
                {
                    let name = asset["fileName"].as_str().unwrap();
                    row["storage_path"] = name.into();
                    row["original_file_name"] = name.rsplit('/').next().unwrap_or_default().into();
                    row["source_kind"] = match name
                        .rsplit('.')
                        .next()
                        .unwrap_or_default()
                        .to_lowercase()
                        .as_str()
                    {
                        "pdf" => "pdf",
                        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => "image",
                        "mp3" | "wav" | "ogg" | "m4a" | "flac" => "audio",
                        "mp4" | "webm" | "mov" | "avi" => "video",
                        _ => "text",
                    }
                    .into();
                }
                serde_json::to_writer(&mut output, &row).map_err(|e| e.to_string())?;
                output.write_all(b"\n").map_err(|e| e.to_string())?;
            }
            output.flush().map_err(|e| e.to_string())?;
            self.stage.tables.get_mut("sources").unwrap().path = replacement;
            for table in supplement["tables"]
                .as_array()
                .ok_or("Invalid supplement tables.")?
            {
                if table["name"] == "source_files" {
                    for row in table["rows"].as_array().ok_or("Invalid attachment rows.")? {
                        let mut row = row.clone();
                        let source =
                            legacy_guid("document", row["source_id"].as_str().unwrap_or_default());
                        if source_ids.contains(&source) {
                            row["source_id"] = source.into();
                            self.stage.append("source_files", &row)?;
                        }
                    }
                }
            }
        }
        self.warning("This older KanQual REFI-QDA export restores standard QDA data and attachments. Its original supplement is retained as a memo; use a JSON backup to restore KanQual-specific layouts and links.");
        Ok(())
    }
}
fn add_dates(node: &Node, row: &mut Value) {
    for (from, to) in [
        ("creationDateTime", "created_at"),
        ("modifiedDateTime", "updated_at"),
    ] {
        if !node.attr(from).is_empty() {
            row[to] = node.attr(from).into();
        }
    }
}
fn legacy_guid(kind: &str, id: &str) -> String {
    let value = format!("{kind}:{id}");
    let mut hex = String::new();
    for seed in 0..4 {
        let mut hash = 0x811c9dc5u32 ^ seed;
        for ch in value.encode_utf16() {
            hash = (hash ^ ch as u32).wrapping_mul(0x01000193);
        }
        hex.push_str(&format!("{hash:08x}"));
    }
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}
fn text_selection(
    text: &str,
    start: usize,
    end: usize,
    utf16: bool,
) -> Result<(usize, usize, String)> {
    if end < start {
        return Err("Invalid text selection offsets.".into());
    }
    let mut units = 0;
    let mut utf16_units = 0;
    let mut begin = None;
    let mut finish = None;
    for (byte, ch) in text
        .char_indices()
        .chain(std::iter::once((text.len(), '\0')))
    {
        if units == start {
            begin = Some((byte, utf16_units));
        }
        if units == end {
            finish = Some((byte, utf16_units));
            break;
        }
        units += if utf16 { ch.len_utf16() } else { 1 };
        utf16_units += ch.len_utf16();
    }
    let (Some((from, a)), Some((to, b))) = (begin, finish) else {
        return Err("A text selection has invalid offsets.".into());
    };
    Ok((a, b, text[from..to].into()))
}
fn image_dimensions(path: &Path) -> Result<Option<(u32, u32)>> {
    let mut file = BufReader::new(fs::File::open(path).map_err(|e| e.to_string())?);
    let mut header = [0; 32];
    let length = file.read(&mut header).map_err(|e| e.to_string())?;
    if length >= 24 && header.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(Some((
            u32::from_be_bytes(header[16..20].try_into().unwrap()),
            u32::from_be_bytes(header[20..24].try_into().unwrap()),
        )));
    }
    if length >= 10 && header.starts_with(b"GIF8") {
        return Ok(Some((
            u16::from_le_bytes(header[6..8].try_into().unwrap()) as u32,
            u16::from_le_bytes(header[8..10].try_into().unwrap()) as u32,
        )));
    }
    if length >= 26 && header.starts_with(b"BM") {
        if u32::from_le_bytes(header[14..18].try_into().unwrap()) == 12 {
            return Ok(Some((
                u16::from_le_bytes(header[18..20].try_into().unwrap()) as u32,
                u16::from_le_bytes(header[20..22].try_into().unwrap()) as u32,
            )));
        }
        return Ok(Some((
            u32::from_le_bytes(header[18..22].try_into().unwrap()),
            i32::from_le_bytes(header[22..26].try_into().unwrap()).unsigned_abs(),
        )));
    }
    if length >= 30 && &header[..4] == b"RIFF" && &header[12..16] == b"VP8X" {
        return Ok(Some((
            1 + u32::from_le_bytes([header[24], header[25], header[26], 0]),
            1 + u32::from_le_bytes([header[27], header[28], header[29], 0]),
        )));
    }
    if length >= 30
        && &header[..4] == b"RIFF"
        && &header[12..16] == b"VP8 "
        && header[23..26] == [0x9d, 0x01, 0x2a]
    {
        return Ok(Some((
            (u16::from_le_bytes([header[26], header[27]]) & 0x3fff) as u32,
            (u16::from_le_bytes([header[28], header[29]]) & 0x3fff) as u32,
        )));
    }
    if length >= 25 && &header[..4] == b"RIFF" && &header[12..16] == b"VP8L" && header[20] == 0x2f {
        return Ok(Some((
            1 + header[21] as u32 + ((header[22] as u32 & 0x3f) << 8),
            1 + (header[22] as u32 >> 6)
                + ((header[23] as u32) << 2)
                + ((header[24] as u32 & 15) << 10),
        )));
    }
    if header.starts_with(&[0xff, 0xd8]) {
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::Start(2)).map_err(|e| e.to_string())?;
        loop {
            let mut marker = [0; 2];
            if file.read_exact(&mut marker).is_err() {
                break;
            }
            if marker[0] != 0xff {
                break;
            }
            if marker[1] == 0xff {
                file.seek(SeekFrom::Current(-1))
                    .map_err(|e| e.to_string())?;
                continue;
            }
            let mut len = [0; 2];
            file.read_exact(&mut len).map_err(|e| e.to_string())?;
            let len = u16::from_be_bytes(len) as i64;
            if matches!(marker[1],0xc0..=0xc3|0xc5..=0xc7|0xc9..=0xcb|0xcd..=0xcf) {
                let mut data = [0; 5];
                file.read_exact(&mut data).map_err(|e| e.to_string())?;
                return Ok(Some((
                    u16::from_be_bytes([data[3], data[4]]) as u32,
                    u16::from_be_bytes([data[1], data[2]]) as u32,
                )));
            }
            if len < 2 {
                break;
            }
            file.seek(SeekFrom::Current(len - 2))
                .map_err(|e| e.to_string())?;
        }
    }
    if header[..length]
        .iter()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
        == Some(b'<')
    {
        let mut reader = Reader::from_reader(BufReader::new(
            fs::File::open(path).map_err(|e| e.to_string())?,
        ));
        let mut buffer = Vec::new();
        loop {
            match reader
                .read_event_into(&mut buffer)
                .map_err(|e| e.to_string())?
            {
                Event::Start(start) | Event::Empty(start) => {
                    let node = start_node(&start, &reader)?;
                    if node.tag != "svg" {
                        break;
                    }
                    let dimension = |value: &str| {
                        value
                            .trim()
                            .trim_end_matches("px")
                            .parse::<f64>()
                            .ok()
                            .filter(|v| v.is_finite() && *v > 0.0 && *v <= u32::MAX as f64)
                            .map(|v| v.round() as u32)
                    };
                    if let (Some(width), Some(height)) = (
                        dimension(node.attr("width")),
                        dimension(node.attr("height")),
                    ) {
                        return Ok(Some((width, height)));
                    }
                    let viewbox: Vec<_> = node
                        .attr("viewBox")
                        .split(|ch: char| ch.is_whitespace() || ch == ',')
                        .filter(|s| !s.is_empty())
                        .collect();
                    if viewbox.len() == 4 {
                        if let (Some(width), Some(height)) =
                            (dimension(viewbox[2]), dimension(viewbox[3]))
                        {
                            return Ok(Some((width, height)));
                        }
                    }
                    break;
                }
                Event::Eof | Event::DocType(_) => break,
                _ => {}
            }
            buffer.clear();
        }
    }
    Ok(None)
}
pub(super) fn prepare_refi(
    files: &HashMap<String, PathBuf>,
    stage: &mut StagedProject,
    progress: &Progress,
) -> Result<()> {
    let projects: Vec<_> = files
        .iter()
        .filter(|(name, _)| name.to_lowercase().ends_with(".qde"))
        .collect();
    if projects.len() != 1 {
        return Err("The package must contain exactly one .qde project file.".into());
    }
    let (name, path) = projects[0];
    let folder = name
        .rfind('/')
        .map(|i| name[..=i].to_string())
        .unwrap_or_default();
    let mut converter = Converter {
        files,
        folder,
        stage,
        variables: HashMap::new(),
        added_variables: HashSet::new(),
        users: HashSet::new(),
        ids: HashSet::new(),
        kanqual: false,
    };
    let mut description = String::new();
    let root = scan(
        path,
        &["User", "Variable", "Code", "Description"],
        progress,
        |node, depth| {
            match node.tag.as_str() {
                "User" => {
                    let id = converter.identify(&node)?;
                    converter.users.insert(id.clone());
                    converter.stage.append(
                        "project_users",
                        &serde_json::json!({"id":id,"name":node.attr("name")}),
                    )?;
                }
                "Variable" => {
                    let id = converter.identify(&node)?;
                    converter.variables.insert(id, node);
                }
                "Code" => converter.code(&node, None)?,
                "Description" if depth == 1 => description = node.text,
                _ => {}
            }
            Ok(())
        },
    )?;
    converter.kanqual = root.attr("origin").eq_ignore_ascii_case("kanqual");
    converter.stage.project =
        serde_json::json!({"name":root.attr("name"),"description":description});
    scan(
        path,
        &[
            "TextSource",
            "PDFSource",
            "PictureSource",
            "AudioSource",
            "VideoSource",
            "Case",
            "Note",
            "Set",
            "Graph",
            "Link",
        ],
        progress,
        |node, _| {
            match node.tag.as_str() {
                "Case" => converter.case(&node)?,
                "Note" => converter.note(&node)?,
                "Set" | "Graph" | "Link" => {
                    converter.warning("REFI-QDA sets, graphs, and links are not imported.")
                }
                _ => converter.source(&node)?,
            }
            Ok(())
        },
    )?;
    Ok(())
}
