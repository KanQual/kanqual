//! Disk-backed import preparation. Attachment size never determines heap usage.
use super::*;
use std::io::{BufRead, BufReader, BufWriter, Seek, SeekFrom};
use std::sync::atomic::AtomicU64;
use tempfile::TempDir;

type ImportResult<T> = Result<T, String>;
const BUFFER: usize = 64 * 1024;

#[derive(Clone)]
pub(super) struct Progress {
    pub cancelled: Arc<AtomicBool>,
    app: Option<tauri::AppHandle>,
    id: String,
    last: Arc<AtomicU64>,
}
impl Progress {
    pub fn new(app: Option<tauri::AppHandle>, id: String) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            app,
            id,
            last: Arc::new(AtomicU64::new(0)),
        }
    }
    pub fn check(&self) -> ImportResult<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err("Import cancelled.".into())
        } else {
            Ok(())
        }
    }
    pub fn report(&self, phase: &str, completed: u64, total: u64) -> ImportResult<()> {
        self.check()?;
        let now = current_time_ms();
        if completed == 0
            || completed == total
            || now.saturating_sub(self.last.load(Ordering::Relaxed)) >= 100
        {
            self.last.store(now, Ordering::Relaxed);
            if let Some(app) = &self.app {
                let _ = app.emit("project-import-progress", serde_json::json!({"id":self.id,"phase":phase,"completed":completed,"total":total}));
            }
        }
        Ok(())
    }
}

pub(super) fn copy_stream(
    mut input: impl Read,
    mut output: impl Write,
    progress: &Progress,
    phase: &str,
    total: u64,
) -> ImportResult<u64> {
    let mut buffer = [0; BUFFER];
    let mut bytes = 0;
    loop {
        progress.report(phase, bytes, total)?;
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count]).map_err(|e| {
            format!("Could not stage import data (check available disk space): {e}")
        })?;
        bytes += count as u64;
    }
    output.flush().map_err(|e| e.to_string())?;
    progress.report(phase, bytes, total)?;
    Ok(bytes)
}

#[derive(Clone)]
pub(super) struct TableFile {
    pub path: PathBuf,
    pub count: u64,
}
pub(super) struct StagedProject {
    pub directory: TempDir,
    pub project: Value,
    pub tables: HashMap<String, TableFile>,
    pub assets: HashMap<String, PathBuf>,
    pub warnings: Vec<String>,
    pub format: String,
    native: HashMap<String, TableFile>,
    generated: HashMap<String, TableFile>,
}
impl StagedProject {
    pub fn new() -> ImportResult<Self> {
        Ok(Self {
            directory: tempfile::Builder::new()
                .prefix(&format!("kanqual-import-{}-", generate_identifier()))
                .tempdir()
                .map_err(|e| e.to_string())?,
            project: serde_json::json!({}),
            tables: HashMap::new(),
            assets: HashMap::new(),
            warnings: Vec::new(),
            format: "json".into(),
            native: HashMap::new(),
            generated: HashMap::new(),
        })
    }
    pub fn temporary(&self) -> PathBuf {
        self.directory.path().join(generate_identifier())
    }
    pub fn append(&mut self, table: &str, row: &Value) -> ImportResult<()> {
        let next = TableFile {
            path: self.temporary(),
            count: 0,
        };
        let file = self.tables.entry(table.into()).or_insert(next);
        let mut out = BufWriter::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file.path)
                .map_err(|e| e.to_string())?,
        );
        serde_json::to_writer(&mut out, row).map_err(|e| e.to_string())?;
        out.write_all(b"\n").map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
        file.count += 1;
        Ok(())
    }
    pub fn finish(&mut self, progress: &Progress) -> ImportResult<()> {
        let aliases = [
            ("project_users", &["project_members"][..]),
            ("sources", &["documents"][..]),
            ("research_objects", &["objects", "cases"][..]),
            (
                "source_objects",
                &["source_object_links", "case_documents"][..],
            ),
            ("object_relationships", &["relationships"][..]),
            (
                "source_attribute_definitions",
                &["document_attribute_definitions"][..],
            ),
            (
                "source_attribute_values",
                &["document_attribute_values"][..],
            ),
            (
                "object_attribute_definitions",
                &["case_attribute_definitions"][..],
            ),
            ("object_attribute_values", &["case_attribute_values"][..]),
        ];
        for (target, sources) in aliases {
            if !self.tables.contains_key(target) {
                if let Some(file) = sources
                    .iter()
                    .find_map(|source| self.tables.get(*source).cloned())
                {
                    self.tables.insert(target.into(), file);
                }
            }
        }
        for (name, file) in self.native.drain() {
            self.tables.insert(name, file);
        }
        // Generate legacy inline links only when an explicit link table is absent.
        for (table, columns) in [
            (
                "annotations",
                vec![("code_ids", "annotation_codes", "code_id")],
            ),
            (
                "memos",
                vec![
                    ("source_ids", "memo_sources", "source_id"),
                    ("annotation_ids", "memo_annotations", "annotation_id"),
                    ("code_ids", "memo_codes", "code_id"),
                    ("object_ids", "memo_objects", "object_id"),
                ],
            ),
        ] {
            if let Some(file) = self.tables.get(table).cloned() {
                for row in rows(&file)? {
                    progress.check()?;
                    let row = row?;
                    for (field, target, key) in &columns {
                        if self.tables.contains_key(*target) {
                            continue;
                        }
                        let mut ids = row[*field].as_array().cloned().unwrap_or_default();
                        if table == "annotations" {
                            if let Some(code) = row
                                .get("code")
                                .filter(|v| v.as_str().is_some_and(|s| !s.is_empty()))
                            {
                                if !ids.contains(code) {
                                    ids.push(code.clone());
                                }
                            }
                        }
                        for id in ids {
                            let next = TableFile {
                                path: self.temporary(),
                                count: 0,
                            };
                            let file = self.generated.entry((*target).into()).or_insert(next);
                            let mut out = OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(&file.path)
                                .map_err(|e| e.to_string())?;
                            let owner = if table == "annotations" {
                                "annotation_id"
                            } else {
                                "memo_id"
                            };
                            serde_json::to_writer(
                                &mut out,
                                &serde_json::json!({owner:row["id"],*key:id}),
                            )
                            .map_err(|e| e.to_string())?;
                            out.write_all(b"\n").map_err(|e| e.to_string())?;
                            file.count += 1;
                        }
                    }
                }
            }
        }
        self.tables.extend(self.generated.drain());
        let paths: HashSet<_> = self.assets.keys().cloned().collect();
        for table in project_import::IMPORT_TABLES {
            if let Some(file) = self.tables.get(*table) {
                for row in rows(file)? {
                    progress.check()?;
                    for (key, value) in project_import::normalize_row(table, &row?)? {
                        if key.ends_with("storage_path") {
                            if let Some(path) = value.as_str().filter(|path| !path.is_empty()) {
                                project_import::portable_path(path)?;
                                if !paths.contains(path) {
                                    return Err(format!(
                                        "The export is missing an attachment: {path}"
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

pub(super) fn rows(file: &TableFile) -> ImportResult<impl Iterator<Item = ImportResult<Value>>> {
    Ok(BufReader::with_capacity(
        BUFFER,
        fs::File::open(&file.path).map_err(|e| e.to_string())?,
    )
    .lines()
    .map(|line| serde_json::from_str(&line.map_err(|e| e.to_string())?).map_err(|e| e.to_string())))
}

/// JSON framing retains at most one record. Large base64 strings are decoded through a Reader.
struct JsonInput<R: BufRead> {
    input: R,
    progress: Progress,
    consumed: u64,
    total: u64,
}
impl<R: BufRead> JsonInput<R> {
    fn byte(&mut self) -> ImportResult<u8> {
        let byte = *self
            .input
            .fill_buf()
            .map_err(|e| e.to_string())?
            .first()
            .ok_or("Unexpected end of JSON.")?;
        self.input.consume(1);
        self.consumed += 1;
        if self.consumed % BUFFER as u64 == 0 {
            self.progress.report("reading", self.consumed, self.total)?;
        }
        Ok(byte)
    }
    fn peek(&mut self) -> ImportResult<Option<u8>> {
        loop {
            let byte = self
                .input
                .fill_buf()
                .map_err(|e| e.to_string())?
                .first()
                .copied();
            if byte.is_some_and(|b| b.is_ascii_whitespace()) {
                self.byte()?;
            } else {
                return Ok(byte);
            }
        }
    }
    fn expect(&mut self, expected: u8) -> ImportResult<()> {
        if self.peek()? != Some(expected) {
            return Err(format!(
                "Invalid project JSON: expected '{}'.",
                expected as char
            ));
        }
        self.byte()?;
        Ok(())
    }
    fn string(&mut self, out: &mut impl Write) -> ImportResult<()> {
        self.expect(b'"')?;
        let mut chunk = Vec::with_capacity(BUFFER);
        loop {
            // Most attachment strings contain no escapes. Decode whole input-buffer spans.
            let buffer = self.input.fill_buf().map_err(|e| e.to_string())?;
            let plain = buffer
                .iter()
                .position(|byte| *byte == b'"' || *byte == b'\\' || *byte < 32)
                .unwrap_or(buffer.len());
            if plain > 0 {
                out.write_all(&chunk).map_err(|e| e.to_string())?;
                chunk.clear();
                out.write_all(&buffer[..plain]).map_err(|e| e.to_string())?;
                self.input.consume(plain);
                self.consumed += plain as u64;
                self.progress.report("reading", self.consumed, self.total)?;
                continue;
            }
            match self.byte()? {
                b'"' => break,
                b'\\' => {
                    let escaped = self.byte()?;
                    match escaped {
                        b'"' | b'\\' | b'/' => chunk.push(escaped),
                        b'b' => chunk.push(8),
                        b'f' => chunk.push(12),
                        b'n' => chunk.push(10),
                        b'r' => chunk.push(13),
                        b't' => chunk.push(9),
                        b'u' => {
                            let mut token = vec![b'"', b'\\', b'u'];
                            for _ in 0..4 {
                                token.push(self.byte()?);
                            }
                            let first = u16::from_str_radix(
                                std::str::from_utf8(&token[3..]).map_err(|e| e.to_string())?,
                                16,
                            )
                            .map_err(|e| e.to_string())?;
                            if (0xd800..=0xdbff).contains(&first) {
                                for _ in 0..6 {
                                    token.push(self.byte()?);
                                }
                            }
                            token.push(b'"');
                            let decoded: String =
                                serde_json::from_slice(&token).map_err(|e| e.to_string())?;
                            chunk.extend_from_slice(decoded.as_bytes());
                        }
                        _ => return Err("Invalid JSON string escape.".into()),
                    }
                }
                byte if byte < 32 => return Err("Invalid JSON control character.".into()),
                byte => chunk.push(byte),
            }
            if chunk.len() >= BUFFER {
                out.write_all(&chunk).map_err(|e| e.to_string())?;
                chunk.clear();
            }
        }
        out.write_all(&chunk).map_err(|e| e.to_string())
    }
    fn key(&mut self) -> ImportResult<String> {
        let mut bytes = Vec::new();
        self.string(&mut bytes)?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }
    fn value(&mut self) -> ImportResult<Value> {
        let mut raw = Vec::new();
        let mut depth = 0u32;
        let mut quoted = false;
        let mut escaped = false;
        self.peek()?;
        loop {
            let next = self
                .input
                .fill_buf()
                .map_err(|e| e.to_string())?
                .first()
                .copied();
            let Some(byte) = next else {
                break;
            };
            if !quoted
                && depth == 0
                && !raw.is_empty()
                && (byte.is_ascii_whitespace() || matches!(byte, b',' | b'}' | b']'))
            {
                break;
            }
            let byte = self.byte()?;
            raw.push(byte);
            if quoted {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    quoted = false;
                    if depth == 0 {
                        break;
                    }
                }
            } else {
                match byte {
                    b'"' => quoted = true,
                    b'{' | b'[' => {
                        depth += 1;
                        if depth > 128 {
                            return Err("Project JSON is nested too deeply.".into());
                        }
                    }
                    b'}' | b']' => {
                        depth = depth.checked_sub(1).ok_or("Invalid JSON structure.")?;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
        serde_json::from_slice(&raw).map_err(|e| format!("Invalid project JSON: {e}"))
    }
    fn object(
        &mut self,
        mut field: impl FnMut(&mut Self, String) -> ImportResult<()>,
    ) -> ImportResult<()> {
        self.expect(b'{')?;
        let mut keys = HashSet::new();
        if self.peek()? == Some(b'}') {
            self.byte()?;
            return Ok(());
        }
        loop {
            let key = self.key()?;
            if !keys.insert(key.clone()) {
                return Err(format!("Duplicate JSON field: {key}"));
            }
            self.expect(b':')?;
            field(self, key)?;
            match self.peek()? {
                Some(b'}') => {
                    self.byte()?;
                    return Ok(());
                }
                Some(b',') => {
                    self.byte()?;
                }
                _ => return Err("Invalid JSON object.".into()),
            }
        }
    }
    fn array(&mut self, mut item: impl FnMut(&mut Self) -> ImportResult<()>) -> ImportResult<()> {
        self.expect(b'[')?;
        if self.peek()? == Some(b']') {
            self.byte()?;
            return Ok(());
        }
        loop {
            item(self)?;
            match self.peek()? {
                Some(b']') => {
                    self.byte()?;
                    return Ok(());
                }
                Some(b',') => {
                    self.byte()?;
                }
                _ => return Err("Invalid JSON array.".into()),
            }
        }
    }
    fn base64_file(&mut self, path: &Path) -> ImportResult<()> {
        // Buffer only complete base64 quanta; escaped JSON slashes/unicode remain valid.
        struct DecodeWriter {
            out: BufWriter<fs::File>,
            pending: Vec<u8>,
            ended: bool,
        }
        impl Write for DecodeWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if self.ended && !bytes.is_empty() {
                    return Err(std::io::Error::other("Trailing base64 data."));
                }
                self.pending.extend_from_slice(bytes);
                let length = self.pending.len() / 4 * 4;
                if length > 0 {
                    let decoded = BASE64_STANDARD
                        .decode(&self.pending[..length])
                        .map_err(std::io::Error::other)?;
                    self.ended = self.pending[..length].contains(&b'=');
                    self.out.write_all(&decoded)?;
                    self.pending.drain(..length);
                }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                self.out.flush()
            }
        }
        let mut output = DecodeWriter {
            out: BufWriter::new(fs::File::create(path).map_err(|e| e.to_string())?),
            pending: Vec::new(),
            ended: false,
        };
        self.string(&mut output)?;
        if !output.pending.is_empty() {
            return Err("Truncated base64 attachment.".into());
        }
        output.flush().map_err(|e| e.to_string())
    }
    fn tables(&mut self, stage: &mut StagedProject, native: bool) -> ImportResult<()> {
        self.array(|input| {
            let path = stage.temporary(); let mut count = 0; let mut name = None; let mut has_rows = false;
            let mut output = BufWriter::new(fs::File::create(&path).map_err(|e| e.to_string())?);
            input.object(|input, key| {
                match key.as_str() {
                    "name" => name = Some(input.key()?),
                    "rows" => { has_rows = true; input.array(|input| {
                        let row = input.value()?;
                        if !row.is_object() { return Err("Project table rows must be objects.".into()); }
                        serde_json::to_writer(&mut output, &row).map_err(|e| e.to_string())?;
                        output.write_all(b"\n").map_err(|e| e.to_string())?; count += 1; Ok(())
                    })?; },
                    _ => { input.value()?; },
                } Ok(())
            })?;
            output.flush().map_err(|e| e.to_string())?;
            let name = name.ok_or("Project table name missing.")?;
            if !has_rows { return Err("Project table rows missing.".into()); }
            // Reuse format validation without loading the table's contents.
            let sample = if count > 0 { vec![serde_json::json!({})] } else { vec![] };
            let field = if native { "postgresTables" } else { "tables" };
            let mut validation = serde_json::json!({"format":"kanqual-project-export","version":1,"project":{},"tables":[]});
            validation[field] = serde_json::json!([{"name":name,"rows":sample}]);
            project_import::read_tables(&validation)?;
            let tables = if native { &mut stage.native } else { &mut stage.tables };
            if tables.insert(name.clone(), TableFile { path, count }).is_some() { return Err(format!("Duplicate project table: {name}")); }
            Ok(())
        })
    }
    fn assets(&mut self, stage: &mut StagedProject) -> ImportResult<()> {
        let mut paths: HashSet<String> =
            stage.assets.keys().map(|key| key.to_lowercase()).collect();
        self.array(|input| {
            let path = stage.temporary();
            let mut metadata = serde_json::Map::new();
            let mut has_data = false;
            input.object(|input, key| {
                if key == "dataBase64" {
                    input.base64_file(&path)?;
                    has_data = true;
                } else {
                    metadata.insert(key, input.value()?);
                }
                Ok(())
            })?;
            let value = Value::Object(metadata);
            let name = value["fileName"]
                .as_str()
                .ok_or("Attachment filename missing.")?;
            project_import::portable_path(name)?;
            if !has_data || value["collection"].as_str() != Some("project_storage_files") {
                return Err("Unsupported or missing attachment data.".into());
            }
            if !paths.insert(name.to_lowercase()) {
                return Err("Duplicate attachment filename.".into());
            }
            stage.assets.insert(name.into(), path);
            Ok(())
        })
    }
    fn root(
        &mut self,
        stage: &mut StagedProject,
        depth: usize,
    ) -> ImportResult<(Value, Option<PathBuf>)> {
        if depth > 1 {
            return Err("Invalid nested backup envelope.".into());
        }
        let mut metadata = serde_json::Map::new();
        let mut ciphertext = None;
        let mut payload = None;
        self.object(|input, key| {
            match key.as_str() {
                "tables" => {
                    input.tables(stage, false)?;
                    metadata.insert(key, Value::Bool(true));
                }
                "postgresTables" => {
                    input.tables(stage, true)?;
                }
                "assets" => {
                    input.assets(stage)?;
                    metadata.insert(key, Value::Bool(true));
                }
                "payload" => {
                    payload = Some(input.root(stage, depth + 1)?);
                }
                "ciphertextB64" => {
                    let path = stage.temporary();
                    input.base64_file(&path)?;
                    ciphertext = Some(path);
                }
                _ => {
                    metadata.insert(key, input.value()?);
                }
            }
            Ok(())
        })?;
        let metadata = Value::Object(metadata);
        if metadata["kind"] == "kanqual-project-backup" {
            if metadata["version"] != 1 {
                return Err("Unsupported backup version.".into());
            }
            payload.ok_or("Project backup payload is missing.".into())
        } else {
            if payload.is_some() {
                return Err("Unexpected nested project payload.".into());
            }
            Ok((metadata, ciphertext))
        }
    }
}

fn stage_json(
    input: impl Read,
    length: u64,
    stage: &mut StagedProject,
    progress: &Progress,
) -> ImportResult<(Value, Option<PathBuf>)> {
    let mut input = JsonInput {
        input: BufReader::with_capacity(BUFFER, input),
        progress: progress.clone(),
        consumed: 0,
        total: length,
    };
    if input
        .input
        .fill_buf()
        .map_err(|e| e.to_string())?
        .starts_with(&[0xef, 0xbb, 0xbf])
    {
        for _ in 0..3 {
            input.byte()?;
        }
    }
    let result = input.root(stage, 0)?;
    if input.peek()?.is_some() {
        return Err("Unexpected content after project JSON.".into());
    }
    Ok(result)
}

fn validate_project(metadata: &Value, stage: &mut StagedProject) -> ImportResult<()> {
    if metadata["format"] != "kanqual-project-export"
        || metadata["version"] != 1
        || !metadata["project"].is_object()
        || metadata["tables"] != true
        || metadata["assets"] != true
    {
        return Err("This is not a supported KanQual project export (version 1).".into());
    }
    stage.project = metadata["project"].clone();
    Ok(())
}

/// Authenticate the complete existing AES-256-GCM format before exposing plaintext.
/// GCM's tag is GHASH(ciphertext || lengths) XOR AES(K, nonce || 1).
fn decrypt_file(
    metadata: &Value,
    ciphertext: &Path,
    output: &Path,
    password: &str,
    progress: &Progress,
) -> ImportResult<()> {
    use aes_gcm::aes::{
        cipher::{BlockEncrypt, KeyIvInit, StreamCipher},
        Aes256,
    };
    use ghash::{universal_hash::UniversalHash, GHash};
    use subtle::ConstantTimeEq;
    let mut header = metadata.clone();
    header["ciphertextB64"] = Value::String(String::new());
    let envelope: EncryptedBackupEnvelope =
        serde_json::from_value(header).map_err(|e| e.to_string())?;
    if envelope.kind != ENCRYPTED_BACKUP_KIND
        || envelope.version != ENCRYPTED_BACKUP_VERSION
        || envelope.cipher != ENCRYPTED_BACKUP_CIPHER
        || envelope.kdf.name != ENCRYPTED_BACKUP_KDF_NAME
    {
        return Err("Unsupported encrypted backup format.".into());
    }
    let salt = BASE64_STANDARD
        .decode(envelope.kdf.salt_b64)
        .map_err(|e| e.to_string())?;
    let nonce = BASE64_STANDARD
        .decode(envelope.nonce_b64)
        .map_err(|e| e.to_string())?;
    if nonce.len() != 12 {
        return Err("Invalid encrypted backup nonce.".into());
    }
    let key = Zeroizing::new(derive_encrypted_backup_key(password.as_bytes(), &salt)?);
    let aes = Aes256::new_from_slice(key.as_ref()).map_err(|e| e.to_string())?;
    let mut hash_key = aes_gcm::aes::cipher::Block::<Aes256>::default();
    aes.encrypt_block(&mut hash_key);
    let mut hash = GHash::new(&hash_key);
    let mut file = fs::File::open(ciphertext).map_err(|e| e.to_string())?;
    let length = file
        .metadata()
        .map_err(|e| e.to_string())?
        .len()
        .checked_sub(16)
        .ok_or("Truncated encrypted backup.")?;
    // GCM limits one message to 2^32-2 counter blocks, independently of RAM.
    if length > (u32::MAX as u64 - 1) * 16 {
        return Err(
            "This encrypted file exceeds the AES-GCM message size supported by its format.".into(),
        );
    }
    let mut remaining = length;
    let mut buffer = [0; BUFFER];
    while remaining > 0 {
        progress.report("verifying", length - remaining, length)?;
        let count = remaining.min(BUFFER as u64) as usize;
        file.read_exact(&mut buffer[..count])
            .map_err(|e| e.to_string())?;
        hash.update_padded(&buffer[..count]);
        remaining -= count as u64;
    }
    let mut lengths = ghash::Block::default();
    lengths[8..].copy_from_slice(&(length * 8).to_be_bytes());
    hash.update(&[lengths]);
    let mut tag = hash.finalize();
    let mut j0 = aes_gcm::aes::cipher::Block::<Aes256>::default();
    j0[..12].copy_from_slice(&nonce);
    j0[15] = 1;
    aes.encrypt_block(&mut j0);
    for (byte, mask) in tag.iter_mut().zip(j0) {
        *byte ^= mask;
    }
    let mut actual = [0; 16];
    file.read_exact(&mut actual).map_err(|e| e.to_string())?;
    if !bool::from(tag.as_slice().ct_eq(&actual)) {
        return Err("Incorrect password or corrupted encrypted backup.".into());
    }
    progress.check()?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut counter = [0u8; 16];
    counter[..12].copy_from_slice(&nonce);
    counter[15] = 2;
    let mut cipher = ctr::Ctr32BE::<Aes256>::new_from_slices(key.as_ref(), &counter)
        .map_err(|e| e.to_string())?;
    let mut out = BufWriter::new(fs::File::create(output).map_err(|e| e.to_string())?);
    remaining = length;
    while remaining > 0 {
        progress.report("decrypting", length - remaining, length)?;
        let count = remaining.min(BUFFER as u64) as usize;
        file.read_exact(&mut buffer[..count])
            .map_err(|e| e.to_string())?;
        cipher.apply_keystream(&mut buffer[..count]);
        out.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        remaining -= count as u64;
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn prepare(
    path: &Path,
    password: Option<Zeroizing<String>>,
    progress: &Progress,
) -> ImportResult<Option<StagedProject>> {
    let mut stage = StagedProject::new()?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Select a project file.".into());
    }
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("qdpx"))
    {
        stage.format = "qdpx".into();
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Invalid REFI-QDA package: {e}"))?;
        let mut names = HashSet::new();
        let mut extracted = HashMap::new();
        let has_native = archive
            .file_names()
            .any(|name| name == "kanqual-project.json");
        for i in 0..archive.len() {
            progress.check()?;
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().trim_end_matches('/').to_string();
            project_import::portable_path(&name)?;
            if !names.insert(name.to_lowercase()) || entry.is_symlink() {
                return Err("Unsafe or duplicate archive entry.".into());
            }
            if entry.is_dir() {
                continue;
            }
            if has_native {
                if name == "kanqual-project.json" {
                    let size = entry.size();
                    let (metadata, encrypted) = stage_json(&mut entry, size, &mut stage, progress)?;
                    if encrypted.is_some() {
                        return Err("Unexpected encrypted JSON inside REFI-QDA package.".into());
                    }
                    validate_project(&metadata, &mut stage)?;
                }
                // Native JSON contains all attachments; do not extract duplicate media.
                continue;
            }
            let target = stage.temporary();
            let size = entry.size();
            let copied = copy_stream(
                &mut entry,
                fs::File::create(&target).map_err(|e| e.to_string())?,
                progress,
                "extracting",
                size,
            )?;
            if copied != size {
                return Err("Archive entry size did not match its manifest.".into());
            }
            extracted.insert(name, target);
        }
        if !has_native {
            project_import_refi::prepare_refi(&extracted, &mut stage, progress)?;
        }
    } else {
        let (metadata, ciphertext) = stage_json(
            &file,
            file.metadata().map_err(|e| e.to_string())?.len(),
            &mut stage,
            progress,
        )?;
        if metadata["kind"] == ENCRYPTED_BACKUP_KIND {
            let Some(password) = password else {
                return Ok(None);
            };
            if !stage.tables.is_empty() || !stage.assets.is_empty() {
                return Err("Invalid encrypted backup envelope.".into());
            }
            let ciphertext = ciphertext.ok_or("Encrypted backup data is missing.")?;
            let plaintext = stage.temporary();
            decrypt_file(&metadata, &ciphertext, &plaintext, &password, progress)?;
            fs::remove_file(ciphertext).map_err(|e| e.to_string())?;
            let file = fs::File::open(&plaintext).map_err(|e| e.to_string())?;
            let (metadata, encrypted) = stage_json(
                &file,
                file.metadata().map_err(|e| e.to_string())?.len(),
                &mut stage,
                progress,
            )?;
            if encrypted.is_some() {
                return Err("Unexpected nested encryption.".into());
            }
            validate_project(&metadata, &mut stage)?;
            stage.format = "encrypted".into();
            drop(file);
            fs::remove_file(plaintext).map_err(|e| e.to_string())?;
        } else {
            validate_project(&metadata, &mut stage)?;
        }
    }
    stage.finish(progress)?;
    stage
        .tables
        .retain(|name, _| project_import::IMPORT_TABLES.contains(&name.as_str()));
    let keep: HashSet<_> = stage
        .tables
        .values()
        .map(|table| table.path.clone())
        .chain(stage.assets.values().cloned())
        .collect();
    // This private directory contains only files created by this preparation job.
    for entry in fs::read_dir(stage.directory.path()).map_err(|e| e.to_string())? {
        progress.check()?;
        let entry = entry.map_err(|e| e.to_string())?;
        if !keep.contains(&entry.path()) {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(Some(stage))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn progress() -> Progress {
        Progress::new(None, "test".into())
    }
    fn table(stage: &StagedProject, name: &str) -> Vec<Value> {
        rows(&stage.tables[name])
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn stages_base64_in_chunks_with_escapes_and_cleans_up() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("export.json");
        let data = vec![0xff; BUFFER * 3 + 7];
        let encoded = BASE64_STANDARD.encode(&data).replace('/', "\\u002f");
        fs::write(&file,format!(r#"{{"format":"kanqual-project-export","version":1,"project":{{"name":"Chunked"}},"tables":[{{"rows":[{{"id":"s","title":"Source","storagePath":"files/a.bin"}}],"name":"sources"}}],"assets":[{{"dataBase64":"{encoded}","fileName":"files/a.bin","collection":"project_storage_files"}}]}}"#)).unwrap();
        let stage = prepare(&file, None, &progress()).unwrap().unwrap();
        let directory = stage.directory.path().to_path_buf();
        assert_eq!(fs::read(&stage.assets["files/a.bin"]).unwrap(), data);
        assert_eq!(stage.tables["sources"].count, 1);
        drop(stage);
        assert!(!directory.exists());
    }

    #[test]
    fn authenticates_multichunk_encryption_before_writing_plaintext() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("encrypted.kqbe");
        for length in [
            0,
            1,
            15,
            16,
            17,
            BUFFER - 1,
            BUFFER,
            BUFFER + 1,
            BUFFER * 3 + 9,
        ] {
            let plaintext = "x".repeat(length);
            let encrypted =
                encrypt_backup_payload_text(plaintext.clone(), "password".into()).unwrap();
            let mut stage = StagedProject::new().unwrap();
            let (metadata, ciphertext) = stage_json(
                encrypted.as_bytes(),
                encrypted.len() as u64,
                &mut stage,
                &progress(),
            )
            .unwrap();
            let ciphertext = ciphertext.unwrap();
            let output = stage.temporary();
            decrypt_file(&metadata, &ciphertext, &output, "password", &progress()).unwrap();
            assert_eq!(fs::read_to_string(output).unwrap(), plaintext);
            let output = stage.temporary();
            assert!(decrypt_file(&metadata, &ciphertext, &output, "wrong", &progress()).is_err());
            assert!(!output.exists());
            let mut bytes = fs::read(&ciphertext).unwrap();
            bytes[0] ^= 1;
            fs::write(&ciphertext, bytes).unwrap();
            assert!(
                decrypt_file(&metadata, &ciphertext, &output, "password", &progress()).is_err()
            );
            assert!(!output.exists());
        }
        let payload=serde_json::json!({"kind":"kanqual-project-backup","version":1,"payload":{"format":"kanqual-project-export","version":1,"project":{"name":"Encrypted"},"tables":[],"assets":[]}}).to_string();
        fs::write(
            &path,
            encrypt_backup_payload_text(payload, "password".into()).unwrap(),
        )
        .unwrap();
        assert!(prepare(&path, None, &progress()).unwrap().is_none());
        assert_eq!(
            prepare(&path, Some(Zeroizing::new("password".into())), &progress())
                .unwrap()
                .unwrap()
                .project["name"],
            "Encrypted"
        );
    }

    #[test]
    fn rejects_cancelled_imports_and_duplicate_or_trailing_json() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("input.json");
        let payload = r#"{"format":"kanqual-project-export","version":1,"project":{},"tables":[],"assets":[]}"#;
        fs::write(&path, payload).unwrap();
        let job = progress();
        job.cancelled.store(true, Ordering::Relaxed);
        assert!(prepare(&path, None, &job).is_err());
        for text in [format!("{payload}x"),payload.replace("\"version\":1","\"version\":1,\"version\":1"),payload.replace("\"assets\":[]","\"assets\":[{\"collection\":\"project_storage_files\",\"fileName\":\"../escape\",\"dataBase64\":\"AAAA\"}]")] {
            fs::write(&path,text).unwrap();assert!(prepare(&path,None,&progress()).is_err());
        }
    }

    #[test]
    #[ignore = "Generated by npm run test:project-import"]
    fn generated_fixtures() {
        let root = PathBuf::from(std::env::var("KANQUAL_IMPORT_FIXTURES").unwrap());
        for name in ["plain.json", "wrapped.json", "native.qdpx"] {
            let stage = prepare(&root.join(name), None, &progress())
                .unwrap()
                .unwrap();
            assert_eq!(stage.project["name"], "Round trip");
            assert_eq!(
                fs::read(&stage.assets["sources/file.bin"]).unwrap(),
                [0, 1, 2, 3, 4]
            );
            assert_eq!(table(&stage, "sources")[0]["waveform_peaks_json"], "[1,2]");
        }
        let stage = prepare(&root.join("standard.qdpx"), None, &progress())
            .unwrap()
            .unwrap();
        assert_eq!(table(&stage, "codes")[1]["parent_code_id"], "c");
        assert_eq!(table(&stage, "annotations")[0]["quote"], "😀");
        assert_eq!(table(&stage, "annotations")[0]["end_offset"], 3);
        assert_eq!(table(&stage, "annotations")[1]["time_start_ms"], 1000);
        assert_eq!(table(&stage, "object_attribute_values")[0]["value"], "42");
        assert_eq!(table(&stage, "memos")[0]["created_by_project_user_id"], "u");
        let stage = prepare(&root.join("picture.qdpx"), None, &progress())
            .unwrap()
            .unwrap();
        assert_eq!(table(&stage, "annotations")[2]["anchor_kind"], "image_rect");
        let stage = prepare(&root.join("olderExport.qdpx"), None, &progress())
            .unwrap()
            .unwrap();
        assert_eq!(
            table(&stage, "sources")[0]["storage_path"],
            "sources/file.bin"
        );
        assert_eq!(
            table(&stage, "source_files")[0]["source_id"],
            table(&stage, "sources")[0]["id"]
        );
        assert!(!stage.warnings.is_empty());
        let stage = prepare(&root.join("external.qdpx"), None, &progress())
            .unwrap()
            .unwrap();
        assert!(!stage.warnings.is_empty());
        let stage = prepare(&root.join("legacyKanqual.qdpx"), None, &progress())
            .unwrap()
            .unwrap();
        assert_eq!(table(&stage, "annotations")[0]["quote"], "😀");
        for name in [
            "missing.qdpx",
            "malformed.qdpx",
            "doctype.qdpx",
            "traversal.qdpx",
            "duplicate.qdpx",
            "corrupt.qdpx",
            "invalid-version.json",
            "duplicate-tables.json",
        ] {
            assert!(
                prepare(&root.join(name), None, &progress()).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    #[ignore = "Large file regression: run npm run test:project-import-large"]
    fn attachment_larger_than_old_limit_uses_bounded_memory() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.json");
        let size = 513u64 * 1024 * 1024;
        let encoded = size / 3 * 4;
        let mut file = BufWriter::new(fs::File::create(&path).unwrap());
        file.write_all(br#"{"format":"kanqual-project-export","version":1,"project":{"name":"Large"},"tables":[],"assets":[{"collection":"project_storage_files","fileName":"large.bin","dataBase64":""#).unwrap();
        std::io::copy(&mut std::io::repeat(b'A').take(encoded), &mut file).unwrap();
        file.write_all(br#""}]}"#).unwrap();
        file.flush().unwrap();
        drop(file);
        let stage = prepare(&path, None, &progress()).unwrap().unwrap();
        assert_eq!(
            fs::metadata(&stage.assets["large.bin"]).unwrap().len(),
            size
        );
        #[cfg(windows)]
        {
            #[repr(C)]
            struct Counters {
                cb: u32,
                faults: u32,
                peak: usize,
                working: usize,
                paged_peak: usize,
                paged: usize,
                nonpaged_peak: usize,
                nonpaged: usize,
                pagefile: usize,
                pagefile_peak: usize,
            }
            #[link(name = "psapi")]
            extern "system" {
                fn GetProcessMemoryInfo(process: isize, counters: *mut Counters, size: u32) -> i32;
            }
            let mut counters: Counters = unsafe { std::mem::zeroed() };
            counters.cb = std::mem::size_of::<Counters>() as u32;
            assert_ne!(
                unsafe {
                    GetProcessMemoryInfo(-1, &mut counters, std::mem::size_of::<Counters>() as u32)
                },
                0
            );
            println!("513 MiB attachment imported from a {} MiB JSON file; peak process working set: {:.1} MiB",fs::metadata(&path).unwrap().len()/1024/1024,counters.peak as f64/1024.0/1024.0);
            assert!(
                counters.peak < 192 * 1024 * 1024,
                "Attachment bytes must not be buffered in memory"
            );
        }
    }
}
