//! Loopback-only, revocable media URLs. File bodies never cross the JS bridge.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

#[derive(Clone)]
struct Grant {
    project_id: String,
    source_id: String,
    image: bool,
    image_size: Option<u32>,
    user_id: String,
    session_started_at_ms: u64,
    path: PathBuf,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub(super) struct MediaState {
    grants: Mutex<HashMap<String, Grant>>,
    port: tokio::sync::OnceCell<u16>,
}

fn contained_file(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Media must be a file inside project storage.".into());
    }
    Ok(path)
}

#[tauri::command]
pub(super) async fn open_media_stream_command(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    open_stream(app, path, false, None).await
}

#[tauri::command]
pub(super) async fn open_image_stream_command(
    app: tauri::AppHandle,
    path: String,
    size: Option<u32>,
) -> Result<String, String> {
    open_stream(app, path, true, size).await
}

const IMAGE_PATHS: &str = "SELECT storage_path FROM sources WHERE storage_path <> '' UNION SELECT image_storage_path FROM sources UNION SELECT image_storage_path FROM research_objects UNION SELECT image_storage_path FROM object_types UNION SELECT image_storage_path FROM source_type_settings";

pub(super) async fn registered_image(
    client: &tokio_postgres::Client,
    root: &Path,
    requested: &Path,
) -> Result<bool, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = requested
        .strip_prefix(&canonical_root)
        .map_err(|e| e.to_string())?;
    let absolute = requested.to_string_lossy().replace('\\', "/");
    let mut candidates = vec![
        relative.to_string_lossy().replace('\\', "/"),
        absolute.clone(),
        root.join(relative).to_string_lossy().replace('\\', "/"),
    ];
    if let Some(plain) = absolute.strip_prefix("//?/") {
        candidates.push(plain.to_string());
    }
    let comparison = if cfg!(windows) {
        for path in &mut candidates {
            *path = path.to_lowercase();
        }
        "lower(replace(storage_path, chr(92), '/'))"
    } else {
        "replace(storage_path, chr(92), '/')"
    };
    let query =
        format!("SELECT storage_path FROM ({IMAGE_PATHS}) images WHERE {comparison} = ANY($1)");
    Ok(client
        .query(&query, &[&candidates])
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .any(|row| {
            let stored: String = row.get(0);
            !stored.is_empty()
                && contained_file(root, &root.join(stored)).ok().as_deref() == Some(requested)
        }))
}

async fn open_stream(
    app: tauri::AppHandle,
    path: String,
    image: bool,
    image_size: Option<u32>,
) -> Result<String, String> {
    let auth = app.state::<PostgresExperimentAuthState>();
    let session = require_postgres_experiment_auth_session(&app, Some(&auth)).await?;
    let requested = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
    let (client, task) = connect_postgres_runtime(&app).await?;
    let rows = client
        .query("SELECT id, storage_path FROM projects", &[])
        .await;
    task.abort();
    let mut selected = None;
    for row in rows.map_err(|e| e.to_string())? {
        let root: String = row.get(1);
        if contained_file(Path::new(&root), &requested).is_ok() {
            selected = Some(row.get::<_, String>(0));
            break;
        }
    }
    let project_id = selected.ok_or("Media is not in registered project storage.")?;
    let project = load_postgres_experiment_project_record(&app, &project_id).await?;
    require_postgres_experiment_project_access(&app, Some(&auth), &project).await?;
    let (client, task) = connect_postgres_database(&app, &project.database_name).await?;
    let source_id = if image {
        let result = registered_image(&client, Path::new(&project.storage_path), &requested).await;
        task.abort();
        if !result? {
            return Err("Image is not a registered project asset.".into());
        }
        String::new()
    } else {
        let rows = client
        .query(
            "SELECT id, storage_path FROM sources WHERE lower(source_kind) IN ('audio', 'video')",
            &[],
        )
        .await;
        task.abort();
        let source_id = rows
            .map_err(|e| e.to_string())?
            .into_iter()
            .find_map(|row| {
                let stored: String = row.get(1);
                let candidate = Path::new(&project.storage_path).join(stored);
                (contained_file(Path::new(&project.storage_path), &candidate)
                    .ok()
                    .as_ref()
                    == Some(&requested))
                .then(|| row.get::<_, String>(0))
            })
            .ok_or("Media is not a registered audio or video source.")?;
        source_id
    };
    let state = app.state::<MediaState>();
    let port = *state
        .port
        .get_or_try_init(|| async {
            let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                // Limit simultaneous connections, including clients that send incomplete headers.
                let slots = Arc::new(tokio::sync::Semaphore::new(16));
                while let Ok((socket, _)) = listener.accept().await {
                    let Ok(slot) = slots.clone().try_acquire_owned() else {
                        continue;
                    };
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _slot = slot;
                        let _ = serve(&app, socket).await;
                    });
                }
            });
            Ok::<u16, String>(port)
        })
        .await?;
    let token = generate_identifier();
    state
        .grants
        .lock()
        .map_err(|_| "Media state unavailable")?
        .insert(
            token.clone(),
            Grant {
                project_id,
                source_id,
                image,
                image_size,
                user_id: session.user.id,
                session_started_at_ms: session.started_at_ms,
                path: requested,
                alive: Arc::new(AtomicBool::new(true)),
            },
        );
    Ok(format!("http://127.0.0.1:{port}/{token}"))
}

#[tauri::command]
pub(super) fn close_media_stream_command(state: tauri::State<'_, MediaState>, url: String) {
    if let Some(token) = url.rsplit('/').next() {
        if let Ok(mut grants) = state.grants.lock() {
            if let Some(grant) = grants.remove(token) {
                grant.alive.store(false, Ordering::Release);
            }
        }
    }
}

pub(super) fn revoke_all(app: &tauri::AppHandle) {
    app.state::<crate::image_previews::ImagePreviewCache>()
        .clear();
    if let Ok(mut grants) = app.state::<MediaState>().grants.lock() {
        for (_, grant) in grants.drain() {
            grant.alive.store(false, Ordering::Release);
        }
    }
}

async fn authorize(app: &tauri::AppHandle, grant: &Grant) -> Result<PathBuf, String> {
    if !grant.alive.load(Ordering::Acquire) {
        return Err("Media closed".into());
    }
    let auth = app.state::<PostgresExperimentAuthState>();
    let project = load_postgres_experiment_project_record(app, &grant.project_id).await?;
    let session = require_postgres_experiment_project_access(app, Some(&auth), &project).await?;
    if session.user.id != grant.user_id || session.started_at_ms != grant.session_started_at_ms {
        return Err("Media session changed".into());
    }
    let (client, task) = connect_postgres_database(app, &project.database_name).await?;
    if grant.image {
        let result = registered_image(&client, Path::new(&project.storage_path), &grant.path).await;
        task.abort();
        if !result? {
            return Err("Image removed or changed".into());
        }
        return contained_file(Path::new(&project.storage_path), &grant.path);
    }
    let row = client.query_opt("SELECT storage_path FROM sources WHERE id = $1 AND lower(source_kind) IN ('audio', 'video')", &[&grant.source_id]).await;
    task.abort();
    let stored: String = row
        .map_err(|e| e.to_string())?
        .ok_or("Source removed")?
        .get(0);
    let path = contained_file(
        Path::new(&project.storage_path),
        &Path::new(&project.storage_path).join(stored),
    )?;
    if path != grant.path {
        return Err("Source changed".into());
    }
    Ok(path)
}

// Only single byte ranges are needed by media players. Reject multipart/invalid ranges.
fn byte_range(header: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    let Some(header) = header else {
        return Ok((0, size, false));
    };
    let range = header.strip_prefix("bytes=").ok_or(())?;
    let (start, end) = range.split_once('-').ok_or(())?;
    if size == 0 {
        return Err(());
    }
    if start.is_empty() {
        let count = end.parse::<u64>().map_err(|_| ())?.min(size);
        if count == 0 {
            return Err(());
        }
        return Ok((size - count, count, true));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if start >= size || start > end {
        return Err(());
    }
    Ok((start, end - start + 1, true))
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        _ => "video/mp4",
    }
}

async fn serve(app: &tauri::AppHandle, mut socket: tokio::net::TcpStream) -> Result<(), String> {
    let mut headers = Vec::with_capacity(1024);
    tokio::time::timeout(Duration::from_secs(5), async {
        while headers.len() < 8192 {
            headers.push(socket.read_u8().await?);
            if headers.ends_with(b"\r\n\r\n") {
                return Ok::<_, std::io::Error>(());
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Headers too large",
        ))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let headers = std::str::from_utf8(&headers).map_err(|e| e.to_string())?;
    let mut lines = headers.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("");
    let token = first.next().unwrap_or("").strip_prefix('/').unwrap_or("");
    let mut range = None;
    let mut origin = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("range") {
                range = Some(value.trim());
            }
            if name.eq_ignore_ascii_case("origin") {
                origin = Some(value.trim());
            }
        }
    }
    let allowed_origin = match origin {
        Some("http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost") => origin,
        Some("http://localhost:1420") if cfg!(debug_assertions) => origin,
        None => None,
        _ => {
            reply_error(&mut socket, "403 Forbidden", None).await;
            return Ok(());
        }
    };
    if method != "GET" && method != "HEAD" {
        reply_error(&mut socket, "405 Method Not Allowed", None).await;
        return Ok(());
    }
    let grant = app
        .state::<MediaState>()
        .grants
        .lock()
        .map_err(|_| "Media state unavailable")?
        .get(token)
        .cloned();
    let Some(grant) = grant else {
        reply_error(&mut socket, "403 Forbidden", None).await;
        return Ok(());
    };
    let path = match authorize(app, &grant).await {
        Ok(path) => path,
        Err(_) => {
            reply_error(&mut socket, "403 Forbidden", None).await;
            return Ok(());
        }
    };
    // Keep the temporary file alive through the response, even if its cache entry is evicted.
    let preview = if let Some(size) = grant.image_size.filter(|_| {
        path.extension()
            .and_then(|v| v.to_str())
            .map(|v| !v.eq_ignore_ascii_case("svg"))
            .unwrap_or(true)
    }) {
        let app = app.clone();
        let original = path.clone();
        let alive = grant.alive.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            app.state::<crate::image_previews::ImagePreviewCache>()
                .thumbnail_with_cancel(&original, size, Some(&alive))
        })
        .await
        {
            Ok(Ok(file)) => Some(file),
            _ => {
                reply_error(&mut socket, "422 Unprocessable Content", None).await;
                return Ok(());
            }
        }
    } else {
        None
    };
    let path = preview.as_ref().map(|file| file.path()).unwrap_or(&path);
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| e.to_string())?;
    send_file(
        &mut socket,
        file,
        method == "HEAD",
        range,
        mime(&path),
        allowed_origin,
        &grant.alive,
    )
    .await
}

async fn reply_error(socket: &mut tokio::net::TcpStream, status: &str, size: Option<u64>) {
    let extra = size
        .map(|size| format!("Content-Range: bytes */{size}\r\n"))
        .unwrap_or_default();
    let _ = socket.write_all(format!("HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n{extra}\r\n").as_bytes()).await;
    let _ = socket.shutdown().await;
}

async fn send_file(
    socket: &mut tokio::net::TcpStream,
    mut file: tokio::fs::File,
    head: bool,
    range: Option<&str>,
    mime: &str,
    origin: Option<&str>,
    alive: &AtomicBool,
) -> Result<(), String> {
    let size = file.metadata().await.map_err(|e| e.to_string())?.len();
    let (start, count, partial) = match byte_range(range, size) {
        Ok(range) => range,
        Err(()) => {
            reply_error(socket, "416 Range Not Satisfiable", Some(size)).await;
            return Ok(());
        }
    };
    let status = if partial {
        "206 Partial Content"
    } else {
        "200 OK"
    };
    let content_range = if partial {
        format!(
            "Content-Range: bytes {start}-{}/{size}\r\n",
            start + count - 1
        )
    } else {
        String::new()
    };
    let cors = origin
        .map(|origin| format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"))
        .unwrap_or_default();
    socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {count}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n{content_range}{cors}\r\n").as_bytes()).await.map_err(|e| e.to_string())?;
    if head {
        return socket.shutdown().await.map_err(|e| e.to_string());
    }
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| e.to_string())?;
    let mut remaining = count;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 && alive.load(Ordering::Acquire) {
        let limit = remaining.min(buffer.len() as u64) as usize;
        let read = file
            .read(&mut buffer[..limit])
            .await
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("Media file truncated".into());
        }
        tokio::time::timeout(Duration::from_secs(15), socket.write_all(&buffer[..read]))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        remaining -= read as u64;
    }
    socket.shutdown().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_include_seek_suffix_open_end_and_invalid_requests() {
        assert_eq!(byte_range(None, 100), Ok((0, 100, false)));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Ok((10, 10, true)));
        assert_eq!(byte_range(Some("bytes=90-"), 100), Ok((90, 10, true)));
        assert_eq!(byte_range(Some("bytes=-20"), 100), Ok((80, 20, true)));
        assert_eq!(byte_range(Some("bytes=90-999"), 100), Ok((90, 10, true)));
        for range in [
            "bytes=100-",
            "bytes=9-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "bytes=x-y",
            "items=0-1",
        ] {
            assert!(byte_range(Some(range), 100).is_err(), "{range}");
        }
        assert!(byte_range(Some("bytes=0-"), 0).is_err());
        assert_eq!(byte_range(None, 0), Ok((0, 0, false)));
    }

    #[test]
    fn files_must_remain_inside_project_storage() {
        let root = tempfile::tempdir().unwrap();
        let inside = root.path().join("project");
        fs::create_dir(&inside).unwrap();
        fs::write(inside.join("clip.mp4"), b"clip").unwrap();
        fs::write(root.path().join("private.mp4"), b"private").unwrap();
        assert!(contained_file(&inside, &inside.join("clip.mp4")).is_ok());
        assert!(contained_file(&inside, &inside.join("../private.mp4")).is_err());
        assert!(contained_file(&inside, &inside).is_err());
    }

    #[test]
    fn http_range_head_and_revocation() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::NamedTempFile::new().unwrap();
            fs::write(temp.path(), b"0123456789").unwrap();
            for (range, head, alive, expected_status, body) in [
                (None, false, true, "200 OK", "0123456789"),
                (Some("bytes=3-5"), false, true, "206 Partial Content", "345"),
                (Some("bytes=-2"), false, true, "206 Partial Content", "89"),
                (Some("bytes=8-"), false, true, "206 Partial Content", "89"),
                (Some("bytes=3-5"), true, true, "206 Partial Content", ""),
                (
                    Some("bytes=99-"),
                    false,
                    true,
                    "416 Range Not Satisfiable",
                    "",
                ),
                (None, false, false, "200 OK", ""),
            ] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let mut client = tokio::net::TcpStream::connect(listener.local_addr().unwrap())
                    .await
                    .unwrap();
                let (mut server, _) = listener.accept().await.unwrap();
                let file = tokio::fs::File::open(temp.path()).await.unwrap();
                let task = tauri::async_runtime::spawn(async move {
                    send_file(
                        &mut server,
                        file,
                        head,
                        range,
                        "video/mp4",
                        Some("http://tauri.localhost"),
                        &AtomicBool::new(alive),
                    )
                    .await
                    .unwrap();
                });
                let mut response = String::new();
                client.read_to_string(&mut response).await.unwrap();
                task.await.unwrap();
                assert!(
                    response.starts_with(&format!("HTTP/1.1 {expected_status}")),
                    "{response}"
                );
                assert_eq!(response.split_once("\r\n\r\n").unwrap().1, body);
                if expected_status.starts_with("206") {
                    assert!(response.contains("Content-Range: bytes "));
                    assert!(response.contains("Accept-Ranges: bytes"));
                }
            }
        });
    }

    /// Browser harness uses the real body-serving implementation with synthetic media,
    /// without accessing the user's projects or opening their application database.
    #[test]
    #[ignore = "Run scripts/test-media-stream.mjs"]
    fn browser_fixture_server() {
        let root = PathBuf::from(std::env::var("KANQUAL_MEDIA_TEST_ROOT").unwrap());
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            fs::write(
                root.join("port"),
                listener.local_addr().unwrap().port().to_string(),
            )
            .unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(240);
            while !root.join("stop").exists() && std::time::Instant::now() < deadline {
                let Ok(Ok((mut socket, _))) =
                    tokio::time::timeout(Duration::from_millis(250), listener.accept()).await
                else {
                    continue;
                };
                let root = root.clone();
                tauri::async_runtime::spawn(async move {
                    let mut data = Vec::new();
                    while data.len() < 8192 {
                        let Ok(byte) = socket.read_u8().await else {
                            return;
                        };
                        data.push(byte);
                        if data.ends_with(b"\r\n\r\n") {
                            break;
                        }
                    }
                    let text = String::from_utf8_lossy(&data);
                    let request = text.lines().next().unwrap_or("");
                    if request.contains(" /test ") || request.contains(" /wave.js ") {
                        let javascript = request.contains(" /wave.js ");
                        let html =
                            fs::read(root.join(if javascript { "wave.js" } else { "test.html" }))
                                .unwrap();
                        let mime = if javascript {
                            "text/javascript"
                        } else {
                            "text/html"
                        };
                        let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", html.len()).as_bytes()).await;
                        let _ = socket.write_all(&html).await;
                        let _ = socket.shutdown().await;
                        return;
                    }
                    if !request.contains(" /audio ") && !request.contains(" /video ") {
                        reply_error(&mut socket, "404 Not Found", None).await;
                        return;
                    }
                    let origin = text.lines().find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("origin"))
                            .map(|(_, value)| value.trim())
                    });
                    let name = if request.contains(" /audio ") {
                        "large.wav"
                    } else {
                        "large.mp4"
                    };
                    let range = text.lines().find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("range"))
                            .map(|(_, value)| value.trim())
                    });
                    let path = root.join(name);
                    let file = tokio::fs::File::open(&path).await.unwrap();
                    let _ = send_file(
                        &mut socket,
                        file,
                        request.starts_with("HEAD "),
                        range,
                        mime(&path),
                        origin,
                        &AtomicBool::new(true),
                    )
                    .await;
                });
            }
        });
    }
}
