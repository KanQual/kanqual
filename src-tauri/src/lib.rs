use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const PB_URL: &str = "http://127.0.0.1:8090";
const PB_SUPERUSER_EMAIL: &str = "app@kanqual.internal";
const PB_SUPERUSER_PASSWORD: &str = "Kanqual_Internal_2024!";

/// Return the URL of the local PocketBase instance.
#[tauri::command]
fn get_pb_url() -> String {
    PB_URL.to_string()
}

/// Read a plain-text file and return its contents.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let pb_data_dir = app_data_dir.join("pb_data");
            let pb_dir_arg = format!("--dir={}", pb_data_dir.to_string_lossy());

            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                // Step 1: Run `pocketbase superuser upsert` as a one-shot command.
                // This writes the superuser into the database BEFORE `serve` starts,
                // so PocketBase never sees an empty superuser table and never opens
                // the browser admin UI.
                let _ = handle
                    .shell()
                    .sidecar("pocketbase")
                    .expect("pocketbase sidecar not found")
                    .args([
                        "superuser",
                        "upsert",
                        PB_SUPERUSER_EMAIL,
                        PB_SUPERUSER_PASSWORD,
                        &pb_dir_arg,
                    ])
                    .output()
                    .await;

                // Step 2: Now start the server. Superuser already exists — no
                // browser redirect will be triggered.
                handle
                    .shell()
                    .sidecar("pocketbase")
                    .expect("pocketbase sidecar not found")
                    .args(["serve", "--http=127.0.0.1:8090", &pb_dir_arg])
                    .spawn()
                    .expect("failed to spawn pocketbase");

                // Step 3: Wait for the frontend to finish loading, then close the splash.
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                if let Some(splash) = handle.get_webview_window("splashscreen") {
                    splash.close().ok();
                }
                if let Some(main_window) = handle.get_webview_window("main") {
                    main_window.show().ok();
                }
            });

            Ok(()) // returns immediately so the splash renders on the first frame
        })
        .invoke_handler(tauri::generate_handler![read_text_file, get_pb_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
