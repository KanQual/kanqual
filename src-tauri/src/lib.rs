use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::xlm_roberta::{Config as XlmRobertaConfig, XLMRobertaModel};
use rand::distributions::{Alphanumeric, DistString};
use rand::RngCore;
use tauri::Emitter;
use tauri::Manager;
use tauri::webview::WebviewWindowBuilder;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};
use tokio_postgres::{GenericClient, NoTls};
use zeroize::Zeroizing;

const PB_URL: &str = "http://127.0.0.1:8090";
const BACKEND_IDENTITY_FILE: &str = "backend_identity.json";
const POSTGRES_BOOTSTRAP_IDENTITY_FILE: &str = "postgres_bootstrap_identity.json";
const POSTGRES_RUNTIME_CONFIG_FILE: &str = "postgres_runtime_config.json";
const POSTGRES_DEFAULT_HOST: &str = "127.0.0.1";
const POSTGRES_DEFAULT_PORT: u16 = 5432;
const POSTGRES_DEFAULT_SUPERUSER: &str = "postgres";
const POSTGRES_DEFAULT_DATABASE: &str = "kanqual";
const POSTGRES_DEFAULT_APP_ROLE: &str = "kanqual_app";
const POSTGRES_PROJECT_DATABASE_PREFIX: &str = "kq_proj_";
const POSTGRES_WINDOWS_PSQL_PATH: &str = r"C:\Program Files\PostgreSQL\18\bin\psql.exe";
const POSTGRES_WINDOWS_CONF_PATH: &str = r"C:\Program Files\PostgreSQL\18\data\postgresql.conf";
const APP_METADATA_COLLECTION: &str = "app_metadata";
const BACKEND_IDENTIFIER_KEY: &str = "backend_identifier";
const USERS_TABLE_IDENTIFIER_KEY: &str = "users_table_identifier";
const PORTABLE_MODE_MARKER_FILE: &str = "portable-mode.json";
const PORTABLE_DATA_DIR_NAME: &str = "data";
const DEV_DATA_DIR_NAME: &str = "dev";
const EMBEDDING_MODEL_REPO_ID: &str = "intfloat/multilingual-e5-large";
const EMBEDDING_MODEL_DISPLAY_NAME: &str = "multilingual-e5-large";
const EMBEDDING_MODEL_METADATA_FILE: &str = ".kanqual-model.json";
const EMBEDDING_MODEL_EXPECTED_SIZE_BYTES: u64 = 4_499_523_339;
const PROJECT_EMBEDDING_METADATA_FILE: &str = "multilingual-e5-metadata.json";
const PROJECT_EMBEDDING_BUILD_BATCH_SIZE_CAP: usize = 8;
const PROJECT_EMBEDDING_CHUNKING_VERSION: u32 = 2;
const ENCRYPTED_BACKUP_KIND: &str = "kanqual-encrypted-backup";
const ENCRYPTED_BACKUP_VERSION: u32 = 1;
const ENCRYPTED_BACKUP_CIPHER: &str = "aes-256-gcm";
const ENCRYPTED_BACKUP_KDF_NAME: &str = "argon2id";
const ENCRYPTED_BACKUP_ARGON2_MEMORY_KIB: u32 = 65_536;
const ENCRYPTED_BACKUP_ARGON2_ITERATIONS: u32 = 3;
const ENCRYPTED_BACKUP_ARGON2_PARALLELISM: u32 = 1;
const ENCRYPTED_BACKUP_SALT_BYTES: usize = 16;
const ENCRYPTED_BACKUP_NONCE_BYTES: usize = 12;
const AUTH_RULE: &str = "@request.auth.id != ''";
const LARGE_REPORT_SNAPSHOT_MAX: u64 = 2_000_000;

/// Tracks the running PocketBase server process so it can be killed/restarted.
struct PbProcess(Mutex<Option<CommandChild>>);

/// Tracks the current network bind mode: "local" (127.0.0.1) or "lan" (0.0.0.0).
struct NetworkMode(Mutex<String>);

struct ProjectEmbeddingBuildState(Mutex<ProjectEmbeddingBuildStatusState>);
struct CancelledAttributeSuggestionRuns(Mutex<HashSet<String>>);
struct PostgresExperimentAuthState(Mutex<Option<StoredPostgresExperimentAuthSession>>);
struct PostgresExperimentProjectSchemaCache(Mutex<HashSet<String>>);
struct PostgresExperimentConnectionCache(Arc<Mutex<HashMap<String, Vec<tokio_postgres::Client>>>>);

struct PostgresConnectionLease;
struct PostgresExperimentResolvedObjectType {
    id: String,
    name: String,
    system_key: Option<String>,
}

struct CachedPostgresClient {
    cache_key: String,
    client: Option<tokio_postgres::Client>,
    cache: Arc<Mutex<HashMap<String, Vec<tokio_postgres::Client>>>>,
}

impl PostgresConnectionLease {
    fn abort(self) {}
}

impl std::ops::Deref for CachedPostgresClient {
    type Target = tokio_postgres::Client;

    fn deref(&self) -> &Self::Target {
        self.client.as_ref().expect("cached postgres client missing inner client")
    }
}

impl std::ops::DerefMut for CachedPostgresClient {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.client.as_mut().expect("cached postgres client missing inner client")
    }
}

impl Drop for CachedPostgresClient {
    fn drop(&mut self) {
        if let Some(client) = self.client.take() {
            if client.is_closed() {
                return;
            }
            let mut cached_connections = self.cache.lock().unwrap();
            cached_connections
                .entry(self.cache_key.clone())
                .or_default()
                .push(client);
        }
    }
}

/// Poll TCP port 8090 until PocketBase accepts connections or the deadline passes.
async fn wait_for_pb_port(timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::net::TcpStream::connect("127.0.0.1:8090").await.is_ok() {
            return;
        }
        if tokio::time::Instant::now() >= deadline {
            eprintln!("[kanqual] PocketBase did not open port 8090 within {:?}", timeout);
            return;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

fn expected_pocketbase_sidecar_names() -> Vec<&'static str> {
    if cfg!(target_os = "windows") {
        vec!["pocketbase-x86_64-pc-windows-msvc.exe"]
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        vec!["pocketbase-aarch64-apple-darwin"]
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        vec!["pocketbase-x86_64-apple-darwin"]
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        vec!["pocketbase-x86_64-unknown-linux-gnu"]
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        vec!["pocketbase-aarch64-unknown-linux-gnu"]
    } else {
        vec!["pocketbase-<target-triple>"]
    }
}

fn pocketbase_sidecar_error(err: impl std::fmt::Display) -> String {
    let expected = expected_pocketbase_sidecar_names().join(", ");
    format!(
        "PocketBase sidecar is unavailable: {err}. Expected one of [{expected}] under src-tauri/binaries/local when packaging this platform."
    )
}

#[cfg(unix)]
fn ensure_packaged_sidecar_executable() -> Result<(), String> {
    let sidecar_path = executable_dir()?.join("pocketbase");
    if !sidecar_path.exists() {
        return Ok(());
    }

    let mut permissions = fs::metadata(&sidecar_path)
        .map_err(|e| format!("Could not read PocketBase sidecar metadata at {}: {e}", sidecar_path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&sidecar_path, permissions)
        .map_err(|e| format!("Could not mark PocketBase sidecar as executable at {}: {e}", sidecar_path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn ensure_packaged_sidecar_executable() -> Result<(), String> {
    Ok(())
}

/// Spawn a PocketBase serve process with the given bind address.
/// Returns the child handle on success.
fn spawn_pb_serve(app: &tauri::AppHandle, bind: &str, pb_dir_arg: &str, pb_migrations_arg: &str) -> Result<CommandChild, String> {
    ensure_packaged_sidecar_executable()?;
    let http_arg = format!("--http={}", bind);
    let (_, child) = app
        .shell()
        .sidecar("pocketbase")
        .map_err(pocketbase_sidecar_error)?
        .args(["serve", &http_arg, pb_dir_arg, pb_migrations_arg])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(child)
}

fn kill_pocketbase_process(pb_process: &PbProcess) {
    let mut guard = pb_process.0.lock().unwrap();
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

async fn start_local_pocketbase_runtime(
    app: &tauri::AppHandle,
    pb_process: &PbProcess,
    network_mode: &NetworkMode,
) -> Result<(), String> {
    {
        let guard = pb_process.0.lock().unwrap();
        if guard.is_some() {
            let mut mode_guard = network_mode.0.lock().unwrap();
            *mode_guard = "local".to_string();
            return Ok(());
        }
    }

    let app_data_dir = kanqual_data_dir(app)?;
    fs::create_dir_all(&app_data_dir).ok();
    let pb_data_dir = app_data_dir.join("pb_data");
    let pb_dir_arg = format!("--dir={}", pb_data_dir.to_string_lossy());
    let pb_migrations_dir = pb_data_dir.join("pb_app_migrations");
    fs::create_dir_all(&pb_migrations_dir).ok();
    let pb_migrations_arg = format!("--migrationsDir={}", pb_migrations_dir.to_string_lossy());
    ensure_packaged_sidecar_executable()?;

    let backend_identity = load_or_create_backend_identity(app)?;
    let upsert = app
        .shell()
        .sidecar("pocketbase")
        .map_err(pocketbase_sidecar_error)?
        .args([
            "superuser",
            "upsert",
            &backend_identity.superuser_email,
            &backend_identity.superuser_password,
            &pb_dir_arg,
            &pb_migrations_arg,
        ])
        .output();
    if tokio::time::timeout(Duration::from_secs(10), upsert).await.is_err() {
        eprintln!("[kanqual] pocketbase superuser upsert timed out after 10 s");
    }

    let child = spawn_pb_serve(app, "127.0.0.1:8090", &pb_dir_arg, &pb_migrations_arg)?;
    {
        let mut guard = pb_process.0.lock().unwrap();
        *guard = Some(child);
    }

    wait_for_pb_port(Duration::from_secs(30)).await;
    {
        let mut mode_guard = network_mode.0.lock().unwrap();
        *mode_guard = "local".to_string();
    }
    Ok(())
}

fn kanqual_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(smoke_data_dir) = smoke_test_data_dir_override() {
        fs::create_dir_all(&smoke_data_dir).map_err(|e| e.to_string())?;
        return Ok(smoke_data_dir);
    }
    if let Some(portable_dir) = portable_data_dir()? {
        fs::create_dir_all(&portable_dir).map_err(|e| e.to_string())?;
        return Ok(portable_dir);
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if cfg!(debug_assertions) {
        Ok(base.join(DEV_DATA_DIR_NAME))
    } else {
        Ok(base)
    }
}

fn executable_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    exe_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not resolve executable directory.".to_string())
}

fn portable_data_dir() -> Result<Option<PathBuf>, String> {
    let exe_dir = executable_dir()?;
    if exe_dir.join(PORTABLE_MODE_MARKER_FILE).exists() {
        return Ok(Some(exe_dir.join(PORTABLE_DATA_DIR_NAME)));
    }
    Ok(None)
}

fn smoke_test_env_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn smoke_test_enabled() -> bool {
    smoke_test_env_var("KANQUAL_SMOKE_TEST")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn smoke_test_data_dir_override() -> Option<PathBuf> {
    if !smoke_test_enabled() {
        return None;
    }
    smoke_test_env_var("KANQUAL_SMOKE_DATA_DIR").map(PathBuf::from)
}

fn smoke_test_state_path() -> Option<PathBuf> {
    if !smoke_test_enabled() {
        return None;
    }
    smoke_test_env_var("KANQUAL_SMOKE_STATE_PATH").map(PathBuf::from)
}

fn write_smoke_test_state(_app: &tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let Some(state_path) = smoke_test_state_path() else {
        return Ok(());
    };

    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let temp_path = state_path.with_extension(format!(
        "{}.tmp",
        state_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("json")
    ));
    fs::write(&temp_path, serialized).map_err(|e| e.to_string())?;
    if state_path.exists() {
        fs::remove_file(&state_path).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_path, &state_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn is_portable_mode() -> Result<bool, String> {
    Ok(portable_data_dir()?.is_some())
}

fn webview_data_dir(app: &tauri::AppHandle, label: &str) -> Result<PathBuf, String> {
    Ok(kanqual_data_dir(app)?.join("webview").join(label))
}

fn create_configured_window(app: &mut tauri::App, label: &str) -> Result<(), String> {
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == label)
        .ok_or_else(|| format!("Could not find window config for label `{label}`."))?;

    let data_dir = webview_data_dir(&app.app_handle(), label)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    WebviewWindowBuilder::from_config(app.handle(), window_config)
        .map_err(|e| e.to_string())?
        .data_directory(data_dir)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}


fn backend_identity_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(kanqual_data_dir(app)?.join(BACKEND_IDENTITY_FILE))
}

fn postgres_bootstrap_identity_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(kanqual_data_dir(app)?.join(POSTGRES_BOOTSTRAP_IDENTITY_FILE))
}

fn postgres_runtime_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(kanqual_data_dir(app)?.join(POSTGRES_RUNTIME_CONFIG_FILE))
}

fn generate_backend_identity() -> BackendIdentity {
    let suffix = Alphanumeric.sample_string(&mut rand::rngs::OsRng, 24).to_lowercase();
    let password = Alphanumeric.sample_string(&mut rand::rngs::OsRng, 48);
    BackendIdentity {
        version: 1,
        superuser_email: format!("app-{}@kanqual.internal", suffix),
        superuser_password: password,
        created_at_ms: current_time_ms(),
    }
}

fn generate_postgres_bootstrap_identity() -> PostgresBootstrapIdentity {
    PostgresBootstrapIdentity {
        version: 1,
        host: POSTGRES_DEFAULT_HOST.to_string(),
        port: POSTGRES_DEFAULT_PORT,
        superuser_name: POSTGRES_DEFAULT_SUPERUSER.to_string(),
        temporary_superuser_password: generate_temporary_password(),
        app_database: POSTGRES_DEFAULT_DATABASE.to_string(),
        app_role_name: POSTGRES_DEFAULT_APP_ROLE.to_string(),
        app_role_password: generate_temporary_password(),
        bootstrap_applied: false,
        admin_handoff_completed: false,
        created_at_ms: current_time_ms(),
    }
}

fn postgres_runtime_config_from_identity(identity: &PostgresBootstrapIdentity) -> PostgresRuntimeConfig {
    PostgresRuntimeConfig {
        version: 1,
        host: identity.host.clone(),
        port: identity.port,
        database: identity.app_database.clone(),
        user: identity.app_role_name.clone(),
        password: identity.app_role_password.clone(),
        ready: identity.bootstrap_applied,
        updated_at_ms: current_time_ms(),
    }
}

fn generate_identifier() -> String {
    uuid_like_token(36)
}

fn generate_temporary_password() -> String {
    format!("Kanqual-{}!", uuid_like_token(12))
}

fn uuid_like_token(len: usize) -> String {
    let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = vec![0_u8; len];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
        .into_iter()
        .map(|byte| alphabet[(byte as usize) % alphabet.len()] as char)
        .collect()
}

fn load_or_create_backend_identity(app: &tauri::AppHandle) -> Result<BackendIdentity, String> {
    let data_dir = kanqual_data_dir(app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let path = backend_identity_path(app)?;
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(identity) = serde_json::from_str::<BackendIdentity>(&text) {
                if !identity.superuser_email.trim().is_empty() && !identity.superuser_password.trim().is_empty() {
                    return Ok(identity);
                }
            }
        }
    }

    let identity = generate_backend_identity();
    let serialized = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(identity)
}

fn load_or_create_postgres_bootstrap_identity(
    app: &tauri::AppHandle,
) -> Result<PostgresBootstrapIdentity, String> {
    let data_dir = kanqual_data_dir(app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let path = postgres_bootstrap_identity_path(app)?;
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(identity) = serde_json::from_str::<PostgresBootstrapIdentity>(&text) {
                if !identity.superuser_name.trim().is_empty()
                    && !identity.app_role_name.trim().is_empty()
                    && !identity.app_role_password.trim().is_empty()
                    && (identity.admin_handoff_completed || !identity.temporary_superuser_password.trim().is_empty())
                {
                    return Ok(identity);
                }
            }
        }
    }

    let identity = generate_postgres_bootstrap_identity();
    let serialized = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(identity)
}

fn save_postgres_runtime_config(app: &tauri::AppHandle, config: &PostgresRuntimeConfig) -> Result<(), String> {
    let path = postgres_runtime_config_path(app)?;
    let serialized = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).map_err(|e| e.to_string())
}

fn load_postgres_runtime_config(app: &tauri::AppHandle) -> Result<PostgresRuntimeConfig, String> {
    let identity = load_or_create_postgres_bootstrap_identity(app)?;
    let fallback = postgres_runtime_config_from_identity(&identity);
    let path = postgres_runtime_config_path(app)?;
    if path.exists() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<PostgresRuntimeConfig>(&text) {
                if !config.host.trim().is_empty()
                    && !config.database.trim().is_empty()
                    && !config.user.trim().is_empty()
                    && !config.password.trim().is_empty()
                {
                    return Ok(config);
                }
            }
        }
    }
    save_postgres_runtime_config(app, &fallback)?;
    Ok(fallback)
}

async fn can_reach_postgres(host: &str, port: u16, timeout: Duration) -> bool {
    matches!(
        tokio::time::timeout(timeout, tokio::net::TcpStream::connect((host, port))).await,
        Ok(Ok(_))
    )
}

fn postgres_psql_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        PathBuf::from(POSTGRES_WINDOWS_PSQL_PATH)
    } else {
        PathBuf::from("psql")
    }
}

fn postgres_conf_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        PathBuf::from(POSTGRES_WINDOWS_CONF_PATH)
    } else {
        PathBuf::from("postgresql.conf")
    }
}

fn sql_escape_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn sql_escape_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}

async fn ensure_postgres_experiment_text_array_column(
    client: &tokio_postgres::Client,
    table_name: &str,
    column_name: &str,
    legacy_single_value_column_name: &str,
) -> Result<(), String> {
    let column_metadata = client
        .query_opt(
            "
            SELECT data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
            ",
            &[&table_name, &column_name],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment schema column {table_name}.{column_name}: {e}"))?;

    let has_text_array_type = column_metadata.as_ref().is_some_and(|row| {
        let data_type: String = row.get(0);
        let udt_name: String = row.get(1);
        data_type == "ARRAY" && udt_name == "_text"
    });

    let escaped_table_name = format!("\"{}\"", sql_escape_identifier(table_name));
    let escaped_column_name = format!("\"{}\"", sql_escape_identifier(column_name));
    let escaped_legacy_column_name = format!("\"{}\"", sql_escape_identifier(legacy_single_value_column_name));

    if !has_text_array_type {
        if column_metadata.is_some() {
            client
                .batch_execute(
                    format!("ALTER TABLE {escaped_table_name} DROP COLUMN {escaped_column_name};").as_str(),
                )
                .await
                .map_err(|e| {
                    format!(
                        "Could not reset PostgreSQL experiment schema column {table_name}.{column_name}: {e}"
                    )
                })?;
        }

        client
            .batch_execute(
                format!(
                    "
                    ALTER TABLE {escaped_table_name} ADD COLUMN {escaped_column_name} TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
                    UPDATE {escaped_table_name}
                    SET {escaped_column_name} = CASE
                        WHEN {escaped_legacy_column_name} IS NOT NULL AND TRIM({escaped_legacy_column_name}) <> '' THEN ARRAY[{escaped_legacy_column_name}]
                        ELSE ARRAY[]::TEXT[]
                    END;
                    "
                )
                .as_str(),
            )
            .await
            .map_err(|e| {
                format!(
                    "Could not recreate PostgreSQL experiment schema column {table_name}.{column_name}: {e}"
                )
            })?;
        return Ok(());
    }

    client
        .batch_execute(
            format!(
                "
                UPDATE {escaped_table_name}
                SET {escaped_column_name} = COALESCE({escaped_column_name}, ARRAY[]::TEXT[]);
                UPDATE {escaped_table_name}
                SET {escaped_column_name} = ARRAY[{escaped_legacy_column_name}]
                WHERE cardinality({escaped_column_name}) = 0
                  AND {escaped_legacy_column_name} IS NOT NULL
                  AND TRIM({escaped_legacy_column_name}) <> '';
                "
            )
            .as_str(),
        )
        .await
        .map_err(|e| {
            format!("Could not normalize PostgreSQL experiment schema column {table_name}.{column_name}: {e}")
        })?;

    Ok(())
}

fn run_psql_command(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    sql: &str,
) -> Result<String, String> {
    let output = Command::new(postgres_psql_path())
        .env("PGPASSWORD", password)
        .args([
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            host,
            "-p",
            &port.to_string(),
            "-U",
            user,
            "-d",
            database,
            "-tAc",
            sql,
        ])
        .output()
        .map_err(|e| format!("Failed to run psql: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

async fn connect_postgres_runtime(
    app: &tauri::AppHandle,
) -> Result<(CachedPostgresClient, PostgresConnectionLease), String> {
    let config = load_postgres_runtime_config(app)?;
    connect_postgres_database_with_config(app, &config).await
}

async fn connect_postgres_database(
    app: &tauri::AppHandle,
    database: &str,
) -> Result<(CachedPostgresClient, PostgresConnectionLease), String> {
    let mut config = load_postgres_runtime_config(app)?;
    config.database = database.to_string();
    connect_postgres_database_with_config(app, &config).await
}

fn postgres_connection_cache_key(config: &PostgresRuntimeConfig) -> String {
    format!("{}:{}:{}:{}", config.host, config.port, config.user, config.database)
}

async fn connect_postgres_database_with_config(
    app: &tauri::AppHandle,
    config: &PostgresRuntimeConfig,
) -> Result<(CachedPostgresClient, PostgresConnectionLease), String> {
    let cache_key = postgres_connection_cache_key(config);
    let connection_cache = app.state::<PostgresExperimentConnectionCache>();
    let cache_handle = connection_cache.0.clone();
    {
        let mut cached_connections = cache_handle.lock().unwrap();
        if let Some(clients) = cached_connections.get_mut(&cache_key) {
            while let Some(client) = clients.pop() {
                if !client.is_closed() {
                    return Ok((
                        CachedPostgresClient {
                            cache_key,
                            client: Some(client),
                            cache: cache_handle.clone(),
                        },
                        PostgresConnectionLease,
                    ));
                }
            }
        }
    }

    let connection_string = format!(
        "host={} port={} dbname={} user={} password={}",
        config.host, config.port, config.database, config.user, config.password
    );
    let (client, connection) = tokio_postgres::connect(&connection_string, NoTls)
        .await
        .map_err(|e| format!("Could not connect to PostgreSQL runtime: {e}"))?;
    let task = tokio::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("[kanqual] postgres runtime connection error: {error}");
        }
    });
    drop(task);
    Ok((
        CachedPostgresClient {
            cache_key,
            client: Some(client),
            cache: cache_handle,
        },
        PostgresConnectionLease,
    ))
}

fn default_postgres_experiment_installation_settings() -> PostgresExperimentInstallationSettings {
    PostgresExperimentInstallationSettings {
        startup_reopen_last_project: false,
        document_import_default_mode: "upload".to_string(),
        document_import_auto_name_from_file: true,
        document_import_trim_imported_text: true,
        document_import_warn_before_empty_import: true,
        privacy_mask_file_paths: false,
        privacy_clear_recent_projects_on_sign_out: false,
        privacy_forget_login_identities_on_logout: false,
        updates_auto_check: true,
        llm: default_postgres_experiment_llm_settings(),
    }
}

fn default_postgres_experiment_user_preferences() -> PostgresExperimentUserPreferences {
    PostgresExperimentUserPreferences {
        theme: "light".to_string(),
        density: "comfortable".to_string(),
        font_size: "normal".to_string(),
        locale: "en".to_string(),
        recent_project_limit: 10,
        theme_state: default_postgres_experiment_theme_state(),
    }
}

fn default_postgres_experiment_theme_state() -> PostgresExperimentThemeState {
    PostgresExperimentThemeState {
        light_overrides: HashMap::new(),
        dark_overrides: HashMap::new(),
        border_radius: 6,
        border_width: 1,
        presets: Vec::new(),
        active_preset_id: None,
    }
}

fn default_postgres_experiment_llm_settings() -> PostgresExperimentLlmSettings {
    PostgresExperimentLlmSettings {
        chunk_size: 1800,
        overlap_size: 100,
        batch_size: 16,
        prefix_passages: true,
        prefix_queries: true,
        normalize_whitespace: true,
        connection_mode: "none".to_string(),
        cloud_provider: "openai".to_string(),
        cloud_api_secret: String::new(),
        cloud_selected_model: String::new(),
        ollama_enabled: false,
        ollama_protocol: "http".to_string(),
        ollama_host: "127.0.0.1".to_string(),
        ollama_port: 11434,
        ollama_selected_model: String::new(),
        ollama_request_timeout_seconds: 120,
        ollama_document_processing_timeout_seconds: 1800,
        ollama_temperature: 0.2,
        ollama_num_ctx: 8192,
        ollama_keep_alive_minutes: 10,
        ollama_relevant_segments_candidate_limit: 12,
        ollama_relevant_segments_max_results: 6,
    }
}

fn default_postgres_experiment_device_state() -> PostgresExperimentDeviceState {
    PostgresExperimentDeviceState {
        dismissed_update_version: None,
    }
}

fn default_postgres_experiment_user_project_state() -> PostgresExperimentUserProjectState {
    PostgresExperimentUserProjectState {
        last_opened_project_id: None,
        recent_projects: Vec::new(),
    }
}

fn default_postgres_experiment_project_canvas_state() -> PostgresExperimentProjectCanvasState {
    PostgresExperimentProjectCanvasState {
        viewport: PostgresExperimentCanvasViewport {
            x: 140.0,
            y: 120.0,
            zoom: 1.0,
        },
        nodes: Vec::new(),
        shapes: Vec::new(),
        hidden_relationship_ids: Vec::new(),
    }
}

fn normalize_postgres_experiment_theme(value: &str) -> String {
    match value.trim() {
        "dark" => "dark".to_string(),
        _ => "light".to_string(),
    }
}

fn normalize_postgres_experiment_density(value: &str) -> String {
    match value.trim() {
        "compact" => "compact".to_string(),
        _ => "comfortable".to_string(),
    }
}

fn normalize_postgres_experiment_font_size(value: &str) -> String {
    match value.trim() {
        "small" => "small".to_string(),
        "large" => "large".to_string(),
        _ => "normal".to_string(),
    }
}

fn normalize_postgres_experiment_locale(value: &str) -> String {
    match value.trim() {
        "en" => "en".to_string(),
        _ => "en".to_string(),
    }
}

fn normalize_postgres_experiment_recent_project_limit(value: i32) -> i32 {
    match value {
        5 | 10 | 15 | 25 => value,
        value if value < 8 => 5,
        value if value < 13 => 10,
        value if value < 20 => 15,
        _ => 25,
    }
}

fn normalize_postgres_experiment_theme_state(
    theme_state: PostgresExperimentThemeState,
) -> PostgresExperimentThemeState {
    let mut presets = theme_state
        .presets
        .into_iter()
        .filter_map(|preset| {
            let id = preset.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(PostgresExperimentThemePreset {
                id,
                name: preset.name.trim().to_string(),
                base: normalize_postgres_experiment_theme(&preset.base),
                colors: preset
                    .colors
                    .into_iter()
                    .filter_map(|(key, value)| {
                        let trimmed_key = key.trim().to_string();
                        let trimmed_value = value.trim().to_string();
                        if trimmed_key.is_empty() || trimmed_value.is_empty() {
                            None
                        } else {
                            Some((trimmed_key, trimmed_value))
                        }
                    })
                    .collect(),
                border_radius: clamp_postgres_experiment_i32(preset.border_radius, 0, 20),
                border_width: clamp_postgres_experiment_i32(preset.border_width, 1, 4),
            })
        })
        .take(100)
        .collect::<Vec<_>>();

    let active_preset_id = theme_state
        .active_preset_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && presets.iter().any(|preset| preset.id == *value));

    PostgresExperimentThemeState {
        light_overrides: theme_state
            .light_overrides
            .into_iter()
            .filter_map(|(key, value)| {
                let trimmed_key = key.trim().to_string();
                let trimmed_value = value.trim().to_string();
                if trimmed_key.is_empty() || trimmed_value.is_empty() {
                    None
                } else {
                    Some((trimmed_key, trimmed_value))
                }
            })
            .collect(),
        dark_overrides: theme_state
            .dark_overrides
            .into_iter()
            .filter_map(|(key, value)| {
                let trimmed_key = key.trim().to_string();
                let trimmed_value = value.trim().to_string();
                if trimmed_key.is_empty() || trimmed_value.is_empty() {
                    None
                } else {
                    Some((trimmed_key, trimmed_value))
                }
            })
            .collect(),
        border_radius: clamp_postgres_experiment_i32(theme_state.border_radius, 0, 20),
        border_width: clamp_postgres_experiment_i32(theme_state.border_width, 1, 4),
        presets: std::mem::take(&mut presets),
        active_preset_id,
    }
}

fn normalize_postgres_experiment_document_import_default_mode(value: &str) -> String {
    match value.trim() {
        "paste" => "paste".to_string(),
        _ => "upload".to_string(),
    }
}

fn normalize_postgres_experiment_source_kind(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "text" => Some("text"),
        "pdf" => Some("pdf"),
        "image" => Some("image"),
        "audio" => Some("audio"),
        "video" => Some("video"),
        _ => None,
    }
}

fn postgres_experiment_source_object_type_system_key(source_kind: &str) -> &'static str {
    match normalize_postgres_experiment_source_kind(source_kind).unwrap_or("text") {
        "pdf" => "source_pdf",
        "image" => "source_image",
        "audio" => "source_audio",
        "video" => "source_video",
        _ => "source_text",
    }
}

fn is_postgres_experiment_source_object_system_key(value: Option<&str>) -> bool {
    value
        .map(|entry| entry.starts_with("source_"))
        .unwrap_or(false)
}

fn normalize_postgres_experiment_llm_connection_mode(value: &str) -> String {
    match value.trim() {
        "local" => "local".to_string(),
        "cloud" => "cloud".to_string(),
        _ => "none".to_string(),
    }
}

fn normalize_postgres_experiment_llm_cloud_provider(value: &str) -> String {
    match value.trim() {
        "anthropic" => "anthropic".to_string(),
        "copilot" => "copilot".to_string(),
        "blablador" => "blablador".to_string(),
        "ollama" => "ollama".to_string(),
        _ => "openai".to_string(),
    }
}

fn normalize_postgres_experiment_llm_protocol(value: &str) -> String {
    match value.trim() {
        "https" => "https".to_string(),
        _ => "http".to_string(),
    }
}

fn clamp_postgres_experiment_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn normalize_postgres_experiment_llm_settings(
    settings: PostgresExperimentLlmSettings,
) -> PostgresExperimentLlmSettings {
    let defaults = default_postgres_experiment_llm_settings();
    let chunk_size = clamp_postgres_experiment_i32(settings.chunk_size, 100, 20_000);
    let overlap_size = clamp_postgres_experiment_i32(settings.overlap_size, 0, (chunk_size - 1).max(0));
    let candidate_limit = clamp_postgres_experiment_i32(settings.ollama_relevant_segments_candidate_limit, 1, 50);
    let max_results = clamp_postgres_experiment_i32(
        settings.ollama_relevant_segments_max_results,
        1,
        candidate_limit,
    );
    let connection_mode = normalize_postgres_experiment_llm_connection_mode(&settings.connection_mode);

    PostgresExperimentLlmSettings {
        chunk_size,
        overlap_size,
        batch_size: clamp_postgres_experiment_i32(settings.batch_size, 1, 256),
        prefix_passages: settings.prefix_passages,
        prefix_queries: settings.prefix_queries,
        normalize_whitespace: settings.normalize_whitespace,
        connection_mode: connection_mode.clone(),
        cloud_provider: normalize_postgres_experiment_llm_cloud_provider(&settings.cloud_provider),
        cloud_api_secret: settings.cloud_api_secret.trim().to_string(),
        cloud_selected_model: settings.cloud_selected_model.trim().to_string(),
        ollama_enabled: connection_mode == "local",
        ollama_protocol: normalize_postgres_experiment_llm_protocol(&settings.ollama_protocol),
        ollama_host: if settings.ollama_host.trim().is_empty() {
            defaults.ollama_host
        } else {
            settings.ollama_host.trim().to_string()
        },
        ollama_port: clamp_postgres_experiment_i32(settings.ollama_port, 1, 65_535),
        ollama_selected_model: settings.ollama_selected_model.trim().to_string(),
        ollama_request_timeout_seconds: clamp_postgres_experiment_i32(
            settings.ollama_request_timeout_seconds,
            5,
            600,
        ),
        ollama_document_processing_timeout_seconds: clamp_postgres_experiment_i32(
            settings.ollama_document_processing_timeout_seconds,
            30,
            3600,
        ),
        ollama_temperature: settings.ollama_temperature.clamp(0.0, 2.0),
        ollama_num_ctx: clamp_postgres_experiment_i32(settings.ollama_num_ctx, 256, 131_072),
        ollama_keep_alive_minutes: clamp_postgres_experiment_i32(
            settings.ollama_keep_alive_minutes,
            0,
            1440,
        ),
        ollama_relevant_segments_candidate_limit: candidate_limit,
        ollama_relevant_segments_max_results: max_results,
    }
}

fn summarize_sql_statement(statement: &str) -> String {
    let compact = statement.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 180 {
        format!("{}...", &compact[..180])
    } else {
        compact
    }
}

fn describe_postgres_error(error: &tokio_postgres::Error) -> String {
    if let Some(db_error) = error.as_db_error() {
        let mut parts = vec![db_error.message().to_string()];
        if let Some(detail) = db_error.detail() {
            let detail = detail.trim();
            if !detail.is_empty() {
                parts.push(format!("detail: {detail}"));
            }
        }
        if let Some(hint) = db_error.hint() {
            let hint = hint.trim();
            if !hint.is_empty() {
                parts.push(format!("hint: {hint}"));
            }
        }
        parts.join(" | ")
    } else {
        error.to_string()
    }
}

async fn execute_postgres_statements(
    client: &tokio_postgres::Client,
    statements: &[&str],
    context: &str,
) -> Result<(), String> {
    for (index, statement) in statements.iter().enumerate() {
        client.execute(*statement, &[]).await.map_err(|error| {
            format!(
                "{context} at statement {}: {} | {}",
                index + 1,
                summarize_sql_statement(statement),
                describe_postgres_error(&error),
            )
        })?;
    }
    Ok(())
}

fn deserialize_postgres_experiment_llm_settings(raw: &str) -> PostgresExperimentLlmSettings {
    serde_json::from_str::<PostgresExperimentLlmSettings>(raw)
        .map(normalize_postgres_experiment_llm_settings)
        .unwrap_or_else(|_| default_postgres_experiment_llm_settings())
}

fn postgres_experiment_preference_subject_key(
    session: &PostgresExperimentAuthSession,
) -> String {
    format!("{}:{}", session.auth_kind, session.user.id)
}

async fn ensure_postgres_experiment_control_schema(app: &tauri::AppHandle) -> Result<PostgresSchemaMigrationResult, String> {
    let (client, connection_task) = connect_postgres_runtime(app).await?;
    execute_postgres_statements(
        &client,
        &[
            "CREATE TABLE IF NOT EXISTS app_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, database_name TEXT, storage_path TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'standard', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ)",
            "CREATE TABLE IF NOT EXISTS installation_settings (id TEXT PRIMARY KEY, startup_reopen_last_project BOOLEAN NOT NULL DEFAULT FALSE, document_import_default_mode TEXT NOT NULL DEFAULT 'upload', document_import_auto_name_from_file BOOLEAN NOT NULL DEFAULT TRUE, document_import_trim_imported_text BOOLEAN NOT NULL DEFAULT TRUE, document_import_warn_before_empty_import BOOLEAN NOT NULL DEFAULT TRUE, privacy_mask_file_paths BOOLEAN NOT NULL DEFAULT FALSE, privacy_clear_recent_projects_on_sign_out BOOLEAN NOT NULL DEFAULT FALSE, privacy_forget_login_identities_on_logout BOOLEAN NOT NULL DEFAULT FALSE, updates_auto_check BOOLEAN NOT NULL DEFAULT TRUE, llm_settings_json TEXT NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS user_preferences (subject_key TEXT PRIMARY KEY, theme TEXT NOT NULL DEFAULT 'light', density TEXT NOT NULL DEFAULT 'comfortable', font_size TEXT NOT NULL DEFAULT 'normal', locale TEXT NOT NULL DEFAULT 'en', recent_project_limit INTEGER NOT NULL DEFAULT 10, theme_state_json TEXT NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS device_state (id TEXT PRIMARY KEY, dismissed_update_version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS remembered_accounts (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS user_project_state (subject_key TEXT PRIMARY KEY, last_opened_project_id TEXT, recent_projects_json TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS database_name TEXT",
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS storage_path TEXT",
            "ALTER TABLE installation_settings ADD COLUMN IF NOT EXISTS document_import_default_mode TEXT",
            "ALTER TABLE installation_settings ADD COLUMN IF NOT EXISTS document_import_auto_name_from_file BOOLEAN",
            "ALTER TABLE installation_settings ADD COLUMN IF NOT EXISTS document_import_trim_imported_text BOOLEAN",
            "ALTER TABLE installation_settings ADD COLUMN IF NOT EXISTS document_import_warn_before_empty_import BOOLEAN",
            "ALTER TABLE installation_settings ADD COLUMN IF NOT EXISTS llm_settings_json TEXT",
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS locale TEXT",
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS recent_project_limit INTEGER",
            "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS theme_state_json TEXT",
            "ALTER TABLE user_project_state ADD COLUMN IF NOT EXISTS last_opened_project_id TEXT",
            "ALTER TABLE user_project_state ADD COLUMN IF NOT EXISTS recent_projects_json TEXT",
            "ALTER TABLE device_state ADD COLUMN IF NOT EXISTS dismissed_update_version TEXT",
        ],
        "Could not apply PostgreSQL experiment control schema",
    )
    .await?;

    let projects_has_name_column = client
        .query_opt(
            "
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'projects'
              AND column_name = 'name'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment control project name column: {e}"))?
        .is_some();
    let projects_has_description_column = client
        .query_opt(
            "
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'projects'
              AND column_name = 'description'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment control project description column: {e}"))?
        .is_some();

    execute_postgres_statements(
        &client,
        &[
            "ALTER TABLE installation_settings DROP COLUMN IF EXISTS startup_auto_login_last_user",
            "ALTER TABLE user_preferences ALTER COLUMN locale SET DEFAULT 'en'",
            "UPDATE user_preferences SET locale = 'en' WHERE locale IS NULL OR TRIM(locale) = ''",
            "ALTER TABLE user_preferences ALTER COLUMN locale SET NOT NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_default_mode SET DEFAULT 'upload'",
            "UPDATE installation_settings SET document_import_default_mode = 'upload' WHERE document_import_default_mode IS NULL OR TRIM(document_import_default_mode) = ''",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_default_mode SET NOT NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_auto_name_from_file SET DEFAULT TRUE",
            "UPDATE installation_settings SET document_import_auto_name_from_file = TRUE WHERE document_import_auto_name_from_file IS NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_auto_name_from_file SET NOT NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_trim_imported_text SET DEFAULT TRUE",
            "UPDATE installation_settings SET document_import_trim_imported_text = TRUE WHERE document_import_trim_imported_text IS NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_trim_imported_text SET NOT NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_warn_before_empty_import SET DEFAULT TRUE",
            "UPDATE installation_settings SET document_import_warn_before_empty_import = TRUE WHERE document_import_warn_before_empty_import IS NULL",
            "ALTER TABLE installation_settings ALTER COLUMN document_import_warn_before_empty_import SET NOT NULL",
            "ALTER TABLE installation_settings ALTER COLUMN llm_settings_json SET DEFAULT '{}'",
            "UPDATE installation_settings SET llm_settings_json = '{}' WHERE llm_settings_json IS NULL OR TRIM(llm_settings_json) = ''",
            "ALTER TABLE installation_settings ALTER COLUMN llm_settings_json SET NOT NULL",
            "ALTER TABLE user_project_state ALTER COLUMN recent_projects_json SET DEFAULT '[]'",
            "UPDATE user_project_state SET recent_projects_json = '[]' WHERE recent_projects_json IS NULL OR TRIM(recent_projects_json) = ''",
            "ALTER TABLE user_project_state ALTER COLUMN recent_projects_json SET NOT NULL",
            "ALTER TABLE user_preferences ALTER COLUMN recent_project_limit SET DEFAULT 10",
            "UPDATE user_preferences SET recent_project_limit = 10 WHERE recent_project_limit IS NULL",
            "ALTER TABLE user_preferences ALTER COLUMN recent_project_limit SET NOT NULL",
            "ALTER TABLE user_preferences ALTER COLUMN theme_state_json SET DEFAULT '{}'",
            "UPDATE user_preferences SET theme_state_json = '{}' WHERE theme_state_json IS NULL OR TRIM(theme_state_json) = ''",
            "ALTER TABLE user_preferences ALTER COLUMN theme_state_json SET NOT NULL",
        ],
        "Could not backfill PostgreSQL experiment control schema columns",
    )
    .await?;

    let missing_rows = client
        .query(
            "
            SELECT id
            FROM projects
            WHERE database_name IS NULL OR TRIM(database_name) = ''
               OR storage_path IS NULL OR TRIM(storage_path) = ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment control projects: {e}"))?;

    for row in missing_rows {
        let project_id: String = row.get(0);
        let database_name = postgres_project_database_name(&project_id);
        let storage_path = postgres_project_storage_path(app, &project_id)?;
        fs::create_dir_all(&storage_path)
            .map_err(|e| format!("Could not create PostgreSQL project storage directory for backfill: {e}"))?;
        client
            .execute(
                "
                UPDATE projects
                SET database_name = $2,
                    storage_path = $3
                WHERE id = $1
                ",
                &[&project_id, &database_name, &storage_path.to_string_lossy().to_string()],
            )
            .await
            .map_err(|e| format!("Could not backfill PostgreSQL experiment control project metadata: {e}"))?;
    }

    if projects_has_name_column || projects_has_description_column {
        let legacy_rows = client
            .query(
                "
                SELECT id, database_name, COALESCE(name, ''), COALESCE(description, '')
                FROM projects
                ",
                &[],
            )
            .await
            .map_err(|e| format!("Could not load legacy PostgreSQL experiment project metadata: {e}"))?;

        for row in legacy_rows {
            let project_id: String = row.get(0);
            let database_name: String = row.get(1);
            let name: String = row.get(2);
            let description: String = row.get(3);
            ensure_postgres_experiment_project_schema(app, &database_name).await?;
            let (project_client, project_connection_task) = connect_postgres_database(app, &database_name).await?;
            project_client
                .execute(
                    "
                    UPDATE project_settings
                    SET project_name = $2,
                        project_description = $3,
                        updated_at = NOW()
                    WHERE id = $1
                    ",
                    &[&"default", &name, &description],
                )
                .await
                .map_err(|e| format!("Could not backfill PostgreSQL experiment project metadata for project {project_id}: {e}"))?;
            project_connection_task.abort();
        }
    }

    client
        .batch_execute(
            "
            ALTER TABLE projects ALTER COLUMN database_name SET NOT NULL;
            ALTER TABLE projects ALTER COLUMN storage_path SET NOT NULL;
            ",
        )
        .await
        .map_err(|e| format!("Could not finalize PostgreSQL experiment control schema: {e}"))?;

    if projects_has_name_column {
        client
            .execute("ALTER TABLE projects DROP COLUMN IF EXISTS name", &[])
            .await
            .map_err(|e| format!("Could not remove legacy PostgreSQL experiment project name column: {e}"))?;
    }
    if projects_has_description_column {
        client
            .execute("ALTER TABLE projects DROP COLUMN IF EXISTS description", &[])
            .await
            .map_err(|e| format!("Could not remove legacy PostgreSQL experiment project description column: {e}"))?;
    }

    client
        .execute(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS projects_database_name_key
            ON projects (database_name)
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not enforce PostgreSQL experiment control uniqueness: {e}"))?;
    client
        .execute(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key
            ON app_users (email)
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not enforce PostgreSQL experiment auth uniqueness: {e}"))?;
    client
        .execute(
            "
            INSERT INTO installation_settings (
                id,
                startup_reopen_last_project,
                document_import_default_mode,
                document_import_auto_name_from_file,
                document_import_trim_imported_text,
                document_import_warn_before_empty_import,
                privacy_mask_file_paths,
                privacy_clear_recent_projects_on_sign_out,
                privacy_forget_login_identities_on_logout,
                updates_auto_check,
                llm_settings_json
            )
            VALUES ('singleton', FALSE, 'upload', TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, $1)
            ON CONFLICT (id) DO NOTHING
            ",
            &[&serde_json::to_string(&default_postgres_experiment_llm_settings()).map_err(|e| e.to_string())?],
        )
        .await
        .map_err(|e| format!("Could not initialize PostgreSQL experiment installation settings: {e}"))?;
    client
        .execute(
            "
            INSERT INTO device_state (
                id,
                dismissed_update_version
            )
            VALUES ('singleton', NULL)
            ON CONFLICT (id) DO NOTHING
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not initialize PostgreSQL experiment device state: {e}"))?;

    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&1_i32, &"control_projects_registry_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&6_i32, &"control_installation_and_user_preferences_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment settings migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&7_i32, &"control_device_state_and_remembered_accounts_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment device-state migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&8_i32, &"control_user_locale_and_project_state_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment user-project-state migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&9_i32, &"control_document_import_installation_settings_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment document-import migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&10_i32, &"control_llm_and_recent_limit_settings_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment llm/recent-limit migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&4_i32, &"control_projects_database_and_storage_metadata"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment migration: {e}"))?;
    client
        .execute(
            "
            INSERT INTO app_schema_migrations (version, name)
            VALUES ($1, $2)
            ON CONFLICT (version) DO NOTHING
            ",
            &[&5_i32, &"control_app_users_auth_schema"],
        )
        .await
        .map_err(|e| format!("Could not record PostgreSQL experiment migration: {e}"))?;

    let rows = client
        .query("SELECT version FROM app_schema_migrations ORDER BY version", &[])
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment migrations: {e}"))?;

    connection_task.abort();
    Ok(PostgresSchemaMigrationResult {
        ready: true,
        applied_versions: rows.into_iter().map(|row| row.get::<_, i32>(0)).collect(),
    })
}

async fn ensure_postgres_experiment_project_schema(
    app: &tauri::AppHandle,
    database_name: &str,
) -> Result<PostgresSchemaMigrationResult, String> {
    let normalized_database_name = database_name.trim().to_string();
    if normalized_database_name.is_empty() {
        return Err("Project database name is required.".to_string());
    }

    let schema_cache = app.state::<PostgresExperimentProjectSchemaCache>();
    {
        let cached_databases = schema_cache.0.lock().unwrap();
        if cached_databases.contains(&normalized_database_name) {
            return Ok(PostgresSchemaMigrationResult {
                ready: true,
                applied_versions: vec![],
            });
        }
    }

    let (client, connection_task) = connect_postgres_database(app, &normalized_database_name).await?;
    let lock_key = normalized_database_name.clone();
    client
        .execute(
            "SELECT pg_advisory_lock(hashtext($1)::bigint)",
            &[&lock_key],
        )
        .await
        .map_err(|e| format!("Could not lock PostgreSQL experiment project schema migration: {e}"))?;

    let ensure_result: Result<PostgresSchemaMigrationResult, String> = async {
        client
            .batch_execute(
                "
                CREATE TABLE IF NOT EXISTS app_schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS project_users (
                    id TEXT PRIMARY KEY,
                    app_user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (email),
                    UNIQUE (app_user_id)
                );
                CREATE TABLE IF NOT EXISTS project_settings (
                    id TEXT PRIMARY KEY,
                    project_name TEXT NOT NULL DEFAULT '',
                    project_description TEXT NOT NULL DEFAULT '',
                    ai_assist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    ai_semantic_search_allowed BOOLEAN NOT NULL DEFAULT TRUE,
                    ai_question_answering_allowed BOOLEAN NOT NULL DEFAULT TRUE,
                    ai_summaries_allowed BOOLEAN NOT NULL DEFAULT TRUE,
                    ai_code_suggestions_allowed BOOLEAN NOT NULL DEFAULT FALSE,
                    ai_draft_reports_allowed BOOLEAN NOT NULL DEFAULT FALSE,
                    document_import_store_original_file_name BOOLEAN NOT NULL DEFAULT TRUE,
                    canvas_state_json TEXT NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS project_log (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT '',
                    user_name TEXT NOT NULL DEFAULT '',
                    access_mode TEXT,
                    action TEXT NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    record_id TEXT,
                    details_json TEXT,
                    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    restored_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS research_objects (
                    id TEXT PRIMARY KEY,
                    source_id TEXT UNIQUE,
                    object_type_id TEXT,
                    object_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    shape_override TEXT,
                    color_override TEXT,
                    fill_override TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS object_types (
                    id TEXT PRIMARY KEY,
                    system_key TEXT,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    shape TEXT NOT NULL DEFAULT 'rounded',
                    color TEXT NOT NULL DEFAULT '#355070',
                    fill TEXT NOT NULL DEFAULT 'filled',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS object_attribute_definitions (
                    id TEXT PRIMARY KEY,
                    object_type_id TEXT,
                    object_type TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL,
                    data_type TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    options_json TEXT NOT NULL DEFAULT '[]',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS object_attribute_values (
                    id TEXT PRIMARY KEY,
                    object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    attribute_definition_id TEXT NOT NULL REFERENCES object_attribute_definitions(id) ON DELETE CASCADE,
                    value TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (object_id, attribute_definition_id)
                );
                CREATE TABLE IF NOT EXISTS object_relationships (
                    id TEXT PRIMARY KEY,
                    from_object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    to_object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    relationship_type_id TEXT,
                    relationship_type TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    line_shape_override TEXT,
                    line_weight_override INTEGER,
                    arrowhead_override TEXT,
                    color_override TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS relationship_types (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    line_shape TEXT NOT NULL DEFAULT 'solid',
                    line_weight INTEGER NOT NULL DEFAULT 2,
                    arrowhead TEXT NOT NULL DEFAULT 'one_sided',
                    color TEXT NOT NULL DEFAULT '#355070',
                    from_object_type_id TEXT,
                    to_object_type_id TEXT,
                    from_object_type_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                    to_object_type_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS relationship_attribute_definitions (
                    id TEXT PRIMARY KEY,
                    relationship_type_id TEXT,
                    relationship_type TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL,
                    data_type TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    options_json TEXT NOT NULL DEFAULT '[]',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS relationship_attribute_values (
                    id TEXT PRIMARY KEY,
                    relationship_id TEXT NOT NULL REFERENCES object_relationships(id) ON DELETE CASCADE,
                    attribute_definition_id TEXT NOT NULL REFERENCES relationship_attribute_definitions(id) ON DELETE CASCADE,
                    value TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (relationship_id, attribute_definition_id)
                );
                CREATE TABLE IF NOT EXISTS saved_drawings (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL DEFAULT '',
                    canvas_kind TEXT NOT NULL DEFAULT 'free_draw',
                    canvas_state_json TEXT NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY,
                    source_kind TEXT NOT NULL DEFAULT 'text',
                    title TEXT NOT NULL,
                    original_file_name TEXT NOT NULL DEFAULT '',
                    storage_path TEXT NOT NULL DEFAULT '',
                    text_content TEXT NOT NULL DEFAULT '',
                    structured_content_json TEXT NOT NULL DEFAULT '{}',
                    waveform_peaks_json TEXT NOT NULL DEFAULT '',
                    video_frame_index_json TEXT NOT NULL DEFAULT '',
                    extracted_from_video_source_id TEXT NOT NULL DEFAULT '',
                    extracted_from_video_time_ms BIGINT,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                ALTER TABLE sources ADD COLUMN IF NOT EXISTS waveform_peaks_json TEXT NOT NULL DEFAULT '';
                ALTER TABLE sources ADD COLUMN IF NOT EXISTS video_frame_index_json TEXT NOT NULL DEFAULT '';
                ALTER TABLE sources ADD COLUMN IF NOT EXISTS extracted_from_video_source_id TEXT NOT NULL DEFAULT '';
                ALTER TABLE sources ADD COLUMN IF NOT EXISTS extracted_from_video_time_ms BIGINT;
                CREATE TABLE IF NOT EXISTS source_files (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    storage_path TEXT NOT NULL,
                    original_file_name TEXT NOT NULL DEFAULT '',
                    media_type TEXT NOT NULL DEFAULT '',
                    file_size_bytes BIGINT,
                    checksum_sha256 TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS codes (
                    id TEXT PRIMARY KEY,
                    parent_code_id TEXT REFERENCES codes(id) ON DELETE SET NULL,
                    label TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    color TEXT NOT NULL DEFAULT '#355070',
                    shortcut TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE SEQUENCE IF NOT EXISTS annotation_display_id_seq;
                CREATE TABLE IF NOT EXISTS annotations (
                    id TEXT PRIMARY KEY,
                    display_id BIGINT NOT NULL DEFAULT nextval('annotation_display_id_seq'),
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    anchor_kind TEXT NOT NULL DEFAULT 'text_span',
                    start_offset INTEGER,
                    end_offset INTEGER,
                    quote TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    text_selector_json TEXT NOT NULL DEFAULT '{}',
                    region_selector_json TEXT NOT NULL DEFAULT '{}',
                    time_start_ms BIGINT,
                    time_end_ms BIGINT,
                    created_by_project_user_id TEXT REFERENCES project_users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS annotation_codes (
                    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
                    code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (annotation_id, code_id)
                );
                CREATE TABLE IF NOT EXISTS memos (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL DEFAULT '',
                    created_by_project_user_id TEXT REFERENCES project_users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS memo_sources (
                    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (memo_id, source_id)
                );
                CREATE TABLE IF NOT EXISTS memo_annotations (
                    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
                    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (memo_id, annotation_id)
                );
                CREATE TABLE IF NOT EXISTS memo_codes (
                    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
                    code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (memo_id, code_id)
                );
                CREATE TABLE IF NOT EXISTS memo_objects (
                    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
                    object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (memo_id, object_id)
                );
                CREATE TABLE IF NOT EXISTS source_objects (
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (source_id, object_id)
                );
                CREATE TABLE IF NOT EXISTS source_locks (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL DEFAULT '',
                    expires_at_ms BIGINT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (source_id)
                );
                CREATE TABLE IF NOT EXISTS source_lock_kicks (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL,
                    kicked_by_user_id TEXT NOT NULL,
                    kicked_by_name TEXT NOT NULL DEFAULT '',
                    expires_at_ms BIGINT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS source_lock_kicks_source_user_idx
                    ON source_lock_kicks (source_id, user_id);
                CREATE TABLE IF NOT EXISTS source_attribute_definitions (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    data_type TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    options_json TEXT NOT NULL DEFAULT '[]',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS source_attribute_values (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    attribute_definition_id TEXT NOT NULL REFERENCES source_attribute_definitions(id) ON DELETE CASCADE,
                    value TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (source_id, attribute_definition_id)
                );
                CREATE TABLE IF NOT EXISTS annotation_objects (
                    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
                    object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (annotation_id, object_id)
                );
                CREATE TABLE IF NOT EXISTS code_objects (
                    code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
                    object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (code_id, object_id)
                );
                CREATE TABLE IF NOT EXISTS event_objects (
                    object_id TEXT PRIMARY KEY REFERENCES research_objects(id) ON DELETE CASCADE,
                    start_at TIMESTAMPTZ NOT NULL,
                    end_at TIMESTAMPTZ,
                    time_precision TEXT NOT NULL DEFAULT 'exact',
                    timezone TEXT NOT NULL DEFAULT '',
                    is_instant BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT event_objects_end_after_start
                        CHECK (end_at IS NULL OR end_at >= start_at)
                );
                ",
            )
            .await
            .map_err(|e| format!("Could not apply PostgreSQL experiment project schema: {e}"))?;

        client
            .batch_execute(
                "
                ALTER TABLE project_users ADD COLUMN IF NOT EXISTS app_user_id TEXT;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS project_description TEXT NOT NULL DEFAULT '';
                ALTER TABLE object_types ADD COLUMN IF NOT EXISTS system_key TEXT;
                ALTER TABLE object_types ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
                ALTER TABLE object_types ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'rounded';
                ALTER TABLE object_types ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#355070';
                ALTER TABLE object_types ADD COLUMN IF NOT EXISTS fill TEXT NOT NULL DEFAULT 'filled';
                ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS source_id TEXT;
                ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS object_type_id TEXT;
                ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS shape_override TEXT;
                ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS color_override TEXT;
                ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS fill_override TEXT;
                ALTER TABLE object_attribute_definitions ADD COLUMN IF NOT EXISTS object_type_id TEXT;
                ALTER TABLE object_attribute_definitions ADD COLUMN IF NOT EXISTS object_type TEXT NOT NULL DEFAULT '';
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS line_shape TEXT NOT NULL DEFAULT 'solid';
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS line_weight INTEGER NOT NULL DEFAULT 2;
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS arrowhead TEXT NOT NULL DEFAULT 'one_sided';
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#355070';
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS from_object_type_id TEXT;
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS to_object_type_id TEXT;
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS from_object_type_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
                ALTER TABLE relationship_types ADD COLUMN IF NOT EXISTS to_object_type_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
                ALTER TABLE object_relationships ADD COLUMN IF NOT EXISTS relationship_type_id TEXT;
                ALTER TABLE object_relationships ADD COLUMN IF NOT EXISTS line_shape_override TEXT;
                ALTER TABLE object_relationships ADD COLUMN IF NOT EXISTS line_weight_override INTEGER;
                ALTER TABLE object_relationships ADD COLUMN IF NOT EXISTS arrowhead_override TEXT;
                ALTER TABLE object_relationships ADD COLUMN IF NOT EXISTS color_override TEXT;
                ALTER TABLE relationship_attribute_definitions ADD COLUMN IF NOT EXISTS relationship_type_id TEXT;
                ALTER TABLE relationship_attribute_definitions ADD COLUMN IF NOT EXISTS relationship_type TEXT NOT NULL DEFAULT '';
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_assist_enabled BOOLEAN NOT NULL DEFAULT FALSE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_semantic_search_allowed BOOLEAN NOT NULL DEFAULT TRUE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_question_answering_allowed BOOLEAN NOT NULL DEFAULT TRUE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_summaries_allowed BOOLEAN NOT NULL DEFAULT TRUE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_code_suggestions_allowed BOOLEAN NOT NULL DEFAULT FALSE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_draft_reports_allowed BOOLEAN NOT NULL DEFAULT FALSE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS document_import_store_original_file_name BOOLEAN NOT NULL DEFAULT TRUE;
                ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS canvas_state_json TEXT NOT NULL DEFAULT '{}';
                ALTER TABLE saved_drawings ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
                ALTER TABLE saved_drawings ADD COLUMN IF NOT EXISTS canvas_kind TEXT NOT NULL DEFAULT 'free_draw';
                ALTER TABLE saved_drawings ADD COLUMN IF NOT EXISTS canvas_state_json TEXT NOT NULL DEFAULT '{}';
                ALTER TABLE annotations ADD COLUMN IF NOT EXISTS display_id BIGINT;
                ALTER TABLE annotations ALTER COLUMN display_id SET DEFAULT nextval('annotation_display_id_seq');
                ",
            )
            .await
            .map_err(|e| format!("Could not update PostgreSQL experiment project user schema: {e}"))?;

        client
            .batch_execute(
                "
                WITH numbered AS (
                    SELECT id, nextval('annotation_display_id_seq') AS display_id
                    FROM annotations
                    WHERE display_id IS NULL
                    ORDER BY created_at ASC, id ASC
                )
                UPDATE annotations AS a
                SET display_id = numbered.display_id
                FROM numbered
                WHERE a.id = numbered.id;

                ALTER TABLE annotations ALTER COLUMN display_id SET NOT NULL;
                ",
            )
            .await
            .map_err(|e| format!("Could not backfill PostgreSQL experiment annotation display IDs: {e}"))?;

        ensure_postgres_experiment_text_array_column(
            &client,
            "relationship_types",
            "from_object_type_ids",
            "from_object_type_id",
        )
        .await?;
        ensure_postgres_experiment_text_array_column(
            &client,
            "relationship_types",
            "to_object_type_ids",
            "to_object_type_id",
        )
        .await?;

    client
        .execute(
            "
            INSERT INTO project_settings (
                id,
                ai_assist_enabled,
                ai_semantic_search_allowed,
                ai_question_answering_allowed,
                ai_summaries_allowed,
                ai_code_suggestions_allowed,
                ai_draft_reports_allowed,
                document_import_store_original_file_name,
                canvas_state_json
            )
            VALUES (
                'default',
                FALSE,
                TRUE,
                TRUE,
                TRUE,
                FALSE,
                FALSE,
                TRUE,
                '{}'
            )
            ON CONFLICT (id) DO NOTHING
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not seed PostgreSQL experiment project settings: {e}"))?;

    let missing_user_links = client
        .query(
            "
            SELECT id, email
            FROM project_users
            WHERE app_user_id IS NULL OR TRIM(app_user_id) = ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment project user links: {e}"))?;
    for row in missing_user_links {
        let project_user_id: String = row.get(0);
        let email: String = row.get(1);
        if let Some(app_user) = load_postgres_experiment_app_user_by_email(app, &email.to_lowercase()).await? {
            client
                .execute(
                    "
                    UPDATE project_users
                    SET app_user_id = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    ",
                    &[&project_user_id, &app_user.user.id],
                )
                .await
                .map_err(|e| format!("Could not backfill PostgreSQL experiment project user link: {e}"))?;
        }
    }

    let discovered_object_type_names = client
        .query(
            "
            SELECT DISTINCT object_type
            FROM (
                SELECT object_type FROM research_objects
                UNION
                SELECT object_type FROM object_attribute_definitions
            ) object_type_names
            WHERE TRIM(object_type) <> ''
            ORDER BY object_type ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object types: {e}"))?;
    for row in discovered_object_type_names {
        let object_type_name: String = row.get(0);
        client
            .execute(
                "
                INSERT INTO object_types (id, name, description)
                SELECT $1, $2, ''
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM object_types
                    WHERE LOWER(name) = LOWER($2)
                )
                ",
                &[&generate_identifier(), &object_type_name],
            )
            .await
            .map_err(|e| format!("Could not backfill PostgreSQL experiment object type: {e}"))?;
    }

    client
        .execute(
            "
            UPDATE research_objects
            SET object_type_id = (
                SELECT object_types.id
                FROM object_types
                WHERE LOWER(TRIM(object_types.name)) = LOWER(TRIM(research_objects.object_type))
                ORDER BY object_types.created_at ASC, object_types.id ASC
                LIMIT 1
            )
            WHERE object_type_id IS NULL
              AND TRIM(object_type) <> ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not backfill PostgreSQL experiment object type ids for objects: {e}"))?;

    client
        .execute(
            "
            UPDATE object_attribute_definitions
            SET object_type_id = (
                SELECT object_types.id
                FROM object_types
                WHERE LOWER(TRIM(object_types.name)) = LOWER(TRIM(object_attribute_definitions.object_type))
                ORDER BY object_types.created_at ASC, object_types.id ASC
                LIMIT 1
            )
            WHERE object_type_id IS NULL
              AND TRIM(object_type) <> ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not backfill PostgreSQL experiment object type ids for attributes: {e}"))?;

    client
        .execute(
            "
            CREATE INDEX IF NOT EXISTS object_types_name_lower_key
            ON object_types (LOWER(name))
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment object type index: {e}"))?;

    client
        .execute(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS object_types_system_key_key
            ON object_types (system_key)
            WHERE system_key IS NOT NULL
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment object system key index: {e}"))?;

    client
        .execute(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS research_objects_source_id_key
            ON research_objects (source_id)
            WHERE source_id IS NOT NULL
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source-backed object index: {e}"))?;

    client
        .execute(
            "
            WITH existing AS (
                SELECT id
                FROM object_types
                WHERE system_key = 'event'
                LIMIT 1
            ),
            candidate AS (
                SELECT id
                FROM object_types
                WHERE LOWER(TRIM(name)) = 'event'
                ORDER BY created_at ASC, id ASC
                LIMIT 1
            )
            UPDATE object_types
            SET system_key = 'event',
                updated_at = NOW()
            WHERE id = (SELECT id FROM candidate)
              AND NOT EXISTS (SELECT 1 FROM existing)
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not backfill PostgreSQL experiment event object type: {e}"))?;

    client
        .execute(
            "
            INSERT INTO object_types (id, system_key, name, description, shape, color, fill)
            SELECT $1, 'event', 'Event', 'Built-in timeline event object type.', 'diamond', '#b56576', 'filled'
            WHERE NOT EXISTS (
                SELECT 1
                FROM object_types
                WHERE system_key = 'event'
            )
            ",
            &[&generate_identifier()],
        )
        .await
        .map_err(|e| format!("Could not seed PostgreSQL experiment event object type: {e}"))?;

    for (system_key, name, description, shape, color, fill) in [
        (
            "source_text",
            "Text source",
            "Built-in object type for text sources.",
            "rectangle",
            "#355070",
            "filled",
        ),
        (
            "source_pdf",
            "PDF source",
            "Built-in object type for PDF sources.",
            "rectangle",
            "#7f5539",
            "filled",
        ),
        (
            "source_image",
            "Image source",
            "Built-in object type for image sources.",
            "rectangle",
            "#6d597a",
            "filled",
        ),
        (
            "source_audio",
            "Audio source",
            "Built-in object type for audio sources.",
            "rounded",
            "#b56576",
            "filled",
        ),
        (
            "source_video",
            "Video source",
            "Built-in object type for video sources.",
            "hexagon",
            "#457b9d",
            "filled",
        ),
    ] {
        client
            .execute(
                "
                INSERT INTO object_types (id, system_key, name, description, shape, color, fill)
                SELECT $1, $2, $3, $4, $5, $6, $7
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM object_types
                    WHERE system_key = $2
                )
                ",
                &[&generate_identifier(), &system_key, &name, &description, &shape, &color, &fill],
            )
            .await
            .map_err(|e| format!("Could not seed PostgreSQL experiment source object type \"{system_key}\": {e}"))?;
    }

    sync_all_postgres_experiment_source_objects_for_client(&client).await?;

    client
        .batch_execute(
            "
            CREATE INDEX IF NOT EXISTS codes_parent_code_idx ON codes (parent_code_id);
            CREATE INDEX IF NOT EXISTS codes_label_lower_idx ON codes (LOWER(label));
            CREATE INDEX IF NOT EXISTS annotations_source_idx ON annotations (source_id);
            CREATE UNIQUE INDEX IF NOT EXISTS annotations_display_id_key ON annotations (display_id);
            CREATE INDEX IF NOT EXISTS annotation_codes_code_idx ON annotation_codes (code_id);
            CREATE INDEX IF NOT EXISTS source_objects_object_idx ON source_objects (object_id);
            CREATE INDEX IF NOT EXISTS source_attribute_values_source_idx ON source_attribute_values (source_id);
            CREATE INDEX IF NOT EXISTS source_attribute_values_definition_idx ON source_attribute_values (attribute_definition_id);
            CREATE INDEX IF NOT EXISTS annotation_objects_object_idx ON annotation_objects (object_id);
            CREATE INDEX IF NOT EXISTS code_objects_object_idx ON code_objects (object_id);
            CREATE INDEX IF NOT EXISTS event_objects_start_at_idx ON event_objects (start_at);
            CREATE INDEX IF NOT EXISTS source_files_source_idx ON source_files (source_id);
            ",
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment qualitative-core indexes: {e}"))?;

    let discovered_relationship_type_names = client
        .query(
            "
            SELECT DISTINCT relationship_type
            FROM (
                SELECT relationship_type FROM object_relationships
                UNION
                SELECT relationship_type FROM relationship_attribute_definitions
            ) relationship_type_names
            WHERE TRIM(relationship_type) <> ''
            ORDER BY relationship_type ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment relationship types: {e}"))?;
    for row in discovered_relationship_type_names {
        let relationship_type_name: String = row.get(0);
        client
            .execute(
                "
                INSERT INTO relationship_types (id, name, description)
                SELECT $1, $2, ''
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM relationship_types
                    WHERE LOWER(name) = LOWER($2)
                )
                ",
                &[&generate_identifier(), &relationship_type_name],
            )
            .await
            .map_err(|e| format!("Could not backfill PostgreSQL experiment relationship type: {e}"))?;
    }

    client
        .execute(
            "
            UPDATE object_relationships
            SET relationship_type_id = (
                SELECT relationship_types.id
                FROM relationship_types
                WHERE LOWER(TRIM(relationship_types.name)) = LOWER(TRIM(object_relationships.relationship_type))
                ORDER BY relationship_types.created_at ASC, relationship_types.id ASC
                LIMIT 1
            )
            WHERE relationship_type_id IS NULL
              AND TRIM(relationship_type) <> ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not backfill PostgreSQL experiment relationship type ids for relationships: {e}"))?;

    client
        .execute(
            "
            UPDATE relationship_attribute_definitions
            SET relationship_type_id = (
                SELECT relationship_types.id
                FROM relationship_types
                WHERE LOWER(TRIM(relationship_types.name)) = LOWER(TRIM(relationship_attribute_definitions.relationship_type))
                ORDER BY relationship_types.created_at ASC, relationship_types.id ASC
                LIMIT 1
            )
            WHERE relationship_type_id IS NULL
              AND TRIM(relationship_type) <> ''
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not backfill PostgreSQL experiment relationship type ids for attributes: {e}"))?;

    client
        .execute(
            "
            CREATE INDEX IF NOT EXISTS relationship_types_name_lower_key
            ON relationship_types (LOWER(name))
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment relationship type index: {e}"))?;

    for (version, name) in [
        (1_i32, "project_users_schema"),
        (2_i32, "dynamic_objects_and_relationships_schema"),
        (3_i32, "project_users_app_user_binding"),
        (4_i32, "project_settings_ai_assist_and_document_import_schema"),
        (5_i32, "object_types_schema"),
        (6_i32, "relationship_types_schema"),
        (7_i32, "qualitative_core_and_event_objects_schema"),
        (8_i32, "cases_and_case_source_links_schema"),
        (9_i32, "source_backed_objects_schema"),
    ] {
        client
            .execute(
                "
                INSERT INTO app_schema_migrations (version, name)
                VALUES ($1, $2)
                ON CONFLICT (version) DO NOTHING
                ",
                &[&version, &name],
            )
            .await
            .map_err(|e| format!("Could not record PostgreSQL project migration: {e}"))?;
    }

        let rows = client
            .query("SELECT version FROM app_schema_migrations ORDER BY version", &[])
            .await
            .map_err(|e| format!("Could not load PostgreSQL project migrations: {e}"))?;

        Ok(PostgresSchemaMigrationResult {
            ready: true,
            applied_versions: rows.into_iter().map(|row| row.get::<_, i32>(0)).collect(),
        })
    }.await;

    let unlock_result = client
        .execute(
            "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
            &[&lock_key],
        )
        .await;

    connection_task.abort();

    match (ensure_result, unlock_result) {
        (Ok(result), Ok(_)) => {
            let mut cached_databases = schema_cache.0.lock().unwrap();
            cached_databases.insert(normalized_database_name);
            Ok(result)
        }
        (Err(error), Ok(_)) => Err(error),
        (Ok(_), Err(error)) => Err(format!("Could not unlock PostgreSQL experiment project schema migration: {error}")),
        (Err(schema_error), Err(unlock_error)) => Err(format!(
            "{schema_error}; additionally could not unlock PostgreSQL experiment project schema migration: {unlock_error}"
        )),
    }
}

fn postgres_projects_root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(kanqual_data_dir(app)?.join("postgres-projects"))
}

fn postgres_project_storage_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(postgres_projects_root_dir(app)?.join(project_id))
}

fn postgres_project_database_name(project_id: &str) -> String {
    let token = project_id.chars().filter(|ch| ch.is_ascii_alphanumeric()).take(12).collect::<String>();
    format!("{POSTGRES_PROJECT_DATABASE_PREFIX}{token}")
}

fn map_postgres_experiment_object_type_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentObjectType {
    PostgresExperimentObjectType {
        id: row.get(0),
        project_id: project_id.to_string(),
        system_key: row.get(1),
        name: row.get(2),
        description: row.get(3),
        shape: row.get(4),
        color: row.get(5),
        fill: row.get(6),
        created_at: row.get(7),
        updated_at: row.get(8),
    }
}

fn map_postgres_experiment_source_row(project_id: &str, row: tokio_postgres::Row) -> PostgresExperimentSource {
    PostgresExperimentSource {
        id: row.get(0),
        project_id: project_id.to_string(),
        source_kind: row.get(1),
        title: row.get(2),
        original_file_name: row.get(3),
        storage_path: row.get(4),
        text_content: row.get(5),
        structured_content_json: row.get(6),
        waveform_peaks_json: row.get(7),
        video_frame_index_json: row.get(8),
        extracted_from_video_source_id: row.get(9),
        extracted_from_video_time_ms: row.get(10),
        notes: row.get(11),
        created_at: row.get(12),
        updated_at: row.get(13),
    }
}

fn map_postgres_experiment_source_object_link_row(row: tokio_postgres::Row) -> PostgresExperimentSourceObjectLink {
    PostgresExperimentSourceObjectLink {
        source_id: row.get(0),
        object_id: row.get(1),
        created_at: row.get(2),
    }
}

fn map_postgres_experiment_source_attribute_definition_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentSourceAttributeDefinition {
    let options_json: String = row.get(4);
    PostgresExperimentSourceAttributeDefinition {
        id: row.get(0),
        project_id: project_id.to_string(),
        name: row.get(1),
        data_type: row.get(2),
        description: row.get(3),
        options: parse_postgres_experiment_attribute_options_json(&options_json),
        sort_order: row.get(5),
        created_at: row.get(6),
        updated_at: row.get(7),
    }
}

fn map_postgres_experiment_code_row(project_id: &str, row: tokio_postgres::Row) -> PostgresExperimentCode {
    PostgresExperimentCode {
        id: row.get(0),
        project_id: project_id.to_string(),
        label: row.get(1),
        color: row.get(2),
        description: row.get(3),
        shortcut: row.get(4),
        parent_code_id: row.get::<usize, Option<String>>(5).unwrap_or_default(),
        sort_order: row.get(6),
        created_at: row.get(7),
        updated_at: row.get(8),
    }
}

fn map_postgres_experiment_object_row(
    project_id: &str,
    row: tokio_postgres::Row,
    attribute_values_by_object_id: &HashMap<String, Vec<PostgresExperimentObjectAttributeValue>>,
) -> PostgresExperimentObject {
    let object_id: String = row.get(0);
    PostgresExperimentObject {
        id: object_id.clone(),
        project_id: project_id.to_string(),
        object_type_id: row.get::<usize, Option<String>>(1).unwrap_or_default(),
        object_type: row.get::<usize, Option<String>>(2).unwrap_or_default(),
        object_type_system_key: row.get(3),
        source_id: row.get(4),
        source_kind: row.get(5),
        title: row.get(6),
        description: row.get(7),
        shape_override: row.get::<usize, Option<String>>(8).unwrap_or_default(),
        color_override: row.get::<usize, Option<String>>(9).unwrap_or_default(),
        fill_override: row.get::<usize, Option<String>>(10).unwrap_or_default(),
        event_start_at: row.get(11),
        event_end_at: row.get(12),
        event_time_precision: row.get(13),
        event_timezone: row.get(14),
        event_is_instant: row.get(15),
        attribute_values: attribute_values_by_object_id
            .get(&object_id)
            .cloned()
            .unwrap_or_default(),
        created_at: row.get(16),
        updated_at: row.get(17),
    }
}

fn map_postgres_experiment_relationship_type_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentRelationshipType {
    PostgresExperimentRelationshipType {
        id: row.get(0),
        project_id: project_id.to_string(),
        name: row.get(1),
        description: row.get(2),
        line_shape: row.get(3),
        line_weight: row.get(4),
        arrowhead: row.get(5),
        color: row.get(6),
        from_object_type_ids: row.get::<usize, Vec<String>>(7),
        from_object_types: row.get::<usize, Vec<String>>(8),
        to_object_type_ids: row.get::<usize, Vec<String>>(9),
        to_object_types: row.get::<usize, Vec<String>>(10),
        created_at: row.get(11),
        updated_at: row.get(12),
    }
}

async fn load_postgres_experiment_project_record(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<PostgresExperimentProject, String> {
    ensure_postgres_experiment_control_schema(app).await?;
    let (client, connection_task) = connect_postgres_runtime(app).await?;
    let row = client
        .query_opt(
            "
            SELECT id, database_name, storage_path, created_at::text, updated_at::text
            FROM projects
            WHERE id = $1
            ",
            &[&project_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project: {e}"))?;
    connection_task.abort();

    let Some(row) = row else {
        return Err("The PostgreSQL experiment project could not be found.".to_string());
    };

    let registry = PostgresExperimentProjectRegistryRecord {
        id: row.get(0),
        database_name: row.get(1),
        storage_path: row.get(2),
        created_at: row.get(3),
        updated_at: row.get(4),
    };

    load_postgres_experiment_project_from_registry(app, registry).await
}

fn row_to_postgres_experiment_app_user_record(row: tokio_postgres::Row) -> PostgresExperimentAppUserRecord {
    PostgresExperimentAppUserRecord {
        user: PostgresExperimentAppUser {
            id: row.get(0),
            name: row.get(1),
            email: row.get(2),
            role: row.get(3),
            created_at: row.get(4),
            updated_at: row.get(5),
        },
        password_hash: row.get(6),
    }
}

async fn count_postgres_experiment_app_users(app: &tauri::AppHandle) -> Result<i64, String> {
    let (client, connection_task) = connect_postgres_runtime(app).await?;
    let row = client
        .query_one("SELECT COUNT(*)::bigint FROM app_users", &[])
        .await
        .map_err(|e| format!("Could not count PostgreSQL experiment app users: {e}"))?;
    connection_task.abort();
    Ok(row.get(0))
}

async fn load_postgres_experiment_app_user_by_email(
    app: &tauri::AppHandle,
    email: &str,
) -> Result<Option<PostgresExperimentAppUserRecord>, String> {
    let (client, connection_task) = connect_postgres_runtime(app).await?;
    let row = client
        .query_opt(
            "
            SELECT id, name, email, role, created_at::text, updated_at::text, password_hash
            FROM app_users
            WHERE email = $1
            ",
            &[&email],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment app user: {e}"))?;
    connection_task.abort();
    Ok(row.map(row_to_postgres_experiment_app_user_record))
}

async fn load_postgres_experiment_app_user_by_id(
    app: &tauri::AppHandle,
    user_id: &str,
) -> Result<Option<PostgresExperimentAppUserRecord>, String> {
    let (client, connection_task) = connect_postgres_runtime(app).await?;
    let row = client
        .query_opt(
            "
            SELECT id, name, email, role, created_at::text, updated_at::text, password_hash
            FROM app_users
            WHERE id = $1
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment app user by id: {e}"))?;
    connection_task.abort();
    Ok(row.map(row_to_postgres_experiment_app_user_record))
}

async fn resolve_postgres_experiment_auth_session(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
) -> Result<Option<PostgresExperimentAuthSession>, String> {
    let runtime_session = runtime_auth_state.and_then(|state| get_postgres_runtime_auth_session(state));
    if let Some(stored_session) = runtime_session {
        if stored_session.auth_kind == "postgres_admin" {
            let identity = load_or_create_postgres_bootstrap_identity(app)?;
            return Ok(Some(PostgresExperimentAuthSession {
                auth_kind: "postgres_admin".to_string(),
                user: build_postgres_experiment_local_admin_user(&identity),
                started_at_ms: stored_session.started_at_ms,
            }));
        }

        let Some(user_record) = load_postgres_experiment_app_user_by_id(app, &stored_session.user_id).await? else {
            if let Some(state) = runtime_auth_state {
                set_postgres_runtime_auth_session(state, None);
            }
            return Ok(None);
        };

        return Ok(Some(PostgresExperimentAuthSession {
            auth_kind: "app_user".to_string(),
            user: user_record.user,
            started_at_ms: stored_session.started_at_ms,
        }));
    }
    Ok(None)
}

async fn require_postgres_experiment_auth_session(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
) -> Result<PostgresExperimentAuthSession, String> {
    ensure_postgres_experiment_auth_ready(app).await?;
    resolve_postgres_experiment_auth_session(app, runtime_auth_state)
        .await?
        .ok_or_else(|| "Sign in to the PostgreSQL experiment first.".to_string())
}

fn postgres_experiment_session_is_admin(session: &PostgresExperimentAuthSession) -> bool {
    session.auth_kind == "postgres_admin" || session.user.role == "administrator"
}

async fn postgres_experiment_project_membership_role(
    app: &tauri::AppHandle,
    project: &PostgresExperimentProject,
    email: &str,
) -> Result<Option<String>, String> {
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Ok(None);
    }

    ensure_postgres_experiment_project_schema(app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(app, &project.database_name).await?;
    let row = client
        .query_opt(
            "
            SELECT role
            FROM project_users
            WHERE lower(email) = $1
            ",
            &[&normalized_email],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment project membership: {e}"))?;
    connection_task.abort();
    Ok(row.map(|row| row.get(0)))
}

async fn require_postgres_experiment_project_access(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_auth_session(app, runtime_auth_state).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    if membership_role.is_some() {
        return Ok(session);
    }

    Err("You do not have access to this PostgreSQL project.".to_string())
}

async fn require_postgres_experiment_project_membership_management(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_project_access(app, runtime_auth_state, project).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    if matches!(membership_role.as_deref(), Some("owner" | "admin")) {
        return Ok(session);
    }

    Err("Only project owners or administrators can change project membership.".to_string())
}

async fn require_postgres_experiment_project_invite_access(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
    requested_role: &str,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_project_access(app, runtime_auth_state, project).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    match membership_role.as_deref() {
        Some("owner") => Ok(session),
        Some("editor") if requested_role != "owner" => Ok(session),
        _ => Err("Only project owners, administrators, or editors can add users to this project.".to_string()),
    }
}

async fn require_postgres_experiment_project_source_management(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_project_access(app, runtime_auth_state, project).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    match membership_role.as_deref() {
        Some("owner" | "editor") => Ok(session),
        _ => Err("Only project owners, administrators, or editors can manage sources.".to_string()),
    }
}

async fn require_postgres_experiment_project_code_management(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_project_access(app, runtime_auth_state, project).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    match membership_role.as_deref() {
        Some("owner" | "editor") => Ok(session),
        _ => Err("Only project owners, administrators, or editors can manage codes.".to_string()),
    }
}

async fn require_postgres_experiment_project_annotation_management(
    app: &tauri::AppHandle,
    runtime_auth_state: Option<&tauri::State<'_, PostgresExperimentAuthState>>,
    project: &PostgresExperimentProject,
) -> Result<PostgresExperimentAuthSession, String> {
    let session = require_postgres_experiment_project_access(app, runtime_auth_state, project).await?;
    if postgres_experiment_session_is_admin(&session) {
        return Ok(session);
    }

    let membership_role = postgres_experiment_project_membership_role(app, project, &session.user.email).await?;
    match membership_role.as_deref() {
        Some("owner" | "editor" | "coder") => Ok(session),
        _ => Err("Only project owners, administrators, editors, or coders can manage annotations.".to_string()),
    }
}

async fn count_postgres_experiment_project_users_by_role(
    app: &tauri::AppHandle,
    project: &PostgresExperimentProject,
    role: &str,
) -> Result<i64, String> {
    ensure_postgres_experiment_project_schema(app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(app, &project.database_name).await?;
    let row = client
        .query_one(
            "
            SELECT COUNT(*)::bigint
            FROM project_users
            WHERE role = $1
            ",
            &[&role],
        )
        .await
        .map_err(|e| format!("Could not count PostgreSQL experiment project users by role: {e}"))?;
    connection_task.abort();
    Ok(row.get(0))
}

fn postgres_experiment_project_ai_assist_settings_from_row(
    row: &tokio_postgres::Row,
) -> PostgresExperimentProjectAiAssistSettings {
    PostgresExperimentProjectAiAssistSettings {
        enabled: row.get(2),
        allow_semantic_search: row.get(3),
        allow_question_answering: row.get(4),
        allow_summaries: row.get(5),
        allow_code_suggestions: row.get(6),
        allow_draft_reports: row.get(7),
    }
}

fn postgres_experiment_project_document_import_settings_from_row(
    row: &tokio_postgres::Row,
) -> PostgresExperimentProjectDocumentImportSettings {
    PostgresExperimentProjectDocumentImportSettings {
        store_original_file_name: row.get(8),
    }
}

fn postgres_experiment_project_canvas_state_from_row(
    row: &tokio_postgres::Row,
) -> PostgresExperimentProjectCanvasState {
    let raw: String = row.get(9);
    serde_json::from_str::<PostgresExperimentProjectCanvasState>(&raw)
        .unwrap_or_else(|_| default_postgres_experiment_project_canvas_state())
}

fn postgres_experiment_canvas_state_from_json(raw: &str) -> PostgresExperimentProjectCanvasState {
    serde_json::from_str::<PostgresExperimentProjectCanvasState>(raw)
        .unwrap_or_else(|_| default_postgres_experiment_project_canvas_state())
}

async fn load_postgres_experiment_project_settings_row(
    app: &tauri::AppHandle,
    project: &PostgresExperimentProject,
) -> Result<tokio_postgres::Row, String> {
    ensure_postgres_experiment_project_schema(app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(app, &project.database_name).await?;
    let row = client
        .query_one(
            "
            SELECT
                project_name,
                project_description,
                ai_assist_enabled,
                ai_semantic_search_allowed,
                ai_question_answering_allowed,
                ai_summaries_allowed,
                ai_code_suggestions_allowed,
                ai_draft_reports_allowed,
                document_import_store_original_file_name,
                canvas_state_json
            FROM project_settings
            WHERE id = 'default'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project settings: {e}"))?;
    connection_task.abort();
    Ok(row)
}

async fn load_postgres_experiment_project_from_registry(
    app: &tauri::AppHandle,
    registry: PostgresExperimentProjectRegistryRecord,
) -> Result<PostgresExperimentProject, String> {
    ensure_postgres_experiment_project_schema(app, &registry.database_name).await?;
    let (client, connection_task) = connect_postgres_database(app, &registry.database_name).await?;
    let row = client
        .query_one(
            "
            SELECT project_name, project_description
            FROM project_settings
            WHERE id = 'default'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project metadata: {e}"))?;
    connection_task.abort();

    Ok(PostgresExperimentProject {
        id: registry.id,
        name: row.get(0),
        description: row.get(1),
        database_name: registry.database_name,
        storage_path: registry.storage_path,
        created_at: registry.created_at,
        updated_at: registry.updated_at,
    })
}

async fn create_postgres_database_if_missing(
    app: &tauri::AppHandle,
    database_name: &str,
) -> Result<(), String> {
    let (client, connection_task) = connect_postgres_database(app, "postgres").await?;
    let exists = client
        .query_opt("SELECT 1 FROM pg_database WHERE datname = $1", &[&database_name])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL databases: {e}"))?
        .is_some();
    if !exists {
        client
            .batch_execute(&format!(
                "CREATE DATABASE \"{}\" OWNER \"{}\"",
                sql_escape_identifier(database_name),
                sql_escape_identifier(&load_postgres_runtime_config(app)?.user),
            ))
            .await
            .map_err(|e| format!("Could not create PostgreSQL project database: {e}"))?;
    }
    connection_task.abort();
    Ok(())
}

async fn drop_postgres_database_if_exists(
    app: &tauri::AppHandle,
    database_name: &str,
) -> Result<(), String> {
    let (client, connection_task) = connect_postgres_database(app, "postgres").await?;
    let _ = client
        .batch_execute(&format!(
            "DROP DATABASE IF EXISTS \"{}\"",
            sql_escape_identifier(database_name),
        ))
        .await;
    connection_task.abort();
    Ok(())
}

fn ensure_postgres_app_role_and_database(
    identity: &PostgresBootstrapIdentity,
    superuser_password: &str,
) -> Result<(), String> {
    let app_role = sql_escape_identifier(&identity.app_role_name);
    let app_password = sql_escape_literal(&identity.app_role_password);
    let app_database = sql_escape_identifier(&identity.app_database);
    let app_database_literal = sql_escape_literal(&identity.app_database);

    let role_sql = format!(
        "DO $$ BEGIN \
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role_name}') THEN \
                CREATE ROLE \"{role_ident}\" LOGIN PASSWORD '{role_password}' CREATEDB; \
            ELSE \
                ALTER ROLE \"{role_ident}\" WITH LOGIN PASSWORD '{role_password}' CREATEDB; \
            END IF; \
        END $$;",
        role_name = sql_escape_literal(&identity.app_role_name),
        role_ident = app_role,
        role_password = app_password,
    );
    run_psql_command(
        &identity.host,
        identity.port,
        &identity.superuser_name,
        superuser_password,
        "postgres",
        &role_sql,
    )?;

    let database_exists = run_psql_command(
        &identity.host,
        identity.port,
        &identity.superuser_name,
        superuser_password,
        "postgres",
        &format!("SELECT 1 FROM pg_database WHERE datname = '{app_database_literal}'"),
    )?;

    if database_exists.trim() != "1" {
        run_psql_command(
            &identity.host,
            identity.port,
            &identity.superuser_name,
            superuser_password,
            "postgres",
            &format!("CREATE DATABASE \"{app_database}\" OWNER \"{app_role}\""),
        )?;
    }

    let grants_sql = format!(
        "GRANT ALL PRIVILEGES ON DATABASE \"{app_database}\" TO \"{app_role}\"; \
         ALTER SCHEMA public OWNER TO \"{app_role}\"; \
         GRANT ALL ON SCHEMA public TO \"{app_role}\"; \
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO \"{app_role}\"; \
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO \"{app_role}\"; \
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO \"{app_role}\";",
        app_database = app_database,
        app_role = app_role,
    );
    run_psql_command(
        &identity.host,
        identity.port,
        &identity.superuser_name,
        superuser_password,
        &identity.app_database,
        &grants_sql,
    )?;

    Ok(())
}

fn hash_postgres_app_user_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| format!("Could not hash password: {e}"))
}

fn verify_postgres_app_user_password(password: &str, password_hash: &str) -> Result<bool, String> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| format!("Could not parse stored password hash: {e}"))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(format!("Could not verify password: {e}")),
    }
}

fn set_postgres_runtime_auth_session(
    state: &tauri::State<'_, PostgresExperimentAuthState>,
    session: Option<StoredPostgresExperimentAuthSession>,
) {
    let mut guard = state.0.lock().unwrap();
    *guard = session;
}

fn get_postgres_runtime_auth_session(
    state: &tauri::State<'_, PostgresExperimentAuthState>,
) -> Option<StoredPostgresExperimentAuthSession> {
    state.0.lock().unwrap().clone()
}

fn default_postgres_auth_session_kind() -> String {
    "app_user".to_string()
}

fn build_postgres_experiment_local_admin_user(identity: &PostgresBootstrapIdentity) -> PostgresExperimentAppUser {
    PostgresExperimentAppUser {
        id: format!("postgres-admin:{}", identity.superuser_name),
        name: "PostgreSQL Administrator".to_string(),
        email: identity.superuser_name.clone(),
        role: "administrator".to_string(),
        created_at: "local".to_string(),
        updated_at: "local".to_string(),
    }
}

fn normalize_postgres_experiment_project_role(role: &str) -> Option<String> {
    match role.trim().to_lowercase().as_str() {
        "owner" => Some("owner".to_string()),
        "editor" => Some("editor".to_string()),
        "coder" => Some("coder".to_string()),
        "viewer" => Some("viewer".to_string()),
        _ => None,
    }
}

fn sanitize_postgres_experiment_file_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "source".to_string();
    }
    let sanitized = trimmed
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches(|ch| ch == '.' || ch == ' ')
        .to_string();
    if sanitized.is_empty() {
        "source".to_string()
    } else {
        sanitized
    }
}

fn emit_postgres_experiment_project_change(
    app: &tauri::AppHandle,
    project_id: &str,
    entity_type: &str,
    entity_id: &str,
    change_kind: &str,
) {
    let _ = app.emit(
        "postgres-project-changed",
        PostgresExperimentProjectChangeEvent {
            project_id: project_id.to_string(),
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            change_kind: change_kind.to_string(),
        },
    );
}

async fn append_postgres_experiment_project_log_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    session: &PostgresExperimentAuthSession,
    action: &str,
    label: &str,
    record_id: Option<&str>,
    details: Option<serde_json::Value>,
) -> Result<(), String> {
    let details_json = details
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|e| format!("Could not serialize PostgreSQL experiment project log details: {e}"))?;
    client
        .execute(
            "
            INSERT INTO project_log (
                id,
                user_id,
                user_name,
                access_mode,
                action,
                label,
                record_id,
                details_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ",
            &[
                &generate_identifier(),
                &session.user.id,
                &session.user.name,
                &Some("local".to_string()),
                &action.to_string(),
                &label.to_string(),
                &record_id.map(str::to_string),
                &details_json,
            ],
        )
        .await
        .map_err(|e| format!("Could not write PostgreSQL experiment project log entry for project {project_id}: {e}"))?;
    Ok(())
}

fn postgres_experiment_auth_not_ready_message(identity: &PostgresBootstrapIdentity) -> Option<String> {
    if !identity.bootstrap_applied {
        return Some("Complete PostgreSQL bootstrap before using PostgreSQL app auth.".to_string());
    }
    if !identity.admin_handoff_completed {
        return Some("Complete PostgreSQL admin handoff before using PostgreSQL app auth.".to_string());
    }
    None
}

async fn ensure_postgres_experiment_auth_ready(app: &tauri::AppHandle) -> Result<(), String> {
    let identity = load_or_create_postgres_bootstrap_identity(app)?;
    if let Some(message) = postgres_experiment_auth_not_ready_message(&identity) {
        return Err(message);
    }
    ensure_postgres_experiment_control_schema(app).await?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    app_data_dir: String,
    app_version: String,
    portable_mode: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeTestConfig {
    enabled: bool,
    run_id: Option<String>,
    state_path: Option<String>,
    user_name: Option<String>,
    user_email: Option<String>,
    user_password: Option<String>,
    project_name: Option<String>,
    app_data_dir: String,
    portable_mode: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmokeTestStateUpdateRequest {
    phase: String,
    message: Option<String>,
    success: Option<bool>,
    failure: Option<String>,
    project_id: Option<String>,
    user_email: Option<String>,
    app_data_dir: Option<String>,
    portable_mode: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackendIdentity {
    version: u32,
    superuser_email: String,
    superuser_password: String,
    created_at_ms: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresBootstrapIdentity {
    version: u32,
    host: String,
    port: u16,
    superuser_name: String,
    temporary_superuser_password: String,
    app_database: String,
    app_role_name: String,
    app_role_password: String,
    #[serde(default)]
    bootstrap_applied: bool,
    #[serde(default)]
    admin_handoff_completed: bool,
    created_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentStatus {
    host: String,
    port: u16,
    psql_path: String,
    postgresql_conf_path: String,
    psql_exists: bool,
    postgresql_conf_exists: bool,
    bootstrap_identity_path: String,
    bootstrap_identity_exists: bool,
    service_reachable: bool,
    superuser_name: String,
    app_database: String,
    app_role_name: String,
    bootstrap_applied: bool,
    admin_handoff_completed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapPostgresExperimentRequest {
    superuser_password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapPostgresExperimentResult {
    app_database: String,
    app_role_name: String,
    bootstrap_identity_path: String,
    app_role_ready: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletePostgresAdminHandoffRequest {
    new_superuser_name: String,
    new_superuser_password: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresRuntimeConfig {
    version: u32,
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
    ready: bool,
    updated_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresSchemaMigrationResult {
    ready: bool,
    applied_versions: Vec<i32>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentAppUser {
    id: String,
    name: String,
    email: String,
    role: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentAuthSession {
    auth_kind: String,
    user: PostgresExperimentAppUser,
    started_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentAuthStatus {
    bootstrap_applied: bool,
    admin_handoff_completed: bool,
    ready: bool,
    registered_user_count: i64,
    requires_account_setup: bool,
    local_admin_name: String,
    current_session: Option<PostgresExperimentAuthSession>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentInstallationSettings {
    startup_reopen_last_project: bool,
    document_import_default_mode: String,
    document_import_auto_name_from_file: bool,
    document_import_trim_imported_text: bool,
    document_import_warn_before_empty_import: bool,
    privacy_mask_file_paths: bool,
    privacy_clear_recent_projects_on_sign_out: bool,
    privacy_forget_login_identities_on_logout: bool,
    updates_auto_check: bool,
    llm: PostgresExperimentLlmSettings,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentThemePreset {
    id: String,
    name: String,
    base: String,
    colors: HashMap<String, String>,
    border_radius: i32,
    border_width: i32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentThemeState {
    light_overrides: HashMap<String, String>,
    dark_overrides: HashMap<String, String>,
    border_radius: i32,
    border_width: i32,
    presets: Vec<PostgresExperimentThemePreset>,
    active_preset_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentUserPreferences {
    theme: String,
    density: String,
    font_size: String,
    locale: String,
    recent_project_limit: i32,
    theme_state: PostgresExperimentThemeState,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentLlmSettings {
    chunk_size: i32,
    overlap_size: i32,
    batch_size: i32,
    prefix_passages: bool,
    prefix_queries: bool,
    normalize_whitespace: bool,
    connection_mode: String,
    cloud_provider: String,
    cloud_api_secret: String,
    cloud_selected_model: String,
    ollama_enabled: bool,
    ollama_protocol: String,
    ollama_host: String,
    ollama_port: i32,
    ollama_selected_model: String,
    ollama_request_timeout_seconds: i32,
    ollama_document_processing_timeout_seconds: i32,
    ollama_temperature: f64,
    ollama_num_ctx: i32,
    ollama_keep_alive_minutes: i32,
    ollama_relevant_segments_candidate_limit: i32,
    ollama_relevant_segments_max_results: i32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRememberedAccount {
    email: String,
    name: String,
    last_login: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentDeviceState {
    dismissed_update_version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRecentProject {
    id: String,
    name: String,
    description: String,
    opened_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentUserProjectState {
    last_opened_project_id: Option<String>,
    recent_projects: Vec<PostgresExperimentRecentProject>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredPostgresExperimentAuthSession {
    version: u32,
    #[serde(default = "default_postgres_auth_session_kind")]
    auth_kind: String,
    user_id: String,
    started_at_ms: u64,
}

#[derive(Clone)]
struct PostgresExperimentAppUserRecord {
    user: PostgresExperimentAppUser,
    password_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProject {
    id: String,
    name: String,
    description: String,
    database_name: String,
    storage_path: String,
    created_at: String,
    updated_at: String,
}

struct PostgresExperimentProjectRegistryRecord {
    id: String,
    database_name: String,
    storage_path: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectUser {
    id: String,
    project_id: String,
    app_user_id: String,
    name: String,
    email: String,
    role: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectAiAssistSettings {
    enabled: bool,
    allow_semantic_search: bool,
    allow_question_answering: bool,
    allow_summaries: bool,
    allow_code_suggestions: bool,
    allow_draft_reports: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectDocumentImportSettings {
    store_original_file_name: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentCanvasPoint {
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentCanvasNodeState {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentCanvasViewport {
    x: f64,
    y: f64,
    zoom: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PostgresExperimentCanvasShape {
    Pen {
        id: String,
        points: Vec<PostgresExperimentCanvasPoint>,
        color: String,
        #[serde(rename = "strokeWidth")]
        stroke_width: f64,
    },
    Rectangle {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        color: String,
        #[serde(rename = "strokeWidth")]
        stroke_width: f64,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectCanvasState {
    viewport: PostgresExperimentCanvasViewport,
    #[serde(default)]
    nodes: Vec<PostgresExperimentCanvasNodeState>,
    #[serde(default)]
    shapes: Vec<PostgresExperimentCanvasShape>,
    #[serde(default)]
    hidden_relationship_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSavedDrawing {
    id: String,
    project_id: String,
    name: String,
    canvas_kind: String,
    state: PostgresExperimentProjectCanvasState,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSavedDrawingSummary {
    id: String,
    project_id: String,
    name: String,
    canvas_kind: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentObject {
    id: String,
    project_id: String,
    object_type_id: String,
    object_type: String,
    object_type_system_key: Option<String>,
    source_id: Option<String>,
    source_kind: Option<String>,
    title: String,
    description: String,
    shape_override: String,
    color_override: String,
    fill_override: String,
    event_start_at: Option<String>,
    event_end_at: Option<String>,
    event_time_precision: Option<String>,
    event_timezone: Option<String>,
    event_is_instant: Option<bool>,
    attribute_values: Vec<PostgresExperimentObjectAttributeValue>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentObjectType {
    id: String,
    project_id: String,
    system_key: Option<String>,
    name: String,
    description: String,
    shape: String,
    color: String,
    fill: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSource {
    id: String,
    project_id: String,
    source_kind: String,
    title: String,
    original_file_name: String,
    storage_path: String,
    text_content: String,
    structured_content_json: String,
    waveform_peaks_json: String,
    video_frame_index_json: String,
    extracted_from_video_source_id: String,
    extracted_from_video_time_ms: Option<i64>,
    notes: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSourceObjectLink {
    source_id: String,
    object_id: String,
    created_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSourceLock {
    id: String,
    source_id: String,
    user_id: String,
    user_name: String,
    expires_at_ms: i64,
    created_at: String,
    updated_at: String,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSourceAttributeDefinition {
    id: String,
    project_id: String,
    name: String,
    data_type: String,
    description: String,
    options: Vec<String>,
    sort_order: i32,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSourceAttributeValue {
    id: String,
    source_id: String,
    attribute_definition_id: String,
    attribute_name: String,
    data_type: String,
    value: String,
    sort_order: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentCode {
    id: String,
    project_id: String,
    label: String,
    color: String,
    description: String,
    shortcut: String,
    parent_code_id: String,
    sort_order: i32,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentImageRegionSelector {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    image_width: f64,
    image_height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentAnnotationSummary {
    id: String,
    display_id: i64,
    project_id: String,
    source_id: String,
    code_ids: Vec<String>,
    primary_code_id: String,
    primary_code_label: String,
    start_offset: Option<i32>,
    end_offset: Option<i32>,
    time_start_ms: Option<i64>,
    time_end_ms: Option<i64>,
    quote: String,
    note: String,
    anchor_kind: String,
    image_region: Option<PostgresExperimentImageRegionSelector>,
    created_by_project_user_id: String,
    created_by_name: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentMemo {
    id: String,
    project_id: String,
    title: String,
    body: String,
    created_by_project_user_id: String,
    created_by_name: String,
    source_ids: Vec<String>,
    annotation_ids: Vec<String>,
    code_ids: Vec<String>,
    object_ids: Vec<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRelationshipType {
    id: String,
    project_id: String,
    name: String,
    description: String,
    line_shape: String,
    line_weight: i32,
    arrowhead: String,
    color: String,
    from_object_type_ids: Vec<String>,
    from_object_types: Vec<String>,
    to_object_type_ids: Vec<String>,
    to_object_types: Vec<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentObjectAttributeDefinition {
    id: String,
    project_id: String,
    object_type_id: String,
    object_type: String,
    name: String,
    data_type: String,
    description: String,
    options: Vec<String>,
    sort_order: i32,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentObjectAttributeValue {
    id: String,
    object_id: String,
    attribute_definition_id: String,
    attribute_name: String,
    data_type: String,
    value: String,
    sort_order: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRelationship {
    id: String,
    project_id: String,
    from_object_id: String,
    to_object_id: String,
    relationship_type_id: String,
    relationship_type: String,
    description: String,
    line_shape_override: String,
    line_weight_override: Option<i32>,
    arrowhead_override: String,
    color_override: String,
    attribute_values: Vec<PostgresExperimentRelationshipAttributeValue>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRelationshipAttributeDefinition {
    id: String,
    project_id: String,
    relationship_type_id: String,
    relationship_type: String,
    name: String,
    data_type: String,
    description: String,
    options: Vec<String>,
    sort_order: i32,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRelationshipAttributeValue {
    id: String,
    relationship_id: String,
    attribute_definition_id: String,
    attribute_name: String,
    data_type: String,
    value: String,
    sort_order: i32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectChangeEvent {
    project_id: String,
    entity_type: String,
    entity_id: String,
    change_kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentProjectLogEntry {
    id: String,
    project_id: String,
    user_id: String,
    user_name: String,
    access_mode: Option<String>,
    action: String,
    label: String,
    record_id: Option<String>,
    details_json: Option<String>,
    occurred_at: String,
    restored_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentProjectRequest {
    name: String,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentProjectRequest {
    project_id: String,
    name: String,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterPostgresExperimentAppUserRequest {
    name: String,
    email: String,
    password: String,
    remember_session: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginPostgresExperimentAdminRequest {
    username: String,
    password: String,
    remember_session: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginPostgresExperimentAppUserRequest {
    email: String,
    password: String,
    remember_session: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentAppUserProfileRequest {
    name: String,
    email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePostgresExperimentAppUserPasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentProjectUserRequest {
    project_id: String,
    app_user_id: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentProjectUserRequest {
    project_id: String,
    project_user_id: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentProjectAiAssistSettingsRequest {
    project_id: String,
    settings: PostgresExperimentProjectAiAssistSettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentProjectDocumentImportSettingsRequest {
    project_id: String,
    settings: PostgresExperimentProjectDocumentImportSettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentSourceRequest {
    project_id: String,
    source_kind: String,
    title: String,
    original_file_name: Option<String>,
    storage_path: Option<String>,
    text_content: String,
    structured_content_json: Option<String>,
    waveform_peaks_json: Option<String>,
    video_frame_index_json: Option<String>,
    extracted_from_video_source_id: Option<String>,
    extracted_from_video_time_ms: Option<i64>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentSourceRequest {
    project_id: String,
    source_id: String,
    source_kind: String,
    title: String,
    original_file_name: Option<String>,
    storage_path: Option<String>,
    text_content: String,
    structured_content_json: Option<String>,
    waveform_peaks_json: Option<String>,
    video_frame_index_json: Option<String>,
    extracted_from_video_source_id: Option<String>,
    extracted_from_video_time_ms: Option<i64>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPostgresExperimentSourceFileRequest {
    project_id: String,
    source_kind: String,
    title: String,
    original_file_name: String,
    media_type: Option<String>,
    file_bytes_base64: String,
    text_content: String,
    structured_content_json: Option<String>,
    waveform_peaks_json: Option<String>,
    video_frame_index_json: Option<String>,
    extracted_from_video_source_id: Option<String>,
    extracted_from_video_time_ms: Option<i64>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcquirePostgresExperimentSourceLockRequest {
    project_id: String,
    source_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KickPostgresExperimentSourceLockRequest {
    project_id: String,
    source_id: String,
    lock_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AcquirePostgresExperimentSourceLockResult {
    ok: bool,
    lock: Option<PostgresExperimentSourceLock>,
    conflict: Option<PostgresExperimentSourceLock>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentSourceAttributeValueInput {
    source_id: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentSourceAttributeRequest {
    project_id: String,
    attribute_definition_id: Option<String>,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    values: Vec<PostgresExperimentSourceAttributeValueInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentSourceAttributeResult {
    attribute_definition: PostgresExperimentSourceAttributeDefinition,
    values: Vec<PostgresExperimentSourceAttributeValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPostgresExperimentSourceObjectsRequest {
    project_id: String,
    source_id: String,
    #[serde(default)]
    object_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentCodeRequest {
    project_id: String,
    label: String,
    color: Option<String>,
    description: Option<String>,
    shortcut: Option<String>,
    parent_code_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentCodeRequest {
    project_id: String,
    code_id: String,
    label: String,
    color: Option<String>,
    description: Option<String>,
    shortcut: Option<String>,
    parent_code_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentAnnotationRequest {
    project_id: String,
    source_id: String,
    code_ids: Vec<String>,
    start_offset: Option<i32>,
    end_offset: Option<i32>,
    time_start_ms: Option<i64>,
    time_end_ms: Option<i64>,
    quote: Option<String>,
    note: Option<String>,
    anchor_kind: Option<String>,
    image_region: Option<PostgresExperimentImageRegionSelector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentAnnotationRequest {
    project_id: String,
    annotation_id: String,
    code_ids: Vec<String>,
    start_offset: Option<i32>,
    end_offset: Option<i32>,
    time_start_ms: Option<i64>,
    time_end_ms: Option<i64>,
    quote: Option<String>,
    note: Option<String>,
    anchor_kind: Option<String>,
    image_region: Option<PostgresExperimentImageRegionSelector>,
}

fn validate_postgres_experiment_annotation_image_region(
    region: &PostgresExperimentImageRegionSelector,
) -> Result<(), String> {
    if region.width <= 0.0 || region.height <= 0.0 {
        return Err("Image annotation regions must have a positive width and height.".to_string());
    }
    if region.image_width <= 0.0 || region.image_height <= 0.0 {
        return Err("Image annotation regions must include positive image dimensions.".to_string());
    }
    if region.x < 0.0 || region.y < 0.0 {
        return Err("Image annotation regions cannot start outside the image bounds.".to_string());
    }
    let right = region.x + region.width;
    let bottom = region.y + region.height;
    if right > region.image_width + 0.5 || bottom > region.image_height + 0.5 {
        return Err("Image annotation regions must stay within the image bounds.".to_string());
    }
    Ok(())
}

fn validate_postgres_experiment_annotation_time_range(
    time_start_ms: Option<i64>,
    time_end_ms: Option<i64>,
) -> Result<(), String> {
    if let Some(start_ms) = time_start_ms {
        if start_ms < 0 {
            return Err("Annotation start time cannot be negative.".to_string());
        }
    }
    if let Some(end_ms) = time_end_ms {
        if end_ms < 0 {
            return Err("Annotation end time cannot be negative.".to_string());
        }
    }
    if let (Some(start_ms), Some(end_ms)) = (time_start_ms, time_end_ms) {
        if end_ms < start_ms {
            return Err("Annotation end time must be greater than or equal to the start time.".to_string());
        }
    }
    Ok(())
}

fn parse_postgres_experiment_annotation_image_region(
    raw: &str,
) -> Option<PostgresExperimentImageRegionSelector> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return None;
    }
    serde_json::from_str::<PostgresExperimentImageRegionSelector>(trimmed).ok()
}

fn serialize_postgres_experiment_annotation_image_region(
    region: Option<&PostgresExperimentImageRegionSelector>,
) -> Result<String, String> {
    match region {
        Some(value) => serde_json::to_string(value)
            .map_err(|e| format!("Could not store PostgreSQL experiment annotation region: {e}")),
        None => Ok("{}".to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentMemoRequest {
    project_id: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default)]
    annotation_ids: Vec<String>,
    #[serde(default)]
    code_ids: Vec<String>,
    #[serde(default)]
    object_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentMemoRequest {
    project_id: String,
    memo_id: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default)]
    annotation_ids: Vec<String>,
    #[serde(default)]
    code_ids: Vec<String>,
    #[serde(default)]
    object_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentProjectCanvasStateRequest {
    project_id: String,
    state: PostgresExperimentProjectCanvasState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentSavedDrawingRequest {
    project_id: String,
    drawing_id: Option<String>,
    name: Option<String>,
    canvas_kind: Option<String>,
    state: PostgresExperimentProjectCanvasState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentProjectUserResult {
    project_id: String,
    project_user_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentProjectResult {
    project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentObjectRequest {
    project_id: String,
    object_type_id: String,
    title: String,
    description: String,
    shape_override: Option<String>,
    color_override: Option<String>,
    fill_override: Option<String>,
    event_start_at: Option<String>,
    event_end_at: Option<String>,
    event_time_precision: Option<String>,
    event_timezone: Option<String>,
    event_is_instant: Option<bool>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentObjectAttributeValueInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentObjectRequest {
    project_id: String,
    object_id: String,
    object_type_id: String,
    title: String,
    description: String,
    shape_override: Option<String>,
    color_override: Option<String>,
    fill_override: Option<String>,
    event_start_at: Option<String>,
    event_end_at: Option<String>,
    event_time_precision: Option<String>,
    event_timezone: Option<String>,
    event_is_instant: Option<bool>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentObjectAttributeValueInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentObjectRequest {
    project_id: String,
    object_id: Option<String>,
    object_type_id: String,
    title: String,
    description: String,
    shape_override: Option<String>,
    color_override: Option<String>,
    fill_override: Option<String>,
    event_start_at: Option<String>,
    event_end_at: Option<String>,
    event_time_precision: Option<String>,
    event_timezone: Option<String>,
    event_is_instant: Option<bool>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentObjectAttributeValueInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentObjectResult {
    project_id: String,
    object_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentObjectTypeRequest {
    project_id: String,
    name: String,
    description: String,
    shape: String,
    color: String,
    fill: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentObjectTypeRequest {
    project_id: String,
    object_type_id: String,
    name: String,
    description: String,
    shape: String,
    color: String,
    fill: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentObjectTypeAttributeDefinitionInput {
    id: Option<String>,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentObjectTypeRequest {
    project_id: String,
    object_type_id: Option<String>,
    name: String,
    description: String,
    shape: String,
    color: String,
    fill: String,
    #[serde(default)]
    attributes: Vec<SavePostgresExperimentObjectTypeAttributeDefinitionInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentObjectTypeResult {
    object_type: PostgresExperimentObjectType,
    attribute_definitions: Vec<PostgresExperimentObjectAttributeDefinition>,
    created: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentRelationshipTypeRequest {
    project_id: String,
    name: String,
    description: String,
    line_shape: String,
    line_weight: i32,
    arrowhead: String,
    color: String,
    #[serde(default)]
    from_object_type_ids: Vec<String>,
    #[serde(default)]
    to_object_type_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentRelationshipTypeRequest {
    project_id: String,
    relationship_type_id: String,
    name: String,
    description: String,
    line_shape: String,
    line_weight: i32,
    arrowhead: String,
    color: String,
    #[serde(default)]
    from_object_type_ids: Vec<String>,
    #[serde(default)]
    to_object_type_ids: Vec<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentRelationshipTypeAttributeDefinitionInput {
    id: Option<String>,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentRelationshipTypeRequest {
    project_id: String,
    relationship_type_id: Option<String>,
    name: String,
    description: String,
    line_shape: String,
    line_weight: i32,
    arrowhead: String,
    color: String,
    #[serde(default)]
    from_object_type_ids: Vec<String>,
    #[serde(default)]
    to_object_type_ids: Vec<String>,
    #[serde(default)]
    attributes: Vec<SavePostgresExperimentRelationshipTypeAttributeDefinitionInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentRelationshipTypeResult {
    relationship_type: PostgresExperimentRelationshipType,
    attribute_definitions: Vec<PostgresExperimentRelationshipAttributeDefinition>,
    created: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentObjectAttributeDefinitionResult {
    project_id: String,
    attribute_definition_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentSourceAttributeDefinitionResult {
    project_id: String,
    attribute_definition_id: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentObjectAttributeValueInput {
    attribute_definition_id: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentObjectAttributeDefinitionRequest {
    project_id: String,
    object_type_id: String,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentObjectAttributeDefinitionRequest {
    project_id: String,
    attribute_definition_id: String,
    object_type_id: String,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentRelationshipRequest {
    project_id: String,
    from_object_id: String,
    to_object_id: String,
    relationship_type_id: String,
    description: String,
    line_shape_override: Option<String>,
    line_weight_override: Option<i32>,
    arrowhead_override: Option<String>,
    color_override: Option<String>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentRelationshipAttributeValueInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentRelationshipRequest {
    project_id: String,
    relationship_id: String,
    from_object_id: String,
    to_object_id: String,
    relationship_type_id: String,
    description: String,
    line_shape_override: Option<String>,
    line_weight_override: Option<i32>,
    arrowhead_override: Option<String>,
    color_override: Option<String>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentRelationshipAttributeValueInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePostgresExperimentRelationshipRequest {
    project_id: String,
    relationship_id: Option<String>,
    from_object_id: String,
    to_object_id: String,
    relationship_type_id: String,
    description: String,
    line_shape_override: Option<String>,
    line_weight_override: Option<i32>,
    arrowhead_override: Option<String>,
    color_override: Option<String>,
    #[serde(default)]
    attribute_values: Vec<PostgresExperimentRelationshipAttributeValueInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentRelationshipResult {
    project_id: String,
    relationship_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePostgresExperimentRelationshipAttributeDefinitionResult {
    project_id: String,
    attribute_definition_id: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PostgresExperimentRelationshipAttributeValueInput {
    attribute_definition_id: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePostgresExperimentRelationshipAttributeDefinitionRequest {
    project_id: String,
    relationship_type_id: String,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostgresExperimentRelationshipAttributeDefinitionRequest {
    project_id: String,
    attribute_definition_id: String,
    relationship_type_id: String,
    name: String,
    data_type: String,
    description: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateUserAccountCommandRequest {
    name: String,
    email: String,
    password: String,
    password_confirm: String,
    user_identifier: Option<String>,
    must_change_password: Option<bool>,
    app_role: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterUserAccountCommandRequest {
    name: String,
    email: String,
    password: String,
    password_confirm: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureImportedUserAccountCommandRequest {
    name: String,
    email: String,
    password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedCreateUserAccountCommandRequest {
    auth_token: String,
    request: CreateUserAccountCommandRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedEnsureImportedUserAccountCommandRequest {
    auth_token: String,
    request: EnsureImportedUserAccountCommandRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateUserAccountRequest {
    user_id: String,
    name: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedUpdateUserAccountRequest {
    auth_token: String,
    request: UpdateUserAccountRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedRegisteredUsersRequest {
    auth_token: String,
}

#[derive(Deserialize)]
struct PocketBaseAdminAuthResponse {
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PocketBaseAuthRefreshResponse {
    #[allow(dead_code)]
    token: String,
    record: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterUserAccountCommandResponse {
    id: String,
    app_role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisteredUserAccountSummary {
    id: String,
    name: String,
    email: String,
    app_role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnsureImportedUserAccountCommandResponse {
    id: String,
    created: bool,
    temporary_password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PocketBaseCollectionInfo {
    name: String,
    system: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PocketBaseListResponse<T> {
    items: Vec<T>,
    total_pages: u32,
}

#[derive(Deserialize)]
struct PocketBaseRecordId {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptProjectBackupRequest {
    backup_json: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecryptProjectBackupRequest {
    encrypted_backup: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackupKdfSpec {
    name: String,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt_b64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackupEnvelope {
    kind: String,
    version: u32,
    cipher: String,
    kdf: EncryptedBackupKdfSpec,
    nonce_b64: String,
    ciphertext_b64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecryptedProjectBackupPreview {
    project_name: String,
    created_at: Option<String>,
    version: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingModelStatus {
    installed: bool,
    repo_id: String,
    display_name: String,
    model_dir: String,
    files: u64,
    bytes: u64,
    downloaded_at_ms: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingModelMetadata {
    downloaded_at_ms: u64,
}

struct EmbeddingModelDownloadState(Mutex<EmbeddingModelDownloadStatusState>);

#[derive(Clone)]
struct ProjectEmbeddingBuildStatusState {
    phase: String,
    project_id: Option<String>,
    total_items: u64,
    completed_items: u64,
    started_at_ms: Option<u64>,
    current_label: Option<String>,
    message: Option<String>,
    cancel_requested: bool,
}

#[derive(Clone)]
struct EmbeddingModelDownloadStatusState {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    downloaded_files: u64,
    total_files: u64,
    current_file: Option<String>,
    message: Option<String>,
    cancel_requested: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingModelDownloadStatus {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    downloaded_files: u64,
    total_files: u64,
    current_file: Option<String>,
    progress_percent: Option<f64>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingModelDownloadPreflight {
    installed: bool,
    model_dir: String,
    total_bytes: u64,
    existing_bytes: u64,
    remaining_bytes: u64,
    total_files: Option<u64>,
    existing_files: u64,
    remaining_files: Option<u64>,
    manifest_available: bool,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingBuildStatus {
    phase: String,
    project_id: Option<String>,
    total_items: u64,
    completed_items: u64,
    progress_percent: Option<f64>,
    started_at_ms: Option<u64>,
    current_label: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingBuildPreflight {
    total_items: u64,
    pending_items: u64,
    reused_items: u64,
    pending_characters: u64,
    estimated_seconds_low: Option<u64>,
    estimated_seconds_high: Option<u64>,
    parallelism: usize,
    estimate_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingStoreStatus {
    exists: bool,
    generated_at_ms: Option<u64>,
    item_count: u64,
    model_repo_id: Option<String>,
    model_display_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingBuildSource {
    source_type: String,
    source_id: String,
    title: String,
    source_hash: String,
    items: Vec<ProjectEmbeddingBuildItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingBuildItem {
    id: String,
    item_type: String,
    source_id: String,
    title: String,
    text: String,
    content_hash: String,
    document_id: Option<String>,
    case_id: Option<String>,
    code_id: Option<String>,
    annotation_id: Option<String>,
    memo_id: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingBuildRequest {
    project_id: String,
    batch_size: usize,
    chunk_size: usize,
    overlap_size: usize,
    prefix_passages: bool,
    normalize_whitespace: bool,
    sources: Vec<ProjectEmbeddingBuildSource>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingStoreItem {
    id: String,
    item_type: String,
    source_id: String,
    title: String,
    text: String,
    #[serde(default)]
    content_hash: String,
    document_id: Option<String>,
    case_id: Option<String>,
    code_id: Option<String>,
    annotation_id: Option<String>,
    memo_id: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
    embedding: Vec<f32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingStoreSnapshot {
    project_id: String,
    model_repo_id: String,
    model_display_name: String,
    generated_at_ms: u64,
    item_count: u64,
    chunk_size: usize,
    overlap_size: usize,
    prefix_passages: bool,
    normalize_whitespace: bool,
    items: Vec<ProjectEmbeddingStoreItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingMetadataSource {
    source_type: String,
    source_id: String,
    title: String,
    source_hash: String,
    active: bool,
    chunk_count: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingMetadataChunk {
    vector_id: u64,
    source_type: String,
    source_id: String,
    active: bool,
    item: ProjectEmbeddingStoreItem,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingMetadataFile {
    project_id: String,
    model_repo_id: String,
    model_display_name: String,
    generated_at_ms: u64,
    chunking_version: u32,
    settings_hash: String,
    next_vector_id: u64,
    sources: Vec<ProjectEmbeddingMetadataSource>,
    chunks: Vec<ProjectEmbeddingMetadataChunk>,
}

struct LocalEmbeddingRuntime {
    tokenizer: Tokenizer,
    model: XLMRobertaModel,
    device: Device,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDiscoveryRequest {
    protocol: String,
    host: String,
    port: u16,
    timeout_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelSummary {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
    digest: Option<String>,
    parameter_size: Option<String>,
    quantization_level: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDiscoveryResult {
    ok: bool,
    base_url: String,
    version: Option<String>,
    model_count: u64,
    models: Vec<OllamaModelSummary>,
    message: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum CloudLlmProvider {
    Openai,
    Anthropic,
    Copilot,
    Blablador,
    Ollama,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudLlmDiscoveryRequest {
    provider: CloudLlmProvider,
    api_secret: String,
    timeout_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudLlmModelSummary {
    id: String,
    name: String,
    publisher: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudLlmDiscoveryResult {
    ok: bool,
    provider: String,
    base_url: String,
    version: Option<String>,
    model_count: u64,
    models: Vec<CloudLlmModelSummary>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaProjectChatRequest {
    project_id: String,
    query: String,
    conversation: Vec<OllamaChatMessage>,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
    prefix_queries: bool,
    #[serde(default = "default_chat_context_mode")]
    selected_context_mode: String,
    #[serde(default)]
    selected_document_ids: Vec<String>,
    #[serde(default)]
    selected_case_ids: Vec<String>,
    #[serde(default)]
    selected_code_ids: Vec<String>,
    #[serde(default)]
    selected_annotation_ids: Vec<String>,
    #[serde(default)]
    selected_memo_ids: Vec<String>,
}

fn default_chat_context_mode() -> String {
    "prioritize".to_string()
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OllamaChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaProjectChatResponse {
    content: String,
    model: String,
    base_url: String,
    used_context_items: u64,
    citations: Vec<OllamaProjectChatCitation>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaProjectChatCitation {
    id: String,
    item_type: String,
    title: String,
    preview: String,
    document_id: Option<String>,
    case_id: Option<String>,
    code_id: Option<String>,
    annotation_id: Option<String>,
    memo_id: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaRelevantSegmentsRequest {
    project_id: String,
    active_document_id: Option<String>,
    code_id: String,
    code_label: String,
    code_description: Option<String>,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
    candidate_limit: usize,
    max_results: usize,
    prefix_queries: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaAttributeSuggestionRequest {
    run_id: String,
    attribute_name: String,
    attribute_data_type: String,
    attribute_description: Option<String>,
    #[serde(default)]
    attribute_options: Vec<String>,
    items: Vec<OllamaAttributeSuggestionItemInput>,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaAttributeSuggestionItemInput {
    id: String,
    name: String,
    content: String,
}

#[derive(Deserialize)]
struct OllamaAttributeSuggestionModelResponse {
    value: Option<String>,
    evidence: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaAttributeSuggestionResponse {
    model: String,
    base_url: String,
    suggestions: Vec<OllamaAttributeSuggestionItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaAttributeSuggestionItem {
    item_id: String,
    item_name: String,
    suggested_value: String,
    evidence_text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OllamaAttributeSuggestionProgressEvent {
    run_id: String,
    item_id: String,
    item_name: String,
    suggested_value: String,
    evidence_text: String,
    completed_items: u64,
    total_items: u64,
    model: String,
    base_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaCodeSummaryAnnotationInput {
    quote: String,
    document_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaCodeSummaryRequest {
    code_label: String,
    code_description: Option<String>,
    annotations: Vec<OllamaCodeSummaryAnnotationInput>,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaCodeSummaryResponse {
    content: String,
    model: String,
    base_url: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaMostTypicalAnnotationModelItem {
    #[serde(alias = "annotationIndex", alias = "annotation_index", alias = "index", alias = "annotation")]
    annotation_index: u64,
    reasoning: Option<String>,
}

#[derive(Deserialize)]
struct OllamaMostTypicalAnnotationModelResponse {
    #[serde(alias = "annotations", alias = "items", alias = "results", alias = "typical_annotations", alias = "typicalAnnotations")]
    annotations: Vec<OllamaMostTypicalAnnotationModelItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaMostTypicalAnnotationResponse {
    annotations: Vec<OllamaMostTypicalAnnotationModelItem>,
    model: String,
    base_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentProcessingRequest {
    document_content: String,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentChunkProcessingRequest {
    chunk_text: String,
    chunk_index: usize,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentSegmentModelItem {
    segment_type: String,
    speaker_id: Option<String>,
    #[serde(alias = "content", alias = "segmentText", alias = "segment_text", alias = "value", default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct OllamaDocumentSegmentsModelResponse {
    segments: Vec<OllamaDocumentSegmentModelItem>,
    proper_names: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentSegmentOutput {
    segment_type: String,
    speaker_id: String,
    timestamp_text: String,
    start_offset: usize,
    end_offset: usize,
    sort_order: usize,
    text: String,
    chunk_index: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentProperNameCandidate {
    text: String,
    source_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentProcessingResponse {
    processed_content: String,
    segments: Vec<OllamaDocumentSegmentOutput>,
    proper_name_candidates: Vec<OllamaDocumentProperNameCandidate>,
    model: String,
    base_url: String,
    chunk_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaDocumentChunkProcessingResponse {
    processed_content: String,
    segments: Vec<OllamaDocumentSegmentOutput>,
    proper_name_candidates: Vec<OllamaDocumentProperNameCandidate>,
    model: String,
    base_url: String,
    chunk_index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaCodebookEntry {
    label: String,
    description: Option<String>,
    parent_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaCodePositionRequest {
    code_label: String,
    code_description: Option<String>,
    annotations: Vec<OllamaCodeSummaryAnnotationInput>,
    codebook: Vec<OllamaCodebookEntry>,
    #[serde(default)]
    connection_mode: Option<String>,
    #[serde(default)]
    cloud_provider: Option<CloudLlmProvider>,
    #[serde(default)]
    cloud_api_secret: Option<String>,
    protocol: String,
    host: String,
    port: u16,
    model: String,
    timeout_seconds: u64,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
}

#[derive(Deserialize)]
struct OllamaUniqueAnnotationModelItem {
    #[serde(alias = "annotationIndex", alias = "annotation_index")]
    index: u64,
    reasoning: Option<String>,
}

#[derive(Deserialize)]
struct OllamaUniqueAnnotationsModelResponse {
    #[serde(alias = "items", alias = "results", alias = "unique_annotations", alias = "uniqueAnnotations")]
    annotations: Vec<OllamaUniqueAnnotationModelItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaUniqueAnnotationItem {
    annotation_index: u64,
    reasoning: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaUniqueAnnotationsResponse {
    annotations: Vec<OllamaUniqueAnnotationItem>,
    model: String,
    base_url: String,
}

fn normalize_attribute_options(options: &[String]) -> Vec<String> {
    options
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

fn normalize_postgres_experiment_attribute_data_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "text" => Some("text"),
        "number" => Some("number"),
        "datetime" => Some("datetime"),
        "categorical" => Some("categorical"),
        _ => None,
    }
}

fn canonicalize_categorical_suggestion(value: &str, options: &[String]) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(exact_match) = options.iter().find(|option| option == &trimmed) {
        return exact_match.clone();
    }
    let folded = trimmed.to_ascii_lowercase();
    options
        .iter()
        .find(|option| option.trim().to_ascii_lowercase() == folded)
        .cloned()
        .unwrap_or_default()
}

fn normalize_proper_name_candidate(value: &str) -> Option<String> {
    let trimmed = value
        .trim()
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '(' | ')' | '[' | ']'));
    if trimmed.len() < 2 || trimmed.len() > 80 {
        return None;
    }
    if !trimmed.chars().any(|ch| ch.is_alphabetic()) {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let blocked = [
        "interviewer",
        "interviewee",
        "participant",
        "participants",
        "moderator",
        "facilitator",
        "speaker",
        "respondent",
        "question",
        "answer",
        "metadata",
        "unknown",
        "n/a",
    ];
    if blocked.contains(&lower.as_str()) {
        return None;
    }
    Some(trimmed.to_string())
}

fn looks_like_named_speaker_label(value: &str) -> bool {
    let Some(normalized) = normalize_proper_name_candidate(value) else {
        return false;
    };
    if normalized.chars().all(|ch| ch.is_uppercase() || !ch.is_alphabetic()) && normalized.len() <= 4 {
        return false;
    }
    if normalized.chars().all(|ch| ch.is_alphanumeric()) && normalized.len() <= 3 {
        return false;
    }
    true
}

fn is_interviewer_style_speaker_label(value: &str) -> bool {
    let normalized = value
        .trim()
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '(' | ')' | '[' | ']'))
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "interviewer" | "moderator" | "facilitator" | "host" | "researcher" | "q" | "q1"
    )
}

fn extract_leading_inline_speaker_label(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim_start();
    let leading_ws_len = text.len().saturating_sub(trimmed.len());
    let leading_ws = &text[..leading_ws_len];
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix('[') {
        let end = rest.find(']')?;
        let candidate = rest[..end].trim();
        let after = rest[end + 1..].trim_start();
        if candidate.len() < 1 || candidate.len() > 40 {
            return None;
        }
        if !after.starts_with(':') && !after.starts_with('-') && !after.starts_with('—') {
            return None;
        }
        if !candidate.chars().any(|ch| ch.is_alphabetic()) {
            return None;
        }
        if !candidate
            .chars()
            .all(|ch| ch.is_alphanumeric() || matches!(ch, ' ' | '_' | '-' | '.'))
        {
            return None;
        }
        let after_delimiter = after[after.chars().next()?.len_utf8()..].trim_start();
        let cleaned = format!("{}{}", leading_ws, after_delimiter).trim().to_string();
        return Some((candidate.to_string(), cleaned));
    }

    let first_line_end = trimmed.find('\n').unwrap_or(trimmed.len());
    let first_line = &trimmed[..first_line_end];
    let delimiter = [":", " - ", " – ", " — "]
        .into_iter()
        .filter_map(|pattern| first_line.find(pattern).map(|index| (index, pattern)))
        .min_by_key(|(index, _)| *index)?;
    let delimiter_index = delimiter.0;
    let delimiter_text = delimiter.1;
    if delimiter_index == 0 || delimiter_index > 32 {
        return None;
    }
    let candidate = first_line[..delimiter_index].trim();
    if candidate.len() < 1 || candidate.len() > 32 {
        return None;
    }
    if !candidate.chars().any(|ch| ch.is_alphabetic()) {
        return None;
    }
    if !candidate
        .chars()
        .all(|ch| ch.is_alphanumeric() || matches!(ch, ' ' | '_' | '-' | '.'))
    {
        return None;
    }
    let after_delimiter = trimmed[delimiter_index + delimiter_text.len()..].trim_start();
    let cleaned = format!("{}{}", leading_ws, after_delimiter).trim().to_string();
    Some((candidate.to_string(), cleaned))
}

fn extract_transcript_leading_metadata(text: &str) -> (String, Option<String>, String) {
    let mut remaining = text.to_string();
    let mut speaker_id: Option<String> = None;
    let mut timestamps: Vec<String> = Vec::new();

    loop {
        let mut changed = false;

        let (without_timestamps, timestamp_text) = extract_leading_timestamp_metadata(&remaining);
        if !timestamp_text.is_empty() {
            timestamps.push(timestamp_text);
            remaining = without_timestamps;
            changed = true;
        }

        if speaker_id.is_none() {
            if let Some((detected_speaker_id, without_speaker_label)) =
                extract_leading_inline_speaker_label(&remaining)
            {
                speaker_id = Some(detected_speaker_id);
                remaining = without_speaker_label;
                changed = true;
            }
        }

        if !changed {
            break;
        }
    }

    (remaining.trim().to_string(), speaker_id, timestamps.join(" "))
}

fn infer_inline_speaker_label(text: &str) -> Option<String> {
    let (_, speaker_id, _) = extract_transcript_leading_metadata(text);
    speaker_id
}

fn split_text_on_inline_speaker_labels(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();

    for line in trimmed.split_inclusive('\n') {
        let has_inline_label = infer_inline_speaker_label(line.trim_start()).is_some();
        if has_inline_label && !current.trim().is_empty() {
            segments.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(line);
    }

    if !current.trim().is_empty() {
        segments.push(current.trim().to_string());
    }

    if segments.is_empty() {
        vec![trimmed.to_string()]
    } else {
        segments
    }
}

fn is_supported_timestamp_body(body: &str) -> bool {
    let parts = body.split('-').map(str::trim).collect::<Vec<_>>();
    if parts.is_empty() || parts.len() > 2 {
        return false;
    }
    parts.iter().all(|part| {
        let fields = part.split(':').collect::<Vec<_>>();
        (fields.len() == 2 || fields.len() == 3)
            && fields.iter().all(|field| !field.is_empty() && field.chars().all(|ch| ch.is_ascii_digit()))
    })
}

fn extract_leading_timestamp_metadata(text: &str) -> (String, String) {
    let trimmed = text.trim_start();
    let leading_ws_len = text.len().saturating_sub(trimmed.len());
    let leading_ws = &text[..leading_ws_len];
    let mut remaining = trimmed;
    let mut timestamps: Vec<String> = Vec::new();

    loop {
        let Some(rest) = remaining.strip_prefix('[') else {
            break;
        };
        let Some(end) = rest.find(']') else {
            break;
        };
        let candidate = rest[..end].trim();
        if !is_supported_timestamp_body(candidate) {
            break;
        }
        timestamps.push(format!("[{}]", candidate));
        remaining = rest[end + 1..].trim_start();
    }

    let cleaned = if timestamps.is_empty() {
        text.trim().to_string()
    } else {
        format!("{}{}", leading_ws, remaining).trim().to_string()
    };

    (cleaned, timestamps.join(" "))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaRelevantSegmentsModelResponse {
    segments: Vec<OllamaRelevantSegmentsModelItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaRelevantSegmentsModelItem {
    id: String,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaRelevantSegmentsResponse {
    model: String,
    base_url: String,
    searched_items: u64,
    segments: Vec<OllamaRelevantSegment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaRelevantSegment {
    id: String,
    item_type: String,
    title: String,
    preview: String,
    match_text: Option<String>,
    reason: String,
    similarity: f32,
    document_id: Option<String>,
    code_id: Option<String>,
    annotation_id: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
}

impl EmbeddingModelDownloadStatusState {
    fn idle() -> Self {
        Self {
            phase: "idle".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            downloaded_files: 0,
            total_files: 0,
            current_file: None,
            message: None,
            cancel_requested: false,
        }
    }
}

impl ProjectEmbeddingBuildStatusState {
    fn idle() -> Self {
        Self {
            phase: "idle".to_string(),
            project_id: None,
            total_items: 0,
            completed_items: 0,
            started_at_ms: None,
            current_label: None,
            message: None,
            cancel_requested: false,
        }
    }
}

impl From<EmbeddingModelDownloadStatusState> for EmbeddingModelDownloadStatus {
    fn from(value: EmbeddingModelDownloadStatusState) -> Self {
        let progress_percent = if let Some(total_bytes) = value.total_bytes {
            if total_bytes > 0 {
                Some((value.downloaded_bytes as f64 / total_bytes as f64 * 100.0).clamp(0.0, 100.0))
            } else if value.phase == "completed" {
                Some(100.0)
            } else {
                Some(0.0)
            }
        } else if value.total_files > 0 {
            Some((value.downloaded_files as f64 / value.total_files as f64 * 100.0).clamp(0.0, 100.0))
        } else if value.phase == "completed" {
            Some(100.0)
        } else {
            None
        };

        Self {
            phase: value.phase,
            downloaded_bytes: value.downloaded_bytes,
            total_bytes: value.total_bytes,
            downloaded_files: value.downloaded_files,
            total_files: value.total_files,
            current_file: value.current_file,
            progress_percent,
            message: value.message,
        }
    }
}

impl From<ProjectEmbeddingBuildStatusState> for ProjectEmbeddingBuildStatus {
    fn from(value: ProjectEmbeddingBuildStatusState) -> Self {
        let progress_percent = if value.total_items > 0 {
            Some((value.completed_items as f64 / value.total_items as f64 * 100.0).clamp(0.0, 100.0))
        } else if value.phase == "completed" {
            Some(100.0)
        } else {
            None
        };

        Self {
            phase: value.phase,
            project_id: value.project_id,
            total_items: value.total_items,
            completed_items: value.completed_items,
            progress_percent,
            started_at_ms: value.started_at_ms,
            current_label: value.current_label,
            message: value.message,
        }
    }
}

/// Return the URL of the local PocketBase instance.
#[tauri::command]
fn get_pb_url() -> String {
    PB_URL.to_string()
}

#[tauri::command]
fn get_app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let app_data_dir = kanqual_data_dir(&app)?;
    Ok(AppInfo {
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        app_version: app.package_info().version.to_string(),
        portable_mode: is_portable_mode()?,
    })
}

#[tauri::command]
async fn get_postgres_experiment_status_command(
    app: tauri::AppHandle,
) -> Result<PostgresExperimentStatus, String> {
    let identity = load_or_create_postgres_bootstrap_identity(&app)?;
    let psql_path = postgres_psql_path();
    let postgresql_conf_path = postgres_conf_path();
    let bootstrap_identity_path = postgres_bootstrap_identity_path(&app)?;
    let service_reachable = can_reach_postgres(&identity.host, identity.port, Duration::from_millis(750)).await;

    Ok(PostgresExperimentStatus {
        host: identity.host,
        port: identity.port,
        psql_path: psql_path.to_string_lossy().to_string(),
        postgresql_conf_path: postgresql_conf_path.to_string_lossy().to_string(),
        psql_exists: psql_path.exists(),
        postgresql_conf_exists: postgresql_conf_path.exists(),
        bootstrap_identity_path: bootstrap_identity_path.to_string_lossy().to_string(),
        bootstrap_identity_exists: bootstrap_identity_path.exists(),
        service_reachable,
        superuser_name: identity.superuser_name,
        app_database: identity.app_database,
        app_role_name: identity.app_role_name,
        bootstrap_applied: identity.bootstrap_applied,
        admin_handoff_completed: identity.admin_handoff_completed,
    })
}

#[tauri::command]
async fn bootstrap_postgres_experiment_command(
    app: tauri::AppHandle,
    request: BootstrapPostgresExperimentRequest,
) -> Result<BootstrapPostgresExperimentResult, String> {
    let superuser_password = request.superuser_password.trim().to_string();
    if superuser_password.is_empty() {
        return Err("Enter the current PostgreSQL superuser password first.".to_string());
    }

    let mut identity = load_or_create_postgres_bootstrap_identity(&app)?;
    if !can_reach_postgres(&identity.host, identity.port, Duration::from_secs(1)).await {
        return Err(format!(
            "PostgreSQL is not reachable at {}:{}.",
            identity.host, identity.port
        ));
    }

    let _ = run_psql_command(
        &identity.host,
        identity.port,
        &identity.superuser_name,
        &superuser_password,
        "postgres",
        "SELECT current_user;",
    )
    .map_err(|error| format!("Superuser login failed: {error}"))?;

    ensure_postgres_app_role_and_database(&identity, &superuser_password)?;
    identity.bootstrap_applied = true;
    identity.temporary_superuser_password = superuser_password;

    let bootstrap_identity_path = postgres_bootstrap_identity_path(&app)?;
    let serialized = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&bootstrap_identity_path, serialized).map_err(|e| e.to_string())?;
    save_postgres_runtime_config(&app, &postgres_runtime_config_from_identity(&identity))?;

    let app_role_ready = run_psql_command(
        &identity.host,
        identity.port,
        &identity.app_role_name,
        &identity.app_role_password,
        &identity.app_database,
        "SELECT current_user;",
    )
    .is_ok();

    Ok(BootstrapPostgresExperimentResult {
        app_database: identity.app_database,
        app_role_name: identity.app_role_name,
        bootstrap_identity_path: bootstrap_identity_path.to_string_lossy().to_string(),
        app_role_ready,
    })
}

#[tauri::command]
async fn complete_postgres_admin_handoff_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CompletePostgresAdminHandoffRequest,
) -> Result<PostgresExperimentStatus, String> {
    let new_superuser_name = request.new_superuser_name.trim().to_string();
    let new_superuser_password = request.new_superuser_password.trim().to_string();
    if new_superuser_name.is_empty() {
        return Err("Enter a PostgreSQL admin username.".to_string());
    }
    if !new_superuser_name
        .chars()
        .enumerate()
        .all(|(index, ch)| {
            if index == 0 {
                ch == '_' || ch.is_ascii_alphabetic()
            } else {
                ch == '_' || ch.is_ascii_alphanumeric()
            }
        })
    {
        return Err("Use a PostgreSQL admin username that starts with a letter or underscore and only contains letters, numbers, or underscores.".to_string());
    }
    if new_superuser_password.is_empty() {
        return Err("Enter a new PostgreSQL admin password.".to_string());
    }
    if new_superuser_password.len() < 8 {
        return Err("Choose a PostgreSQL admin password with at least 8 characters.".to_string());
    }

    let mut identity = load_or_create_postgres_bootstrap_identity(&app)?;
    if !identity.bootstrap_applied {
        return Err("Run the PostgreSQL bootstrap step before completing admin handoff.".to_string());
    }
    if identity.admin_handoff_completed {
        return get_postgres_experiment_status_command(app).await;
    }
    if identity.temporary_superuser_password.trim().is_empty() {
        return Err("The temporary PostgreSQL admin credential is unavailable for handoff.".to_string());
    }

    if new_superuser_name != identity.superuser_name {
        let role_exists = run_psql_command(
            &identity.host,
            identity.port,
            &identity.superuser_name,
            &identity.temporary_superuser_password,
            "postgres",
            &format!(
                "SELECT 1 FROM pg_roles WHERE rolname = '{}';",
                sql_escape_literal(&new_superuser_name),
            ),
        )
        .map_err(|error| format!("Failed to inspect PostgreSQL roles: {error}"))?;
        if role_exists.trim() == "1" {
            return Err("That PostgreSQL admin username already exists. Choose a different username.".to_string());
        }

        run_psql_command(
            &identity.host,
            identity.port,
            &identity.superuser_name,
            &identity.temporary_superuser_password,
            "postgres",
            &format!(
                "CREATE ROLE \"{}\" WITH LOGIN SUPERUSER PASSWORD '{}';",
                sql_escape_identifier(&new_superuser_name),
                sql_escape_literal(&new_superuser_password),
            ),
        )
        .map_err(|error| format!("Failed to create the PostgreSQL admin user: {error}"))?;

        let retired_bootstrap_password = generate_temporary_password();
        run_psql_command(
            &identity.host,
            identity.port,
            &new_superuser_name,
            &new_superuser_password,
            "postgres",
            &format!(
                "ALTER ROLE \"{}\" WITH PASSWORD '{}';",
                sql_escape_identifier(&identity.superuser_name),
                sql_escape_literal(&retired_bootstrap_password),
            ),
        )
        .map_err(|error| format!("Failed to retire the temporary PostgreSQL bootstrap password: {error}"))?;
        identity.superuser_name = new_superuser_name;
    } else {
        run_psql_command(
            &identity.host,
            identity.port,
            &identity.superuser_name,
            &identity.temporary_superuser_password,
            "postgres",
            &format!(
                "ALTER ROLE \"{}\" WITH PASSWORD '{}';",
                sql_escape_identifier(&identity.superuser_name),
                sql_escape_literal(&new_superuser_password),
            ),
        )
        .map_err(|error| format!("Failed to rotate the PostgreSQL admin password: {error}"))?;
    }

    identity.temporary_superuser_password.clear();
    identity.admin_handoff_completed = true;
    let bootstrap_identity_path = postgres_bootstrap_identity_path(&app)?;
    let serialized = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&bootstrap_identity_path, serialized).map_err(|e| e.to_string())?;
    save_postgres_runtime_config(&app, &postgres_runtime_config_from_identity(&identity))?;
    set_postgres_runtime_auth_session(&runtime_auth_state, None);

    get_postgres_experiment_status_command(app).await
}

#[tauri::command]
async fn ensure_postgres_experiment_schema_command(
    app: tauri::AppHandle,
) -> Result<PostgresSchemaMigrationResult, String> {
    ensure_postgres_experiment_control_schema(&app).await
}

#[tauri::command]
async fn get_postgres_experiment_auth_status_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<PostgresExperimentAuthStatus, String> {
    let identity = load_or_create_postgres_bootstrap_identity(&app)?;
    let bootstrap_applied = identity.bootstrap_applied;
    let admin_handoff_completed = identity.admin_handoff_completed;
    let ready = postgres_experiment_auth_not_ready_message(&identity).is_none();

    if !ready {
        set_postgres_runtime_auth_session(&runtime_auth_state, None);
        return Ok(PostgresExperimentAuthStatus {
            bootstrap_applied,
            admin_handoff_completed,
            ready: false,
            registered_user_count: 0,
            requires_account_setup: false,
            local_admin_name: identity.superuser_name,
            current_session: None,
        });
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let registered_user_count = count_postgres_experiment_app_users(&app).await?;
    let current_session = resolve_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;

    Ok(PostgresExperimentAuthStatus {
        bootstrap_applied,
        admin_handoff_completed,
        ready: true,
        registered_user_count,
        requires_account_setup: false,
        local_admin_name: identity.superuser_name,
        current_session,
    })
}

#[tauri::command]
async fn get_postgres_experiment_installation_settings_command(
    app: tauri::AppHandle,
) -> Result<PostgresExperimentInstallationSettings, String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(default_postgres_experiment_installation_settings());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_opt(
            "
            SELECT
                startup_reopen_last_project,
                document_import_default_mode,
                document_import_auto_name_from_file,
                document_import_trim_imported_text,
                document_import_warn_before_empty_import,
                privacy_mask_file_paths,
                privacy_clear_recent_projects_on_sign_out,
                privacy_forget_login_identities_on_logout,
                updates_auto_check,
                llm_settings_json
            FROM installation_settings
            WHERE id = 'singleton'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment installation settings: {e}"))?;
    connection_task.abort();

    Ok(row
        .map(|row| PostgresExperimentInstallationSettings {
            startup_reopen_last_project: row.get(0),
            document_import_default_mode: normalize_postgres_experiment_document_import_default_mode(
                row.get::<_, String>(1).as_str(),
            ),
            document_import_auto_name_from_file: row.get(2),
            document_import_trim_imported_text: row.get(3),
            document_import_warn_before_empty_import: row.get(4),
            privacy_mask_file_paths: row.get(5),
            privacy_clear_recent_projects_on_sign_out: row.get(6),
            privacy_forget_login_identities_on_logout: row.get(7),
            updates_auto_check: row.get(8),
            llm: deserialize_postgres_experiment_llm_settings(row.get::<_, String>(9).as_str()),
        })
        .unwrap_or_else(default_postgres_experiment_installation_settings))
}

#[tauri::command]
async fn save_postgres_experiment_installation_settings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    settings: PostgresExperimentInstallationSettings,
) -> Result<PostgresExperimentInstallationSettings, String> {
    let _session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let next = PostgresExperimentInstallationSettings {
        startup_reopen_last_project: settings.startup_reopen_last_project,
        document_import_default_mode: normalize_postgres_experiment_document_import_default_mode(
            &settings.document_import_default_mode,
        ),
        document_import_auto_name_from_file: settings.document_import_auto_name_from_file,
        document_import_trim_imported_text: settings.document_import_trim_imported_text,
        document_import_warn_before_empty_import: settings.document_import_warn_before_empty_import,
        privacy_mask_file_paths: settings.privacy_mask_file_paths,
        privacy_clear_recent_projects_on_sign_out: settings.privacy_clear_recent_projects_on_sign_out,
        privacy_forget_login_identities_on_logout: settings.privacy_forget_login_identities_on_logout,
        updates_auto_check: settings.updates_auto_check,
        llm: normalize_postgres_experiment_llm_settings(settings.llm),
    };
    let llm_settings_json = serde_json::to_string(&next.llm)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment LLM settings: {e}"))?;

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO installation_settings (
                id,
                startup_reopen_last_project,
                document_import_default_mode,
                document_import_auto_name_from_file,
                document_import_trim_imported_text,
                document_import_warn_before_empty_import,
                privacy_mask_file_paths,
                privacy_clear_recent_projects_on_sign_out,
                privacy_forget_login_identities_on_logout,
                updates_auto_check,
                llm_settings_json,
                updated_at
            )
            VALUES ('singleton', DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (id) DO UPDATE
            SET startup_reopen_last_project = EXCLUDED.startup_reopen_last_project,
                document_import_default_mode = EXCLUDED.document_import_default_mode,
                document_import_auto_name_from_file = EXCLUDED.document_import_auto_name_from_file,
                document_import_trim_imported_text = EXCLUDED.document_import_trim_imported_text,
                document_import_warn_before_empty_import = EXCLUDED.document_import_warn_before_empty_import,
                privacy_mask_file_paths = EXCLUDED.privacy_mask_file_paths,
                privacy_clear_recent_projects_on_sign_out = EXCLUDED.privacy_clear_recent_projects_on_sign_out,
                privacy_forget_login_identities_on_logout = EXCLUDED.privacy_forget_login_identities_on_logout,
                updates_auto_check = EXCLUDED.updates_auto_check,
                llm_settings_json = EXCLUDED.llm_settings_json,
                updated_at = NOW()
            ",
            &[
                &next.startup_reopen_last_project,
                &next.document_import_default_mode,
                &next.document_import_auto_name_from_file,
                &next.document_import_trim_imported_text,
                &next.document_import_warn_before_empty_import,
                &next.privacy_mask_file_paths,
                &next.privacy_clear_recent_projects_on_sign_out,
                &next.privacy_forget_login_identities_on_logout,
                &next.updates_auto_check,
                &llm_settings_json,
            ],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment installation settings: {e}"))?;
    connection_task.abort();

    Ok(next)
}

#[tauri::command]
async fn get_postgres_experiment_user_preferences_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<PostgresExperimentUserPreferences, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let subject_key = postgres_experiment_preference_subject_key(&session);
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_opt(
            "
            SELECT theme, density, font_size
                 , locale
                 , recent_project_limit
                 , theme_state_json
            FROM user_preferences
            WHERE subject_key = $1
            ",
            &[&subject_key],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment user preferences: {e}"))?;
    connection_task.abort();

    Ok(row
        .map(|row| PostgresExperimentUserPreferences {
            theme: normalize_postgres_experiment_theme(row.get::<_, String>(0).as_str()),
            density: normalize_postgres_experiment_density(row.get::<_, String>(1).as_str()),
            font_size: normalize_postgres_experiment_font_size(row.get::<_, String>(2).as_str()),
            locale: normalize_postgres_experiment_locale(row.get::<_, String>(3).as_str()),
            recent_project_limit: normalize_postgres_experiment_recent_project_limit(row.get(4)),
            theme_state: normalize_postgres_experiment_theme_state(
                serde_json::from_str::<PostgresExperimentThemeState>(row.get::<_, String>(5).as_str())
                    .unwrap_or_else(|_| default_postgres_experiment_theme_state()),
            ),
        })
        .unwrap_or_else(default_postgres_experiment_user_preferences))
}

#[tauri::command]
async fn save_postgres_experiment_user_preferences_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    preferences: PostgresExperimentUserPreferences,
) -> Result<PostgresExperimentUserPreferences, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let next = PostgresExperimentUserPreferences {
        theme: normalize_postgres_experiment_theme(&preferences.theme),
        density: normalize_postgres_experiment_density(&preferences.density),
        font_size: normalize_postgres_experiment_font_size(&preferences.font_size),
        locale: normalize_postgres_experiment_locale(&preferences.locale),
        recent_project_limit: normalize_postgres_experiment_recent_project_limit(preferences.recent_project_limit),
        theme_state: normalize_postgres_experiment_theme_state(preferences.theme_state),
    };
    let subject_key = postgres_experiment_preference_subject_key(&session);
    let theme_state_json = serde_json::to_string(&next.theme_state)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment theme state: {e}"))?;

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO user_preferences (
                subject_key,
                theme,
                density,
                font_size,
                locale,
                recent_project_limit,
                theme_state_json,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (subject_key) DO UPDATE
            SET theme = EXCLUDED.theme,
                density = EXCLUDED.density,
                font_size = EXCLUDED.font_size,
                locale = EXCLUDED.locale,
                recent_project_limit = EXCLUDED.recent_project_limit,
                theme_state_json = EXCLUDED.theme_state_json,
                updated_at = NOW()
            ",
            &[
                &subject_key,
                &next.theme,
                &next.density,
                &next.font_size,
                &next.locale,
                &next.recent_project_limit,
                &theme_state_json,
            ],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment user preferences: {e}"))?;
    connection_task.abort();

    Ok(next)
}

#[tauri::command]
async fn get_postgres_experiment_device_state_command(
    app: tauri::AppHandle,
) -> Result<PostgresExperimentDeviceState, String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(default_postgres_experiment_device_state());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_opt(
            "
            SELECT dismissed_update_version
            FROM device_state
            WHERE id = 'singleton'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment device state: {e}"))?;
    connection_task.abort();

    Ok(row
        .map(|row| PostgresExperimentDeviceState {
            dismissed_update_version: row.get(0),
        })
        .unwrap_or_else(default_postgres_experiment_device_state))
}

#[tauri::command]
async fn save_postgres_experiment_device_state_command(
    app: tauri::AppHandle,
    state: PostgresExperimentDeviceState,
) -> Result<PostgresExperimentDeviceState, String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(default_postgres_experiment_device_state());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let next = PostgresExperimentDeviceState {
        dismissed_update_version: state
            .dismissed_update_version
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO device_state (
                id,
                dismissed_update_version,
                updated_at
            )
            VALUES ('singleton', $1, NOW())
            ON CONFLICT (id) DO UPDATE
            SET dismissed_update_version = EXCLUDED.dismissed_update_version,
                updated_at = NOW()
            ",
            &[&next.dismissed_update_version],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment device state: {e}"))?;
    connection_task.abort();

    Ok(next)
}

#[tauri::command]
async fn list_postgres_experiment_remembered_accounts_command(
    app: tauri::AppHandle,
) -> Result<Vec<PostgresExperimentRememberedAccount>, String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(Vec::new());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let rows = client
        .query(
            "
            SELECT email, name, TO_CHAR(last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
            FROM remembered_accounts
            ORDER BY last_login_at DESC, email ASC
            LIMIT 20
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment remembered accounts: {e}"))?;
    connection_task.abort();

    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentRememberedAccount {
            email: row.get(0),
            name: row.get(1),
            last_login: row.get(2),
        })
        .collect())
}

#[tauri::command]
async fn remember_postgres_experiment_account_command(
    app: tauri::AppHandle,
    email: String,
    name: String,
) -> Result<(), String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(());
    }

    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Ok(());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let trimmed_name = name.trim().to_string();
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO remembered_accounts (
                email,
                name,
                last_login_at,
                updated_at
            )
            VALUES ($1, $2, NOW(), NOW())
            ON CONFLICT (email) DO UPDATE
            SET name = EXCLUDED.name,
                last_login_at = NOW(),
                updated_at = NOW()
            ",
            &[&normalized_email, &trimmed_name],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment remembered account: {e}"))?;
    client
        .execute(
            "
            DELETE FROM remembered_accounts
            WHERE email IN (
                SELECT email
                FROM remembered_accounts
                ORDER BY last_login_at DESC, email ASC
                OFFSET 20
            )
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not trim PostgreSQL experiment remembered accounts: {e}"))?;
    connection_task.abort();

    Ok(())
}

#[tauri::command]
async fn rename_postgres_experiment_remembered_account_command(
    app: tauri::AppHandle,
    previous_email: String,
    next_email: String,
    next_name: String,
) -> Result<(), String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(());
    }

    let normalized_previous_email = previous_email.trim().to_lowercase();
    let normalized_next_email = next_email.trim().to_lowercase();
    if normalized_next_email.is_empty() {
        return Ok(());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let trimmed_name = next_name.trim().to_string();
    let (mut client, connection_task) = connect_postgres_runtime(&app).await?;
    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment remembered-account update: {e}"))?;
    transaction
        .execute(
            "
            DELETE FROM remembered_accounts
            WHERE email = $1 OR email = $2
            ",
            &[&normalized_previous_email, &normalized_next_email],
        )
        .await
        .map_err(|e| format!("Could not clear outdated PostgreSQL experiment remembered account rows: {e}"))?;
    transaction
        .execute(
            "
            INSERT INTO remembered_accounts (
                email,
                name,
                last_login_at,
                updated_at
            )
            VALUES ($1, $2, NOW(), NOW())
            ",
            &[&normalized_next_email, &trimmed_name],
        )
        .await
        .map_err(|e| format!("Could not save renamed PostgreSQL experiment remembered account: {e}"))?;
    transaction
        .commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment remembered-account update: {e}"))?;
    connection_task.abort();

    Ok(())
}

#[tauri::command]
async fn clear_postgres_experiment_remembered_accounts_command(
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !load_or_create_postgres_bootstrap_identity(&app)?.bootstrap_applied {
        return Ok(());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute("DELETE FROM remembered_accounts", &[])
        .await
        .map_err(|e| format!("Could not clear PostgreSQL experiment remembered accounts: {e}"))?;
    connection_task.abort();

    Ok(())
}

#[tauri::command]
async fn get_postgres_experiment_user_project_state_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<PostgresExperimentUserProjectState, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let subject_key = postgres_experiment_preference_subject_key(&session);
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_opt(
            "
            SELECT last_opened_project_id, recent_projects_json
            FROM user_project_state
            WHERE subject_key = $1
            ",
            &[&subject_key],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment user project state: {e}"))?;
    connection_task.abort();

    Ok(row
        .map(|row| {
            let recent_projects_json: String = row.get(1);
            PostgresExperimentUserProjectState {
                last_opened_project_id: row.get(0),
                recent_projects: serde_json::from_str(&recent_projects_json).unwrap_or_default(),
            }
        })
        .unwrap_or_else(default_postgres_experiment_user_project_state))
}

#[tauri::command]
async fn remember_postgres_experiment_project_opened_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project: PostgresExperimentRecentProject,
) -> Result<PostgresExperimentUserProjectState, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let project_id = project.id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let trimmed_name = project.name.trim().to_string();
    let trimmed_description = project.description.trim().to_string();
    let opened_at = if project.opened_at.trim().is_empty() {
        "1970-01-01T00:00:00.000Z".to_string()
    } else {
        project.opened_at.trim().to_string()
    };

    let subject_key = postgres_experiment_preference_subject_key(&session);
    let current = get_postgres_experiment_user_project_state_command(app.clone(), runtime_auth_state).await?;
    let mut recent_projects = current
        .recent_projects
        .into_iter()
        .filter(|entry| entry.id != project_id)
        .collect::<Vec<_>>();
    recent_projects.insert(
        0,
        PostgresExperimentRecentProject {
            id: project_id.clone(),
            name: trimmed_name,
            description: trimmed_description,
            opened_at,
        },
    );
    recent_projects.truncate(25);
    let next = PostgresExperimentUserProjectState {
        last_opened_project_id: Some(project_id),
        recent_projects,
    };

    let recent_projects_json = serde_json::to_string(&next.recent_projects)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment recent projects: {e}"))?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO user_project_state (
                subject_key,
                last_opened_project_id,
                recent_projects_json,
                updated_at
            )
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (subject_key) DO UPDATE
            SET last_opened_project_id = EXCLUDED.last_opened_project_id,
                recent_projects_json = EXCLUDED.recent_projects_json,
                updated_at = NOW()
            ",
            &[&subject_key, &next.last_opened_project_id, &recent_projects_json],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment user project state: {e}"))?;
    connection_task.abort();

    Ok(next)
}

#[tauri::command]
async fn remove_postgres_experiment_project_from_state_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<PostgresExperimentUserProjectState, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let trimmed_project_id = project_id.trim().to_string();
    let subject_key = postgres_experiment_preference_subject_key(&session);
    let current = get_postgres_experiment_user_project_state_command(app.clone(), runtime_auth_state).await?;
    let next = PostgresExperimentUserProjectState {
        last_opened_project_id: if current.last_opened_project_id.as_deref() == Some(trimmed_project_id.as_str()) {
            None
        } else {
            current.last_opened_project_id
        },
        recent_projects: current
            .recent_projects
            .into_iter()
            .filter(|entry| entry.id != trimmed_project_id)
            .collect(),
    };

    let recent_projects_json = serde_json::to_string(&next.recent_projects)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment recent projects: {e}"))?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            INSERT INTO user_project_state (
                subject_key,
                last_opened_project_id,
                recent_projects_json,
                updated_at
            )
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (subject_key) DO UPDATE
            SET last_opened_project_id = EXCLUDED.last_opened_project_id,
                recent_projects_json = EXCLUDED.recent_projects_json,
                updated_at = NOW()
            ",
            &[&subject_key, &next.last_opened_project_id, &recent_projects_json],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment user project state: {e}"))?;
    connection_task.abort();

    Ok(next)
}

#[tauri::command]
async fn clear_postgres_experiment_user_project_state_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<(), String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    ensure_postgres_experiment_control_schema(&app).await?;

    let subject_key = postgres_experiment_preference_subject_key(&session);
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            DELETE FROM user_project_state
            WHERE subject_key = $1
            ",
            &[&subject_key],
        )
        .await
        .map_err(|e| format!("Could not clear PostgreSQL experiment user project state: {e}"))?;
    connection_task.abort();

    Ok(())
}

#[tauri::command]
async fn register_postgres_experiment_app_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: RegisterPostgresExperimentAppUserRequest,
) -> Result<PostgresExperimentAuthSession, String> {
    ensure_postgres_experiment_auth_ready(&app).await?;

    let name = request.name.trim().to_string();
    let email = request.email.trim().to_lowercase();
    let password = request.password.trim().to_string();

    if name.is_empty() {
        return Err("Enter your name.".to_string());
    }
    if email.is_empty() {
        return Err("Enter your email.".to_string());
    }
    if password.len() < 8 {
        return Err("Choose a password with at least 8 characters.".to_string());
    }

    if load_postgres_experiment_app_user_by_email(&app, &email).await?.is_some() {
        return Err("An account with that email already exists.".to_string());
    }

    let role = "standard".to_string();
    let password_hash = hash_postgres_app_user_password(&password)?;
    let user_id = generate_identifier();

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_one(
            "
            INSERT INTO app_users (id, name, email, password_hash, role, last_login_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, name, email, role, created_at::text, updated_at::text
            ",
            &[&user_id, &name, &email, &password_hash, &role],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment app user: {e}"))?;
    connection_task.abort();

    let session = PostgresExperimentAuthSession {
        auth_kind: "app_user".to_string(),
        user: PostgresExperimentAppUser {
            id: row.get(0),
            name: row.get(1),
            email: row.get(2),
            role: row.get(3),
            created_at: row.get(4),
            updated_at: row.get(5),
        },
        started_at_ms: current_time_ms(),
    };
    let stored_session = StoredPostgresExperimentAuthSession {
        version: 1,
        auth_kind: "app_user".to_string(),
        user_id: session.user.id.clone(),
        started_at_ms: session.started_at_ms,
    };
    let _ = request.remember_session;
    set_postgres_runtime_auth_session(&runtime_auth_state, Some(stored_session));

    Ok(session)
}

#[tauri::command]
async fn login_postgres_experiment_admin_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: LoginPostgresExperimentAdminRequest,
) -> Result<PostgresExperimentAuthSession, String> {
    ensure_postgres_experiment_auth_ready(&app).await?;

    let username = request.username.trim().to_string();
    let password = request.password.trim().to_string();
    if username.is_empty() {
        return Err("Enter the PostgreSQL administrator username.".to_string());
    }
    if password.is_empty() {
        return Err("Enter the PostgreSQL administrator password.".to_string());
    }

    let identity = load_or_create_postgres_bootstrap_identity(&app)?;
    if username != identity.superuser_name {
        return Err("That username is not the configured local PostgreSQL administrator.".to_string());
    }
    let _ = run_psql_command(
        &identity.host,
        identity.port,
        &username,
        &password,
        "postgres",
        "SELECT current_user;",
    )
    .map_err(|_| "The PostgreSQL administrator password was not accepted.".to_string())?;

    let session = PostgresExperimentAuthSession {
        auth_kind: "postgres_admin".to_string(),
        user: build_postgres_experiment_local_admin_user(&identity),
        started_at_ms: current_time_ms(),
    };
    let stored_session = StoredPostgresExperimentAuthSession {
        version: 1,
        auth_kind: "postgres_admin".to_string(),
        user_id: session.user.id.clone(),
        started_at_ms: session.started_at_ms,
    };
    let _ = request.remember_session;
    set_postgres_runtime_auth_session(&runtime_auth_state, Some(stored_session));
    Ok(session)
}

#[tauri::command]
async fn login_postgres_experiment_app_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: LoginPostgresExperimentAppUserRequest,
) -> Result<PostgresExperimentAuthSession, String> {
    ensure_postgres_experiment_auth_ready(&app).await?;

    let email = request.email.trim().to_lowercase();
    let password = request.password.trim().to_string();

    if email.is_empty() {
        return Err("Enter your email.".to_string());
    }
    if password.is_empty() {
        return Err("Enter your password.".to_string());
    }

    let Some(user_record) = load_postgres_experiment_app_user_by_email(&app, &email).await? else {
        return Err("No account was found for that email and password.".to_string());
    };

    if !verify_postgres_app_user_password(&password, &user_record.password_hash)? {
        return Err("No account was found for that email and password.".to_string());
    }

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            UPDATE app_users
            SET last_login_at = NOW(),
                updated_at = updated_at
            WHERE id = $1
            ",
            &[&user_record.user.id],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment login state: {e}"))?;
    connection_task.abort();

    let refreshed_user = load_postgres_experiment_app_user_by_id(&app, &user_record.user.id)
        .await?
        .map(|record| record.user)
        .unwrap_or(user_record.user);
    let session = PostgresExperimentAuthSession {
        auth_kind: "app_user".to_string(),
        user: refreshed_user,
        started_at_ms: current_time_ms(),
    };
    let stored_session = StoredPostgresExperimentAuthSession {
        version: 1,
        auth_kind: "app_user".to_string(),
        user_id: session.user.id.clone(),
        started_at_ms: session.started_at_ms,
    };
    let _ = request.remember_session;
    set_postgres_runtime_auth_session(&runtime_auth_state, Some(stored_session));

    Ok(session)
}

#[tauri::command]
async fn logout_postgres_experiment_app_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<PostgresExperimentAuthStatus, String> {
    set_postgres_runtime_auth_session(&runtime_auth_state, None);
    get_postgres_experiment_auth_status_command(app, runtime_auth_state).await
}

#[tauri::command]
async fn update_postgres_experiment_app_user_profile_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentAppUserProfileRequest,
) -> Result<PostgresExperimentAppUser, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    if session.auth_kind != "app_user" {
        return Err("Only PostgreSQL app users can update their profile here.".to_string());
    }

    let name = request.name.trim().to_string();
    let email = request.email.trim().to_lowercase();
    if name.is_empty() {
        return Err("Enter your name.".to_string());
    }
    if email.is_empty() {
        return Err("Enter your email.".to_string());
    }

    if let Some(existing_user) = load_postgres_experiment_app_user_by_email(&app, &email).await? {
        if existing_user.user.id != session.user.id {
            return Err("An account with that email already exists.".to_string());
        }
    }

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_one(
            "
            UPDATE app_users
            SET name = $2,
                email = $3,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, email, role, created_at::text, updated_at::text
            ",
            &[&session.user.id, &name, &email],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment user profile: {e}"))?;
    connection_task.abort();

    let updated_user = PostgresExperimentAppUser {
        id: row.get(0),
        name: row.get(1),
        email: row.get(2),
        role: row.get(3),
        created_at: row.get(4),
        updated_at: row.get(5),
    };

    let next_session = PostgresExperimentAuthSession {
        auth_kind: session.auth_kind.clone(),
        user: updated_user.clone(),
        started_at_ms: session.started_at_ms,
    };
    let stored_session = StoredPostgresExperimentAuthSession {
        version: 1,
        auth_kind: next_session.auth_kind.clone(),
        user_id: next_session.user.id.clone(),
        started_at_ms: next_session.started_at_ms,
    };
    set_postgres_runtime_auth_session(&runtime_auth_state, Some(stored_session));

    Ok(updated_user)
}

#[tauri::command]
async fn change_postgres_experiment_app_user_password_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: ChangePostgresExperimentAppUserPasswordRequest,
) -> Result<PostgresExperimentAuthStatus, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    if session.auth_kind != "app_user" {
        return Err("Only PostgreSQL app users can change their password here.".to_string());
    }

    let current_password = request.current_password.trim().to_string();
    let new_password = request.new_password.trim().to_string();
    if current_password.is_empty() {
        return Err("Enter your current password.".to_string());
    }
    if new_password.len() < 8 {
        return Err("Choose a password with at least 8 characters.".to_string());
    }

    let Some(user_record) = load_postgres_experiment_app_user_by_id(&app, &session.user.id).await? else {
        return Err("Could not load the signed-in PostgreSQL user.".to_string());
    };
    if !verify_postgres_app_user_password(&current_password, &user_record.password_hash)? {
        return Err("The current password was not accepted.".to_string());
    }

    let new_password_hash = hash_postgres_app_user_password(&new_password)?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let row = client
        .query_one(
            "
            UPDATE app_users
            SET password_hash = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, email, role, created_at::text, updated_at::text
            ",
            &[&session.user.id, &new_password_hash],
        )
        .await
        .map_err(|e| format!("Could not change PostgreSQL experiment user password: {e}"))?;
    connection_task.abort();

    let _updated_user = PostgresExperimentAppUser {
        id: row.get(0),
        name: row.get(1),
        email: row.get(2),
        role: row.get(3),
        created_at: row.get(4),
        updated_at: row.get(5),
    };

    set_postgres_runtime_auth_session(&runtime_auth_state, None);
    get_postgres_experiment_auth_status_command(app, runtime_auth_state).await
}

#[tauri::command]
async fn list_postgres_experiment_app_users_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<Vec<PostgresExperimentAppUser>, String> {
    let _session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let rows = client
        .query(
            "
            SELECT id, name, email, role, created_at::text, updated_at::text
            FROM app_users
            ORDER BY lower(name) ASC, lower(email) ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment app users: {e}"))?;
    connection_task.abort();
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentAppUser {
            id: row.get(0),
            name: row.get(1),
            email: row.get(2),
            role: row.get(3),
            created_at: row.get(4),
            updated_at: row.get(5),
        })
        .collect())
}

#[tauri::command]
async fn list_postgres_experiment_projects_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
) -> Result<Vec<PostgresExperimentProject>, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let rows = client
        .query(
            "
            SELECT id, database_name, storage_path, created_at::text, updated_at::text
            FROM projects
            ORDER BY created_at DESC, id DESC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment projects: {e}"))?;
    connection_task.abort();
    let mut projects = Vec::with_capacity(rows.len());
    for row in rows {
        let registry = PostgresExperimentProjectRegistryRecord {
            id: row.get(0),
            database_name: row.get(1),
            storage_path: row.get(2),
            created_at: row.get(3),
            updated_at: row.get(4),
        };
        projects.push(load_postgres_experiment_project_from_registry(&app, registry).await?);
    }

    if postgres_experiment_session_is_admin(&session) {
        return Ok(projects);
    }

    let mut visible_projects = Vec::new();
    for project in projects {
        if postgres_experiment_project_membership_role(&app, &project, &session.user.email)
            .await?
            .is_some()
        {
            visible_projects.push(project);
        }
    }

    Ok(visible_projects)
}

#[tauri::command]
async fn create_postgres_experiment_project_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentProjectRequest,
) -> Result<PostgresExperimentProject, String> {
    let session = require_postgres_experiment_auth_session(&app, Some(&runtime_auth_state)).await?;
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    if name.is_empty() {
        return Err("Enter a project name.".to_string());
    }

    ensure_postgres_experiment_control_schema(&app).await?;
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    let project_id = generate_identifier();
    let database_name = postgres_project_database_name(&project_id);
    let storage_path = postgres_project_storage_path(&app, &project_id)?;
    fs::create_dir_all(&storage_path).map_err(|e| format!("Could not create project storage directory: {e}"))?;

    if let Err(error) = create_postgres_database_if_missing(&app, &database_name).await {
        let _ = fs::remove_dir_all(&storage_path);
        connection_task.abort();
        return Err(error);
    }

    if let Err(error) = ensure_postgres_experiment_project_schema(&app, &database_name).await {
        let _ = drop_postgres_database_if_exists(&app, &database_name).await;
        let _ = fs::remove_dir_all(&storage_path);
        connection_task.abort();
        return Err(error);
    }

    let row = client
        .query_one(
            "
            INSERT INTO projects (id, database_name, storage_path)
            VALUES ($1, $2, $3)
            RETURNING id, database_name, storage_path, created_at::text, updated_at::text
            ",
            &[&project_id, &database_name, &storage_path.to_string_lossy().to_string()],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment project: {e}"))?;
    connection_task.abort();

    if let Err(error) = (async {
        ensure_postgres_experiment_project_schema(&app, &database_name).await?;
        let (project_client, project_connection_task) = connect_postgres_database(&app, &database_name).await?;
        project_client
            .execute(
                "
                UPDATE project_settings
                SET project_name = $2,
                    project_description = $3,
                    updated_at = NOW()
                WHERE id = $1
                ",
                &[&"default", &name, &description],
            )
            .await
            .map_err(|e| format!("Could not save PostgreSQL experiment project metadata: {e}"))?;
        let creator_name = session.user.name.trim().to_string();
        let creator_email = session.user.email.trim().to_lowercase();
        let creator_role = "owner".to_string();
        project_client
            .execute(
                "
                INSERT INTO project_users (id, app_user_id, name, email, role)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (app_user_id) DO UPDATE
                SET name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    role = EXCLUDED.role,
                    updated_at = NOW()
                ",
                &[&generate_identifier(), &session.user.id, &creator_name, &creator_email, &creator_role],
            )
            .await
            .map_err(|e| format!("Could not add the project creator to PostgreSQL project access: {e}"))?;
        project_connection_task.abort();
        Ok::<(), String>(())
    })
    .await
    {
        let _ = drop_postgres_database_if_exists(&app, &database_name).await;
        let _ = fs::remove_dir_all(&storage_path);
        let (cleanup_client, cleanup_connection_task) = connect_postgres_runtime(&app).await?;
        let _ = cleanup_client.execute("DELETE FROM projects WHERE id = $1", &[&project_id]).await;
        cleanup_connection_task.abort();
        return Err(error);
    }

    let created = PostgresExperimentProject {
        id: row.get(0),
        name,
        description,
        database_name: row.get(1),
        storage_path: row.get(2),
        created_at: row.get(3),
        updated_at: row.get(4),
    };
    emit_postgres_experiment_project_change(&app, &created.id, "project", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_project_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentProjectRequest,
) -> Result<PostgresExperimentProject, String> {
    let project_id = request.project_id.trim().to_string();
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if name.is_empty() {
        return Err("Enter a project name.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;
    let (project_client, project_connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    project_client
        .execute(
            "
            UPDATE project_settings
            SET project_name = $2,
                project_description = $3,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[&"default", &name, &description],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment project metadata: {e}"))?;
    project_connection_task.abort();
    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute(
            "
            UPDATE projects
            SET updated_at = NOW()
            WHERE id = $1
            ",
            &[&project_id],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment project registry timestamp: {e}"))?;
    connection_task.abort();
    let updated = load_postgres_experiment_project_record(&app, &project_id).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project", &project_id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn delete_postgres_experiment_project_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<DeletePostgresExperimentProjectResult, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;

    drop_postgres_database_if_exists(&app, &project.database_name).await?;
    if let Err(error) = fs::remove_dir_all(&project.storage_path) {
        if std::path::Path::new(&project.storage_path).exists() {
            return Err(format!("Could not remove PostgreSQL project storage: {error}"));
        }
    }

    let (client, connection_task) = connect_postgres_runtime(&app).await?;
    client
        .execute("DELETE FROM projects WHERE id = $1", &[&project_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment project: {e}"))?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "project", &project_id, "deleted");
    Ok(DeletePostgresExperimentProjectResult { project_id })
}

#[tauri::command]
async fn list_postgres_experiment_project_users_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentProjectUser>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let rows = client
        .query(
            "
            SELECT id, COALESCE(app_user_id, ''), name, email, role, created_at::text, updated_at::text
            FROM project_users
            ORDER BY created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project users: {e}"))?;
    connection_task.abort();
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentProjectUser {
            id: row.get(0),
            project_id: project_id.clone(),
            app_user_id: row.get(1),
            name: row.get(2),
            email: row.get(3),
            role: row.get(4),
            created_at: row.get(5),
            updated_at: row.get(6),
        })
        .collect())
}

#[tauri::command]
async fn create_postgres_experiment_project_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentProjectUserRequest,
) -> Result<PostgresExperimentProjectUser, String> {
    let project_id = request.project_id.trim().to_string();
    let app_user_id = request.app_user_id.trim().to_string();
    let Some(role) = normalize_postgres_experiment_project_role(&request.role) else {
        return Err("Choose a valid project role.".to_string());
    };

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if app_user_id.is_empty() {
        return Err("Choose a registered user to add.".to_string());
    }
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_invite_access(&app, Some(&runtime_auth_state), &project, &role).await?;
    let Some(app_user) = load_postgres_experiment_app_user_by_id(&app, &app_user_id).await? else {
        return Err("The selected registered user could not be found.".to_string());
    };
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let user_id = generate_identifier();
    let row = client
        .query_one(
            "
            INSERT INTO project_users (id, app_user_id, name, email, role)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, app_user_id, name, email, role, created_at::text, updated_at::text
            ",
            &[&user_id, &app_user.user.id, &app_user.user.name, &app_user.user.email, &role],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment project user: {e}"))?;
    let created = PostgresExperimentProjectUser {
        id: row.get(0),
        project_id: project_id.clone(),
        app_user_id: row.get(1),
        name: row.get(2),
        email: row.get(3),
        role: row.get(4),
        created_at: row.get(5),
        updated_at: row.get(6),
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "member.add",
        &format!("Added {} to the project", created.name),
        Some(&created.id),
        Some(serde_json::json!({
            "name": created.name,
            "email": created.email,
            "nextRole": created.role,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project_user", &created.id, "created");
    connection_task.abort();
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_project_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentProjectUserRequest,
) -> Result<PostgresExperimentProjectUser, String> {
    let project_id = request.project_id.trim().to_string();
    let project_user_id = request.project_user_id.trim().to_string();
    let Some(role) = normalize_postgres_experiment_project_role(&request.role) else {
        return Err("Choose a valid project role.".to_string());
    };

    if project_id.is_empty() || project_user_id.is_empty() {
        return Err("Project user update requires both project and user identifiers.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let existing = client
        .query_opt(
            "
            SELECT id, COALESCE(app_user_id, ''), name, email, role
            FROM project_users
            WHERE id = $1
            ",
            &[&project_user_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project user: {e}"))?;
    let Some(existing) = existing else {
        connection_task.abort();
        return Err("The PostgreSQL project user could not be found.".to_string());
    };
    let existing_role: String = existing.get(4);
    if role == "owner" || existing_role == "owner" {
        let requester_role = postgres_experiment_project_membership_role(&app, &project, &session.user.email).await?;
        if !postgres_experiment_session_is_admin(&session) && requester_role.as_deref() != Some("owner") {
            connection_task.abort();
            return Err("Only project owners or administrators can change project ownership.".to_string());
        }
    }
    if existing_role == "owner" && role != "owner" {
        let owner_count = count_postgres_experiment_project_users_by_role(&app, &project, "owner").await?;
        if owner_count <= 1 {
            connection_task.abort();
            return Err("A project must always have at least one owner.".to_string());
        }
    }
    let row = client
        .query_one(
            "
            UPDATE project_users
            SET role = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, COALESCE(app_user_id, ''), name, email, role, created_at::text, updated_at::text
            ",
            &[&project_user_id, &role],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment project user: {e}"))?;
    let updated = PostgresExperimentProjectUser {
        id: row.get(0),
        project_id: project_id.clone(),
        app_user_id: row.get(1),
        name: row.get(2),
        email: row.get(3),
        role: row.get(4),
        created_at: row.get(5),
        updated_at: row.get(6),
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "member.update",
        &format!("Updated {}'s role", updated.name),
        Some(&updated.id),
        Some(serde_json::json!({
            "name": updated.name,
            "email": updated.email,
            "previousRole": existing_role,
            "nextRole": updated.role,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project_user", &updated.id, "updated");
    connection_task.abort();
    Ok(updated)
}

#[tauri::command]
async fn delete_postgres_experiment_project_user_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    project_user_id: String,
) -> Result<DeletePostgresExperimentProjectUserResult, String> {
    let project_id = project_id.trim().to_string();
    let project_user_id = project_user_id.trim().to_string();
    if project_id.is_empty() || project_user_id.is_empty() {
        return Err("Project user removal requires both project and user identifiers.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let existing = client
        .query_opt(
            "
            SELECT id, COALESCE(app_user_id, ''), email, role
            FROM project_users
            WHERE id = $1
            ",
            &[&project_user_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project user for removal: {e}"))?;
    let Some(existing) = existing else {
        connection_task.abort();
        return Err("The PostgreSQL project user could not be found.".to_string());
    };
    let existing_app_user_id: String = existing.get(1);
    let existing_email: String = existing.get(2);
    let existing_role: String = existing.get(3);
    if existing_app_user_id == session.user.id || existing_email.eq_ignore_ascii_case(&session.user.email) {
        connection_task.abort();
        return Err("You cannot remove your own account from this project.".to_string());
    }
    if existing_role == "owner" {
        let requester_role = postgres_experiment_project_membership_role(&app, &project, &session.user.email).await?;
        if !postgres_experiment_session_is_admin(&session) && requester_role.as_deref() != Some("owner") {
            connection_task.abort();
            return Err("Only project owners or administrators can remove a project owner.".to_string());
        }
        let owner_count = count_postgres_experiment_project_users_by_role(&app, &project, "owner").await?;
        if owner_count <= 1 {
            connection_task.abort();
            return Err("A project must always have at least one owner.".to_string());
        }
    }
    let removed_details = serde_json::json!({
        "email": existing_email,
        "previousRole": existing_role,
    });
    client
        .execute("DELETE FROM project_users WHERE id = $1", &[&project_user_id])
        .await
        .map_err(|e| format!("Could not remove PostgreSQL experiment project user: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "member.remove",
        "Removed a project member",
        Some(&project_user_id),
        Some(removed_details),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project_user", &project_user_id, "deleted");
    connection_task.abort();
    Ok(DeletePostgresExperimentProjectUserResult {
        project_id,
        project_user_id,
    })
}

#[tauri::command]
async fn get_postgres_experiment_project_ai_assist_settings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<PostgresExperimentProjectAiAssistSettings, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    let row = load_postgres_experiment_project_settings_row(&app, &project).await?;
    Ok(postgres_experiment_project_ai_assist_settings_from_row(&row))
}

#[tauri::command]
async fn save_postgres_experiment_project_ai_assist_settings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentProjectAiAssistSettingsRequest,
) -> Result<PostgresExperimentProjectAiAssistSettings, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session =
        require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let row = client
        .query_one(
            "
            UPDATE project_settings
            SET ai_assist_enabled = $1,
                ai_semantic_search_allowed = $2,
                ai_question_answering_allowed = $3,
                ai_summaries_allowed = $4,
                ai_code_suggestions_allowed = $5,
                ai_draft_reports_allowed = $6,
                updated_at = NOW()
            WHERE id = 'default'
            RETURNING
                ai_assist_enabled,
                ai_semantic_search_allowed,
                ai_question_answering_allowed,
                ai_summaries_allowed,
                ai_code_suggestions_allowed,
                ai_draft_reports_allowed,
                document_import_store_original_file_name
            ",
            &[
                &request.settings.enabled,
                &request.settings.allow_semantic_search,
                &request.settings.allow_question_answering,
                &request.settings.allow_summaries,
                &request.settings.allow_code_suggestions,
                &request.settings.allow_draft_reports,
            ],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment project AI Assist settings: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "project.ai_assist.update",
        if request.settings.enabled { "Enabled AI Assist for this project" } else { "Disabled AI Assist for this project" },
        Some("default"),
        Some(serde_json::json!({
            "enabled": request.settings.enabled,
            "changedFields": [
                "enabled",
                "allow_semantic_search",
                "allow_question_answering",
                "allow_summaries",
                "allow_code_suggestions",
                "allow_draft_reports"
            ],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project_settings", "default", "updated");
    connection_task.abort();
    Ok(postgres_experiment_project_ai_assist_settings_from_row(&row))
}

#[tauri::command]
async fn get_postgres_experiment_project_document_import_settings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<PostgresExperimentProjectDocumentImportSettings, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    let row = load_postgres_experiment_project_settings_row(&app, &project).await?;
    Ok(postgres_experiment_project_document_import_settings_from_row(&row))
}

#[tauri::command]
async fn save_postgres_experiment_project_document_import_settings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentProjectDocumentImportSettingsRequest,
) -> Result<PostgresExperimentProjectDocumentImportSettings, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session =
        require_postgres_experiment_project_membership_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let row = client
        .query_one(
            "
            UPDATE project_settings
            SET document_import_store_original_file_name = $1,
                updated_at = NOW()
            WHERE id = 'default'
            RETURNING
                ai_assist_enabled,
                ai_semantic_search_allowed,
                ai_question_answering_allowed,
                ai_summaries_allowed,
                ai_code_suggestions_allowed,
                ai_draft_reports_allowed,
                document_import_store_original_file_name
            ",
            &[&request.settings.store_original_file_name],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment project document import settings: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "project.update",
        "Updated project document import settings",
        Some("default"),
        Some(serde_json::json!({
            "changedFields": ["document_import_store_original_file_name"],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "project_settings", "default", "updated");
    connection_task.abort();
    Ok(postgres_experiment_project_document_import_settings_from_row(&row))
}

#[tauri::command]
async fn get_postgres_experiment_project_canvas_state_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<PostgresExperimentProjectCanvasState, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    let row = load_postgres_experiment_project_settings_row(&app, &project).await?;
    Ok(postgres_experiment_project_canvas_state_from_row(&row))
}

#[tauri::command]
async fn save_postgres_experiment_project_canvas_state_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentProjectCanvasStateRequest,
) -> Result<PostgresExperimentProjectCanvasState, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let canvas_state_json = serde_json::to_string(&request.state)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment project canvas state: {e}"))?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let existing_canvas_state_json: String = client
        .query_one(
            "
            SELECT canvas_state_json
            FROM project_settings
            WHERE id = 'default'
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment project canvas state before save: {e}"))?
        .get(0);
    if existing_canvas_state_json == canvas_state_json {
        connection_task.abort();
        return Ok(request.state);
    }
    let row = client
        .query_one(
            "
            UPDATE project_settings
            SET canvas_state_json = $1,
                updated_at = NOW()
            WHERE id = 'default'
            RETURNING
                ai_assist_enabled,
                ai_semantic_search_allowed,
                ai_question_answering_allowed,
                ai_summaries_allowed,
                ai_code_suggestions_allowed,
                ai_draft_reports_allowed,
                document_import_store_original_file_name,
                canvas_state_json
            ",
            &[&canvas_state_json],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment project canvas state: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "project.canvas.update",
        "Updated the project canvas",
        Some("default"),
        Some(serde_json::json!({
            "changedFields": ["canvas_state_json"],
            "nodeCount": request.state.nodes.len(),
            "shapeCount": request.state.shapes.len(),
            "hiddenRelationshipCount": request.state.hidden_relationship_ids.len(),
        })),
    ).await?;
    connection_task.abort();
    Ok(postgres_experiment_project_canvas_state_from_row(&row))
}

#[tauri::command]
async fn save_postgres_experiment_saved_drawing_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentSavedDrawingRequest,
) -> Result<PostgresExperimentSavedDrawing, String> {
    let project_id = request.project_id.trim().to_string();
    let drawing_id = request
        .drawing_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let canvas_kind = request
        .canvas_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("free_draw")
        .to_string();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;

    let drawing_state_json = serde_json::to_string(&request.state)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment saved drawing state: {e}"))?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let created = drawing_id.is_none();
    let resolved_drawing_id = drawing_id.unwrap_or_else(generate_identifier);
    let resolved_name = name.unwrap_or_else(|| format!("Drawing {}", &resolved_drawing_id.chars().take(8).collect::<String>()));

    let row = if created {
        client
            .query_one(
                "
                INSERT INTO saved_drawings (id, name, canvas_kind, canvas_state_json)
                VALUES ($1, $2, $3, $4)
                RETURNING id, name, canvas_kind, canvas_state_json, created_at::text, updated_at::text
                ",
                &[&resolved_drawing_id, &resolved_name, &canvas_kind, &drawing_state_json],
            )
            .await
    } else {
        client
            .query_one(
                "
                UPDATE saved_drawings
                SET name = $2,
                    canvas_kind = $3,
                    canvas_state_json = $4,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id, name, canvas_kind, canvas_state_json, created_at::text, updated_at::text
                ",
                &[&resolved_drawing_id, &resolved_name, &canvas_kind, &drawing_state_json],
            )
            .await
    }
    .map_err(|e| format!("Could not save PostgreSQL experiment drawing: {e}"))?;

    let log_label = if created {
        format!("Saved drawing \"{resolved_name}\"")
    } else {
        format!("Updated drawing \"{resolved_name}\"")
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "saved_drawing.create" } else { "saved_drawing.update" },
        &log_label,
        Some(&resolved_drawing_id),
        Some(serde_json::json!({
            "name": resolved_name,
            "canvasKind": canvas_kind,
            "changedFields": if created { serde_json::Value::Null } else { serde_json::json!(["name", "canvas_kind", "canvas_state_json"]) },
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "saved_drawing",
        &resolved_drawing_id,
        if created { "created" } else { "updated" },
    );

    Ok(map_postgres_experiment_saved_drawing_row(&project_id, row))
}

#[tauri::command]
async fn list_postgres_experiment_saved_drawings_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSavedDrawing>, String> {
    let trimmed_project_id = project_id.trim().to_string();
    if trimmed_project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &trimmed_project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;

    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let rows = client
        .query(
            "
            SELECT id, name, canvas_kind, canvas_state_json, created_at::text, updated_at::text
            FROM saved_drawings
            ORDER BY updated_at DESC, created_at DESC, id DESC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment saved drawings: {e}"))?;
    connection_task.abort();

    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_saved_drawing_row(&trimmed_project_id, row))
        .collect())
}

#[tauri::command]
async fn list_postgres_experiment_saved_drawing_summaries_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSavedDrawingSummary>, String> {
    let trimmed_project_id = project_id.trim().to_string();
    if trimmed_project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &trimmed_project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;

    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let rows = client
        .query(
            "
            SELECT id, name, canvas_kind, created_at::text, updated_at::text
            FROM saved_drawings
            ORDER BY updated_at DESC, created_at DESC, id DESC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment saved drawing summaries: {e}"))?;
    connection_task.abort();

    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_saved_drawing_summary_row(&trimmed_project_id, row))
        .collect())
}

#[tauri::command]
async fn get_postgres_experiment_saved_drawing_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    drawing_id: String,
) -> Result<PostgresExperimentSavedDrawing, String> {
    let trimmed_project_id = project_id.trim().to_string();
    let trimmed_drawing_id = drawing_id.trim().to_string();
    if trimmed_project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if trimmed_drawing_id.is_empty() {
        return Err("Drawing id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &trimmed_project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;

    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let row = client
        .query_opt(
            "
            SELECT id, name, canvas_kind, canvas_state_json, created_at::text, updated_at::text
            FROM saved_drawings
            WHERE id = $1
            ",
            &[&trimmed_drawing_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment saved drawing: {e}"))?;
    connection_task.abort();

    match row {
        Some(row) => Ok(map_postgres_experiment_saved_drawing_row(&trimmed_project_id, row)),
        None => Err("Saved drawing not found.".to_string()),
    }
}

#[tauri::command]
async fn delete_postgres_experiment_saved_drawing_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    drawing_id: String,
) -> Result<(), String> {
    let trimmed_project_id = project_id.trim().to_string();
    let trimmed_drawing_id = drawing_id.trim().to_string();
    if trimmed_project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if trimmed_drawing_id.is_empty() {
        return Err("Drawing id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &trimmed_project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;

    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_name = client
        .query_opt("SELECT name FROM saved_drawings WHERE id = $1", &[&trimmed_drawing_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment saved drawing before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    client
        .execute("DELETE FROM saved_drawings WHERE id = $1", &[&trimmed_drawing_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment saved drawing: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &trimmed_project_id,
        &session,
        "saved_drawing.delete",
        "Deleted a drawing",
        Some(&trimmed_drawing_id),
        Some(serde_json::json!({
            "name": deleted_name,
        })),
    ).await?;
    connection_task.abort();

    emit_postgres_experiment_project_change(
        &app,
        &trimmed_project_id,
        "saved_drawing",
        &trimmed_drawing_id,
        "deleted",
    );
    Ok(())
}

fn parse_postgres_experiment_attribute_options_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .map(|values| normalize_attribute_options(&values))
        .unwrap_or_default()
}

fn map_postgres_experiment_saved_drawing_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentSavedDrawing {
    let state_json: String = row.get(3);
    PostgresExperimentSavedDrawing {
        id: row.get(0),
        project_id: project_id.to_string(),
        name: row.get(1),
        canvas_kind: row.get(2),
        state: postgres_experiment_canvas_state_from_json(&state_json),
        created_at: row.get(4),
        updated_at: row.get(5),
    }
}

fn map_postgres_experiment_saved_drawing_summary_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentSavedDrawingSummary {
    PostgresExperimentSavedDrawingSummary {
        id: row.get(0),
        project_id: project_id.to_string(),
        name: row.get(1),
        canvas_kind: row.get(2),
        created_at: row.get(3),
        updated_at: row.get(4),
    }
}

fn map_postgres_experiment_object_attribute_definition_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentObjectAttributeDefinition {
    let options_json: String = row.get(6);
    PostgresExperimentObjectAttributeDefinition {
        id: row.get(0),
        project_id: project_id.to_string(),
        object_type_id: row.get::<usize, Option<String>>(1).unwrap_or_default(),
        object_type: row.get::<usize, Option<String>>(2).unwrap_or_default(),
        name: row.get(3),
        data_type: row.get(4),
        description: row.get(5),
        options: parse_postgres_experiment_attribute_options_json(&options_json),
        sort_order: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }
}

fn map_postgres_experiment_relationship_attribute_definition_row(
    project_id: &str,
    row: tokio_postgres::Row,
) -> PostgresExperimentRelationshipAttributeDefinition {
    let options_json: String = row.get(6);
    PostgresExperimentRelationshipAttributeDefinition {
        id: row.get(0),
        project_id: project_id.to_string(),
        relationship_type_id: row.get::<usize, Option<String>>(1).unwrap_or_default(),
        relationship_type: row.get::<usize, Option<String>>(2).unwrap_or_default(),
        name: row.get(3),
        data_type: row.get(4),
        description: row.get(5),
        options: parse_postgres_experiment_attribute_options_json(&options_json),
        sort_order: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }
}

async fn load_postgres_experiment_object_attribute_definitions_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentObjectAttributeDefinition>, String> {
    let rows = client
        .query(
            "
            SELECT d.id, d.object_type_id, t.name, d.name, d.data_type, d.description, d.options_json, d.sort_order, d.created_at::text, d.updated_at::text
            FROM object_attribute_definitions d
            LEFT JOIN object_types t ON t.id = d.object_type_id
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object attributes: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_object_attribute_definition_row(project_id, row))
        .collect())
}

async fn load_postgres_experiment_object_types_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentObjectType>, String> {
    let rows = client
        .query(
            "
            SELECT id, system_key, name, description, shape, color, fill, created_at::text, updated_at::text
            FROM object_types
            ORDER BY lower(name) ASC, created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object types: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_object_type_row(project_id, row))
        .collect())
}

async fn load_postgres_experiment_sources_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentSource>, String> {
    let rows = client
        .query(
            "
            SELECT id, source_kind, title, original_file_name, storage_path, text_content, structured_content_json, waveform_peaks_json, video_frame_index_json, extracted_from_video_source_id, extracted_from_video_time_ms, notes, created_at::text, updated_at::text
            FROM sources
            ORDER BY created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment sources: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_source_row(project_id, row))
        .collect())
}

async fn delete_expired_postgres_experiment_source_locks_for_client(
    client: &impl GenericClient,
    now_ms: i64,
) -> Result<(), String> {
    client
        .execute(
            "
            DELETE FROM source_lock_kicks
            WHERE expires_at_ms <= $1
            ",
            &[&now_ms],
        )
        .await
        .map_err(|e| format!("Could not clear expired PostgreSQL experiment source lock kicks: {e}"))?;
    client
        .execute(
            "
            DELETE FROM source_locks
            WHERE expires_at_ms <= $1
            ",
            &[&now_ms],
        )
        .await
        .map_err(|e| format!("Could not clear expired PostgreSQL experiment source locks: {e}"))?;
    Ok(())
}

async fn load_postgres_experiment_source_locks_for_client(
    client: &tokio_postgres::Client,
    now_ms: i64,
) -> Result<Vec<PostgresExperimentSourceLock>, String> {
    let rows = client
        .query(
            "
            SELECT id, source_id, user_id, user_name, expires_at_ms, created_at::text, updated_at::text
            FROM source_locks
            WHERE expires_at_ms > $1
            ORDER BY created_at ASC, id ASC
            ",
            &[&now_ms],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment source locks: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentSourceLock {
            id: row.get(0),
            source_id: row.get(1),
            user_id: row.get(2),
            user_name: row.get(3),
            expires_at_ms: row.get(4),
            created_at: row.get(5),
            updated_at: row.get(6),
            reason: None,
        })
        .collect())
}

async fn load_postgres_experiment_source_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    source_id: &str,
) -> Result<PostgresExperimentSource, String> {
    let row = client
        .query_opt(
            "
            SELECT id, source_kind, title, original_file_name, storage_path, text_content, structured_content_json, waveform_peaks_json, video_frame_index_json, extracted_from_video_source_id, extracted_from_video_time_ms, notes, created_at::text, updated_at::text
            FROM sources
            WHERE id = $1
            ",
            &[&source_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment source: {e}"))?
        .ok_or_else(|| "The selected source could not be found.".to_string())?;
    Ok(map_postgres_experiment_source_row(project_id, row))
}

async fn load_postgres_experiment_source_object_links_for_client(
    client: &tokio_postgres::Client,
) -> Result<Vec<PostgresExperimentSourceObjectLink>, String> {
    let rows = client
        .query(
            "
            SELECT source_id, object_id, created_at::text
            FROM source_objects
            ORDER BY created_at ASC, source_id ASC, object_id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment source-object links: {e}"))?;
    Ok(rows
        .into_iter()
        .map(map_postgres_experiment_source_object_link_row)
        .collect())
}

async fn load_postgres_experiment_source_attribute_definitions_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentSourceAttributeDefinition>, String> {
    let rows = client
        .query(
            "
            SELECT id, name, data_type, description, options_json, sort_order, created_at::text, updated_at::text
            FROM source_attribute_definitions
            ORDER BY sort_order ASC, created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment source attributes: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_source_attribute_definition_row(project_id, row))
        .collect())
}

async fn load_postgres_experiment_source_attribute_values_for_client(
    client: &tokio_postgres::Client,
) -> Result<Vec<PostgresExperimentSourceAttributeValue>, String> {
    let rows = client
        .query(
            "
            SELECT
                v.id,
                v.source_id,
                v.attribute_definition_id,
                d.name,
                d.data_type,
                v.value,
                d.sort_order
            FROM source_attribute_values v
            INNER JOIN source_attribute_definitions d ON d.id = v.attribute_definition_id
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC, v.created_at ASC, v.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment source attribute values: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentSourceAttributeValue {
            id: row.get(0),
            source_id: row.get(1),
            attribute_definition_id: row.get(2),
            attribute_name: row.get(3),
            data_type: row.get(4),
            value: row.get(5),
            sort_order: row.get(6),
        })
        .collect())
}

async fn load_postgres_experiment_code_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    code_id: &str,
) -> Result<PostgresExperimentCode, String> {
    let row = client
        .query_opt(
            "
            SELECT id, label, color, description, shortcut, parent_code_id, sort_order, created_at::text, updated_at::text
            FROM codes
            WHERE id = $1
            ",
            &[&code_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment code: {e}"))?
        .ok_or_else(|| "The selected code could not be found.".to_string())?;
    Ok(map_postgres_experiment_code_row(project_id, row))
}

async fn validate_postgres_experiment_code_parent_for_client(
    client: &tokio_postgres::Client,
    code_id: Option<&str>,
    parent_code_id: Option<&str>,
) -> Result<(), String> {
    let Some(parent_code_id) = parent_code_id else {
        return Ok(());
    };

    let parent_exists = client
        .query_opt("SELECT id FROM codes WHERE id = $1", &[&parent_code_id])
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment parent code: {e}"))?
        .is_some();
    if !parent_exists {
        return Err("The selected parent code could not be found.".to_string());
    }

    let Some(code_id) = code_id else {
        return Ok(());
    };

    if code_id == parent_code_id {
        return Err("A code cannot be its own parent.".to_string());
    }

    let creates_cycle = client
        .query_opt(
            "
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM codes
                WHERE parent_code_id = $1
                UNION ALL
                SELECT codes.id
                FROM codes
                INNER JOIN descendants ON codes.parent_code_id = descendants.id
            )
            SELECT id
            FROM descendants
            WHERE id = $2
            LIMIT 1
            ",
            &[&code_id, &parent_code_id],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment code hierarchy: {e}"))?
        .is_some();
    if creates_cycle {
        return Err("A code cannot be moved under one of its descendants.".to_string());
    }

    Ok(())
}

fn normalize_postgres_experiment_identifier_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() || !seen.insert(trimmed.clone()) {
            continue;
        }
        normalized.push(trimmed);
    }
    normalized
}

async fn resolve_postgres_experiment_project_user_id_for_email(
    client: &tokio_postgres::Client,
    email: &str,
) -> Result<Option<String>, String> {
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Ok(None);
    }

    let row = client
        .query_opt(
            "
            SELECT id
            FROM project_users
            WHERE lower(email) = $1
            ",
            &[&normalized_email],
        )
        .await
        .map_err(|e| format!("Could not resolve PostgreSQL experiment project user: {e}"))?;
    Ok(row.map(|row| row.get(0)))
}

async fn validate_postgres_experiment_annotation_code_ids_for_client(
    client: &tokio_postgres::Client,
    code_ids: &[String],
) -> Result<(), String> {
    if code_ids.is_empty() {
        return Err("Select at least one code.".to_string());
    }

    let count: i64 = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM codes WHERE id = ANY($1)",
            &[&code_ids],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment annotation codes: {e}"))?
        .get(0);
    if count != code_ids.len() as i64 {
        return Err("One or more selected codes could not be found.".to_string());
    }
    Ok(())
}

async fn validate_postgres_experiment_source_ids_for_client(
    client: &tokio_postgres::Client,
    source_ids: &[String],
) -> Result<(), String> {
    if source_ids.is_empty() {
        return Ok(());
    }

    let count: i64 = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM sources WHERE id = ANY($1)",
            &[&source_ids],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment memo sources: {e}"))?
        .get(0);
    if count != source_ids.len() as i64 {
        return Err("One or more selected sources could not be found.".to_string());
    }
    Ok(())
}

async fn validate_postgres_experiment_annotation_ids_for_client(
    client: &tokio_postgres::Client,
    annotation_ids: &[String],
) -> Result<(), String> {
    if annotation_ids.is_empty() {
        return Ok(());
    }

    let count: i64 = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM annotations WHERE id = ANY($1)",
            &[&annotation_ids],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment memo annotations: {e}"))?
        .get(0);
    if count != annotation_ids.len() as i64 {
        return Err("One or more selected annotations could not be found.".to_string());
    }
    Ok(())
}

async fn validate_postgres_experiment_object_ids_for_client(
    client: &tokio_postgres::Client,
    object_ids: &[String],
) -> Result<(), String> {
    if object_ids.is_empty() {
        return Ok(());
    }

    let count: i64 = client
        .query_one(
            "SELECT COUNT(*)::bigint FROM research_objects WHERE id = ANY($1)",
            &[&object_ids],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment memo objects: {e}"))?
        .get(0);
    if count != object_ids.len() as i64 {
        return Err("One or more selected objects could not be found.".to_string());
    }
    Ok(())
}

async fn load_postgres_experiment_annotation_summary_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    annotation_id: &str,
) -> Result<PostgresExperimentAnnotationSummary, String> {
    let annotation = load_postgres_experiment_annotation_summaries_for_client(client, project_id)
        .await?
        .into_iter()
        .find(|annotation| annotation.id == annotation_id)
        .ok_or_else(|| "The selected annotation could not be found.".to_string())?;
    Ok(annotation)
}

async fn load_postgres_experiment_codes_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentCode>, String> {
    let rows = client
        .query(
            "
            SELECT id, label, color, description, shortcut, parent_code_id, sort_order, created_at::text, updated_at::text
            FROM codes
            ORDER BY sort_order ASC, created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment codes: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_code_row(project_id, row))
        .collect())
}

async fn load_postgres_experiment_annotation_summaries_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentAnnotationSummary>, String> {
    let rows = client
        .query(
            "
            SELECT
                a.id,
                a.source_id,
                a.display_id,
                COALESCE(ac.code_ids, ARRAY[]::TEXT[]) AS code_ids,
                COALESCE(ac.primary_code_id, '') AS primary_code_id,
                COALESCE(pc.label, '') AS primary_code_label,
                a.start_offset,
                a.end_offset,
                a.time_start_ms,
                a.time_end_ms,
                a.quote,
                a.note,
                a.anchor_kind,
                a.region_selector_json,
                COALESCE(a.created_by_project_user_id, '') AS created_by_project_user_id,
                COALESCE(pu.name, '') AS created_by_name,
                a.created_at::text,
                a.updated_at::text
            FROM annotations a
            LEFT JOIN LATERAL (
                SELECT
                    ARRAY_AGG(ac.code_id ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC) AS code_ids,
                    (
                        ARRAY_AGG(ac.code_id ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC)
                    )[1] AS primary_code_id
                FROM annotation_codes ac
                INNER JOIN codes c ON c.id = ac.code_id
                WHERE ac.annotation_id = a.id
            ) ac ON TRUE
            LEFT JOIN codes pc ON pc.id = ac.primary_code_id
            LEFT JOIN project_users pu ON pu.id = a.created_by_project_user_id
            ORDER BY a.created_at ASC, a.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment annotations: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentAnnotationSummary {
            id: row.get(0),
            display_id: row.get(2),
            project_id: project_id.to_string(),
            source_id: row.get(1),
            code_ids: row.get(3),
            primary_code_id: row.get(4),
            primary_code_label: row.get(5),
            start_offset: row.get(6),
            end_offset: row.get(7),
            time_start_ms: row.get(8),
            time_end_ms: row.get(9),
            quote: row.get(10),
            note: row.get(11),
            anchor_kind: row.get(12),
            image_region: parse_postgres_experiment_annotation_image_region(row.get::<_, String>(13).as_str()),
            created_by_project_user_id: row.get(14),
            created_by_name: row.get(15),
            created_at: row.get(16),
            updated_at: row.get(17),
        })
        .collect())
}

async fn load_postgres_experiment_memos_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentMemo>, String> {
    let rows = client
        .query(
            "
            SELECT
                m.id,
                m.title,
                m.body,
                COALESCE(m.created_by_project_user_id, '') AS created_by_project_user_id,
                COALESCE(pu.name, '') AS created_by_name,
                COALESCE(ms.source_ids, ARRAY[]::TEXT[]) AS source_ids,
                COALESCE(ma.annotation_ids, ARRAY[]::TEXT[]) AS annotation_ids,
                COALESCE(mc.code_ids, ARRAY[]::TEXT[]) AS code_ids,
                COALESCE(mo.object_ids, ARRAY[]::TEXT[]) AS object_ids,
                m.created_at::text,
                m.updated_at::text
            FROM memos m
            LEFT JOIN project_users pu ON pu.id = m.created_by_project_user_id
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(source_id ORDER BY source_id) AS source_ids
                FROM memo_sources
                WHERE memo_id = m.id
            ) ms ON TRUE
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(annotation_id ORDER BY annotation_id) AS annotation_ids
                FROM memo_annotations
                WHERE memo_id = m.id
            ) ma ON TRUE
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(code_id ORDER BY code_id) AS code_ids
                FROM memo_codes
                WHERE memo_id = m.id
            ) mc ON TRUE
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(object_id ORDER BY object_id) AS object_ids
                FROM memo_objects
                WHERE memo_id = m.id
            ) mo ON TRUE
            ORDER BY m.updated_at DESC, m.created_at DESC, m.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment memos: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentMemo {
            id: row.get(0),
            project_id: project_id.to_string(),
            title: row.get(1),
            body: row.get(2),
            created_by_project_user_id: row.get(3),
            created_by_name: row.get(4),
            source_ids: row.get(5),
            annotation_ids: row.get(6),
            code_ids: row.get(7),
            object_ids: row.get(8),
            created_at: row.get(9),
            updated_at: row.get(10),
        })
        .collect())
}

async fn load_postgres_experiment_memo_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    memo_id: &str,
) -> Result<PostgresExperimentMemo, String> {
    let memo = load_postgres_experiment_memos_for_client(client, project_id)
        .await?
        .into_iter()
        .find(|memo| memo.id == memo_id)
        .ok_or_else(|| "The selected memo could not be found.".to_string())?;
    Ok(memo)
}

async fn load_postgres_experiment_project_log_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentProjectLogEntry>, String> {
    let rows = client
        .query(
            "
            SELECT
                id,
                user_id,
                user_name,
                access_mode,
                action,
                label,
                record_id,
                details_json,
                occurred_at::text,
                restored_at::text
            FROM project_log
            ORDER BY occurred_at DESC, id DESC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment project log: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentProjectLogEntry {
            id: row.get(0),
            project_id: project_id.to_string(),
            user_id: row.get(1),
            user_name: row.get(2),
            access_mode: row.get(3),
            action: row.get(4),
            label: row.get(5),
            record_id: row.get(6),
            details_json: row.get(7),
            occurred_at: row.get(8),
            restored_at: row.get(9),
        })
        .collect())
}

async fn load_postgres_experiment_relationship_types_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentRelationshipType>, String> {
    let rows = client
        .query(
            "
            SELECT
                r.id,
                r.name,
                r.description,
                r.line_shape,
                r.line_weight,
                r.arrowhead,
                r.color,
                CASE
                    WHEN array_length(r.from_object_type_ids, 1) IS NOT NULL THEN r.from_object_type_ids
                    WHEN r.from_object_type_id IS NOT NULL THEN ARRAY[r.from_object_type_id]
                    ELSE ARRAY[]::TEXT[]
                END AS from_object_type_ids,
                COALESCE((
                    SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id)
                    FROM object_types
                    WHERE object_types.id = ANY(
                        CASE
                            WHEN array_length(r.from_object_type_ids, 1) IS NOT NULL THEN r.from_object_type_ids
                            WHEN r.from_object_type_id IS NOT NULL THEN ARRAY[r.from_object_type_id]
                            ELSE ARRAY[]::TEXT[]
                        END
                    )
                ), ARRAY[]::TEXT[]) AS from_object_types,
                CASE
                    WHEN array_length(r.to_object_type_ids, 1) IS NOT NULL THEN r.to_object_type_ids
                    WHEN r.to_object_type_id IS NOT NULL THEN ARRAY[r.to_object_type_id]
                    ELSE ARRAY[]::TEXT[]
                END AS to_object_type_ids,
                COALESCE((
                    SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id)
                    FROM object_types
                    WHERE object_types.id = ANY(
                        CASE
                            WHEN array_length(r.to_object_type_ids, 1) IS NOT NULL THEN r.to_object_type_ids
                            WHEN r.to_object_type_id IS NOT NULL THEN ARRAY[r.to_object_type_id]
                            ELSE ARRAY[]::TEXT[]
                        END
                    )
                ), ARRAY[]::TEXT[]) AS to_object_types,
                r.created_at::text,
                r.updated_at::text
            FROM relationship_types r
            ORDER BY lower(r.name) ASC, r.created_at ASC, r.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationship types: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_relationship_type_row(project_id, row))
        .collect())
}

async fn find_postgres_experiment_object_type_for_client(
    client: &tokio_postgres::Client,
    object_type_name: &str,
) -> Result<Option<(String, String)>, String> {
    let row = client
        .query_opt(
            "
            SELECT id, name
            FROM object_types
            WHERE LOWER(name) = LOWER($1)
            ",
            &[&object_type_name],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object types: {e}"))?;
    Ok(row.map(|row| (row.get(0), row.get(1))))
}

async fn load_postgres_experiment_object_type_record_for_client(
    client: &tokio_postgres::Client,
    object_type_id: &str,
) -> Result<PostgresExperimentResolvedObjectType, String> {
    let normalized_id = object_type_id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("Choose an object type.".to_string());
    }
    let row = client
        .query_opt(
            "
            SELECT id, name, system_key
            FROM object_types
            WHERE id = $1
            ",
            &[&normalized_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object type: {e}"))?;
    row.map(|row| PostgresExperimentResolvedObjectType {
        id: row.get(0),
        name: row.get(1),
        system_key: row.get(2),
    })
    .ok_or_else(|| "The selected object type could not be found.".to_string())
}

async fn load_postgres_experiment_object_type_for_client(
    client: &tokio_postgres::Client,
    object_type_id: &str,
) -> Result<(String, String), String> {
    let object_type = load_postgres_experiment_object_type_record_for_client(client, object_type_id).await?;
    Ok((object_type.id, object_type.name))
}

async fn load_postgres_experiment_object_type_record_for_system_key_for_client(
    client: &tokio_postgres::Client,
    system_key: &str,
) -> Result<PostgresExperimentResolvedObjectType, String> {
    let row = client
        .query_opt(
            "
            SELECT id, name, system_key
            FROM object_types
            WHERE system_key = $1
            ",
            &[&system_key],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object type by system key: {e}"))?;
    row.map(|row| PostgresExperimentResolvedObjectType {
        id: row.get(0),
        name: row.get(1),
        system_key: row.get(2),
    })
    .ok_or_else(|| format!("The built-in object type \"{system_key}\" could not be found."))
}

async fn sync_postgres_experiment_source_object_for_client(
    client: &tokio_postgres::Client,
    source_id: &str,
    source_kind: &str,
    title: &str,
    notes: &str,
) -> Result<(), String> {
    let system_key = postgres_experiment_source_object_type_system_key(source_kind);
    let object_type = load_postgres_experiment_object_type_record_for_system_key_for_client(client, system_key).await?;
    let existing_object_id = client
        .query_opt(
            "
            SELECT id
            FROM research_objects
            WHERE source_id = $1
            ",
            &[&source_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source-backed object: {e}"))?
        .map(|row| row.get::<usize, String>(0));

    if let Some(object_id) = existing_object_id {
        client
            .execute(
                "
                UPDATE research_objects
                SET object_type_id = $2,
                    object_type = $3,
                    title = $4,
                    description = $5,
                    updated_at = NOW()
                WHERE id = $1
                ",
                &[&object_id, &object_type.id, &object_type.name, &title, &notes],
            )
            .await
            .map_err(|e| format!("Could not update PostgreSQL experiment source-backed object: {e}"))?;
    } else {
        let object_id = generate_identifier();
        client
            .execute(
                "
                INSERT INTO research_objects (id, source_id, object_type_id, object_type, title, description)
                VALUES ($1, $2, $3, $4, $5, $6)
                ",
                &[&object_id, &source_id, &object_type.id, &object_type.name, &title, &notes],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment source-backed object: {e}"))?;
    }

    Ok(())
}

async fn sync_all_postgres_experiment_source_objects_for_client(
    client: &tokio_postgres::Client,
) -> Result<(), String> {
    let rows = client
        .query(
            "
            SELECT id, source_kind, title, notes
            FROM sources
            ORDER BY created_at ASC, id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment sources for object sync: {e}"))?;
    for row in rows {
        let source_id: String = row.get(0);
        let source_kind: String = row.get(1);
        let title: String = row.get(2);
        let notes: String = row.get(3);
        sync_postgres_experiment_source_object_for_client(client, &source_id, &source_kind, &title, &notes).await?;
    }
    Ok(())
}

fn ensure_postgres_experiment_object_type_is_not_source_backed(
    object_type: &PostgresExperimentResolvedObjectType,
) -> Result<(), String> {
    if is_postgres_experiment_source_object_system_key(object_type.system_key.as_deref()) {
        return Err("Sources create and manage these built-in source object types automatically.".to_string());
    }
    Ok(())
}

async fn load_postgres_experiment_source_id_for_object_for_client(
    client: &tokio_postgres::Client,
    object_id: &str,
) -> Result<Option<String>, String> {
    let row = client
        .query_opt(
            "
            SELECT source_id
            FROM research_objects
            WHERE id = $1
            ",
            &[&object_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object ownership: {e}"))?;
    row.map(|row| row.get::<usize, Option<String>>(0))
        .ok_or_else(|| "The selected object could not be found.".to_string())
}

async fn find_postgres_experiment_relationship_type_for_client(
    client: &tokio_postgres::Client,
    relationship_type_name: &str,
) -> Result<Option<(String, String)>, String> {
    let row = client
        .query_opt(
            "
            SELECT id, name
            FROM relationship_types
            WHERE LOWER(name) = LOWER($1)
            ",
            &[&relationship_type_name],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment relationship types: {e}"))?;
    Ok(row.map(|row| (row.get(0), row.get(1))))
}

fn normalize_postgres_experiment_object_type_id_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

async fn load_postgres_experiment_relationship_type_for_client(
    client: &tokio_postgres::Client,
    relationship_type_id: &str,
) -> Result<(String, String, Vec<String>, Vec<String>), String> {
    let normalized_id = relationship_type_id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("Choose a relationship type.".to_string());
    }
    let row = client
        .query_opt(
            "
            SELECT
                id,
                name,
                CASE
                    WHEN array_length(from_object_type_ids, 1) IS NOT NULL THEN from_object_type_ids
                    WHEN from_object_type_id IS NOT NULL THEN ARRAY[from_object_type_id]
                    ELSE ARRAY[]::TEXT[]
                END,
                CASE
                    WHEN array_length(to_object_type_ids, 1) IS NOT NULL THEN to_object_type_ids
                    WHEN to_object_type_id IS NOT NULL THEN ARRAY[to_object_type_id]
                    ELSE ARRAY[]::TEXT[]
                END
            FROM relationship_types
            WHERE id = $1
            ",
            &[&normalized_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationship type: {e}"))?;
    row.map(|row| (row.get(0), row.get(1), row.get(2), row.get(3)))
        .ok_or_else(|| "The selected relationship type could not be found.".to_string())
}

async fn validate_postgres_experiment_relationship_type_constraints_for_client(
    client: &tokio_postgres::Client,
    from_object_id: &str,
    to_object_id: &str,
    relationship_type_name: &str,
    allowed_from_object_type_ids: &[String],
    allowed_to_object_type_ids: &[String],
) -> Result<(), String> {
    let rows = client
        .query(
            "
            SELECT id, object_type_id
            FROM research_objects
            WHERE id = ANY($1)
            ",
            &[&vec![from_object_id.to_string(), to_object_id.to_string()]],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment relationship object types: {e}"))?;

    let mut object_type_by_object_id: HashMap<String, Option<String>> = HashMap::new();
    for row in rows {
        object_type_by_object_id.insert(row.get(0), row.get(1));
    }

    if !allowed_from_object_type_ids.is_empty() {
        let actual_from_object_type_id = object_type_by_object_id
            .get(from_object_id)
            .and_then(|value| value.clone());
        if !actual_from_object_type_id
            .as_deref()
            .map(|value| allowed_from_object_type_ids.iter().any(|allowed_id| allowed_id == value))
            .unwrap_or(false)
        {
            return Err(format!(
                "Relationships of type \"{relationship_type_name}\" require the source object to match its configured object type restriction."
            ));
        }
    }

    if !allowed_to_object_type_ids.is_empty() {
        let actual_to_object_type_id = object_type_by_object_id
            .get(to_object_id)
            .and_then(|value| value.clone());
        if !actual_to_object_type_id
            .as_deref()
            .map(|value| allowed_to_object_type_ids.iter().any(|allowed_id| allowed_id == value))
            .unwrap_or(false)
        {
            return Err(format!(
                "Relationships of type \"{relationship_type_name}\" require the target object to match its configured object type restriction."
            ));
        }
    }

    Ok(())
}

async fn load_postgres_experiment_object_attribute_values_for_client(
    client: &tokio_postgres::Client,
) -> Result<HashMap<String, Vec<PostgresExperimentObjectAttributeValue>>, String> {
    let rows = client
        .query(
            "
            SELECT
                v.id,
                v.object_id,
                v.attribute_definition_id,
                d.name,
                d.data_type,
                v.value,
                d.sort_order
            FROM object_attribute_values v
            INNER JOIN object_attribute_definitions d ON d.id = v.attribute_definition_id
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC, v.created_at ASC, v.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object attribute values: {e}"))?;
    let mut values_by_object_id: HashMap<String, Vec<PostgresExperimentObjectAttributeValue>> = HashMap::new();
    for row in rows {
        let object_id: String = row.get(1);
        values_by_object_id
            .entry(object_id.clone())
            .or_default()
            .push(PostgresExperimentObjectAttributeValue {
                id: row.get(0),
                object_id,
                attribute_definition_id: row.get(2),
                attribute_name: row.get(3),
                data_type: row.get(4),
                value: row.get(5),
                sort_order: row.get(6),
            });
    }
    Ok(values_by_object_id)
}

async fn save_postgres_experiment_object_attribute_values_for_client(
    client: &(impl GenericClient + Sync),
    object_id: &str,
    object_type_id: &str,
    attribute_values: &[PostgresExperimentObjectAttributeValueInput],
) -> Result<(), String> {
    let normalized_object_type_id = object_type_id.trim().to_string();
    if normalized_object_type_id.is_empty() {
        return Err("Object type is required for object attributes.".to_string());
    }

    let definition_rows = client
        .query(
            "
            SELECT id, data_type, options_json
            FROM object_attribute_definitions
            WHERE object_type_id = $1
            ",
            &[&normalized_object_type_id],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment object attributes: {e}"))?;

    let mut definitions_by_id: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for row in definition_rows {
        let options_json: String = row.get(2);
        definitions_by_id.insert(
            row.get(0),
            (row.get(1), parse_postgres_experiment_attribute_options_json(&options_json)),
        );
    }

    let existing_rows = client
        .query(
            "
            SELECT id, attribute_definition_id
            FROM object_attribute_values
            WHERE object_id = $1
            ",
            &[&object_id],
        )
        .await
        .map_err(|e| format!("Could not load existing PostgreSQL experiment object attributes: {e}"))?;

    let mut existing_value_ids_by_definition_id: HashMap<String, String> = HashMap::new();
    for row in existing_rows {
        existing_value_ids_by_definition_id.insert(row.get(1), row.get(0));
    }

    let allowed_definition_ids: HashSet<String> = definitions_by_id.keys().cloned().collect();
    for (definition_id, existing_value_id) in &existing_value_ids_by_definition_id {
        if !allowed_definition_ids.contains(definition_id) {
            client
                .execute("DELETE FROM object_attribute_values WHERE id = $1", &[existing_value_id])
                .await
                .map_err(|e| format!("Could not remove PostgreSQL experiment object attribute value: {e}"))?;
        }
    }

    let mut seen_definition_ids = HashSet::new();
    for input in attribute_values {
        let attribute_definition_id = input.attribute_definition_id.trim().to_string();
        if attribute_definition_id.is_empty() {
            return Err("Object attribute definition id is required.".to_string());
        }
        if !seen_definition_ids.insert(attribute_definition_id.clone()) {
            return Err("Each object attribute can only be supplied once per request.".to_string());
        }

        let trimmed_value = input.value.trim().to_string();
        let (data_type, options) = definitions_by_id
            .get(&attribute_definition_id)
            .cloned()
            .ok_or_else(|| "One or more object attributes no longer exist in this project.".to_string())?;

        if data_type == "categorical"
            && !trimmed_value.is_empty()
            && !options.iter().any(|option| option == &trimmed_value)
        {
            return Err(format!("Choose one of the allowed values for object attribute \"{}\".", attribute_definition_id));
        }

        if let Some(existing_value_id) = existing_value_ids_by_definition_id.get(&attribute_definition_id) {
            if trimmed_value.is_empty() {
                client
                    .execute(
                        "DELETE FROM object_attribute_values WHERE id = $1",
                        &[existing_value_id],
                    )
                    .await
                    .map_err(|e| format!("Could not clear PostgreSQL experiment object attribute value: {e}"))?;
            } else {
                client
                    .execute(
                        "
                        UPDATE object_attribute_values
                        SET value = $2,
                            updated_at = NOW()
                        WHERE id = $1
                        ",
                        &[existing_value_id, &trimmed_value],
                    )
                    .await
                    .map_err(|e| format!("Could not update PostgreSQL experiment object attribute value: {e}"))?;
            }
        } else if !trimmed_value.is_empty() {
            client
                .execute(
                    "
                    INSERT INTO object_attribute_values (id, object_id, attribute_definition_id, value)
                    VALUES ($1, $2, $3, $4)
                    ",
                    &[&generate_identifier(), &object_id, &attribute_definition_id, &trimmed_value],
                )
                .await
                .map_err(|e| format!("Could not create PostgreSQL experiment object attribute value: {e}"))?;
        }
    }

    Ok(())
}

fn normalize_optional_postgres_experiment_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_postgres_experiment_event_time_precision(value: Option<&str>) -> Result<String, String> {
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("exact")
        .to_ascii_lowercase();
    match normalized.as_str() {
        "exact" | "date" | "month" | "year" => Ok(normalized),
        _ => Err("Choose a valid event time precision.".to_string()),
    }
}

async fn save_postgres_experiment_event_fields_for_client(
    client: &(impl GenericClient + Sync),
    object_id: &str,
    object_type_system_key: Option<&str>,
    event_start_at: Option<&str>,
    event_end_at: Option<&str>,
    event_time_precision: Option<&str>,
    event_timezone: Option<&str>,
    event_is_instant: Option<bool>,
) -> Result<(), String> {
    if object_type_system_key == Some("event") {
        let start_at = normalize_optional_postgres_experiment_text(event_start_at)
            .ok_or_else(|| "Events require a start date/time.".to_string())?;
        let end_at = normalize_optional_postgres_experiment_text(event_end_at);
        let time_precision = normalize_postgres_experiment_event_time_precision(event_time_precision)?;
        let timezone = event_timezone.unwrap_or("").trim().to_string();
        let is_instant = event_is_instant.unwrap_or(false);
        client
            .execute(
                "
                INSERT INTO event_objects (object_id, start_at, end_at, time_precision, timezone, is_instant)
                VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6)
                ON CONFLICT (object_id) DO UPDATE
                SET start_at = EXCLUDED.start_at,
                    end_at = EXCLUDED.end_at,
                    time_precision = EXCLUDED.time_precision,
                    timezone = EXCLUDED.timezone,
                    is_instant = EXCLUDED.is_instant,
                    updated_at = NOW()
                ",
                &[&object_id, &start_at, &end_at, &time_precision, &timezone, &is_instant],
            )
            .await
            .map_err(|e| format!("Could not save PostgreSQL experiment event fields: {e}"))?;
    } else {
        client
            .execute("DELETE FROM event_objects WHERE object_id = $1", &[&object_id])
            .await
            .map_err(|e| format!("Could not clear PostgreSQL experiment event fields: {e}"))?;
    }

    Ok(())
}

async fn load_postgres_experiment_object_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
    object_id: &str,
    attribute_values_by_object_id: &HashMap<String, Vec<PostgresExperimentObjectAttributeValue>>,
) -> Result<PostgresExperimentObject, String> {
    let row = client
        .query_one(
            "
            SELECT
                o.id,
                o.object_type_id,
                t.name,
                t.system_key,
                o.source_id,
                s.source_kind,
                o.title,
                o.description,
                o.shape_override,
                o.color_override,
                o.fill_override,
                e.start_at::text,
                e.end_at::text,
                e.time_precision,
                NULLIF(e.timezone, ''),
                e.is_instant,
                o.created_at::text,
                o.updated_at::text
            FROM research_objects o
            LEFT JOIN object_types t ON t.id = o.object_type_id
            LEFT JOIN sources s ON s.id = o.source_id
            LEFT JOIN event_objects e ON e.object_id = o.id
            WHERE o.id = $1
            ",
            &[&object_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object: {e}"))?;
    Ok(map_postgres_experiment_object_row(
        project_id,
        row,
        attribute_values_by_object_id,
    ))
}

async fn load_postgres_experiment_relationship_attribute_definitions_for_client(
    client: &tokio_postgres::Client,
    project_id: &str,
) -> Result<Vec<PostgresExperimentRelationshipAttributeDefinition>, String> {
    let rows = client
        .query(
            "
            SELECT d.id, d.relationship_type_id, t.name, d.name, d.data_type, d.description, d.options_json, d.sort_order, d.created_at::text, d.updated_at::text
            FROM relationship_attribute_definitions d
            LEFT JOIN relationship_types t ON t.id = d.relationship_type_id
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationship attributes: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_relationship_attribute_definition_row(project_id, row))
        .collect())
}

async fn load_postgres_experiment_relationship_attribute_values_for_client(
    client: &tokio_postgres::Client,
) -> Result<HashMap<String, Vec<PostgresExperimentRelationshipAttributeValue>>, String> {
    let rows = client
        .query(
            "
            SELECT
                v.id,
                v.relationship_id,
                v.attribute_definition_id,
                d.name,
                d.data_type,
                v.value,
                d.sort_order
            FROM relationship_attribute_values v
            INNER JOIN relationship_attribute_definitions d ON d.id = v.attribute_definition_id
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC, v.created_at ASC, v.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationship attribute values: {e}"))?;
    let mut values_by_relationship_id: HashMap<String, Vec<PostgresExperimentRelationshipAttributeValue>> =
        HashMap::new();
    for row in rows {
        let relationship_id: String = row.get(1);
        values_by_relationship_id
            .entry(relationship_id.clone())
            .or_default()
            .push(PostgresExperimentRelationshipAttributeValue {
                id: row.get(0),
                relationship_id,
                attribute_definition_id: row.get(2),
                attribute_name: row.get(3),
                data_type: row.get(4),
                value: row.get(5),
                sort_order: row.get(6),
            });
    }
    Ok(values_by_relationship_id)
}

async fn save_postgres_experiment_relationship_attribute_values_for_client(
    client: &(impl GenericClient + Sync),
    relationship_id: &str,
    relationship_type_id: &str,
    attribute_values: &[PostgresExperimentRelationshipAttributeValueInput],
) -> Result<(), String> {
    let normalized_relationship_type_id = relationship_type_id.trim().to_string();
    if normalized_relationship_type_id.is_empty() {
        return Err("Relationship type is required for relationship attributes.".to_string());
    }

    let definition_rows = client
        .query(
            "
            SELECT id, data_type, options_json
            FROM relationship_attribute_definitions
            WHERE relationship_type_id = $1
            ",
            &[&normalized_relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment relationship attributes: {e}"))?;

    let mut definitions_by_id: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for row in definition_rows {
        let options_json: String = row.get(2);
        definitions_by_id.insert(
            row.get(0),
            (row.get(1), parse_postgres_experiment_attribute_options_json(&options_json)),
        );
    }

    let existing_rows = client
        .query(
            "
            SELECT id, attribute_definition_id
            FROM relationship_attribute_values
            WHERE relationship_id = $1
            ",
            &[&relationship_id],
        )
        .await
        .map_err(|e| format!("Could not load existing PostgreSQL experiment relationship attributes: {e}"))?;

    let mut existing_value_ids_by_definition_id: HashMap<String, String> = HashMap::new();
    for row in existing_rows {
        existing_value_ids_by_definition_id.insert(row.get(1), row.get(0));
    }

    let allowed_definition_ids: HashSet<String> = definitions_by_id.keys().cloned().collect();
    for (definition_id, existing_value_id) in &existing_value_ids_by_definition_id {
        if !allowed_definition_ids.contains(definition_id) {
            client
                .execute(
                    "
                    DELETE FROM relationship_attribute_values
                    WHERE id = $1
                    ",
                    &[existing_value_id],
                )
                .await
                .map_err(|e| format!("Could not remove PostgreSQL experiment relationship attribute value: {e}"))?;
        }
    }

    let mut seen_definition_ids = HashSet::new();
    for input in attribute_values {
        let attribute_definition_id = input.attribute_definition_id.trim().to_string();
        if attribute_definition_id.is_empty() {
            return Err("Relationship attribute definition id is required.".to_string());
        }
        if !seen_definition_ids.insert(attribute_definition_id.clone()) {
            return Err("Relationship attribute values must not repeat the same attribute definition.".to_string());
        }

        let Some((data_type, options)) = definitions_by_id.get(&attribute_definition_id) else {
            return Err("One of the relationship attributes no longer exists.".to_string());
        };

        let value = input.value.trim().to_string();
        if data_type == "categorical" && !value.is_empty() && !options.iter().any(|option| option == &value) {
            return Err(format!("Relationship attribute value \"{value}\" is not one of the allowed options."));
        }

        if let Some(existing_value_id) = existing_value_ids_by_definition_id.get(&attribute_definition_id) {
            if value.is_empty() {
                client
                    .execute(
                        "
                        DELETE FROM relationship_attribute_values
                        WHERE id = $1
                        ",
                        &[existing_value_id],
                    )
                    .await
                    .map_err(|e| format!("Could not remove PostgreSQL experiment relationship attribute value: {e}"))?;
            } else {
                client
                    .execute(
                        "
                        UPDATE relationship_attribute_values
                        SET value = $2,
                            updated_at = NOW()
                        WHERE id = $1
                        ",
                        &[existing_value_id, &value],
                    )
                    .await
                    .map_err(|e| format!("Could not update PostgreSQL experiment relationship attribute value: {e}"))?;
            }
        } else if !value.is_empty() {
            let value_id = generate_identifier();
            client
                .execute(
                    "
                    INSERT INTO relationship_attribute_values (id, relationship_id, attribute_definition_id, value)
                    VALUES ($1, $2, $3, $4)
                    ",
                    &[&value_id, &relationship_id, &attribute_definition_id, &value],
                )
                .await
                .map_err(|e| format!("Could not create PostgreSQL experiment relationship attribute value: {e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_sources_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSource>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let sources = load_postgres_experiment_sources_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(sources)
}

#[tauri::command]
async fn create_postgres_experiment_source_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentSourceRequest,
) -> Result<PostgresExperimentSource, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_kind = normalize_postgres_experiment_source_kind(&request.source_kind)
        .ok_or_else(|| "Source type must be text, pdf, image, audio, or video.".to_string())?
        .to_string();

    let title = request.title.trim().to_string();
    if title.is_empty() {
        return Err("Source title is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let source_id = generate_identifier();
    let original_file_name = request.original_file_name.unwrap_or_default().trim().to_string();
    let storage_path = request.storage_path.unwrap_or_default().trim().to_string();
    let structured_content_json = request.structured_content_json.unwrap_or_default();
    let waveform_peaks_json = request.waveform_peaks_json.unwrap_or_default();
    let video_frame_index_json = request.video_frame_index_json.unwrap_or_default();
    let extracted_from_video_source_id = request.extracted_from_video_source_id.unwrap_or_default().trim().to_string();
    let extracted_from_video_time_ms = request.extracted_from_video_time_ms;
    let notes = request.notes.unwrap_or_default();
    client
        .execute(
            "
            INSERT INTO sources (
                id,
                source_kind,
                title,
                original_file_name,
                storage_path,
                text_content,
                structured_content_json,
                waveform_peaks_json,
                video_frame_index_json,
                extracted_from_video_source_id,
                extracted_from_video_time_ms,
                notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ",
            &[
                &source_id,
                &source_kind,
                &title,
                &original_file_name,
                &storage_path,
                &request.text_content,
                &structured_content_json,
                &waveform_peaks_json,
                &video_frame_index_json,
                &extracted_from_video_source_id,
                &extracted_from_video_time_ms,
                &notes,
            ],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source: {e}"))?;
    sync_postgres_experiment_source_object_for_client(&client, &source_id, &source_kind, &title, &notes).await?;

    let source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document.create",
        &format!("Added source \"{}\"", source.title),
        Some(&source.id),
        Some(serde_json::json!({
            "name": source.title,
            "sourceKind": source.source_kind,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source", &source_id, "created");
    connection_task.abort();
    Ok(source)
}

#[tauri::command]
async fn import_postgres_experiment_source_file_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: ImportPostgresExperimentSourceFileRequest,
) -> Result<PostgresExperimentSource, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_kind = normalize_postgres_experiment_source_kind(&request.source_kind)
        .ok_or_else(|| "Source type must be text, pdf, image, audio, or video.".to_string())?
        .to_string();

    let title = request.title.trim().to_string();
    if title.is_empty() {
        return Err("Source title is required.".to_string());
    }

    let original_file_name = request.original_file_name.trim().to_string();
    if original_file_name.is_empty() {
        return Err("Original file name is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let file_bytes = BASE64_STANDARD
        .decode(request.file_bytes_base64.trim())
        .map_err(|e| format!("Could not decode imported source file: {e}"))?;
    let source_id = generate_identifier();
    let source_file_id = generate_identifier();
    let media_type = request.media_type.unwrap_or_default().trim().to_string();
    let structured_content_json = request.structured_content_json.unwrap_or_default();
    let waveform_peaks_json = request.waveform_peaks_json.unwrap_or_default();
    let video_frame_index_json = request.video_frame_index_json.unwrap_or_default();
    let extracted_from_video_source_id = request.extracted_from_video_source_id.unwrap_or_default().trim().to_string();
    let extracted_from_video_time_ms = request.extracted_from_video_time_ms;
    let notes = request.notes.unwrap_or_default();
    let sanitized_file_name = sanitize_postgres_experiment_file_name(&original_file_name);
    let relative_storage_path = format!("sources/{source_id}/{sanitized_file_name}");
    let absolute_storage_path = Path::new(&project.storage_path).join(&relative_storage_path);
    if let Some(parent) = absolute_storage_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create PostgreSQL experiment source storage directory: {e}"))?;
    }
    fs::write(&absolute_storage_path, &file_bytes)
        .map_err(|e| format!("Could not save imported PostgreSQL experiment source file: {e}"))?;

    client
        .execute(
            "
            INSERT INTO sources (
                id,
                source_kind,
                title,
                original_file_name,
                storage_path,
                text_content,
                structured_content_json,
                waveform_peaks_json,
                video_frame_index_json,
                extracted_from_video_source_id,
                extracted_from_video_time_ms,
                notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ",
            &[
                &source_id,
                &source_kind,
                &title,
                &original_file_name,
                &relative_storage_path,
                &request.text_content,
                &structured_content_json,
                &waveform_peaks_json,
                &video_frame_index_json,
                &extracted_from_video_source_id,
                &extracted_from_video_time_ms,
                &notes,
            ],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source: {e}"))?;
    sync_postgres_experiment_source_object_for_client(&client, &source_id, &source_kind, &title, &notes).await?;

    client
        .execute(
            "
            INSERT INTO source_files (
                id,
                source_id,
                storage_path,
                original_file_name,
                media_type,
                file_size_bytes,
                checksum_sha256
            )
            VALUES ($1, $2, $3, $4, $5, $6, '')
            ",
            &[
                &source_file_id,
                &source_id,
                &relative_storage_path,
                &original_file_name,
                &media_type,
                &(file_bytes.len() as i64),
            ],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source file record: {e}"))?;

    let source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document.create",
        &format!("Imported source \"{}\"", source.title),
        Some(&source.id),
        Some(serde_json::json!({
            "name": source.title,
            "sourceKind": source.source_kind,
            "fileName": original_file_name,
            "sizeBytes": file_bytes.len(),
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source", &source_id, "created");
    connection_task.abort();
    Ok(source)
}

#[tauri::command]
async fn update_postgres_experiment_source_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentSourceRequest,
) -> Result<PostgresExperimentSource, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = request.source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    let source_kind = normalize_postgres_experiment_source_kind(&request.source_kind)
        .ok_or_else(|| "Source type must be text, pdf, image, audio, or video.".to_string())?
        .to_string();

    let title = request.title.trim().to_string();
    if title.is_empty() {
        return Err("Source title is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let original_file_name = request.original_file_name.unwrap_or_default().trim().to_string();
    let storage_path = request.storage_path.unwrap_or_default().trim().to_string();
    let structured_content_json = request.structured_content_json.unwrap_or_default();
    let waveform_peaks_json = request.waveform_peaks_json.unwrap_or_default();
    let video_frame_index_json = request.video_frame_index_json.unwrap_or_default();
    let extracted_from_video_source_id = request.extracted_from_video_source_id.unwrap_or_default().trim().to_string();
    let extracted_from_video_time_ms = request.extracted_from_video_time_ms;
    let notes = request.notes.unwrap_or_default();
    let updated_count = client
        .execute(
            "
            UPDATE sources
            SET source_kind = $2,
                title = $3,
                original_file_name = $4,
                storage_path = $5,
                text_content = $6,
                structured_content_json = $7,
                waveform_peaks_json = $8,
                video_frame_index_json = $9,
                extracted_from_video_source_id = $10,
                extracted_from_video_time_ms = $11,
                notes = $12,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[
                &source_id,
                &source_kind,
                &title,
                &original_file_name,
                &storage_path,
                &request.text_content,
                &structured_content_json,
                &waveform_peaks_json,
                &video_frame_index_json,
                &extracted_from_video_source_id,
                &extracted_from_video_time_ms,
                &notes,
            ],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment source: {e}"))?;

    if updated_count == 0 {
        connection_task.abort();
        return Err("The selected source could not be found.".to_string());
    }
    sync_postgres_experiment_source_object_for_client(&client, &source_id, &source_kind, &title, &notes).await?;

    let source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document.update",
        &format!("Updated source \"{}\"", source.title),
        Some(&source.id),
        Some(serde_json::json!({
            "name": source.title,
            "changedFields": ["source_kind", "title", "original_file_name", "storage_path", "text_content", "structured_content_json", "waveform_peaks_json", "video_frame_index_json", "extracted_from_video_source_id", "extracted_from_video_time_ms", "notes"],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source", &source_id, "updated");
    connection_task.abort();
    Ok(source)
}

#[tauri::command]
async fn delete_postgres_experiment_source_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    source_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    client
        .execute("DELETE FROM research_objects WHERE source_id = $1", &[&source_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment source-backed object: {e}"))?;
    let deleted_count = client
        .execute("DELETE FROM sources WHERE id = $1", &[&source_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment source: {e}"))?;

    if deleted_count == 0 {
        connection_task.abort();
        return Err("The selected source could not be found.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document.delete",
        &format!("Deleted source \"{}\"", deleted_source.title),
        Some(&source_id),
        Some(serde_json::json!({
            "name": deleted_source.title,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source", &source_id, "deleted");
    connection_task.abort();
    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_source_locks_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSourceLock>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let now_ms = current_time_ms() as i64;
    delete_expired_postgres_experiment_source_locks_for_client(&*client, now_ms).await?;
    let locks = load_postgres_experiment_source_locks_for_client(&client, now_ms).await?;
    connection_task.abort();
    Ok(locks)
}

#[tauri::command]
async fn acquire_postgres_experiment_source_lock_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: AcquirePostgresExperimentSourceLockRequest,
) -> Result<AcquirePostgresExperimentSourceLockResult, String> {
    const SOURCE_LOCK_LEASE_MS: i64 = 45_000;

    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = request.source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session =
        require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let _source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    let now_ms = current_time_ms() as i64;
    let lease_expires_at = now_ms + SOURCE_LOCK_LEASE_MS;

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment source lock sync: {e}"))?;

    delete_expired_postgres_experiment_source_locks_for_client(&tx, now_ms).await?;

    if let Some(kick_row) = tx
        .query_opt(
            "
            SELECT id, kicked_by_user_id, kicked_by_name, expires_at_ms
            FROM source_lock_kicks
            WHERE source_id = $1 AND user_id = $2 AND expires_at_ms > $3
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            ",
            &[&source_id, &session.user.id, &now_ms],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source lock kicks: {e}"))?
    {
        tx.rollback()
            .await
            .map_err(|e| format!("Could not roll back PostgreSQL experiment source lock sync: {e}"))?;
        connection_task.abort();
        return Ok(AcquirePostgresExperimentSourceLockResult {
            ok: false,
            lock: None,
            conflict: Some(PostgresExperimentSourceLock {
                id: kick_row.get(0),
                source_id,
                user_id: kick_row.get(1),
                user_name: kick_row.get(2),
                expires_at_ms: kick_row.get(3),
                created_at: String::new(),
                updated_at: String::new(),
                reason: Some("kicked".to_string()),
            }),
        });
    }

    if let Some(lock_row) = tx
        .query_opt(
            "
            SELECT id, user_id, user_name, expires_at_ms, created_at::text, updated_at::text
            FROM source_locks
            WHERE source_id = $1 AND expires_at_ms > $2
            LIMIT 1
            ",
            &[&source_id, &now_ms],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source locks: {e}"))?
    {
        let lock_id = lock_row.get::<usize, String>(0);
        let lock_user_id = lock_row.get::<usize, String>(1);
        let created_at = lock_row.get::<usize, String>(4);
        if lock_user_id != session.user.id {
            let user_name = lock_row.get::<usize, String>(2);
            let expires_at_ms = lock_row.get::<usize, i64>(3);
            let updated_at = lock_row.get::<usize, String>(5);
            tx.rollback()
                .await
                .map_err(|e| format!("Could not roll back PostgreSQL experiment source lock sync: {e}"))?;
            connection_task.abort();
            return Ok(AcquirePostgresExperimentSourceLockResult {
                ok: false,
                lock: None,
                conflict: Some(PostgresExperimentSourceLock {
                    id: lock_id,
                    source_id,
                    user_id: lock_user_id,
                    user_name,
                    expires_at_ms,
                    created_at,
                    updated_at,
                    reason: Some("locked".to_string()),
                }),
            });
        }

        let updated_row = tx
            .query_one(
                "
                UPDATE source_locks
                SET user_name = $2,
                    expires_at_ms = $3,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id, source_id, user_id, user_name, expires_at_ms, created_at::text, updated_at::text
                ",
                &[&lock_id, &session.user.name, &lease_expires_at],
            )
            .await
            .map_err(|e| format!("Could not refresh PostgreSQL experiment source lock: {e}"))?;
        tx.commit()
            .await
            .map_err(|e| format!("Could not commit PostgreSQL experiment source lock sync: {e}"))?;
        connection_task.abort();
        let lock = PostgresExperimentSourceLock {
            id: updated_row.get(0),
            source_id: updated_row.get(1),
            user_id: updated_row.get(2),
            user_name: updated_row.get(3),
            expires_at_ms: updated_row.get(4),
            created_at: updated_row.get(5),
            updated_at: updated_row.get(6),
            reason: None,
        };
        emit_postgres_experiment_project_change(&app, &project_id, "source_lock", &lock.id, "updated");
        return Ok(AcquirePostgresExperimentSourceLockResult {
            ok: true,
            lock: Some(lock),
            conflict: None,
        });
    }

    let lock_id = generate_identifier();
    let created_row = tx
        .query_one(
            "
            INSERT INTO source_locks (id, source_id, user_id, user_name, expires_at_ms)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, source_id, user_id, user_name, expires_at_ms, created_at::text, updated_at::text
            ",
            &[&lock_id, &source_id, &session.user.id, &session.user.name, &lease_expires_at],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source lock: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment source lock sync: {e}"))?;
    connection_task.abort();
    let lock = PostgresExperimentSourceLock {
        id: created_row.get(0),
        source_id: created_row.get(1),
        user_id: created_row.get(2),
        user_name: created_row.get(3),
        expires_at_ms: created_row.get(4),
        created_at: created_row.get(5),
        updated_at: created_row.get(6),
        reason: None,
    };
    emit_postgres_experiment_project_change(&app, &project_id, "source_lock", &lock.id, "created");
    Ok(AcquirePostgresExperimentSourceLockResult {
        ok: true,
        lock: Some(lock),
        conflict: None,
    })
}

#[tauri::command]
async fn release_postgres_experiment_source_lock_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    lock_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let lock_id = lock_id.trim().to_string();
    if lock_id.is_empty() {
        return Err("Source lock id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session =
        require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    client
        .execute(
            "
            DELETE FROM source_locks
            WHERE id = $1 AND user_id = $2
            ",
            &[&lock_id, &session.user.id],
        )
        .await
        .map_err(|e| format!("Could not release PostgreSQL experiment source lock: {e}"))?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "source_lock", &lock_id, "deleted");
    Ok(())
}

#[tauri::command]
async fn kick_postgres_experiment_source_lock_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: KickPostgresExperimentSourceLockRequest,
) -> Result<(), String> {
    const SOURCE_LOCK_KICK_WINDOW_MS: i64 = 120_000;

    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = request.source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    let lock_id = request.lock_id.trim().to_string();
    if lock_id.is_empty() {
        return Err("Source lock id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let _source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    let now_ms = current_time_ms() as i64;
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment source lock removal: {e}"))?;

    delete_expired_postgres_experiment_source_locks_for_client(&tx, now_ms).await?;

    let Some(lock_row) = tx
        .query_opt(
            "
            SELECT user_id
            FROM source_locks
            WHERE id = $1 AND source_id = $2 AND expires_at_ms > $3
            ",
            &[&lock_id, &source_id, &now_ms],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source lock before removal: {e}"))?
    else {
        tx.rollback()
            .await
            .map_err(|e| format!("Could not roll back PostgreSQL experiment source lock removal: {e}"))?;
        connection_task.abort();
        return Ok(());
    };

    let locked_user_id = lock_row.get::<usize, String>(0);
    tx.execute(
        "
        DELETE FROM source_lock_kicks
        WHERE source_id = $1 AND user_id = $2
        ",
        &[&source_id, &locked_user_id],
    )
    .await
    .map_err(|e| format!("Could not clear existing PostgreSQL experiment source lock kicks: {e}"))?;
    tx.execute(
        "
        INSERT INTO source_lock_kicks (id, source_id, user_id, kicked_by_user_id, kicked_by_name, expires_at_ms)
        VALUES ($1, $2, $3, $4, $5, $6)
        ",
        &[
            &generate_identifier(),
            &source_id,
            &locked_user_id,
            &session.user.id,
            &session.user.name,
            &(now_ms + SOURCE_LOCK_KICK_WINDOW_MS),
        ],
    )
    .await
    .map_err(|e| format!("Could not create PostgreSQL experiment source lock kick: {e}"))?;
    tx.execute(
        "
        DELETE FROM source_locks
        WHERE id = $1
        ",
        &[&lock_id],
    )
    .await
    .map_err(|e| format!("Could not remove PostgreSQL experiment source lock: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment source lock removal: {e}"))?;
    connection_task.abort();

    emit_postgres_experiment_project_change(&app, &project_id, "source_lock", &lock_id, "deleted");
    emit_postgres_experiment_project_change(&app, &project_id, "source_lock_kick", &source_id, "created");
    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_source_object_links_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSourceObjectLink>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let links = load_postgres_experiment_source_object_links_for_client(&client).await?;
    connection_task.abort();
    Ok(links)
}

#[tauri::command]
async fn set_postgres_experiment_source_objects_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SetPostgresExperimentSourceObjectsRequest,
) -> Result<Vec<PostgresExperimentSourceObjectLink>, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = request.source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    let mut object_ids = request
        .object_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    object_ids.sort();
    object_ids.dedup();

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    let source_backing_object_id = client
        .query_opt(
            "
            SELECT id
            FROM research_objects
            WHERE source_id = $1
            ",
            &[&source_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source-backed object: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    if let Some(backing_object_id) = source_backing_object_id {
        object_ids.retain(|object_id| object_id != &backing_object_id);
    }

    if !object_ids.is_empty() {
        let rows = client
            .query(
                "
                SELECT id
                FROM research_objects
                WHERE id = ANY($1)
                ",
                &[&object_ids],
            )
            .await
            .map_err(|e| format!("Could not validate PostgreSQL experiment source-object associations: {e}"))?;
        let existing_ids = rows
            .into_iter()
            .map(|row| row.get::<_, String>(0))
            .collect::<HashSet<_>>();
        if existing_ids.len() != object_ids.len() {
            connection_task.abort();
            return Err("One or more selected objects could not be found.".to_string());
        }
    }

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment source-object update: {e}"))?;

    tx.execute(
        "
        DELETE FROM source_objects
        WHERE source_id = $1
        ",
        &[&source_id],
    )
    .await
    .map_err(|e| format!("Could not clear PostgreSQL experiment source-object associations: {e}"))?;

    for object_id in &object_ids {
        tx.execute(
            "
            INSERT INTO source_objects (source_id, object_id)
            VALUES ($1, $2)
            ",
            &[&source_id, object_id],
        )
        .await
        .map_err(|e| format!("Could not save PostgreSQL experiment source-object association: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment source-object update: {e}"))?;

    let links = load_postgres_experiment_source_object_links_for_client(&client)
        .await?
        .into_iter()
        .filter(|link| link.source_id == source_id)
        .collect::<Vec<_>>();
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document.associations",
        &format!("Updated source associations for \"{}\"", source.title),
        Some(&source.id),
        Some(serde_json::json!({
            "name": source.title,
            "addedCount": links.len(),
            "removedCount": 0,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source_object", &source_id, "updated");
    connection_task.abort();
    Ok(links)
}

#[tauri::command]
async fn list_postgres_experiment_source_attribute_definitions_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSourceAttributeDefinition>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let definitions = load_postgres_experiment_source_attribute_definitions_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(definitions)
}

#[tauri::command]
async fn list_postgres_experiment_source_attribute_values_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentSourceAttributeValue>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let values = load_postgres_experiment_source_attribute_values_for_client(&client).await?;
    connection_task.abort();
    Ok(values)
}

#[tauri::command]
async fn save_postgres_experiment_source_attribute_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentSourceAttributeRequest,
) -> Result<SavePostgresExperimentSourceAttributeResult, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("Source attribute name is required.".to_string());
    }

    let data_type = normalize_postgres_experiment_attribute_data_type(&request.data_type)
        .ok_or_else(|| "Choose a valid source attribute data type.".to_string())?
        .to_string();
    let description = request.description.trim().to_string();
    let options = normalize_attribute_options(&request.options);

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment source attribute save: {e}"))?;

    let attribute_definition_id = request
        .attribute_definition_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(generate_identifier);
    let created = request
        .attribute_definition_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none();
    let options_json = serde_json::to_string(&options)
        .map_err(|e| format!("Could not serialize PostgreSQL experiment source attribute options: {e}"))?;

    if created {
        let next_sort_order = tx
            .query_one(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM source_attribute_definitions",
                &[],
            )
            .await
            .map_err(|e| format!("Could not prepare PostgreSQL experiment source attribute sort order: {e}"))?
            .get::<usize, i32>(0);
        tx.execute(
            "
            INSERT INTO source_attribute_definitions (id, name, data_type, description, options_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
            ",
            &[&attribute_definition_id, &name, &data_type, &description, &options_json, &next_sort_order],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment source attribute: {e}"))?;
    } else {
        let updated_count = tx
            .execute(
                "
                UPDATE source_attribute_definitions
                SET name = $2,
                    data_type = $3,
                    description = $4,
                    options_json = $5,
                    updated_at = NOW()
                WHERE id = $1
                ",
                &[&attribute_definition_id, &name, &data_type, &description, &options_json],
            )
            .await
            .map_err(|e| format!("Could not update PostgreSQL experiment source attribute: {e}"))?;
        if updated_count == 0 {
            connection_task.abort();
            return Err("The selected source attribute could not be found.".to_string());
        }
    }

    let source_rows = tx
        .query("SELECT id FROM sources", &[])
        .await
        .map_err(|e| format!("Could not validate PostgreSQL experiment source attribute values: {e}"))?;
    let valid_source_ids = source_rows
        .into_iter()
        .map(|row| row.get::<usize, String>(0))
        .collect::<HashSet<_>>();

    let existing_rows = tx
        .query(
            "
            SELECT id, source_id
            FROM source_attribute_values
            WHERE attribute_definition_id = $1
            ",
            &[&attribute_definition_id],
        )
        .await
        .map_err(|e| format!("Could not load existing PostgreSQL experiment source attribute values: {e}"))?;
    let mut existing_value_ids_by_source_id: HashMap<String, String> = HashMap::new();
    for row in existing_rows {
        existing_value_ids_by_source_id.insert(row.get(1), row.get(0));
    }

    let mut seen_source_ids = HashSet::new();
    for input in &request.values {
        let source_id = input.source_id.trim().to_string();
        if source_id.is_empty() {
            return Err("Each source attribute value must include a source id.".to_string());
        }
        if !seen_source_ids.insert(source_id.clone()) {
            return Err("Each source attribute can only appear once per source in a save request.".to_string());
        }
        if !valid_source_ids.contains(&source_id) {
            return Err("One or more sources no longer exist in this project.".to_string());
        }

        let value = input.value.trim().to_string();
        if data_type == "categorical" && !value.is_empty() && !options.iter().any(|option| option == &value) {
            return Err(format!("Choose one of the allowed values for source attribute \"{name}\"."));
        }

        if let Some(existing_value_id) = existing_value_ids_by_source_id.get(&source_id) {
            if value.is_empty() {
                tx.execute(
                    "DELETE FROM source_attribute_values WHERE id = $1",
                    &[existing_value_id],
                )
                .await
                .map_err(|e| format!("Could not clear PostgreSQL experiment source attribute value: {e}"))?;
            } else {
                tx.execute(
                    "
                    UPDATE source_attribute_values
                    SET value = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    ",
                    &[existing_value_id, &value],
                )
                .await
                .map_err(|e| format!("Could not update PostgreSQL experiment source attribute value: {e}"))?;
            }
        } else if !value.is_empty() {
            tx.execute(
                "
                INSERT INTO source_attribute_values (id, source_id, attribute_definition_id, value)
                VALUES ($1, $2, $3, $4)
                ",
                &[&generate_identifier(), &source_id, &attribute_definition_id, &value],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment source attribute value: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment source attribute save: {e}"))?;

    let definition = load_postgres_experiment_source_attribute_definitions_for_client(&client, &project_id)
        .await?
        .into_iter()
        .find(|definition| definition.id == attribute_definition_id)
        .ok_or_else(|| "The saved source attribute could not be reloaded.".to_string())?;
    let values = load_postgres_experiment_source_attribute_values_for_client(&client)
        .await?
        .into_iter()
        .filter(|value| value.attribute_definition_id == attribute_definition_id)
        .collect::<Vec<_>>();
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "document_attribute.create" } else { "document_attribute.update" },
        &format!("Saved source attribute \"{}\"", definition.name),
        Some(&attribute_definition_id),
        Some(serde_json::json!({
            "name": definition.name.clone(),
            "attributeName": definition.name.clone(),
            "changedValueCount": values.len(),
        })),
    ).await?;

    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "source_attribute_definition",
        &attribute_definition_id,
        if created { "created" } else { "updated" },
    );
    emit_postgres_experiment_project_change(&app, &project_id, "source_attribute_value", &attribute_definition_id, "updated");
    connection_task.abort();

    Ok(SavePostgresExperimentSourceAttributeResult {
        attribute_definition: definition,
        values,
    })
}

#[tauri::command]
async fn delete_postgres_experiment_source_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    attribute_definition_id: String,
) -> Result<DeletePostgresExperimentSourceAttributeDefinitionResult, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let attribute_definition_id = attribute_definition_id.trim().to_string();
    if attribute_definition_id.is_empty() {
        return Err("Source attribute definition id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_source_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_name = client
        .query_opt(
            "SELECT name FROM source_attribute_definitions WHERE id = $1",
            &[&attribute_definition_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment source attribute before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    let deleted_count = client
        .execute(
            "DELETE FROM source_attribute_definitions WHERE id = $1",
            &[&attribute_definition_id],
        )
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment source attribute: {e}"))?;

    if deleted_count == 0 {
        connection_task.abort();
        return Err("The selected source attribute could not be found.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "document_attribute.delete",
        "Deleted a source attribute",
        Some(&attribute_definition_id),
        Some(serde_json::json!({
            "name": deleted_name.clone(),
            "attributeName": deleted_name.clone(),
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "source_attribute_definition", &attribute_definition_id, "deleted");
    connection_task.abort();
    Ok(DeletePostgresExperimentSourceAttributeDefinitionResult {
        project_id,
        attribute_definition_id,
    })
}

#[tauri::command]
async fn list_postgres_experiment_annotation_summaries_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentAnnotationSummary>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let annotations = load_postgres_experiment_annotation_summaries_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(annotations)
}

#[tauri::command]
async fn list_postgres_experiment_codes_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentCode>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let codes = load_postgres_experiment_codes_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(codes)
}

#[tauri::command]
async fn create_postgres_experiment_code_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentCodeRequest,
) -> Result<PostgresExperimentCode, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let label = request.label.trim().to_string();
    if label.is_empty() {
        return Err("Code label is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_code_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let color = request.color.unwrap_or_else(|| "#6366f1".to_string()).trim().to_string();
    let description = request.description.unwrap_or_default();
    let shortcut = request.shortcut.unwrap_or_default().trim().to_string();
    let parent_code_id = request.parent_code_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    validate_postgres_experiment_code_parent_for_client(&client, None, parent_code_id.as_deref()).await?;

    let code_id = generate_identifier();
    client
        .execute(
            "
            INSERT INTO codes (id, parent_code_id, label, description, color, shortcut, sort_order)
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                COALESCE((SELECT MAX(sort_order) + 1 FROM codes), 0)
            )
            ",
            &[&code_id, &parent_code_id, &label, &description, &color, &shortcut],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment code: {e}"))?;

    let code = load_postgres_experiment_code_for_client(&client, &project_id, &code_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "code.create",
        &format!("Added code \"{}\"", code.label),
        Some(&code.id),
        Some(serde_json::json!({
            "label": code.label,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "code", &code_id, "created");
    connection_task.abort();
    Ok(code)
}

#[tauri::command]
async fn update_postgres_experiment_code_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentCodeRequest,
) -> Result<PostgresExperimentCode, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let code_id = request.code_id.trim().to_string();
    if code_id.is_empty() {
        return Err("Code id is required.".to_string());
    }

    let label = request.label.trim().to_string();
    if label.is_empty() {
        return Err("Code label is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_code_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let color = request.color.unwrap_or_else(|| "#6366f1".to_string()).trim().to_string();
    let description = request.description.unwrap_or_default();
    let shortcut = request.shortcut.unwrap_or_default().trim().to_string();
    let parent_code_id = request.parent_code_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    validate_postgres_experiment_code_parent_for_client(&client, Some(&code_id), parent_code_id.as_deref()).await?;

    let updated_count = client
        .execute(
            "
            UPDATE codes
            SET parent_code_id = $2,
                label = $3,
                description = $4,
                color = $5,
                shortcut = $6,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[&code_id, &parent_code_id, &label, &description, &color, &shortcut],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment code: {e}"))?;

    if updated_count == 0 {
        connection_task.abort();
        return Err("The selected code could not be found.".to_string());
    }

    let code = load_postgres_experiment_code_for_client(&client, &project_id, &code_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "code.update",
        &format!("Updated code \"{}\"", code.label),
        Some(&code.id),
        Some(serde_json::json!({
            "label": code.label,
            "changedFields": ["parent_code_id", "label", "description", "color", "shortcut"],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "code", &code_id, "updated");
    connection_task.abort();
    Ok(code)
}

#[tauri::command]
async fn delete_postgres_experiment_code_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    code_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let code_id = code_id.trim().to_string();
    if code_id.is_empty() {
        return Err("Code id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_code_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_label = client
        .query_opt("SELECT label FROM codes WHERE id = $1", &[&code_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment code before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));

    let deleted_count = client
        .execute("DELETE FROM codes WHERE id = $1", &[&code_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment code: {e}"))?;

    if deleted_count == 0 {
        connection_task.abort();
        return Err("The selected code could not be found.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "code.delete",
        "Deleted a code",
        Some(&code_id),
        Some(serde_json::json!({
            "label": deleted_label,
        })),
    ).await?;
emit_postgres_experiment_project_change(&app, &project_id, "code", &code_id, "deleted");
    connection_task.abort();
    Ok(())
}

#[tauri::command]
async fn create_postgres_experiment_annotation_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentAnnotationRequest,
) -> Result<PostgresExperimentAnnotationSummary, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let source_id = request.source_id.trim().to_string();
    if source_id.is_empty() {
        return Err("Source id is required.".to_string());
    }

    if let (Some(start_offset), Some(end_offset)) = (request.start_offset, request.end_offset) {
        if end_offset < start_offset {
            return Err("Annotation end offset must be greater than or equal to the start offset.".to_string());
        }
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let code_ids = normalize_postgres_experiment_identifier_list(request.code_ids);
    validate_postgres_experiment_annotation_code_ids_for_client(&client, &code_ids).await?;
    let _source = load_postgres_experiment_source_for_client(&client, &project_id, &source_id).await?;
    let created_by_project_user_id = resolve_postgres_experiment_project_user_id_for_email(&client, &session.user.email).await?;
    let annotation_id = generate_identifier();
    let anchor_kind = request.anchor_kind.unwrap_or_else(|| "text_span".to_string()).trim().to_string();
    validate_postgres_experiment_annotation_time_range(request.time_start_ms, request.time_end_ms)?;
    let quote = request.quote.unwrap_or_default();
    let note = request.note.unwrap_or_default();
    let image_region = request.image_region.clone();
    if anchor_kind == "image_rect" {
        let region = image_region
            .as_ref()
            .ok_or_else(|| "Image annotations require a saved image region.".to_string())?;
        validate_postgres_experiment_annotation_image_region(region)?;
    }
    let region_selector_json = serialize_postgres_experiment_annotation_image_region(
        if anchor_kind == "image_rect" {
            image_region.as_ref()
        } else {
            None
        },
    )?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment annotation transaction: {e}"))?;
    transaction
        .execute(
            "
            INSERT INTO annotations (
                id,
                source_id,
                anchor_kind,
                start_offset,
                end_offset,
                time_start_ms,
                time_end_ms,
                quote,
                note,
                region_selector_json,
                created_by_project_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ",
            &[
                &annotation_id,
                &source_id,
                &anchor_kind,
                &request.start_offset,
                &request.end_offset,
                &request.time_start_ms,
                &request.time_end_ms,
                &quote,
                &note,
                &region_selector_json,
                &created_by_project_user_id,
            ],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment annotation: {e}"))?;
    for code_id in &code_ids {
        transaction
            .execute(
                "INSERT INTO annotation_codes (annotation_id, code_id) VALUES ($1, $2)",
                &[&annotation_id, code_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment annotation-code link: {e}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment annotation: {e}"))?;

    let annotation = load_postgres_experiment_annotation_summary_for_client(&client, &project_id, &annotation_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "annotation.create",
        "Added an annotation",
        Some(&annotation.id),
        Some(serde_json::json!({
            "quote": annotation.quote,
            "codeCount": annotation.code_ids.len(),
            "timeStartMs": annotation.time_start_ms,
            "timeEndMs": annotation.time_end_ms,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "annotation", &annotation_id, "created");
    connection_task.abort();
    Ok(annotation)
}

#[tauri::command]
async fn update_postgres_experiment_annotation_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentAnnotationRequest,
) -> Result<PostgresExperimentAnnotationSummary, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let annotation_id = request.annotation_id.trim().to_string();
    if annotation_id.is_empty() {
        return Err("Annotation id is required.".to_string());
    }

    if let (Some(start_offset), Some(end_offset)) = (request.start_offset, request.end_offset) {
        if end_offset < start_offset {
            return Err("Annotation end offset must be greater than or equal to the start offset.".to_string());
        }
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let code_ids = normalize_postgres_experiment_identifier_list(request.code_ids);
    validate_postgres_experiment_annotation_code_ids_for_client(&client, &code_ids).await?;
    let anchor_kind = request.anchor_kind.unwrap_or_else(|| "text_span".to_string()).trim().to_string();
    validate_postgres_experiment_annotation_time_range(request.time_start_ms, request.time_end_ms)?;
    let quote = request.quote.unwrap_or_default();
    let note = request.note.unwrap_or_default();
    let image_region = request.image_region.clone();
    if anchor_kind == "image_rect" {
        let region = image_region
            .as_ref()
            .ok_or_else(|| "Image annotations require a saved image region.".to_string())?;
        validate_postgres_experiment_annotation_image_region(region)?;
    }
    let region_selector_json = serialize_postgres_experiment_annotation_image_region(
        if anchor_kind == "image_rect" {
            image_region.as_ref()
        } else {
            None
        },
    )?;

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment annotation transaction: {e}"))?;
    let updated_count = transaction
        .execute(
            "
            UPDATE annotations
            SET anchor_kind = $2,
                start_offset = $3,
                end_offset = $4,
                time_start_ms = $5,
                time_end_ms = $6,
                quote = $7,
                note = $8,
                region_selector_json = $9,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[
                &annotation_id,
                &anchor_kind,
                &request.start_offset,
                &request.end_offset,
                &request.time_start_ms,
                &request.time_end_ms,
                &quote,
                &note,
                &region_selector_json,
            ],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment annotation: {e}"))?;
    if updated_count == 0 {
        connection_task.abort();
        return Err("The selected annotation could not be found.".to_string());
    }
    transaction
        .execute("DELETE FROM annotation_codes WHERE annotation_id = $1", &[&annotation_id])
        .await
        .map_err(|e| format!("Could not replace PostgreSQL experiment annotation codes: {e}"))?;
    for code_id in &code_ids {
        transaction
            .execute(
                "INSERT INTO annotation_codes (annotation_id, code_id) VALUES ($1, $2)",
                &[&annotation_id, code_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment annotation-code link: {e}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment annotation update: {e}"))?;

    let annotation = load_postgres_experiment_annotation_summary_for_client(&client, &project_id, &annotation_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "annotation.update",
        "Updated an annotation",
        Some(&annotation.id),
        Some(serde_json::json!({
            "quote": annotation.quote,
            "timeStartMs": annotation.time_start_ms,
            "timeEndMs": annotation.time_end_ms,
            "changedFields": ["anchor_kind", "start_offset", "end_offset", "time_start_ms", "time_end_ms", "quote", "note", "code_ids"],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "annotation", &annotation_id, "updated");
    connection_task.abort();
    Ok(annotation)
}

#[tauri::command]
async fn delete_postgres_experiment_annotation_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    annotation_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let annotation_id = annotation_id.trim().to_string();
    if annotation_id.is_empty() {
        return Err("Annotation id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_quote = client
        .query_opt("SELECT quote FROM annotations WHERE id = $1", &[&annotation_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment annotation before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    let deleted_count = client
        .execute("DELETE FROM annotations WHERE id = $1", &[&annotation_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment annotation: {e}"))?;

    if deleted_count == 0 {
        connection_task.abort();
        return Err("The selected annotation could not be found.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "annotation.delete",
        "Deleted an annotation",
        Some(&annotation_id),
        Some(serde_json::json!({
            "quote": deleted_quote,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "annotation", &annotation_id, "deleted");
    connection_task.abort();
    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_project_log_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentProjectLogEntry>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let entries = load_postgres_experiment_project_log_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(entries)
}

#[tauri::command]
async fn list_postgres_experiment_memos_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentMemo>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let memos = load_postgres_experiment_memos_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(memos)
}

#[tauri::command]
async fn create_postgres_experiment_memo_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentMemoRequest,
) -> Result<PostgresExperimentMemo, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let title = request.title.trim().to_string();
    if title.is_empty() {
        return Err("Memo title is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let source_ids = normalize_postgres_experiment_identifier_list(request.source_ids);
    let annotation_ids = normalize_postgres_experiment_identifier_list(request.annotation_ids);
    let code_ids = normalize_postgres_experiment_identifier_list(request.code_ids);
    let object_ids = normalize_postgres_experiment_identifier_list(request.object_ids);
    validate_postgres_experiment_source_ids_for_client(&client, &source_ids).await?;
    validate_postgres_experiment_annotation_ids_for_client(&client, &annotation_ids).await?;
    if !code_ids.is_empty() {
        validate_postgres_experiment_annotation_code_ids_for_client(&client, &code_ids).await?;
    }
    validate_postgres_experiment_object_ids_for_client(&client, &object_ids).await?;
    let created_by_project_user_id = resolve_postgres_experiment_project_user_id_for_email(&client, &session.user.email).await?;
    let memo_id = generate_identifier();
    let body = request.body.unwrap_or_default();

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment memo transaction: {e}"))?;
    transaction
        .execute(
            "
            INSERT INTO memos (id, title, body, created_by_project_user_id)
            VALUES ($1, $2, $3, $4)
            ",
            &[&memo_id, &title, &body, &created_by_project_user_id],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment memo: {e}"))?;
    for source_id in &source_ids {
        transaction
            .execute(
                "INSERT INTO memo_sources (memo_id, source_id) VALUES ($1, $2)",
                &[&memo_id, source_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-source link: {e}"))?;
    }
    for annotation_id in &annotation_ids {
        transaction
            .execute(
                "INSERT INTO memo_annotations (memo_id, annotation_id) VALUES ($1, $2)",
                &[&memo_id, annotation_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-annotation link: {e}"))?;
    }
    for code_id in &code_ids {
        transaction
            .execute(
                "INSERT INTO memo_codes (memo_id, code_id) VALUES ($1, $2)",
                &[&memo_id, code_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-code link: {e}"))?;
    }
    for object_id in &object_ids {
        transaction
            .execute(
                "INSERT INTO memo_objects (memo_id, object_id) VALUES ($1, $2)",
                &[&memo_id, object_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-object link: {e}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment memo: {e}"))?;

    let memo = load_postgres_experiment_memo_for_client(&client, &project_id, &memo_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "memo.create",
        &format!("Created memo \"{}\"", memo.title),
        Some(&memo.id),
        Some(serde_json::json!({
            "title": memo.title,
            "documentCount": memo.source_ids.len(),
            "codeCount": memo.code_ids.len(),
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "memo", &memo_id, "created");
    connection_task.abort();
    Ok(memo)
}

#[tauri::command]
async fn update_postgres_experiment_memo_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentMemoRequest,
) -> Result<PostgresExperimentMemo, String> {
    let project_id = request.project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let memo_id = request.memo_id.trim().to_string();
    if memo_id.is_empty() {
        return Err("Memo id is required.".to_string());
    }

    let title = request.title.trim().to_string();
    if title.is_empty() {
        return Err("Memo title is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;

    let source_ids = normalize_postgres_experiment_identifier_list(request.source_ids);
    let annotation_ids = normalize_postgres_experiment_identifier_list(request.annotation_ids);
    let code_ids = normalize_postgres_experiment_identifier_list(request.code_ids);
    let object_ids = normalize_postgres_experiment_identifier_list(request.object_ids);
    validate_postgres_experiment_source_ids_for_client(&client, &source_ids).await?;
    validate_postgres_experiment_annotation_ids_for_client(&client, &annotation_ids).await?;
    if !code_ids.is_empty() {
        validate_postgres_experiment_annotation_code_ids_for_client(&client, &code_ids).await?;
    }
    validate_postgres_experiment_object_ids_for_client(&client, &object_ids).await?;
    let body = request.body.unwrap_or_default();

    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("Could not start PostgreSQL experiment memo transaction: {e}"))?;
    let updated_count = transaction
        .execute(
            "
            UPDATE memos
            SET title = $2,
                body = $3,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[&memo_id, &title, &body],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment memo: {e}"))?;
    if updated_count == 0 {
        connection_task.abort();
        return Err("The selected memo could not be found.".to_string());
    }
    transaction
        .execute("DELETE FROM memo_sources WHERE memo_id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not replace PostgreSQL experiment memo sources: {e}"))?;
    transaction
        .execute("DELETE FROM memo_annotations WHERE memo_id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not replace PostgreSQL experiment memo annotations: {e}"))?;
    transaction
        .execute("DELETE FROM memo_codes WHERE memo_id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not replace PostgreSQL experiment memo codes: {e}"))?;
    transaction
        .execute("DELETE FROM memo_objects WHERE memo_id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not replace PostgreSQL experiment memo objects: {e}"))?;
    for source_id in &source_ids {
        transaction
            .execute(
                "INSERT INTO memo_sources (memo_id, source_id) VALUES ($1, $2)",
                &[&memo_id, source_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-source link: {e}"))?;
    }
    for annotation_id in &annotation_ids {
        transaction
            .execute(
                "INSERT INTO memo_annotations (memo_id, annotation_id) VALUES ($1, $2)",
                &[&memo_id, annotation_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-annotation link: {e}"))?;
    }
    for code_id in &code_ids {
        transaction
            .execute(
                "INSERT INTO memo_codes (memo_id, code_id) VALUES ($1, $2)",
                &[&memo_id, code_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-code link: {e}"))?;
    }
    for object_id in &object_ids {
        transaction
            .execute(
                "INSERT INTO memo_objects (memo_id, object_id) VALUES ($1, $2)",
                &[&memo_id, object_id],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment memo-object link: {e}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment memo update: {e}"))?;

    let memo = load_postgres_experiment_memo_for_client(&client, &project_id, &memo_id).await?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "memo.update",
        &format!("Updated memo \"{}\"", memo.title),
        Some(&memo.id),
        Some(serde_json::json!({
            "title": memo.title,
            "changedFields": ["title", "body", "source_ids", "annotation_ids", "code_ids", "object_ids"],
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "memo", &memo_id, "updated");
    connection_task.abort();
    Ok(memo)
}

#[tauri::command]
async fn delete_postgres_experiment_memo_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    memo_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let memo_id = memo_id.trim().to_string();
    if memo_id.is_empty() {
        return Err("Memo id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_annotation_management(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_title = client
        .query_opt("SELECT title FROM memos WHERE id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment memo before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    let deleted_count = client
        .execute("DELETE FROM memos WHERE id = $1", &[&memo_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment memo: {e}"))?;

    if deleted_count == 0 {
        connection_task.abort();
        return Err("The selected memo could not be found.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "memo.delete",
        "Deleted a memo",
        Some(&memo_id),
        Some(serde_json::json!({
            "title": deleted_title,
        })),
    ).await?;
    emit_postgres_experiment_project_change(&app, &project_id, "memo", &memo_id, "deleted");
    connection_task.abort();
    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_object_types_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentObjectType>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let object_types = load_postgres_experiment_object_types_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(object_types)
}

#[tauri::command]
async fn create_postgres_experiment_object_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentObjectTypeRequest,
) -> Result<PostgresExperimentObjectType, String> {
    let project_id = request.project_id.trim().to_string();
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let shape = request.shape.trim().to_string();
    let color = request.color.trim().to_string();
    let fill = request.fill.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if name.is_empty() {
        return Err("Enter an object type name.".to_string());
    }
    if shape.is_empty() {
        return Err("Choose an object type shape.".to_string());
    }
    if color.is_empty() {
        return Err("Choose an object type color.".to_string());
    }
    if fill.is_empty() {
        return Err("Choose an object type fill style.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    if let Some((_, existing_name)) = find_postgres_experiment_object_type_for_client(&client, &name).await? {
        connection_task.abort();
        return Err(format!("The object type \"{existing_name}\" already exists."));
    }
    let object_type_id = generate_identifier();
    let row = client
        .query_one(
            "
            INSERT INTO object_types (id, name, description, shape, color, fill)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, system_key, name, description, shape, color, fill, created_at::text, updated_at::text
            ",
            &[&object_type_id, &name, &description, &shape, &color, &fill],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment object type: {e}"))?;
    connection_task.abort();
    let created = map_postgres_experiment_object_type_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "object_type", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_object_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentObjectTypeRequest,
) -> Result<PostgresExperimentObjectType, String> {
    let project_id = request.project_id.trim().to_string();
    let object_type_id = request.object_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let shape = request.shape.trim().to_string();
    let color = request.color.trim().to_string();
    let fill = request.fill.trim().to_string();
    if project_id.is_empty() || object_type_id.is_empty() {
        return Err("Project and object type identifiers are required.".to_string());
    }
    if name.is_empty() {
        return Err("Enter an object type name.".to_string());
    }
    if shape.is_empty() {
        return Err("Choose an object type shape.".to_string());
    }
    if color.is_empty() {
        return Err("Choose an object type color.".to_string());
    }
    if fill.is_empty() {
        return Err("Choose an object type fill style.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    if let Some((existing_id, existing_name)) = find_postgres_experiment_object_type_for_client(&client, &name).await? {
        if existing_id != object_type_id {
            connection_task.abort();
            return Err(format!("The object type \"{existing_name}\" already exists."));
        }
    }

    let row = client
        .query_one(
            "
            UPDATE object_types
            SET name = $2,
                description = $3,
                shape = $4,
                color = $5,
                fill = $6,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, system_key, name, description, shape, color, fill, created_at::text, updated_at::text
            ",
            &[&object_type_id, &name, &description, &shape, &color, &fill],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment object type: {e}"))?;
    connection_task.abort();
    let updated = map_postgres_experiment_object_type_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "object_type", &updated.id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn save_postgres_experiment_object_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentObjectTypeRequest,
) -> Result<SavePostgresExperimentObjectTypeResult, String> {
    let project_id = request.project_id.trim().to_string();
    let object_type_id = request
        .object_type_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let shape = request.shape.trim().to_string();
    let color = request.color.trim().to_string();
    let fill = request.fill.trim().to_string();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if name.is_empty() {
        return Err("Enter an object type name.".to_string());
    }
    if shape.is_empty() {
        return Err("Choose an object type shape.".to_string());
    }
    if color.is_empty() {
        return Err("Choose an object type color.".to_string());
    }
    if fill.is_empty() {
        return Err("Choose an object type fill style.".to_string());
    }

    let mut normalized_attributes = Vec::with_capacity(request.attributes.len());
    for attribute in request.attributes {
        let id = attribute
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let name = attribute.name.trim().to_string();
        if name.is_empty() {
            return Err("Enter an object attribute name.".to_string());
        }
        let data_type = normalize_postgres_experiment_attribute_data_type(&attribute.data_type)
            .ok_or_else(|| "Choose a valid object attribute data type.".to_string())?
            .to_string();
        let description = attribute.description.trim().to_string();
        let options = normalize_attribute_options(&attribute.options);
        if data_type == "categorical" && options.len() < 2 {
            return Err("Categorical object attributes need at least two options.".to_string());
        }
        normalized_attributes.push((id, name, data_type, description, options));
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    if let Some((existing_id, existing_name)) = find_postgres_experiment_object_type_for_client(&client, &name).await? {
        if object_type_id.as_deref() != Some(existing_id.as_str()) {
            connection_task.abort();
            return Err(format!("The object type \"{existing_name}\" already exists."));
        }
    }

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not begin PostgreSQL experiment object type save: {e}"))?;
    let created = object_type_id.is_none();
    let resolved_object_type_id = object_type_id.unwrap_or_else(generate_identifier);
    let object_type_row = if created {
        tx.query_one(
            "
            INSERT INTO object_types (id, name, description, shape, color, fill)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, system_key, name, description, shape, color, fill, created_at::text, updated_at::text
            ",
            &[&resolved_object_type_id, &name, &description, &shape, &color, &fill],
        ).await
    } else {
        tx.query_one(
            "
            UPDATE object_types
            SET name = $2,
                description = $3,
                shape = $4,
                color = $5,
                fill = $6,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, system_key, name, description, shape, color, fill, created_at::text, updated_at::text
            ",
            &[&resolved_object_type_id, &name, &description, &shape, &color, &fill],
        ).await
    }
    .map_err(|e| format!("Could not save PostgreSQL experiment object type: {e}"))?;

    let existing_attribute_rows = tx
        .query(
            "
            SELECT id, name, data_type, description, options_json, sort_order
            FROM object_attribute_definitions
            WHERE object_type_id = $1
            ORDER BY sort_order ASC, created_at ASC, id ASC
            ",
            &[&resolved_object_type_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object attributes: {e}"))?;
    let mut existing_attribute_by_id: HashMap<String, (String, String, String, Vec<String>, i32)> = HashMap::new();
    let mut next_sort_order = 0;
    for row in existing_attribute_rows {
        let id: String = row.get(0);
        let options_json: String = row.get(4);
        let sort_order: i32 = row.get(5);
        next_sort_order = next_sort_order.max(sort_order + 1);
        existing_attribute_by_id.insert(
            id,
            (
                row.get(1),
                row.get(2),
                row.get(3),
                parse_postgres_experiment_attribute_options_json(&options_json),
                sort_order,
            ),
        );
    }

    let retained_attribute_ids: HashSet<String> = normalized_attributes
        .iter()
        .filter_map(|(id, _, _, _, _)| id.clone())
        .collect();
    for attribute_id in existing_attribute_by_id.keys() {
        if !retained_attribute_ids.contains(attribute_id) {
            tx.execute(
                "
                DELETE FROM object_attribute_definitions
                WHERE id = $1
                ",
                &[attribute_id],
            )
            .await
            .map_err(|e| format!("Could not delete PostgreSQL experiment object attribute: {e}"))?;
        }
    }

    tx.execute(
        "
        UPDATE object_attribute_definitions
        SET object_type = $2,
            updated_at = NOW()
        WHERE object_type_id = $1
          AND object_type IS DISTINCT FROM $2
        ",
        &[&resolved_object_type_id, &name],
    )
    .await
    .map_err(|e| format!("Could not synchronize PostgreSQL experiment object attribute names: {e}"))?;

    tx.execute(
        "
        UPDATE research_objects
        SET object_type = $2,
            updated_at = NOW()
        WHERE object_type_id = $1
          AND object_type IS DISTINCT FROM $2
        ",
        &[&resolved_object_type_id, &name],
    )
    .await
    .map_err(|e| format!("Could not synchronize PostgreSQL experiment object records: {e}"))?;

    for (attribute_id, attribute_name, data_type, attribute_description, options) in normalized_attributes {
        let options_json = serde_json::to_string(&options)
            .map_err(|e| format!("Could not encode PostgreSQL experiment object attribute options: {e}"))?;
        if let Some(attribute_id) = attribute_id {
            let Some((current_name, current_data_type, current_description, current_options, _)) =
                existing_attribute_by_id.get(&attribute_id)
            else {
                return Err("One of the object attributes could not be found.".to_string());
            };
            if current_name == &attribute_name
                && current_data_type == &data_type
                && current_description == &attribute_description
                && current_options == &options
            {
                continue;
            }
            tx.execute(
                "
                UPDATE object_attribute_definitions
                SET object_type_id = $2,
                    object_type = $3,
                    name = $4,
                    data_type = $5,
                    description = $6,
                    options_json = $7,
                    updated_at = NOW()
                WHERE id = $1
                ",
                &[&attribute_id, &resolved_object_type_id, &name, &attribute_name, &data_type, &attribute_description, &options_json],
            )
            .await
            .map_err(|e| format!("Could not update PostgreSQL experiment object attribute: {e}"))?;
        } else {
            let new_attribute_id = generate_identifier();
            tx.execute(
                "
                INSERT INTO object_attribute_definitions (id, object_type_id, object_type, name, data_type, description, options_json, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ",
                &[&new_attribute_id, &resolved_object_type_id, &name, &attribute_name, &data_type, &attribute_description, &options_json, &next_sort_order],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment object attribute: {e}"))?;
            next_sort_order += 1;
        }
    }

    let attribute_rows = tx
        .query(
            "
            SELECT d.id, d.object_type_id, t.name, d.name, d.data_type, d.description, d.options_json, d.sort_order, d.created_at::text, d.updated_at::text
            FROM object_attribute_definitions d
            LEFT JOIN object_types t ON t.id = d.object_type_id
            WHERE d.object_type_id = $1
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
            ",
            &[&resolved_object_type_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment object attributes: {e}"))?;
    let attribute_definitions = attribute_rows
        .into_iter()
        .map(|row| map_postgres_experiment_object_attribute_definition_row(&project_id, row))
        .collect::<Vec<_>>();

    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment object type save: {e}"))?;
    let object_type = map_postgres_experiment_object_type_row(&project_id, object_type_row);
    let log_label = if created {
        format!("Added object type \"{}\"", object_type.name)
    } else {
        format!("Updated object type \"{}\"", object_type.name)
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "object_type.create" } else { "object_type.update" },
        &log_label,
        Some(&object_type.id),
        Some(serde_json::json!({
            "name": object_type.name,
            "shape": object_type.shape,
            "color": object_type.color,
            "fill": object_type.fill,
            "attributeCount": attribute_definitions.len(),
            "changedFields": if created { serde_json::Value::Null } else { serde_json::json!(["name", "description", "shape", "color", "fill", "attributes"]) },
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "object_type",
        &object_type.id,
        if created { "created" } else { "updated" },
    );
    Ok(SavePostgresExperimentObjectTypeResult {
        object_type,
        attribute_definitions,
        created,
    })
}

#[tauri::command]
async fn delete_postgres_experiment_object_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    object_type_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    let object_type_id = object_type_id.trim().to_string();
    if project_id.is_empty() || object_type_id.is_empty() {
        return Err("Project and object type identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_name = client
        .query_opt("SELECT name FROM object_types WHERE id = $1", &[&object_type_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object type before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));

    let object_count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM research_objects WHERE object_type_id = $1",
            &[&object_type_id],
        )
        .await
        .map_err(|e| format!("Could not check PostgreSQL experiment object type usage: {e}"))?
        .get(0);
    if object_count > 0 {
        connection_task.abort();
        return Err(format!(
            "Cannot delete this object type because {object_count} object(s) still use it."
        ));
    }

    let relationship_type_count: i64 = client
        .query_one(
            "
            SELECT COUNT(*)
            FROM relationship_types
            WHERE $1 = ANY(from_object_type_ids)
               OR $1 = ANY(to_object_type_ids)
            ",
            &[&object_type_id],
        )
        .await
        .map_err(|e| format!("Could not check PostgreSQL experiment relationship type constraints: {e}"))?
        .get(0);
    if relationship_type_count > 0 {
        connection_task.abort();
        return Err(format!(
            "Cannot delete this object type because {relationship_type_count} relationship type(s) still restrict to it."
        ));
    }

    let system_key: Option<String> = client
        .query_opt(
            "SELECT system_key FROM object_types WHERE id = $1",
            &[&object_type_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object type: {e}"))?
        .and_then(|row| row.get(0));
    if system_key.is_some() {
        connection_task.abort();
        return Err("Built-in object types cannot be deleted.".to_string());
    }

    client
        .execute(
            "DELETE FROM object_attribute_definitions WHERE object_type_id = $1",
            &[&object_type_id],
        )
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment object type attributes: {e}"))?;

    let deleted_rows = client
        .execute("DELETE FROM object_types WHERE id = $1", &[&object_type_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment object type: {e}"))?;

    if deleted_rows == 0 {
        connection_task.abort();
        return Err("That object type no longer exists.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "object_type.delete",
        "Deleted an object type",
        Some(&object_type_id),
        Some(serde_json::json!({
            "name": deleted_name,
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "object_type", &object_type_id, "deleted");
    Ok(())
}

#[tauri::command]
async fn list_postgres_experiment_relationship_types_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentRelationshipType>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let relationship_types = load_postgres_experiment_relationship_types_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(relationship_types)
}

#[tauri::command]
async fn delete_postgres_experiment_relationship_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    relationship_type_id: String,
) -> Result<(), String> {
    let project_id = project_id.trim().to_string();
    let relationship_type_id = relationship_type_id.trim().to_string();
    if project_id.is_empty() || relationship_type_id.is_empty() {
        return Err("Project and relationship type identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_name = client
        .query_opt("SELECT name FROM relationship_types WHERE id = $1", &[&relationship_type_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment relationship type before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));

    let relationship_count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM object_relationships WHERE relationship_type_id = $1",
            &[&relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not check PostgreSQL experiment relationship type usage: {e}"))?
        .get(0);
    if relationship_count > 0 {
        connection_task.abort();
        return Err(format!(
            "Cannot delete this relationship type because {relationship_count} relationship(s) still use it."
        ));
    }

    client
        .execute(
            "DELETE FROM relationship_attribute_definitions WHERE relationship_type_id = $1",
            &[&relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment relationship type attributes: {e}"))?;

    let deleted_rows = client
        .execute("DELETE FROM relationship_types WHERE id = $1", &[&relationship_type_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment relationship type: {e}"))?;

    if deleted_rows == 0 {
        connection_task.abort();
        return Err("That relationship type no longer exists.".to_string());
    }

    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "relationship_type.delete",
        "Deleted a relationship type",
        Some(&relationship_type_id),
        Some(serde_json::json!({
            "name": deleted_name,
        })),
    ).await?;
    connection_task.abort();

    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "relationship_type",
        &relationship_type_id,
        "deleted",
    );
    Ok(())
}

#[tauri::command]
async fn create_postgres_experiment_relationship_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentRelationshipTypeRequest,
) -> Result<PostgresExperimentRelationshipType, String> {
    let project_id = request.project_id.trim().to_string();
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape = request.line_shape.trim().to_string();
    let line_weight = request.line_weight;
    let arrowhead = request.arrowhead.trim().to_string();
    let color = request.color.trim().to_string();
    let from_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.from_object_type_ids);
    let to_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.to_object_type_ids);
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if name.is_empty() {
        return Err("Relationship type name is required.".to_string());
    }
    if line_shape.is_empty() {
        return Err("Choose a relationship line shape.".to_string());
    }
    if !(1..=4).contains(&line_weight) {
        return Err("Choose a valid relationship line weight.".to_string());
    }
    if arrowhead.is_empty() {
        return Err("Choose a relationship arrowhead style.".to_string());
    }
    if color.is_empty() {
        return Err("Choose a relationship color.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    for object_type_id in &from_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    for object_type_id in &to_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    if let Some((_, existing_name)) = find_postgres_experiment_relationship_type_for_client(&client, &name).await? {
        connection_task.abort();
        return Err(format!("Relationship type \"{existing_name}\" already exists."));
    }

    let relationship_type_id = generate_identifier();
    let row = client
        .query_one(
            "
            INSERT INTO relationship_types (id, name, description, line_shape, line_weight, arrowhead, color, from_object_type_ids, to_object_type_ids)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING
                id,
                name,
                description,
                line_shape,
                line_weight,
                arrowhead,
                color,
                from_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.from_object_type_ids)), ARRAY[]::TEXT[]),
                to_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.to_object_type_ids)), ARRAY[]::TEXT[]),
                created_at::text,
                updated_at::text
            ",
            &[&relationship_type_id, &name, &description, &line_shape, &line_weight, &arrowhead, &color, &from_object_type_ids, &to_object_type_ids],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment relationship type: {e}"))?;
    connection_task.abort();
    let created = map_postgres_experiment_relationship_type_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "relationship_type", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_relationship_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentRelationshipTypeRequest,
) -> Result<PostgresExperimentRelationshipType, String> {
    let project_id = request.project_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape = request.line_shape.trim().to_string();
    let line_weight = request.line_weight;
    let arrowhead = request.arrowhead.trim().to_string();
    let color = request.color.trim().to_string();
    let from_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.from_object_type_ids);
    let to_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.to_object_type_ids);

    if project_id.is_empty() || relationship_type_id.is_empty() {
        return Err("Project and relationship type identifiers are required.".to_string());
    }
    if name.is_empty() {
        return Err("Relationship type name is required.".to_string());
    }
    if line_shape.is_empty() {
        return Err("Choose a relationship line shape.".to_string());
    }
    if !(1..=4).contains(&line_weight) {
        return Err("Choose a valid relationship line weight.".to_string());
    }
    if arrowhead.is_empty() {
        return Err("Choose a relationship arrowhead style.".to_string());
    }
    if color.is_empty() {
        return Err("Choose a relationship color.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    for object_type_id in &from_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    for object_type_id in &to_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    if let Some((existing_id, existing_name)) = find_postgres_experiment_relationship_type_for_client(&client, &name).await? {
        if existing_id != relationship_type_id {
            connection_task.abort();
            return Err(format!("Relationship type \"{existing_name}\" already exists."));
        }
    }

    let row = client
        .query_one(
            "
            UPDATE relationship_types
            SET name = $2,
                description = $3,
                line_shape = $4,
                line_weight = $5,
                arrowhead = $6,
                color = $7,
                from_object_type_ids = $8,
                to_object_type_ids = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id,
                name,
                description,
                line_shape,
                line_weight,
                arrowhead,
                color,
                from_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.from_object_type_ids)), ARRAY[]::TEXT[]),
                to_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.to_object_type_ids)), ARRAY[]::TEXT[]),
                created_at::text,
                updated_at::text
            ",
            &[&relationship_type_id, &name, &description, &line_shape, &line_weight, &arrowhead, &color, &from_object_type_ids, &to_object_type_ids],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment relationship type: {e}"))?;
    connection_task.abort();
    let updated = map_postgres_experiment_relationship_type_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "relationship_type", &updated.id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn save_postgres_experiment_relationship_type_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentRelationshipTypeRequest,
) -> Result<SavePostgresExperimentRelationshipTypeResult, String> {
    let project_id = request.project_id.trim().to_string();
    let relationship_type_id = request
        .relationship_type_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = request.name.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape = request.line_shape.trim().to_string();
    let line_weight = request.line_weight;
    let arrowhead = request.arrowhead.trim().to_string();
    let color = request.color.trim().to_string();
    let from_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.from_object_type_ids);
    let to_object_type_ids = normalize_postgres_experiment_object_type_id_list(request.to_object_type_ids);

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if name.is_empty() {
        return Err("Relationship type name is required.".to_string());
    }
    if line_shape.is_empty() {
        return Err("Choose a relationship line shape.".to_string());
    }
    if !(1..=4).contains(&line_weight) {
        return Err("Choose a valid relationship line weight.".to_string());
    }
    if arrowhead.is_empty() {
        return Err("Choose a relationship arrowhead style.".to_string());
    }
    if color.is_empty() {
        return Err("Choose a relationship color.".to_string());
    }

    let mut normalized_attributes = Vec::with_capacity(request.attributes.len());
    for attribute in request.attributes {
        let id = attribute
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let name = attribute.name.trim().to_string();
        if name.is_empty() {
            return Err("Relationship attribute name is required.".to_string());
        }
        let data_type = normalize_postgres_experiment_attribute_data_type(&attribute.data_type)
            .ok_or_else(|| "Choose a valid relationship attribute data type.".to_string())?
            .to_string();
        let description = attribute.description.trim().to_string();
        let options = normalize_attribute_options(&attribute.options);
        if data_type == "categorical" && options.len() < 2 {
            return Err("Categorical relationship attributes need at least two options.".to_string());
        }
        normalized_attributes.push((id, name, data_type, description, options));
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    for object_type_id in &from_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    for object_type_id in &to_object_type_ids {
        let _ = load_postgres_experiment_object_type_for_client(&client, object_type_id).await?;
    }
    if let Some((existing_id, existing_name)) = find_postgres_experiment_relationship_type_for_client(&client, &name).await? {
        if relationship_type_id.as_deref() != Some(existing_id.as_str()) {
            connection_task.abort();
            return Err(format!("Relationship type \"{existing_name}\" already exists."));
        }
    }

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not begin PostgreSQL experiment relationship type save: {e}"))?;
    let created = relationship_type_id.is_none();
    let resolved_relationship_type_id = relationship_type_id.unwrap_or_else(generate_identifier);
    let relationship_type_row = if created {
        tx.query_one(
            "
            INSERT INTO relationship_types (id, name, description, line_shape, line_weight, arrowhead, color, from_object_type_ids, to_object_type_ids)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING
                id,
                name,
                description,
                line_shape,
                line_weight,
                arrowhead,
                color,
                from_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.from_object_type_ids)), ARRAY[]::TEXT[]),
                to_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.to_object_type_ids)), ARRAY[]::TEXT[]),
                created_at::text,
                updated_at::text
            ",
            &[&resolved_relationship_type_id, &name, &description, &line_shape, &line_weight, &arrowhead, &color, &from_object_type_ids, &to_object_type_ids],
        ).await
    } else {
        tx.query_one(
            "
            UPDATE relationship_types
            SET name = $2,
                description = $3,
                line_shape = $4,
                line_weight = $5,
                arrowhead = $6,
                color = $7,
                from_object_type_ids = $8,
                to_object_type_ids = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id,
                name,
                description,
                line_shape,
                line_weight,
                arrowhead,
                color,
                from_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.from_object_type_ids)), ARRAY[]::TEXT[]),
                to_object_type_ids,
                COALESCE((SELECT ARRAY_AGG(object_types.name ORDER BY lower(object_types.name), object_types.id) FROM object_types WHERE object_types.id = ANY(relationship_types.to_object_type_ids)), ARRAY[]::TEXT[]),
                created_at::text,
                updated_at::text
            ",
            &[&resolved_relationship_type_id, &name, &description, &line_shape, &line_weight, &arrowhead, &color, &from_object_type_ids, &to_object_type_ids],
        ).await
    }
    .map_err(|e| format!("Could not save PostgreSQL experiment relationship type: {e}"))?;

    let existing_attribute_rows = tx
        .query(
            "
            SELECT id, name, data_type, description, options_json, sort_order
            FROM relationship_attribute_definitions
            WHERE relationship_type_id = $1
            ORDER BY sort_order ASC, created_at ASC, id ASC
            ",
            &[&resolved_relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment relationship attributes: {e}"))?;
    let mut existing_attribute_by_id: HashMap<String, (String, String, String, Vec<String>, i32)> = HashMap::new();
    let mut next_sort_order = 0;
    for row in existing_attribute_rows {
        let id: String = row.get(0);
        let options_json: String = row.get(4);
        let sort_order: i32 = row.get(5);
        next_sort_order = next_sort_order.max(sort_order + 1);
        existing_attribute_by_id.insert(
            id,
            (
                row.get(1),
                row.get(2),
                row.get(3),
                parse_postgres_experiment_attribute_options_json(&options_json),
                sort_order,
            ),
        );
    }

    let retained_attribute_ids: HashSet<String> = normalized_attributes
        .iter()
        .filter_map(|(id, _, _, _, _)| id.clone())
        .collect();
    for attribute_id in existing_attribute_by_id.keys() {
        if !retained_attribute_ids.contains(attribute_id) {
            tx.execute(
                "
                DELETE FROM relationship_attribute_definitions
                WHERE id = $1
                ",
                &[attribute_id],
            )
            .await
            .map_err(|e| format!("Could not delete PostgreSQL experiment relationship attribute: {e}"))?;
        }
    }

    tx.execute(
        "
        UPDATE relationship_attribute_definitions
        SET relationship_type = $2,
            updated_at = NOW()
        WHERE relationship_type_id = $1
          AND relationship_type IS DISTINCT FROM $2
        ",
        &[&resolved_relationship_type_id, &name],
    )
    .await
    .map_err(|e| format!("Could not synchronize PostgreSQL experiment relationship attribute names: {e}"))?;

    for (attribute_id, attribute_name, data_type, attribute_description, options) in normalized_attributes {
        let options_json = serde_json::to_string(&options)
            .map_err(|e| format!("Could not encode relationship attribute options: {e}"))?;
        if let Some(attribute_id) = attribute_id {
            let Some((current_name, current_data_type, current_description, current_options, _)) =
                existing_attribute_by_id.get(&attribute_id)
            else {
                return Err("One of the relationship attributes could not be found.".to_string());
            };
            if current_name == &attribute_name
                && current_data_type == &data_type
                && current_description == &attribute_description
                && current_options == &options
            {
                continue;
            }
            tx.execute(
                "
                UPDATE relationship_attribute_definitions
                SET relationship_type_id = $2,
                    relationship_type = $3,
                    name = $4,
                    data_type = $5,
                    description = $6,
                    options_json = $7,
                    updated_at = NOW()
                WHERE id = $1
                ",
                &[&attribute_id, &resolved_relationship_type_id, &name, &attribute_name, &data_type, &attribute_description, &options_json],
            )
            .await
            .map_err(|e| format!("Could not update PostgreSQL experiment relationship attribute: {e}"))?;
        } else {
            let new_attribute_id = generate_identifier();
            tx.execute(
                "
                INSERT INTO relationship_attribute_definitions (id, relationship_type_id, relationship_type, name, data_type, description, options_json, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ",
                &[&new_attribute_id, &resolved_relationship_type_id, &name, &attribute_name, &data_type, &attribute_description, &options_json, &next_sort_order],
            )
            .await
            .map_err(|e| format!("Could not create PostgreSQL experiment relationship attribute: {e}"))?;
            next_sort_order += 1;
        }
    }

    let attribute_rows = tx
        .query(
            "
            SELECT d.id, d.relationship_type_id, t.name, d.name, d.data_type, d.description, d.options_json, d.sort_order, d.created_at::text, d.updated_at::text
            FROM relationship_attribute_definitions d
            LEFT JOIN relationship_types t ON t.id = d.relationship_type_id
            WHERE d.relationship_type_id = $1
            ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
            ",
            &[&resolved_relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationship attributes: {e}"))?;
    let attribute_definitions = attribute_rows
        .into_iter()
        .map(|row| map_postgres_experiment_relationship_attribute_definition_row(&project_id, row))
        .collect::<Vec<_>>();

    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment relationship type save: {e}"))?;
    let relationship_type = map_postgres_experiment_relationship_type_row(&project_id, relationship_type_row);
    let log_label = if created {
        format!("Added relationship type \"{}\"", relationship_type.name)
    } else {
        format!("Updated relationship type \"{}\"", relationship_type.name)
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "relationship_type.create" } else { "relationship_type.update" },
        &log_label,
        Some(&relationship_type.id),
        Some(serde_json::json!({
            "name": relationship_type.name,
            "lineShape": relationship_type.line_shape,
            "lineWeight": relationship_type.line_weight,
            "arrowhead": relationship_type.arrowhead,
            "color": relationship_type.color,
            "fromObjectTypeCount": relationship_type.from_object_type_ids.len(),
            "toObjectTypeCount": relationship_type.to_object_type_ids.len(),
            "attributeCount": attribute_definitions.len(),
            "changedFields": if created { serde_json::Value::Null } else { serde_json::json!(["name", "description", "line_shape", "line_weight", "arrowhead", "color", "from_object_type_ids", "to_object_type_ids", "attributes"]) },
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "relationship_type",
        &relationship_type.id,
        if created { "created" } else { "updated" },
    );
    Ok(SavePostgresExperimentRelationshipTypeResult {
        relationship_type,
        attribute_definitions,
        created,
    })
}

#[tauri::command]
async fn list_postgres_experiment_objects_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentObject>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let attribute_values_by_object_id = load_postgres_experiment_object_attribute_values_for_client(&client).await?;
    let rows = client
        .query(
            "
            SELECT
                o.id,
                o.object_type_id,
                t.name,
                t.system_key,
                o.source_id,
                s.source_kind,
                o.title,
                o.description,
                o.shape_override,
                o.color_override,
                o.fill_override,
                e.start_at::text,
                e.end_at::text,
                e.time_precision,
                NULLIF(e.timezone, ''),
                e.is_instant,
                o.created_at::text,
                o.updated_at::text
            FROM research_objects o
            LEFT JOIN object_types t ON t.id = o.object_type_id
            LEFT JOIN sources s ON s.id = o.source_id
            LEFT JOIN event_objects e ON e.object_id = o.id
            ORDER BY o.created_at ASC, o.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment objects: {e}"))?;
    connection_task.abort();
    Ok(rows
        .into_iter()
        .map(|row| map_postgres_experiment_object_row(&project_id, row, &attribute_values_by_object_id))
        .collect())
}

#[tauri::command]
async fn list_postgres_experiment_object_attribute_definitions_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentObjectAttributeDefinition>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let definitions = load_postgres_experiment_object_attribute_definitions_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(definitions)
}

#[tauri::command]
async fn create_postgres_experiment_object_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentObjectAttributeDefinitionRequest,
) -> Result<PostgresExperimentObjectAttributeDefinition, String> {
    let project_id = request.project_id.trim().to_string();
    let object_type_id = request.object_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let data_type = normalize_postgres_experiment_attribute_data_type(&request.data_type)
        .ok_or_else(|| "Choose a valid object attribute data type.".to_string())?
        .to_string();
    let description = request.description.trim().to_string();
    let options = normalize_attribute_options(&request.options);

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if object_type_id.is_empty() {
        return Err("Object type is required for object attributes.".to_string());
    }
    if name.is_empty() {
        return Err("Enter an object attribute name.".to_string());
    }
    if data_type == "categorical" && options.len() < 2 {
        return Err("Categorical object attributes need at least two options.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (object_type_id, object_type_name) =
        load_postgres_experiment_object_type_for_client(&client, &object_type_id).await?;
    let attribute_definition_id = generate_identifier();
    let options_json = serde_json::to_string(&options)
        .map_err(|e| format!("Could not encode PostgreSQL experiment object attribute options: {e}"))?;
    let sort_order_row = client
        .query_one("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM object_attribute_definitions", &[])
        .await
        .map_err(|e| format!("Could not determine object attribute order: {e}"))?;
    let sort_order: i32 = sort_order_row.get(0);
    let row = client
        .query_one(
            "
            INSERT INTO object_attribute_definitions (id, object_type_id, object_type, name, data_type, description, options_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, object_type_id, object_type, name, data_type, description, options_json, sort_order, created_at::text, updated_at::text
            ",
            &[&attribute_definition_id, &object_type_id, &object_type_name, &name, &data_type, &description, &options_json, &sort_order],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment object attribute: {e}"))?;
    connection_task.abort();
    let created = map_postgres_experiment_object_attribute_definition_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "object_attribute_definition", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_object_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentObjectAttributeDefinitionRequest,
) -> Result<PostgresExperimentObjectAttributeDefinition, String> {
    let project_id = request.project_id.trim().to_string();
    let attribute_definition_id = request.attribute_definition_id.trim().to_string();
    let object_type_id = request.object_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let data_type = normalize_postgres_experiment_attribute_data_type(&request.data_type)
        .ok_or_else(|| "Choose a valid object attribute data type.".to_string())?
        .to_string();
    let description = request.description.trim().to_string();
    let options = normalize_attribute_options(&request.options);

    if project_id.is_empty() || attribute_definition_id.is_empty() {
        return Err("Project and attribute identifiers are required.".to_string());
    }
    if object_type_id.is_empty() {
        return Err("Object type is required for object attributes.".to_string());
    }
    if name.is_empty() {
        return Err("Enter an object attribute name.".to_string());
    }
    if data_type == "categorical" && options.len() < 2 {
        return Err("Categorical object attributes need at least two options.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (object_type_id, object_type_name) =
        load_postgres_experiment_object_type_for_client(&client, &object_type_id).await?;
    let options_json = serde_json::to_string(&options)
        .map_err(|e| format!("Could not encode PostgreSQL experiment object attribute options: {e}"))?;
    let row = client
        .query_one(
            "
            UPDATE object_attribute_definitions
            SET object_type_id = $2,
                object_type = $3,
                name = $4,
                data_type = $5,
                description = $6,
                options_json = $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, object_type_id, object_type, name, data_type, description, options_json, sort_order, created_at::text, updated_at::text
            ",
            &[&attribute_definition_id, &object_type_id, &object_type_name, &name, &data_type, &description, &options_json],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment object attribute: {e}"))?;
    connection_task.abort();
    let updated = map_postgres_experiment_object_attribute_definition_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "object_attribute_definition", &updated.id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn delete_postgres_experiment_object_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    attribute_definition_id: String,
) -> Result<DeletePostgresExperimentObjectAttributeDefinitionResult, String> {
    let project_id = project_id.trim().to_string();
    let attribute_definition_id = attribute_definition_id.trim().to_string();
    if project_id.is_empty() || attribute_definition_id.is_empty() {
        return Err("Project and attribute identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    client
        .execute(
            "DELETE FROM object_attribute_definitions WHERE id = $1",
            &[&attribute_definition_id],
        )
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment object attribute: {e}"))?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "object_attribute_definition", &attribute_definition_id, "deleted");
    Ok(DeletePostgresExperimentObjectAttributeDefinitionResult {
        project_id,
        attribute_definition_id,
    })
}

#[tauri::command]
async fn create_postgres_experiment_object_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentObjectRequest,
) -> Result<PostgresExperimentObject, String> {
    let project_id = request.project_id.trim().to_string();
    let object_type_id = request.object_type_id.trim().to_string();
    let title = request.title.trim().to_string();
    let description = request.description.trim().to_string();
    let shape_override = request
        .shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let fill_override = request
        .fill_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let event_start_at = request.event_start_at.as_deref();
    let event_end_at = request.event_end_at.as_deref();
    let event_time_precision = request.event_time_precision.as_deref();
    let event_timezone = request.event_timezone.as_deref();
    let event_is_instant = request.event_is_instant;
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if object_type_id.is_empty() {
        return Err("Enter an object type.".to_string());
    }
    if title.is_empty() {
        return Err("Enter an object title.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let object_type = load_postgres_experiment_object_type_record_for_client(&client, &object_type_id).await?;
    ensure_postgres_experiment_object_type_is_not_source_backed(&object_type)?;
    let object_id = generate_identifier();
    client
        .execute(
            "
            INSERT INTO research_objects (id, object_type_id, object_type, title, description, shape_override, color_override, fill_override)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ",
            &[&object_id, &object_type.id, &object_type.name, &title, &description, &shape_override, &color_override, &fill_override],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment object: {e}"))?;
    save_postgres_experiment_object_attribute_values_for_client(&*client, &object_id, &object_type.id, &attribute_values).await?;
    save_postgres_experiment_event_fields_for_client(
        &*client,
        &object_id,
        object_type.system_key.as_deref(),
        event_start_at,
        event_end_at,
        event_time_precision,
        event_timezone,
        event_is_instant,
    )
    .await?;
    let attribute_values_by_object_id = load_postgres_experiment_object_attribute_values_for_client(&client).await?;
    let created =
        load_postgres_experiment_object_for_client(&client, &project_id, &object_id, &attribute_values_by_object_id).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "object", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_object_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentObjectRequest,
) -> Result<PostgresExperimentObject, String> {
    let project_id = request.project_id.trim().to_string();
    let object_id = request.object_id.trim().to_string();
    let object_type_id = request.object_type_id.trim().to_string();
    let title = request.title.trim().to_string();
    let description = request.description.trim().to_string();
    let shape_override = request
        .shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let fill_override = request
        .fill_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let event_start_at = request.event_start_at.as_deref();
    let event_end_at = request.event_end_at.as_deref();
    let event_time_precision = request.event_time_precision.as_deref();
    let event_timezone = request.event_timezone.as_deref();
    let event_is_instant = request.event_is_instant;
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() || object_id.is_empty() {
        return Err("Project and object identifiers are required.".to_string());
    }
    if object_type_id.is_empty() {
        return Err("Enter an object type.".to_string());
    }
    if title.is_empty() {
        return Err("Enter an object title.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    if load_postgres_experiment_source_id_for_object_for_client(&client, &object_id).await?.is_some() {
        connection_task.abort();
        return Err("This object is managed from the Sources workflow.".to_string());
    }
    let object_type = load_postgres_experiment_object_type_record_for_client(&client, &object_type_id).await?;
    ensure_postgres_experiment_object_type_is_not_source_backed(&object_type)?;
    client
        .execute(
            "
            UPDATE research_objects
            SET object_type_id = $2,
                object_type = $3,
                title = $4,
                description = $5,
                shape_override = $6,
                color_override = $7,
                fill_override = $8,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[&object_id, &object_type.id, &object_type.name, &title, &description, &shape_override, &color_override, &fill_override],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment object: {e}"))?;
    save_postgres_experiment_object_attribute_values_for_client(&*client, &object_id, &object_type.id, &attribute_values).await?;
    save_postgres_experiment_event_fields_for_client(
        &*client,
        &object_id,
        object_type.system_key.as_deref(),
        event_start_at,
        event_end_at,
        event_time_precision,
        event_timezone,
        event_is_instant,
    )
    .await?;
    let attribute_values_by_object_id = load_postgres_experiment_object_attribute_values_for_client(&client).await?;
    let updated =
        load_postgres_experiment_object_for_client(&client, &project_id, &object_id, &attribute_values_by_object_id).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "object", &object_id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn save_postgres_experiment_object_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentObjectRequest,
) -> Result<PostgresExperimentObject, String> {
    let project_id = request.project_id.trim().to_string();
    let object_id = request
        .object_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let object_type_id = request.object_type_id.trim().to_string();
    let title = request.title.trim().to_string();
    let description = request.description.trim().to_string();
    let shape_override = request
        .shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let fill_override = request
        .fill_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let event_start_at = request.event_start_at.as_deref();
    let event_end_at = request.event_end_at.as_deref();
    let event_time_precision = request.event_time_precision.as_deref();
    let event_timezone = request.event_timezone.as_deref();
    let event_is_instant = request.event_is_instant;
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if object_type_id.is_empty() {
        return Err("Enter an object type.".to_string());
    }
    if title.is_empty() {
        return Err("Enter an object title.".to_string());
    }

    eprintln!(
        "[kanqual] save_postgres_experiment_object_command:start object_id={:?} object_type_id={} title={} attribute_values={}",
        object_id,
        object_type_id,
        title,
        attribute_values.len()
    );

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let object_type = load_postgres_experiment_object_type_record_for_client(&client, &object_type_id).await?;
    ensure_postgres_experiment_object_type_is_not_source_backed(&object_type)?;
    if let Some(existing_object_id) = object_id.as_deref() {
        if load_postgres_experiment_source_id_for_object_for_client(&client, existing_object_id).await?.is_some() {
            connection_task.abort();
            return Err("This object is managed from the Sources workflow.".to_string());
        }
    }
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not begin PostgreSQL experiment object save: {e}"))?;
    let created = object_id.is_none();
    let resolved_object_id = object_id.unwrap_or_else(generate_identifier);
    if created {
        tx.execute(
            "
            INSERT INTO research_objects (id, object_type_id, object_type, title, description, shape_override, color_override, fill_override)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ",
            &[&resolved_object_id, &object_type.id, &object_type.name, &title, &description, &shape_override, &color_override, &fill_override],
        ).await
    } else {
        tx.execute(
            "
            UPDATE research_objects
            SET object_type_id = $2,
                object_type = $3,
                title = $4,
                description = $5,
                shape_override = $6,
                color_override = $7,
                fill_override = $8,
                updated_at = NOW()
            WHERE id = $1
            ",
            &[&resolved_object_id, &object_type.id, &object_type.name, &title, &description, &shape_override, &color_override, &fill_override],
        ).await
    }
    .map_err(|e| format!("Could not save PostgreSQL experiment object: {e}"))?;
    save_postgres_experiment_object_attribute_values_for_client(
        &tx,
        &resolved_object_id,
        &object_type.id,
        &attribute_values,
    )
    .await?;
    save_postgres_experiment_event_fields_for_client(
        &tx,
        &resolved_object_id,
        object_type.system_key.as_deref(),
        event_start_at,
        event_end_at,
        event_time_precision,
        event_timezone,
        event_is_instant,
    )
    .await?;
    eprintln!(
        "[kanqual] save_postgres_experiment_object_command:values_saved object_id={} object_type_id={}",
        resolved_object_id,
        object_type.id
    );
    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment object save: {e}"))?;
    eprintln!(
        "[kanqual] save_postgres_experiment_object_command:committed object_id={} created={}",
        resolved_object_id,
        created
    );
    let attribute_values_by_object_id = load_postgres_experiment_object_attribute_values_for_client(&client).await?;
    let saved = load_postgres_experiment_object_for_client(
        &client,
        &project_id,
        &resolved_object_id,
        &attribute_values_by_object_id,
    )
    .await?;
    let log_label = if created {
        format!("Added object \"{}\"", saved.title)
    } else {
        format!("Updated object \"{}\"", saved.title)
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "object.create" } else { "object.update" },
        &log_label,
        Some(&saved.id),
        Some(serde_json::json!({
            "title": saved.title,
            "objectType": saved.object_type,
            "attributeValueCount": saved.attribute_values.len(),
            "changedFields": if created { serde_json::Value::Null } else { serde_json::json!(["object_type_id", "title", "description", "shape_override", "color_override", "fill_override", "event_fields", "attribute_values"]) },
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "object",
        &resolved_object_id,
        if created { "created" } else { "updated" },
    );
    eprintln!(
        "[kanqual] save_postgres_experiment_object_command:done object_id={} object_type_id={} attribute_values={}",
        resolved_object_id,
        saved.object_type_id,
        saved.attribute_values.len()
    );
    Ok(saved)
}

#[tauri::command]
async fn delete_postgres_experiment_object_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    object_id: String,
) -> Result<DeletePostgresExperimentObjectResult, String> {
    let project_id = project_id.trim().to_string();
    let object_id = object_id.trim().to_string();
    if project_id.is_empty() || object_id.is_empty() {
        return Err("Project and object identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    if load_postgres_experiment_source_id_for_object_for_client(&client, &object_id).await?.is_some() {
        connection_task.abort();
        return Err("This object is managed from the Sources workflow.".to_string());
    }
    let deleted_title = client
        .query_opt("SELECT title FROM research_objects WHERE id = $1", &[&object_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment object before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    client
        .execute("DELETE FROM research_objects WHERE id = $1", &[&object_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment object: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "object.delete",
        "Deleted an object",
        Some(&object_id),
        Some(serde_json::json!({
            "title": deleted_title,
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "object", &object_id, "deleted");
    Ok(DeletePostgresExperimentObjectResult { project_id, object_id })
}

#[tauri::command]
async fn list_postgres_experiment_relationships_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentRelationship>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let attribute_values_by_relationship_id = load_postgres_experiment_relationship_attribute_values_for_client(&client).await?;
    let rows = client
        .query(
            "
            SELECT r.id, r.from_object_id, r.to_object_id, r.relationship_type_id, t.name, r.description, r.line_shape_override, r.line_weight_override, r.arrowhead_override, r.color_override, r.created_at::text, r.updated_at::text
            FROM object_relationships r
            LEFT JOIN relationship_types t ON t.id = r.relationship_type_id
            ORDER BY r.created_at ASC, r.id ASC
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Could not load PostgreSQL experiment relationships: {e}"))?;
    connection_task.abort();
    Ok(rows
        .into_iter()
        .map(|row| PostgresExperimentRelationship {
            id: row.get(0),
            project_id: project_id.clone(),
            from_object_id: row.get(1),
            to_object_id: row.get(2),
            relationship_type_id: row.get::<usize, Option<String>>(3).unwrap_or_default(),
            relationship_type: row.get::<usize, Option<String>>(4).unwrap_or_default(),
            description: row.get(5),
            line_shape_override: row.get::<usize, Option<String>>(6).unwrap_or_default(),
            line_weight_override: row.get::<usize, Option<i32>>(7),
            arrowhead_override: row.get::<usize, Option<String>>(8).unwrap_or_default(),
            color_override: row.get::<usize, Option<String>>(9).unwrap_or_default(),
            attribute_values: attribute_values_by_relationship_id
                .get(&row.get::<usize, String>(0))
                .cloned()
                .unwrap_or_default(),
            created_at: row.get(10),
            updated_at: row.get(11),
        })
        .collect())
}

#[tauri::command]
async fn list_postgres_experiment_relationship_attribute_definitions_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
) -> Result<Vec<PostgresExperimentRelationshipAttributeDefinition>, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let definitions = load_postgres_experiment_relationship_attribute_definitions_for_client(&client, &project_id).await?;
    connection_task.abort();
    Ok(definitions)
}

#[tauri::command]
async fn create_postgres_experiment_relationship_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentRelationshipAttributeDefinitionRequest,
) -> Result<PostgresExperimentRelationshipAttributeDefinition, String> {
    let project_id = request.project_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let data_type = normalize_postgres_experiment_attribute_data_type(&request.data_type)
        .ok_or_else(|| "Choose a valid relationship attribute data type.".to_string())?;
    let description = request.description.trim().to_string();
    let options = normalize_attribute_options(&request.options);

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if relationship_type_id.is_empty() {
        return Err("Relationship type is required.".to_string());
    }
    if name.is_empty() {
        return Err("Relationship attribute name is required.".to_string());
    }
    if data_type == "categorical" && options.len() < 2 {
        return Err("Categorical relationship attributes need at least two options.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (relationship_type_id, relationship_type_name, _, _) =
        load_postgres_experiment_relationship_type_for_client(&client, &relationship_type_id).await?;
    let sort_order: i32 = client
        .query_one(
            "
            SELECT COALESCE(MAX(sort_order), -1) + 1
            FROM relationship_attribute_definitions
            WHERE relationship_type_id = $1
            ",
            &[&relationship_type_id],
        )
        .await
        .map_err(|e| format!("Could not determine relationship attribute order: {e}"))?
        .get(0);
    let id = generate_identifier();
    let options_json = serde_json::to_string(&options)
        .map_err(|e| format!("Could not encode relationship attribute options: {e}"))?;
    let row = client
        .query_one(
            "
            INSERT INTO relationship_attribute_definitions (id, relationship_type_id, relationship_type, name, data_type, description, options_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, relationship_type_id, relationship_type, name, data_type, description, options_json, sort_order, created_at::text, updated_at::text
            ",
            &[&id, &relationship_type_id, &relationship_type_name, &name, &data_type, &description, &options_json, &sort_order],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment relationship attribute: {e}"))?;
    connection_task.abort();
    let created = map_postgres_experiment_relationship_attribute_definition_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "relationship_attribute_definition", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_relationship_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentRelationshipAttributeDefinitionRequest,
) -> Result<PostgresExperimentRelationshipAttributeDefinition, String> {
    let project_id = request.project_id.trim().to_string();
    let attribute_definition_id = request.attribute_definition_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let name = request.name.trim().to_string();
    let data_type = normalize_postgres_experiment_attribute_data_type(&request.data_type)
        .ok_or_else(|| "Choose a valid relationship attribute data type.".to_string())?;
    let description = request.description.trim().to_string();
    let options = normalize_attribute_options(&request.options);

    if project_id.is_empty() || attribute_definition_id.is_empty() {
        return Err("Project and relationship attribute identifiers are required.".to_string());
    }
    if relationship_type_id.is_empty() {
        return Err("Relationship type is required.".to_string());
    }
    if name.is_empty() {
        return Err("Relationship attribute name is required.".to_string());
    }
    if data_type == "categorical" && options.len() < 2 {
        return Err("Categorical relationship attributes need at least two options.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (relationship_type_id, relationship_type_name, _, _) =
        load_postgres_experiment_relationship_type_for_client(&client, &relationship_type_id).await?;
    let options_json = serde_json::to_string(&options)
        .map_err(|e| format!("Could not encode relationship attribute options: {e}"))?;
    let row = client
        .query_one(
            "
            UPDATE relationship_attribute_definitions
            SET relationship_type_id = $2,
                relationship_type = $3,
                name = $4,
                data_type = $5,
                description = $6,
                options_json = $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, relationship_type_id, relationship_type, name, data_type, description, options_json, sort_order, created_at::text, updated_at::text
            ",
            &[&attribute_definition_id, &relationship_type_id, &relationship_type_name, &name, &data_type, &description, &options_json],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment relationship attribute: {e}"))?;
    connection_task.abort();
    let updated = map_postgres_experiment_relationship_attribute_definition_row(&project_id, row);
    emit_postgres_experiment_project_change(&app, &project_id, "relationship_attribute_definition", &attribute_definition_id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn delete_postgres_experiment_relationship_attribute_definition_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    attribute_definition_id: String,
) -> Result<DeletePostgresExperimentRelationshipAttributeDefinitionResult, String> {
    let project_id = project_id.trim().to_string();
    let attribute_definition_id = attribute_definition_id.trim().to_string();
    if project_id.is_empty() || attribute_definition_id.is_empty() {
        return Err("Project and relationship attribute identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    client
        .execute(
            "
            DELETE FROM relationship_attribute_definitions
            WHERE id = $1
            ",
            &[&attribute_definition_id],
        )
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment relationship attribute: {e}"))?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "relationship_attribute_definition", &attribute_definition_id, "deleted");
    Ok(DeletePostgresExperimentRelationshipAttributeDefinitionResult {
        project_id,
        attribute_definition_id,
    })
}

#[tauri::command]
async fn create_postgres_experiment_relationship_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: CreatePostgresExperimentRelationshipRequest,
) -> Result<PostgresExperimentRelationship, String> {
    let project_id = request.project_id.trim().to_string();
    let from_object_id = request.from_object_id.trim().to_string();
    let to_object_id = request.to_object_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape_override = request
        .line_shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let line_weight_override = request.line_weight_override;
    let arrowhead_override = request
        .arrowhead_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if from_object_id.is_empty() || to_object_id.is_empty() {
        return Err("Choose both objects for the relationship.".to_string());
    }
    if relationship_type_id.is_empty() {
        return Err("Choose a relationship type.".to_string());
    }
    if let Some(line_weight_override) = line_weight_override {
        if !(1..=4).contains(&line_weight_override) {
            return Err("Line weight override must be between 1 and 4.".to_string());
        }
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (relationship_type_id, relationship_type_name, allowed_from_object_type_ids, allowed_to_object_type_ids) =
        load_postgres_experiment_relationship_type_for_client(&client, &relationship_type_id).await?;
    validate_postgres_experiment_relationship_type_constraints_for_client(
        &client,
        &from_object_id,
        &to_object_id,
        &relationship_type_name,
        &allowed_from_object_type_ids,
        &allowed_to_object_type_ids,
    ).await?;
    let relationship_id = generate_identifier();
    let row = client
        .query_one(
            "
            INSERT INTO object_relationships (id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override, created_at::text, updated_at::text
            ",
            &[&relationship_id, &from_object_id, &to_object_id, &relationship_type_id, &relationship_type_name, &description, &line_shape_override, &line_weight_override, &arrowhead_override, &color_override],
        )
        .await
        .map_err(|e| format!("Could not create PostgreSQL experiment relationship: {e}"))?;
    save_postgres_experiment_relationship_attribute_values_for_client(&*client, &relationship_id, &relationship_type_id, &attribute_values).await?;
    let attribute_values_by_relationship_id = load_postgres_experiment_relationship_attribute_values_for_client(&client).await?;
    connection_task.abort();
    let created = PostgresExperimentRelationship {
        id: row.get(0),
        project_id: project_id.clone(),
        from_object_id: row.get(1),
        to_object_id: row.get(2),
        relationship_type_id: row.get(3),
        relationship_type: row.get(4),
        description: row.get(5),
        line_shape_override: row.get::<usize, Option<String>>(6).unwrap_or_default(),
        line_weight_override: row.get::<usize, Option<i32>>(7),
        arrowhead_override: row.get::<usize, Option<String>>(8).unwrap_or_default(),
        color_override: row.get::<usize, Option<String>>(9).unwrap_or_default(),
        attribute_values: attribute_values_by_relationship_id
            .get(&relationship_id)
            .cloned()
            .unwrap_or_default(),
        created_at: row.get(10),
        updated_at: row.get(11),
    };
    emit_postgres_experiment_project_change(&app, &project_id, "relationship", &created.id, "created");
    Ok(created)
}

#[tauri::command]
async fn update_postgres_experiment_relationship_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: UpdatePostgresExperimentRelationshipRequest,
) -> Result<PostgresExperimentRelationship, String> {
    let project_id = request.project_id.trim().to_string();
    let relationship_id = request.relationship_id.trim().to_string();
    let from_object_id = request.from_object_id.trim().to_string();
    let to_object_id = request.to_object_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape_override = request
        .line_shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let line_weight_override = request.line_weight_override;
    let arrowhead_override = request
        .arrowhead_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() || relationship_id.is_empty() {
        return Err("Project and relationship identifiers are required.".to_string());
    }
    if from_object_id.is_empty() || to_object_id.is_empty() {
        return Err("Choose both objects for the relationship.".to_string());
    }
    if relationship_type_id.is_empty() {
        return Err("Choose a relationship type.".to_string());
    }
    if let Some(line_weight_override) = line_weight_override {
        if !(1..=4).contains(&line_weight_override) {
            return Err("Line weight override must be between 1 and 4.".to_string());
        }
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let _session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (relationship_type_id, relationship_type_name, allowed_from_object_type_ids, allowed_to_object_type_ids) =
        load_postgres_experiment_relationship_type_for_client(&client, &relationship_type_id).await?;
    validate_postgres_experiment_relationship_type_constraints_for_client(
        &client,
        &from_object_id,
        &to_object_id,
        &relationship_type_name,
        &allowed_from_object_type_ids,
        &allowed_to_object_type_ids,
    ).await?;
    let row = client
        .query_one(
            "
            UPDATE object_relationships
            SET from_object_id = $2,
                to_object_id = $3,
                relationship_type_id = $4,
                relationship_type = $5,
                description = $6,
                line_shape_override = $7,
                line_weight_override = $8,
                arrowhead_override = $9,
                color_override = $10,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override, created_at::text, updated_at::text
            ",
            &[&relationship_id, &from_object_id, &to_object_id, &relationship_type_id, &relationship_type_name, &description, &line_shape_override, &line_weight_override, &arrowhead_override, &color_override],
        )
        .await
        .map_err(|e| format!("Could not update PostgreSQL experiment relationship: {e}"))?;
    save_postgres_experiment_relationship_attribute_values_for_client(&*client, &relationship_id, &relationship_type_id, &attribute_values).await?;
    let attribute_values_by_relationship_id = load_postgres_experiment_relationship_attribute_values_for_client(&client).await?;
    connection_task.abort();
    let updated = PostgresExperimentRelationship {
        id: row.get(0),
        project_id: project_id.clone(),
        from_object_id: row.get(1),
        to_object_id: row.get(2),
        relationship_type_id: row.get(3),
        relationship_type: row.get(4),
        description: row.get(5),
        line_shape_override: row.get::<usize, Option<String>>(6).unwrap_or_default(),
        line_weight_override: row.get::<usize, Option<i32>>(7),
        arrowhead_override: row.get::<usize, Option<String>>(8).unwrap_or_default(),
        color_override: row.get::<usize, Option<String>>(9).unwrap_or_default(),
        attribute_values: attribute_values_by_relationship_id
            .get(&relationship_id)
            .cloned()
            .unwrap_or_default(),
        created_at: row.get(10),
        updated_at: row.get(11),
    };
    emit_postgres_experiment_project_change(&app, &project_id, "relationship", &relationship_id, "updated");
    Ok(updated)
}

#[tauri::command]
async fn save_postgres_experiment_relationship_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    request: SavePostgresExperimentRelationshipRequest,
) -> Result<PostgresExperimentRelationship, String> {
    let project_id = request.project_id.trim().to_string();
    let relationship_id = request
        .relationship_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let from_object_id = request.from_object_id.trim().to_string();
    let to_object_id = request.to_object_id.trim().to_string();
    let relationship_type_id = request.relationship_type_id.trim().to_string();
    let description = request.description.trim().to_string();
    let line_shape_override = request
        .line_shape_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let line_weight_override = request.line_weight_override;
    let arrowhead_override = request
        .arrowhead_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let color_override = request
        .color_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let attribute_values = request.attribute_values.clone();

    if project_id.is_empty() {
        return Err("Project id is required.".to_string());
    }
    if from_object_id.is_empty() || to_object_id.is_empty() {
        return Err("Choose both objects for the relationship.".to_string());
    }
    if relationship_type_id.is_empty() {
        return Err("Choose a relationship type.".to_string());
    }
    if let Some(line_weight_override) = line_weight_override {
        if !(1..=4).contains(&line_weight_override) {
            return Err("Line weight override must be between 1 and 4.".to_string());
        }
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (mut client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let (relationship_type_id, relationship_type_name, allowed_from_object_type_ids, allowed_to_object_type_ids) =
        load_postgres_experiment_relationship_type_for_client(&client, &relationship_type_id).await?;
    validate_postgres_experiment_relationship_type_constraints_for_client(
        &client,
        &from_object_id,
        &to_object_id,
        &relationship_type_name,
        &allowed_from_object_type_ids,
        &allowed_to_object_type_ids,
    )
    .await?;

    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("Could not begin PostgreSQL experiment relationship save: {e}"))?;
    let created = relationship_id.is_none();
    let resolved_relationship_id = relationship_id.unwrap_or_else(generate_identifier);
    let row = if created {
        tx.query_one(
            "
            INSERT INTO object_relationships (id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override, created_at::text, updated_at::text
            ",
            &[&resolved_relationship_id, &from_object_id, &to_object_id, &relationship_type_id, &relationship_type_name, &description, &line_shape_override, &line_weight_override, &arrowhead_override, &color_override],
        )
        .await
    } else {
        tx.query_one(
            "
            UPDATE object_relationships
            SET from_object_id = $2,
                to_object_id = $3,
                relationship_type_id = $4,
                relationship_type = $5,
                description = $6,
                line_shape_override = $7,
                line_weight_override = $8,
                arrowhead_override = $9,
                color_override = $10,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, from_object_id, to_object_id, relationship_type_id, relationship_type, description, line_shape_override, line_weight_override, arrowhead_override, color_override, created_at::text, updated_at::text
            ",
            &[&resolved_relationship_id, &from_object_id, &to_object_id, &relationship_type_id, &relationship_type_name, &description, &line_shape_override, &line_weight_override, &arrowhead_override, &color_override],
        )
        .await
    }
    .map_err(|e| format!("Could not save PostgreSQL experiment relationship: {e}"))?;

    save_postgres_experiment_relationship_attribute_values_for_client(
        &tx,
        &resolved_relationship_id,
        &relationship_type_id,
        &attribute_values,
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| format!("Could not commit PostgreSQL experiment relationship save: {e}"))?;
    let attribute_values_by_relationship_id =
        load_postgres_experiment_relationship_attribute_values_for_client(&client).await?;
    let saved = PostgresExperimentRelationship {
        id: resolved_relationship_id.clone(),
        project_id: project_id.clone(),
        from_object_id: row.get(1),
        to_object_id: row.get(2),
        relationship_type_id: row.get(3),
        relationship_type: row.get(4),
        description: row.get(5),
        line_shape_override: row.get::<usize, Option<String>>(6).unwrap_or_default(),
        line_weight_override: row.get::<usize, Option<i32>>(7),
        arrowhead_override: row.get::<usize, Option<String>>(8).unwrap_or_default(),
        color_override: row.get::<usize, Option<String>>(9).unwrap_or_default(),
        attribute_values: attribute_values_by_relationship_id
            .get(&resolved_relationship_id)
            .cloned()
            .unwrap_or_default(),
        created_at: row.get(10),
        updated_at: row.get(11),
    };
    let log_label = if created {
        format!("Added relationship \"{}\"", saved.relationship_type)
    } else {
        format!("Updated relationship \"{}\"", saved.relationship_type)
    };
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        if created { "relationship.create" } else { "relationship.update" },
        &log_label,
        Some(&saved.id),
        Some(serde_json::json!({
            "relationshipType": saved.relationship_type,
            "fromObjectId": saved.from_object_id,
            "toObjectId": saved.to_object_id,
            "attributeValueCount": saved.attribute_values.len(),
            "changedFields": if created { serde_json::Value::Null } else { serde_json::json!(["from_object_id", "to_object_id", "relationship_type_id", "description", "line_shape_override", "line_weight_override", "arrowhead_override", "color_override", "attribute_values"]) },
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(
        &app,
        &project_id,
        "relationship",
        &resolved_relationship_id,
        if created { "created" } else { "updated" },
    );
    Ok(saved)
}

#[tauri::command]
async fn delete_postgres_experiment_relationship_command(
    app: tauri::AppHandle,
    runtime_auth_state: tauri::State<'_, PostgresExperimentAuthState>,
    project_id: String,
    relationship_id: String,
) -> Result<DeletePostgresExperimentRelationshipResult, String> {
    let project_id = project_id.trim().to_string();
    let relationship_id = relationship_id.trim().to_string();
    if project_id.is_empty() || relationship_id.is_empty() {
        return Err("Project and relationship identifiers are required.".to_string());
    }

    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    let session = require_postgres_experiment_project_access(&app, Some(&runtime_auth_state), &project).await?;
    ensure_postgres_experiment_project_schema(&app, &project.database_name).await?;
    let (client, connection_task) = connect_postgres_database(&app, &project.database_name).await?;
    let deleted_relationship_type = client
        .query_opt("SELECT relationship_type FROM object_relationships WHERE id = $1", &[&relationship_id])
        .await
        .map_err(|e| format!("Could not inspect PostgreSQL experiment relationship before deletion: {e}"))?
        .map(|row| row.get::<usize, String>(0));
    client
        .execute("DELETE FROM object_relationships WHERE id = $1", &[&relationship_id])
        .await
        .map_err(|e| format!("Could not delete PostgreSQL experiment relationship: {e}"))?;
    append_postgres_experiment_project_log_for_client(
        &client,
        &project_id,
        &session,
        "relationship.delete",
        "Deleted a relationship",
        Some(&relationship_id),
        Some(serde_json::json!({
            "relationshipType": deleted_relationship_type,
        })),
    ).await?;
    connection_task.abort();
    emit_postgres_experiment_project_change(&app, &project_id, "relationship", &relationship_id, "deleted");
    Ok(DeletePostgresExperimentRelationshipResult { project_id, relationship_id })
}

#[tauri::command]
fn get_smoke_test_config_command(app: tauri::AppHandle) -> Result<SmokeTestConfig, String> {
    let app_data_dir = kanqual_data_dir(&app)?;
    Ok(SmokeTestConfig {
        enabled: smoke_test_enabled(),
        run_id: smoke_test_env_var("KANQUAL_SMOKE_RUN_ID"),
        state_path: smoke_test_state_path().map(|path| path.to_string_lossy().to_string()),
        user_name: smoke_test_env_var("KANQUAL_SMOKE_USER_NAME"),
        user_email: smoke_test_env_var("KANQUAL_SMOKE_USER_EMAIL"),
        user_password: smoke_test_env_var("KANQUAL_SMOKE_USER_PASSWORD"),
        project_name: smoke_test_env_var("KANQUAL_SMOKE_PROJECT_NAME"),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        portable_mode: is_portable_mode()?,
    })
}

#[tauri::command]
fn update_smoke_test_state_command(
    app: tauri::AppHandle,
    request: SmokeTestStateUpdateRequest,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "phase": request.phase,
        "message": request.message,
        "success": request.success,
        "failure": request.failure,
        "projectId": request.project_id,
        "userEmail": request.user_email,
        "appDataDir": request
            .app_data_dir
            .unwrap_or_else(|| kanqual_data_dir(&app).map(|path| path.to_string_lossy().to_string()).unwrap_or_default()),
        "portableMode": request.portable_mode.unwrap_or_else(|| is_portable_mode().unwrap_or(false)),
        "updatedAtMs": current_time_ms(),
    });
    write_smoke_test_state(&app, payload)
}

async fn authenticate_internal_superuser(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
) -> Result<String, String> {
    let identity = load_or_create_backend_identity(app)?;
    let response = client
        .post(format!("{PB_URL}/api/collections/_superusers/auth-with-password"))
        .header("User-Agent", "Kanqual/0.9")
        .json(&serde_json::json!({
            "identity": identity.superuser_email,
            "password": identity.superuser_password,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: PocketBaseAdminAuthResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(payload.token)
}

async fn delete_collection_records(
    client: &reqwest::Client,
    token: &str,
    collection_name: &str,
) -> Result<(), String> {
    let mut page = 1_u32;
    loop {
        let response = client
            .get(format!("{PB_URL}/api/collections/{collection_name}/records"))
            .bearer_auth(token)
            .query(&[
                ("page", page.to_string()),
                ("perPage", "500".to_string()),
                ("fields", "id".to_string()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let response = response.error_for_status().map_err(|e| e.to_string())?;
        let payload: PocketBaseListResponse<PocketBaseRecordId> =
            response.json().await.map_err(|e| e.to_string())?;

        if payload.items.is_empty() {
            break;
        }

        for record in payload.items {
            client
                .delete(format!("{PB_URL}/api/collections/{collection_name}/records/{}", record.id))
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
        }

        if page >= payload.total_pages {
            break;
        }
        page += 1;
    }

    Ok(())
}

async fn find_user_by_email(
    client: &reqwest::Client,
    token: &str,
    email: &str,
) -> Result<Option<Value>, String> {
    let response = client
        .get(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(token)
        .query(&[
            ("page", "1".to_string()),
            ("perPage", "1".to_string()),
            ("filter", format!("email=\"{}\"", email.replace('\\', "\\\\").replace('"', "\\\""))),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: PocketBaseListResponse<Value> = response.json().await.map_err(|e| e.to_string())?;
    Ok(payload.items.into_iter().next())
}

async fn find_project_role_for_user(
    client: &reqwest::Client,
    token: &str,
    project_id: &str,
    user_id: &str,
) -> Result<Option<String>, String> {
    let response = client
        .get(format!("{PB_URL}/api/collections/project_members/records"))
        .bearer_auth(token)
        .query(&[
            ("page", "1".to_string()),
            ("perPage", "1".to_string()),
            (
                "filter",
                format!(
                    "project=\"{}\"&&user=\"{}\"",
                    escape_filter_value(project_id),
                    escape_filter_value(user_id)
                ),
            ),
            ("fields", "role".to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: PocketBaseListResponse<Value> = response.json().await.map_err(|e| e.to_string())?;
    Ok(payload
        .items
        .into_iter()
        .next()
        .and_then(|value| value.get("role").and_then(Value::as_str).map(ToString::to_string)))
}

fn normalized_app_role(role: Option<String>) -> String {
    match role.as_deref().map(str::trim) {
        Some("administrator") => "administrator".to_string(),
        _ => "standard".to_string(),
    }
}

fn normalized_project_role(role: Option<&str>) -> String {
    match role.map(str::trim) {
        Some("owner") => "owner".to_string(),
        Some("editor") => "editor".to_string(),
        Some("coder") => "coder".to_string(),
        _ => "viewer".to_string(),
    }
}

struct RequestingUserContext {
    user_id: String,
    app_role: String,
}

async fn authenticate_requesting_user(
    client: &reqwest::Client,
    user_token: &str,
) -> Result<RequestingUserContext, String> {
    let trimmed_token = user_token.trim();
    if trimmed_token.is_empty() {
        return Err("You must be signed in to perform this action.".to_string());
    }

    let response = client
        .post(format!("{PB_URL}/api/collections/users/auth-refresh"))
        .bearer_auth(trimmed_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response
        .error_for_status()
        .map_err(|_| "Your session is no longer valid. Please sign in again.".to_string())?;
    let payload: PocketBaseAuthRefreshResponse = response.json().await.map_err(|e| e.to_string())?;
    let user_id = payload
        .record
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "PocketBase did not return a valid user record.".to_string())?
        .to_string();
    let app_role = payload
        .record
        .get("app_role")
        .and_then(Value::as_str)
        .unwrap_or("standard")
        .trim()
        .to_string();

    Ok(RequestingUserContext { user_id, app_role })
}

async fn ensure_requesting_administrator(
    client: &reqwest::Client,
    user_token: &str,
) -> Result<RequestingUserContext, String> {
    let context = authenticate_requesting_user(client, user_token).await?;
    if context.app_role != "administrator" {
        return Err("Only a local administrator can perform this action.".to_string());
    }
    Ok(context)
}

fn escape_filter_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn app_role_allows_embedding_model_management(app_role: &str) -> bool {
    app_role == "administrator"
}

fn project_role_allows_embedding_build(role: Option<&str>) -> bool {
    matches!(role.map(str::trim), Some("owner") | Some("editor"))
}

fn open_rules_json() -> Value {
    serde_json::json!({
        "listRule": AUTH_RULE,
        "viewRule": AUTH_RULE,
        "createRule": AUTH_RULE,
        "updateRule": AUTH_RULE,
        "deleteRule": AUTH_RULE,
    })
}

fn auto_date_fields_json() -> Vec<Value> {
    vec![
        serde_json::json!({
            "name": "created",
            "type": "autodate",
            "system": true,
            "hidden": false,
            "presentable": false,
            "onCreate": true,
            "onUpdate": false
        }),
        serde_json::json!({
            "name": "updated",
            "type": "autodate",
            "system": true,
            "hidden": false,
            "presentable": false,
            "onCreate": true,
            "onUpdate": true
        }),
    ]
}

fn json_object(value: Value) -> Result<serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "PocketBase returned an unexpected JSON payload.".to_string())
}

fn value_id(value: &Value) -> Result<String, String> {
    value
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "PocketBase returned an object without an id.".to_string())
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}

fn field_name(field: &Value) -> Option<&str> {
    field.get("name").and_then(Value::as_str)
}

fn field_exists(fields: &[Value], name: &str) -> bool {
    fields.iter().any(|field| field_name(field) == Some(name))
}

fn merge_field_definition(existing: &Value, definition: &Value) -> Value {
    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if let Some(def_object) = definition.as_object() {
        for (key, value) in def_object {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

async fn pb_get_json(
    client: &reqwest::Client,
    token: &str,
    path: &str,
    query: Option<&[(&str, String)]>,
) -> Result<Value, String> {
    let mut request = client
        .get(format!("{PB_URL}{path}"))
        .bearer_auth(token);
    if let Some(query_pairs) = query {
        request = request.query(query_pairs);
    }
    let response = request
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

async fn pb_post_json(
    client: &reqwest::Client,
    token: &str,
    path: &str,
    payload: &Value,
) -> Result<Value, String> {
    let response = client
        .post(format!("{PB_URL}{path}"))
        .bearer_auth(token)
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

async fn pb_patch_json(
    client: &reqwest::Client,
    token: &str,
    path: &str,
    payload: &Value,
) -> Result<Value, String> {
    let response = client
        .patch(format!("{PB_URL}{path}"))
        .bearer_auth(token)
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

async fn get_collection_by_name(
    client: &reqwest::Client,
    token: &str,
    name: &str,
) -> Result<Option<Value>, String> {
    let response = client
        .get(format!("{PB_URL}/api/collections/{name}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    Ok(Some(response.json().await.map_err(|e| e.to_string())?))
}

async fn update_collection(
    client: &reqwest::Client,
    token: &str,
    collection_id: &str,
    payload: &Value,
) -> Result<(), String> {
    pb_patch_json(client, token, &format!("/api/collections/{collection_id}"), payload).await?;
    Ok(())
}

async fn create_collection(
    client: &reqwest::Client,
    token: &str,
    payload: &Value,
) -> Result<(), String> {
    pb_post_json(client, token, "/api/collections", payload).await?;
    Ok(())
}

async fn get_first_record_by_filter(
    client: &reqwest::Client,
    token: &str,
    collection_name: &str,
    filter: &str,
) -> Result<Option<Value>, String> {
    let payload = pb_get_json(
        client,
        token,
        &format!("/api/collections/{collection_name}/records"),
        Some(&[
            ("page", "1".to_string()),
            ("perPage", "1".to_string()),
            ("filter", filter.to_string()),
        ]),
    )
    .await?;
    let items = payload
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(items.into_iter().next())
}

async fn create_record(
    client: &reqwest::Client,
    token: &str,
    collection_name: &str,
    payload: &Value,
) -> Result<Value, String> {
    pb_post_json(
        client,
        token,
        &format!("/api/collections/{collection_name}/records"),
        payload,
    )
    .await
}

async fn update_record(
    client: &reqwest::Client,
    token: &str,
    collection_name: &str,
    record_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    pb_patch_json(
        client,
        token,
        &format!("/api/collections/{collection_name}/records/{record_id}"),
        payload,
    )
    .await
}

async fn list_records(
    client: &reqwest::Client,
    token: &str,
    collection_name: &str,
    query: &[(&str, String)],
) -> Result<Vec<Value>, String> {
    let payload = pb_get_json(
        client,
        token,
        &format!("/api/collections/{collection_name}/records"),
        Some(query),
    )
    .await?;
    Ok(payload
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn ensure_metadata_value_http(
    client: &reqwest::Client,
    token: &str,
    key: &str,
) -> Result<String, String> {
    let filter = format!("key=\"{}\"", escape_filter_value(key));
    if let Some(existing) = get_first_record_by_filter(client, token, APP_METADATA_COLLECTION, &filter).await? {
        if let Some(value) = existing.get("value").and_then(Value::as_str).filter(|value| !value.is_empty()) {
            return Ok(value.to_string());
        }
        let generated = generate_identifier();
        update_record(
            client,
            token,
            APP_METADATA_COLLECTION,
            &value_id(&existing)?,
            &serde_json::json!({ "value": generated }),
        )
        .await?;
        return Ok(generated);
    }

    let generated = generate_identifier();
    create_record(
        client,
        token,
        APP_METADATA_COLLECTION,
        &serde_json::json!({ "key": key, "value": generated }),
    )
    .await?;
    Ok(generated)
}

async fn backfill_user_identifiers_http(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    let users = list_records(
        client,
        token,
        "users",
        &[("page", "1".to_string()), ("perPage", "500".to_string()), ("sort", "created".to_string())],
    )
    .await?;
    for user in users {
        let missing = value_string(&user, "user_identifier")
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        if missing {
            update_record(
                client,
                token,
                "users",
                &value_id(&user)?,
                &serde_json::json!({ "user_identifier": generate_identifier() }),
            )
            .await?;
        }
    }
    Ok(())
}

async fn backfill_user_app_roles_http(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    let users = list_records(
        client,
        token,
        "users",
        &[("page", "1".to_string()), ("perPage", "500".to_string()), ("sort", "created".to_string())],
    )
    .await?;
    if users.is_empty() {
        return Ok(());
    }

    let has_administrator = users.iter().any(|user| value_string(user, "app_role").as_deref() == Some("administrator"));
    let first_user_id = users.first().and_then(|user| value_string(user, "id")).unwrap_or_default();

    for user in users {
        let user_id = value_id(&user)?;
        let current_role = value_string(&user, "app_role").unwrap_or_default();
        let normalized_role = if !has_administrator && user_id == first_user_id {
            "administrator".to_string()
        } else {
            normalized_app_role(Some(current_role.clone()))
        };
        if current_role.trim() != normalized_role {
            update_record(
                client,
                token,
                "users",
                &user_id,
                &serde_json::json!({ "app_role": normalized_role }),
            )
            .await?;
        }
    }
    Ok(())
}

async fn backfill_project_member_roles_http(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    let memberships = list_records(
        client,
        token,
        "project_members",
        &[("page", "1".to_string()), ("perPage", "500".to_string()), ("sort", "created".to_string())],
    )
    .await?;
    if memberships.is_empty() {
        return Ok(());
    }

    let mut by_project: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for membership in memberships {
        let id = value_id(&membership)?;
        let project_id = value_string(&membership, "project").unwrap_or_default();
        let current_role = value_string(&membership, "role").unwrap_or_default();
        let normalized_role = normalized_project_role(Some(&current_role));
        if current_role != normalized_role {
            update_record(
                client,
                token,
                "project_members",
                &id,
                &serde_json::json!({ "role": normalized_role }),
            )
            .await?;
        }
        by_project.entry(project_id).or_default().push((id, normalized_role));
    }

    for memberships in by_project.values() {
        if !memberships.iter().any(|(_, role)| role == "owner") {
            if let Some((membership_id, _)) = memberships.first() {
                update_record(
                    client,
                    token,
                    "project_members",
                    membership_id,
                    &serde_json::json!({ "role": "owner" }),
                )
                .await?;
            }
        }
    }
    Ok(())
}

async fn backfill_document_types_http(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    let documents = list_records(
        client,
        token,
        "documents",
        &[
            ("page", "1".to_string()),
            ("perPage", "500".to_string()),
            ("sort", "created".to_string()),
            ("filter", "deleted_at=\"\"".to_string()),
        ],
    )
    .await
    .unwrap_or_default();

    for document in documents {
        let missing = value_string(&document, "type")
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        if missing {
            update_record(
                client,
                token,
                "documents",
                &value_id(&document)?,
                &serde_json::json!({ "type": "Text" }),
            )
            .await?;
        }
    }
    Ok(())
}

async fn upsert_collection_http(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    definition: Value,
    exact_fields: bool,
) -> Result<(), String> {
    let open_rules = open_rules_json();
    let auto_date_fields = auto_date_fields_json();
    let definition_object = json_object(definition)?;
    let definition_fields = definition_object
        .get("fields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(existing) = get_collection_by_name(client, token, name).await? {
        let existing_id = value_id(&existing)?;
        let existing_fields = existing
            .get("fields")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let needs_rule_update =
            existing.get("listRule") != open_rules.get("listRule")
                || existing.get("viewRule") != open_rules.get("viewRule")
                || existing.get("createRule") != open_rules.get("createRule")
                || existing.get("updateRule") != open_rules.get("updateRule")
                || existing.get("deleteRule") != open_rules.get("deleteRule");

        let missing_custom: Vec<Value> = definition_fields
            .iter()
            .filter(|field| !field_name(field).map(|name| field_exists(&existing_fields, name)).unwrap_or(false))
            .cloned()
            .collect();

        let merged_existing: Vec<Value> = existing_fields
            .iter()
            .map(|existing_field| {
                if let Some(name) = field_name(existing_field) {
                    if let Some(definition_field) = definition_fields
                        .iter()
                        .find(|definition_field| field_name(definition_field) == Some(name))
                    {
                        return merge_field_definition(existing_field, definition_field);
                    }
                }
                existing_field.clone()
            })
            .collect();

        let existing_changed = merged_existing != existing_fields;
        let pruned_fields: Vec<Value> = if exact_fields {
            merged_existing
                .iter()
                .filter(|field| {
                    field_name(field)
                        .map(|name| {
                            definition_fields.iter().any(|df| field_name(df) == Some(name))
                                || auto_date_fields.iter().any(|df| field_name(df) == Some(name))
                        })
                        .unwrap_or(false)
                })
                .cloned()
                .collect()
        } else {
            merged_existing.clone()
        };
        let extra_fields_removed = exact_fields && pruned_fields.len() != merged_existing.len();

        let missing_dates: Vec<Value> = auto_date_fields
            .iter()
            .filter(|field| !field_name(field).map(|name| field_exists(&existing_fields, name)).unwrap_or(false))
            .cloned()
            .collect();

        if needs_rule_update || !missing_dates.is_empty() || !missing_custom.is_empty() || existing_changed || extra_fields_removed {
            let mut patch = serde_json::Map::new();
            if needs_rule_update {
                if let Some(rules) = open_rules.as_object() {
                    for (key, value) in rules {
                        patch.insert(key.clone(), value.clone());
                    }
                }
            }
            if !missing_dates.is_empty() || !missing_custom.is_empty() || existing_changed || extra_fields_removed {
                let mut fields = pruned_fields;
                fields.extend(missing_custom);
                fields.extend(missing_dates);
                patch.insert("fields".to_string(), Value::Array(fields));
            }
            update_collection(client, token, &existing_id, &Value::Object(patch)).await?;
        }
        return Ok(());
    }

    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), Value::String(name.to_string()));
    payload.insert("type".to_string(), Value::String("base".to_string()));
    if let Some(rules) = open_rules.as_object() {
        for (key, value) in rules {
            payload.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in definition_object {
        if key != "fields" {
            payload.insert(key, value);
        }
    }
    let mut fields = definition_fields;
    fields.extend(auto_date_fields);
    payload.insert("fields".to_string(), Value::Array(fields));
    create_collection(client, token, &Value::Object(payload)).await
}

async fn ensure_backend_setup_http(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    if let Some(users_collection) = get_collection_by_name(client, token, "users").await? {
        let existing_fields = users_collection
            .get("fields")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let has_user_identifier = field_exists(&existing_fields, "user_identifier");
        let has_must_change_password = field_exists(&existing_fields, "must_change_password");
        let has_app_role = field_exists(&existing_fields, "app_role");
        let needs_user_patch =
            users_collection.get("listRule") != Some(&Value::String(AUTH_RULE.to_string()))
                || users_collection.get("viewRule") != Some(&Value::String(AUTH_RULE.to_string()))
                || users_collection.get("createRule") != Some(&Value::String(String::new()))
                || users_collection.get("updateRule") != Some(&Value::String(AUTH_RULE.to_string()))
                || users_collection.get("deleteRule") != Some(&Value::String(AUTH_RULE.to_string()))
                || users_collection.get("authRule") != Some(&Value::String(String::new()))
                || !has_user_identifier
                || !has_must_change_password
                || !has_app_role;
        if needs_user_patch {
            let mut fields = existing_fields.clone();
            if !has_user_identifier {
                fields.push(serde_json::json!({ "name": "user_identifier", "type": "text" }));
            }
            if !has_must_change_password {
                fields.push(serde_json::json!({ "name": "must_change_password", "type": "bool" }));
            }
            if !has_app_role {
                fields.push(serde_json::json!({
                    "name": "app_role",
                    "type": "select",
                    "required": true,
                    "maxSelect": 1,
                    "values": ["administrator", "standard"]
                }));
            }
            update_collection(
                client,
                token,
                &value_id(&users_collection)?,
                &serde_json::json!({
                    "listRule": AUTH_RULE,
                    "viewRule": AUTH_RULE,
                    "createRule": "",
                    "updateRule": AUTH_RULE,
                    "deleteRule": AUTH_RULE,
                    "authRule": "",
                    "fields": fields
                }),
            )
            .await?;
        }
    }

    upsert_collection_http(
        client,
        token,
        APP_METADATA_COLLECTION,
        serde_json::json!({
            "fields": [
                { "name": "key", "type": "text", "required": true },
                { "name": "value", "type": "text", "required": true }
            ]
        }),
        false,
    )
    .await?;

    ensure_metadata_value_http(client, token, BACKEND_IDENTIFIER_KEY).await?;
    ensure_metadata_value_http(client, token, USERS_TABLE_IDENTIFIER_KEY).await?;
    backfill_user_identifiers_http(client, token).await?;
    backfill_user_app_roles_http(client, token).await?;

    upsert_collection_http(client, token, "projects", serde_json::json!({
        "fields": [
            { "name": "name", "type": "text", "required": true },
            { "name": "description", "type": "text" },
            { "name": "backend_identifier", "type": "text" },
            { "name": "users_table_identifier", "type": "text" }
        ]
    }), false).await?;

    let projects = get_collection_by_name(client, token, "projects").await?
        .ok_or_else(|| "The projects collection is missing after setup.".to_string())?;
    let projects_id = value_id(&projects)?;

    upsert_collection_http(client, token, "project_settings", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "ai_assist_enabled", "type": "bool" },
            { "name": "ai_semantic_search_allowed", "type": "bool" },
            { "name": "ai_question_answering_allowed", "type": "bool" },
            { "name": "ai_summaries_allowed", "type": "bool" },
            { "name": "ai_code_suggestions_allowed", "type": "bool" },
            { "name": "ai_draft_reports_allowed", "type": "bool" },
            { "name": "ai_host_embedding_model_installed", "type": "bool" },
            { "name": "ai_host_llm_enabled", "type": "bool" },
            { "name": "ai_host_llm_model_selected", "type": "bool" },
            { "name": "ai_host_llm_connection_live", "type": "bool" },
            { "name": "ai_host_project_embeddings_ready", "type": "bool" },
            { "name": "ai_host_runtime_checked_at", "type": "text" },
            { "name": "backup_hourly_hours", "type": "number" },
            { "name": "backup_daily_days", "type": "number" },
            { "name": "backup_weekly_weeks", "type": "number" },
            { "name": "backup_automatic_interval_minutes", "type": "number" },
            { "name": "document_import_store_original_file_name", "type": "bool" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "ai_jobs", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "job_type", "type": "select", "required": true, "maxSelect": 1, "values": ["project_chat", "document_processing", "attribute_suggestions", "embedding_build", "relevant_segments_search", "code_conceptual_summary", "most_typical_annotation", "code_decomposition", "code_position", "code_unique_annotations"] },
            { "name": "status", "type": "select", "required": true, "maxSelect": 1, "values": ["queued", "running", "completed", "error"] },
            { "name": "request_json", "type": "json" },
            { "name": "result_json", "type": "json" },
            { "name": "error_message", "type": "text" },
            { "name": "host_message", "type": "text" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "project_ai_chats", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "created_by_name", "type": "text" },
            { "name": "participant_users", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 100 },
            { "name": "participant_identifiers_json", "type": "text" },
            { "name": "title", "type": "text", "required": true },
            { "name": "last_message_at", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    let project_ai_chats = get_collection_by_name(client, token, "project_ai_chats").await?
        .ok_or_else(|| "The project_ai_chats collection is missing after setup.".to_string())?;
    let project_ai_chats_id = value_id(&project_ai_chats)?;

    upsert_collection_http(client, token, "project_ai_chat_messages", serde_json::json!({
        "fields": [
            { "name": "chat", "type": "relation", "collectionId": project_ai_chats_id, "required": true, "maxSelect": 1 },
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "role", "type": "select", "required": true, "maxSelect": 1, "values": ["user", "assistant"] },
            { "name": "text", "type": "text", "required": true, "max": 10000000 },
            { "name": "metadata_json", "type": "text", "max": 10000000 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "created_by_name", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "project_members", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "user", "type": "relation", "collectionId": "_pb_users_auth_", "required": true, "maxSelect": 1 },
            { "name": "user_identifier", "type": "text" },
            { "name": "role", "type": "select", "required": true, "maxSelect": 1, "values": ["owner", "editor", "coder", "viewer"] },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "last_active", "type": "text" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "documents", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "type", "type": "text", "required": true },
            { "name": "file_path", "type": "text" },
            { "name": "content", "type": "text", "max": 10000000, "required": false },
            { "name": "structured_content_json", "type": "text", "max": 10000000 },
            { "name": "notes", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), true).await?;
    backfill_document_types_http(client, token).await?;

    upsert_collection_http(client, token, "codes", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "label", "type": "text", "required": true },
            { "name": "color", "type": "text", "required": true },
            { "name": "description", "type": "text" },
            { "name": "shortcut", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" }
        ]
    }), false).await?;
    let codes = get_collection_by_name(client, token, "codes").await?
        .ok_or_else(|| "The codes collection is missing after setup.".to_string())?;
    let codes_id = value_id(&codes)?;
    upsert_collection_http(client, token, "codes", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "label", "type": "text", "required": true },
            { "name": "color", "type": "text", "required": true },
            { "name": "description", "type": "text" },
            { "name": "shortcut", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "parent", "type": "relation", "collectionId": codes_id, "maxSelect": 1 },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;

    let documents = get_collection_by_name(client, token, "documents").await?
        .ok_or_else(|| "The documents collection is missing after setup.".to_string())?;
    let documents_id = value_id(&documents)?;

    upsert_collection_http(client, token, "document_locks", serde_json::json!({
        "fields": [
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 },
            { "name": "user", "type": "relation", "collectionId": "_pb_users_auth_", "required": true, "maxSelect": 1 },
            { "name": "user_name", "type": "text", "required": true },
            { "name": "expires_at_ms", "type": "number", "required": true }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "document_lock_kicks", serde_json::json!({
        "fields": [
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 },
            { "name": "user", "type": "relation", "collectionId": "_pb_users_auth_", "required": true, "maxSelect": 1 },
            { "name": "kicked_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "kicked_by_name", "type": "text", "required": true },
            { "name": "expires_at_ms", "type": "number", "required": true }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "annotations", serde_json::json!({
        "fields": [
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 },
            { "name": "code", "type": "relation", "collectionId": codes_id, "required": true, "maxSelect": 1 },
            { "name": "start_offset", "type": "number", "required": false },
            { "name": "end_offset", "type": "number", "required": false },
            { "name": "quote", "type": "text", "required": true },
            { "name": "note", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), true).await?;

    let annotations = get_collection_by_name(client, token, "annotations").await?
        .ok_or_else(|| "The annotations collection is missing after setup.".to_string())?;
    let annotations_id = value_id(&annotations)?;
    upsert_collection_http(client, token, "memos", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "document", "type": "relation", "collectionId": documents_id, "maxSelect": 9999 },
            { "name": "annotation", "type": "relation", "collectionId": annotations_id, "maxSelect": 9999 },
            { "name": "title", "type": "text", "required": true },
            { "name": "body", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    backfill_project_member_roles_http(client, token).await?;

    upsert_collection_http(client, token, "processed_document_reviews", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 },
            { "name": "document_name", "type": "text", "required": true },
            { "name": "file_path", "type": "text" },
            { "name": "status", "type": "select", "required": true, "maxSelect": 1, "values": ["pending_review", "reviewed"] },
            { "name": "model", "type": "text" },
            { "name": "base_url", "type": "text" },
            { "name": "chunk_count", "type": "number" },
            { "name": "processed_chunk_count", "type": "number" },
            { "name": "processing_status", "type": "text" },
            { "name": "processing_error", "type": "text" },
            { "name": "chunk_manifest_json", "type": "text", "max": 1000000 },
            { "name": "processing_started_at", "type": "text" },
            { "name": "processing_completed_at", "type": "text" },
            { "name": "last_processed_chunk_index", "type": "number" },
            { "name": "source_content_hash", "type": "text" },
            { "name": "processed_content", "type": "text", "max": 10000000 },
            { "name": "segments_json", "type": "text", "max": 10000000 },
            { "name": "proper_name_candidates_json", "type": "text", "max": 1000000 },
            { "name": "enabled_review_lenses_json", "type": "text" },
            { "name": "exported_to_project", "type": "bool" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), true).await?;

    upsert_collection_http(client, token, "cases", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "notes", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    let cases = get_collection_by_name(client, token, "cases").await?
        .ok_or_else(|| "The cases collection is missing after setup.".to_string())?;
    let cases_id = value_id(&cases)?;
    upsert_collection_http(client, token, "project_uploaded_files", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "document", "type": "relation", "collectionId": documents_id, "maxSelect": 1 },
            { "name": "case", "type": "relation", "collectionId": cases_id, "maxSelect": 1 },
            { "name": "uploaded_file", "type": "file", "required": true, "maxSelect": 1, "maxSize": 104857600, "mimeTypes": [], "thumbs": [], "protected": false },
            { "name": "original_file_name", "type": "text" },
            { "name": "mime_type", "type": "text" },
            { "name": "size_bytes", "type": "number" },
            { "name": "source_kind", "type": "select", "required": true, "maxSelect": 1, "values": ["document", "case", "other"] },
            { "name": "status", "type": "select", "required": true, "maxSelect": 1, "values": ["active", "processed", "orphaned", "deleted"] },
            { "name": "status_history_json", "type": "text", "max": 1000000 },
            { "name": "content_hash", "type": "text" },
            { "name": "import_summary_json", "type": "text", "max": 1000000 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "case_documents", serde_json::json!({
        "fields": [
            { "name": "case", "type": "relation", "collectionId": cases_id, "required": true, "maxSelect": 1 },
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "case_attributes", serde_json::json!({
        "fields": [
            { "name": "case", "type": "relation", "collectionId": cases_id, "required": true, "maxSelect": 1 },
            { "name": "key", "type": "text", "required": true },
            { "name": "value", "type": "text" },
            { "name": "sort_order", "type": "number" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "case_attribute_definitions", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "data_type", "type": "select", "required": true, "values": ["text", "number", "datetime", "categorical"] },
            { "name": "description", "type": "text" },
            { "name": "options_json", "type": "text" },
            { "name": "sort_order", "type": "number" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    let case_attribute_definitions = get_collection_by_name(client, token, "case_attribute_definitions").await?
        .ok_or_else(|| "The case_attribute_definitions collection is missing after setup.".to_string())?;
    let case_attribute_definitions_id = value_id(&case_attribute_definitions)?;
    upsert_collection_http(client, token, "case_attribute_values", serde_json::json!({
        "fields": [
            { "name": "case", "type": "relation", "collectionId": cases_id, "required": true, "maxSelect": 1 },
            { "name": "attribute", "type": "relation", "collectionId": case_attribute_definitions_id, "required": true, "maxSelect": 1 },
            { "name": "value", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "document_attribute_definitions", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "data_type", "type": "select", "required": true, "values": ["text", "number", "datetime", "categorical"] },
            { "name": "description", "type": "text" },
            { "name": "options_json", "type": "text" },
            { "name": "sort_order", "type": "number" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    let document_attribute_definitions = get_collection_by_name(client, token, "document_attribute_definitions").await?
        .ok_or_else(|| "The document_attribute_definitions collection is missing after setup.".to_string())?;
    let document_attribute_definitions_id = value_id(&document_attribute_definitions)?;
    upsert_collection_http(client, token, "document_attribute_values", serde_json::json!({
        "fields": [
            { "name": "document", "type": "relation", "collectionId": documents_id, "required": true, "maxSelect": 1 },
            { "name": "attribute", "type": "relation", "collectionId": document_attribute_definitions_id, "required": true, "maxSelect": 1 },
            { "name": "value", "type": "text" },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "memos", serde_json::json!({
        "fields": [
            { "name": "cases", "type": "relation", "collectionId": cases_id, "maxSelect": 9999 },
            { "name": "codes", "type": "relation", "collectionId": codes_id, "maxSelect": 9999 },
            { "name": "case_attribute_defs", "type": "relation", "collectionId": case_attribute_definitions_id, "maxSelect": 9999 },
            { "name": "document_attribute_defs", "type": "relation", "collectionId": document_attribute_definitions_id, "maxSelect": 9999 }
        ]
    }), false).await?;

    upsert_collection_http(client, token, "project_log", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "user", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "user_identifier", "type": "text" },
            { "name": "user_name", "type": "text" },
            { "name": "access_mode", "type": "select", "values": ["local", "remote"], "maxSelect": 1 },
            { "name": "action", "type": "text", "required": true },
            { "name": "label", "type": "text", "required": true },
            { "name": "record_id", "type": "text" },
            { "name": "details_json", "type": "json" },
            { "name": "occurred_at", "type": "autodate", "system": false, "hidden": false, "presentable": false, "onCreate": true, "onUpdate": false },
            { "name": "restored_at", "type": "text" }
        ]
    }), false).await?;

    if get_collection_by_name(client, token, "project_presence").await?.is_none() {
        create_collection(
            client,
            token,
            &serde_json::json!({
                "name": "project_presence",
                "type": "base",
                "listRule": AUTH_RULE,
                "viewRule": AUTH_RULE,
                "createRule": "@request.auth.id != '' && user = @request.auth.id",
                "updateRule": "@request.auth.id != '' && user = @request.auth.id",
                "deleteRule": "@request.auth.id != '' && user = @request.auth.id",
                "indexes": [
                    "CREATE UNIQUE INDEX `idx_project_presence_session` ON `project_presence` (`project`, `user`, `client_id`)"
                ],
                "fields": [
                    { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
                    { "name": "user", "type": "relation", "collectionId": "_pb_users_auth_", "required": true, "maxSelect": 1 },
                    { "name": "user_identifier", "type": "text" },
                    { "name": "user_name", "type": "text" },
                    { "name": "client_id", "type": "text", "required": true },
                    { "name": "view", "type": "text", "required": true },
                    { "name": "last_seen", "type": "text", "required": true },
                    { "name": "session_started_at", "type": "text", "required": true }
                ]
            }),
        )
        .await?;
    }

    upsert_collection_http(client, token, "code_reports", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "cases", "type": "relation", "collectionId": cases_id, "maxSelect": 100 },
            { "name": "documents", "type": "relation", "collectionId": documents_id, "maxSelect": 100 },
            { "name": "codes", "type": "relation", "collectionId": codes_id, "maxSelect": 100 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "snapshot", "type": "text", "max": LARGE_REPORT_SNAPSHOT_MAX },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "coder_reports", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "coders", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 100 },
            { "name": "cases", "type": "relation", "collectionId": cases_id, "maxSelect": 100 },
            { "name": "documents", "type": "relation", "collectionId": documents_id, "maxSelect": 100 },
            { "name": "codes", "type": "relation", "collectionId": codes_id, "maxSelect": 100 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "coder_identifiers", "type": "text" },
            { "name": "snapshot", "type": "text", "max": LARGE_REPORT_SNAPSHOT_MAX },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "ai_analyses", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "code", "type": "relation", "collectionId": codes_id, "maxSelect": 1 },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "snapshot", "type": "text", "max": LARGE_REPORT_SNAPSHOT_MAX },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;
    upsert_collection_http(client, token, "ai_attribute_suggestion_runs", serde_json::json!({
        "fields": [
            { "name": "project", "type": "relation", "collectionId": projects_id, "required": true, "maxSelect": 1 },
            { "name": "name", "type": "text", "required": true },
            { "name": "target_kind", "type": "select", "required": true, "maxSelect": 1, "values": ["case", "document"] },
            { "name": "attribute_id", "type": "text" },
            { "name": "attribute_name", "type": "text" },
            { "name": "created_by", "type": "relation", "collectionId": "_pb_users_auth_", "maxSelect": 1 },
            { "name": "created_by_identifier", "type": "text" },
            { "name": "snapshot", "type": "text", "max": LARGE_REPORT_SNAPSHOT_MAX },
            { "name": "deleted_at", "type": "text" }
        ]
    }), false).await?;

    Ok(())
}

#[tauri::command]
async fn delete_user_account_command(
    app: tauri::AppHandle,
    auth_token: String,
    user_id: String,
) -> Result<(), String> {
    let trimmed_user_id = user_id.trim();
    if trimmed_user_id.is_empty() {
        return Err("A user id is required.".to_string());
    }

    let client = reqwest::Client::new();
    let requester = ensure_requesting_administrator(&client, &auth_token).await?;
    if requester.user_id == trimmed_user_id {
        return Err("Administrators cannot delete their own active account from this action.".to_string());
    }
    let token = authenticate_internal_superuser(&app, &client).await?;
    client
        .delete(format!("{PB_URL}/api/collections/users/records/{trimmed_user_id}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn create_user_account_command(
    app: tauri::AppHandle,
    request: AuthenticatedCreateUserAccountCommandRequest,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    ensure_requesting_administrator(&client, &request.auth_token).await?;
    let token = authenticate_internal_superuser(&app, &client).await?;
    let payload = serde_json::json!({
        "name": request.request.name,
        "email": request.request.email,
        "password": request.request.password,
        "passwordConfirm": request.request.password_confirm,
        "emailVisibility": true,
        "user_identifier": request.request.user_identifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(generate_identifier),
        "must_change_password": request.request.must_change_password.unwrap_or(false),
        "app_role": normalized_app_role(request.request.app_role),
    });
    let response = client
        .post(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let record: Value = response.json().await.map_err(|e| e.to_string())?;
    record
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "PocketBase did not return the new user id.".to_string())
}

#[tauri::command]
async fn register_user_account_command(
    app: tauri::AppHandle,
    request: RegisterUserAccountCommandRequest,
) -> Result<RegisterUserAccountCommandResponse, String> {
    let client = reqwest::Client::new();
    let token = authenticate_internal_superuser(&app, &client).await?;
    let response = client
        .get(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(&token)
        .query(&[
            ("page", "1".to_string()),
            ("perPage", "1".to_string()),
            ("fields", "id".to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: PocketBaseListResponse<PocketBaseRecordId> =
        response.json().await.map_err(|e| e.to_string())?;
    let app_role = if payload.items.is_empty() { "administrator" } else { "standard" };

    let create_payload = serde_json::json!({
        "name": request.name,
        "email": request.email,
        "password": request.password,
        "passwordConfirm": request.password_confirm,
        "emailVisibility": true,
        "user_identifier": generate_identifier(),
        "must_change_password": false,
        "app_role": app_role,
    });
    let response = client
        .post(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(token)
        .json(&create_payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let record: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(RegisterUserAccountCommandResponse {
        id: record
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        app_role: app_role.to_string(),
    })
}

#[tauri::command]
async fn ensure_imported_user_account_command(
    app: tauri::AppHandle,
    request: AuthenticatedEnsureImportedUserAccountCommandRequest,
) -> Result<EnsureImportedUserAccountCommandResponse, String> {
    let client = reqwest::Client::new();
    ensure_requesting_administrator(&client, &request.auth_token).await?;
    let token = authenticate_internal_superuser(&app, &client).await?;
    let email = request.request.email.trim().to_lowercase();
    let name = {
        let trimmed = request.request.name.trim();
        if trimmed.is_empty() {
            email.split('@').next().unwrap_or("Imported User").to_string()
        } else {
            trimmed.to_string()
        }
    };

    if let Some(existing) = find_user_by_email(&client, &token, &email).await? {
        let existing_id = existing
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "PocketBase returned an invalid user record.".to_string())?
            .to_string();
        let existing_name = existing.get("name").and_then(Value::as_str).unwrap_or_default();
        if !name.is_empty() && existing_name != name {
            client
                .patch(format!("{PB_URL}/api/collections/users/records/{existing_id}"))
                .bearer_auth(&token)
                .json(&serde_json::json!({ "name": name }))
                .send()
                .await
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
        }
        return Ok(EnsureImportedUserAccountCommandResponse {
            id: existing_id,
            created: false,
            temporary_password: None,
        });
    }

    let provided_password = request.request.password.unwrap_or_default();
    let using_generated_password = provided_password.trim().is_empty();
    let final_password = if using_generated_password {
        generate_temporary_password()
    } else {
        provided_password.trim().to_string()
    };

    let create_payload = serde_json::json!({
        "name": name,
        "email": email,
        "emailVisibility": true,
        "user_identifier": generate_identifier(),
        "must_change_password": true,
        "password": final_password,
        "passwordConfirm": final_password,
        "app_role": "standard",
    });
    let response = client
        .post(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(token)
        .json(&create_payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let record: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(EnsureImportedUserAccountCommandResponse {
        id: record
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        created: true,
        temporary_password: if using_generated_password {
            Some(final_password)
        } else {
            None
        },
    })
}

#[tauri::command]
async fn update_user_account_command(
    app: tauri::AppHandle,
    request: AuthenticatedUpdateUserAccountRequest,
) -> Result<(), String> {
    let trimmed_user_id = request.request.user_id.trim();
    if trimmed_user_id.is_empty() {
        return Err("A user id is required.".to_string());
    }

    let client = reqwest::Client::new();
    let requester = ensure_requesting_administrator(&client, &request.auth_token).await?;

    let mut payload = serde_json::Map::new();
    if let Some(name) = request.request.name {
        payload.insert("name".to_string(), Value::String(name));
    }
    if let Some(email) = request.request.email {
        payload.insert("email".to_string(), Value::String(email));
    }
    if payload.is_empty() {
        return Ok(());
    }

    if requester.user_id == trimmed_user_id && payload.contains_key("email") {
        return Err("Administrators cannot change their own account email from this action.".to_string());
    }

    let token = authenticate_internal_superuser(&app, &client).await?;
    client
        .patch(format!("{PB_URL}/api/collections/users/records/{trimmed_user_id}"))
        .bearer_auth(token)
        .json(&Value::Object(payload))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn clear_app_data_records_command(app: tauri::AppHandle, auth_token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    ensure_requesting_administrator(&client, &auth_token).await?;
    let token = authenticate_internal_superuser(&app, &client).await?;

    let response = client
        .get(format!("{PB_URL}/api/collections"))
        .bearer_auth(&token)
        .query(&[
            ("page", "1"),
            ("perPage", "500"),
            ("fields", "name,system"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: PocketBaseListResponse<PocketBaseCollectionInfo> =
        response.json().await.map_err(|e| e.to_string())?;

    let mut ordered_collections = payload
        .items
        .into_iter()
        .filter(|collection| !collection.system && collection.name != "users" && collection.name != APP_METADATA_COLLECTION)
        .map(|collection| collection.name)
        .collect::<Vec<_>>();
    ordered_collections.push("users".to_string());

    for collection_name in ordered_collections {
        delete_collection_records(&client, &token, &collection_name).await?;
    }

    Ok(())
}

#[tauri::command]
async fn get_registered_user_count_command(app: tauri::AppHandle) -> Result<u32, String> {
    let client = reqwest::Client::new();
    let token = authenticate_internal_superuser(&app, &client).await?;
    let response = client
        .get(format!("{PB_URL}/api/collections/users/records"))
        .bearer_auth(token)
        .query(&[
            ("page", "1".to_string()),
            ("perPage", "1".to_string()),
            ("fields", "id".to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let total_items = payload
        .get("totalItems")
        .and_then(Value::as_u64)
        .ok_or_else(|| "PocketBase did not return a valid user count.".to_string())?;
    u32::try_from(total_items).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_registered_user_accounts_command(
    app: tauri::AppHandle,
    request: AuthenticatedRegisteredUsersRequest,
) -> Result<Vec<RegisteredUserAccountSummary>, String> {
    let client = reqwest::Client::new();
    ensure_requesting_administrator(&client, &request.auth_token).await?;
    let token = authenticate_internal_superuser(&app, &client).await?;

    let mut page = 1_u32;
    let mut users = Vec::new();

    loop {
        let response = client
            .get(format!("{PB_URL}/api/collections/users/records"))
            .bearer_auth(&token)
            .query(&[
                ("page", page.to_string()),
                ("perPage", "500".to_string()),
                ("sort", "created".to_string()),
                ("fields", "id,name,email,app_role".to_string()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let response = response.error_for_status().map_err(|e| e.to_string())?;
        let payload: PocketBaseListResponse<Value> = response.json().await.map_err(|e| e.to_string())?;

        for record in payload.items {
            users.push(RegisteredUserAccountSummary {
                id: value_id(&record)?,
                name: value_string(&record, "name").unwrap_or_default(),
                email: value_string(&record, "email").unwrap_or_default(),
                app_role: normalized_app_role(value_string(&record, "app_role")),
            });
        }

        if page >= payload.total_pages.max(1) {
            break;
        }
        page += 1;
    }

    Ok(users)
}

#[tauri::command]
async fn ensure_backend_setup_command(_app: tauri::AppHandle) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let token = authenticate_internal_superuser(&_app, &client).await?;
    ensure_backend_setup_http(&client, &token).await?;
    Ok(true)
}

fn build_encrypted_backup_argon2() -> Result<Argon2<'static>, String> {
    let params = Params::new(
        ENCRYPTED_BACKUP_ARGON2_MEMORY_KIB,
        ENCRYPTED_BACKUP_ARGON2_ITERATIONS,
        ENCRYPTED_BACKUP_ARGON2_PARALLELISM,
        Some(32),
    )
    .map_err(|e| e.to_string())?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

fn derive_encrypted_backup_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    build_encrypted_backup_argon2()?
        .hash_password_into(password, salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

fn ensure_project_backup_json_shape(text: &str) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(text)
        .map_err(|_| "The backup content is not valid JSON.".to_string())?;
    let object = parsed
        .as_object()
        .ok_or_else(|| "The decrypted file is not a Kanqual backup.".to_string())?;
    let kind = object.get("kind").and_then(Value::as_str).unwrap_or_default();
    if kind != "kanqual-project-backup" {
        return Err("The decrypted file is not a Kanqual project backup.".to_string());
    }
    if !object.contains_key("payload") {
        return Err("The decrypted backup is missing its project payload.".to_string());
    }
    Ok(())
}

fn decrypt_encrypted_backup_payload_inner(encrypted_backup: &str, password: &str) -> Result<String, String> {
    let envelope: EncryptedBackupEnvelope = serde_json::from_str(encrypted_backup)
        .map_err(|_| "The selected file is not a valid encrypted Kanqual backup.".to_string())?;
    if envelope.kind != ENCRYPTED_BACKUP_KIND || envelope.version != ENCRYPTED_BACKUP_VERSION {
        return Err("This encrypted backup uses an unsupported Kanqual backup format.".to_string());
    }
    if envelope.cipher != ENCRYPTED_BACKUP_CIPHER {
        return Err("This encrypted backup uses an unsupported encryption algorithm.".to_string());
    }
    if envelope.kdf.name != ENCRYPTED_BACKUP_KDF_NAME {
        return Err("This encrypted backup uses an unsupported key derivation method.".to_string());
    }

    let salt = BASE64_STANDARD
        .decode(envelope.kdf.salt_b64)
        .map_err(|_| "The encrypted backup salt is invalid.".to_string())?;
    let nonce_bytes = BASE64_STANDARD
        .decode(envelope.nonce_b64)
        .map_err(|_| "The encrypted backup nonce is invalid.".to_string())?;
    let ciphertext = BASE64_STANDARD
        .decode(envelope.ciphertext_b64)
        .map_err(|_| "The encrypted backup ciphertext is invalid.".to_string())?;

    if nonce_bytes.len() != ENCRYPTED_BACKUP_NONCE_BYTES {
        return Err("The encrypted backup nonce length is invalid.".to_string());
    }

    let password = Zeroizing::new(password.as_bytes().to_vec());
    let key = derive_encrypted_backup_key(password.as_slice(), &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Incorrect password or corrupted encrypted backup.".to_string())?;
    let plaintext = String::from_utf8(plaintext)
        .map_err(|_| "The decrypted backup is not valid UTF-8 text.".to_string())?;
    ensure_project_backup_json_shape(&plaintext)?;
    Ok(plaintext)
}

#[tauri::command]
fn encrypt_project_backup(request: EncryptProjectBackupRequest) -> Result<String, String> {
    if request.password.trim().is_empty() {
        return Err("Please enter a password for the encrypted backup.".to_string());
    }
    ensure_project_backup_json_shape(&request.backup_json)?;

    let mut salt = [0_u8; ENCRYPTED_BACKUP_SALT_BYTES];
    let mut nonce_bytes = [0_u8; ENCRYPTED_BACKUP_NONCE_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let password = Zeroizing::new(request.password.into_bytes());
    let key = derive_encrypted_backup_key(password.as_slice(), &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, request.backup_json.as_bytes())
        .map_err(|_| "Failed to encrypt the backup.".to_string())?;

    let envelope = EncryptedBackupEnvelope {
        kind: ENCRYPTED_BACKUP_KIND.to_string(),
        version: ENCRYPTED_BACKUP_VERSION,
        cipher: ENCRYPTED_BACKUP_CIPHER.to_string(),
        kdf: EncryptedBackupKdfSpec {
            name: ENCRYPTED_BACKUP_KDF_NAME.to_string(),
            memory_kib: ENCRYPTED_BACKUP_ARGON2_MEMORY_KIB,
            iterations: ENCRYPTED_BACKUP_ARGON2_ITERATIONS,
            parallelism: ENCRYPTED_BACKUP_ARGON2_PARALLELISM,
            salt_b64: BASE64_STANDARD.encode(salt),
        },
        nonce_b64: BASE64_STANDARD.encode(nonce_bytes),
        ciphertext_b64: BASE64_STANDARD.encode(ciphertext),
    };

    serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())
}

#[tauri::command]
fn decrypt_project_backup_payload(request: DecryptProjectBackupRequest) -> Result<String, String> {
    decrypt_encrypted_backup_payload_inner(&request.encrypted_backup, &request.password)
}

#[tauri::command]
fn decrypt_project_backup_preview(request: DecryptProjectBackupRequest) -> Result<DecryptedProjectBackupPreview, String> {
    let plaintext = decrypt_encrypted_backup_payload_inner(&request.encrypted_backup, &request.password)?;
    let parsed: Value = serde_json::from_str(&plaintext)
        .map_err(|_| "The decrypted backup is not valid JSON.".to_string())?;
    let object = parsed
        .as_object()
        .ok_or_else(|| "The decrypted file is not a Kanqual backup.".to_string())?;

    Ok(DecryptedProjectBackupPreview {
        project_name: object
            .get("projectName")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Imported Project")
            .to_string(),
        created_at: object.get("createdAt").and_then(Value::as_str).map(ToString::to_string),
        version: object
            .get("version")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
    })
}

fn embedding_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = kanqual_data_dir(app)?;
    Ok(app_data_dir
        .join("models")
        .join("huggingface")
        .join(EMBEDDING_MODEL_REPO_ID.replace('/', "__")))
}

fn ollama_base_url(protocol: &str, host: &str, port: u16) -> String {
    format!(
        "{}://{}:{}",
        if protocol.eq_ignore_ascii_case("https") { "https" } else { "http" },
        host.trim().trim_end_matches('/'),
        port,
    )
}

fn project_embedding_index_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let app_data_dir = kanqual_data_dir(app)?;
    Ok(app_data_dir.join("ai").join("project_indexes").join(project_id))
}

fn project_embedding_metadata_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(project_embedding_index_dir(app, project_id)?.join(PROJECT_EMBEDDING_METADATA_FILE))
}

fn project_embedding_metadata_temp_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(project_embedding_index_dir(app, project_id)?.join(format!("{PROJECT_EMBEDDING_METADATA_FILE}.tmp")))
}

fn cleanup_stale_project_embedding_metadata_temp_file(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<(), String> {
    let temp_path = project_embedding_metadata_temp_path(app, project_id)?;
    if temp_path.exists() {
        fs::remove_file(&temp_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn cleanup_stale_embedding_model_partial_files(model_dir: &Path) -> Result<(), String> {
    if !model_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(model_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            cleanup_stale_embedding_model_partial_files(&child_path)?;
            continue;
        }

        let is_partial = child_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.ends_with(".part"))
            .unwrap_or(false);
        if is_partial {
            fs::remove_file(&child_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn collect_directory_stats(path: &Path) -> Result<(u64, u64), String> {
    if !path.exists() {
        return Ok((0, 0));
    }

    let mut files = 0_u64;
    let mut bytes = 0_u64;
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_path = entry.path();
        if child_path.file_name().and_then(|value| value.to_str()) == Some(EMBEDDING_MODEL_METADATA_FILE) {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            let (child_files, child_bytes) = collect_directory_stats(&child_path)?;
            files += child_files;
            bytes += child_bytes;
        } else {
            files += 1;
            bytes += metadata.len();
        }
    }

    Ok((files, bytes))
}

fn file_modified_ms(path: &Path) -> Result<Option<u64>, String> {
    let modified = match fs::metadata(path) {
        Ok(metadata) => match metadata.modified() {
            Ok(value) => value,
            Err(_) => return Ok(None),
        },
        Err(_) => return Ok(None),
    };
    let millis = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    Ok(Some(millis))
}

fn latest_directory_modified_ms(path: &Path) -> Result<Option<u64>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let mut latest = file_modified_ms(path)?;
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_path = entry.path();
        if child_path.file_name().and_then(|value| value.to_str()) == Some(EMBEDDING_MODEL_METADATA_FILE) {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let candidate = if metadata.is_dir() {
            latest_directory_modified_ms(&child_path)?
        } else {
            file_modified_ms(&child_path)?
        };
        if let Some(candidate_ms) = candidate {
            latest = Some(latest.map_or(candidate_ms, |current| current.max(candidate_ms)));
        }
    }

    Ok(latest)
}

fn embedding_model_metadata_path(model_dir: &Path) -> PathBuf {
    model_dir.join(EMBEDDING_MODEL_METADATA_FILE)
}

fn set_project_embedding_build_status(
    state: &tauri::State<'_, ProjectEmbeddingBuildState>,
    next: ProjectEmbeddingBuildStatusState,
) {
    let mut guard = state.0.lock().unwrap();
    *guard = next;
}

fn update_project_embedding_build_status_from_handle(
    handle: &tauri::AppHandle,
    update: impl FnOnce(&mut ProjectEmbeddingBuildStatusState),
) {
    let state = handle.state::<ProjectEmbeddingBuildState>();
    let mut guard = state.0.lock().unwrap();
    update(&mut guard);
}

fn is_project_embedding_build_cancel_requested(handle: &tauri::AppHandle) -> bool {
    let state = handle.state::<ProjectEmbeddingBuildState>();
    let cancel_requested = state.0.lock().unwrap().cancel_requested;
    cancel_requested
}

fn read_embedding_model_downloaded_at_ms(model_dir: &Path) -> Result<Option<u64>, String> {
    let metadata_path = embedding_model_metadata_path(model_dir);
    if metadata_path.exists() {
        let raw = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
        let metadata: EmbeddingModelMetadata = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        return Ok(Some(metadata.downloaded_at_ms));
    }
    latest_directory_modified_ms(model_dir)
}

fn write_embedding_model_metadata(model_dir: &Path, downloaded_at_ms: u64) -> Result<(), String> {
    let metadata_path = embedding_model_metadata_path(model_dir);
    let metadata = EmbeddingModelMetadata { downloaded_at_ms };
    let raw = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(metadata_path, raw).map_err(|e| e.to_string())
}

fn set_embedding_download_status(
    state: &tauri::State<'_, EmbeddingModelDownloadState>,
    next: EmbeddingModelDownloadStatusState,
) {
    let mut guard = state.0.lock().unwrap();
    *guard = next;
}

fn update_embedding_download_status(
    state: &tauri::State<'_, EmbeddingModelDownloadState>,
    update: impl FnOnce(&mut EmbeddingModelDownloadStatusState),
) {
    let mut guard = state.0.lock().unwrap();
    update(&mut guard);
}

fn is_embedding_download_cancel_requested(
    state: &tauri::State<'_, EmbeddingModelDownloadState>,
) -> bool {
    state.0.lock().unwrap().cancel_requested
}

fn embedding_model_status(app: &tauri::AppHandle) -> Result<EmbeddingModelStatus, String> {
    let model_dir = embedding_model_dir(app)?;
    cleanup_stale_embedding_model_partial_files(&model_dir)?;
    let installed = model_dir.join("config.json").exists()
        && model_dir.join("modules.json").exists()
        && model_dir.join("tokenizer_config.json").exists()
        && (model_dir.join("model.safetensors").exists() || model_dir.join("pytorch_model.bin").exists());
    let (files, bytes) = collect_directory_stats(&model_dir)?;
    let downloaded_at_ms = if installed {
        read_embedding_model_downloaded_at_ms(&model_dir)?
    } else {
        None
    };

    Ok(EmbeddingModelStatus {
        installed,
        repo_id: EMBEDDING_MODEL_REPO_ID.to_string(),
        display_name: EMBEDDING_MODEL_DISPLAY_NAME.to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        files,
        bytes,
        downloaded_at_ms,
    })
}

fn load_embedding_runtime(app: &tauri::AppHandle) -> Result<LocalEmbeddingRuntime, String> {
    let model_dir = embedding_model_dir(app)?;
    if !model_dir.exists() {
        return Err("The multilingual-e5 model is not installed on this device.".to_string());
    }

    let config_path = model_dir.join("config.json");
    let tokenizer_path = model_dir.join("tokenizer.json");
    let weight_paths = fs::read_dir(&model_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("safetensors"))
        .collect::<Vec<_>>();

    if weight_paths.is_empty() {
        return Err("The installed multilingual-e5 model is missing safetensors weight files.".to_string());
    }

    let config_raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: XlmRobertaConfig = serde_json::from_str(&config_raw).map_err(|e| e.to_string())?;
    let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|e| e.to_string())?;
    let device = Device::Cpu;
    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&weight_paths, DType::F32, &device)
            .map_err(|e| e.to_string())?
    };
    let model = XLMRobertaModel::new(&config, vb).map_err(|e| e.to_string())?;

    Ok(LocalEmbeddingRuntime {
        tokenizer,
        model,
        device,
    })
}

fn embed_text_batch(
    runtime: &mut LocalEmbeddingRuntime,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    runtime
        .tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: 512,
            ..Default::default()
        }))
        .map_err(|e| e.to_string())?;
    runtime.tokenizer.with_padding(Some(PaddingParams {
        strategy: PaddingStrategy::BatchLongest,
        ..Default::default()
    }));

    let encodings = runtime
        .tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| e.to_string())?;

    let input_ids = encodings
        .iter()
        .map(|encoding| encoding.get_ids().to_vec())
        .collect::<Vec<_>>();
    let attention_masks = encodings
        .iter()
        .map(|encoding| encoding.get_attention_mask().to_vec())
        .collect::<Vec<_>>();
    let max_len = input_ids.iter().map(Vec::len).max().unwrap_or(0);
    let token_type_ids = vec![vec![0_u32; max_len]; input_ids.len()];

    let input_ids_tensor = Tensor::new(input_ids, &runtime.device).map_err(|e| e.to_string())?;
    let attention_mask_tensor = Tensor::new(attention_masks.clone(), &runtime.device).map_err(|e| e.to_string())?;
    let token_type_ids_tensor = Tensor::new(token_type_ids, &runtime.device).map_err(|e| e.to_string())?;

    let hidden = runtime
        .model
        .forward(
            &input_ids_tensor,
            &attention_mask_tensor,
            &token_type_ids_tensor,
            None,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;

    let hidden_states = hidden.to_vec3::<f32>().map_err(|e| e.to_string())?;
    let pooled = hidden_states
        .into_iter()
        .zip(attention_masks)
        .map(|(token_vectors, mask)| {
            let hidden_size = token_vectors.first().map(Vec::len).unwrap_or(0);
            let mut summed = vec![0_f32; hidden_size];
            let mut count = 0_f32;

            for (token_vector, attended) in token_vectors.into_iter().zip(mask.into_iter()) {
                if attended == 0 {
                    continue;
                }
                count += 1.0;
                for (index, value) in token_vector.into_iter().enumerate() {
                    summed[index] += value;
                }
            }

            if count > 0.0 {
                for value in &mut summed {
                    *value /= count;
                }
            }

            let norm = summed.iter().map(|value| value * value).sum::<f32>().sqrt();
            if norm > 0.0 {
                for value in &mut summed {
                    *value /= norm;
                }
            }

            summed
        })
        .collect::<Vec<_>>();

    Ok(pooled)
}

struct PlannedProjectEmbeddingChunk {
    vector_id: u64,
    source_type: String,
    source_id: String,
    item: ProjectEmbeddingStoreItem,
    embedding: Option<Vec<f32>>,
}

fn project_embedding_store_item_from_build_item(source_item: &ProjectEmbeddingBuildItem) -> ProjectEmbeddingStoreItem {
    ProjectEmbeddingStoreItem {
        id: source_item.id.clone(),
        item_type: source_item.item_type.clone(),
        source_id: source_item.source_id.clone(),
        title: source_item.title.clone(),
        text: source_item.text.clone(),
        content_hash: source_item.content_hash.clone(),
        document_id: source_item.document_id.clone(),
        case_id: source_item.case_id.clone(),
        code_id: source_item.code_id.clone(),
        annotation_id: source_item.annotation_id.clone(),
        memo_id: source_item.memo_id.clone(),
        start_offset: source_item.start_offset,
        end_offset: source_item.end_offset,
        embedding: Vec::new(),
    }
}

fn build_project_embedding_index(
    app: &tauri::AppHandle,
    request: ProjectEmbeddingBuildRequest,
) -> Result<ProjectEmbeddingStoreSnapshot, String> {
    let total_requested_items = request.sources.iter().map(|source| source.items.len()).sum::<usize>();
    let mut runtime = load_embedding_runtime(app)?;
    let index_dir = project_embedding_index_dir(app, &request.project_id)?;
    fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;

    let batch_size = request
        .batch_size
        .max(1)
        .min(PROJECT_EMBEDDING_BUILD_BATCH_SIZE_CAP);
    let settings_hash = project_embedding_settings_hash(&request);
    let existing_metadata = read_project_embedding_metadata_file(app, &request.project_id).ok();
    let metadata_is_compatible = existing_metadata
        .as_ref()
        .map(|metadata| {
            metadata.settings_hash == settings_hash
                && metadata.model_repo_id == EMBEDDING_MODEL_REPO_ID
                && metadata.chunking_version == PROJECT_EMBEDDING_CHUNKING_VERSION
        })
        .unwrap_or(false);
    let reusable_metadata = if metadata_is_compatible {
        existing_metadata.as_ref()
    } else {
        None
    };

    let existing_active_sources_by_key = reusable_metadata
        .map(|metadata| {
            metadata
                .sources
                .iter()
                .filter(|source| source.active)
                .map(|source| {
                    (
                        project_embedding_source_key(&source.source_type, &source.source_id),
                        source.clone(),
                    )
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let existing_active_chunks_by_source = reusable_metadata
        .map(|metadata| {
            let mut grouped = HashMap::<String, Vec<ProjectEmbeddingMetadataChunk>>::new();
            for chunk in metadata.chunks.iter().filter(|chunk| chunk.active) {
                grouped
                    .entry(project_embedding_source_key(&chunk.source_type, &chunk.source_id))
                    .or_default()
                    .push(chunk.clone());
            }
            grouped
        })
        .unwrap_or_default();

    let mut next_vector_id = existing_metadata
        .as_ref()
        .map(|metadata| metadata.next_vector_id)
        .unwrap_or(1);
    let mut planned_chunks = Vec::<PlannedProjectEmbeddingChunk>::new();
    let mut pending_chunk_indexes = Vec::<usize>::new();
    let mut active_sources = Vec::<ProjectEmbeddingMetadataSource>::new();
    let mut reused_total = 0_u64;
    let mut pending_total = 0_u64;

    for source in &request.sources {
        let source_key = project_embedding_source_key(&source.source_type, &source.source_id);
        let unchanged = existing_active_sources_by_key
            .get(&source_key)
            .map(|existing_source| existing_source.source_hash == source.source_hash)
            .unwrap_or(false);

        if unchanged {
            if let Some(existing_chunks) = existing_active_chunks_by_source.get(&source_key) {
                reused_total += existing_chunks.len() as u64;
                for chunk in existing_chunks {
                    planned_chunks.push(PlannedProjectEmbeddingChunk {
                        vector_id: chunk.vector_id,
                        source_type: chunk.source_type.clone(),
                        source_id: chunk.source_id.clone(),
                        item: chunk.item.clone(),
                        embedding: Some(chunk.item.embedding.clone()),
                    });
                }
            }
            active_sources.push(ProjectEmbeddingMetadataSource {
                source_type: source.source_type.clone(),
                source_id: source.source_id.clone(),
                title: source.title.clone(),
                source_hash: source.source_hash.clone(),
                active: true,
                chunk_count: source.items.len() as u64,
            });
            continue;
        }

        let mut reusable_chunks_by_hash = HashMap::<String, Vec<ProjectEmbeddingMetadataChunk>>::new();
        if let Some(existing_chunks) = existing_active_chunks_by_source.get(&source_key) {
            for chunk in existing_chunks {
                reusable_chunks_by_hash
                    .entry(chunk.item.content_hash.clone())
                    .or_default()
                    .push(chunk.clone());
            }
        }

        for source_item in &source.items {
            if let Some(reusable_chunks) = reusable_chunks_by_hash.get_mut(&source_item.content_hash) {
                if let Some(existing_chunk) = reusable_chunks.pop() {
                    reused_total += 1;
                    let mut item = project_embedding_store_item_from_build_item(source_item);
                    item.embedding = existing_chunk.item.embedding.clone();
                    planned_chunks.push(PlannedProjectEmbeddingChunk {
                        vector_id: existing_chunk.vector_id,
                        source_type: source.source_type.clone(),
                        source_id: source.source_id.clone(),
                        item,
                        embedding: Some(existing_chunk.item.embedding.clone()),
                    });
                    continue;
                }
            }

            let chunk_index = planned_chunks.len();
            planned_chunks.push(PlannedProjectEmbeddingChunk {
                vector_id: next_vector_id,
                source_type: source.source_type.clone(),
                source_id: source.source_id.clone(),
                item: project_embedding_store_item_from_build_item(source_item),
                embedding: None,
            });
            pending_chunk_indexes.push(chunk_index);
            next_vector_id += 1;
            pending_total += 1;
        }

        active_sources.push(ProjectEmbeddingMetadataSource {
            source_type: source.source_type.clone(),
            source_id: source.source_id.clone(),
            title: source.title.clone(),
            source_hash: source.source_hash.clone(),
            active: true,
            chunk_count: source.items.len() as u64,
        });
    }

    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    update_project_embedding_build_status_from_handle(app, |status| {
        status.total_items = pending_total;
        status.completed_items = 0;
        status.started_at_ms = Some(started_at_ms);
        status.current_label = None;
        status.cancel_requested = false;
        status.message = Some(if pending_total == 0 {
            format!(
                "All {} current project items already have matching embeddings. Reusing the existing local index.",
                total_requested_items
            )
        } else if reused_total > 0 {
            format!(
                "Reusing {} unchanged embeddings. Generating {} new or updated multilingual-e5 embeddings.",
                reused_total, pending_total
            )
        } else {
            format!(
                "Generating {} multilingual-e5 embeddings for this project's current content.",
                pending_total
            )
        });
    });

    for batch_start in (0..pending_chunk_indexes.len()).step_by(batch_size) {
        if is_project_embedding_build_cancel_requested(app) {
            return Err("Embedding build cancelled.".to_string());
        }
        let batch_end = (batch_start + batch_size).min(pending_chunk_indexes.len());
        let batch_indexes = &pending_chunk_indexes[batch_start..batch_end];
        let batch_number = (batch_start / batch_size) + 1;
        let batch_count = pending_chunk_indexes.len().div_ceil(batch_size);
        update_project_embedding_build_status_from_handle(app, |status| {
            status.current_label = batch_indexes
                .first()
                .map(|index| planned_chunks[*index].item.title.clone());
            status.message = Some(format!(
                "Embedding batch {} of {} for this project's current content.",
                batch_number, batch_count
            ));
        });
        let texts = batch_indexes
            .iter()
            .map(|index| planned_chunks[*index].item.text.clone())
            .collect::<Vec<_>>();
        let embeddings = embed_text_batch(&mut runtime, &texts)?;
        for (planned_index, embedding) in batch_indexes.iter().zip(embeddings.into_iter()) {
            planned_chunks[*planned_index].item.embedding = embedding.clone();
            planned_chunks[*planned_index].embedding = Some(embedding);
        }

        update_project_embedding_build_status_from_handle(app, |status| {
            status.completed_items = batch_end as u64;
            status.current_label = batch_indexes
                .last()
                .map(|index| planned_chunks[*index].item.title.clone());
            status.message = Some(if reused_total > 0 {
                format!(
                    "Reusing {} unchanged embeddings. Generating {} new or updated multilingual-e5 embeddings.",
                    reused_total, pending_total
                )
            } else {
                format!(
                    "Generating {} multilingual-e5 embeddings for this project's current content.",
                    pending_total
                )
            });
        });
    }

    if is_project_embedding_build_cancel_requested(app) {
        return Err("Embedding build cancelled.".to_string());
    }

    let active_vector_ids = planned_chunks
        .iter()
        .map(|chunk| chunk.vector_id)
        .collect::<HashSet<_>>();
    let active_source_keys = active_sources
        .iter()
        .map(|source| project_embedding_source_key(&source.source_type, &source.source_id))
        .collect::<HashSet<_>>();
    let mut metadata_chunks = existing_metadata
        .as_ref()
        .map(|metadata| {
            metadata
                .chunks
                .iter()
                .filter_map(|chunk| {
                    if !chunk.active {
                        return Some(chunk.clone());
                    }
                    if active_vector_ids.contains(&chunk.vector_id) {
                        None
                    } else {
                        let mut tombstone = chunk.clone();
                        tombstone.active = false;
                        Some(tombstone)
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    metadata_chunks.extend(planned_chunks.iter().map(|chunk| ProjectEmbeddingMetadataChunk {
        vector_id: chunk.vector_id,
        source_type: chunk.source_type.clone(),
        source_id: chunk.source_id.clone(),
        active: true,
        item: chunk.item.clone(),
    }));

    let mut metadata_sources = existing_metadata
        .as_ref()
        .map(|metadata| {
            metadata
                .sources
                .iter()
                .filter_map(|source| {
                    let source_key = project_embedding_source_key(&source.source_type, &source.source_id);
                    if !source.active {
                        return Some(source.clone());
                    }
                    if active_source_keys.contains(&source_key) {
                        None
                    } else {
                        let mut tombstone = source.clone();
                        tombstone.active = false;
                        Some(tombstone)
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    metadata_sources.extend(active_sources.iter().cloned());

    let items = planned_chunks
        .iter()
        .map(|chunk| chunk.item.clone())
        .collect::<Vec<_>>();

    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;

    let metadata = ProjectEmbeddingMetadataFile {
        project_id: request.project_id.clone(),
        model_repo_id: EMBEDDING_MODEL_REPO_ID.to_string(),
        model_display_name: EMBEDDING_MODEL_DISPLAY_NAME.to_string(),
        generated_at_ms,
        chunking_version: PROJECT_EMBEDDING_CHUNKING_VERSION,
        settings_hash: settings_hash.clone(),
        next_vector_id,
        sources: metadata_sources,
        chunks: metadata_chunks,
    };
    write_project_embedding_metadata_file(app, &request.project_id, &metadata)?;

    let index_file = ProjectEmbeddingStoreSnapshot {
        project_id: request.project_id.clone(),
        model_repo_id: EMBEDDING_MODEL_REPO_ID.to_string(),
        model_display_name: EMBEDDING_MODEL_DISPLAY_NAME.to_string(),
        generated_at_ms,
        item_count: items.len() as u64,
        chunk_size: request.chunk_size,
        overlap_size: request.overlap_size,
        prefix_passages: request.prefix_passages,
        normalize_whitespace: request.normalize_whitespace,
        items,
    };
    Ok(index_file)
}

fn hash_embedding_text(text: &str) -> String {
    let mut hash = 0x811c9dc5_u32;
    for &byte in text.as_bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("fnv1a32:{hash:08x}")
}

fn project_embedding_settings_hash(request: &ProjectEmbeddingBuildRequest) -> String {
    hash_embedding_text(&format!(
        "chunk:{}|overlap:{}|prefix:{}|normalize:{}|chunking:{}",
        request.chunk_size,
        request.overlap_size,
        request.prefix_passages,
        request.normalize_whitespace,
        PROJECT_EMBEDDING_CHUNKING_VERSION
    ))
}

fn project_embedding_source_key(source_type: &str, source_id: &str) -> String {
    format!("{source_type}::{source_id}")
}

fn read_project_embedding_store_status(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<ProjectEmbeddingStoreStatus, String> {
    let metadata = match read_project_embedding_metadata_file(app, project_id) {
        Ok(metadata) => metadata,
        Err(_) => {
            return Ok(ProjectEmbeddingStoreStatus {
                exists: false,
                generated_at_ms: None,
                item_count: 0,
                model_repo_id: None,
                model_display_name: None,
            });
        }
    };

    let active_item_count = metadata
        .chunks
        .iter()
        .filter(|chunk| chunk.active)
        .count() as u64;
    if active_item_count == 0 {
        return Ok(ProjectEmbeddingStoreStatus {
            exists: false,
            generated_at_ms: None,
            item_count: 0,
            model_repo_id: None,
            model_display_name: None,
        });
    }
    Ok(ProjectEmbeddingStoreStatus {
        exists: true,
        generated_at_ms: Some(metadata.generated_at_ms),
        item_count: active_item_count,
        model_repo_id: Some(metadata.model_repo_id),
        model_display_name: Some(metadata.model_display_name),
    })
}

fn read_project_embedding_metadata_file(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<ProjectEmbeddingMetadataFile, String> {
    cleanup_stale_project_embedding_metadata_temp_file(app, project_id)?;
    let metadata_path = project_embedding_metadata_path(app, project_id)?;
    if !metadata_path.exists() {
        return Err("No local project embedding metadata exists yet.".to_string());
    }
    let raw = fs::read_to_string(metadata_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_project_embedding_metadata_file(
    app: &tauri::AppHandle,
    project_id: &str,
    metadata: &ProjectEmbeddingMetadataFile,
) -> Result<(), String> {
    cleanup_stale_project_embedding_metadata_temp_file(app, project_id)?;
    let metadata_path = project_embedding_metadata_path(app, project_id)?;
    let metadata_dir = project_embedding_index_dir(app, project_id)?;
    fs::create_dir_all(&metadata_dir).map_err(|e| e.to_string())?;
    let temp_path = project_embedding_metadata_temp_path(app, project_id)?;
    let raw = serde_json::to_string(metadata).map_err(|e| e.to_string())?;
    fs::write(&temp_path, raw).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &metadata_path).map_err(|e| e.to_string())
}

fn load_active_project_embedding_items(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<Vec<ProjectEmbeddingStoreItem>, String> {
    let metadata = read_project_embedding_metadata_file(app, project_id)?;
    Ok(metadata
        .chunks
        .into_iter()
        .filter(|chunk| chunk.active)
        .map(|chunk| chunk.item)
        .collect::<Vec<_>>())
}

fn format_embedding_time_range_label(low_seconds: u64, high_seconds: u64) -> String {
    let low_minutes = ((low_seconds as f64) / 60.0).ceil().max(1.0) as u64;
    let high_minutes = ((high_seconds as f64) / 60.0).ceil().max(low_minutes as f64) as u64;
    if high_seconds <= 90 {
        "Likely under 2 minutes on this device".to_string()
    } else {
        format!("Likely around {}-{} minutes on this device", low_minutes, high_minutes)
    }
}

#[tauri::command]
fn get_project_embedding_store_build_preflight(
    app: tauri::AppHandle,
    request: ProjectEmbeddingBuildRequest,
) -> Result<ProjectEmbeddingBuildPreflight, String> {
    let settings_hash = project_embedding_settings_hash(&request);
    let existing_metadata = read_project_embedding_metadata_file(&app, &request.project_id).ok();
    let metadata_is_compatible = existing_metadata
        .as_ref()
        .map(|metadata| {
            metadata.settings_hash == settings_hash
                && metadata.model_repo_id == EMBEDDING_MODEL_REPO_ID
                && metadata.chunking_version == PROJECT_EMBEDDING_CHUNKING_VERSION
        })
        .unwrap_or(false);
    let reusable_metadata = if metadata_is_compatible {
        existing_metadata.as_ref()
    } else {
        None
    };

    let existing_active_sources_by_key = reusable_metadata
        .map(|metadata| {
            metadata
                .sources
                .iter()
                .filter(|source| source.active)
                .map(|source| {
                    (
                        project_embedding_source_key(&source.source_type, &source.source_id),
                        source.clone(),
                    )
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let existing_active_chunks_by_source = reusable_metadata
        .map(|metadata| {
            let mut grouped = HashMap::<String, Vec<ProjectEmbeddingMetadataChunk>>::new();
            for chunk in metadata.chunks.iter().filter(|chunk| chunk.active) {
                grouped
                    .entry(project_embedding_source_key(&chunk.source_type, &chunk.source_id))
                    .or_default()
                    .push(chunk.clone());
            }
            grouped
        })
        .unwrap_or_default();

    let mut total_items = 0_u64;
    let mut pending_items = 0_u64;
    let mut pending_characters = 0_u64;
    let mut reused_items = 0_u64;

    for source in &request.sources {
        total_items += source.items.len() as u64;
        let source_key = project_embedding_source_key(&source.source_type, &source.source_id);
        let unchanged = existing_active_sources_by_key
            .get(&source_key)
            .map(|existing_source| existing_source.source_hash == source.source_hash)
            .unwrap_or(false);

        if unchanged {
            reused_items += source.items.len() as u64;
            continue;
        }

        let mut reusable_chunks_by_hash = HashMap::<String, Vec<ProjectEmbeddingMetadataChunk>>::new();
        if let Some(existing_chunks) = existing_active_chunks_by_source.get(&source_key) {
            for chunk in existing_chunks {
                reusable_chunks_by_hash
                    .entry(chunk.item.content_hash.clone())
                    .or_default()
                    .push(chunk.clone());
            }
        }

        for source_item in &source.items {
            if let Some(reusable_chunks) = reusable_chunks_by_hash.get_mut(&source_item.content_hash) {
                if reusable_chunks.pop().is_some() {
                    reused_items += 1;
                    continue;
                }
            }
            pending_items += 1;
            pending_characters += source_item.text.chars().count() as u64;
        }
    }

    let parallelism = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .max(1);
    let effective_batch_size = request
        .batch_size
        .max(1)
        .min(PROJECT_EMBEDDING_BUILD_BATCH_SIZE_CAP) as u64;
    let pending_batches = pending_items.div_ceil(effective_batch_size);

    let (estimated_seconds_low, estimated_seconds_high, estimate_label) = if pending_items == 0 {
        (
            None,
            None,
            "No new embeddings should be needed; the existing project index can likely be reused.".to_string(),
        )
    } else {
        let warmup_seconds = 60.0_f64;
        let seconds_per_batch_low = 22.0_f64;
        let seconds_per_batch_high = 34.0_f64;
        let low = (warmup_seconds
            + pending_batches as f64 * seconds_per_batch_low)
            .ceil()
            .max(120.0) as u64;
        let high = (warmup_seconds
            + pending_batches as f64 * seconds_per_batch_high)
            .ceil()
            .max(low as f64 + 120.0) as u64;
        (
            Some(low),
            Some(high),
            format_embedding_time_range_label(low, high),
        )
    };

    Ok(ProjectEmbeddingBuildPreflight {
        total_items,
        pending_items,
        reused_items,
        pending_characters,
        estimated_seconds_low,
        estimated_seconds_high,
        parallelism,
        estimate_label,
    })
}

fn dot_similarity(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| a * b)
        .sum::<f32>()
}

fn citation_preview(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let without_prefix = trimmed.strip_prefix("passage: ").unwrap_or(trimmed);
    let compact = without_prefix.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_chars {
        compact
    } else {
        let mut shortened = compact.chars().take(max_chars.saturating_sub(1)).collect::<String>();
        shortened.push('…');
        shortened
    }
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then_some(&text[start..=end])
}

fn parse_u64_from_value(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_u64) {
            return Some(number);
        }
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            if let Ok(parsed) = text.trim().parse::<u64>() {
                return Some(parsed);
            }
        }
    }
    None
}

fn parse_string_from_value(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_most_typical_annotation_payload(json_content: &str) -> Result<OllamaMostTypicalAnnotationModelResponse, String> {
    if let Ok(parsed) = serde_json::from_str::<OllamaMostTypicalAnnotationModelResponse>(json_content) {
        return Ok(parsed);
    }

    let value: Value = serde_json::from_str(json_content)
        .map_err(|e| format!("Could not parse Ollama's response: {e}"))?;

    let items_value = if let Some(array) = value.as_array() {
        Some(array)
    } else {
        value.get("annotations")
            .or_else(|| value.get("items"))
            .or_else(|| value.get("results"))
            .or_else(|| value.get("typical_annotations"))
            .or_else(|| value.get("typicalAnnotations"))
            .and_then(Value::as_array)
    };

    if let Some(items) = items_value {
        let annotations = items
            .iter()
            .filter_map(|item| {
                let annotation_index = parse_u64_from_value(item, &["annotation_index", "annotationIndex", "index", "annotation"])?;
                let reasoning = parse_string_from_value(item, &["reasoning", "reason", "explanation"]);
                Some(OllamaMostTypicalAnnotationModelItem {
                    annotation_index,
                    reasoning,
                })
            })
            .collect::<Vec<_>>();
        if !annotations.is_empty() {
            return Ok(OllamaMostTypicalAnnotationModelResponse { annotations });
        }
    }

    let annotation_index = parse_u64_from_value(&value, &["annotation_index", "annotationIndex", "index", "annotation"])
        .ok_or_else(|| "Could not find an annotation index in Ollama's response.".to_string())?;
    let reasoning = parse_string_from_value(&value, &["reasoning", "reason", "explanation"]);

    Ok(OllamaMostTypicalAnnotationModelResponse {
        annotations: vec![OllamaMostTypicalAnnotationModelItem {
            annotation_index,
            reasoning,
        }],
    })
}

fn parse_unique_annotations_payload(json_content: &str) -> Result<OllamaUniqueAnnotationsModelResponse, String> {
    if let Ok(parsed) = serde_json::from_str::<OllamaUniqueAnnotationsModelResponse>(json_content) {
        return Ok(parsed);
    }

    let value: Value = serde_json::from_str(json_content)
        .map_err(|e| format!("Could not parse Ollama's response: {e}"))?;

    let items_value = if let Some(array) = value.as_array() {
        Some(array)
    } else {
        value.get("annotations")
            .or_else(|| value.get("items"))
            .or_else(|| value.get("results"))
            .or_else(|| value.get("unique_annotations"))
            .or_else(|| value.get("uniqueAnnotations"))
            .and_then(Value::as_array)
    }
    .ok_or_else(|| "Could not find an annotations array in Ollama's response.".to_string())?;

    let annotations = items_value
        .iter()
        .filter_map(|item| {
            let index = parse_u64_from_value(item, &["index", "annotation_index", "annotationIndex"])?;
            let reasoning = parse_string_from_value(item, &["reasoning", "reason", "explanation"]);
            Some(OllamaUniqueAnnotationModelItem { index, reasoning })
        })
        .collect::<Vec<_>>();

    Ok(OllamaUniqueAnnotationsModelResponse { annotations })
}

fn truncate_for_ollama_prompt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let truncated = trimmed.chars().take(max_chars).collect::<String>();
    format!("{truncated}\n\n[Content truncated for length]")
}

fn relevant_segment_match_text(item: &ProjectEmbeddingStoreItem) -> Option<String> {
    match item.item_type.as_str() {
        "document" => {
            let text = item
                .text
                .trim()
                .strip_prefix("passage: ")
                .unwrap_or(item.text.trim())
                .trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        "annotation" => {
            let text = item.text.trim();
            let quote = text
                .lines()
                .find_map(|line| line.strip_prefix("Quote: "))
                .map(str::trim)
                .filter(|value| !value.is_empty());
            quote.map(ToOwned::to_owned)
        }
        _ => None,
    }
}

fn should_download_model_file(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower == ".gitattributes" || lower.ends_with('/') {
        return false;
    }
    if lower.ends_with(".h5") || lower.ends_with(".msgpack") || lower.ends_with(".ot") {
        return false;
    }
    if lower.contains("/onnx/") || lower.starts_with("onnx/") {
        return false;
    }
    if lower.contains("/openvino/") || lower.starts_with("openvino/") {
        return false;
    }
    true
}

async fn fetch_model_file_list() -> Result<Vec<String>, String> {
    let url = format!(
        "https://huggingface.co/api/models/{}/revision/main",
        EMBEDDING_MODEL_REPO_ID
    );
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "Kanqual/0.1")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let siblings = payload
        .get("siblings")
        .and_then(Value::as_array)
        .ok_or_else(|| "Hugging Face did not return a file list for the model.".to_string())?;

    let files = siblings
        .iter()
        .filter_map(|item| item.get("rfilename").and_then(Value::as_str))
        .filter(|path| should_download_model_file(path))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if files.is_empty() {
        return Err("No downloadable model files were returned by Hugging Face.".to_string());
    }

    Ok(files)
}

async fn download_model_file(
    client: &reqwest::Client,
    relative_path: &str,
    model_dir: &Path,
    state: &tauri::State<'_, EmbeddingModelDownloadState>,
    base_downloaded_bytes: u64,
) -> Result<u64, String> {
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}?download=true",
        EMBEDDING_MODEL_REPO_ID,
        relative_path
    );
    let response = client
        .get(url)
        .header("User-Agent", "Kanqual/0.1")
        .send()
        .await
        .map_err(|e| format!("Failed to request {relative_path}: {e}"))?;
    let response = response
        .error_for_status()
        .map_err(|e| format!("Failed to download {relative_path}: {e}"))?;

    let destination = model_dir.join(relative_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if destination.exists() {
        let existing_size = fs::metadata(&destination).map_err(|e| e.to_string())?.len();
        return Ok(existing_size);
    }

    let temp_path = destination.with_extension(format!(
        "{}.part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
    ));
    let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut file_downloaded_bytes = 0_u64;
    let mut response = response;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if is_embedding_download_cancel_requested(state) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err("Download cancelled.".to_string());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        file_downloaded_bytes += chunk.len() as u64;
        update_embedding_download_status(state, |status| {
            status.downloaded_bytes = base_downloaded_bytes + file_downloaded_bytes;
        });
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&temp_path, &destination).map_err(|e| e.to_string())?;

    Ok(file_downloaded_bytes)
}

#[tauri::command]
fn get_multilingual_e5_status(app: tauri::AppHandle) -> Result<EmbeddingModelStatus, String> {
    embedding_model_status(&app)
}

#[tauri::command]
async fn get_multilingual_e5_download_preflight(
    app: tauri::AppHandle,
) -> Result<EmbeddingModelDownloadPreflight, String> {
    let model_dir = embedding_model_dir(&app)?;
    fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
    cleanup_stale_embedding_model_partial_files(&model_dir)?;
    let status = embedding_model_status(&app)?;
    let (existing_files_total, existing_bytes) = collect_directory_stats(&model_dir)?;
    let total_bytes = EMBEDDING_MODEL_EXPECTED_SIZE_BYTES;
    let remaining_bytes = total_bytes.saturating_sub(existing_bytes);

    match fetch_model_file_list().await {
        Ok(files) => {
            let existing_files = files
                .iter()
                .filter(|relative_path| model_dir.join(relative_path).exists())
                .count() as u64;
            let total_files = files.len() as u64;
            Ok(EmbeddingModelDownloadPreflight {
                installed: status.installed,
                model_dir: status.model_dir,
                total_bytes,
                existing_bytes,
                remaining_bytes,
                total_files: Some(total_files),
                existing_files,
                remaining_files: Some(total_files.saturating_sub(existing_files)),
                manifest_available: true,
                message: None,
            })
        }
        Err(error) => Ok(EmbeddingModelDownloadPreflight {
            installed: status.installed,
            model_dir: status.model_dir,
            total_bytes,
            existing_bytes,
            remaining_bytes,
            total_files: None,
            existing_files: existing_files_total,
            remaining_files: None,
            manifest_available: false,
            message: Some(format!(
                "Could not fetch the remote file manifest. Showing the total model size and local bytes only. {error}"
            )),
        }),
    }
}

#[tauri::command]
fn get_multilingual_e5_download_status(
    state: tauri::State<'_, EmbeddingModelDownloadState>,
) -> EmbeddingModelDownloadStatus {
    state.0.lock().unwrap().clone().into()
}

#[tauri::command]
fn cancel_multilingual_e5_download(
    auth_token: String,
    state: tauri::State<'_, EmbeddingModelDownloadState>,
) -> Result<EmbeddingModelDownloadStatus, String> {
    let client = reqwest::Client::new();
    let requester = tauri::async_runtime::block_on(ensure_requesting_administrator(&client, &auth_token))?;
    if !app_role_allows_embedding_model_management(&requester.app_role) {
        return Err("You do not have permission to manage embedding models on this device.".to_string());
    }
    update_embedding_download_status(&state, |status| {
        if status.phase == "downloading" {
            status.cancel_requested = true;
            status.phase = "cancelling".to_string();
            status.message = Some("Cancelling download...".to_string());
        }
    });
    Ok(state.0.lock().unwrap().clone().into())
}

#[tauri::command]
fn clear_multilingual_e5_model(
    auth_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EmbeddingModelDownloadState>,
) -> Result<EmbeddingModelStatus, String> {
    let client = reqwest::Client::new();
    let requester = tauri::async_runtime::block_on(ensure_requesting_administrator(&client, &auth_token))?;
    if !app_role_allows_embedding_model_management(&requester.app_role) {
        return Err("You do not have permission to manage embedding models on this device.".to_string());
    }
    let current = state.0.lock().unwrap().clone();
    if current.phase == "downloading" || current.phase == "cancelling" {
        return Err("Cancel the current download before clearing local model files.".to_string());
    }

    let model_dir = embedding_model_dir(&app)?;
    if model_dir.exists() {
        fs::remove_dir_all(&model_dir).map_err(|e| e.to_string())?;
    }

    set_embedding_download_status(&state, EmbeddingModelDownloadStatusState {
        phase: "idle".to_string(),
        downloaded_bytes: 0,
        total_bytes: None,
        downloaded_files: 0,
        total_files: 0,
        current_file: None,
        message: Some("Local multilingual-e5 files cleared.".to_string()),
        cancel_requested: false,
    });

    embedding_model_status(&app)
}

#[tauri::command]
async fn download_multilingual_e5_model(
    auth_token: String,
    app: tauri::AppHandle,
    download_state: tauri::State<'_, EmbeddingModelDownloadState>,
) -> Result<EmbeddingModelStatus, String> {
    let client = reqwest::Client::new();
    let requester = ensure_requesting_administrator(&client, &auth_token).await?;
    if !app_role_allows_embedding_model_management(&requester.app_role) {
        return Err("You do not have permission to manage embedding models on this device.".to_string());
    }
    let initial_status = embedding_model_status(&app)?;
    if initial_status.installed {
        set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
            phase: "completed".to_string(),
            downloaded_bytes: initial_status.bytes,
            total_bytes: Some(EMBEDDING_MODEL_EXPECTED_SIZE_BYTES),
            downloaded_files: initial_status.files,
            total_files: initial_status.files,
            current_file: None,
            message: Some(format!("{} is already available on this device.", initial_status.display_name)),
            cancel_requested: false,
        });
        return Ok(initial_status);
    }

    let model_dir = embedding_model_dir(&app)?;
    fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
    cleanup_stale_embedding_model_partial_files(&model_dir)?;

    let files = fetch_model_file_list().await?;
    let client = reqwest::Client::new();
    let existing_files = files
        .iter()
        .filter(|relative_path| model_dir.join(relative_path).exists())
        .count() as u64;
    let mut pending_files = files
        .into_iter()
        .into_iter()
        .filter(|relative_path| !model_dir.join(relative_path).exists())
        .collect::<Vec<_>>();
    let total_files = pending_files.len() as u64;
    let mut downloaded_files = 0_u64;
    let mut downloaded_bytes = collect_directory_stats(&model_dir)?.1;
    let total_bytes = Some(EMBEDDING_MODEL_EXPECTED_SIZE_BYTES);

    pending_files.sort();
    let resume_message = if existing_files > 0 {
        format!("Resuming download. {existing_files} files already present on this device.")
    } else {
        "Downloading embedding model from Hugging Face...".to_string()
    };

    set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
        phase: "downloading".to_string(),
        downloaded_bytes,
        total_bytes,
        downloaded_files,
        total_files,
        current_file: None,
        message: Some(resume_message),
        cancel_requested: false,
    });

    for relative_path in pending_files {
        if is_embedding_download_cancel_requested(&download_state) {
            set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
                phase: "cancelled".to_string(),
                downloaded_bytes,
                total_bytes,
                downloaded_files,
                total_files,
                current_file: None,
                message: Some("Download cancelled.".to_string()),
                cancel_requested: false,
            });
            return embedding_model_status(&app);
        }
        update_embedding_download_status(&download_state, |status| {
            status.current_file = Some(relative_path.clone());
        });
        let file_size = match download_model_file(&client, &relative_path, &model_dir, &download_state, downloaded_bytes).await {
            Ok(size) => size,
            Err(error) => {
                if error == "Download cancelled." {
                    set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
                        phase: "cancelled".to_string(),
                        downloaded_bytes,
                        total_bytes,
                        downloaded_files,
                        total_files,
                        current_file: None,
                        message: Some("Download cancelled.".to_string()),
                        cancel_requested: false,
                    });
                    return embedding_model_status(&app);
                }
                set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
                    phase: "error".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    downloaded_files,
                    total_files,
                    current_file: Some(relative_path.clone()),
                    message: Some(error.clone()),
                    cancel_requested: false,
                });
                return Err(error);
            }
        };
        downloaded_bytes += file_size;
        downloaded_files += 1;
        update_embedding_download_status(&download_state, |status| {
            status.downloaded_bytes = downloaded_bytes;
            status.downloaded_files = downloaded_files;
            status.current_file = None;
        });
    }

    let downloaded_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    write_embedding_model_metadata(&model_dir, downloaded_at_ms)?;

    let final_status = embedding_model_status(&app)?;
    set_embedding_download_status(&download_state, EmbeddingModelDownloadStatusState {
        phase: "completed".to_string(),
        downloaded_bytes: final_status.bytes,
        total_bytes: Some(final_status.bytes),
        downloaded_files: final_status.files,
        total_files: final_status.files,
        current_file: None,
        message: Some(format!("{} downloaded successfully.", final_status.display_name)),
        cancel_requested: false,
    });

    Ok(final_status)
}

#[tauri::command]
async fn discover_ollama_models(
    request: OllamaDiscoveryRequest,
) -> Result<OllamaDiscoveryResult, String> {
    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;

    let version_response = client
        .get(format!("{base_url}/api/version"))
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Ollama responded with an error at {base_url}: {e}"))?;
    let version_payload: Value = version_response.json().await.map_err(|e| e.to_string())?;
    let version = version_payload
        .get("version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    let tags_response = client
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Connected to Ollama but could not load models: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Connected to Ollama but /api/tags returned an error: {e}"))?;
    let tags_payload: Value = tags_response.json().await.map_err(|e| e.to_string())?;

    let models = tags_payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| OllamaModelSummary {
                    name: item.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                    size: item.get("size").and_then(Value::as_u64),
                    modified_at: item.get("modified_at").and_then(Value::as_str).map(ToOwned::to_owned),
                    digest: item.get("digest").and_then(Value::as_str).map(ToOwned::to_owned),
                    parameter_size: item
                        .get("details")
                        .and_then(|details| details.get("parameter_size"))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    quantization_level: item
                        .get("details")
                        .and_then(|details| details.get("quantization_level"))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                })
                .filter(|model| !model.name.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(OllamaDiscoveryResult {
        ok: true,
        base_url: base_url.clone(),
        version,
        model_count: models.len() as u64,
        models,
        message: if tags_payload.get("models").and_then(Value::as_array).map(|items| items.is_empty()).unwrap_or(true) {
            format!("Connected to Ollama at {base_url}, but no models are installed yet.")
        } else {
            format!("Connected to Ollama at {base_url}.")
        },
    })
}

fn cloud_discovery_client(timeout_seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())
}

fn parse_openai_compatible_models(payload: &Value) -> Vec<CloudLlmModelSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(Value::as_str)?.trim().to_string();
                    if id.is_empty() || !is_openai_compatible_chat_model(&id) {
                        return None;
                    }
                    Some(CloudLlmModelSummary {
                        name: id.clone(),
                        id,
                        publisher: item.get("owned_by").and_then(Value::as_str).map(ToOwned::to_owned),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn is_openai_compatible_chat_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let has_chat_prefix = normalized.starts_with("gpt-")
        || normalized.starts_with("chatgpt-")
        || normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
        || normalized.starts_with("codex-");
    if !has_chat_prefix {
        return false;
    }

    !normalized.contains("embedding")
        && !normalized.contains("whisper")
        && !normalized.contains("tts")
        && !normalized.contains("transcribe")
        && !normalized.contains("realtime")
        && !normalized.contains("audio")
        && !normalized.contains("image")
        && !normalized.contains("moderation")
}

fn is_unsupported_temperature_error(detail: &str) -> bool {
    let normalized = detail.to_ascii_lowercase();
    normalized.contains("temperature")
        && (normalized.contains("unsupported_value")
            || normalized.contains("does not support")
            || normalized.contains("only the default"))
}

fn include_temperature_retry_allowed(provider_label: &str, detail: &str) -> bool {
    (provider_label == "OpenAI" || provider_label == "GitHub Models")
        && is_unsupported_temperature_error(detail)
}

fn anthropic_known_models() -> Vec<CloudLlmModelSummary> {
    vec![
        CloudLlmModelSummary {
            id: "claude-sonnet-4-20250514".to_string(),
            name: "Claude Sonnet 4".to_string(),
            publisher: Some("Anthropic".to_string()),
        },
        CloudLlmModelSummary {
            id: "claude-opus-4-20250514".to_string(),
            name: "Claude Opus 4".to_string(),
            publisher: Some("Anthropic".to_string()),
        },
        CloudLlmModelSummary {
            id: "claude-3-7-sonnet-20250219".to_string(),
            name: "Claude Sonnet 3.7".to_string(),
            publisher: Some("Anthropic".to_string()),
        },
        CloudLlmModelSummary {
            id: "claude-3-5-sonnet-20241022".to_string(),
            name: "Claude Sonnet 3.5".to_string(),
            publisher: Some("Anthropic".to_string()),
        },
        CloudLlmModelSummary {
            id: "claude-3-5-haiku-20241022".to_string(),
            name: "Claude Haiku 3.5".to_string(),
            publisher: Some("Anthropic".to_string()),
        },
    ]
}

#[tauri::command]
async fn discover_cloud_llm_models(
    request: CloudLlmDiscoveryRequest,
) -> Result<CloudLlmDiscoveryResult, String> {
    let api_secret = request.api_secret.trim();
    if api_secret.is_empty() {
        return Err("Enter an API secret before testing the cloud connection.".to_string());
    }

    let client = cloud_discovery_client(request.timeout_seconds)?;

    match request.provider {
        CloudLlmProvider::Openai => {
            let base_url = "https://api.openai.com/v1".to_string();
            let payload: Value = client
                .get(format!("{base_url}/models"))
                .bearer_auth(api_secret)
                .send()
                .await
                .map_err(|e| format!("Could not reach OpenAI: {e}"))?
                .error_for_status()
                .map_err(|e| format!("OpenAI responded with an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let models = parse_openai_compatible_models(&payload);
            Ok(CloudLlmDiscoveryResult {
                ok: true,
                provider: "openai".to_string(),
                base_url,
                version: None,
                model_count: models.len() as u64,
                models,
                message: "Connected to OpenAI.".to_string(),
            })
        }
        CloudLlmProvider::Blablador => {
            let base_url = "https://api.blablador.fz-juelich.de/v1".to_string();
            let payload: Value = client
                .get(format!("{base_url}/models"))
                .bearer_auth(api_secret)
                .send()
                .await
                .map_err(|e| format!("Could not reach Blablador: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Blablador responded with an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let models = parse_openai_compatible_models(&payload);
            Ok(CloudLlmDiscoveryResult {
                ok: true,
                provider: "blablador".to_string(),
                base_url,
                version: None,
                model_count: models.len() as u64,
                models,
                message: "Connected to Blablador.".to_string(),
            })
        }
        CloudLlmProvider::Copilot => {
            let base_url = "https://models.github.ai".to_string();
            let payload: Value = client
                .get(format!("{base_url}/catalog/models"))
                .header("Accept", "application/vnd.github+json")
                .header("Authorization", format!("Bearer {api_secret}"))
                .header("X-GitHub-Api-Version", "2026-03-10")
                .send()
                .await
                .map_err(|e| format!("Could not reach GitHub Models: {e}"))?
                .error_for_status()
                .map_err(|e| format!("GitHub Models responded with an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let models = payload
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let id = item.get("id").and_then(Value::as_str)?.trim().to_string();
                            if id.is_empty() {
                                return None;
                            }
                            Some(CloudLlmModelSummary {
                                name: item
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned)
                                    .unwrap_or_else(|| id.clone()),
                                id,
                                publisher: item.get("publisher").and_then(Value::as_str).map(ToOwned::to_owned),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            Ok(CloudLlmDiscoveryResult {
                ok: true,
                provider: "copilot".to_string(),
                base_url,
                version: Some("2026-03-10".to_string()),
                model_count: models.len() as u64,
                models,
                message: "Connected to GitHub Models.".to_string(),
            })
        }
        CloudLlmProvider::Ollama => {
            let base_url = "https://ollama.com/api".to_string();
            let payload: Value = client
                .get(format!("{base_url}/tags"))
                .bearer_auth(api_secret)
                .send()
                .await
                .map_err(|e| format!("Could not reach Ollama Cloud: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Ollama Cloud responded with an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let models = payload
                .get("models")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let id = item.get("name").and_then(Value::as_str)?.trim().to_string();
                            if id.is_empty() {
                                return None;
                            }
                            Some(CloudLlmModelSummary {
                                name: id.clone(),
                                id,
                                publisher: item
                                    .get("digest")
                                    .and_then(Value::as_str)
                                    .map(|_| "Ollama".to_string())
                                    .or(Some("Ollama".to_string())),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            Ok(CloudLlmDiscoveryResult {
                ok: true,
                provider: "ollama".to_string(),
                base_url,
                version: None,
                model_count: models.len() as u64,
                models,
                message: "Connected to Ollama Cloud.".to_string(),
            })
        }
        CloudLlmProvider::Anthropic => {
            let base_url = "https://api.anthropic.com/v1".to_string();
            let verification_model = "claude-sonnet-4-20250514";
            let payload: Value = client
                .get(format!("{base_url}/models/{verification_model}"))
                .header("x-api-key", api_secret)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("Could not reach Anthropic: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Anthropic responded with an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let version = payload
                .get("created_at")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let models = anthropic_known_models();

            Ok(CloudLlmDiscoveryResult {
                ok: true,
                provider: "anthropic".to_string(),
                base_url,
                version,
                model_count: models.len() as u64,
                models,
                message: "Connected to Anthropic.".to_string(),
            })
        }
    }
}

enum ResolvedLlmRuntime {
    Ollama { base_url: String, cloud_auth: Option<String> },
    OpenAiCompat {
        provider_label: &'static str,
        base_url: String,
        api_key: String,
        extra_headers: Vec<(&'static str, String)>,
    },
    Anthropic { base_url: String, api_key: String },
}

fn resolve_llm_runtime(
    connection_mode: Option<&str>,
    cloud_provider: Option<CloudLlmProvider>,
    cloud_api_secret: Option<&str>,
    protocol: &str,
    host: &str,
    port: u16,
) -> Result<ResolvedLlmRuntime, String> {
    if connection_mode == Some("cloud") {
        let provider = cloud_provider.ok_or_else(|| "Choose a cloud provider before using AI Assist.".to_string())?;
        let api_key = cloud_api_secret
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Enter a cloud API secret before using AI Assist.".to_string())?
            .to_string();
        return Ok(match provider {
            CloudLlmProvider::Openai => ResolvedLlmRuntime::OpenAiCompat {
                provider_label: "OpenAI",
                base_url: "https://api.openai.com/v1".to_string(),
                api_key,
                extra_headers: vec![],
            },
            CloudLlmProvider::Blablador => ResolvedLlmRuntime::OpenAiCompat {
                provider_label: "Blablador",
                base_url: "https://api.blablador.fz-juelich.de/v1".to_string(),
                api_key,
                extra_headers: vec![],
            },
            CloudLlmProvider::Copilot => ResolvedLlmRuntime::OpenAiCompat {
                provider_label: "GitHub Models",
                base_url: "https://models.github.ai/inference".to_string(),
                api_key,
                extra_headers: vec![
                    ("Accept", "application/vnd.github+json".to_string()),
                    ("X-GitHub-Api-Version", "2026-03-10".to_string()),
                ],
            },
            CloudLlmProvider::Ollama => ResolvedLlmRuntime::Ollama {
                base_url: "https://ollama.com/api".to_string(),
                cloud_auth: Some(api_key),
            },
            CloudLlmProvider::Anthropic => ResolvedLlmRuntime::Anthropic {
                base_url: "https://api.anthropic.com/v1".to_string(),
                api_key,
            },
        });
    }

    Ok(ResolvedLlmRuntime::Ollama {
        base_url: ollama_base_url(protocol, host, port),
        cloud_auth: None,
    })
}

fn runtime_base_url(runtime: &ResolvedLlmRuntime) -> String {
    match runtime {
        ResolvedLlmRuntime::Ollama { base_url, .. } => base_url.clone(),
        ResolvedLlmRuntime::OpenAiCompat { base_url, .. } => base_url.clone(),
        ResolvedLlmRuntime::Anthropic { base_url, .. } => base_url.clone(),
    }
}

async fn run_llm_chat_completion(
    runtime: &ResolvedLlmRuntime,
    client: &reqwest::Client,
    model: &str,
    system_prompt: &str,
    messages: Vec<Value>,
    temperature: f64,
    num_ctx: u32,
    keep_alive_minutes: u32,
    json_mode: bool,
) -> Result<String, String> {
    match runtime {
        ResolvedLlmRuntime::Ollama { base_url, cloud_auth } => {
            let endpoint = if cloud_auth.is_some() {
                format!("{base_url}/chat")
            } else {
                format!("{base_url}/api/chat")
            };
            let mut request = client.post(endpoint);
            if let Some(api_key) = cloud_auth {
                request = request.bearer_auth(api_key);
            }
            let mut combined_messages = vec![serde_json::json!({
                "role": "system",
                "content": system_prompt,
            })];
            combined_messages.extend(messages);
            let mut body = serde_json::json!({
                "model": model,
                "stream": false,
                "messages": combined_messages,
                "options": {
                    "temperature": temperature,
                    "num_ctx": num_ctx,
                },
                "keep_alive": format!("{}m", keep_alive_minutes),
            });
            if json_mode && cloud_auth.is_none() {
                body["format"] = Value::String("json".to_string());
            }
            let payload: Value = request
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Ollama returned an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            payload
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| "The configured LLM returned an empty response.".to_string())
        }
        ResolvedLlmRuntime::OpenAiCompat {
            provider_label,
            base_url,
            api_key,
            extra_headers,
        } => {
            let mut full_messages = vec![serde_json::json!({"role": "system", "content": system_prompt})];
            full_messages.extend(messages);
            let send_request = |include_temperature: bool| {
                let mut request = client
                    .post(format!("{base_url}/chat/completions"))
                    .bearer_auth(api_key);
                for (header_name, header_value) in extra_headers {
                    request = request.header(*header_name, header_value);
                }
                let mut body = serde_json::json!({
                    "model": model,
                    "messages": full_messages.clone(),
                });
                if include_temperature {
                    body["temperature"] = serde_json::json!(temperature);
                }
                request.json(&body)
            };

            let first_response = send_request(true)
                .send()
                .await
                .map_err(|e| format!("Could not reach {provider_label}: {e}"))?;

            let payload: Value = if first_response.status().is_success() {
                first_response.json().await.map_err(|e| e.to_string())?
            } else {
                let status = first_response.status();
                let detail = first_response
                    .text()
                    .await
                    .ok()
                    .map(|text| text.trim().chars().take(280).collect::<String>())
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| "No response body.".to_string());

                if include_temperature_retry_allowed(provider_label, &detail) {
                    let retry_response = send_request(false)
                        .send()
                        .await
                        .map_err(|e| format!("Could not reach {provider_label}: {e}"))?;
                    if !retry_response.status().is_success() {
                        let retry_status = retry_response.status();
                        let retry_detail = retry_response
                            .text()
                            .await
                            .ok()
                            .map(|text| text.trim().chars().take(280).collect::<String>())
                            .filter(|text| !text.is_empty())
                            .unwrap_or_else(|| "No response body.".to_string());
                        return Err(format!("{provider_label} returned an error ({retry_status}): {retry_detail}"));
                    }
                    retry_response.json().await.map_err(|e| e.to_string())?
                } else {
                    return Err(format!("{provider_label} returned an error ({status}): {detail}"));
                }
            };
            payload
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| format!("{provider_label} returned an empty response."))
        }
        ResolvedLlmRuntime::Anthropic { base_url, api_key } => {
            let anthropic_messages = messages
                .into_iter()
                .filter_map(|message| {
                    let role = message.get("role").and_then(Value::as_str)?;
                    let content = message.get("content").and_then(Value::as_str)?.trim().to_string();
                    if content.is_empty() {
                        return None;
                    }
                    let normalized_role = if role == "assistant" { "assistant" } else { "user" };
                    Some(serde_json::json!({
                        "role": normalized_role,
                        "content": content,
                    }))
                })
                .collect::<Vec<_>>();
            let payload: Value = client
                .post(format!("{base_url}/messages"))
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&serde_json::json!({
                    "model": model,
                    "system": system_prompt,
                    "messages": anthropic_messages,
                    "temperature": temperature,
                    "max_tokens": num_ctx.clamp(256, 4096),
                }))
                .send()
                .await
                .map_err(|e| format!("Could not reach Anthropic: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Anthropic returned an error: {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            payload
                .get("content")
                .and_then(Value::as_array)
                .and_then(|items| {
                    let mut combined = String::new();
                    for item in items {
                        if item.get("type").and_then(Value::as_str) == Some("text") {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                combined.push_str(text);
                            }
                        }
                    }
                    if combined.trim().is_empty() { None } else { Some(combined) }
                })
                .map(|value| value.trim().to_string())
                .ok_or_else(|| "Anthropic returned an empty response.".to_string())
        }
    }
}

#[tauri::command]
async fn chat_with_project_ollama(
    app: tauri::AppHandle,
    request: OllamaProjectChatRequest,
) -> Result<OllamaProjectChatResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before starting a project chat.".to_string());
    }

    let query = request.query.trim();
    if query.is_empty() {
        return Err("Enter a message before sending it to Ollama.".to_string());
    }

    let indexed_items = load_active_project_embedding_items(&app, &request.project_id)?;
    if indexed_items.is_empty() {
        return Err("The local project embedding store is empty. Re-run project embeddings first.".to_string());
    }

    let query_text = if request.prefix_queries {
        format!("query: {}", query)
    } else {
        query.to_string()
    };

    let mut runtime = load_embedding_runtime(&app)?;
    let query_embeddings = embed_text_batch(&mut runtime, &[query_text])?;
    let query_embedding = query_embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "Could not generate a query embedding for this message.".to_string())?;

    let has_selected_context = !request.selected_document_ids.is_empty()
        || !request.selected_case_ids.is_empty()
        || !request.selected_code_ids.is_empty()
        || !request.selected_annotation_ids.is_empty()
        || !request.selected_memo_ids.is_empty();
    let restrict_to_selected_context = request.selected_context_mode.trim().eq_ignore_ascii_case("restrict");

    let matches_selected_context = |item: &ProjectEmbeddingStoreItem| {
        request
            .selected_document_ids
            .iter()
            .any(|selected_id| item.document_id.as_deref() == Some(selected_id.as_str()))
            || request
                .selected_case_ids
                .iter()
                .any(|selected_id| item.case_id.as_deref() == Some(selected_id.as_str()))
            || request
                .selected_code_ids
                .iter()
                .any(|selected_id| item.code_id.as_deref() == Some(selected_id.as_str()))
            || request
                .selected_annotation_ids
                .iter()
                .any(|selected_id| item.annotation_id.as_deref() == Some(selected_id.as_str()))
            || request
                .selected_memo_ids
                .iter()
                .any(|selected_id| item.memo_id.as_deref() == Some(selected_id.as_str()))
    };

    let mut ranked_items = indexed_items
        .iter()
        .map(|item| {
            let base_score = dot_similarity(&query_embedding, &item.embedding);
            let mut context_boost = 0.0_f32;

            if request
                .selected_document_ids
                .iter()
                .any(|selected_id| item.document_id.as_deref() == Some(selected_id.as_str()))
            {
                context_boost += 0.35;
            }

            if request
                .selected_case_ids
                .iter()
                .any(|selected_id| item.case_id.as_deref() == Some(selected_id.as_str()))
            {
                context_boost += 0.35;
            }

            if request
                .selected_code_ids
                .iter()
                .any(|selected_id| item.code_id.as_deref() == Some(selected_id.as_str()))
            {
                context_boost += 0.35;
            }

            if request
                .selected_annotation_ids
                .iter()
                .any(|selected_id| item.annotation_id.as_deref() == Some(selected_id.as_str()))
            {
                context_boost += 0.45;
            }

            if request
                .selected_memo_ids
                .iter()
                .any(|selected_id| item.memo_id.as_deref() == Some(selected_id.as_str()))
            {
                context_boost += 0.4;
            }

            (base_score + context_boost, item)
        })
        .collect::<Vec<_>>();
    ranked_items.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if has_selected_context && restrict_to_selected_context {
        ranked_items = ranked_items
            .into_iter()
            .filter(|(_, item)| matches_selected_context(item))
            .collect::<Vec<_>>();
        if ranked_items.is_empty() {
            return Err("No indexed content matched the selected chat context. Try choosing different context items or rebuilding project embeddings.".to_string());
        }
    }

    let top_items = ranked_items.into_iter().take(6).collect::<Vec<_>>();
    let cited_items = top_items
        .iter()
        .filter_map(|(_, item)| {
            if item.annotation_id.is_none()
                && item.document_id.is_none()
                && item.case_id.is_none()
                && item.code_id.is_none()
                && item.memo_id.is_none()
            {
                return None;
            }

            Some((item, OllamaProjectChatCitation {
                id: item.id.clone(),
                item_type: item.item_type.clone(),
                title: item.title.clone(),
                preview: citation_preview(&item.text, 160),
                document_id: item.document_id.clone(),
                case_id: item.case_id.clone(),
                code_id: item.code_id.clone(),
                annotation_id: item.annotation_id.clone(),
                memo_id: item.memo_id.clone(),
                start_offset: item.start_offset,
                end_offset: item.end_offset,
            }))
        })
        .take(4)
        .collect::<Vec<_>>();
    let citations = cited_items
        .iter()
        .map(|(_, citation)| citation.clone())
        .collect::<Vec<_>>();
    let context_block = cited_items
        .iter()
        .enumerate()
        .map(|(index, (item, _))| {
            format!(
                "[{}]\nTitle: {}\nType: {}\nContent: {}",
                index + 1,
                item.title,
                item.item_type,
                item.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let context_rule = if has_selected_context && restrict_to_selected_context {
        "The retrieved context below has already been restricted to the user's selected chat context. Treat that restriction as mandatory: answer only from this selected context, and if it does not contain the answer, say that you do not know."
    } else if has_selected_context {
        "The user selected preferred chat context. Prioritize the retrieved context below when answering, stay grounded in it, and say that you do not know if it does not support a claim."
    } else {
        "Answer the user's question about this project using the retrieved project context below."
    };

    let system_prompt = format!(
        "You are Kanqual AI Assist. {} If the context does not support a claim, say that you do not know. Do not infer facts, intent, prevalence, or chronology beyond the retrieved context. If the retrieved context is incomplete or mixed, say so plainly. Answer the user's question directly first, then add only the shortest necessary explanation. Use 1-3 short paragraphs or a short bullet list when that is clearer. When you use retrieved context, add inline citation markers like [1] or [2] that refer to the numbered context blocks below. Only cite numbers that appear in the retrieved context, place citations immediately after the supported claim, and do not cite unsupported claims.\n\nRetrieved project context:\n{}",
        context_rule,
        context_block
    );

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt,
    })];

    for message in request.conversation.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
        if message.content.trim().is_empty() {
            continue;
        }
        let role = if message.role == "assistant" { "assistant" } else { "user" };
        messages.push(serde_json::json!({
            "role": role,
            "content": message.content,
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": query,
    }));

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;
    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        &system_prompt,
        messages,
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        false,
    )
    .await?;

    Ok(OllamaProjectChatResponse {
        content,
        model: request.model,
        base_url,
        used_context_items: cited_items.len() as u64,
        citations,
    })
}

#[tauri::command]
async fn find_relevant_project_segments_with_ollama(
    app: tauri::AppHandle,
    request: OllamaRelevantSegmentsRequest,
) -> Result<OllamaRelevantSegmentsResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before starting a relevant-segments search.".to_string());
    }
    if request.code_id.trim().is_empty() || request.code_label.trim().is_empty() {
        return Err("Select a code before searching for relevant segments.".to_string());
    }
    let active_document_id = request
        .active_document_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Open a document before searching for relevant segments.".to_string())?;

    let indexed_items = load_active_project_embedding_items(&app, &request.project_id)?;
    if indexed_items.is_empty() {
        return Err("The local project embedding store is empty. Re-run project embeddings first.".to_string());
    }

    let query = match request.code_description.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(description) => format!(
            "Find project segments relevant to the code \"{}\". Code description: {}",
            request.code_label.trim(),
            description
        ),
        None => format!("Find project segments relevant to the code \"{}\"", request.code_label.trim()),
    };
    let query_text = if request.prefix_queries {
        format!("query: {}", query)
    } else {
        query
    };

    let mut runtime = load_embedding_runtime(&app)?;
    let query_embeddings = embed_text_batch(&mut runtime, &[query_text])?;
    let query_embedding = query_embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "Could not generate an embedding for the selected code.".to_string())?;

    let mut ranked_items = indexed_items
        .iter()
        .filter(|item| {
            item.item_type != "code"
                && item.document_id.as_deref() == Some(active_document_id)
        })
        .map(|item| (dot_similarity(&query_embedding, &item.embedding), item))
        .collect::<Vec<_>>();
    ranked_items.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let candidate_limit = request.candidate_limit.clamp(1, 50);
    let max_results = request.max_results.clamp(1, candidate_limit);
    let candidate_items = ranked_items
        .into_iter()
        .take(candidate_limit)
        .collect::<Vec<_>>();
    if candidate_items.is_empty() {
        return Err("No indexed segments are available yet for the open document. Re-run project embeddings if needed.".to_string());
    }

    let candidate_block = candidate_items
        .iter()
        .enumerate()
        .map(|(index, (similarity, item))| {
            format!(
                "[Candidate {}]\nid: {}\ntype: {}\ntitle: {}\nsimilarity: {:.4}\ncontent: {}",
                index + 1,
                item.id,
                item.item_type,
                item.title,
                similarity,
                item.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let system_prompt = format!(
        "You are Kanqual AI Assist. Review candidate project segments and choose the ones most relevant to the selected code.\n\nReturn strict JSON only in this shape:\n{{\"segments\":[{{\"id\":\"candidate-id\",\"reason\":\"short explanation\"}}]}}\n\nRules:\n- Use only candidate ids from the provided list.\n- Prefer document passages and annotations over generic metadata.\n- Return between 0 and {} segments.\n- Keep each reason under 18 words.\n- Do not include markdown fences or extra commentary.",
        max_results,
    );
    let user_message = format!(
        "Selected code: {}\nCode description: {}\n\nCandidates:\n{}",
        request.code_label.trim(),
        request.code_description.as_deref().unwrap_or("").trim(),
        candidate_block
    );

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;
    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        &system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        true,
    )
    .await?;

    let json_content = extract_json_object(&content).unwrap_or(&content);
    let parsed: OllamaRelevantSegmentsModelResponse = serde_json::from_str(json_content)
        .map_err(|e| format!("Could not parse the configured LLM's relevant-segments response: {e}"))?;

    let candidate_map = candidate_items
        .iter()
        .map(|(similarity, item)| (item.id.as_str(), (*similarity, *item)))
        .collect::<HashMap<_, _>>();

    let mut seen_ids = HashSet::new();
    let segments = parsed
        .segments
        .into_iter()
        .filter_map(|segment| {
            let id = segment.id.trim();
            if id.is_empty() || !seen_ids.insert(id.to_string()) {
                return None;
            }
            let (similarity, item) = candidate_map.get(id)?;
            Some(OllamaRelevantSegment {
                id: item.id.clone(),
                item_type: item.item_type.clone(),
                title: item.title.clone(),
                preview: citation_preview(&item.text, 180),
                match_text: relevant_segment_match_text(item),
                reason: segment
                    .reason
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "Marked relevant for this code.".to_string()),
                similarity: *similarity,
                document_id: item.document_id.clone(),
                code_id: item.code_id.clone(),
                annotation_id: item.annotation_id.clone(),
                start_offset: item.start_offset,
                end_offset: item.end_offset,
            })
        })
        .collect::<Vec<_>>();

    Ok(OllamaRelevantSegmentsResponse {
        model: request.model,
        base_url,
        searched_items: candidate_items.len() as u64,
        segments,
    })
}

#[tauri::command]
async fn generate_attribute_value_suggestions_with_ollama(
    app: tauri::AppHandle,
    request: OllamaAttributeSuggestionRequest,
    cancelled_runs: tauri::State<'_, CancelledAttributeSuggestionRuns>,
) -> Result<OllamaAttributeSuggestionResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before generating attribute suggestions.".to_string());
    }
    if request.attribute_name.trim().is_empty() {
        return Err("Choose an attribute before generating suggestions.".to_string());
    }
    if request.items.is_empty() {
        return Err("No case or document content is available to analyze for this attribute.".to_string());
    }

    let data_type = request.attribute_data_type.trim().to_ascii_lowercase();
    let attribute_options = normalize_attribute_options(&request.attribute_options);
    let data_type_instruction = match data_type.as_str() {
        "number" => "Return a numeric value only with no units or commentary. If nothing can be inferred, return an empty string.",
        "datetime" => "Return a normalized date or date-time only, preferably YYYY-MM-DD or YYYY-MM-DDTHH:MM. If nothing can be inferred, return an empty string.",
        "categorical" => "Return exactly one allowed category value only. If the text does not support any allowed category, return an empty string.",
        _ => "Return a short text value only, not a sentence. If nothing can be inferred, return an empty string.",
    };
    if data_type == "categorical" && attribute_options.len() < 2 {
        return Err("Categorical attributes need at least two allowed categories before AI suggestions can be generated.".to_string());
    }
    let attribute_description = request
        .attribute_description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let attribute_options_text = if data_type == "categorical" {
        format!(
            "\nAllowed categories:\n- {}",
            attribute_options.join("\n- ")
        )
    } else {
        String::new()
    };

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut suggestions = Vec::with_capacity(request.items.len());
    let total_items = request.items.len() as u64;
    for (index, item) in request.items.into_iter().enumerate() {
        if cancelled_runs.0.lock().unwrap().contains(request.run_id.as_str()) {
            cancelled_runs.0.lock().unwrap().remove(request.run_id.as_str());
            return Err("Attribute suggestion generation was stopped.".to_string());
        }
        let item_id = item.id.trim().to_string();
        let item_name = item.name.trim().to_string();
        if item_id.is_empty() || item_name.is_empty() {
            continue;
        }
        let completed_items = index as u64 + 1;

        let content = truncate_for_ollama_prompt(&item.content, 18_000);
        if content.trim().is_empty() {
            let suggestion = OllamaAttributeSuggestionItem {
                item_id,
                item_name,
                suggested_value: String::new(),
                evidence_text: String::new(),
            };
            suggestions.push(suggestion);
            if let Some(last) = suggestions.last() {
                let _ = app.emit("attribute-suggestion-progress", OllamaAttributeSuggestionProgressEvent {
                    run_id: request.run_id.clone(),
                    item_id: last.item_id.clone(),
                    item_name: last.item_name.clone(),
                    suggested_value: last.suggested_value.clone(),
                    evidence_text: last.evidence_text.clone(),
                    completed_items,
                    total_items,
                    model: request.model.clone(),
                    base_url: base_url.clone(),
                });
            }
            continue;
        }

        let system_prompt = format!(
            "You are Kanqual AI Assist. Infer a suggested value for one project attribute from the provided source text.\n\nAttribute name: {}\nAttribute data type: {}\nAttribute description: {}{}\n\nRules:\n- {}\n- Base the suggestion only on the provided text.\n- Also return a short evidence excerpt copied from the text that best supports the suggestion.\n- If the text does not support any value, return empty strings.\n- Return strict JSON only in this exact shape: {{\"value\":\"...\",\"evidence\":\"...\"}}\n- Do not include markdown fences or extra commentary.",
            request.attribute_name.trim(),
            if data_type.is_empty() { "text" } else { data_type.as_str() },
            attribute_description,
            attribute_options_text,
            data_type_instruction,
        );
        let user_message = format!(
            "Source item: {}\nSource text:\n{}",
            item_name,
            content,
        );

        if cancelled_runs.0.lock().unwrap().contains(request.run_id.as_str()) {
            cancelled_runs.0.lock().unwrap().remove(request.run_id.as_str());
            return Err("Attribute suggestion generation was stopped.".to_string());
        }
        let content = run_llm_chat_completion(
            &runtime,
            &client,
            &request.model,
            &system_prompt,
            vec![serde_json::json!({ "role": "user", "content": user_message })],
            request.temperature,
            request.num_ctx,
            request.keep_alive_minutes,
            true,
        )
        .await?;

        let json_content = extract_json_object(&content).unwrap_or(&content);
        let parsed: OllamaAttributeSuggestionModelResponse = serde_json::from_str(json_content)
            .map_err(|e| format!("Could not parse the configured LLM's attribute-suggestion response: {e}"))?;
        let suggested_value = parsed.value.unwrap_or_default().trim().to_string();
        let normalized_value = if data_type == "categorical" {
            canonicalize_categorical_suggestion(&suggested_value, &attribute_options)
        } else {
            suggested_value
        };
        let evidence_text = if normalized_value.is_empty() {
            String::new()
        } else {
            parsed.evidence.unwrap_or_default().trim().to_string()
        };

        let suggestion = OllamaAttributeSuggestionItem {
            item_id,
            item_name,
            suggested_value: normalized_value,
            evidence_text,
        };
        suggestions.push(suggestion);
        if let Some(last) = suggestions.last() {
            let _ = app.emit("attribute-suggestion-progress", OllamaAttributeSuggestionProgressEvent {
                run_id: request.run_id.clone(),
                item_id: last.item_id.clone(),
                item_name: last.item_name.clone(),
                suggested_value: last.suggested_value.clone(),
                evidence_text: last.evidence_text.clone(),
                completed_items,
                total_items,
                model: request.model.clone(),
                base_url: base_url.clone(),
            });
        }
    }

    Ok(OllamaAttributeSuggestionResponse {
        model: request.model,
        base_url,
        suggestions,
    })
}

#[tauri::command]
fn cancel_attribute_suggestion_run(
    run_id: String,
    cancelled_runs: tauri::State<'_, CancelledAttributeSuggestionRuns>,
) -> Result<(), String> {
    let trimmed = run_id.trim();
    if trimmed.is_empty() {
        return Err("No attribute suggestion run is active.".to_string());
    }
    cancelled_runs.0.lock().unwrap().insert(trimmed.to_string());
    Ok(())
}

#[tauri::command]
async fn generate_code_conceptual_summary_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaCodeSummaryResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before running code analysis.".to_string());
    }
    if request.code_label.trim().is_empty() {
        return Err("No code selected.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet. Add some annotations before running analysis.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(10)))
        .build()
        .map_err(|e| e.to_string())?;

    let description = request
        .code_description
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("No description provided");

    let unique_docs: std::collections::HashSet<&str> = request
        .annotations
        .iter()
        .map(|a| a.document_name.as_str())
        .collect();

    let mut annotations_text = String::new();
    for (i, ann) in request.annotations.iter().enumerate() {
        let line = format!("[{}] [{}] \"{}\"\n", i + 1, ann.document_name.trim(), ann.quote.trim());
        if annotations_text.len() + line.len() > 16_000 {
            annotations_text.push_str("... (additional annotations truncated for length)\n");
            break;
        }
        annotations_text.push_str(&line);
    }

    let system_prompt =
        "You are a qualitative research assistant helping analyse coded data from a research project.\n\n\
        Given a code and its associated annotations, provide:\n\
        1. A short conceptual summary of about 120-180 words describing what this code appears to represent, the main themes visible across its annotations, and how the code seems to function in the data.\n\
        2. 3 to 5 key insights or standout observations drawn from the annotations. These can cover recurring themes, notable contrasts, edge cases, or other meaningful qualitative patterns.\n\n\
        Stay strictly within the provided annotations. Do not infer prevalence, frequency, or project-wide importance unless the annotations clearly support that claim. If the evidence is mixed or limited, say so directly.\n\n\
        Each annotation is identified by a number in square brackets (e.g. [1], [2]). \
        Cite specific annotations inline wherever they support your points — for example: \"resilience appears across multiple accounts [1][4]\". \
        Cite as many annotations as are genuinely relevant. Citations should appear naturally within sentences, not only at the end.\n\n\
        Format your response exactly as:\n\
        ## Summary\n\
        [1 short paragraph with inline citations]\n\n\
        ## Key Insights\n\
        1. [insight with inline citations]\n\
        2. [insight with inline citations]\n\
        ...\n\n\
        Use plain prose only. No markdown beyond the ## headers, numbered list, and [N] citation markers.";

    let user_message = format!(
        "Code: {}\nDescription: {}\n\nTotal annotations: {}\nDocuments represented: {}\n\nAnnotations:\n{}",
        request.code_label.trim(),
        description,
        request.annotations.len(),
        unique_docs.len(),
        annotations_text,
    );

    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        false,
    )
    .await?;

    Ok(OllamaCodeSummaryResponse {
        content,
        model: request.model,
        base_url,
    })
}

#[tauri::command]
async fn generate_most_typical_annotation_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaMostTypicalAnnotationResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet. Add some annotations before running analysis.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(10)))
        .build()
        .map_err(|e| e.to_string())?;

    let description = request
        .code_description
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("No description provided");

    let mut annotations_text = String::new();
    for (i, ann) in request.annotations.iter().enumerate() {
        let line = format!("[{}] [{}] \"{}\"\n", i + 1, ann.document_name.trim(), ann.quote.trim());
        if annotations_text.len() + line.len() > 16_000 {
            annotations_text.push_str("... (additional annotations truncated)\n");
            break;
        }
        annotations_text.push_str(&line);
    }

    let total = request.annotations.len();
    let return_count = total.min(5);

    let system_prompt = format!(
        "You are a qualitative research assistant. Given a code and its annotations, identify the \
        {return_count} annotations that best exemplify the core meaning of this code - the most canonical, \
        representative examples a researcher would use to illustrate it.\n\n\
        Base your judgment only on the provided annotations. Do not infer missing context.\n\n\
        Return strict JSON only in this exact shape (no markdown fences, no extra keys):\n\
        {{\"annotations\": [{{\"annotation_index\": N, \"reasoning\": \"1-2 sentence explanation\"}}]}}\n\
        Return exactly {return_count} items. N must be a number between 1 and the total number of annotations provided."
    );

    let user_message = format!(
        "Code: {}\nDescription: {}\n\nTotal annotations: {}\n\nAnnotations:\n{}\n\nWhich {} annotations (by number) best exemplify this code?",
        request.code_label.trim(),
        description,
        total,
        annotations_text,
        return_count,
    );

    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        &system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        true,
    )
    .await?;

    let json_content = extract_json_object(&content).unwrap_or(&content);
    let parsed = parse_most_typical_annotation_payload(json_content)?;

    let annotations = parsed
        .annotations
        .into_iter()
        .filter(|item| item.annotation_index >= 1 && item.annotation_index <= total as u64)
        .take(return_count)
        .collect::<Vec<_>>();

    if annotations.is_empty() {
        return Err("The configured LLM did not return any valid typical annotation indexes.".to_string());
    }

    Ok(OllamaMostTypicalAnnotationResponse {
        annotations,
        model: request.model,
        base_url,
    })
}

#[tauri::command]
async fn process_document_with_ollama(
    request: OllamaDocumentProcessingRequest,
) -> Result<OllamaDocumentProcessingResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before processing a document.".to_string());
    }
    let full_content = request.document_content.trim().to_string();
    if full_content.is_empty() {
        return Err("The document has no content to process.".to_string());
    }

    // ── Chunk size: leave ~900 tokens for system prompt + JSON response,
    //   estimate 4 chars/token for English. Floor at 4 000 chars.
    let chunk_chars = ((request.num_ctx as usize).saturating_sub(900) * 4).max(4_000);

    // ── Split at paragraph/line boundaries ───────────────────────────────────
    let mut chunks: Vec<String> = Vec::new();
    {
        let mut remaining: &str = &full_content;
        while !remaining.is_empty() {
            if remaining.chars().count() <= chunk_chars {
                chunks.push(remaining.to_string());
                break;
            }
            // Find byte position at chunk_chars characters
            let mut byte_limit = 0usize;
            for (i, c) in remaining.char_indices().take(chunk_chars) {
                byte_limit = i + c.len_utf8();
            }
            let candidate = &remaining[..byte_limit];
            // Prefer splitting after a paragraph break, then a line break
            let split_at = if let Some(pos) = candidate.rfind("\n\n") {
                pos + 2
            } else if let Some(pos) = candidate.rfind('\n') {
                pos + 1
            } else {
                byte_limit
            }
            .max(1); // guard against infinite loop on pathological input
            let (chunk, rest) = remaining.split_at(split_at);
            if !chunk.trim().is_empty() {
                chunks.push(chunk.to_string());
            }
            remaining = rest;
        }
    }
    if chunks.is_empty() {
        return Err("The document has no content to process.".to_string());
    }
    let chunk_count = chunks.len();

    // ── Build client and system prompt (shared across all chunks) ────────────
    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(600)))
        .build()
        .map_err(|e| e.to_string())?;

    let system_prompt =
        "You are a qualitative research assistant helping process interview transcripts and similar documents.\n\n\
        Analyze the provided text and split it into labeled segments that together cover the entire text.\n\
        This may be only one portion of a longer document, so classify each segment based on its content alone.\n\n\
        Segment types:\n\
        - \"metadata\": document header information such as title, date, location, participant names, or other framing text before the interview begins\n\
        - \"question\": a question, prompt, or speaking turn from the interviewer, moderator, or facilitator\n\
        - \"answer\": a response or speaking turn from an interviewee, participant, or respondent\n\n\
        Treat inline speaker labels such as \"[S01]:\", \"S01:\", \"P1:\", \"Interviewer:\", or similar turn prefixes as part of question or answer turns, not as metadata, when they introduce spoken content.\n\
        Also identify only speaker names that appear in the transcript format itself, meaning real names used as speaker labels or turn labels.\n\
        Do not identify names mentioned only inside the body text.\n\
        Do not include generic role words by themselves, such as \"Interviewer\", \"Participant\", or \"Moderator\", unless they are clearly used as actual names in the speaker label.\n\n\
        Return strict JSON only, with no markdown fences and no extra keys, in exactly this shape:\n\
        {\"segments\": [{\"segmentType\": \"...\", \"speakerId\": \"...\", \"text\": \"...\"}, ...], \"properNames\": [\"...\", \"...\"]}\n\n\
        Rules:\n\
        - The segments should cover the entire text in order, with no substantive omissions or duplication\n\
        - Preserve the original text verbatim within each segment; do not rephrase, summarize, or modify wording\n\
        - Minor boundary differences are acceptable only if the original text is still preserved exactly\n\
        - speakerId is the speaker label exactly as it appears in the text, for example \"Interviewer\", \"I\", or \"P1\"; use an empty string if not applicable\n\
        - properNames must be exact text snippets copied from the source text, not paraphrases\n\
        - properNames should contain only likely real speaker names worth reviewing for anonymization\n\
        - If a person's real name appears as a speaker label, include it in properNames\n\
        - Do not include organizations, places, or names that appear only in the spoken text body\n\
        - If the same name appears multiple times, include it only once in properNames\n\
        - If the text has no clear interview structure, label everything as \"answer\" segments";

    // ── Process each chunk, assembling the full processedContent ─────────────
    let mut processed_content = String::new();
    let mut segments_output: Vec<OllamaDocumentSegmentOutput> = Vec::new();
    let mut proper_name_map: HashMap<String, String> = HashMap::new();

    for (chunk_index, chunk_text) in chunks.iter().enumerate() {
        let user_message = format!("Text content:\n{}", chunk_text.trim());

        let raw = run_llm_chat_completion(
            &runtime,
            &client,
            &request.model,
            system_prompt,
            vec![serde_json::json!({ "role": "user", "content": user_message })],
            request.temperature,
            request.num_ctx,
            request.keep_alive_minutes,
            true,
        )
        .await
        .map_err(|error| {
            if error.to_ascii_lowercase().contains("timed out") {
                "The configured LLM timed out while processing this document. Transcript processing can take several minutes, especially for longer files.".to_string()
            } else {
                format!("Chunk {} failed: {error}", chunk_index + 1)
            }
        })?;

        let json_part = extract_json_object(&raw).unwrap_or(&raw);
        let parsed: OllamaDocumentSegmentsModelResponse = serde_json::from_str(json_part)
            .map_err(|e| format!("Could not parse the LLM response for chunk {}: {e}", chunk_index + 1))?;

        if parsed.segments.is_empty() {
            return Err(format!("The configured LLM returned no segments for chunk {}.", chunk_index + 1));
        }

        if let Some(proper_names) = parsed.proper_names {
            for candidate in proper_names {
                if let Some(normalized) = normalize_proper_name_candidate(&candidate) {
                    proper_name_map
                        .entry(normalized.to_ascii_lowercase())
                        .or_insert(normalized);
                }
            }
        }

        // Base offset into the full processedContent where this chunk's content begins
        let base_offset = if processed_content.is_empty() { 0 } else { processed_content.len() + 2 };
        let mut chunk_built = String::new();

        for seg in parsed.segments.into_iter() {
            let original_text = seg.text.unwrap_or_default();
            let pieces = split_text_on_inline_speaker_labels(&original_text);
            if pieces.is_empty() { continue; }
            let model_speaker_id = seg.speaker_id
                .unwrap_or_default()
                .trim()
                .to_string();
            let model_segment_type = match seg.segment_type.trim().to_ascii_lowercase().as_str() {
                "metadata" => "metadata",
                "question"  => "question",
                _ => "answer",
            };

            for (piece_index, text) in pieces.into_iter().enumerate() {
                let (text, inferred_speaker_id, timestamp_text) =
                    extract_transcript_leading_metadata(&text);
                if text.trim().is_empty() {
                    continue;
                }
                let mut segment_type = model_segment_type;
                let speaker_id = if !model_speaker_id.is_empty() && piece_index == 0 {
                    model_speaker_id.clone()
                } else {
                    inferred_speaker_id.unwrap_or_default()
                };
                if segment_type == "metadata" && !speaker_id.is_empty() {
                    segment_type = if is_interviewer_style_speaker_label(&speaker_id) {
                        "question"
                    } else {
                        "answer"
                    };
                }
                if !chunk_built.is_empty() { chunk_built.push_str("\n\n"); }
                let start_offset = base_offset + chunk_built.len();
                chunk_built.push_str(&text);
                let end_offset = base_offset + chunk_built.len();
                segments_output.push(OllamaDocumentSegmentOutput {
                    segment_type: segment_type.to_string(),
                    speaker_id,
                    timestamp_text,
                    start_offset,
                    end_offset,
                    sort_order: segments_output.len(),
                    text,
                    chunk_index,
                });
            }
        }

        if !processed_content.is_empty() && !chunk_built.is_empty() {
            processed_content.push_str("\n\n");
        }
        processed_content.push_str(&chunk_built);
    }

    if segments_output.is_empty() {
        return Err("The configured LLM returned no segments for any chunk.".to_string());
    }

    // ── Merge same-type/speaker segments at chunk seams ──────────────────────
    let mut merged: Vec<OllamaDocumentSegmentOutput> = Vec::new();
    for seg in segments_output {
        if let Some(last) = merged.last_mut() {
            let at_seam = last.chunk_index != seg.chunk_index;
            let same_type = last.segment_type == seg.segment_type;
            let same_speaker = last.speaker_id.trim().to_ascii_lowercase()
                == seg.speaker_id.trim().to_ascii_lowercase();
            if at_seam && same_type && same_speaker {
                last.end_offset = seg.end_offset;
                last.text = format!("{}\n\n{}", last.text, seg.text);
                continue;
            }
        }
        merged.push(seg);
    }
    for (i, seg) in merged.iter_mut().enumerate() {
        seg.sort_order = i;
    }

    for seg in &merged {
        if looks_like_named_speaker_label(&seg.speaker_id) {
            let normalized = seg.speaker_id.trim().to_string();
            proper_name_map
                .entry(normalized.to_ascii_lowercase())
                .or_insert(normalized);
        }
    }

    let proper_name_candidates = proper_name_map
        .into_values()
        .map(|text| {
            let source_type = if merged.iter().any(|seg| seg.speaker_id.trim().eq_ignore_ascii_case(&text)) {
                "speaker".to_string()
            } else {
                "text".to_string()
            };
            OllamaDocumentProperNameCandidate { text, source_type }
        })
        .collect();

    Ok(OllamaDocumentProcessingResponse {
        processed_content,
        segments: merged,
        proper_name_candidates,
        model: request.model,
        base_url,
        chunk_count,
    })
}

fn document_processing_system_prompt() -> &'static str {
    "You are a qualitative research assistant helping process interview transcripts and similar documents.\n\n\
    Analyze the provided text and split it into labeled segments that together cover the entire text.\n\
    This may be only one portion of a longer document, so classify each segment based on its content alone.\n\n\
    Segment types:\n\
    - \"metadata\": document header information such as title, date, location, participant names, or other framing text before the interview begins\n\
    - \"question\": a question, prompt, or speaking turn from the interviewer, moderator, or facilitator\n\
    - \"answer\": a response or speaking turn from an interviewee, participant, or respondent\n\n\
    Treat inline speaker labels such as \"[S01]:\", \"S01:\", \"P1:\", \"Interviewer:\", or similar turn prefixes as part of question or answer turns, not as metadata, when they introduce spoken content.\n\
    Also identify only speaker names that appear in the transcript format itself, meaning real names used as speaker labels or turn labels.\n\
    Do not identify names mentioned only inside the body text.\n\
    Do not include generic role words by themselves, such as \"Interviewer\", \"Participant\", or \"Moderator\", unless they are clearly used as actual names in the speaker label.\n\n\
    Return strict JSON only, with no markdown fences and no extra keys, in exactly this shape:\n\
    {\"segments\": [{\"segmentType\": \"...\", \"speakerId\": \"...\", \"text\": \"...\"}, ...], \"properNames\": [\"...\", \"...\"]}\n\n\
    Rules:\n\
    - The segments should cover the entire text in order, with no substantive omissions or duplication\n\
    - Preserve the original text verbatim within each segment; do not rephrase, summarize, or modify wording\n\
    - Minor boundary differences are acceptable only if the original text is still preserved exactly\n\
    - speakerId is the speaker label exactly as it appears in the text, for example \"Interviewer\", \"I\", or \"P1\"; use an empty string if not applicable\n\
    - properNames must be exact text snippets copied from the source text, not paraphrases\n\
    - properNames should contain only likely real speaker names worth reviewing for anonymization\n\
    - If a person's real name appears as a speaker label, include it in properNames\n\
    - Do not include organizations, places, or names that appear only in the spoken text body\n\
    - If the same name appears multiple times, include it only once in properNames\n\
    - If the text has no clear interview structure, label everything as \"answer\" segments"
}

#[tauri::command]
async fn process_document_chunk_with_ollama(
    request: OllamaDocumentChunkProcessingRequest,
) -> Result<OllamaDocumentChunkProcessingResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before processing a document.".to_string());
    }
    let chunk_text = request.chunk_text.trim().to_string();
    if chunk_text.is_empty() {
        return Err("This document chunk has no content to process.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(600)))
        .build()
        .map_err(|e| e.to_string())?;

    let user_message = format!("Text content:\n{}", chunk_text);
    let raw = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        document_processing_system_prompt(),
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        true,
    )
    .await
    .map_err(|error| {
        if error.to_ascii_lowercase().contains("timed out") {
            "The configured LLM timed out while processing this document. Transcript processing can take several minutes, especially for longer files.".to_string()
        } else {
            format!("Chunk {} failed: {error}", request.chunk_index + 1)
        }
    })?;
    let json_part = extract_json_object(&raw).unwrap_or(&raw);
    let parsed: OllamaDocumentSegmentsModelResponse = serde_json::from_str(json_part)
        .map_err(|e| format!("Could not parse the LLM response for chunk {}: {e}", request.chunk_index + 1))?;

    if parsed.segments.is_empty() {
        return Err(format!("The configured LLM returned no segments for chunk {}.", request.chunk_index + 1));
    }

    let mut processed_content = String::new();
    let mut segments: Vec<OllamaDocumentSegmentOutput> = Vec::new();
    for seg in parsed.segments.into_iter() {
        let original_text = seg.text.unwrap_or_default();
        let pieces = split_text_on_inline_speaker_labels(&original_text);
        if pieces.is_empty() { continue; }
        let model_speaker_id = seg.speaker_id
            .unwrap_or_default()
            .trim()
            .to_string();
        let model_segment_type = match seg.segment_type.trim().to_ascii_lowercase().as_str() {
            "metadata" => "metadata",
            "question" => "question",
            _ => "answer",
        };

        for (piece_index, text) in pieces.into_iter().enumerate() {
            let (text, inferred_speaker_id, timestamp_text) =
                extract_transcript_leading_metadata(&text);
            if text.trim().is_empty() {
                continue;
            }
            let mut segment_type = model_segment_type;
            let speaker_id = if !model_speaker_id.is_empty() && piece_index == 0 {
                model_speaker_id.clone()
            } else {
                inferred_speaker_id.unwrap_or_default()
            };
            if segment_type == "metadata" && !speaker_id.is_empty() {
                segment_type = if is_interviewer_style_speaker_label(&speaker_id) {
                    "question"
                } else {
                    "answer"
                };
            }
            if !processed_content.is_empty() { processed_content.push_str("\n\n"); }
            let start_offset = processed_content.len();
            processed_content.push_str(&text);
            let end_offset = processed_content.len();
            segments.push(OllamaDocumentSegmentOutput {
                segment_type: segment_type.to_string(),
                speaker_id,
                timestamp_text,
                start_offset,
                end_offset,
                sort_order: segments.len(),
                text,
                chunk_index: request.chunk_index,
            });
        }
    }
    if segments.is_empty() {
        return Err(format!("The configured LLM returned no segments for chunk {}.", request.chunk_index + 1));
    }

    let mut proper_name_map: HashMap<String, String> = HashMap::new();
    if let Some(proper_names) = parsed.proper_names {
        for candidate in proper_names {
            if let Some(normalized) = normalize_proper_name_candidate(&candidate) {
                proper_name_map
                    .entry(normalized.to_ascii_lowercase())
                    .or_insert(normalized);
            }
        }
    }
    for seg in &segments {
        if looks_like_named_speaker_label(&seg.speaker_id) {
            let normalized = seg.speaker_id.trim().to_string();
            proper_name_map
                .entry(normalized.to_ascii_lowercase())
                .or_insert(normalized);
        }
    }
    let proper_name_candidates = proper_name_map
        .into_values()
        .map(|text| {
            let source_type = if segments.iter().any(|seg| seg.speaker_id.trim().eq_ignore_ascii_case(&text)) {
                "speaker".to_string()
            } else {
                "text".to_string()
            };
            OllamaDocumentProperNameCandidate { text, source_type }
        })
        .collect();

    Ok(OllamaDocumentChunkProcessingResponse {
        processed_content,
        segments,
        proper_name_candidates,
        model: request.model,
        base_url,
        chunk_index: request.chunk_index,
    })
}

#[tauri::command]
async fn generate_code_decomposition_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaCodeSummaryResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(10)))
        .build()
        .map_err(|e| e.to_string())?;

    let description = request.code_description.as_deref().map(str::trim).filter(|v| !v.is_empty()).unwrap_or("No description provided");
    let unique_docs: std::collections::HashSet<&str> = request.annotations.iter().map(|a| a.document_name.as_str()).collect();

    let mut annotations_text = String::new();
    for (i, ann) in request.annotations.iter().enumerate() {
        let line = format!("[{}] [{}] \"{}\"\n", i + 1, ann.document_name.trim(), ann.quote.trim());
        if annotations_text.len() + line.len() > 16_000 { annotations_text.push_str("... (truncated)\n"); break; }
        annotations_text.push_str(&line);
    }

    let system_prompt =
        "You are a qualitative research assistant. Analyse whether a code's annotations form a \
        coherent whole or whether some are outliers, or whether there are distinct sub-clusters \
        that do not fit the core concept.\n\n\
        Each annotation is identified by [N]. Cite specific annotations inline when discussing them. \
        Stay strictly within the provided annotations. Do not infer broader project patterns unless the evidence here clearly supports them.\n\n\
        Format your response exactly as:\n\
        ## Decomposition Analysis\n\
        [1 short paragraph - does the code hold together? Any internal tensions or sub-themes?]\n\n\
        ## Outliers or Sub-clusters\n\
        1. [specific outlier, sub-cluster, or tension with citation numbers]\n\
        2. [specific outlier, sub-cluster, or tension with citation numbers]\n\
        Or write exactly: \"None identified - the code appears cohesive.\"\n\n\
        Use plain prose only. No markdown beyond the ## headers and [N] citation markers.";

    let user_message = format!(
        "Code: {}\nDescription: {}\n\nTotal annotations: {}\nDocuments represented: {}\n\nAnnotations:\n{}",
        request.code_label.trim(), description, request.annotations.len(), unique_docs.len(), annotations_text
    );

    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        false,
    )
    .await?;

    Ok(OllamaCodeSummaryResponse { content, model: request.model, base_url })
}

#[tauri::command]
async fn generate_code_position_with_ollama(
    request: OllamaCodePositionRequest,
) -> Result<OllamaCodeSummaryResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before running code analysis.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(10)))
        .build()
        .map_err(|e| e.to_string())?;

    let description = request.code_description.as_deref().map(str::trim).filter(|v| !v.is_empty()).unwrap_or("No description provided");

    let mut annotations_text = String::new();
    for (i, ann) in request.annotations.iter().enumerate() {
        let line = format!("[{}] [{}] \"{}\"\n", i + 1, ann.document_name.trim(), ann.quote.trim());
        if annotations_text.len() + line.len() > 8_000 { annotations_text.push_str("... (truncated)\n"); break; }
        annotations_text.push_str(&line);
    }

    let mut codebook_text = String::new();
    for entry in &request.codebook {
        let parent_part = entry.parent_label.as_deref().map(|p| format!(" (child of \"{}\")", p)).unwrap_or_default();
        let desc_part = entry.description.as_deref().map(str::trim).filter(|v| !v.is_empty())
            .map(|d| format!(": {}", d)).unwrap_or_default();
        codebook_text.push_str(&format!("- \"{}\"{}{}\n", entry.label.trim(), parent_part, desc_part));
    }

    let system_prompt =
        "You are a qualitative research assistant helping organise a codebook. Given a target code, \
        a sample of its annotations, and the full codebook hierarchy, analyse whether this code is \
        well-positioned. Consider: Does it overlap with other codes? Should it be a child of another \
        code, or move to a higher level? Could it be merged with or split from another code?\n\n\
        Base your reasoning only on the provided annotations and codebook. Do not infer unseen project usage. If the evidence is limited, say so.\n\n\
        Format your response exactly as:\n\
        ## Position Analysis\n\
        [1 short paragraph about the code's current placement and fit within the codebook]\n\n\
        ## Suggestions\n\
        1. [concrete suggestion]\n\
        2. [optional second suggestion]\n\
        Or write exactly: \"No changes suggested.\"\n\n\
        Use plain prose only. No markdown beyond the ## headers and numbered list.";

    let user_message = format!(
        "Target code: \"{}\"\nDescription: {}\n\nSample annotations ({} total):\n{}\nFull codebook:\n{}",
        request.code_label.trim(), description, request.annotations.len(), annotations_text, codebook_text
    );

    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        false,
    )
    .await?;

    Ok(OllamaCodeSummaryResponse { content, model: request.model, base_url })
}

#[tauri::command]
async fn generate_code_unique_annotations_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaUniqueAnnotationsResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an LLM model before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet.".to_string());
    }

    let runtime = resolve_llm_runtime(
        request.connection_mode.as_deref(),
        request.cloud_provider.clone(),
        request.cloud_api_secret.as_deref(),
        &request.protocol,
        &request.host,
        request.port,
    )?;
    let base_url = runtime_base_url(&runtime);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(10)))
        .build()
        .map_err(|e| e.to_string())?;

    let description = request.code_description.as_deref().map(str::trim).filter(|v| !v.is_empty()).unwrap_or("No description provided");
    let total = request.annotations.len();
    let return_count = total.min(5);

    let mut annotations_text = String::new();
    for (i, ann) in request.annotations.iter().enumerate() {
        let line = format!("[{}] [{}] \"{}\"\n", i + 1, ann.document_name.trim(), ann.quote.trim());
        if annotations_text.len() + line.len() > 16_000 {
            annotations_text.push_str("... (truncated)\n");
            break;
        }
        annotations_text.push_str(&line);
    }

    let system_prompt = format!(
        "You are a qualitative research assistant. Identify the {return_count} annotations that are most \
        semantically unique - the ones most distinct from all others for this code, capturing edge \
        cases, unusual dimensions, or aspects underrepresented by the rest.\n\n\
        Base your judgment only on the provided annotations. Do not infer missing context.\n\n\
        Return strict JSON only in this exact shape (no markdown fences, no extra keys):\n\
        {{\"annotations\": [{{\"annotation_index\": N, \"reasoning\": \"1-2 sentence explanation\"}}]}}\n\
        Return exactly {return_count} items. N must be a number between 1 and the total number of annotations provided."
    );

    let user_message = format!(
        "Code: {}\nDescription: {}\n\nAnnotations:\n{}",
        request.code_label.trim(),
        description,
        annotations_text
    );

    let content = run_llm_chat_completion(
        &runtime,
        &client,
        &request.model,
        &system_prompt,
        vec![serde_json::json!({ "role": "user", "content": user_message })],
        request.temperature,
        request.num_ctx,
        request.keep_alive_minutes,
        true,
    )
    .await?;

    let json_content = extract_json_object(&content).unwrap_or(&content);
    let parsed = parse_unique_annotations_payload(json_content)?;

    let annotations = parsed.annotations.into_iter()
        .filter(|item| item.index >= 1 && item.index <= total as u64)
        .take(return_count)
        .map(|item| OllamaUniqueAnnotationItem {
            annotation_index: item.index,
            reasoning: item.reasoning.unwrap_or_default().trim().to_string(),
        })
        .collect::<Vec<_>>();

    if annotations.is_empty() {
        return Err("The configured LLM did not return any valid unique annotation indexes.".to_string());
    }

    Ok(OllamaUniqueAnnotationsResponse { annotations, model: request.model, base_url })
}

#[tauri::command]
fn get_project_embedding_store_status(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectEmbeddingStoreStatus, String> {
    read_project_embedding_store_status(&app, &project_id)
}

#[tauri::command]
fn delete_project_embedding_store(
    auth_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
    project_id: String,
) -> Result<ProjectEmbeddingStoreStatus, String> {
    let client = reqwest::Client::new();
    let requester = tauri::async_runtime::block_on(authenticate_requesting_user(&client, &auth_token))?;
    if requester.app_role != "administrator" {
        let superuser_token = tauri::async_runtime::block_on(authenticate_internal_superuser(&app, &client))?;
        let project_role = tauri::async_runtime::block_on(find_project_role_for_user(
            &client,
            &superuser_token,
            &project_id,
            &requester.user_id,
        ))?;
        if !project_role_allows_embedding_build(project_role.as_deref()) {
            return Err("You do not have permission to delete project embeddings.".to_string());
        }
    }
    let current = state.0.lock().unwrap().clone();
    if (current.phase == "running" || current.phase == "cancelling")
        && current.project_id.as_deref() == Some(project_id.as_str())
    {
        return Err("This project's embeddings are currently being built. Cancel the build first.".to_string());
    }

    let index_dir = project_embedding_index_dir(&app, &project_id)?;
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
    }
    read_project_embedding_store_status(&app, &project_id)
}

#[tauri::command]
fn get_project_embedding_store_build_status(
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
) -> ProjectEmbeddingBuildStatus {
    state.0.lock().unwrap().clone().into()
}

#[tauri::command]
fn cancel_project_embedding_store_build(
    auth_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
) -> Result<ProjectEmbeddingBuildStatus, String> {
    let client = reqwest::Client::new();
    let requester = tauri::async_runtime::block_on(authenticate_requesting_user(&client, &auth_token))?;
    let current = state.0.lock().unwrap().clone();
    if requester.app_role != "administrator" {
        if let Some(project_id) = current.project_id.clone() {
            let superuser_token = tauri::async_runtime::block_on(authenticate_internal_superuser(&app, &client))?;
            let project_role = tauri::async_runtime::block_on(find_project_role_for_user(
                &client,
                &superuser_token,
                &project_id,
                &requester.user_id,
            ))?;
            if !project_role_allows_embedding_build(project_role.as_deref()) {
                return Err("You do not have permission to cancel this embedding build.".to_string());
            }
        }
    }
    let mut guard = state.0.lock().unwrap();
    if guard.phase == "running" {
        guard.cancel_requested = true;
        guard.phase = "cancelling".to_string();
        guard.message = Some("Cancelling embedding build...".to_string());
    }
    Ok(guard.clone().into())
}

#[tauri::command]
fn build_project_embedding_store_command(
    auth_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
    request: ProjectEmbeddingBuildRequest,
) -> Result<ProjectEmbeddingBuildStatus, String> {
    let client = reqwest::Client::new();
    let requester = tauri::async_runtime::block_on(authenticate_requesting_user(&client, &auth_token))?;
    if requester.app_role != "administrator" {
        let superuser_token = tauri::async_runtime::block_on(authenticate_internal_superuser(&app, &client))?;
        let project_role = tauri::async_runtime::block_on(find_project_role_for_user(
            &client,
            &superuser_token,
            &request.project_id,
            &requester.user_id,
        ))?;
        if !project_role_allows_embedding_build(project_role.as_deref()) {
            return Err("You do not have permission to build project embeddings.".to_string());
        }
    }
    let current = state.0.lock().unwrap().clone();
    if current.phase == "running" || current.phase == "cancelling" {
        return Err("A project embedding build is already in progress.".to_string());
    }

    set_project_embedding_build_status(&state, ProjectEmbeddingBuildStatusState {
        phase: "running".to_string(),
        project_id: Some(request.project_id.clone()),
        total_items: request.sources.iter().map(|source| source.items.len() as u64).sum(),
        completed_items: 0,
        started_at_ms: Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
        ),
        current_label: None,
        message: Some(
            "Preparing the local multilingual-e5 model. This first-run setup only needs to happen once per project."
                .to_string(),
        ),
        cancel_requested: false,
    });

    let handle = app.clone();
    std::thread::spawn(move || {
        let project_id = request.project_id.clone();
        match build_project_embedding_index(&handle, request) {
            Ok(index) => {
                update_project_embedding_build_status_from_handle(&handle, |status| {
                    status.phase = "completed".to_string();
                    status.project_id = Some(project_id);
                    status.completed_items = status.total_items;
                    status.current_label = None;
                    status.message = Some(format!(
                        "Local AI Assist embeddings are ready for this project. {} items are available in the current index.",
                        index.item_count
                    ));
                });
            }
            Err(error) => {
                update_project_embedding_build_status_from_handle(&handle, |status| {
                    status.phase = if error == "Embedding build cancelled." {
                        "cancelled".to_string()
                    } else {
                        "error".to_string()
                    };
                    status.project_id = Some(project_id);
                    status.current_label = None;
                    status.message = Some(error);
                    status.cancel_requested = false;
                });
            }
        }
    });

    Ok(state.0.lock().unwrap().clone().into())
}

/// Read a plain-text file and return its contents.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Return the machine's preferred outbound IPv4 address by routing a UDP
/// socket toward a public address (no packets are actually sent).
#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let addr = socket.local_addr().map_err(|e| e.to_string())?;
    Ok(addr.ip().to_string())
}

/// Attempt a TCP connection to `host:port` and return the round-trip time in
/// milliseconds, or an error string if the connection fails or times out.
#[tauri::command]
async fn ping_address(host: String, port: u16) -> Result<u64, String> {
    let addr = format!("{}:{}", host, port);
    let start = std::time::Instant::now();
    match tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_))  => Ok(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_)     => Err("Timed out".to_string()),
    }
}

/// Return the current network mode: "local" or "lan".
#[tauri::command]
fn get_network_mode(state: tauri::State<'_, NetworkMode>) -> String {
    state.0.lock().unwrap().clone()
}

/// Kill the running PocketBase process and restart it with a new bind address.
/// mode: "local" → binds to 127.0.0.1:8090, "lan" → binds to 0.0.0.0:8090
#[tauri::command]
async fn set_network_mode(
    auth_token: String,
    mode: String,
    app: tauri::AppHandle,
    pb_process: tauri::State<'_, PbProcess>,
    network_mode: tauri::State<'_, NetworkMode>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    authenticate_requesting_user(&client, &auth_token).await?;
    let bind = match mode.as_str() {
        "lan"   => "0.0.0.0:8090",
        _       => "127.0.0.1:8090",
    };

    // Kill the current PocketBase process
    kill_pocketbase_process(&pb_process);

    // Wait for the port to be released
    tokio::time::sleep(Duration::from_millis(600)).await;

    // Resolve the data directory arguments (same as startup)
    let app_data_dir = kanqual_data_dir(&app)?;
    let pb_data_dir = app_data_dir.join("pb_data");
    let pb_migrations_dir = pb_data_dir.join("pb_app_migrations");
    let pb_dir_arg = format!("--dir={}", pb_data_dir.to_string_lossy());
    let pb_migrations_arg = format!("--migrationsDir={}", pb_migrations_dir.to_string_lossy());

    // Spawn PocketBase with the new bind address
    let child = spawn_pb_serve(&app, bind, &pb_dir_arg, &pb_migrations_arg)?;

    // Store the new process handle
    {
        let mut guard = pb_process.0.lock().unwrap();
        *guard = Some(child);
    }

    // Wait until PocketBase accepts connections again
    wait_for_pb_port(Duration::from_secs(15)).await;

    // Update tracked mode
    {
        let mut guard = network_mode.0.lock().unwrap();
        *guard = mode;
    }

    Ok(())
}

#[tauri::command]
async fn start_local_pocketbase_command(
    app: tauri::AppHandle,
    pb_process: tauri::State<'_, PbProcess>,
    network_mode: tauri::State<'_, NetworkMode>,
) -> Result<String, String> {
    let _ = write_smoke_test_state(
        &app,
        serde_json::json!({
            "phase": "native-start-local",
            "message": "Starting local PocketBase from the native host.",
            "success": false,
            "appDataDir": kanqual_data_dir(&app).map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "portableMode": is_portable_mode().unwrap_or(false),
            "updatedAtMs": current_time_ms(),
        }),
    );
    start_local_pocketbase_runtime(&app, &pb_process, &network_mode).await?;
    let _ = write_smoke_test_state(
        &app,
        serde_json::json!({
            "phase": "native-start-local-complete",
            "message": "Local PocketBase start command completed.",
            "success": false,
            "appDataDir": kanqual_data_dir(&app).map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "portableMode": is_portable_mode().unwrap_or(false),
            "updatedAtMs": current_time_ms(),
        }),
    );
    Ok(PB_URL.to_string())
}

#[tauri::command]
fn stop_local_pocketbase_command(
    pb_process: tauri::State<'_, PbProcess>,
    network_mode: tauri::State<'_, NetworkMode>,
) -> Result<(), String> {
    kill_pocketbase_process(&pb_process);
    {
        let mut guard = network_mode.0.lock().unwrap();
        *guard = "local".to_string();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PbProcess(Mutex::new(None)))
        .manage(EmbeddingModelDownloadState(Mutex::new(EmbeddingModelDownloadStatusState::idle())))
        .manage(ProjectEmbeddingBuildState(Mutex::new(ProjectEmbeddingBuildStatusState::idle())))
        .manage(CancelledAttributeSuggestionRuns(Mutex::new(HashSet::new())))
        .manage(NetworkMode(Mutex::new("local".to_string())))
        .manage(PostgresExperimentAuthState(Mutex::new(None)))
        .manage(PostgresExperimentProjectSchemaCache(Mutex::new(HashSet::new())))
        .manage(PostgresExperimentConnectionCache(Arc::new(Mutex::new(HashMap::new()))))
        .setup(|app| {
            create_configured_window(app, "main").expect("could not create main window");
            create_configured_window(app, "splashscreen").expect("could not create splashscreen window");

            let app_data_dir = kanqual_data_dir(&app.app_handle())
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(250)).await;

                if let Some(splash) = handle.get_webview_window("splashscreen") {
                    splash.close().ok();
                }
                if let Some(main_window) = handle.get_webview_window("main") {
                    main_window.show().ok();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            get_pb_url,
            get_app_info,
            get_postgres_experiment_status_command,
            bootstrap_postgres_experiment_command,
            complete_postgres_admin_handoff_command,
            ensure_postgres_experiment_schema_command,
            get_postgres_experiment_auth_status_command,
            get_postgres_experiment_installation_settings_command,
            save_postgres_experiment_installation_settings_command,
            get_postgres_experiment_user_preferences_command,
            save_postgres_experiment_user_preferences_command,
            get_postgres_experiment_device_state_command,
            save_postgres_experiment_device_state_command,
            list_postgres_experiment_remembered_accounts_command,
            remember_postgres_experiment_account_command,
            rename_postgres_experiment_remembered_account_command,
            clear_postgres_experiment_remembered_accounts_command,
            get_postgres_experiment_user_project_state_command,
            remember_postgres_experiment_project_opened_command,
            remove_postgres_experiment_project_from_state_command,
            clear_postgres_experiment_user_project_state_command,
            register_postgres_experiment_app_user_command,
            login_postgres_experiment_admin_command,
            login_postgres_experiment_app_user_command,
            logout_postgres_experiment_app_user_command,
            update_postgres_experiment_app_user_profile_command,
            change_postgres_experiment_app_user_password_command,
            list_postgres_experiment_app_users_command,
            list_postgres_experiment_projects_command,
            create_postgres_experiment_project_command,
            update_postgres_experiment_project_command,
            delete_postgres_experiment_project_command,
            list_postgres_experiment_project_users_command,
            create_postgres_experiment_project_user_command,
            update_postgres_experiment_project_user_command,
            delete_postgres_experiment_project_user_command,
            get_postgres_experiment_project_ai_assist_settings_command,
            save_postgres_experiment_project_ai_assist_settings_command,
            get_postgres_experiment_project_document_import_settings_command,
            save_postgres_experiment_project_document_import_settings_command,
            get_postgres_experiment_project_canvas_state_command,
            save_postgres_experiment_project_canvas_state_command,
            save_postgres_experiment_saved_drawing_command,
            list_postgres_experiment_saved_drawings_command,
            list_postgres_experiment_saved_drawing_summaries_command,
            get_postgres_experiment_saved_drawing_command,
            delete_postgres_experiment_saved_drawing_command,
            list_postgres_experiment_sources_command,
            create_postgres_experiment_source_command,
            import_postgres_experiment_source_file_command,
            update_postgres_experiment_source_command,
            delete_postgres_experiment_source_command,
            list_postgres_experiment_source_locks_command,
            acquire_postgres_experiment_source_lock_command,
            release_postgres_experiment_source_lock_command,
            kick_postgres_experiment_source_lock_command,
            list_postgres_experiment_source_object_links_command,
            set_postgres_experiment_source_objects_command,
            list_postgres_experiment_source_attribute_definitions_command,
            list_postgres_experiment_source_attribute_values_command,
            save_postgres_experiment_source_attribute_command,
            delete_postgres_experiment_source_attribute_definition_command,
            list_postgres_experiment_codes_command,
            create_postgres_experiment_code_command,
            update_postgres_experiment_code_command,
            delete_postgres_experiment_code_command,
            list_postgres_experiment_annotation_summaries_command,
            create_postgres_experiment_annotation_command,
            update_postgres_experiment_annotation_command,
            delete_postgres_experiment_annotation_command,
            list_postgres_experiment_project_log_command,
            list_postgres_experiment_memos_command,
            create_postgres_experiment_memo_command,
            update_postgres_experiment_memo_command,
            delete_postgres_experiment_memo_command,
            list_postgres_experiment_object_types_command,
            create_postgres_experiment_object_type_command,
            update_postgres_experiment_object_type_command,
            save_postgres_experiment_object_type_command,
            delete_postgres_experiment_object_type_command,
            list_postgres_experiment_relationship_types_command,
            delete_postgres_experiment_relationship_type_command,
            create_postgres_experiment_relationship_type_command,
            update_postgres_experiment_relationship_type_command,
            save_postgres_experiment_relationship_type_command,
            list_postgres_experiment_objects_command,
            list_postgres_experiment_object_attribute_definitions_command,
            create_postgres_experiment_object_attribute_definition_command,
            update_postgres_experiment_object_attribute_definition_command,
            delete_postgres_experiment_object_attribute_definition_command,
            create_postgres_experiment_object_command,
            update_postgres_experiment_object_command,
            save_postgres_experiment_object_command,
            delete_postgres_experiment_object_command,
            list_postgres_experiment_relationships_command,
            list_postgres_experiment_relationship_attribute_definitions_command,
            create_postgres_experiment_relationship_attribute_definition_command,
            update_postgres_experiment_relationship_attribute_definition_command,
            delete_postgres_experiment_relationship_attribute_definition_command,
            create_postgres_experiment_relationship_command,
            update_postgres_experiment_relationship_command,
            save_postgres_experiment_relationship_command,
            delete_postgres_experiment_relationship_command,
            get_smoke_test_config_command,
            update_smoke_test_state_command,
            create_user_account_command,
            register_user_account_command,
            ensure_imported_user_account_command,
            delete_user_account_command,
            update_user_account_command,
            clear_app_data_records_command,
            get_registered_user_count_command,
            list_registered_user_accounts_command,
            ensure_backend_setup_command,
            encrypt_project_backup,
            decrypt_project_backup_payload,
            decrypt_project_backup_preview,
            get_multilingual_e5_status,
            get_multilingual_e5_download_preflight,
            get_multilingual_e5_download_status,
            get_project_embedding_store_status,
            get_project_embedding_store_build_preflight,
            delete_project_embedding_store,
            get_project_embedding_store_build_status,
            cancel_project_embedding_store_build,
            build_project_embedding_store_command,
            discover_ollama_models,
            discover_cloud_llm_models,
            chat_with_project_ollama,
            find_relevant_project_segments_with_ollama,
            generate_attribute_value_suggestions_with_ollama,
            cancel_attribute_suggestion_run,
            process_document_with_ollama,
            process_document_chunk_with_ollama,
            generate_code_conceptual_summary_with_ollama,
            generate_most_typical_annotation_with_ollama,
            generate_code_decomposition_with_ollama,
            generate_code_position_with_ollama,
            generate_code_unique_annotations_with_ollama,
            cancel_multilingual_e5_download,
            clear_multilingual_e5_model,
            get_local_ip,
            ping_address,
            download_multilingual_e5_model,
            get_network_mode,
            set_network_mode,
            start_local_pocketbase_command,
            stop_local_pocketbase_command,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::Exit => {
                    let pb_process = app_handle.state::<PbProcess>();
                    kill_pocketbase_process(&pb_process);
                }
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if label == "main" {
                        if let tauri::WindowEvent::Destroyed = event {
                            let pb_process = app_handle.state::<PbProcess>();
                            kill_pocketbase_process(&pb_process);
                        }
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        app_role_allows_embedding_model_management,
        extract_transcript_leading_metadata,
        normalized_project_role,
        project_role_allows_embedding_build,
    };

    #[test]
    fn embedding_model_management_is_administrator_only() {
        assert!(app_role_allows_embedding_model_management("administrator"));
        assert!(!app_role_allows_embedding_model_management("standard"));
        assert!(!app_role_allows_embedding_model_management("owner"));
    }

    #[test]
    fn embedding_build_allows_owner_and_editor_project_roles() {
        assert!(project_role_allows_embedding_build(Some("owner")));
        assert!(project_role_allows_embedding_build(Some("editor")));
        assert!(!project_role_allows_embedding_build(Some("coder")));
        assert!(!project_role_allows_embedding_build(Some("viewer")));
        assert!(!project_role_allows_embedding_build(None));
    }

    #[test]
    fn project_role_normalization_matches_current_permission_model() {
        assert_eq!(normalized_project_role(Some("owner")), "owner");
        assert_eq!(normalized_project_role(Some("editor")), "editor");
        assert_eq!(normalized_project_role(Some("coder")), "coder");
        assert_eq!(normalized_project_role(Some("viewer")), "viewer");
        assert_eq!(normalized_project_role(Some("unexpected")), "viewer");
        assert_eq!(normalized_project_role(None), "viewer");
    }

    #[test]
    fn transcript_cleanup_strips_timestamp_then_speaker_prefixes() {
        let (text, speaker_id, timestamp_text) =
            extract_transcript_leading_metadata("[00:01:02] Interviewer: Thanks for joining us.");

        assert_eq!(text, "Thanks for joining us.");
        assert_eq!(speaker_id.as_deref(), Some("Interviewer"));
        assert_eq!(timestamp_text, "[00:01:02]");
    }

    #[test]
    fn transcript_cleanup_strips_speaker_then_timestamp_prefixes() {
        let (text, speaker_id, timestamp_text) =
            extract_transcript_leading_metadata("P1: [00:01:02-00:01:05] I felt supported.");

        assert_eq!(text, "I felt supported.");
        assert_eq!(speaker_id.as_deref(), Some("P1"));
        assert_eq!(timestamp_text, "[00:01:02-00:01:05]");
    }
}

