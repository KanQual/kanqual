use super::*;

#[derive(Serialize)]
pub(super) struct ProjectListCounts { memos: i64, reports: i64 }

#[tauri::command]
pub(super) async fn get_project_list_counts_command(app: tauri::AppHandle, runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>, project_id: String) -> Result<ProjectListCounts, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = client.query_one("SELECT (SELECT count(*) FROM memos), (SELECT count(*) FROM reports)", &[]).await.map(|row| ProjectListCounts { memos: row.get(0), reports: row.get(1) }).map_err(|e| e.to_string());
    task.abort(); result
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct TablePageRequest {
    entity: String,
    query: String,
    kind: String,
    report_type: String,
    sort: String,
    descending: bool,
    kind_labels: std::collections::HashMap<String, String>,
    offset: i64,
    selected_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TablePage {
    rows: Vec<serde_json::Value>,
    selected: Option<serde_json::Value>,
    total: i64,
    offset: i64,
    counts: std::collections::HashMap<String, i64>,
}

// Imported reports may contain malformed JSON: listing them must not abort the
// entire project. Keep unknown kinds in All, as the existing report list does.
const REPORT_SCOPE: &str = "SELECT r.*, CASE
 WHEN lower(trim(report_type)) IN ('annotation','annotations') THEN 'annotations'
 WHEN lower(trim(report_type)) IN ('code','code-report') THEN CASE WHEN snapshot->>'kind' = 'summary' THEN 'code-co-occurrences' ELSE 'code-frequencies' END
 WHEN lower(trim(report_type)) IN ('user','coder','coder-report') THEN CASE snapshot->>'kind' WHEN 'comparison' THEN 'user-comparison' WHEN 'agreement' THEN 'user-agreement' ELSE 'user-activity' END
 ELSE '' END AS kind, snapshot->>'reportType' AS snapshot_type
 FROM reports r CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(r.content_json, 'jsonb') THEN r.content_json::jsonb ELSE '{}'::jsonb END AS snapshot) j";

async fn table_page(
    client: &tokio_postgres::Client,
    project_id: &str,
    request: &TablePageRequest,
) -> Result<TablePage, String> {
    let is_report = match request.entity.as_str() {
        "reports" => true,
        "memos" => false,
        _ => return Err("Unsupported table.".into()),
    };
    client
        .batch_execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        let scope = if is_report { REPORT_SCOPE } else { "SELECT m.*, ''::text AS kind, ''::text AS report_type, ''::text AS snapshot_type FROM memos m" };
        let counts = client.query(&format!("WITH scope AS ({scope}) SELECT kind, count(*) FROM scope GROUP BY kind"), &[]).await.map_err(|e| e.to_string())?.into_iter().map(|r| (r.get::<_,String>(0), r.get::<_,i64>(1))).collect();
        let search = if is_report { "($5 = '' OR strpos(lower(concat_ws(' ', x.title, x.report_type)), lower($5)) > 0)" } else { "($5 = '' OR strpos(lower(concat_ws(' ', x.title, x.body)), lower($5)) > 0)" };
        let predicate = "($1 = '' OR x.kind = $1) AND ($2 = '' OR (x.report_type = $2 AND x.snapshot_type = $2))";
        let count_search = search.replace("$5", "$3");
        let total: i64 = client.query_one(&format!("WITH scope AS ({scope}) SELECT count(*) FROM scope x WHERE {predicate} AND {count_search}"), &[&request.kind,&request.report_type,&request.query]).await.map_err(|e| e.to_string())?.get(0);
        let offset = (request.offset.max(0) / 50 * 50).min((total - 1).max(0) / 50 * 50);
        let sort = match request.sort.as_str() { "name" | "title" => "lower(x.title)", "createdAt" => "x.created_at", "createdByName" => "lower(COALESCE(pu.name,''))", "kind" => "lower(COALESCE($4::text::jsonb ->> x.kind, x.kind))", _ => "x.updated_at" };
        let direction = if request.descending { "DESC" } else { "ASC" };
        let labels = serde_json::to_string(&request.kind_labels).map_err(|e| e.to_string())?;
        let ids: Vec<String> = client.query(&format!("WITH scope AS ({scope}) SELECT x.id FROM scope x LEFT JOIN project_users pu ON pu.id=x.created_by_project_user_id WHERE {predicate} AND {search} AND $4::text IS NOT NULL ORDER BY {sort} {direction}, x.id ASC LIMIT 50 OFFSET $3"), &[&request.kind,&request.report_type,&offset,&labels,&request.query]).await.map_err(|e| e.to_string())?.iter().map(|r| r.get(0)).collect();
        let mut fetch_ids = ids.clone();
        if let Some(id) = &request.selected_id { if !fetch_ids.contains(id) { fetch_ids.push(id.clone()); } }
        let records = if is_report { serde_json::to_value(load_filtered_reports(client, project_id, Some(&fetch_ids)).await?) } else { serde_json::to_value(load_filtered_memos(client, project_id, Some(&fetch_ids)).await?) }.map_err(|e| e.to_string())?;
        let by_id: std::collections::HashMap<_,_> = records.as_array().unwrap().iter().map(|r| (r["id"].as_str().unwrap(),r)).collect();
        let rows = ids.iter().filter_map(|id| by_id.get(id.as_str()).map(|r| (*r).clone())).collect();
        let selected = request.selected_id.as_ref().and_then(|id| by_id.get(id.as_str()).map(|r| (*r).clone()));
        Ok(TablePage { rows, selected, total, offset, counts })
    }.await;
    client
        .batch_execute(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
        .await
        .map_err(|e| e.to_string())?;
    result
}

#[tauri::command]
pub(super) async fn list_project_table_page_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    request: TablePageRequest,
) -> Result<TablePage, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = table_page(&client, &project_id, &request).await;
    task.abort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Run scripts/test-table-pages.mjs against disposable PostgreSQL"]
    fn table_pages_database_regression() {
        tauri::async_runtime::block_on(async {
            let (client, connection) =
                tokio_postgres::connect(&std::env::var("KANQUAL_TABLE_TEST_URL").unwrap(), NoTls)
                    .await
                    .unwrap();
            let task = tauri::async_runtime::spawn(async move {
                connection.await.unwrap();
            });
            let database: String = client
                .query_one("SELECT current_database()", &[])
                .await
                .unwrap()
                .get(0);
            assert_eq!(database, "kanqual_table_page_test");
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
            client.batch_execute("INSERT INTO memos(id,title,body) SELECT 'm'||lpad(i::text,4,'0'),'Memo '||lpad(i::text,4,'0'),repeat('body',10000) FROM generate_series(1,123) i;
                INSERT INTO reports(id,title,report_type,content_json) SELECT 'r'||lpad(i::text,4,'0'),'Report '||lpad(i::text,4,'0'),'code-report',json_build_object('reportType','code-report','kind',CASE WHEN i<=60 THEN 'summary' ELSE 'frequencies' END,'data',repeat('snapshot',10000))::text FROM generate_series(1,123) i;
                INSERT INTO reports(id,title,report_type,content_json) VALUES ('malformed','Malformed','code-report','invalid JSON'),('user','User','coder-report','{\"reportType\":\"coder-report\",\"kind\":\"agreement\"}');").await.unwrap();
            let mut request = TablePageRequest {
                entity: "memos".into(),
                sort: "title".into(),
                ..Default::default()
            };
            let mut seen = std::collections::HashSet::new();
            for offset in [0, 50, 100] {
                request.offset = offset;
                let page = table_page(&client, "p", &request).await.unwrap();
                assert_eq!(page.total, 123);
                assert_eq!(page.rows.len(), if offset == 100 { 23 } else { 50 });
                for row in page.rows {
                    assert!(seen.insert(row["id"].as_str().unwrap().to_string()));
                    assert_eq!(row["body"].as_str().unwrap().len(), 40000);
                }
            }
            assert_eq!(seen.len(), 123);
            request.query = "MEMO 0123".into();
            let page = table_page(&client, "p", &request).await.unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.offset, 0);
            assert_eq!(page.rows[0]["id"], "m0123");
            request.query = "%_'".into();
            assert_eq!(table_page(&client, "p", &request).await.unwrap().total, 0);
            request.query = "body".into();
            assert_eq!(table_page(&client, "p", &request).await.unwrap().total, 123);
            request.query.clear();

            request.offset = 0;
            request.selected_id = Some("m0123".into());
            assert_eq!(
                table_page(&client, "p", &request)
                    .await
                    .unwrap()
                    .selected
                    .unwrap()["id"],
                "m0123"
            );
            request.entity = "reports".into();
            request.query = "REPORT 0123".into();
            let page = table_page(&client, "p", &request).await.unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.rows[0]["id"], "r0123");
            request.query.clear();

            request.selected_id = None;
            let all = table_page(&client, "p", &request).await.unwrap();
            assert_eq!(all.total, 125);
            assert_eq!(all.counts["code-co-occurrences"], 60);
            assert_eq!(all.counts["code-frequencies"], 64);
            assert_eq!(all.counts["user-agreement"], 1);
            request.kind = "code-co-occurrences".into();
            request.descending = true;
            let filtered = table_page(&client, "p", &request).await.unwrap();
            assert_eq!(filtered.total, 60);
            assert_eq!(filtered.rows[0]["id"], "r0060");
            assert_eq!(filtered.counts["code-frequencies"], 64);
            request.kind.clear();
            request.report_type = "code-report".into();
            assert_eq!(table_page(&client, "p", &request).await.unwrap().total, 123);
            request.sort = "kind".into();
            request
                .kind_labels
                .insert("code-co-occurrences".into(), "ZZZ".into());
            request
                .kind_labels
                .insert("code-frequencies".into(), "AAA".into());
            assert_eq!(
                table_page(&client, "p", &request).await.unwrap().rows[0]["id"],
                "r0001"
            );
            request.sort = "title".into();
            request.offset = 100;
            client
                .batch_execute("DELETE FROM reports WHERE id>'r0050' AND id LIKE 'r%'")
                .await
                .unwrap();
            let clamped = table_page(&client, "p", &request).await.unwrap();
            assert_eq!(clamped.total, 50);
            assert_eq!(clamped.offset, 0);
            request.kind = "missing".into();
            assert_eq!(table_page(&client, "p", &request).await.unwrap().total, 0);
            request.entity = "invalid SQL".into();
            assert!(table_page(&client, "p", &request).await.is_err());
            // Single-record edit/save helpers must still preserve complete bodies.
            assert_eq!(
                load_postgres_experiment_memo_for_client(&client, "p", "m0123")
                    .await
                    .unwrap()
                    .body
                    .len(),
                40000
            );
            assert_eq!(
                load_postgres_experiment_report_for_client(&client, "p", "r0001")
                    .await
                    .unwrap()
                    .id,
                "r0001"
            );
            println!("Memo/report pages: full coverage, bodies, global counts, filters, translated sorts, malformed JSON, selected records, deletion clamp, and single-record helpers passed");
            task.abort();
        });
    }
}
