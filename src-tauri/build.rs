fn main() {
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    let is_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    // MSVC embeds the manifest below for both the application and unit tests.
    // Let Tauri supply the icon/version resources exactly once, without a second
    // manifest in resource.lib. Other Windows toolchains retain Tauri's path.
    let windows = if is_msvc {
        tauri_build::WindowsAttributes::new_without_app_manifest()
    } else {
        tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app-manifest.xml"))
    };
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attributes).expect("failed to run tauri build script");

    // Tests also need Common Controls v6 for TaskDialogIndirect. Linking Tauri's
    // entire resource.lib here would duplicate VERSION/ICON resources in the app.
    if is_msvc {
        let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
