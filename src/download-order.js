// Completion is a persisted UTC millisecond timestamp. Legacy records retain
// their deterministic ID order; do not invent a completion time at startup.
const completed = job => Number.isFinite(job.completedAt) && job.completedAt > 0 ? job.completedAt : 0;
export const newestCompleted = (a, b) => completed(b) - completed(a) || b.id - a.id;

export function orderDownloads(jobs) {
  // Keep the manually arranged pending queue intact.
  return [...jobs.filter(job => job.status === "done").sort(newestCompleted),
    ...jobs.filter(job => job.status !== "done")];
}

export function orderLibrary(jobs, allJobs, mode = "new") {
  const parents = new Map(allJobs.map(job => [job.id, job]));
  const groups = new Map();
  for (const job of jobs) {
    const id = job.libraryParent || job.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(job);
  }
  const grouped = [...groups.entries()].sort(([a, aa], [b, bb]) => mode === "playlist"
    ? b - a : newestCompleted(parents.get(a) || aa[0], parents.get(b) || bb[0]));
  return grouped.flatMap(([id, items]) => {
    const positions = new Map();
    for (const [, file] of parents.get(id)?.downloads || []) if (!positions.has(file)) positions.set(file, positions.size);
    return items.sort((a, b) => (positions.get(a.file) ?? Infinity) - (positions.get(b.file) ?? Infinity) || a.id - b.id);
  });
}
