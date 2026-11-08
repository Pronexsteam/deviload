// Helper processes (music engine, downloaders, encoders) belong to the app:
// a kill-on-close job ends them with Deviload, even after a crash.
#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};

    struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}
    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        JOB.get_or_init(|| unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32).ok()?;
            // The handle stays open for the life of the app; Windows closes it on exit.
            Some(Job(handle))
        }).as_ref().map(|job| job.0)
    }

    pub fn bind(child: &std::process::Child) {
        if let Some(job) = job() {
            unsafe { let _ = AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())); }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn bind(_child: &std::process::Child) {}
}

pub use imp::bind;
