use super::*;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct AnnotationPageRequest {
    code_id: String,
    query: String,
    sort: String,
    descending: bool,
    offset: i64,
    annotation_id: Option<String>,
    current_user_id: String,
    lock_labels: Vec<String>,
    source_kind_labels: std::collections::HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AnnotationPage {
    annotations: Vec<PostgresExperimentAnnotationSummary>,
    selected: Option<PostgresExperimentAnnotationSummary>,
    counts: std::collections::HashMap<String, i64>,
    total: i64,
    offset: i64,
}

// The primary code follows the same ordering as annotation details and exports.
const FROM_SQL: &str = "FROM annotations a
LEFT JOIN sources s ON s.id = a.source_id
LEFT JOIN LATERAL (SELECT c.id, c.label FROM annotation_codes ac
    JOIN codes c ON c.id = ac.code_id WHERE ac.annotation_id = a.id
    ORDER BY c.sort_order, c.created_at, c.id LIMIT 1) pc ON TRUE
LEFT JOIN project_users pu ON pu.id = a.created_by_project_user_id";

async fn annotation_page(
    client: &tokio_postgres::Client,
    project_id: &str,
    request: &AnnotationPageRequest,
) -> Result<AnnotationPage, String> {
    client
        .batch_execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        let search = "($1 = '' OR strpos(lower(concat_ws(' ', s.title, a.quote, pc.label, pu.name)), lower($1)) > 0)";
        let count_rows = client.query(&format!("SELECT COALESCE(pc.id, ''), count(*) {FROM_SQL} WHERE {search} GROUP BY pc.id"), &[&request.query]).await.map_err(|e| e.to_string())?;
        let counts: std::collections::HashMap<String, i64> = count_rows.iter().map(|r| (r.get(0), r.get(1))).collect();
        let total = if request.code_id.is_empty() { counts.values().sum() } else { *counts.get(&request.code_id).unwrap_or(&0) };
        let offset = (request.offset.max(0) / 50 * 50).min((total - 1).max(0) / 50 * 50);
        let sort = match request.sort.as_str() {
            "sourceKind" => "lower(COALESCE(params.kind_labels ->> lower(replace(trim(COALESCE(NULLIF(a.source_kind, ''), s.source_kind, '')), '_', ' ')), COALESCE(NULLIF(a.source_kind, ''), s.source_kind, '')))",
            "codeLabel" => "lower(COALESCE(pc.label, ''))",
            "lockLabel" => "lower(COALESCE((SELECT CASE WHEN l.user_id = params.current_user_id THEN params.lock_labels[2] ELSE params.lock_labels[3] END FROM source_locks l WHERE l.source_id = a.source_id AND l.expires_at_ms > params.now_ms ORDER BY l.id LIMIT 1), params.lock_labels[1]))",
            "createdAt" => "a.created_at",
            "createdByName" => "lower(COALESCE(pu.name, ''))",
            _ => "lower(COALESCE(s.title, ''))",
        };
        let direction = if request.descending { "DESC" } else { "ASC" };
        let search = search.replace("$1", "$7");
        let sql = format!("WITH params AS (SELECT $3::bigint AS now_ms, $4::text AS current_user_id, $5::text[] AS lock_labels, $6::text::jsonb AS kind_labels) SELECT a.id {FROM_SQL} CROSS JOIN params WHERE ($1 = '' OR pc.id = $1) AND {search} ORDER BY {sort} {direction}, a.id ASC LIMIT 50 OFFSET $2");
        let kind_labels = serde_json::to_string(&request.source_kind_labels).map_err(|e| e.to_string())?;
        let now = current_time_ms() as i64;
        let ids: Vec<String> = client.query(&sql, &[&request.code_id, &offset, &now, &request.current_user_id, &request.lock_labels, &kind_labels, &request.query]).await.map_err(|e| e.to_string())?.iter().map(|r| r.get(0)).collect();
        let mut annotations = load_filtered_annotation_summaries(client, project_id, None, Some(&ids)).await?;
        let positions: std::collections::HashMap<_, _> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        annotations.sort_by_key(|a| positions[a.id.as_str()]);
        let selected = if let Some(id) = &request.annotation_id {
            load_filtered_annotation_summaries(client, project_id, None, Some(&vec![id.clone()])).await?.into_iter().next()
        } else { None };
        Ok(AnnotationPage { annotations, selected, counts, total, offset })
    }.await;
    client
        .batch_execute(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
        .await
        .map_err(|e| e.to_string())?;
    result
}

#[tauri::command]
pub(super) async fn list_annotation_page_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    request: AnnotationPageRequest,
) -> Result<AnnotationPage, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = annotation_page(&client, &project_id, &request).await;
    task.abort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Requires disposable PostgreSQL; run scripts/test-annotation-pages.mjs"]
    fn annotation_pages_database_regression() {
        let url = std::env::var("KANQUAL_ANNOTATION_TEST_URL").unwrap();
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
                database, "kanqual_annotation_page_test",
                "Never run against an application database"
            );
            let source = include_str!("lib.rs").replace("\r\n", "\n");
            let schema = &source[source
                .find("async fn ensure_postgres_experiment_project_schema(")
                .unwrap()..];
            let schema = &schema[schema
                .find("CREATE TABLE IF NOT EXISTS app_schema_migrations (")
                .unwrap()..];
            client
                .batch_execute(&schema[..schema.find("\",\n").unwrap()].replace("\\\"", "\""))
                .await
                .unwrap();
            client.batch_execute("INSERT INTO sources(id,title,source_kind) VALUES ('s','Transcript','text'); INSERT INTO codes(id,label,sort_order) VALUES ('c1','First',0),('c2','Second',1);
                INSERT INTO annotations(id,source_id,quote,start_offset,end_offset) SELECT 'a' || lpad(i::text,4,'0'),'s','quoted text',3,14 FROM generate_series(1,123) i;
                INSERT INTO annotation_codes(annotation_id,code_id) SELECT id,CASE WHEN id <= 'a0060' THEN 'c1' ELSE 'c2' END FROM annotations;").await.unwrap();
            let code_counts = crate::codebook_queries::code_source_counts(&client).await.unwrap();
            assert_eq!(code_counts["c1"], 1); // Sixty annotations in the same source count once.
            assert_eq!(code_counts["c2"], 1);
            let details = crate::codebook_queries::code_annotations(&client, "project", "c2").await.unwrap();
            assert_eq!(details.len(), 63);
            assert!(details.iter().all(|a| a.code_ids.contains(&"c2".to_string())));
            assert!(crate::codebook_queries::code_annotations(&client, "project", "missing").await.unwrap().is_empty());
            let mut request = AnnotationPageRequest {
                sort: "documentName".into(),
                lock_labels: vec!["Available".into(), "You".into(), "Locked".into()],
                ..Default::default()
            };
            let mut seen = std::collections::HashSet::new();
            for offset in [0, 50, 100] {
                request.offset = offset;
                let page = annotation_page(&client, "project", &request).await.unwrap();
                assert_eq!(page.total, 123);
                assert_eq!(page.counts["c1"], 60);
                assert_eq!(page.counts["c2"], 63);
                assert_eq!(page.annotations.len(), if offset == 100 { 23 } else { 50 });
                for row in page.annotations {
                    assert!(seen.insert(row.id));
                    assert_eq!(row.quote, "quoted text");
                    assert_eq!(row.start_offset, Some(3));
                }
            }
            assert_eq!(seen.len(), 123);
            client.execute("UPDATE annotations SET quote='Unique search target' WHERE id='a0123'", &[]).await.unwrap();
            request.query = "SEARCH TARGET".into();
            let page = annotation_page(&client, "project", &request).await.unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.offset, 0);
            assert_eq!(page.annotations[0].id, "a0123");
            request.code_id = "c1".into();
            assert_eq!(annotation_page(&client, "project", &request).await.unwrap().total, 0);
            request.code_id.clear();
            request.query = "%_'".into();
            assert_eq!(annotation_page(&client, "project", &request).await.unwrap().total, 0);
            request.query.clear();

            request.offset = 0;
            request.code_id = "c1".into();
            request.annotation_id = Some("a0123".into());
            let page = annotation_page(&client, "project", &request).await.unwrap();
            assert_eq!(page.total, 60);
            assert_eq!(page.selected.unwrap().id, "a0123");
            // Multiple codes must neither duplicate annotations nor change primary-code counts.
            client
                .batch_execute(
                    "INSERT INTO annotation_codes(annotation_id,code_id) VALUES ('a0001','c2')",
                )
                .await
                .unwrap();
            assert_eq!(
                annotation_page(&client, "project", &request)
                    .await
                    .unwrap()
                    .counts["c2"],
                63
            );
            request.code_id.clear();
            request.annotation_id = None;
            for sort in [
                "sourceKind",
                "codeLabel",
                "lockLabel",
                "createdAt",
                "createdByName",
                "invalid SQL",
            ] {
                request.sort = sort.into();
                request.descending = true;
                assert_eq!(
                    annotation_page(&client, "project", &request)
                        .await
                        .unwrap()
                        .annotations
                        .len(),
                    50
                );
            }
            request.sort = "codeLabel".into();
            assert_eq!(
                annotation_page(&client, "project", &request)
                    .await
                    .unwrap()
                    .annotations[0]
                    .primary_code_id,
                "c2"
            );
            request.offset = 100;
            client
                .batch_execute("DELETE FROM annotations WHERE id > 'a0050'")
                .await
                .unwrap();
            let page = annotation_page(&client, "project", &request).await.unwrap();
            assert_eq!(page.offset, 0);
            assert_eq!(page.total, 50);
            request.code_id = "missing".into();
            let empty = annotation_page(&client, "project", &request).await.unwrap();
            assert_eq!(empty.total, 0);
            assert_eq!(empty.offset, 0);
            assert!(empty.annotations.is_empty());
            println!("Annotation pagination: coverage, global counts, primary codes, sorts, offsets, deep links, deletions, and empty results passed");
            task.abort();
        });
    }
}
