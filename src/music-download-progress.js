// A song downloaded from Devil Music becomes a task in the downloader's queue. This follows those tasks so the
// player can show how far each one got and, once it is saved, where the file is.
const ACTIVE = ["queued", "running", "pausing", "cancelling", "paused"];

// The task for a song: one added after the request (a higher id than any task seen then) whose link names the
// song's YouTube id.
export function songTask(song, jobs) {
  const pattern = new RegExp(`[?&]v=${song.id}(?:[&#]|$)`);
  let found = null;
  for (const job of jobs || [])
    if (job?.id > song.after && pattern.test(String(job.url || "")) && (!found || job.id > found.id))
      found = job;
  return found;
}

// What the player shows for the songs it follows: the ones still going with their average progress, and the last
// one that finished or failed since the previous look.
export function downloadProgress(songs, jobs, now = Date.now()) {
  const active = [],
    finished = [];
  for (const song of songs) {
    const job = songTask(song, jobs);
    if (!job) {
      // Not in the queue yet: the request is still being added. One that never shows up is dropped after a minute.
      if (now - song.added < 60000) active.push({ ...song, percent: 0 });
      continue;
    }
    if (ACTIVE.includes(job.status)) active.push({ ...song, jobId: job.id, percent: clamp(job.percent) });
    else
      finished.push({
        ...song,
        jobId: job.id,
        status: job.status === "done" ? "done" : "error",
        file: job.file || "",
      });
  }
  const percent = active.length
    ? Math.round(active.reduce((sum, song) => sum + song.percent, 0) / active.length)
    : 0;
  return { active, finished, percent };
}

const clamp = value => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
