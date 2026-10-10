use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodebookSummary {
    codes: Vec<PostgresExperimentCode>,
    source_counts: std::collections::HashMap<String, i64>,
}

pub(super) async fn code_source_counts(client: &tokio_postgres::Client) -> Result<std::collections::HashMap<String, i64>, String> {
    client.query("SELECT ac.code_id, count(DISTINCT a.source_id) FROM annotation_codes ac JOIN annotations a ON a.id = ac.annotation_id GROUP BY ac.code_id", &[])
        .await.map(|rows| rows.into_iter().map(|row| (row.get(0), row.get(1))).collect()).map_err(|e| e.to_string())
}

pub(super) async fn code_annotations(client: &tokio_postgres::Client, project_id: &str, code_id: &str) -> Result<Vec<PostgresExperimentAnnotationSummary>, String> {
    let ids = client.query("SELECT annotation_id FROM annotation_codes WHERE code_id = $1", &[&code_id])
        .await.map_err(|e| e.to_string())?.iter().map(|row| row.get(0)).collect::<Vec<String>>();
    load_filtered_annotation_summaries(client, project_id, None, Some(&ids)).await
}

#[tauri::command]
pub(super) async fn get_codebook_summary_command(app: tauri::AppHandle, runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>, project_id: String) -> Result<CodebookSummary, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = async {
        let codes = load_postgres_experiment_codes_for_client(&client, &project_id).await?;
        let source_counts = code_source_counts(&client).await?;
        Ok(CodebookSummary { codes, source_counts })
    }.await;
    task.abort();
    result
}

#[tauri::command]
pub(super) async fn list_code_annotations_command(app: tauri::AppHandle, runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>, project_id: String, code_id: String) -> Result<Vec<PostgresExperimentAnnotationSummary>, String> {
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let result = code_annotations(&client, &project_id, &code_id).await;
    task.abort();
    result
}
