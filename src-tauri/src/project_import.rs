use super::*;

// Dependency order. Only these application tables may be written by a package.
pub(super) const IMPORT_TABLES: &[&str] = &[
    "project_users",
    "project_settings",
    "source_type_settings",
    "object_types",
    "relationship_types",
    "sources",
    "source_files",
    "codes",
    "research_objects",
    "source_attribute_definitions",
    "object_attribute_definitions",
    "relationship_attribute_definitions",
    "source_attribute_values",
    "object_attribute_values",
    "object_relationships",
    "relationship_attribute_values",
    "annotations",
    "annotation_codes",
    "source_objects",
    "annotation_objects",
    "code_objects",
    "event_objects",
    "memos",
    "memo_sources",
    "memo_annotations",
    "memo_codes",
    "memo_objects",
    "reports",
    "ai_analyses",
    "project_log",
    "source_attribute_value_history",
    "object_attribute_value_history",
    "relationship_attribute_value_history",
    "saved_drawings",
    "timeline_groups",
    "timeline_item_group_assignments",
    "timeline_group_row_orders",
    "processed_document_reviews",
    "project_ai_chats",
    "project_ai_chat_messages",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImportProjectRequest {
    name: String,
    token: String,
}

#[derive(Default)]
pub(super) struct ImportState(Mutex<ImportSessions>);
#[derive(Default)]
struct ImportSessions {
    jobs: HashMap<String, (String, project_import_stream::Progress)>,
    prepared: HashMap<String, (String, project_import_stream::StagedProject)>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PrepareImportRequest {
    id: String,
    path: String,
    password: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImportPreview {
    token: Option<String>,
    requires_password: bool,
    name: String,
    counts: HashMap<String, u64>,
    warnings: Vec<String>,
}

#[tauri::command]
pub(super) async fn prepare_project_import_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: PrepareImportRequest,
) -> Result<ImportPreview, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    if session.auth_kind != "postgres_admin" {
        return Err("Only an administrator can import projects.".into());
    }
    if request.id.is_empty() || request.id.len() > 128 {
        return Err("Invalid import identifier.".into());
    }
    let progress = project_import_stream::Progress::new(Some(app.clone()), request.id.clone());
    let state = app.state::<ImportState>();
    {
        let mut state = state.0.lock().unwrap();
        if state.jobs.contains_key(&request.id) || state.prepared.contains_key(&request.id) {
            return Err("Import identifier already in use.".into());
        }
        state.jobs.insert(
            request.id.clone(),
            (session.user.id.clone(), progress.clone()),
        );
    }
    let worker = progress.clone();
    let path = PathBuf::from(request.path);
    let password = request.password.map(Zeroizing::new);
    let result = tauri::async_runtime::spawn_blocking(move || {
        project_import_stream::prepare(&path, password, &worker)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    let mut state = state.0.lock().unwrap();
    state.jobs.remove(&request.id);
    progress.check()?;
    match result? {
        None => Ok(ImportPreview {
            token: None,
            requires_password: true,
            name: String::new(),
            counts: HashMap::new(),
            warnings: Vec::new(),
        }),
        Some(stage) => {
            let preview = ImportPreview {
                token: Some(request.id.clone()),
                requires_password: false,
                name: stage.project["name"]
                    .as_str()
                    .unwrap_or("Imported project")
                    .into(),
                counts: stage
                    .tables
                    .iter()
                    .map(|(name, file)| (name.clone(), file.count))
                    .collect(),
                warnings: stage.warnings.clone(),
            };
            state.prepared.insert(request.id, (session.user.id, stage));
            Ok(preview)
        }
    }
}

#[tauri::command]
pub(super) async fn cancel_project_import_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    id: String,
) -> Result<(), String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    let state = app.state::<ImportState>();
    let mut state = state.0.lock().unwrap();
    if let Some((owner, progress)) = state.jobs.get(&id) {
        if owner != &session.user.id {
            return Err("This import belongs to another administrator.".into());
        }
        progress.cancelled.store(true, Ordering::Relaxed);
    }
    if let Some((owner, _)) = state.prepared.get(&id) {
        if owner != &session.user.id {
            return Err("This import belongs to another administrator.".into());
        }
    }
    state.prepared.remove(&id);
    Ok(())
}

fn snake_case(key: &str) -> String {
    let mut result = String::new();
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            result.push('_');
            result.push(ch.to_ascii_lowercase());
        } else {
            result.push(ch);
        }
    }
    result
}

fn alias(row: &mut serde_json::Map<String, Value>, target: &str, alternatives: &[&str]) {
    if !row.contains_key(target) {
        if let Some(value) = alternatives.iter().find_map(|key| row.get(*key).cloned()) {
            row.insert(target.to_string(), value);
        }
    }
}

pub(super) fn normalize_row(
    table: &str,
    value: &Value,
) -> Result<serde_json::Map<String, Value>, String> {
    let object = value
        .as_object()
        .ok_or("Project table rows must be objects.")?;
    let mut row: serde_json::Map<String, Value> = object
        .iter()
        .map(|(key, value)| (snake_case(key), value.clone()))
        .collect();
    alias(&mut row, "created_at", &["created"]);
    alias(&mut row, "updated_at", &["updated"]);
    alias(&mut row, "created_by_project_user_id", &["created_by"]);
    alias(&mut row, "title", &["name"]);
    alias(&mut row, "source_id", &["document"]);
    alias(&mut row, "object_id", &["case"]);
    alias(&mut row, "attribute_definition_id", &["attribute"]);
    if table == "sources" {
        alias(&mut row, "source_kind", &["type"]);
        alias(&mut row, "text_content", &["content"]);
        alias(&mut row, "storage_path", &["file_path"]);
    }
    if let Some(kind) = row
        .get("source_kind")
        .and_then(Value::as_str)
        .filter(|kind| !kind.is_empty())
    {
        let normalized =
            normalize_postgres_experiment_source_kind(kind).ok_or("Unsupported source kind.")?;
        row.insert("source_kind".into(), Value::String(normalized.into()));
    }
    if table == "codes" {
        alias(&mut row, "label", &["name"]);
        alias(&mut row, "parent_code_id", &["parent"]);
    }
    if table == "research_objects" {
        alias(&mut row, "description", &["notes"]);
        row.entry("object_type")
            .or_insert(Value::String("case".into()));
    }
    if table.ends_with("attribute_definitions") {
        if let Some(options) = row.get("options").cloned() {
            row.entry("options_json")
                .or_insert(Value::String(options.to_string()));
        }
    }
    if table == "annotations" {
        if let Some(region) = row.get("image_region").filter(|v| !v.is_null()).cloned() {
            row.entry("region_selector_json")
                .or_insert(Value::String(region.to_string()));
        }
    }
    for key in [
        "created_by_project_user_id",
        "parent_code_id",
        "object_type_id",
        "relationship_type_id",
        "target_code_id",
    ] {
        if row.get(key).and_then(Value::as_str) == Some("") {
            row.insert(key.into(), Value::Null);
        }
    }
    Ok(row)
}

pub(super) fn read_tables(payload: &Value) -> Result<HashMap<String, Vec<Value>>, String> {
    if payload.get("format").and_then(Value::as_str) != Some("kanqual-project-export")
        || payload.get("version").and_then(Value::as_u64) != Some(1)
        || !payload.get("project").is_some_and(Value::is_object)
    {
        return Err("This is not a supported KanQual project export (version 1).".into());
    }
    let mut tables = HashMap::new();
    let input = payload
        .get("tables")
        .and_then(Value::as_array)
        .ok_or("Project tables are missing.")?;
    for table in input {
        let name = table
            .get("name")
            .and_then(Value::as_str)
            .ok_or("A project table has no name.")?;
        let rows = table
            .get("rows")
            .and_then(Value::as_array)
            .ok_or("A project table has invalid rows.")?;
        if !IMPORT_TABLES.contains(&name)
            && ![
                "projects",
                "users",
                "project_members",
                "documents",
                "objects",
                "cases",
                "source_object_links",
                "case_documents",
                "relationships",
                "document_attribute_definitions",
                "document_attribute_values",
                "case_attribute_definitions",
                "case_attribute_values",
            ]
            .contains(&name)
            && !rows.is_empty()
        {
            return Err(format!("Unsupported project table: {name}."));
        }
        if rows.iter().any(|row| !row.is_object())
            || tables.insert(name.to_string(), rows.clone()).is_some()
        {
            return Err(format!("Invalid or duplicate project table: {name}."));
        }
    }
    for (target, aliases) in [
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
    ] {
        if !tables.contains_key(target) {
            if let Some(rows) = aliases.iter().find_map(|name| tables.get(*name).cloned()) {
                tables.insert(target.into(), rows);
            }
        }
    }
    // New exports include native rows as well as the interoperable tables above.
    if let Some(native) = payload.get("postgresTables") {
        let native = native.as_array().ok_or("Invalid native project tables.")?;
        let mut seen = HashSet::new();
        for table in native {
            let name = table
                .get("name")
                .and_then(Value::as_str)
                .ok_or("Invalid native table name.")?;
            if !IMPORT_TABLES.contains(&name) || !seen.insert(name) {
                return Err(format!(
                    "Unsupported or duplicate native project table: {name}."
                ));
            }
            let rows = table
                .get("rows")
                .and_then(Value::as_array)
                .ok_or("Invalid native table rows.")?;
            tables.insert(name.into(), rows.clone());
        }
    }
    // Older exports carry some links inline rather than in separate tables.
    if !tables.contains_key("annotation_codes") {
        let mut links = Vec::new();
        for row in tables.get("annotations").into_iter().flatten() {
            let mut codes: Vec<Value> = row
                .get("code_ids")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if let Some(code) = row
                .get("code")
                .filter(|v| v.as_str().is_some_and(|s| !s.is_empty()))
            {
                if !codes.contains(code) {
                    codes.push(code.clone());
                }
            }
            for code in codes {
                links.push(serde_json::json!({"annotation_id": row["id"], "code_id": code}));
            }
        }
        tables.insert("annotation_codes".into(), links);
    }
    for (table, field, target) in [
        ("memo_sources", "source_ids", "source_id"),
        ("memo_annotations", "annotation_ids", "annotation_id"),
        ("memo_codes", "code_ids", "code_id"),
        ("memo_objects", "object_ids", "object_id"),
    ] {
        if !tables.contains_key(table) {
            let mut links = Vec::new();
            for row in tables.get("memos").into_iter().flatten() {
                for id in row
                    .get(field)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    links.push(serde_json::json!({"memo_id": row["id"], target: id}));
                }
            }
            tables.insert(table.into(), links);
        }
    }
    Ok(tables)
}

// Validate portable paths on every OS, including Windows paths on Unix.
pub(super) fn portable_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || value.starts_with('/')
        || value
            .chars()
            .any(|ch| ch.is_control() || "<>\"|?*".contains(ch))
        || value.split('/').any(|part| {
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            part.is_empty()
                || part.ends_with('.')
                || part.ends_with(' ')
                || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(format!("Unsafe attachment path: {value}"));
    }
    safe_backup_relative_path(value)
}

async fn insert_row_stream(
    client: &impl GenericClient,
    table: &str,
    rows: impl Iterator<Item = Result<Value, String>>,
    project_id: &str,
    progress: Option<(&project_import_stream::Progress, u64)>,
) -> Result<(), String> {
    let columns = client.query(
        "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
        &[&table],
    ).await.map_err(|e| e.to_string())?;
    let mut parents = Vec::new();
    for (index, value) in rows.enumerate() {
        if let Some((progress, total)) = progress {
            progress.report("importing", index as u64, total)?;
        }
        let mut row = normalize_row(table, &value?)?;
        if row.contains_key("project_id") {
            row.insert("project_id".into(), Value::String(project_id.into()));
        }
        if table == "project_users" {
            // Preserve attribution without granting access to an account on this installation.
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Imported user has no id.")?
                .to_string();
            row.insert(
                "app_user_id".into(),
                Value::String(format!("imported:{project_id}:{id}")),
            );
            row.insert(
                "email".into(),
                Value::String(format!("{id}@imported.invalid")),
            );
            row.entry("name")
                .or_insert(Value::String("Imported user".into()));
            row.insert("role".into(), Value::String("viewer".into()));
        }
        if table == "codes" {
            if let Some(parent) = row.get("parent_code_id").and_then(Value::as_str) {
                parents.push((
                    row["id"].as_str().ok_or("Code has no id.")?.to_string(),
                    parent.to_string(),
                ));
                row.insert("parent_code_id".into(), Value::Null);
            }
        }
        if table == "project_settings" {
            row.insert("id".into(), Value::String("default".into()));
            // Importing a file must not enable AI network activity automatically.
            row.insert("ai_assist_enabled".into(), Value::Bool(false));
        }
        let mut selected = Vec::new();
        for column in &columns {
            let name: String = column.get(0);
            if let Some(value) = row.get(&name) {
                let nullable: String = column.get(1);
                let default: Option<String> = column.get(2);
                if value.is_null() && nullable == "NO" && default.is_some() {
                    continue;
                }
                if name.ends_with("storage_path") {
                    if let Some(path) = value.as_str().filter(|p| !p.is_empty()) {
                        portable_path(path)?;
                    }
                }
                selected.push(sql_escape_identifier(&name));
            }
        }
        if selected.is_empty() {
            return Err(format!("No recognized fields in {table}."));
        }
        let names = selected.join(", ");
        let query = format!("INSERT INTO {} ({names}) SELECT {names} FROM json_populate_record(NULL::{}, $1::text::json)", sql_escape_identifier(table), sql_escape_identifier(table));
        client
            .execute(&query, &[&Value::Object(row).to_string()])
            .await
            .map_err(|e| {
                format!(
                    "Could not import {table}: {}",
                    e.as_db_error()
                        .map(|e| e.message())
                        .unwrap_or("invalid record")
                )
            })?;
    }
    let parent_map: HashMap<_, _> = parents
        .iter()
        .map(|(id, parent)| (id.as_str(), parent.as_str()))
        .collect();
    let mut checked = HashSet::new();
    for id in parent_map.keys() {
        let mut seen = HashSet::new();
        let mut current = *id;
        while let Some(parent) = parent_map.get(current) {
            if checked.contains(current) {
                break;
            }
            if !seen.insert(current) {
                return Err("The imported code hierarchy contains a cycle.".into());
            }
            current = *parent;
        }
        checked.extend(seen);
    }
    for (id, parent) in parents {
        client
            .execute(
                "UPDATE codes SET parent_code_id = $2 WHERE id = $1",
                &[&id, &parent],
            )
            .await
            .map_err(|e| format!("Invalid code hierarchy: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn import_postgres_project_file_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: ImportProjectRequest,
) -> Result<PostgresExperimentProject, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    if session.auth_kind != "postgres_admin" {
        return Err("Only an administrator can import projects.".into());
    }
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("Enter a project name.".into());
    }
    let state = app.state::<ImportState>();
    let (stage, progress) = {
        let mut state = state.0.lock().unwrap();
        let owner = state
            .prepared
            .get(&request.token)
            .ok_or("The import preview has expired. Choose the file again.")?
            .0
            .clone();
        if owner != session.user.id {
            return Err("This import belongs to another administrator.".into());
        }
        let (_, stage) = state.prepared.remove(&request.token).unwrap();
        let progress =
            project_import_stream::Progress::new(Some(app.clone()), request.token.clone());
        state
            .jobs
            .insert(request.token.clone(), (owner, progress.clone()));
        (stage, progress)
    };
    let result = import_staged(&app, &session, stage, name, &progress).await;
    state.0.lock().unwrap().jobs.remove(&request.token);
    result
}

async fn import_staged(
    app: &tauri::AppHandle,
    session: &PostgresExperimentAuthSession,
    stage: project_import_stream::StagedProject,
    name: String,
    progress: &project_import_stream::Progress,
) -> Result<PostgresExperimentProject, String> {
    progress.check()?;
    let tables = &stage.tables;
    let description = stage.project["description"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    ensure_postgres_experiment_control_schema(&app).await?;
    let id = generate_identifier();
    let database = postgres_project_database_name(&id);
    let snapshot_database = postgres_project_snapshot_database_name(&id);
    let storage = postgres_project_storage_path(&app, &id)?;
    // Registration happens last; partially imported projects are never listed.
    let result: Result<PostgresExperimentProject, String> = async {
        create_postgres_database_if_missing(&app, &database).await?;
        ensure_postgres_experiment_project_schema(&app, &database).await?;
        ensure_postgres_experiment_project_snapshot_schema(&app, &id).await?;
        let (mut client, connection) = connect_postgres_database(&app, &database).await?;
        let imported: Result<(), String> = async {
            let transaction = client.transaction().await.map_err(|e| e.to_string())?;
            for table in IMPORT_TABLES.iter().rev() {
                if tables.get(*table).is_some_and(|file| file.count > 0) {
                    transaction.execute(&format!("DELETE FROM {}", sql_escape_identifier(table)), &[]).await.map_err(|e| e.to_string())?;
                }
            }
            for table in IMPORT_TABLES {
                if let Some(file) = tables.get(*table) {
                    progress.report("importing", 0, file.count)?;
                    insert_row_stream(&transaction, table, project_import_stream::rows(file)?, &id, Some((progress, file.count))).await?;
                    progress.report("importing", file.count, file.count)?;
                }
            }
            transaction.execute("INSERT INTO project_users (id, app_user_id, name, email, role) VALUES ($1,$2,$3,$4,'owner')", &[&generate_identifier(), &session.user.id, &session.user.name, &session.user.username]).await.map_err(|e| e.to_string())?;
            transaction.execute("UPDATE project_settings SET project_name=$1, project_description=$2, ai_assist_enabled=FALSE WHERE id='default'", &[&name, &description]).await.map_err(|e| e.to_string())?;
            transaction.query_one("SELECT setval('annotation_display_id_seq', GREATEST(COALESCE(MAX(display_id),0)+1,1), false) FROM annotations", &[]).await.map_err(|e| e.to_string())?;
            progress.check()?;
            transaction.commit().await.map_err(|e| e.to_string())?;
            append_postgres_experiment_project_log_for_client(&client, &id, &session, "project.import", "Imported project from file", None, Some(serde_json::json!({"importFormat": stage.format}))).await?;
            Ok(())
        }.await;
        connection.abort();
        imported?;
        fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
        for (name, path) in &stage.assets {
            progress.check()?;
            let target = storage.join(portable_path(name)?);
            if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            let source = path.clone(); let progress = progress.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let source = fs::File::open(source).map_err(|e| e.to_string())?;
                let size = source.metadata().map_err(|e| e.to_string())?.len();
                project_import_stream::copy_stream(source, fs::File::create(target).map_err(|e| e.to_string())?, &progress, "copying", size)
            }).await.map_err(|e| e.to_string())??;
        }
        progress.check()?;
        for db in [&database, &snapshot_database] {
            grant_postgres_project_database_access_for_role(&app, db, &session.user.username).await?;
        }
        let (control, connection) = connect_postgres_runtime(&app).await?;
        progress.check()?;
        let row = control.query_one("INSERT INTO projects (id, database_name, storage_path, creation_source, created_by_username, active) VALUES ($1,$2,$3,'import',$4,TRUE) RETURNING created_at::text, updated_at::text", &[&id, &database, &storage.to_string_lossy().to_string(), &session.user.username]).await;
        connection.abort();
        let row = row.map_err(|e| format!("Could not register imported project: {e}"))?;
        Ok(PostgresExperimentProject {
            id: id.clone(), name, description, database_name: database.clone(),
            storage_path: storage.to_string_lossy().into_owned(), creation_source: "import".into(),
            created_by_username: session.user.username.clone(),
            access_mode: postgres_experiment_access_mode_from_runtime_config(&load_postgres_runtime_config(&app)?),
            active: true, disabled_at: None, created_at: row.get(0), updated_at: row.get(1),
        })
    }.await;
    if result.is_err() {
        let _ = drop_postgres_database_if_exists(&app, &snapshot_database).await;
        let _ = drop_postgres_database_if_exists(&app, &database).await;
        let _ = fs::remove_dir_all(&storage);
        if let Ok((client, connection)) = connect_postgres_runtime(&app).await {
            let _ = client
                .execute("DELETE FROM projects WHERE id=$1", &[&id])
                .await;
            connection.abort();
        }
    } else {
        emit_postgres_experiment_project_change(&app, &id, "project", &id, "created");
    }
    result
}

#[cfg(test)]
async fn insert_rows(
    client: &impl GenericClient,
    table: &str,
    rows: &[Value],
    project_id: &str,
) -> Result<(), String> {
    insert_row_stream(
        client,
        table,
        rows.iter().cloned().map(Ok),
        project_id,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_cross_platform_path_traversal() {
        for path in [
            "../file",
            "/file",
            "C:/file",
            "a\\..\\file",
            "a//b",
            "a/./b",
            "CON.txt",
            "x/a.",
            "x/a ",
            "",
        ] {
            assert!(portable_path(path).is_err(), "{path}");
        }
        assert!(portable_path("sources/example.txt").is_ok());
    }

    #[test]
    fn converts_existing_export_fields() {
        let row = normalize_row("annotations", &serde_json::json!({"id":"a", "document":"s", "created_by":"u", "created":"2026-01-01", "image_region":{"x":0.2}})).unwrap();
        assert_eq!(row["source_id"], "s");
        assert_eq!(row["created_by_project_user_id"], "u");
        assert_eq!(row["region_selector_json"], "{\"x\":0.2}");
        let row = normalize_row(
            "sources",
            &serde_json::json!({"sourceKind":"text", "textContent":"hello"}),
        )
        .unwrap();
        assert_eq!(row["text_content"], "hello");
    }

    #[test]
    fn rejects_invalid_versions_and_duplicate_tables() {
        assert!(read_tables(&serde_json::json!({"format":"kanqual-project-export","version":2,"project":{},"tables":[]})).is_err());
        assert!(read_tables(&serde_json::json!({"format":"kanqual-project-export","version":1,"project":{},"tables":[{"name":"codes","rows":[]},{"name":"codes","rows":[]}]})).is_err());
    }

    #[test]
    fn decrypts_project_backups_and_rejects_wrong_passwords() {
        let password = crate::uuid_like_token(32);
        let wrong_password = crate::uuid_like_token(32);
        let payload = serde_json::json!({"format":"kanqual-project-export","version":1,"project":{"name":"Encrypted"},"tables":[],"assets":[]});
        let backup =
            serde_json::json!({"kind":"kanqual-project-backup","version":1,"payload":payload})
                .to_string();
        let encrypted = encrypt_backup_payload_text(backup, password.clone()).unwrap();
        assert!(decrypt_encrypted_backup_payload_inner(&encrypted, &wrong_password).is_err());
        let plaintext =
            decrypt_encrypted_backup_payload_inner(&encrypted, &password).unwrap();
        let decoded: Value = serde_json::from_str(&plaintext).unwrap();
        assert!(read_tables(&decoded["payload"]).is_ok());
    }

    #[test]
    #[ignore = "Run with scripts/test-project-import-db.mjs against its disposable PostgreSQL instance"]
    fn imports_into_postgres_with_foreign_keys_and_rollback() {
        let url = std::env::var("KANQUAL_IMPORT_TEST_URL").expect("Disposable test database URL");
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let (mut client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
            let task = tokio::spawn(async move { connection.await.unwrap(); });
            let database: String = client.query_one("SELECT current_database()", &[]).await.unwrap().get(0);
            assert_eq!(database, "kanqual_import_test", "Only use the disposable import test database");
            // Exercise the real application DDL, not a simplified test schema.
            let source = include_str!("lib.rs").replace("\r\n", "\n");
            let schema = &source[source.find("async fn ensure_postgres_experiment_project_schema(").unwrap()..];
            let schema = &schema[schema.find("CREATE TABLE IF NOT EXISTS app_schema_migrations (").unwrap()..];
            let schema = &schema[..schema.find("\",\n").unwrap()];
            client.batch_execute(&schema.replace("\\\"", "\"")).await.unwrap();
            let payload = serde_json::json!({
                "format":"kanqual-project-export", "version":1, "project":{}, "assets":[],
                "tables":[
                    {"name":"project_members", "rows":[{"id":"u", "name":"Author", "user":"real-account", "email":"author@example.org", "role":"owner"}]},
                    {"name":"sources", "rows":[{"id":"s", "title":"Interview", "sourceKind":"text", "textContent":"Hello 😀"}]},
                    {"name":"source_files", "rows":[{"id":"file", "source_id":"s", "storage_path":"sources/file.txt"}]},
                    {"name":"codes", "rows":[{"id":"child", "name":"Child", "parent":"parent"},{"id":"parent", "name":"Parent"}]},
                    {"name":"object_types", "rows":[{"id":"type", "name":"Case"}]},
                    {"name":"objects", "rows":[{"id":"o", "objectTypeId":"type", "objectType":"Case", "title":"Participant"}]},
                    {"name":"source_attribute_definitions", "rows":[{"id":"d", "name":"Category", "dataType":"categorical", "options":["A","B"], "sourceKinds":["Text"]}]},
                    {"name":"source_attribute_values", "rows":[{"id":"v", "sourceId":"s", "attributeDefinitionId":"d", "value":"A"}]},
                    {"name":"annotations", "rows":[{"id":"a", "document":"s", "code_ids":["child"], "start_offset":0,"end_offset":5,"created_by":"u"}]},
                    {"name":"memos", "rows":[{"id":"m", "title":"Memo", "source_ids":["s"], "code_ids":["child"], "created_by":"u"}]},
                    {"name":"source_object_links", "rows":[{"sourceId":"s", "objectId":"o"}]}
                ]
            });
            let fixture_root = tempfile::tempdir().unwrap();
            let fixture_path = fixture_root.path().join("export.json");
            let mut fixture = payload.clone();
            fixture["assets"] = serde_json::json!([{"collection":"project_storage_files","fileName":"sources/file.txt","dataBase64":"YWJj"}]);
            fs::write(&fixture_path, fixture.to_string()).unwrap();
            let progress = project_import_stream::Progress::new(None, "db-test".into());
            let staged = project_import_stream::prepare(&fixture_path, None, &progress).unwrap().unwrap();
            let transaction = client.transaction().await.unwrap();
            for table in IMPORT_TABLES {
                if let Some(file) = staged.tables.get(*table) {
                    insert_row_stream(&transaction, table, project_import_stream::rows(file).unwrap(), "new-project", Some((&progress,file.count))).await.unwrap();
                }
            }
            transaction.commit().await.unwrap();
            let row = client.query_one("SELECT c.parent_code_id, u.app_user_id, u.role, s.source_kind, a.display_id FROM annotation_codes ac JOIN codes c ON c.id=ac.code_id JOIN annotations a ON a.id=ac.annotation_id JOIN project_users u ON u.id=a.created_by_project_user_id JOIN sources s ON s.id=a.source_id", &[]).await.unwrap();
            assert_eq!(row.get::<_, String>(0), "parent");
            assert_eq!(row.get::<_, String>(1), "imported:new-project:u");
            assert_eq!(row.get::<_, String>(2), "viewer");
            assert_eq!(row.get::<_, String>(3), "Text");
            assert!(row.get::<_, i64>(4) > 0);
            assert_eq!(client.query_one("SELECT count(*) FROM memo_sources", &[]).await.unwrap().get::<_, i64>(0), 1);
            assert_eq!(client.query_one("SELECT options_json FROM source_attribute_definitions WHERE id='d'", &[]).await.unwrap().get::<_, String>(0), "[\"A\",\"B\"]");
            let mut native = Vec::new();
            for table in IMPORT_TABLES {
                let query = format!("SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM {} t", sql_escape_identifier(table));
                let json: String = client.query_one(&query, &[]).await.unwrap().get(0);
                native.push(serde_json::json!({"name":table,"rows":serde_json::from_str::<Value>(&json).unwrap()}));
            }
            let mut roundtrip = payload.clone();
            roundtrip["postgresTables"] = Value::Array(native);
            let native_tables = read_tables(&roundtrip).unwrap();
            let transaction = client.transaction().await.unwrap();
            for table in IMPORT_TABLES.iter().rev() {
                transaction.execute(&format!("DELETE FROM {}", sql_escape_identifier(table)), &[]).await.unwrap();
            }
            for table in IMPORT_TABLES { insert_rows(&transaction, table, &native_tables[*table], "roundtrip-project").await.unwrap(); }
            transaction.commit().await.unwrap();
            assert_eq!(client.query_one("SELECT parent_code_id FROM codes WHERE id='child'", &[]).await.unwrap().get::<_, String>(0), "parent");
            assert_eq!(client.query_one("SELECT count(*) FROM annotation_codes", &[]).await.unwrap().get::<_, i64>(0), 1);
            let transaction = client.transaction().await.unwrap();
            insert_rows(&transaction, "sources", &[serde_json::json!({"id":"rollback", "title":"Should disappear"})], "new-project").await.unwrap();
            assert!(insert_rows(&transaction, "annotation_codes", &[serde_json::json!({"annotation_id":"missing", "code_id":"child"})], "new-project").await.is_err());
            transaction.rollback().await.unwrap();
            assert_eq!(client.query_one("SELECT count(*) FROM sources WHERE id='rollback'", &[]).await.unwrap().get::<_, i64>(0), 0);
            // Optionally validate a generated project through the real streaming
            // importer and application schema, in this disposable database only.
            if let Ok(path) = std::env::var("KANQUAL_IMPORT_FIXTURE") {
                let progress = project_import_stream::Progress::new(None, "external-fixture".into());
                let staged = project_import_stream::prepare(Path::new(&path), None, &progress).unwrap().unwrap();
                assert!(staged.warnings.is_empty(), "Unexpected import warnings");
                let transaction = client.transaction().await.unwrap();
                for table in IMPORT_TABLES.iter().rev() {
                    transaction.execute(&format!("DELETE FROM {}", sql_escape_identifier(table)), &[]).await.unwrap();
                }
                for table in IMPORT_TABLES {
                    if let Some(file) = staged.tables.get(*table) {
                        insert_row_stream(&transaction, table, project_import_stream::rows(file).unwrap(), "generated-project", Some((&progress, file.count))).await.unwrap();
                        let count: i64 = transaction.query_one(&format!("SELECT count(*) FROM {}", sql_escape_identifier(table)), &[]).await.unwrap().get(0);
                        assert_eq!(count as u64, file.count, "Row count differs for {table}");
                    }
                }
                transaction.rollback().await.unwrap();
                println!("Generated project imported without warnings or foreign-key errors: {path}");
            }
            drop(client);
            task.await.unwrap();
        });
    }
}
