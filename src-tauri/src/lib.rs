use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
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
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};
use zeroize::Zeroizing;

const PB_URL: &str = "http://127.0.0.1:8090";
const BACKEND_IDENTITY_FILE: &str = "backend_identity.json";
const APP_METADATA_COLLECTION: &str = "app_metadata";
const BACKEND_IDENTIFIER_KEY: &str = "backend_identifier";
const USERS_TABLE_IDENTIFIER_KEY: &str = "users_table_identifier";
const PORTABLE_MODE_MARKER_FILE: &str = "portable-mode.json";
const PORTABLE_DATA_DIR_NAME: &str = "data";
const EMBEDDING_MODEL_REPO_ID: &str = "intfloat/multilingual-e5-large";
const EMBEDDING_MODEL_DISPLAY_NAME: &str = "multilingual-e5-large";
const EMBEDDING_MODEL_METADATA_FILE: &str = ".kanqual-model.json";
const EMBEDDING_MODEL_EXPECTED_SIZE_BYTES: u64 = 4_499_523_339;
const PROJECT_EMBEDDING_INDEX_FILE: &str = "multilingual-e5-index.json";
const PROJECT_EMBEDDING_BUILD_BATCH_SIZE_CAP: usize = 8;
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

/// Spawn a PocketBase serve process with the given bind address.
/// Returns the child handle on success.
fn spawn_pb_serve(app: &tauri::AppHandle, bind: &str, pb_dir_arg: &str, pb_migrations_arg: &str) -> Result<CommandChild, String> {
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
    if let Some(portable_dir) = portable_data_dir()? {
        fs::create_dir_all(&portable_dir).map_err(|e| e.to_string())?;
        return Ok(portable_dir);
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    app_data_dir: String,
    app_version: String,
    portable_mode: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackendIdentity {
    version: u32,
    superuser_email: String,
    superuser_password: String,
    created_at_ms: u64,
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
struct ProjectEmbeddingIndexStatus {
    exists: bool,
    generated_at_ms: Option<u64>,
    item_count: u64,
    model_repo_id: Option<String>,
    model_display_name: Option<String>,
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
    items: Vec<ProjectEmbeddingBuildItem>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEmbeddingIndexItem {
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
struct ProjectEmbeddingIndexFile {
    project_id: String,
    model_repo_id: String,
    model_display_name: String,
    generated_at_ms: u64,
    item_count: u64,
    chunk_size: usize,
    overlap_size: usize,
    prefix_passages: bool,
    normalize_whitespace: bool,
    items: Vec<ProjectEmbeddingIndexItem>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaProjectChatRequest {
    project_id: String,
    query: String,
    conversation: Vec<OllamaChatMessage>,
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
            { "name": "occurred_at", "type": "autodate", "system": false, "hidden": false, "presentable": false, "onCreate": true, "onUpdate": false },
            { "name": "restored_at", "type": "text" }
        ]
    }), false).await?;

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

fn project_embedding_index_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(project_embedding_index_dir(app, project_id)?.join(PROJECT_EMBEDDING_INDEX_FILE))
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

fn embed_text_batch(runtime: &mut LocalEmbeddingRuntime, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
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

fn build_project_embedding_index(
    app: &tauri::AppHandle,
    request: ProjectEmbeddingBuildRequest,
) -> Result<ProjectEmbeddingIndexFile, String> {
    let mut runtime = load_embedding_runtime(app)?;
    let index_dir = project_embedding_index_dir(app, &request.project_id)?;
    fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;
    let index_path = index_dir.join(PROJECT_EMBEDDING_INDEX_FILE);
    let temp_path = index_dir.join(format!("{PROJECT_EMBEDDING_INDEX_FILE}.tmp"));

    let batch_size = request
        .batch_size
        .max(1)
        .min(PROJECT_EMBEDDING_BUILD_BATCH_SIZE_CAP);
    let existing_index = read_project_embedding_index_file(app, &request.project_id).ok();
    let existing_items_by_id = existing_index
        .as_ref()
        .map(|index| {
            index
                .items
                .iter()
                .map(|item| (item.id.as_str(), item))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut reused_embeddings = HashMap::<String, Vec<f32>>::new();
    let mut pending_items = Vec::new();

    for source_item in &request.items {
        let existing_matches = existing_items_by_id
            .get(source_item.id.as_str())
            .map(|existing_item| {
                (!existing_item.content_hash.is_empty() && existing_item.content_hash == source_item.content_hash)
                    || (existing_item.content_hash.is_empty() && existing_item.text == source_item.text)
            })
            .unwrap_or(false);

        if existing_matches {
            if let Some(existing_item) = existing_items_by_id.get(source_item.id.as_str()) {
                reused_embeddings.insert(source_item.id.clone(), existing_item.embedding.clone());
            }
        } else {
            pending_items.push(source_item.clone());
        }
    }

    let pending_total = pending_items.len() as u64;
    let reused_total = reused_embeddings.len() as u64;
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
                request.items.len()
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

    let mut pending_embeddings = HashMap::<String, Vec<f32>>::new();

    for batch_start in (0..pending_items.len()).step_by(batch_size) {
        if is_project_embedding_build_cancel_requested(app) {
            return Err("Embedding build cancelled.".to_string());
        }
        let batch_end = (batch_start + batch_size).min(pending_items.len());
        let batch = &pending_items[batch_start..batch_end];
        let batch_number = (batch_start / batch_size) + 1;
        let batch_count = pending_items.len().div_ceil(batch_size);
        update_project_embedding_build_status_from_handle(app, |status| {
            status.current_label = batch.first().map(|item| item.title.clone());
            status.message = Some(format!(
                "Embedding batch {} of {} for this project's current content.",
                batch_number, batch_count
            ));
        });
        let texts = batch.iter().map(|item| item.text.clone()).collect::<Vec<_>>();
        let embeddings = embed_text_batch(&mut runtime, &texts)?;

        for (source_item, embedding) in batch.iter().zip(embeddings.into_iter()) {
            pending_embeddings.insert(source_item.id.clone(), embedding);
        }

        update_project_embedding_build_status_from_handle(app, |status| {
            status.completed_items = batch_end as u64;
            status.current_label = batch.last().map(|item| item.title.clone());
            status.message = Some(
                if reused_total > 0 {
                    format!(
                        "Reusing {} unchanged embeddings. Generating {} new or updated multilingual-e5 embeddings.",
                        reused_total, pending_total
                    )
                } else {
                    format!(
                        "Generating {} multilingual-e5 embeddings for this project's current content.",
                        pending_total
                    )
                },
              );
          });
      }

      if is_project_embedding_build_cancel_requested(app) {
          return Err("Embedding build cancelled.".to_string());
      }

    let mut items = Vec::with_capacity(request.items.len());
    for source_item in request.items {
        let embedding = if let Some(existing_embedding) = reused_embeddings.remove(&source_item.id) {
            existing_embedding
        } else if let Some(new_embedding) = pending_embeddings.remove(&source_item.id) {
            new_embedding
        } else {
            return Err(format!(
                "Missing embedding payload for project item {} while building the local index.",
                source_item.id
            ));
        };

        items.push(ProjectEmbeddingIndexItem {
            id: source_item.id,
            item_type: source_item.item_type,
            source_id: source_item.source_id,
            title: source_item.title,
            text: source_item.text,
            content_hash: source_item.content_hash,
            document_id: source_item.document_id,
            case_id: source_item.case_id,
            code_id: source_item.code_id,
            annotation_id: source_item.annotation_id,
            memo_id: source_item.memo_id,
            start_offset: source_item.start_offset,
            end_offset: source_item.end_offset,
            embedding,
        });
    }

    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;

    let index_file = ProjectEmbeddingIndexFile {
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

    let raw = serde_json::to_string(&index_file).map_err(|e| e.to_string())?;
    fs::write(&temp_path, raw).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &index_path).map_err(|e| e.to_string())?;

    Ok(index_file)
}

fn read_project_embedding_index_status(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<ProjectEmbeddingIndexStatus, String> {
    let index_path = project_embedding_index_path(app, project_id)?;
    if !index_path.exists() {
        return Ok(ProjectEmbeddingIndexStatus {
            exists: false,
            generated_at_ms: None,
            item_count: 0,
            model_repo_id: None,
            model_display_name: None,
        });
    }

    let raw = fs::read_to_string(index_path).map_err(|e| e.to_string())?;
    let index: ProjectEmbeddingIndexFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(ProjectEmbeddingIndexStatus {
        exists: true,
        generated_at_ms: Some(index.generated_at_ms),
        item_count: index.item_count,
        model_repo_id: Some(index.model_repo_id),
        model_display_name: Some(index.model_display_name),
    })
}

fn read_project_embedding_index_file(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<ProjectEmbeddingIndexFile, String> {
    let index_path = project_embedding_index_path(app, project_id)?;
    if !index_path.exists() {
        return Err("No local project embedding index exists yet. Re-run project embeddings first.".to_string());
    }
    let raw = fs::read_to_string(index_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
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
fn get_project_embedding_build_preflight(
    app: tauri::AppHandle,
    request: ProjectEmbeddingBuildRequest,
) -> Result<ProjectEmbeddingBuildPreflight, String> {
    let existing_index = read_project_embedding_index_file(&app, &request.project_id).ok();
    let existing_items_by_id = existing_index
        .as_ref()
        .map(|index| {
            index
                .items
                .iter()
                .map(|item| (item.id.as_str(), item))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut pending_items = 0_u64;
    let mut pending_characters = 0_u64;
    let mut reused_items = 0_u64;

    for source_item in &request.items {
        let existing_matches = existing_items_by_id
            .get(source_item.id.as_str())
            .map(|existing_item| {
                (!existing_item.content_hash.is_empty() && existing_item.content_hash == source_item.content_hash)
                    || (existing_item.content_hash.is_empty() && existing_item.text == source_item.text)
            })
            .unwrap_or(false);

        if existing_matches {
            reused_items += 1;
        } else {
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
        total_items: request.items.len() as u64,
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

fn relevant_segment_match_text(item: &ProjectEmbeddingIndexItem) -> Option<String> {
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
    let status = embedding_model_status(&app)?;
    let model_dir = embedding_model_dir(&app)?;
    fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
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

#[tauri::command]
async fn chat_with_project_ollama(
    app: tauri::AppHandle,
    request: OllamaProjectChatRequest,
) -> Result<OllamaProjectChatResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an Ollama model in App Settings before starting a project chat.".to_string());
    }

    let query = request.query.trim();
    if query.is_empty() {
        return Err("Enter a message before sending it to Ollama.".to_string());
    }

    let index = read_project_embedding_index_file(&app, &request.project_id)?;
    if index.items.is_empty() {
        return Err("The local project embedding index is empty. Re-run project embeddings first.".to_string());
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

    let matches_selected_context = |item: &ProjectEmbeddingIndexItem| {
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

    let mut ranked_items = index
        .items
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
        "You are Kanqual AI Assist. {} If the context does not support a claim, say that you do not know. Be concise and grounded. When you use retrieved context, add inline citation markers like [1] or [2] that refer to the numbered context blocks below. Only cite numbers that appear in the retrieved context, and place citations immediately after the supported claim.\n\nRetrieved project context:\n{}",
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

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model,
            "stream": false,
            "messages": messages,
            "options": {
                "temperature": request.temperature,
                "num_ctx": request.num_ctx,
            },
            "keep_alive": format!("{}m", request.keep_alive_minutes),
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Ollama returned an empty chat response.".to_string())?;

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
        return Err("Choose an Ollama model in App Settings before starting a relevant-segments search.".to_string());
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

    let index = read_project_embedding_index_file(&app, &request.project_id)?;
    if index.items.is_empty() {
        return Err("The local project embedding index is empty. Re-run project embeddings first.".to_string());
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
    let query_embedding = embed_text_batch(&mut runtime, &[query_text])?
        .into_iter()
        .next()
        .ok_or_else(|| "Could not generate an embedding for the selected code.".to_string())?;

    let mut ranked_items = index
        .items
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
        "You are Kanqual AI Assist. Review the candidate project segments below and choose the segments that are most relevant to the selected code.\n\nSelected code: {}\nCode description: {}\n\nReturn strict JSON only in this shape:\n{{\"segments\":[{{\"id\":\"candidate-id\",\"reason\":\"short explanation\"}}]}}\n\nRules:\n- Use only candidate ids from the provided list.\n- Prefer document passages and annotations over generic metadata.\n- Return between 0 and {} segments.\n- Keep each reason under 18 words.\n- Do not include markdown fences or extra commentary.\n\nCandidates:\n{}",
        request.code_label.trim(),
        request.code_description.as_deref().unwrap_or("").trim(),
        max_results,
        candidate_block
    );

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(5)))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model,
            "stream": false,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                }
            ],
            "options": {
                "temperature": request.temperature,
                "num_ctx": request.num_ctx,
            },
            "keep_alive": format!("{}m", request.keep_alive_minutes),
            "format": "json",
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Ollama returned an empty relevant-segments response.".to_string())?;

    let json_content = extract_json_object(content).unwrap_or(content);
    let parsed: OllamaRelevantSegmentsModelResponse = serde_json::from_str(json_content)
        .map_err(|e| format!("Could not parse Ollama's relevant-segments response: {e}"))?;

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
                    .unwrap_or_else(|| "Marked relevant by Ollama for this code.".to_string()),
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
        return Err("Choose an Ollama model in App Settings before generating attribute suggestions.".to_string());
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

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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
            "You are Kanqual AI Assist. Infer a suggested value for one project attribute from the provided source text.\n\nAttribute name: {}\nAttribute data type: {}\nAttribute description: {}{}\n\nRules:\n- {}\n- Base the suggestion only on the provided text.\n- Also return a short evidence excerpt copied from the text that best supports the suggestion.\n- If the text does not support any value, return empty strings.\n- Return strict JSON only in this exact shape: {{\"value\":\"...\",\"evidence\":\"...\"}}\n- Do not include markdown fences or extra commentary.\n\nSource item: {}\nSource text:\n{}",
            request.attribute_name.trim(),
            if data_type.is_empty() { "text" } else { data_type.as_str() },
            attribute_description,
            attribute_options_text,
            data_type_instruction,
            item_name,
            content,
        );

        let response = client
            .post(format!("{base_url}/api/chat"))
            .json(&serde_json::json!({
                "model": request.model,
                "stream": false,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt,
                    }
                ],
                "options": {
                    "temperature": request.temperature,
                    "num_ctx": request.num_ctx,
                },
                "keep_alive": format!("{}m", request.keep_alive_minutes),
                "format": "json",
            }))
            .send()
            .await
            .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Ollama returned an error: {e}"))?;

        if cancelled_runs.0.lock().unwrap().contains(request.run_id.as_str()) {
            cancelled_runs.0.lock().unwrap().remove(request.run_id.as_str());
            return Err("Attribute suggestion generation was stopped.".to_string());
        }

        let payload: Value = response.json().await.map_err(|e| e.to_string())?;
        let content = payload
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Ollama returned an empty attribute-suggestion response.".to_string())?;

        let json_content = extract_json_object(content).unwrap_or(content);
        let parsed: OllamaAttributeSuggestionModelResponse = serde_json::from_str(json_content)
            .map_err(|e| format!("Could not parse Ollama's attribute-suggestion response: {e}"))?;
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
        return Err("Choose an Ollama model in App Settings before running code analysis.".to_string());
    }
    if request.code_label.trim().is_empty() {
        return Err("No code selected.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet. Add some annotations before running analysis.".to_string());
    }

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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
        1. A narrative conceptual summary of ~200 words describing what this code represents, the themes and patterns visible across its annotations, and how the code appears to be used in the data.\n\
        2. Up to 5 key insights or standout observations drawn from the data. These can cover: recurring themes, notable patterns, how many documents mention specific aspects, interesting contrasts, or any other meaningful dimension.\n\n\
        Each annotation is identified by a number in square brackets (e.g. [1], [2]). \
        Cite specific annotations inline wherever they support your points — for example: \"resilience appears across multiple accounts [1][4]\". \
        Cite as many annotations as are genuinely relevant. Citations should appear naturally within sentences, not only at the end.\n\n\
        Format your response exactly as:\n\
        ## Summary\n\
        [narrative with inline citations]\n\n\
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

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model,
            "stream": false,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user",   "content": user_message  },
            ],
            "options": {
                "temperature": request.temperature,
                "num_ctx": request.num_ctx,
            },
            "keep_alive": format!("{}m", request.keep_alive_minutes),
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())?
        .to_string();

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
        return Err("Choose an Ollama model in App Settings before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet. Add some annotations before running analysis.".to_string());
    }

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model,
            "stream": false,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user",   "content": user_message  },
            ],
            "options": {
                "temperature": request.temperature,
                "num_ctx": request.num_ctx,
            },
            "keep_alive": format!("{}m", request.keep_alive_minutes),
            "format": "json",
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())?;

    let json_content = extract_json_object(content).unwrap_or(content);
    let parsed = parse_most_typical_annotation_payload(json_content)?;

    let annotations = parsed
        .annotations
        .into_iter()
        .filter(|item| item.annotation_index >= 1 && item.annotation_index <= total as u64)
        .take(return_count)
        .collect::<Vec<_>>();

    if annotations.is_empty() {
        return Err("Ollama did not return any valid typical annotation indexes.".to_string());
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
        return Err("Choose an Ollama model in App Settings before processing a document.".to_string());
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
    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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
        Also identify only speaker names that appear in the transcript format itself, meaning real names used as speaker labels or turn labels.\n\
        Do not identify names mentioned only inside the body text.\n\
        Do not include generic role words by themselves, such as \"Interviewer\", \"Participant\", or \"Moderator\", unless they are clearly used as actual names in the speaker label.\n\n\
        Return strict JSON only, with no markdown fences and no extra keys, in exactly this shape:\n\
        {\"segments\": [{\"segmentType\": \"...\", \"speakerId\": \"...\", \"text\": \"...\"}, ...], \"properNames\": [\"...\", \"...\"]}\n\n\
        Rules:\n\
        - The segments must cover the entire text; every character must appear in exactly one segment\n\
        - Preserve the original text verbatim within each segment; do not rephrase, summarize, or modify wording\n\
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

        let response = client
            .post(format!("{base_url}/api/chat"))
            .json(&serde_json::json!({
                "model": request.model,
                "stream": false,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user",   "content": user_message  },
                ],
                "options": {
                    "temperature": request.temperature,
                    "num_ctx": request.num_ctx,
                },
                "keep_alive": format!("{}m", request.keep_alive_minutes),
                "format": "json",
            }))
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    format!(
                        "Ollama timed out while processing this document at {base_url}. Transcript processing can take several minutes, especially for longer files."
                    )
                } else {
                    format!("Could not reach Ollama at {base_url}: {e}")
                }
            })?
            .error_for_status()
            .map_err(|e| format!("Ollama returned an error on chunk {}: {e}", chunk_index + 1))?;

        let payload: Value = response.json().await.map_err(|e| e.to_string())?;
        let raw = payload
            .get("message").and_then(|m| m.get("content")).and_then(Value::as_str)
            .map(str::trim).filter(|v| !v.is_empty())
            .ok_or_else(|| format!("Ollama returned an empty response for chunk {}.", chunk_index + 1))?;

        let json_part = extract_json_object(raw).unwrap_or(raw);
        let parsed: OllamaDocumentSegmentsModelResponse = serde_json::from_str(json_part)
            .map_err(|e| format!("Could not parse Ollama's response for chunk {}: {e}", chunk_index + 1))?;

        if parsed.segments.is_empty() {
            return Err(format!("Ollama returned no segments for chunk {}.", chunk_index + 1));
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
            let text = seg.text.unwrap_or_default();
            let text = text.trim();
            if text.is_empty() { continue; }
            if !chunk_built.is_empty() { chunk_built.push_str("\n\n"); }
            let start_offset = base_offset + chunk_built.len();
            chunk_built.push_str(text);
            let end_offset = base_offset + chunk_built.len();
            let segment_type = match seg.segment_type.trim().to_ascii_lowercase().as_str() {
                "metadata" => "metadata",
                "question"  => "question",
                _ => "answer",
            };
            segments_output.push(OllamaDocumentSegmentOutput {
                segment_type: segment_type.to_string(),
                speaker_id: seg.speaker_id.unwrap_or_default().trim().to_string(),
                start_offset,
                end_offset,
                sort_order: segments_output.len(),
                text: text.to_string(),
                chunk_index,
            });
        }

        if !processed_content.is_empty() && !chunk_built.is_empty() {
            processed_content.push_str("\n\n");
        }
        processed_content.push_str(&chunk_built);
    }

    if segments_output.is_empty() {
        return Err("Ollama returned no segments for any chunk.".to_string());
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

#[tauri::command]
async fn generate_code_decomposition_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaCodeSummaryResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an Ollama model in App Settings before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet.".to_string());
    }

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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
        Each annotation is identified by [N]. Cite specific annotations inline when discussing them.\n\n\
        Format your response exactly as:\n\
        ## Decomposition Analysis\n\
        [narrative — does the code hold together? Any internal tensions or sub-themes?]\n\n\
        ## Outliers or Sub-clusters\n\
        [Describe specific outlier annotations or sub-clusters with citation numbers, \
        or write \"None identified — the code appears cohesive.\" if all annotations fit well]\n\n\
        Use plain prose only. No markdown beyond the ## headers and [N] citation markers.";

    let user_message = format!(
        "Code: {}\nDescription: {}\n\nTotal annotations: {}\nDocuments represented: {}\n\nAnnotations:\n{}",
        request.code_label.trim(), description, request.annotations.len(), unique_docs.len(), annotations_text
    );

    let response = client.post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model, "stream": false,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "options": {"temperature": request.temperature, "num_ctx": request.num_ctx},
            "keep_alive": format!("{}m", request.keep_alive_minutes),
        }))
        .send().await.map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status().map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload.get("message").and_then(|m| m.get("content")).and_then(Value::as_str)
        .map(str::trim).filter(|v| !v.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())?.to_string();

    Ok(OllamaCodeSummaryResponse { content, model: request.model, base_url })
}

#[tauri::command]
async fn generate_code_position_with_ollama(
    request: OllamaCodePositionRequest,
) -> Result<OllamaCodeSummaryResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an Ollama model in App Settings before running code analysis.".to_string());
    }

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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
        Format your response exactly as:\n\
        ## Position Analysis\n\
        [narrative about the code's current placement and fit within the codebook]\n\n\
        ## Suggestions\n\
        1. [concrete suggestion, or \"No changes suggested.\" if the position is appropriate]\n\n\
        Use plain prose only. No markdown beyond the ## headers and numbered list.";

    let user_message = format!(
        "Target code: \"{}\"\nDescription: {}\n\nSample annotations ({} total):\n{}\nFull codebook:\n{}",
        request.code_label.trim(), description, request.annotations.len(), annotations_text, codebook_text
    );

    let response = client.post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model, "stream": false,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "options": {"temperature": request.temperature, "num_ctx": request.num_ctx},
            "keep_alive": format!("{}m", request.keep_alive_minutes),
        }))
        .send().await.map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status().map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload.get("message").and_then(|m| m.get("content")).and_then(Value::as_str)
        .map(str::trim).filter(|v| !v.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())?.to_string();

    Ok(OllamaCodeSummaryResponse { content, model: request.model, base_url })
}

#[tauri::command]
async fn generate_code_unique_annotations_with_ollama(
    request: OllamaCodeSummaryRequest,
) -> Result<OllamaUniqueAnnotationsResponse, String> {
    if request.model.trim().is_empty() {
        return Err("Choose an Ollama model in App Settings before running code analysis.".to_string());
    }
    if request.annotations.is_empty() {
        return Err("This code has no annotations yet.".to_string());
    }

    let base_url = ollama_base_url(&request.protocol, &request.host, request.port);
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

    let response = client.post(format!("{base_url}/api/chat"))
        .json(&serde_json::json!({
            "model": request.model, "stream": false,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "options": {"temperature": request.temperature, "num_ctx": request.num_ctx},
            "keep_alive": format!("{}m", request.keep_alive_minutes),
            "format": "json",
        }))
        .send().await.map_err(|e| format!("Could not reach Ollama at {base_url}: {e}"))?
        .error_for_status().map_err(|e| format!("Ollama returned an error: {e}"))?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let content = payload.get("message").and_then(|m| m.get("content")).and_then(Value::as_str)
        .map(str::trim).filter(|v| !v.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())?;

    let json_content = extract_json_object(content).unwrap_or(content);
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
        return Err("Ollama did not return any valid unique annotation indexes.".to_string());
    }

    Ok(OllamaUniqueAnnotationsResponse { annotations, model: request.model, base_url })
}

#[tauri::command]
fn get_project_embedding_index_status(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectEmbeddingIndexStatus, String> {
    read_project_embedding_index_status(&app, &project_id)
}

#[tauri::command]
fn delete_project_embedding_index(
    auth_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
    project_id: String,
) -> Result<ProjectEmbeddingIndexStatus, String> {
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
    read_project_embedding_index_status(&app, &project_id)
}

#[tauri::command]
fn get_project_embedding_build_status(
    state: tauri::State<'_, ProjectEmbeddingBuildState>,
) -> ProjectEmbeddingBuildStatus {
    state.0.lock().unwrap().clone().into()
}

#[tauri::command]
fn cancel_project_embedding_build(
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
fn build_project_embedding_index_command(
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
        total_items: request.items.len() as u64,
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
    start_local_pocketbase_runtime(&app, &pb_process, &network_mode).await?;
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
            create_user_account_command,
            register_user_account_command,
            ensure_imported_user_account_command,
            delete_user_account_command,
            update_user_account_command,
            clear_app_data_records_command,
            get_registered_user_count_command,
            ensure_backend_setup_command,
            encrypt_project_backup,
            decrypt_project_backup_payload,
            decrypt_project_backup_preview,
            get_multilingual_e5_status,
            get_multilingual_e5_download_preflight,
            get_multilingual_e5_download_status,
            get_project_embedding_index_status,
            get_project_embedding_build_preflight,
            delete_project_embedding_index,
            get_project_embedding_build_status,
            cancel_project_embedding_build,
            build_project_embedding_index_command,
            discover_ollama_models,
            chat_with_project_ollama,
            find_relevant_project_segments_with_ollama,
            generate_attribute_value_suggestions_with_ollama,
            cancel_attribute_suggestion_run,
            process_document_with_ollama,
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
}

