use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const BUNDLED_POSTGRES_VERSION: &str = "17";
const BUNDLED_POSTGRES_DIR_NAME: &str = "postgresql-17";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPostgresPaths {
    pub distribution: String,
    pub expected_version: String,
    pub app_resource_dir: Option<String>,
    pub executable_dir: String,
    pub runtime_root: String,
    pub bin_dir: String,
    pub postgres_binary: String,
    pub initdb_binary: String,
    pub pg_ctl_binary: String,
    pub psql_binary: String,
    pub pg_dump_binary: String,
    pub data_root: String,
    pub app_logs_dir: String,
    pub runtime_diagnostics_log: String,
    pub postgres_root: String,
    pub data_dir: String,
    pub logs_dir: String,
    pub run_dir: String,
    pub config_dir: String,
    pub backups_root: String,
    pub automatic_backups_dir: String,
    pub manual_backups_dir: String,
    pub upgrade_backups_dir: String,
    pub exports_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPostgresStatus {
    pub paths: BundledPostgresPaths,
    pub runtime_root_exists: bool,
    pub bin_dir_exists: bool,
    pub postgres_binary_exists: bool,
    pub initdb_binary_exists: bool,
    pub pg_ctl_binary_exists: bool,
    pub psql_binary_exists: bool,
    pub pg_dump_binary_exists: bool,
    pub data_root_exists: bool,
    pub postgres_root_exists: bool,
    pub data_dir_exists: bool,
    pub initialized: bool,
    pub initialized_version: Option<String>,
    pub expected_version_matches: Option<bool>,
    pub reachable: bool,
    pub probe_host: String,
    pub probe_port: u16,
    pub postmaster_pid_exists: bool,
    pub postmaster_pid: Option<u32>,
    pub postmaster_pid_running: Option<bool>,
    pub latest_log_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPostgresInitPreflight {
    pub status: BundledPostgresStatus,
    pub data_root_writable: bool,
    pub data_dir_empty_or_missing: bool,
    pub required_binaries_available: bool,
    pub default_port_available: bool,
    pub can_initialize: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPostgresInitializeResult {
    pub status: BundledPostgresStatus,
    pub postgresql_conf_path: String,
    pub pg_hba_conf_path: String,
    pub initdb_stdout: String,
    pub initdb_stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPostgresRuntimeResult {
    pub status: BundledPostgresStatus,
    pub process_managed: bool,
    pub process_id: Option<u32>,
    pub started: bool,
    pub stopped: bool,
    pub recovered_stale_pid: bool,
    pub message: String,
}

fn path_string(path: &Path) -> String {
    normalize_path_string(path.to_string_lossy().as_ref())
}

fn normalize_path_string(path: &str) -> String {
    #[cfg(windows)]
    {
        if let Some(stripped) = path.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
        if let Some(stripped) = path.strip_prefix("//?/") {
            return stripped.to_string();
        }
    }
    path.to_string()
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn append_runtime_diagnostics_event(
    app: &tauri::AppHandle,
    event: &str,
    outcome: &str,
    message: &str,
    details: serde_json::Value,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    fs::create_dir_all(&paths.app_logs_dir).map_err(|e| {
        format!(
            "Could not create Kanqual runtime diagnostics directory at {}: {e}",
            paths.app_logs_dir
        )
    })?;
    let entry = serde_json::json!({
        "timestampMs": current_time_ms(),
        "event": event,
        "outcome": outcome,
        "message": message,
        "details": details,
    });
    let serialized = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.runtime_diagnostics_log)
        .map_err(|e| {
            format!(
                "Could not open Kanqual runtime diagnostics log at {}: {e}",
                paths.runtime_diagnostics_log
            )
        })?;
    writeln!(file, "{serialized}").map_err(|e| {
        format!(
            "Could not write Kanqual runtime diagnostics log at {}: {e}",
            paths.runtime_diagnostics_log
        )
    })
}

fn append_runtime_diagnostics_event_best_effort(
    app: &tauri::AppHandle,
    event: &str,
    outcome: &str,
    message: &str,
    details: serde_json::Value,
) {
    if let Err(error) = append_runtime_diagnostics_event(app, event, outcome, message, details) {
        eprintln!("[kanqual] Could not write runtime diagnostics event: {error}");
    }
}

fn executable_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn bundled_runtime_root(
    app: &tauri::AppHandle,
    executable_dir: &Path,
    portable_mode: bool,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    if portable_mode {
        return Ok((
            executable_dir
                .join("runtime")
                .join(BUNDLED_POSTGRES_DIR_NAME),
            app.path().resource_dir().ok(),
        ));
    }

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let primary_runtime_root = resource_dir.join("runtime").join(BUNDLED_POSTGRES_DIR_NAME);
    let dev_runtime_root = resource_dir
        .join("resources")
        .join("runtime")
        .join(BUNDLED_POSTGRES_DIR_NAME);
    let runtime_root = if primary_runtime_root.exists() || !dev_runtime_root.exists() {
        primary_runtime_root
    } else {
        dev_runtime_root
    };
    Ok((runtime_root, Some(resource_dir)))
}

pub fn resolve_paths(app: &tauri::AppHandle) -> Result<BundledPostgresPaths, String> {
    let portable_mode = crate::is_portable_mode()?;
    let executable_dir = crate::executable_dir()?;
    let (runtime_root, app_resource_dir) =
        bundled_runtime_root(app, &executable_dir, portable_mode)?;
    let bin_dir = runtime_root.join("bin");
    let data_root = crate::kanqual_data_dir(app)?;
    let app_logs_dir = data_root.join("logs");
    let postgres_root = data_root.join("postgres");
    let backups_root = data_root.join("backups");
    let exports_root = data_root.join("exports");

    Ok(BundledPostgresPaths {
        distribution: if portable_mode {
            "portable".to_string()
        } else {
            "installed".to_string()
        },
        expected_version: BUNDLED_POSTGRES_VERSION.to_string(),
        app_resource_dir: app_resource_dir.as_deref().map(path_string),
        executable_dir: path_string(&executable_dir),
        runtime_root: path_string(&runtime_root),
        bin_dir: path_string(&bin_dir),
        postgres_binary: path_string(&bin_dir.join(executable_name("postgres"))),
        initdb_binary: path_string(&bin_dir.join(executable_name("initdb"))),
        pg_ctl_binary: path_string(&bin_dir.join(executable_name("pg_ctl"))),
        psql_binary: path_string(&bin_dir.join(executable_name("psql"))),
        pg_dump_binary: path_string(&bin_dir.join(executable_name("pg_dump"))),
        data_root: path_string(&data_root),
        app_logs_dir: path_string(&app_logs_dir),
        runtime_diagnostics_log: path_string(&app_logs_dir.join("runtime-diagnostics.jsonl")),
        postgres_root: path_string(&postgres_root),
        data_dir: path_string(&postgres_root.join("data")),
        logs_dir: path_string(&postgres_root.join("logs")),
        run_dir: path_string(&postgres_root.join("run")),
        config_dir: path_string(&postgres_root.join("config")),
        automatic_backups_dir: path_string(&backups_root.join("automatic")),
        manual_backups_dir: path_string(&backups_root.join("manual")),
        upgrade_backups_dir: path_string(&backups_root.join("upgrade")),
        backups_root: path_string(&backups_root),
        exports_root: path_string(&exports_root),
    })
}

fn initialized_version(data_dir: &str) -> Option<String> {
    let version_path = Path::new(data_dir).join("PG_VERSION");
    fs::read_to_string(version_path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn postmaster_pid_path(paths: &BundledPostgresPaths) -> PathBuf {
    Path::new(&paths.data_dir).join("postmaster.pid")
}

fn read_postmaster_pid(paths: &BundledPostgresPaths) -> Option<u32> {
    let pid_path = postmaster_pid_path(paths);
    fs::read_to_string(pid_path)
        .ok()
        .and_then(|text| text.lines().next().map(str::trim).map(str::to_string))
        .and_then(|line| line.parse::<u32>().ok())
}

#[cfg(windows)]
fn process_is_running(pid: u32) -> Option<bool> {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(
        stdout
            .lines()
            .any(|line| line.contains(&format!("\"{pid}\""))),
    )
}

#[cfg(unix)]
fn process_is_running(pid: u32) -> Option<bool> {
    let status = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .ok()?;
    Some(status.success())
}

#[cfg(not(any(windows, unix)))]
fn process_is_running(_pid: u32) -> Option<bool> {
    None
}

fn latest_log_path(paths: &BundledPostgresPaths) -> Option<String> {
    let logs_dir = Path::new(&paths.logs_dir);
    let entries = fs::read_dir(logs_dir).ok()?;
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path_string(&path))
}

async fn can_reach(host: &str, port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_millis(350),
            tokio::net::TcpStream::connect((host, port)),
        )
        .await,
        Ok(Ok(_))
    )
}

pub async fn wait_until_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if can_reach(host, port).await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn is_empty_dir_or_missing(path: &str) -> bool {
    let path = Path::new(path);
    if !path.exists() {
        return true;
    }
    if !path.is_dir() {
        return false;
    }
    match fs::read_dir(path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => false,
    }
}

fn ensure_parent_runtime_dirs(paths: &BundledPostgresPaths) -> Result<(), String> {
    for path in [
        &paths.postgres_root,
        &paths.app_logs_dir,
        &paths.logs_dir,
        &paths.run_dir,
        &paths.config_dir,
        &paths.backups_root,
        &paths.automatic_backups_dir,
        &paths.manual_backups_dir,
        &paths.upgrade_backups_dir,
        &paths.exports_root,
    ] {
        fs::create_dir_all(path)
            .map_err(|e| format!("Could not create bundled PostgreSQL directory {path}: {e}"))?;
    }
    Ok(())
}

fn check_data_root_writable(paths: &BundledPostgresPaths) -> bool {
    if fs::create_dir_all(&paths.data_root).is_err() {
        return false;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe_path = Path::new(&paths.data_root).join(format!(".kanqual-write-probe-{stamp}.tmp"));
    match fs::write(&probe_path, b"ok") {
        Ok(_) => {
            let _ = fs::remove_file(probe_path);
            true
        }
        Err(_) => false,
    }
}

fn postgres_config_string(path: &str) -> String {
    path.replace('\\', "/").replace('\'', "''")
}

fn subnet_24_for_ipv4(ip: &str) -> Option<String> {
    let parts = ip
        .split('.')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.len() != 4 {
        return None;
    }
    Some(format!("{}.{}.{}.0/24", parts[0], parts[1], parts[2]))
}

fn listen_addresses_for_mode(mode: &str, local_ip: Option<&str>) -> Result<String, String> {
    match mode {
        "network" => {
            let host = local_ip.ok_or_else(|| {
                "Could not detect a local network address for Network mode.".to_string()
            })?;
            Ok(format!("localhost,{host}"))
        }
        "internet" => Ok("*".to_string()),
        _ => Ok("localhost".to_string()),
    }
}

fn hba_remote_cidrs_for_mode(mode: &str, local_ip: Option<&str>) -> Result<Vec<String>, String> {
    if mode == "internet" {
        return Ok(vec!["0.0.0.0/0".to_string(), "::/0".to_string()]);
    }
    if mode == "network" {
        let host = local_ip.ok_or_else(|| {
            "Could not detect a local network address for Network mode.".to_string()
        })?;
        return Ok(vec![
            subnet_24_for_ipv4(host).unwrap_or_else(|| format!("{host}/32"))
        ]);
    }
    Ok(Vec::new())
}

pub fn write_managed_config(
    paths: &BundledPostgresPaths,
    mode: &str,
    _superuser_name: &str,
    _app_role_name: &str,
    local_ip: Option<&str>,
) -> Result<(String, String), String> {
    let data_dir = Path::new(&paths.data_dir);
    let postgresql_conf_path = data_dir.join("postgresql.conf");
    let pg_hba_conf_path = data_dir.join("pg_hba.conf");
    let normalized_mode = match mode {
        "network" | "internet" => mode,
        _ => "device",
    };
    let listen_addresses = listen_addresses_for_mode(normalized_mode, local_ip)?;
    let remote_cidrs = hba_remote_cidrs_for_mode(normalized_mode, local_ip)?;

    let postgresql_conf = format!(
        "\
# Managed by Kanqual bundled PostgreSQL runtime.
# Do not edit directly. Use Kanqual App Settings.
listen_addresses = '{listen_addresses}'
port = {port}
max_connections = 100
shared_buffers = '128MB'
dynamic_shared_memory_type = '{dynamic_shared_memory_type}'
password_encryption = 'scram-sha-256'
logging_collector = on
log_directory = '{log_directory}'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = '1d'
log_rotation_size = '10MB'
log_min_messages = warning
log_min_error_statement = error
datestyle = 'iso, mdy'
timezone = 'UTC'
default_text_search_config = 'pg_catalog.english'
",
        listen_addresses = listen_addresses.replace('\'', "''"),
        port = crate::POSTGRES_DEFAULT_PORT,
        dynamic_shared_memory_type = if cfg!(windows) { "windows" } else { "posix" },
        log_directory = postgres_config_string(&paths.logs_dir),
    );
    fs::write(&postgresql_conf_path, postgresql_conf).map_err(|e| {
        format!(
            "Could not write bundled PostgreSQL config at {}: {e}",
            postgresql_conf_path.display()
        )
    })?;

    let mut hba_lines = vec![
        "# Managed by Kanqual bundled PostgreSQL runtime.".to_string(),
        "# Do not edit directly. Use Kanqual App Settings.".to_string(),
        format!("# Active mode: {normalized_mode}"),
        "host all all 127.0.0.1/32 scram-sha-256".to_string(),
        "host all all ::1/128 scram-sha-256".to_string(),
    ];
    for cidr in remote_cidrs {
        hba_lines.push(format!("host all all {cidr} scram-sha-256"));
    }
    let pg_hba_conf = format!("{}\n", hba_lines.join("\n"));
    fs::write(&pg_hba_conf_path, pg_hba_conf).map_err(|e| {
        format!(
            "Could not write bundled PostgreSQL host access config at {}: {e}",
            pg_hba_conf_path.display()
        )
    })?;

    Ok((
        path_string(&postgresql_conf_path),
        path_string(&pg_hba_conf_path),
    ))
}

fn write_device_mode_config(
    paths: &BundledPostgresPaths,
    superuser_name: &str,
) -> Result<(String, String), String> {
    write_managed_config(paths, "device", superuser_name, "", None)
}

fn remove_password_file(path: &Path) {
    let _ = fs::remove_file(path);
}

pub async fn status(app: tauri::AppHandle) -> Result<BundledPostgresStatus, String> {
    let paths = resolve_paths(&app)?;
    let initialized_version = initialized_version(&paths.data_dir);
    let initialized = initialized_version.is_some();
    let expected_version_matches = initialized_version
        .as_deref()
        .map(|value| value == BUNDLED_POSTGRES_VERSION);
    let probe_host = crate::POSTGRES_DEFAULT_HOST.to_string();
    let probe_port = crate::POSTGRES_DEFAULT_PORT;
    let reachable = can_reach(&probe_host, probe_port).await;
    let pid_path = postmaster_pid_path(&paths);
    let postmaster_pid_exists = pid_path.exists();
    let postmaster_pid = read_postmaster_pid(&paths);
    let postmaster_pid_running = postmaster_pid.and_then(process_is_running);
    let latest_log_path = latest_log_path(&paths);

    Ok(BundledPostgresStatus {
        runtime_root_exists: Path::new(&paths.runtime_root).exists(),
        bin_dir_exists: Path::new(&paths.bin_dir).exists(),
        postgres_binary_exists: Path::new(&paths.postgres_binary).is_file(),
        initdb_binary_exists: Path::new(&paths.initdb_binary).is_file(),
        pg_ctl_binary_exists: Path::new(&paths.pg_ctl_binary).is_file(),
        psql_binary_exists: Path::new(&paths.psql_binary).is_file(),
        pg_dump_binary_exists: Path::new(&paths.pg_dump_binary).is_file(),
        data_root_exists: Path::new(&paths.data_root).exists(),
        postgres_root_exists: Path::new(&paths.postgres_root).exists(),
        data_dir_exists: Path::new(&paths.data_dir).exists(),
        initialized,
        initialized_version,
        expected_version_matches,
        reachable,
        probe_host,
        probe_port,
        postmaster_pid_exists,
        postmaster_pid,
        postmaster_pid_running,
        latest_log_path,
        paths,
    })
}

fn recover_stale_postmaster_pid(
    paths: &BundledPostgresPaths,
    reachable: bool,
) -> Result<bool, String> {
    let pid_path = postmaster_pid_path(paths);
    if reachable || !pid_path.exists() {
        return Ok(false);
    }

    let Some(pid) = read_postmaster_pid(paths) else {
        return Ok(false);
    };
    if process_is_running(pid).unwrap_or(true) {
        return Ok(false);
    }

    fs::remove_file(&pid_path).map_err(|e| {
        format!(
            "Bundled PostgreSQL appears to have a stale process marker at {}, but Kanqual could not remove it: {e}",
            pid_path.display()
        )
    })?;
    eprintln!(
        "[kanqual] Removed stale bundled PostgreSQL postmaster.pid for exited process {pid}."
    );
    Ok(true)
}

pub async fn init_preflight(app: tauri::AppHandle) -> Result<BundledPostgresInitPreflight, String> {
    let status = status(app).await?;
    let data_root_writable = check_data_root_writable(&status.paths);
    let data_dir_empty_or_missing = is_empty_dir_or_missing(&status.paths.data_dir);
    let required_binaries_available = status.postgres_binary_exists
        && status.initdb_binary_exists
        && status.pg_ctl_binary_exists
        && status.psql_binary_exists;
    let default_port_available = !status.reachable;
    let mut issues = Vec::new();

    if !status.runtime_root_exists {
        issues.push("Bundled PostgreSQL runtime root is missing.".to_string());
    }
    if !required_binaries_available {
        issues.push("Required bundled PostgreSQL binaries are missing.".to_string());
    }
    if !data_root_writable {
        issues.push("Kanqual data root is not writable.".to_string());
    }
    if status.initialized {
        issues.push("Bundled PostgreSQL data directory is already initialized.".to_string());
    } else if !data_dir_empty_or_missing {
        issues.push("Bundled PostgreSQL data directory exists but is not empty.".to_string());
    }
    if !default_port_available {
        issues.push(format!(
            "Default PostgreSQL port {} is already reachable.",
            status.probe_port
        ));
    }

    let can_initialize = issues.is_empty();

    Ok(BundledPostgresInitPreflight {
        status,
        data_root_writable,
        data_dir_empty_or_missing,
        required_binaries_available,
        default_port_available,
        can_initialize,
        issues,
    })
}

pub fn prepare_runtime_dirs(app: &tauri::AppHandle) -> Result<BundledPostgresPaths, String> {
    let paths = resolve_paths(app)?;
    ensure_parent_runtime_dirs(&paths)?;
    Ok(paths)
}

pub async fn initialize_cluster(
    app: tauri::AppHandle,
    superuser_name: &str,
    superuser_password: &str,
) -> Result<BundledPostgresInitializeResult, String> {
    let trimmed_name = superuser_name.trim();
    let trimmed_password = superuser_password.trim();
    if trimmed_name.is_empty() {
        return Err("Enter a PostgreSQL administrator username.".to_string());
    }
    if trimmed_password.len() < 8 {
        return Err(
            "Choose a PostgreSQL administrator password with at least 8 characters.".to_string(),
        );
    }

    let preflight = init_preflight(app.clone()).await?;
    if !preflight.can_initialize {
        return Err(format!(
            "Bundled PostgreSQL cannot be initialized yet: {}",
            preflight.issues.join(" ")
        ));
    }

    let paths = prepare_runtime_dirs(&app)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let password_file = Path::new(&paths.run_dir).join(format!("initdb-password-{stamp}.tmp"));
    {
        let mut file = fs::File::create(&password_file).map_err(|e| {
            format!(
                "Could not create temporary PostgreSQL password file at {}: {e}",
                password_file.display()
            )
        })?;
        file.write_all(trimmed_password.as_bytes()).map_err(|e| {
            format!(
                "Could not write temporary PostgreSQL password file at {}: {e}",
                password_file.display()
            )
        })?;
        file.write_all(b"\n").map_err(|e| {
            format!(
                "Could not finish temporary PostgreSQL password file at {}: {e}",
                password_file.display()
            )
        })?;
    }

    let output = Command::new(&paths.initdb_binary)
        .args([
            "-D",
            &paths.data_dir,
            "-U",
            trimmed_name,
            "--pwfile",
            &path_string(&password_file),
            "--encoding",
            "UTF8",
            "--locale",
            "C",
            "--auth",
            "scram-sha-256",
            "--no-instructions",
        ])
        .output()
        .map_err(|e| {
            remove_password_file(&password_file);
            format!("Failed to run bundled PostgreSQL initdb: {e}")
        })?;
    remove_password_file(&password_file);

    let initdb_stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let initdb_stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(format!(
            "Bundled PostgreSQL initdb failed: {}",
            if initdb_stderr.is_empty() {
                initdb_stdout.clone()
            } else {
                initdb_stderr.clone()
            }
        ));
    }

    let (postgresql_conf_path, pg_hba_conf_path) = write_device_mode_config(&paths, trimmed_name)?;
    let status = status(app).await?;
    Ok(BundledPostgresInitializeResult {
        status,
        postgresql_conf_path,
        pg_hba_conf_path,
        initdb_stdout,
        initdb_stderr,
    })
}

pub async fn start_runtime(
    app: tauri::AppHandle,
    child_slot: &std::sync::Mutex<Option<Child>>,
) -> Result<BundledPostgresRuntimeResult, String> {
    let paths = prepare_runtime_dirs(&app)?;
    let current_status = status(app.clone()).await?;
    if !current_status.initialized {
        append_runtime_diagnostics_event_best_effort(
            &app,
            "bundled_postgres.start",
            "skipped",
            "Bundled PostgreSQL data directory is not initialized.",
            serde_json::json!({
                "dataDir": paths.data_dir,
            }),
        );
        return Ok(BundledPostgresRuntimeResult {
            status: current_status,
            process_managed: false,
            process_id: None,
            started: false,
            stopped: false,
            recovered_stale_pid: false,
            message: "Bundled PostgreSQL data directory is not initialized.".to_string(),
        });
    }
    if current_status.expected_version_matches == Some(false) {
        append_runtime_diagnostics_event_best_effort(
            &app,
            "bundled_postgres.start",
            "error",
            "Bundled PostgreSQL data directory version does not match the bundled runtime.",
            serde_json::json!({
                "expectedVersion": BUNDLED_POSTGRES_VERSION,
                "initializedVersion": current_status.initialized_version,
                "dataDir": paths.data_dir,
            }),
        );
        return Err(format!(
            "Bundled PostgreSQL data directory version does not match PostgreSQL {}.",
            BUNDLED_POSTGRES_VERSION
        ));
    }
    if !Path::new(&paths.postgres_binary).is_file() {
        append_runtime_diagnostics_event_best_effort(
            &app,
            "bundled_postgres.start",
            "error",
            "Bundled PostgreSQL postgres binary is missing.",
            serde_json::json!({
                "postgresBinary": paths.postgres_binary,
            }),
        );
        return Err("Bundled PostgreSQL postgres binary is missing.".to_string());
    }
    let recovered_stale_pid = recover_stale_postmaster_pid(&paths, current_status.reachable)?;

    let existing_process_id = {
        let mut guard = child_slot.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                Some(child.id())
            } else {
                *guard = None;
                None
            }
        } else {
            None
        }
    };
    if let Some(process_id) = existing_process_id {
        let ready = wait_until_reachable(
            crate::POSTGRES_DEFAULT_HOST,
            crate::POSTGRES_DEFAULT_PORT,
            Duration::from_secs(8),
        )
        .await;
        let next_status = status(app.clone()).await?;
        append_runtime_diagnostics_event_best_effort(
            &app,
            "bundled_postgres.start",
            if ready {
                "already_running"
            } else {
                "not_ready"
            },
            if ready {
                "Bundled PostgreSQL managed process is already running."
            } else {
                "Bundled PostgreSQL managed process exists but is not reachable yet."
            },
            serde_json::json!({
                "processId": process_id,
                "host": crate::POSTGRES_DEFAULT_HOST,
                "port": crate::POSTGRES_DEFAULT_PORT,
                "reachable": ready,
                "recoveredStalePid": recovered_stale_pid,
            }),
        );
        return Ok(BundledPostgresRuntimeResult {
            status: next_status,
            process_managed: true,
            process_id: Some(process_id),
            started: false,
            stopped: false,
            recovered_stale_pid,
            message: if ready {
                "Bundled PostgreSQL is already running.".to_string()
            } else {
                "Bundled PostgreSQL process is running but is not reachable yet.".to_string()
            },
        });
    }

    if current_status.reachable {
        append_runtime_diagnostics_event_best_effort(
            &app,
            "bundled_postgres.start",
            "already_reachable",
            "PostgreSQL is already reachable on the configured local port.",
            serde_json::json!({
                "host": crate::POSTGRES_DEFAULT_HOST,
                "port": crate::POSTGRES_DEFAULT_PORT,
                "processManaged": false,
            }),
        );
        return Ok(BundledPostgresRuntimeResult {
            status: current_status,
            process_managed: false,
            process_id: None,
            started: false,
            stopped: false,
            recovered_stale_pid: false,
            message: "PostgreSQL is already reachable on the configured local port.".to_string(),
        });
    }

    let child = Command::new(&paths.postgres_binary)
        .arg("-D")
        .arg(&paths.data_dir)
        .current_dir(&paths.bin_dir)
        .env("PGDATA", &paths.data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            append_runtime_diagnostics_event_best_effort(
                &app,
                "bundled_postgres.start",
                "error",
                "Failed to spawn bundled PostgreSQL.",
                serde_json::json!({
                    "postgresBinary": paths.postgres_binary,
                    "dataDir": paths.data_dir,
                    "error": e.to_string(),
                }),
            );
            format!("Failed to start bundled PostgreSQL: {e}")
        })?;
    let process_id = Some(child.id());
    {
        let mut guard = child_slot.lock().unwrap();
        *guard = Some(child);
    }

    let ready = wait_until_reachable(
        crate::POSTGRES_DEFAULT_HOST,
        crate::POSTGRES_DEFAULT_PORT,
        Duration::from_secs(15),
    )
    .await;
    let next_status = status(app.clone()).await?;
    append_runtime_diagnostics_event_best_effort(
        &app,
        "bundled_postgres.start",
        if ready { "started" } else { "timeout" },
        if ready {
            if recovered_stale_pid {
                "Bundled PostgreSQL started after clearing a stale process marker."
            } else {
                "Bundled PostgreSQL started."
            }
        } else {
            "Bundled PostgreSQL was launched but did not become reachable before the timeout."
        },
        serde_json::json!({
            "processId": process_id,
            "host": crate::POSTGRES_DEFAULT_HOST,
            "port": crate::POSTGRES_DEFAULT_PORT,
            "reachable": ready,
            "recoveredStalePid": recovered_stale_pid,
            "latestLogPath": next_status.latest_log_path,
        }),
    );
    Ok(BundledPostgresRuntimeResult {
        status: next_status,
        process_managed: true,
        process_id,
        started: ready,
        stopped: false,
        recovered_stale_pid,
        message: if ready {
            if recovered_stale_pid {
                "Bundled PostgreSQL started after clearing a stale process marker.".to_string()
            } else {
                "Bundled PostgreSQL started.".to_string()
            }
        } else {
            "Bundled PostgreSQL was launched but did not become reachable before the timeout."
                .to_string()
        },
    })
}

pub async fn stop_runtime(
    app: tauri::AppHandle,
    child_slot: &std::sync::Mutex<Option<Child>>,
) -> Result<BundledPostgresRuntimeResult, String> {
    let paths = resolve_paths(&app)?;
    let mut process_id = None;
    {
        let guard = child_slot.lock().unwrap();
        if let Some(child) = guard.as_ref() {
            process_id = Some(child.id());
        }
    }

    let pg_ctl_status = Command::new(&paths.pg_ctl_binary)
        .args(["-D", &paths.data_dir, "-m", "fast", "-w", "stop"])
        .current_dir(&paths.bin_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    {
        let mut guard = child_slot.lock().unwrap();
        if let Some(mut child) = guard.take() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    let stopped = !wait_until_reachable(
        crate::POSTGRES_DEFAULT_HOST,
        crate::POSTGRES_DEFAULT_PORT,
        Duration::from_secs(5),
    )
    .await;
    let next_status = status(app.clone()).await?;
    append_runtime_diagnostics_event_best_effort(
        &app,
        "bundled_postgres.stop",
        if stopped {
            "stopped"
        } else {
            "still_reachable"
        },
        if stopped {
            "Bundled PostgreSQL stopped."
        } else {
            "Bundled PostgreSQL stop was requested, but the local port is still reachable."
        },
        serde_json::json!({
            "processId": process_id,
            "host": crate::POSTGRES_DEFAULT_HOST,
            "port": crate::POSTGRES_DEFAULT_PORT,
            "pgCtlStatus": pg_ctl_status
                .as_ref()
                .ok()
                .and_then(|status| status.code()),
            "pgCtlError": pg_ctl_status
                .as_ref()
                .err()
                .map(|error| error.to_string()),
            "reachableAfterStop": !stopped,
            "latestLogPath": next_status.latest_log_path,
        }),
    );
    Ok(BundledPostgresRuntimeResult {
        status: next_status,
        process_managed: false,
        process_id,
        started: false,
        stopped,
        recovered_stale_pid: false,
        message: if stopped {
            "Bundled PostgreSQL stopped.".to_string()
        } else {
            "Bundled PostgreSQL stop was requested, but the local port is still reachable."
                .to_string()
        },
    })
}

pub fn kill_managed_process(child_slot: &std::sync::Mutex<Option<Child>>) {
    let mut guard = child_slot.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn shutdown_runtime_sync(app: &tauri::AppHandle, child_slot: &std::sync::Mutex<Option<Child>>) {
    if let Ok(paths) = resolve_paths(app) {
        if Path::new(&paths.pg_ctl_binary).is_file() && Path::new(&paths.data_dir).exists() {
            let _ = Command::new(&paths.pg_ctl_binary)
                .args(["-D", &paths.data_dir, "-m", "fast", "-w", "stop"])
                .current_dir(&paths.bin_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    kill_managed_process(child_slot);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_paths(test_name: &str) -> BundledPostgresPaths {
        let root = std::env::temp_dir().join(format!(
            "kanqual-bundled-postgres-{test_name}-{}",
            std::process::id()
        ));
        let app_logs_dir = root.join("logs");
        let data_dir = root.join("postgres").join("data");
        let logs_dir = root.join("postgres").join("logs");
        fs::create_dir_all(&app_logs_dir).expect("create test app logs dir");
        fs::create_dir_all(&data_dir).expect("create test data dir");
        fs::create_dir_all(&logs_dir).expect("create test logs dir");

        BundledPostgresPaths {
            distribution: "test".to_string(),
            expected_version: BUNDLED_POSTGRES_VERSION.to_string(),
            app_resource_dir: None,
            executable_dir: path_string(&root),
            runtime_root: path_string(&root.join("runtime")),
            bin_dir: path_string(&root.join("runtime").join("bin")),
            postgres_binary: path_string(&root.join("runtime").join("bin").join("postgres")),
            initdb_binary: path_string(&root.join("runtime").join("bin").join("initdb")),
            pg_ctl_binary: path_string(&root.join("runtime").join("bin").join("pg_ctl")),
            psql_binary: path_string(&root.join("runtime").join("bin").join("psql")),
            pg_dump_binary: path_string(&root.join("runtime").join("bin").join("pg_dump")),
            data_root: path_string(&root),
            app_logs_dir: path_string(&app_logs_dir),
            runtime_diagnostics_log: path_string(&app_logs_dir.join("runtime-diagnostics.jsonl")),
            postgres_root: path_string(&root.join("postgres")),
            data_dir: path_string(&data_dir),
            logs_dir: path_string(&logs_dir),
            run_dir: path_string(&root.join("postgres").join("run")),
            config_dir: path_string(&root.join("postgres").join("config")),
            backups_root: path_string(&root.join("backups")),
            automatic_backups_dir: path_string(&root.join("backups").join("automatic")),
            manual_backups_dir: path_string(&root.join("backups").join("manual")),
            upgrade_backups_dir: path_string(&root.join("backups").join("upgrade")),
            exports_root: path_string(&root.join("exports")),
        }
    }

    fn cleanup_test_paths(paths: &BundledPostgresPaths) {
        let _ = fs::remove_dir_all(&paths.data_root);
    }

    fn unused_test_pid() -> u32 {
        [
            u32::MAX - 16,
            u32::MAX - 1024,
            999_999_999,
            987_654_321,
            876_543_210,
        ]
        .into_iter()
        .find(|pid| process_is_running(*pid) == Some(false))
        .expect("find an unused pid for stale marker test")
    }

    #[test]
    fn stale_postmaster_pid_is_removed_when_process_is_gone() {
        let paths = test_paths("stale-pid");
        let pid_path = postmaster_pid_path(&paths);
        fs::write(
            &pid_path,
            format!("{}\n{}\n", unused_test_pid(), paths.data_dir),
        )
        .expect("write stale pid marker");

        let recovered =
            recover_stale_postmaster_pid(&paths, false).expect("recover stale pid marker");

        assert!(recovered);
        assert!(!pid_path.exists());
        cleanup_test_paths(&paths);
    }

    #[test]
    fn live_postmaster_pid_is_left_in_place() {
        let paths = test_paths("live-pid");
        let pid_path = postmaster_pid_path(&paths);
        let current_pid = std::process::id();
        fs::write(&pid_path, format!("{current_pid}\n{}\n", paths.data_dir))
            .expect("write live pid marker");

        if process_is_running(current_pid) == Some(true) {
            let recovered =
                recover_stale_postmaster_pid(&paths, false).expect("inspect live pid marker");

            assert!(!recovered);
            assert!(pid_path.exists());
        }
        cleanup_test_paths(&paths);
    }
}
