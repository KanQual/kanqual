use std::env;
use std::path::PathBuf;

fn expected_sidecar_names(target: &str) -> Vec<String> {
    let mut names = vec![format!("pocketbase-{target}")];
    if target.contains("windows") {
        names.push(format!("pocketbase-{target}.exe"));
    }
    names
}

fn main() {
    println!("cargo:rerun-if-changed=binaries/local");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    let target = env::var("TARGET").unwrap_or_default();
    let sidecar_dir = PathBuf::from("binaries").join("local");
    let found = expected_sidecar_names(&target)
        .into_iter()
        .map(|name| sidecar_dir.join(name))
        .any(|path| path.exists());

    if !found && !target.is_empty() {
        println!(
            "cargo:warning=No PocketBase sidecar found for target {target}. Add the matching binary under src-tauri/binaries/local before packaging."
        );
    }

    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
