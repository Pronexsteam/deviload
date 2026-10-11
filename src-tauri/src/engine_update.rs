use std::{
    io::{Read, Seek, SeekFrom},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

// Files avoid pipe deadlocks and inherited handles held by updater children.
// The deadline covers the whole process, including executable replacement.
pub fn output(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    let mut stdout = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    command.stdin(Stdio::null())
        .stdout(stdout.try_clone().map_err(|e| e.to_string())?)
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?);
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            result => {
                crate::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                if let Err(error) = result { return Err(error.to_string()); }
                return Err("yt-dlp did not respond in time. Check your connection or proxy and try again.".into());
            }
        }
    };
    let read = |file: &mut std::fs::File| -> Result<Vec<u8>, String> {
        // Keep the final diagnostic without allocating for unbounded output.
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        file.seek(SeekFrom::Start(length.saturating_sub(65536))).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(65536).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        Ok(bytes)
    };
    Ok(Output { status, stdout: read(&mut stdout)?, stderr: read(&mut stderr)? })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(mode: &str) -> Command {
        let mut command = crate::command(&std::env::current_exe().unwrap());
        command.args(["--exact", "engine_update::tests::child_fixture", "--ignored", "--nocapture"])
            .env("DEVILOAD_UPDATE_TEST", mode);
        command
    }

    #[test]
    #[ignore = "subprocess fixture"]
    fn child_fixture() {
        match std::env::var("DEVILOAD_UPDATE_TEST").as_deref() {
            Ok("hang") => thread::sleep(Duration::from_secs(60)),
            Ok("failure") => { eprintln!("update failed"); std::process::exit(7); }
            Ok("noisy") => { println!("{}", "x".repeat(200000)); eprintln!("{}", "y".repeat(200000)); }
            Err(std::env::VarError::NotPresent) => {},
            _ => panic!("missing fixture mode"),
        }
    }

    #[test]
    fn stalled_process_is_stopped_and_another_attempt_can_finish() {
        let started = Instant::now();
        assert!(output(&mut fixture("hang"), Duration::from_millis(500)).unwrap_err().contains("did not respond in time"));
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(output(&mut fixture("noisy"), Duration::from_secs(10)).unwrap().status.success());
    }

    #[test]
    fn captures_failure_and_drains_output_larger_than_pipe_buffers() {
        let result = output(&mut fixture("failure"), Duration::from_secs(10)).unwrap();
        assert_eq!(result.status.code(), Some(7));
        assert!(String::from_utf8_lossy(&result.stderr).contains("update failed"));
        let noisy = output(&mut fixture("noisy"), Duration::from_secs(10)).unwrap();
        assert!(noisy.status.success());
        assert_eq!(noisy.stdout.len(), 65536);
        assert_eq!(noisy.stderr.len(), 65536);
    }
}
