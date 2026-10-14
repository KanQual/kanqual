//! Full-installation replacement runs with normal IPC blocked and PostgreSQL
//! stopped. A fresh process resumes interrupted operations before normal startup. Original files are renamed, never deleted, and a journal
//! allows rollback after an error or an interrupted restore.
use crate::*;

pub static MAINTENANCE: AtomicBool = AtomicBool::new(false);
static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
tokio::task_local! {
    static RESTORE_DATABASE_ACCESS: ();
}

// In-flight normal tasks must not reconnect to the replacement database once
// maintenance begins. Only the restore task may open connections in this mode.
fn database_access_allowed(maintenance: bool) -> bool {
    !maintenance || RESTORE_DATABASE_ACCESS.try_with(|_| ()).is_ok()
}

pub(crate) fn require_database_access() -> Result<(), String> {
    if !database_access_allowed(MAINTENANCE.load(Ordering::SeqCst)) {
        return Err("KanQual is restoring installation data. Database access is temporarily disabled.".into());
    }
    Ok(())
}

const JOURNAL: &str = "installation-restore.json";
const COMPONENTS: [&str; 4] = [
    "postgres",
    "postgres-projects",
    POSTGRES_BOOTSTRAP_IDENTITY_FILE,
    POSTGRES_RUNTIME_CONFIG_FILE,
];

struct BusyGuard;
impl BusyGuard {
    fn acquire() -> Result<tokio::sync::MutexGuard<'static, ()>, String> {
        BUSY.try_lock()
            .map_err(|_| "A restore operation is already running.".to_string())
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    fingerprint: String,
    version: String,
    created_at_ms: u64,
    projects: Vec<String>,
    file_count: usize,
    user_count: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    id: String,
    phase: String,
    preview: Preview,
    originals: Vec<String>,
    recovery_backup: String,
}

fn read_journal(root: &Path) -> Result<Option<Journal>, String> {
    let path = root.join(JOURNAL);
    if !path.exists() {
        return Ok(None);
    }
    let journal: Journal = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Could not read restore recovery journal: {e}"))?;
    if journal.id.is_empty()
        || !journal.id.bytes().all(|b| b.is_ascii_digit())
        || !journal
            .originals
            .iter()
            .all(|s| COMPONENTS.contains(&s.as_str()))
        || !["prepared", "moving", "restoring", "complete", "recovered"]
            .contains(&journal.phase.as_str())
    {
        return Err("Invalid restore recovery journal; original data has been left intact.".into());
    }
    Ok(Some(journal))
}

fn write_journal(root: &Path, journal: &Journal) -> Result<(), String> {
    let tmp = root.join("installation-restore.tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(journal).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(tmp, root.join(JOURNAL)).map_err(|e| e.to_string())
}

fn recovery_dir(root: &Path, journal: &Journal) -> PathBuf {
    root.join("restore-recovery").join(&journal.id)
}

pub fn pending(app: &tauri::AppHandle) -> bool {
    // An unreadable journal must also prevent normal startup.
    kanqual_data_dir(app)
        .map(|p| p.join(JOURNAL).exists())
        .unwrap_or(true)
}

fn load_preview(path: &Path, password: &str) -> Result<(Preview, String), String> {
    let encrypted = fs::read_to_string(path).map_err(|e| format!("Could not read backup: {e}"))?;
    let plaintext = Zeroizing::new(decrypt_encrypted_backup_payload_text(
        &encrypted,
        password,
        Some(ensure_upgrade_backup_json_shape),
    )?);
    let backup: Value = serde_json::from_str(&plaintext).map_err(|e| e.to_string())?;
    let projects = backup["projects"]
        .as_array()
        .ok_or("Missing project metadata")?;
    let mut ids = HashSet::new();
    for project in projects {
        let id = project["id"].as_str().ok_or("Missing project id")?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !ids.insert(id)
        {
            return Err("The backup contains an unsafe or duplicate project id.".into());
        }
    }
    let mut filenames = HashSet::new();
    if let Some(files) = backup["projectStorageFiles"].as_array() {
        for file in files {
            let id = file["projectId"]
                .as_str()
                .ok_or("Missing source file project id")?;
            let relative = file["relativePath"]
                .as_str()
                .ok_or("Missing source file path")?;
            if !ids.contains(id) || !filenames.insert((id, relative.to_lowercase())) {
                return Err(
                    "The backup contains an unknown project or duplicate source file path.".into(),
                );
            }
        }
    }
    // pg_dump's default plain format stores users as a COPY block. Older or
    // differently formatted dumps display an unknown count rather than a guess.
    let sql = backup["controlDump"]["sql"].as_str().unwrap_or_default();
    let user_count = copy_user_count(sql);
    Ok((
        Preview {
            fingerprint: sha256_hex(encrypted.as_bytes()),
            version: backup_value_string(&backup, "kanqualVersion"),
            created_at_ms: backup["createdAtMs"].as_u64().unwrap_or(0),
            projects: projects
                .iter()
                .map(|p| backup_value_string(p, "name"))
                .collect(),
            file_count: backup["projectStorageFiles"].as_array().map_or(0, Vec::len),
            user_count,
        },
        encrypted,
    ))
}

fn copy_user_count(sql: &str) -> Option<usize> {
    let mut lines = sql.lines();
    while let Some(line) = lines.next() {
        if line.starts_with("COPY public.app_users (") && line.ends_with(" FROM stdin;") {
            let mut count = 0;
            for row in lines.by_ref() {
                if row == "\\." {
                    return Some(count);
                }
                count += 1;
            }
            return None;
        }
    }
    None
}

fn is_installation_admin_membership(app_user_id: &str) -> bool {
    app_user_id
        .strip_prefix("postgres-admin:")
        .is_some_and(|name| {
            name.starts_with(POSTGRES_ADMIN_ROLE_PREFIX) && is_valid_postgres_superuser_name(name)
        })
}

/// Keep project-user primary keys (and therefore authorship references) intact.
/// Identify the built-in administrator by its synthetic ID, never by a user's
/// display name or project role: ordinary administrator users remain unchanged.
pub(crate) async fn remap_restored_project_admin<C: GenericClient>(
    client: &C,
    new_admin: &str,
    restored_accounts: &HashMap<String, String>,
) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "SELECT id, app_user_id, email FROM project_users ORDER BY created_at, id",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load restored project memberships: {e}"))?;
    let new_id = format!("postgres-admin:{new_admin}");
    let canonical = rows
        .iter()
        .find(|r| r.get::<_, String>(1) == new_id)
        .or_else(|| {
            rows.iter()
                .find(|r| is_installation_admin_membership(&r.get::<_, String>(1)))
        });
    if let Some(row) = canonical {
        let id: String = row.get(0);
        client.execute(
            "UPDATE project_users SET app_user_id = $2, email = $3, updated_at = NOW() WHERE id = $1",
            &[&id, &new_id, &new_admin],
        ).await.map_err(|e| format!("Could not remap the restored installation administrator: {e}"))?;
    }
    let mut roles = Vec::new();
    for row in &rows {
        let app_user_id: String = row.get(1);
        // Older backups can contain multiple historical built-in admins. Keep
        // those records for attribution without recreating obsolete login roles
        // or violating the unique app_user_id/email constraints.
        let role = if is_installation_admin_membership(&app_user_id) {
            new_admin.to_string()
        } else if let Some(username) = restored_accounts.get(&app_user_id) {
            username.clone()
        } else {
            // Imported authors and deleted accounts are attribution records,
            // not login accounts. Do not create or grant roles for them.
            continue;
        };
        if !roles.contains(&role) {
            roles.push(role);
        }
    }
    Ok(roles)
}

async fn require_admin(
    app: &tauri::AppHandle,
    auth: &tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<(), String> {
    let session = require_postgres_experiment_auth_session(app, Some(auth)).await?;
    if session.auth_kind != "postgres_admin" {
        return Err("Sign in as the installation administrator.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_first_startup_restore_command(
    app: tauri::AppHandle,
    backup_path: String,
    backup_password: String,
) -> Result<Preview, String> {
    let preflight = bundled_postgres::init_preflight(app).await?;
    if !preflight.can_initialize {
        return Err("First-startup restore is only available on a fresh installation.".into());
    }
    load_preview(Path::new(&backup_path), &backup_password).map(|v| v.0)
}

#[tauri::command]
pub async fn preview_installation_restore_command(
    app: tauri::AppHandle,
    auth: tauri::State<'_, PostgresExperimentAuthState>,
    backup_path: String,
    backup_password: String,
) -> Result<Preview, String> {
    require_admin(&app, &auth).await?;
    load_preview(Path::new(&backup_path), &backup_password).map(|v| v.0)
}

// Omitting the choice keeps the original backup-required behavior. Skipping is
// explicit and does not bypass the administrator session or rollback journal.
fn recovery_backup_password(
    password: Option<String>,
    skip: Option<bool>,
) -> Result<Option<String>, String> {
    if skip == Some(true) {
        return Ok(None);
    }
    match password {
        Some(password) if !password.trim().is_empty() => Ok(Some(password)),
        _ => Err("Enter the current administrator password or explicitly skip the recovery backup.".into()),
    }
}

#[tauri::command]
pub async fn prepare_installation_restore_command(
    app: tauri::AppHandle,
    auth: tauri::State<'_, PostgresExperimentAuthState>,
    backup_path: String,
    backup_password: String,
    admin_password: Option<String>,
    skip_recovery_backup: Option<bool>,
    fingerprint: String,
    confirmation: String,
) -> Result<Journal, String> {
    let _guard = BusyGuard::acquire()?;
    require_admin(&app, &auth).await?;
    if confirmation != "RESTORE" {
        return Err("Type RESTORE to confirm replacement.".into());
    }
    let backup_password_for_recovery = recovery_backup_password(admin_password, skip_recovery_backup)?;
    let config = load_postgres_runtime_config(&app)?;
    if config.host != POSTGRES_DEFAULT_HOST || config.port != POSTGRES_DEFAULT_PORT {
        return Err("Full installation restore must be prepared on the device hosting the bundled database.".into());
    }
    let root = kanqual_data_dir(&app)?;
    if pending(&app) {
        return Err(
            "A restore is already prepared. Restart KanQual to continue or cancel it.".into(),
        );
    }
    let (preview, encrypted) = load_preview(Path::new(&backup_path), &backup_password)?;
    if preview.fingerprint != fingerprint {
        return Err("The backup changed. Preview it again before restoring.".into());
    }
    let id = current_time_ms().to_string();
    let directory = root.join("restore-recovery").join(&id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let recovery_backup = if let Some(admin_password) = backup_password_for_recovery {
        let path = directory.join("before-restore.kanqual-upgrade-backup");
        create_postgres_experiment_upgrade_backup_command(
            app.clone(),
            auth,
            CreatePostgresUpgradeBackupRequest {
                admin_password,
                output_path: Some(path.to_string_lossy().into_owned()),
            },
        )
        .await?;
        path.to_string_lossy().into_owned()
    } else {
        String::new()
    };
    let mut selected = fs::File::create(directory.join("selected.kanqual-upgrade-backup"))
        .map_err(|e| e.to_string())?;
    selected
        .write_all(encrypted.as_bytes())
        .map_err(|e| e.to_string())?;
    selected.sync_all().map_err(|e| e.to_string())?;
    let journal = Journal {
        id,
        phase: "prepared".into(),
        preview,
        originals: vec![],
        recovery_backup,
    };
    write_journal(&root, &journal)?;
    Ok(journal)
}

fn rename_restore_component(from: &Path, to: &Path) -> std::io::Result<()> {
    // PostgreSQL's Windows child processes can release file handles shortly
    // after pg_ctl reports shutdown. Retry only transient sharing/lock errors;
    // never delete or overwrite a component to work around them.
    for attempt in 0..30 {
        match fs::rename(from, to) {
            Err(error) if cfg!(windows)
                && matches!(error.raw_os_error(), Some(5 | 32 | 33))
                && attempt < 29 => std::thread::sleep(Duration::from_millis(100)),
            result => return result,
        }
    }
    unreachable!()
}

fn move_originals(root: &Path, journal: &mut Journal) -> Result<(), String> {
    journal.originals = COMPONENTS
        .iter()
        .filter(|name| root.join(name).exists())
        .map(|s| s.to_string())
        .collect();
    journal.phase = "moving".into();
    write_journal(root, journal)?;
    let original = recovery_dir(root, journal).join("original");
    fs::create_dir_all(&original).map_err(|e| e.to_string())?;
    for name in &journal.originals {
        rename_restore_component(&root.join(name), &original.join(name))
            .map_err(|e| format!("Could not preserve {name}: {e}"))?;
    }
    journal.phase = "restoring".into();
    write_journal(root, journal)
}

fn rollback(root: &Path, journal: &mut Journal) -> Result<(), String> {
    let directory = recovery_dir(root, journal);
    let failed = directory.join("failed");
    fs::create_dir_all(&failed).map_err(|e| e.to_string())?;
    for name in COMPONENTS {
        let original = directory.join("original").join(name);
        let live = root.join(name);
        let newly_created =
            journal.phase == "restoring" && !journal.originals.iter().any(|s| s == name);
        if original.exists() || newly_created {
            if live.exists() {
                let destination = failed.join(format!("{name}-{}", current_time_ms()));
                rename_restore_component(&live, &destination)
                    .map_err(|e| format!("Could not quarantine {name}: {e}"))?;
            }
            if original.exists() {
                rename_restore_component(&original, &live).map_err(|e| format!("Could not recover {name}: {e}"))?;
            }
        }
    }
    journal.phase = "recovered".into();
    write_journal(root, journal)
}

async fn stop(app: &tauri::AppHandle) -> Result<(), String> {
    let process = app.state::<BundledPostgresProcess>();
    let result = bundled_postgres::stop_runtime(app.clone(), &process.0).await?;
    if !result.stopped {
        return Err("PostgreSQL did not stop. No database files have been moved.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn installation_restore_status_command(
    app: tauri::AppHandle,
) -> Result<Option<Journal>, String> {
    // Status may recover an interrupted restore. Queue behind active operations
    // and other status readers, then read the journal under the same lock.
    let _guard = BUSY.lock().await;
    let root = kanqual_data_dir(&app)?;
    let Some(mut journal) = read_journal(&root)? else {
        return Ok(None);
    };
    if MAINTENANCE.load(Ordering::SeqCst)
        && ["moving", "restoring"].contains(&journal.phase.as_str())
    {
        stop(&app).await?;
        rollback(&root, &mut journal)?;
    }
    Ok(Some(journal))
}

#[tauri::command]
pub async fn execute_installation_restore_command(
    app: tauri::AppHandle,
    process: tauri::State<'_, BundledPostgresProcess>,
    auth: tauri::State<'_, PostgresExperimentAuthState>,
    backup_password: String,
    new_admin_password: String,
) -> Result<Journal, String> {
    let _guard = BusyGuard::acquire()?;
    if !MAINTENANCE.load(Ordering::SeqCst) {
        require_admin(&app, &auth).await?;
    }
    let root = kanqual_data_dir(&app)?;
    let mut journal = read_journal(&root)?.ok_or("No restore is prepared.")?;
    if journal.phase != "prepared" {
        return Err("Restart to finish recovery before continuing.".into());
    }
    if new_admin_password.trim().len() < 8 {
        return Err("The new administrator password must contain at least 8 characters.".into());
    }
    let selected = recovery_dir(&root, &journal).join("selected.kanqual-upgrade-backup");
    let (preview, _) = load_preview(&selected, &backup_password)?;
    if preview.fingerprint != journal.preview.fingerprint {
        return Err(
            "The prepared backup has changed. Cancel this restore and select it again.".into(),
        );
    }
    // Authentication and backup validation happen before entering maintenance.
    // Keep maintenance enabled on failure so ordinary screens cannot access a
    // partially restored installation. The durable journal drives recovery.
    MAINTENANCE.store(true, Ordering::SeqCst);
    let _restart_guard = PostgresRuntimeRestartGuard::start();
    clear_postgres_connection_cache(&app);
    stop(&app).await?;
    clear_postgres_connection_cache(&app);
    app.state::<PostgresExperimentProjectSchemaCache>().0.lock().unwrap().clear();
    set_postgres_runtime_auth_session(&auth, None);
    let result = RESTORE_DATABASE_ACCESS.scope((), async {
        move_originals(&root, &mut journal)?;
        restore_postgres_experiment_upgrade_backup_command(
            app.clone(),
            process,
            auth,
            RestorePostgresUpgradeBackupRequest {
                backup_path: selected.to_string_lossy().into_owned(),
                backup_password,
                new_admin_password,
            },
        )
        .await?;
        // A completed journal is the commit point. Until then startup rolls back.
        journal.phase = "complete".into();
        write_journal(&root, &journal)
    })
    .await;
    if let Err(error) = result {
        // Re-read the durable phase rather than a possibly uncommitted value.
        journal = read_journal(&root)?
            .ok_or("Restore journal is missing; recovery files have been retained.")?;
        if ["moving", "restoring"].contains(&journal.phase.as_str()) {
            stop(&app)
                .await
                .map_err(|e| format!("Restore failed: {error}. Recovery awaits restart: {e}"))?;
            rollback(&root, &mut journal)
                .map_err(|e| format!("Restore failed: {error}. Recovery awaits restart: {e}"))?;
        }
        return Err(format!(
            "Restore failed: {error}. Previous installation preserved; restart KanQual."
        ));
    }
    Ok(journal)
}

#[tauri::command]
pub async fn finish_installation_restore_command(
    app: tauri::AppHandle,
    auth: tauri::State<'_, PostgresExperimentAuthState>,
    cancel: bool,
) -> Result<(), String> {
    let _guard = BusyGuard::acquire()?;
    let root = kanqual_data_dir(&app)?;
    let journal = read_journal(&root)?.ok_or("No restore is prepared.")?;
    if !MAINTENANCE.load(Ordering::SeqCst) {
        require_admin(&app, &auth).await?;
    }
    if ["moving", "restoring"].contains(&journal.phase.as_str()) {
        return Err("Recovery must finish before restarting. Close and reopen KanQual.".into());
    }
    if cancel || journal.phase != "prepared" {
        fs::remove_file(root.join(JOURNAL)).map_err(|e| e.to_string())?;
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maintenance_database_access_is_limited_to_restore_task() {
        tauri::async_runtime::block_on(async {
            assert!(database_access_allowed(false));
            assert!(!database_access_allowed(true));
            RESTORE_DATABASE_ACCESS.scope((), async {
                assert!(database_access_allowed(true));
                // Background tasks must not inherit restore privileges.
                assert!(!tokio::spawn(async { database_access_allowed(true) }).await.unwrap());
            }).await;
            assert!(!database_access_allowed(true));
        });
    }

    #[test]
    fn recovery_backup_requires_password_unless_explicitly_skipped() {
        assert!(recovery_backup_password(None, None).is_err());
        assert!(recovery_backup_password(None, Some(false)).is_err());
        assert!(recovery_backup_password(Some("  ".into()), None).is_err());
        assert_eq!(recovery_backup_password(None, Some(true)).unwrap(), None);
        let password = crate::uuid_like_token(32);
        assert_eq!(
            recovery_backup_password(Some(password.clone()), None).unwrap(),
            Some(password.clone())
        );
        assert_eq!(
            recovery_backup_password(Some(password), Some(true)).unwrap(),
            None
        );
    }

    #[test]
    fn status_waits_for_exclusive_restore_access() {
        tauri::async_runtime::block_on(async {
            let operation = BusyGuard::acquire().unwrap();
            assert!(BusyGuard::acquire().is_err());
            let waiting_status = BUSY.lock();
            tokio::pin!(waiting_status);
            assert!(tokio::time::timeout(
                Duration::from_millis(20), &mut waiting_status,
            ).await.is_err());
            drop(operation);
            let status = tokio::time::timeout(
                Duration::from_secs(1), &mut waiting_status,
            ).await.unwrap();
            assert!(BusyGuard::acquire().is_err());
            let next_status = BUSY.lock();
            tokio::pin!(next_status);
            assert!(tokio::time::timeout(
                Duration::from_millis(20), &mut next_status,
            ).await.is_err());
            drop(status);
            let next = tokio::time::timeout(
                Duration::from_secs(1), &mut next_status,
            ).await.unwrap();
            drop(next);
            assert!(BusyGuard::acquire().is_ok());
        });
    }

    #[test]
    #[ignore = "starts an isolated bundled PostgreSQL cluster on a temporary port"]
    fn real_postgres_cluster_survives_interrupted_restore() {
        let bin =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime/postgresql-17/bin");
        // Keep PostgreSQL's mutable files outside the active dev file watcher.
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let data = root.join("postgres/data");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        drop(listener);
        let exe = |name: &str| {
            bin.join(if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_string()
            })
        };
        let run = |name: &str, args: &[&str]| {
            // A Windows server may inherit pg_ctl's captured pipe handles.
            // Wait for pg_ctl itself, not EOF from the long-lived server.
            if name == "pg_ctl" {
                let status = background_process::command(exe(name))
                    .args(args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .unwrap();
                assert!(status.success(), "pg_ctl failed");
                return String::new();
            }
            let result = background_process::command(exe(name))
                .args(args)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}: {}",
                name,
                String::from_utf8_lossy(&result.stderr)
            );
            String::from_utf8_lossy(&result.stdout).to_string()
        };
        struct StopOnDrop(PathBuf, PathBuf);
        impl Drop for StopOnDrop {
            fn drop(&mut self) {
                let _ = background_process::command(&self.0)
                    .arg("-D")
                    .arg(&self.1)
                    .args(["-m", "fast", "-w", "stop"])
                    .output();
            }
        }
        let _stop = StopOnDrop(exe("pg_ctl"), data.clone());
        let data_str = data.to_str().unwrap();
        let log = root.join("test.log");
        let options = format!("-p {port} -h 127.0.0.1");
        let start = || {
            run(
                "pg_ctl",
                &[
                    "-D",
                    data_str,
                    "-l",
                    log.to_str().unwrap(),
                    "-o",
                    &options,
                    "-w",
                    "start",
                ],
            )
        };
        let stop = || run("pg_ctl", &["-D", data_str, "-m", "fast", "-w", "stop"]);
        let sql = |query: &str| {
            run(
                "psql",
                &[
                    "-h",
                    "127.0.0.1",
                    "-p",
                    &port,
                    "-U",
                    "restore_test",
                    "-d",
                    "postgres",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-At",
                    "-c",
                    query,
                ],
            )
        };
        run(
            "initdb",
            &[
                "-D",
                data_str,
                "-U",
                "restore_test",
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ],
        );
        start();
        sql("CREATE TABLE restore_marker (value text); INSERT INTO restore_marker VALUES ('original data');");
        sql("CREATE ROLE kanqual_admin_new; CREATE ROLE researcher;
            CREATE TABLE project_users (id text PRIMARY KEY, app_user_id text UNIQUE NOT NULL,
                email text UNIQUE NOT NULL, role text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
            INSERT INTO project_users (id, app_user_id, email, role) VALUES
                ('admin-row', 'postgres-admin:kanqual_admin_old', 'kanqual_admin_old', 'owner'),
                ('user-row', 'regular-user', 'old-researcher-name', 'administrator'),
                ('import-row', 'imported:project:author', 'author@imported.invalid', 'viewer'),
                ('deleted-row', 'deleted-account', 'former-user', 'viewer');
            CREATE TABLE annotations (author text REFERENCES project_users(id));
            INSERT INTO annotations VALUES ('admin-row');");
        tauri::async_runtime::block_on(async {
            let (client, connection) = tokio_postgres::connect(
                &format!("host=127.0.0.1 port={port} user=restore_test dbname=postgres"),
                NoTls,
            )
            .await
            .unwrap();
            let task = tauri::async_runtime::spawn(connection);
            let restored_accounts =
                HashMap::from([("regular-user".to_string(), "researcher".to_string())]);
            for _ in 0..2 {
                let roles =
                    remap_restored_project_admin(&client, "kanqual_admin_new", &restored_accounts)
                        .await
                        .unwrap();
                assert_eq!(roles, vec!["kanqual_admin_new", "researcher"]);
                for role in roles {
                    // The old administrator role deliberately does not exist.
                    client
                        .batch_execute(&format!(
                            "GRANT SELECT ON annotations TO \"{}\"",
                            sql_escape_identifier(&role)
                        ))
                        .await
                        .unwrap();
                }
            }
            let row = client
                .query_one(
                    "SELECT app_user_id, email, role FROM project_users WHERE id = 'admin-row'",
                    &[],
                )
                .await
                .unwrap();
            assert_eq!(row.get::<_, String>(0), "postgres-admin:kanqual_admin_new");
            assert_eq!(row.get::<_, String>(1), "kanqual_admin_new");
            assert_eq!(row.get::<_, String>(2), "owner");
            let row = client
                .query_one(
                    "SELECT app_user_id, email, role FROM project_users WHERE id = 'user-row'",
                    &[],
                )
                .await
                .unwrap();
            assert_eq!(row.get::<_, String>(0), "regular-user");
            assert_eq!(row.get::<_, String>(1), "old-researcher-name");
            assert_eq!(row.get::<_, String>(2), "administrator");
            assert_eq!(
                client
                    .query_one("SELECT author FROM annotations", &[])
                    .await
                    .unwrap()
                    .get::<_, String>(0),
                "admin-row"
            );
            client.execute("INSERT INTO project_users (id, app_user_id, email, role) VALUES ('historical-admin', 'postgres-admin:kanqual_admin_older', 'kanqual_admin_older', 'owner')", &[]).await.unwrap();
            let roles =
                remap_restored_project_admin(&client, "kanqual_admin_new", &restored_accounts)
                    .await
                    .unwrap();
            assert_eq!(roles, vec!["kanqual_admin_new", "researcher"]);
            assert_eq!(
                client
                    .query_one("SELECT count(*) FROM project_users", &[])
                    .await
                    .unwrap()
                    .get::<_, i64>(0),
                5
            );
            assert_eq!(
                client
                    .query_one(
                        "SELECT email FROM project_users WHERE id = 'import-row'",
                        &[]
                    )
                    .await
                    .unwrap()
                    .get::<_, String>(0),
                "author@imported.invalid"
            );
            assert_eq!(client.query_one("SELECT count(*) FROM pg_roles WHERE rolname IN ('author@imported.invalid', 'former-user', 'old-researcher-name')", &[]).await.unwrap().get::<_, i64>(0), 0);
            task.abort();
        });
        stop();
        fs::create_dir_all(root.join("postgres-projects/project")).unwrap();
        fs::write(
            root.join("postgres-projects/project/source.txt"),
            "original source",
        )
        .unwrap();
        let mut journal = Journal {
            id: "123".into(),
            phase: "prepared".into(),
            originals: vec![],
            recovery_backup: "test".into(),
            preview: Preview {
                fingerprint: "test".into(),
                version: "test".into(),
                created_at_ms: 0,
                projects: vec![],
                file_count: 0,
                user_count: None,
            },
        };
        move_originals(root, &mut journal).unwrap();
        // Simulate a fresh replacement database and a failure after SQL import.
        run(
            "initdb",
            &[
                "-D",
                data_str,
                "-U",
                "restore_test",
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ],
        );
        start();
        sql("CREATE TABLE replacement_only (value text);");
        stop();
        let mut recovered_journal = read_journal(root).unwrap().unwrap();
        rollback(root, &mut recovered_journal).unwrap();
        start();
        assert_eq!(
            sql("SELECT value FROM restore_marker").trim(),
            "original data"
        );
        assert_eq!(
            sql("SELECT count(*) FROM pg_tables WHERE tablename = 'replacement_only'").trim(),
            "0"
        );
        assert_eq!(
            fs::read_to_string(root.join("postgres-projects/project/source.txt")).unwrap(),
            "original source"
        );
        stop();
    }

    fn fixture() -> (PathBuf, Journal) {
        let root = std::env::temp_dir().join(format!(
            "kanqual-restore-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(root.join("postgres")).unwrap();
        fs::write(root.join("postgres/old"), "original").unwrap();
        let journal = Journal {
            id: "123".into(),
            phase: "prepared".into(),
            originals: vec![],
            recovery_backup: "test".into(),
            preview: Preview {
                fingerprint: "hash".into(),
                version: "test".into(),
                created_at_ms: 0,
                projects: vec![],
                file_count: 0,
                user_count: None,
            },
        };
        (root, journal)
    }
    #[test]
    fn interrupted_restore_recovers_original_and_keeps_failed_data() {
        for skip_backup in [false, true] {
            let (root, mut journal) = fixture();
            if skip_backup { journal.recovery_backup.clear(); }
            move_originals(&root, &mut journal).unwrap();
            journal = read_journal(&root).unwrap().unwrap();
            assert_eq!(journal.recovery_backup.is_empty(), skip_backup);
            fs::create_dir_all(root.join("postgres")).unwrap();
            fs::write(root.join("postgres/new"), "partial").unwrap();
            fs::write(root.join(POSTGRES_RUNTIME_CONFIG_FILE), "new config").unwrap();
            rollback(&root, &mut journal).unwrap();
            assert_eq!(
                fs::read_to_string(root.join("postgres/old")).unwrap(),
                "original"
            );
            assert!(!root.join(POSTGRES_RUNTIME_CONFIG_FILE).exists());
            assert_eq!(
                fs::read_dir(recovery_dir(&root, &journal).join("failed"))
                    .unwrap()
                    .count(),
                2
            );
            rollback(&root, &mut journal).unwrap();
            assert!(root.join("postgres/old").exists());
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn partial_move_is_recoverable() {
        let (root, mut journal) = fixture();
        journal.phase = "moving".into();
        journal.originals = vec!["postgres".into(), POSTGRES_RUNTIME_CONFIG_FILE.into()];
        fs::write(root.join(POSTGRES_RUNTIME_CONFIG_FILE), "original config").unwrap();
        let original = recovery_dir(&root, &journal).join("original");
        fs::create_dir_all(&original).unwrap();
        fs::rename(root.join("postgres"), original.join("postgres")).unwrap();
        rollback(&root, &mut journal).unwrap();
        assert!(root.join("postgres/old").exists());
        assert_eq!(
            fs::read_to_string(root.join(POSTGRES_RUNTIME_CONFIG_FILE)).unwrap(),
            "original config"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn counts_copy_users_without_counting_other_tables() {
        assert_eq!(
            copy_user_count(
                "COPY public.app_users (id, username) FROM stdin;\na\tb\nc\td\n\\.\nCOPY other"
            ),
            Some(2)
        );
        assert_eq!(
            copy_user_count("COPY public.app_users (id) FROM stdin;\n\\."),
            Some(0)
        );
        assert_eq!(copy_user_count("INSERT INTO app_users"), None);
    }

    #[test]
    fn encrypted_preview_validates_password_and_dump_integrity() {
        let (root, _) = fixture();
        let sql = "COPY public.app_users (id, username) FROM stdin;\nu1\tAlice\n\\.";
        let checksum = sha256_hex(sql.as_bytes());
        let mut backup = serde_json::json!({
            "kind": "kanqual-full-backend-upgrade-backup", "version": 1,
            "kanqualVersion": "0.9.7", "createdAtMs": 123,
            "manifest": { "kanqualVersion": "0.9.7", "postgresVersion": "17",
                "backupFormatVersion": "1", "controlDatabase": "control",
                "controlDumpSha256": checksum, "backupReason": "test",
                "platform": "test", "architecture": "test", "controlSchemaVersions": [1] },
            "controlDump": { "sql": sql, "sha256": checksum },
            "projects": [], "projectDumps": [], "projectStorageFiles": []
        });
        let password = generate_temporary_password();
        let path = root.join("backup");
        let encrypted = encrypt_backup_payload_text(backup.to_string(), password.clone()).unwrap();
        fs::write(&path, &encrypted).unwrap();
        let (preview, _) = load_preview(&path, &password).unwrap();
        assert_eq!(preview.user_count, Some(1));
        assert_eq!(preview.fingerprint, sha256_hex(encrypted.as_bytes()));
        assert!(load_preview(&path, &generate_temporary_password()).is_err());
        backup["controlDump"]["sql"] = Value::String("tampered SQL".into());
        fs::write(
            &path,
            encrypt_backup_payload_text(backup.to_string(), password.clone()).unwrap(),
        )
        .unwrap();
        assert!(load_preview(&path, &password).is_err());
        assert!(root.join("postgres/old").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_journal_rejects_paths_outside_recovery_directory() {
        let (root, mut journal) = fixture();
        journal.id = "../outside".into();
        write_journal(&root, &journal).unwrap();
        assert!(read_journal(&root).is_err());
        journal.id = "123".into();
        journal.originals = vec!["../outside".into()];
        write_journal(&root, &journal).unwrap();
        assert!(read_journal(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
