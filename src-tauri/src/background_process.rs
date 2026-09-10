use std::ffi::OsStr;
use std::process::Command;

/// Background utilities must not open a console when launched by the Windows GUI build.
pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
    let command = Command::new(program);
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::command;

    #[test]
    fn background_child_has_no_console() {
        let output = command(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "background_process::tests::console_probe",
                "--nocapture",
            ])
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("console probe passed"));
    }

    #[test]
    #[ignore = "run in a child process by background_child_has_no_console"]
    fn console_probe() {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetConsoleWindow() -> *mut std::ffi::c_void;
        }
        assert!(unsafe { GetConsoleWindow() }.is_null());
        println!("console probe passed");
    }
}
