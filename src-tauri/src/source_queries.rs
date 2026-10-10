use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceSummary {
    id: String,
    project_id: String,
    source_kind: String,
    title: String,
    original_file_name: String,
    storage_path: String,
    extracted_from_video_source_id: String,
    extracted_from_video_time_ms: Option<i64>,
    notes: String,
    shape_override: String,
    color_override: String,
    outline_color_override: String,
    fill_override: String,
    fill_transparency_override: Option<i32>,
    outline_width_override: Option<i32>,
    image_storage_path: String,
    created_at: String,
    updated_at: String,
    has_text_content: bool,
    has_structured_content: bool,
}

const SUMMARY_QUERY: &str = "SELECT id, source_kind, title, original_file_name, storage_path, extracted_from_video_source_id, extracted_from_video_time_ms, notes, shape_override, color_override, outline_color_override, fill_override, fill_transparency_override, outline_width_override, image_storage_path, created_at::text, updated_at::text, octet_length(text_content) > 0 AS has_text_content, octet_length(structured_content_json) > 2 AS has_structured_content FROM sources ORDER BY created_at ASC, id ASC";

pub(super) async fn summaries(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<SourceSummary>, String> {
    let rows = client
        .query(SUMMARY_QUERY, &[])
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| map_summary(&row, project_id))
        .collect())
}

fn map_summary(row: &tokio_postgres::Row, project_id: &str) -> SourceSummary {
    SourceSummary {
        id: row.get(0),
        project_id: project_id.to_string(),
        source_kind: row.get(1),
        title: row.get(2),
        original_file_name: row.get(3),
        storage_path: row.get(4),
        extracted_from_video_source_id: row.get(5),
        extracted_from_video_time_ms: row.get(6),
        notes: row.get(7),
        shape_override: row.get::<_, Option<String>>(8).unwrap_or_default(),
        color_override: row.get::<_, Option<String>>(9).unwrap_or_default(),
        outline_color_override: row.get::<_, Option<String>>(10).unwrap_or_default(),
        fill_override: row.get::<_, Option<String>>(11).unwrap_or_default(),
        fill_transparency_override: row.get(12),
        outline_width_override: row.get(13),
        image_storage_path: row.get::<_, Option<String>>(14).unwrap_or_default(),
        created_at: row.get(15),
        updated_at: row.get(16),
        has_text_content: row.get(17),
        has_structured_content: row.get(18),
    }
}

#[tauri::command]
pub(super) async fn list_source_summaries_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    source_ids: Option<Vec<String>>,
) -> Result<Vec<SourceSummary>, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = if let Some(ids) = source_ids {
        client
            .query(
                &SUMMARY_QUERY.replace(
                    "FROM sources ORDER BY",
                    "FROM sources WHERE id = ANY($1) ORDER BY",
                ),
                &[&ids],
            )
            .await
            .map(|rows| {
                rows.iter()
                    .map(|row| map_summary(row, &project_id))
                    .collect()
            })
            .map_err(|e| e.to_string())
    } else {
        summaries(&client, &project_id).await
    };
    task.abort();
    result
}

#[tauri::command]
pub(super) async fn get_source_details_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    source_id: String,
) -> Result<PostgresExperimentSource, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await;
    task.abort();
    result
}

const SEARCH_QUERY: &str = "SELECT id FROM sources WHERE strpos(lower(title), lower($1)) > 0 OR strpos(lower(notes), lower($1)) > 0 OR strpos(lower(text_content), lower($1)) > 0 ORDER BY created_at, id";

#[tauri::command]
pub(super) async fn search_source_ids_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = client
        .query(SEARCH_QUERY, &[&query])
        .await
        .map(|rows| rows.into_iter().map(|row| row.get(0)).collect())
        .map_err(|e| e.to_string());
    task.abort();
    result
}

#[tauri::command]
pub(super) async fn get_source_list_entry_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    source_id: String,
) -> Result<CountedSourceSummary, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let columns = SUMMARY_QUERY
        .strip_prefix("SELECT ")
        .unwrap()
        .split(" FROM sources")
        .next()
        .unwrap();
    let result = client.query_one(&format!("SELECT {columns}, (SELECT count(*) FROM annotations WHERE source_id = sources.id), (SELECT count(*) FROM source_objects WHERE source_id = sources.id) FROM sources WHERE id = $1"), &[&source_id]).await.map(|row| CountedSourceSummary { source: map_summary(&row, &project_id), annotation_count: row.get(19), object_count: row.get(20) }).map_err(|e| e.to_string());
    task.abort();
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourcePageRequest {
    query: String,
    kinds: Vec<String>,
    kind: String,
    sort: String,
    descending: bool,
    offset: i64,
    // The attribute matrix deliberately edits the complete filtered set.
    all: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CountedSourceSummary {
    #[serde(flatten)]
    source: SourceSummary,
    annotation_count: i64,
    object_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceKindCount {
    source_kind: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourcePage {
    sources: Vec<CountedSourceSummary>,
    kinds: Vec<SourceKindCount>,
    total: i64,
    offset: i64,
    storage_path: String,
}

// Match the UI's canonical source kinds, including legacy transcript spelling.
const KIND_SQL: &str = "CASE WHEN replace(regexp_replace(lower(trim(source_kind)), '^source_', ''), '_', ' ') = 'processed transcript' THEN 'transcript' ELSE replace(regexp_replace(lower(trim(source_kind)), '^source_', ''), '_', ' ') END";

async fn source_page(
    client: &tokio_postgres::Client,
    project_id: &str,
    storage_path: &str,
    request: &SourcePageRequest,
) -> Result<SourcePage, String> {
    let predicate = format!("(cardinality($1::text[]) = 0 OR ({KIND_SQL}) = ANY($1)) AND ($2 = '' OR strpos(lower(title), lower($2)) > 0 OR strpos(lower(notes), lower($2)) > 0 OR strpos(lower(text_content), lower($2)) > 0)");
    // Counts and rows share a snapshot, even when another user edits the project.
    client
        .batch_execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        let kind_rows = client.query(&format!("SELECT ({KIND_SQL}) AS kind, count(*) FROM sources WHERE {predicate} GROUP BY kind"), &[&request.kinds, &request.query]).await.map_err(|e| e.to_string())?;
        let kinds: Vec<SourceKindCount> = kind_rows.iter().map(|row| SourceKindCount { source_kind: row.get(0), count: row.get(1) }).collect();
        let total = kinds.iter().filter(|item| request.kind.is_empty() || item.source_kind == request.kind).map(|item| item.count).sum::<i64>();
        let offset = if request.all { 0 } else { request.offset.max(0).min(((total - 1).max(0) / 50) * 50) };
        let limit = if request.all { None } else { Some(50_i64) };
        let sort = match request.sort.as_str() {
            "annotations" => "annotation_count",
            "objects" => "object_count",
            "createdAt" => "sources.created_at",
            _ => "lower(title)",
        };
        let direction = if request.descending { "DESC" } else { "ASC" };
        let columns = SUMMARY_QUERY.strip_prefix("SELECT ").unwrap().split(" FROM sources").next().unwrap();
        // Correlated counts avoid multiplying annotation and object-link rows.
        let sql = format!("SELECT {columns}, (SELECT count(*) FROM annotations a WHERE a.source_id = sources.id) AS annotation_count, (SELECT count(*) FROM source_objects o WHERE o.source_id = sources.id) AS object_count FROM sources WHERE {predicate} AND ($3 = '' OR ({KIND_SQL}) = $3) ORDER BY {sort} {direction}, id ASC LIMIT $4 OFFSET $5");
        let rows = client.query(&sql, &[&request.kinds, &request.query, &request.kind, &limit, &offset]).await.map_err(|e| e.to_string())?;
        Ok(SourcePage { sources: rows.iter().map(|row| CountedSourceSummary { source: map_summary(row, project_id), annotation_count: row.get(19), object_count: row.get(20) }).collect(), kinds, total, offset, storage_path: storage_path.to_string() })
    }.await;
    let finish = client
        .batch_execute(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
        .await
        .map_err(|e| e.to_string());
    finish?;
    result
}

#[tauri::command]
pub(super) async fn list_source_page_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    request: SourcePageRequest,
) -> Result<SourcePage, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = source_page(&client, &project_id, &project.storage_path, &request).await;
    task.abort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak_memory_bytes() -> Option<usize> {
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
            return Some(counters.peak);
        }
        #[cfg(not(windows))]
        None
    }

    #[test]
    #[ignore = "Run scripts/test-source-summaries.mjs against a disposable PostgreSQL database"]
    fn source_summary_database_regression() {
        let url = std::env::var("KANQUAL_SOURCE_TEST_URL").unwrap();
        let root = PathBuf::from(std::env::var("KANQUAL_SOURCE_TEST_ROOT").unwrap());
        let mode = std::env::var("KANQUAL_SOURCE_TEST_MODE").unwrap();
        tauri::async_runtime::block_on(async {
            let (client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
            let task = tauri::async_runtime::spawn(async move {
                connection.await.unwrap();
            });
            let database: String = client
                .query_one("SELECT current_database()", &[])
                .await
                .unwrap()
                .get(0);
            assert_eq!(
                database, "kanqual_source_summary_test",
                "Never run against an application database"
            );
            if mode == "setup" {
                let source = include_str!("lib.rs").replace("\r\n", "\n");
                let schema = &source[source
                    .find("async fn ensure_postgres_experiment_project_schema(")
                    .unwrap()..];
                let schema = &schema[schema
                    .find("CREATE TABLE IF NOT EXISTS app_schema_migrations (")
                    .unwrap()..];
                let schema = &schema[..schema.find("\",\n").unwrap()];
                client
                    .batch_execute(&schema.replace("\\\"", "\""))
                    .await
                    .unwrap();
                let line = "  Interview: Café e\u{301} 😀\r\nمرحبا — literal %_needle and <tags>. Speaker: preserve whitespace.\n";
                let text = format!("{line}{}\nEND — 😀", line.repeat(2500));
                let structured = serde_json::json!({"version":1,"segments":[{"sortOrder":1,"speaker":"Participant","text":text}]}).to_string();
                for index in 0..256 {
                    let id = format!("source-{index:04}");
                    client.execute("INSERT INTO sources (id, source_kind, title, text_content, structured_content_json, notes) VALUES ($1, 'transcript', $2, $3, $4, $5)", &[&id, &format!("Interview {index}"), &text, &structured, &format!("Metadata {index}")]).await.unwrap();
                }
                client.execute("INSERT INTO sources (id, source_kind, title, waveform_peaks_json, video_frame_index_json) VALUES ('media', 'video', 'Video', $1, $2)", &[&"{\"peaks\":[[0.1,-0.2]],\"durationSeconds\":7}", &"{\"timestampsSeconds\":[0,0.04,0.08]}"]).await.unwrap();
                client
                    .execute("INSERT INTO codes (id,label) VALUES ('code','Code')", &[])
                    .await
                    .unwrap();
                let start = text.find('😀').unwrap();
                let start_utf16 = text[..start].encode_utf16().count() as i32;
                let quote = "😀\r\nمرحبا";
                let end_utf16 = start_utf16 + quote.encode_utf16().count() as i32;
                client.execute("INSERT INTO annotations (id, source_id, start_offset, end_offset, quote) VALUES ('annotation','source-0000',$1,$2,$3)", &[&start_utf16, &end_utf16, &quote]).await.unwrap();
                fs::write(root.join("expected.json"), serde_json::to_vec(&serde_json::json!({"text":text,"structured":structured,"start":start_utf16,"end":end_utf16,"quote":quote})).unwrap()).unwrap();
                client.batch_execute("ANALYZE sources").await.unwrap();
            } else if mode == "image-verify" {
                let storage = root.join("image-storage");
                fs::create_dir_all(&storage).unwrap();
                let original = storage.join("registered.jpg");
                fs::write(&original, b"fixture").unwrap();
                let missing = storage.join("unregistered.jpg");
                fs::write(&missing, b"fixture").unwrap();
                let outside = root.join("outside.jpg");
                fs::write(&outside, b"fixture").unwrap();
                client.execute("INSERT INTO sources(id,source_kind,title,storage_path) VALUES ('image-registration','image','Image',$1)", &[&"registered.jpg"]).await.unwrap();
                assert!(crate::media_stream::registered_image(
                    &client,
                    &storage,
                    &original.canonicalize().unwrap()
                )
                .await
                .unwrap());
                assert!(!crate::media_stream::registered_image(
                    &client,
                    &storage,
                    &missing.canonicalize().unwrap()
                )
                .await
                .unwrap());
                assert!(crate::media_stream::registered_image(
                    &client,
                    &storage,
                    &outside.canonicalize().unwrap()
                )
                .await
                .is_err());
                client
                    .execute(
                        "UPDATE sources SET storage_path=$1 WHERE id='image-registration'",
                        &[&original.to_string_lossy().to_string()],
                    )
                    .await
                    .unwrap();
                assert!(crate::media_stream::registered_image(
                    &client,
                    &storage,
                    &original.canonicalize().unwrap()
                )
                .await
                .unwrap());
                client
                    .batch_execute("DELETE FROM sources WHERE id='image-registration'")
                    .await
                    .unwrap();
                assert!(!crate::media_stream::registered_image(
                    &client,
                    &storage,
                    &original.canonicalize().unwrap()
                )
                .await
                .unwrap());
                println!("Registered relative/absolute assets, deleted assets, unregistered files, and storage containment passed");
            } else if mode == "page-verify" {
                let mut request = SourcePageRequest {
                    query: String::new(),
                    kinds: vec![],
                    kind: String::new(),
                    sort: "name".into(),
                    descending: false,
                    offset: 0,
                    all: false,
                };
                let first = source_page(&client, "project", "storage", &request)
                    .await
                    .unwrap();
                assert_eq!(first.total, 257);
                assert_eq!(first.sources.len(), 50);
                assert_eq!(first.kinds.iter().map(|kind| kind.count).sum::<i64>(), 257);
                let mut seen = HashSet::new();
                for offset in (0..257).step_by(50) {
                    request.offset = offset;
                    let page = source_page(&client, "project", "storage", &request)
                        .await
                        .unwrap();
                    assert_eq!(page.total, 257);
                    for entry in page.sources {
                        assert!(seen.insert(entry.source.id));
                    }
                }
                assert_eq!(seen.len(), 257);
                request.offset = 0;
                request.query = "%_needle".into();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    256
                );
                request.query = "Metadata 255".into();
                let matched = source_page(&client, "project", "", &request).await.unwrap();
                assert_eq!(matched.sources[0].source.id, "source-0255");
                assert_eq!(matched.total, 1);
                request.query = "absent needle".into();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    0
                );
                request.query.clear();
                request.kinds = vec!["video".into()];
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    1
                );
                request.kind = "transcript".into();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    0
                );
                request.kinds.clear();
                request.kind.clear();
                request.all = true;
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .sources
                        .len(),
                    257
                );
                request.all = false;
                // Multiple codes and object links must not multiply annotation counts.
                client.batch_execute("INSERT INTO codes (id,label) VALUES ('other-code','Other'); INSERT INTO annotation_codes(annotation_id,code_id) VALUES ('annotation','code'),('annotation','other-code'); INSERT INTO research_objects(id,object_type,title) VALUES ('object-a','case','A'),('object-b','case','B'); INSERT INTO source_objects(source_id,object_id) VALUES ('source-0000','object-a'),('source-0000','object-b');").await.unwrap();
                request.sort = "annotations".into();
                request.descending = true;
                let counted = source_page(&client, "project", "", &request).await.unwrap();
                assert_eq!(counted.sources[0].source.id, "source-0000");
                assert_eq!(counted.sources[0].annotation_count, 1);
                assert_eq!(counted.sources[0].object_count, 2);
                request.sort = "objects".into();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .sources[0]
                        .source
                        .id,
                    "source-0000"
                );
                let annotations =
                    load_source_annotation_summaries(&client, "project", Some("source-0000"))
                        .await
                        .unwrap();
                assert_eq!(annotations.len(), 1);
                assert_eq!(annotations[0].code_ids.len(), 2);
                assert!(
                    load_source_annotation_summaries(&client, "project", Some("source-0001"))
                        .await
                        .unwrap()
                        .is_empty()
                );
                client.batch_execute("INSERT INTO sources(id,source_kind,title) VALUES ('page-temp','processed_transcript','ZZZ');").await.unwrap();
                request.kind = "transcript".into();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    257
                );
                client
                    .batch_execute(
                        "UPDATE sources SET source_kind='image',title='AAA' WHERE id='page-temp';",
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .total,
                    256
                );
                request.kind = "image".into();
                request.offset = 500;
                let last = source_page(&client, "project", "", &request).await.unwrap();
                assert_eq!(last.offset, 0);
                assert_eq!(last.total, 1);
                client.batch_execute("DELETE FROM sources WHERE id='page-temp'; DELETE FROM research_objects WHERE id IN ('object-a','object-b'); DELETE FROM annotation_codes WHERE annotation_id='annotation'; DELETE FROM codes WHERE id='other-code';").await.unwrap();
                let empty = source_page(&client, "project", "", &request).await.unwrap();
                assert_eq!(empty.total, 0);
                assert_eq!(empty.offset, 0);
                assert!(empty.sources.is_empty());
                request.kind.clear();
                request.sort = "createdAt".into();
                request.offset = 10000;
                assert_eq!(
                    source_page(&client, "project", "", &request)
                        .await
                        .unwrap()
                        .offset,
                    250
                );
                println!("Page coverage, canonical kinds, literal/full-text search, counts, tie ordering, scoped annotations, bulk scope, and mutation checks passed");
            } else if mode == "verify" {
                let rows = summaries(&client, "project").await.unwrap();
                assert_eq!(rows.len(), 257);
                let json = serde_json::to_value(&rows).unwrap();
                for row in json.as_array().unwrap() {
                    for field in [
                        "textContent",
                        "structuredContentJson",
                        "waveformPeaksJson",
                        "videoFrameIndexJson",
                    ] {
                        assert!(row.get(field).is_none());
                    }
                }
                let detail =
                    load_postgres_experiment_source_for_client(&client, "project", "source-0000")
                        .await
                        .unwrap();
                let expected: serde_json::Value =
                    serde_json::from_slice(&fs::read(root.join("expected.json")).unwrap()).unwrap();
                assert_eq!(detail.text_content, expected["text"].as_str().unwrap());
                assert_eq!(
                    detail.structured_content_json,
                    expected["structured"].as_str().unwrap()
                );
                let annotation = client.query_one("SELECT start_offset,end_offset,quote FROM annotations WHERE id='annotation'", &[]).await.unwrap();
                let start: i32 = annotation.get(0);
                let end: i32 = annotation.get(1);
                let quote: String = annotation.get(2);
                let units: Vec<u16> = detail.text_content.encode_utf16().collect();
                assert_eq!(
                    String::from_utf16(&units[start as usize..end as usize]).unwrap(),
                    quote
                );
                let matched = client.query(SEARCH_QUERY, &[&"%_needle"]).await.unwrap();
                assert_eq!(
                    matched.len(),
                    256,
                    "Search must treat percent/underscore literally"
                );
                assert!(client
                    .query(SEARCH_QUERY, &[&"not-present"])
                    .await
                    .unwrap()
                    .is_empty());
                let media = load_postgres_experiment_source_for_client(&client, "project", "media")
                    .await
                    .unwrap();
                assert!(media.waveform_peaks_json.contains("-0.2"));
                assert!(media.video_frame_index_json.contains("0.04"));
                assert!(
                    load_postgres_experiment_source_for_client(&client, "project", "missing")
                        .await
                        .is_err()
                );
                fs::write(
                    root.join("detail.json"),
                    serde_json::to_vec(&detail).unwrap(),
                )
                .unwrap();
            } else {
                // Separate processes make the peak-memory comparison meaningful.
                let before = peak_memory_bytes();
                let start = std::time::Instant::now();
                let (payload, query_ms) = if mode == "full" {
                    let rows = load_postgres_experiment_sources_for_client(&client, "project")
                        .await
                        .unwrap();
                    let query_ms = start.elapsed().as_secs_f64() * 1000.0;
                    (serde_json::to_vec(&rows).unwrap(), query_ms)
                } else if mode == "page" {
                    let request = SourcePageRequest {
                        query: String::new(),
                        kinds: vec![],
                        kind: String::new(),
                        sort: "name".into(),
                        descending: false,
                        offset: 0,
                        all: false,
                    };
                    let page = source_page(&client, "project", "storage", &request)
                        .await
                        .unwrap();
                    let query_ms = start.elapsed().as_secs_f64() * 1000.0;
                    (serde_json::to_vec(&page).unwrap(), query_ms)
                } else {
                    assert_eq!(mode, "summary");
                    let rows = summaries(&client, "project").await.unwrap();
                    let query_ms = start.elapsed().as_secs_f64() * 1000.0;
                    (serde_json::to_vec(&rows).unwrap(), query_ms)
                };
                let metrics = serde_json::json!({"mode":mode,"sources":257,"payloadBytes":payload.len(),"queryMs":query_ms,"queryAndSerializationMs":start.elapsed().as_secs_f64()*1000.0,"baselinePeakBytes":before,"peakBytes":peak_memory_bytes()});
                fs::write(root.join(format!("{mode}.json")), &payload).unwrap();
                fs::write(
                    root.join(format!("{mode}.metrics.json")),
                    serde_json::to_vec_pretty(&metrics).unwrap(),
                )
                .unwrap();
                println!("{metrics}");
            }
            task.abort();
        });
    }
}
