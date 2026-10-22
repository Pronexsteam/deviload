use crate::model::Job;
use std::collections::HashSet;

// Keep indexing in memory: no media probes, disk access or changes to parent
// IDs. Startup and playlist completion both call this same idempotent path.
pub fn index_library(jobs: &mut Vec<Job>, next_id: &mut u64, windows_paths: bool) {
    let mut existing: HashSet<(u64, String)> = jobs.iter()
        .filter_map(|job| job.library_parent.map(|parent| (parent, job.file.clone()))).collect();
    let mut highest_id = jobs.iter().map(|job| job.id).max().unwrap_or(0);
    let parents: Vec<Job> = jobs.iter()
        .filter(|job| job.library_parent.is_none() && !job.downloads.is_empty()).cloned().collect();
    for job in parents {
        let mut seen = HashSet::new();
        let files: Vec<String> = job.downloads.iter().map(|entry| entry[1].clone())
            .filter(|file| !file.is_empty() && seen.insert(file.clone())).collect();
        let original_file = job.file.clone();
        let original_done = job.status == "done";
        let mut template = job;
        template.library_parent = Some(template.id);
        template.status = "done".into();
        template.percent = 100.0;
        template.pid = None;
        template.scheduled_at = None;
        template.repeat_at = 0;
        template.forget_recording();
        template.stage.clear();
        template.archived = 0;
        // Clear large per-playlist collections before cloning each child.
        template.downloads.clear();
        template.log.clear();
        template.hidden_in_queue = true;
        template.bytes = 0;
        template.duration = 0.0;
        for file in files {
            if (original_done && file == original_file) || !existing.insert((template.id, file.clone())) { continue; }
            let mut media = template.clone();
            media.id = (*next_id).max(highest_id + 1);
            highest_id = media.id;
            *next_id = media.id + 1;
            media.file = file;
            jobs.push(media);
        }
    }
    let mut visible = HashSet::new();
    for media in jobs.iter_mut().filter(|job| job.status == "done" && !job.hidden_in_library && !job.file.is_empty()) {
        let key = if windows_paths { media.file.replace('\\', "/").to_lowercase() } else { media.file.clone() };
        if !visible.insert(key) { media.hidden_in_library = true; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_parent_existing_children_hidden_state_and_reserved_ids() {
        let parent = Job { id: 7, status: "done".into(), file: "/last.mp4".into(),
            downloads: vec![["a".into(), "/first.mp4".into()], ["b".into(), "/last.mp4".into()],
                ["c".into(), "/hidden.mp4".into()], ["d".into(), "/first.mp4".into()], ["missing".into(), String::new()]],
            log: vec!["parent log".into()], bytes: 800, duration: 10.0, ..Job::default() };
        let mut jobs = vec![parent.clone(), Job { id: 88, library_parent: Some(7), file: "/hidden.mp4".into(),
            status: "done".into(), hidden_in_library: true, ..Job::default() }];
        let mut next_id = 4096;
        index_library(&mut jobs, &mut next_id, false);
        assert_eq!(serde_json::to_value(&jobs[0]).unwrap(), serde_json::to_value(parent).unwrap());
        assert_eq!(jobs.len(), 3);
        assert_eq!((jobs[1].id, jobs[1].hidden_in_library), (88, true));
        let child = &jobs[2];
        assert_eq!((child.id, child.library_parent, child.file.as_str()), (4096, Some(7), "/first.mp4"));
        assert!(child.downloads.is_empty() && child.log.is_empty() && child.hidden_in_queue);
        assert_eq!((child.bytes, child.duration), (0, 0.0));
        assert_eq!(next_id, 4097);
        let indexed = serde_json::to_value(&jobs).unwrap();
        index_library(&mut jobs, &mut next_id, false);
        assert_eq!(serde_json::to_value(jobs).unwrap(), indexed);
        assert_eq!(next_id, 4097);
    }

    #[test]
    fn partial_playlist_child_is_finished_without_inheriting_active_recording_state() {
        let mut jobs = vec![Job { id: 50, status: "running".into(), file: "/saved.mp4".into(),
            downloads: vec![["a".into(), "/saved.mp4".into()]], pid: Some(42), live: true, live_since: 5,
            recording: "/recording.part".into(), stop_requested: true, repeat_at: 90, scheduled_at: Some(40),
            archived: 2, stage: "merging".into(), ..Job::default() }];
        let mut next_id = 1;
        index_library(&mut jobs, &mut next_id, false);
        assert_eq!((jobs[0].id, jobs[0].status.as_str(), jobs[0].pid), (50, "running", Some(42)));
        let child = &jobs[1];
        assert_eq!((child.id, child.library_parent, child.status.as_str()), (51, Some(50), "done"));
        assert!(child.pid.is_none() && !child.live && child.recording.is_empty() && child.scheduled_at.is_none());
        assert!(!child.stop_requested && child.stage.is_empty());
        assert_eq!((child.repeat_at, child.live_since, child.archived), (0, 0, 0));
    }

    #[test]
    fn separate_parent_records_keep_distinct_ids_but_share_one_visible_file() {
        let mut jobs: Vec<_> = [10, 20].into_iter().map(|id| Job { id, status: "error".into(),
            downloads: vec![["a".into(), "/same.mp4".into()]], ..Job::default() }).collect();
        let mut next_id = 1;
        index_library(&mut jobs, &mut next_id, false);
        assert_eq!(jobs.len(), 4);
        assert_eq!((jobs[2].id, jobs[2].library_parent), (21, Some(10)));
        assert_eq!((jobs[3].id, jobs[3].library_parent), (22, Some(20)));
        assert!(!jobs[2].hidden_in_library && jobs[3].hidden_in_library);
    }

    #[test]
    fn paths_keep_platform_case_rules_and_unchanged_queues_do_not_allocate_ids() {
        let make_jobs = || vec![Job { id: 1, status: "done".into(), file: "C:\\Music\\Song.mp3".into(), ..Job::default() },
            Job { id: 2, status: "done".into(), file: "c:/music/song.mp3".into(), ..Job::default() }];
        let mut next_id = 100;
        let mut windows = make_jobs();
        index_library(&mut windows, &mut next_id, true);
        assert!(!windows[0].hidden_in_library && windows[1].hidden_in_library);
        let mut unix = make_jobs();
        index_library(&mut unix, &mut next_id, false);
        assert!(unix.iter().all(|job| !job.hidden_in_library));
        assert_eq!(next_id, 100);
        let mut empty = vec![];
        index_library(&mut empty, &mut next_id, false);
        assert_eq!(next_id, 100);
    }
}
