use std::env;
use std::fs;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn expected_sidecar_names(target: &str) -> Vec<String> {
    let mut names = vec![format!("pocketbase-{target}")];
    if target.contains("windows") {
        names.push(format!("pocketbase-{target}.exe"));
    }
    names
}

fn target_sidecar_alias(target: &str) -> &'static str {
    if target.contains("windows") {
        "pocketbase.exe"
    } else {
        "pocketbase"
    }
}

fn create_platform_sidecar_alias(target: &str) -> Result<(), String> {
    let sidecar_dir = PathBuf::from("binaries").join("local");
    let source = expected_sidecar_names(target)
        .into_iter()
        .map(|name| sidecar_dir.join(name))
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "No PocketBase sidecar found for target {target}. Add the matching binary under src-tauri/binaries/local before packaging."
            )
        })?;

    let destination = sidecar_dir.join(target_sidecar_alias(target));
    if source != destination {
        fs::copy(&source, &destination).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&destination).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&destination, perms).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn main() {
    println!("cargo:rerun-if-changed=binaries/local");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    let target = env::var("TARGET").unwrap_or_default();
    if !target.is_empty() {
        if let Err(err) = create_platform_sidecar_alias(&target) {
            println!("cargo:warning={err}");
        }
    }

    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
