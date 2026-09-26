export const labels = Object.freeze({queued:"Queued",running:"Downloading",done:"Done",error:"Error",cancelling:"Cancelling…",pausing:"Pausing…",paused:"Paused",cancelled:"Cancelled",interrupted:"Interrupted"});
export function actions(status) {
  if (["queued","running"].includes(status)) return ["pause","cancel"];
  if (status === "paused") return ["resume","cancel"];
  if (["error","cancelled","interrupted"].includes(status)) return ["retry"];
  return [];
}
export function counts(jobs) {
  const queue = jobs.filter(j=>!j.hiddenInQueue);
  return {total:queue.length,active:queue.filter(j=>["running","cancelling","pausing"].includes(j.status)).length,done:queue.filter(j=>j.status==="done").length};
}

// Finished files the library still shows; the queue may have dropped them.
export function inLibrary(job) {
  return job.status === "done" && Boolean(job.file) && !job.hiddenInLibrary;
}

export function orbState(jobs) {
  if (jobs.some(j=>j.status==="running")) return "running";
  if (jobs.some(j=>j.status==="cancelling")) return "cancelling";
  if (jobs.some(j=>j.status==="pausing")) return "pausing";
  if (jobs.some(j=>j.status==="queued")) return "queued";
  if (jobs.some(j=>j.status==="paused")) return "paused";
  if (jobs.some(j=>j.status==="error")) return "error";
  if (jobs.some(j=>j.status==="interrupted")) return "interrupted";
  if (jobs.some(j=>j.status==="done")) return "done";
  return "idle";
}

export function mediaPreview(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      const parts = url.pathname.split("/");
      id = parts[1] === "watch" ? url.searchParams.get("v") || "" :
        ["shorts", "live", "embed"].includes(parts[1]) ? parts[2] || "" : "";
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "";
  } catch { return ""; }
}

export function visibleJobs(jobs, filter = "all", query = "") {
  const term = query.trim().toLocaleLowerCase();
  return jobs.filter(job => {
    if (job.hiddenInQueue) return false;
    const status = job.status;
    const scheduled = status === "queued" && job.scheduledAt != null;
    const matchesFilter = filter === "all" ||
      (filter === "active" && !scheduled && ["queued", "running", "cancelling", "pausing", "paused"].includes(status)) ||
      (filter === "scheduled" && scheduled) ||
      (filter === "done" && status === "done") ||
      (filter === "issues" && ["error", "interrupted"].includes(status));
    return matchesFilter && (!term || (job.file + " " + job.url).toLocaleLowerCase().includes(term));
  });
}

export function playlistSelection(indices) {
  const sorted = [...new Set(indices.filter(n => Number.isInteger(n) && n > 0))].sort((a,b) => a-b);
  const groups = [];
  for (const value of sorted) {
    const last = groups.at(-1);
    if (last && value === last[1] + 1) last[1] = value;
    else groups.push([value,value]);
  }
  // A singleton uses N-N because a plain N is the legacy "first N items" setting.
  return groups.map(([first,last]) => first + "-" + last).join(",");
}

// Titles and messages are English source strings; the UI translates them.
// `action` names the fix the task card offers: "login" or "update".
const ISSUES = [
  [/no space left|disk full|errno 28|winerror 112/, "Disk is full", "Not enough space in the destination folder. Free some space and retry.", ""],
  [/js runtimes?: none|n challenge solving failed|signature solving failed|nsig extraction failed|signature extraction failed/, "YouTube changed its protection", "yt-dlp could not solve YouTube's check. Update yt-dlp; Deno must stay in the bin folder.", "update"],
  [/sign in to confirm you.re not a bot/, "YouTube asks to sign in", "YouTube wants a signed-in session for this network. Sign in to YouTube and retry.", "login"],
  [/age-restricted|sign in to confirm your age|age.verification|inappropriate for some users/, "Age check", "This video needs an age-verified Google account. Sign in; if it still fails, confirm your age on youtube.com once.", "login"],
  [/private video/, "Private video", "Only accounts the owner shared the video with can download it. Sign in with such an account.", "login"],
  [/members-only|join this channel|members only/, "Members only", "This video is for channel members. Sign in with an account that has the membership.", "login"],
  [/unable to connect to proxy|proxyerror|proxy connection|sockshttps?connection|socks\d?[a-z]? (?:proxy )?(?:error|server)|tunnel connection failed/, "Proxy not responding", "Deviload could not reach the proxy. Check its address in the settings or clear it to connect directly.", "proxy"],
  [/available in your country|geo.?restrict|geo.?block|from your location/, "Not available in your region", "The owner blocked this video in your country. Set a proxy in another country in the settings.", "proxy"],
  [/video (is )?unavailable|has been removed|been terminated|no longer available|does not exist/, "Video unavailable", "The video was removed or hidden. Check the link in a browser.", ""],
  [/http error 429|too many requests/, "Too many requests", "YouTube slowed down this network. Wait a few minutes or sign in and retry.", "login"],
  [/(?:ffmpeg|ffprobe)\S* not found|ffmpeg is not installed/, "FFmpeg is missing", "FFmpeg or FFprobe is missing. Put them into the bin folder next to Deviload.", ""],
  [/requested format is not available|format is not available/, "Format not available", "This video has no such format. Pick a lower quality and add the link again.", ""],
  [/unsupported url|no suitable extractor/, "Unsupported link", "yt-dlp does not support this site or address. Check the link.", ""],
  [/http error 403|forbidden/, "Download refused", "The site refused the download. Update yt-dlp; if it keeps failing, sign in.", "update"],
  [/timed out|timeout|connection reset|connection aborted|temporary failure|network is unreachable|getaddrinfo failed|winerror 10054/, "Network error", "The connection dropped. Retry the task when the network is back.", ""],
  [/login required|cookies|authentication/, "Sign-in needed", "Access needs a signed-in YouTube account.", "login"],
];

function isYouTube(url) {
  try { const host = new URL(url).hostname.toLowerCase(); return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"); }
  catch { return true; }
}

export function diagnoseError(log = [], signedIn = false, url = "") {
  const detail = log.slice(-30).join("\n").toLowerCase();
  // Other sites that want an account need cookies from where you are signed in; the Deviload sign-in is YouTube's.
  if (url && !isYouTube(url) && /--cookies-from-browser or --cookies|use --cookies|empty media response|login required|log in to|authentication/.test(detail)) {
    return {title:"Sign-in needed", message:"This site shows it only to signed-in users. In the download options, pick cookies from a browser where you are signed in, or a cookies.txt file, and retry.", action:"cookies"};
  }
  for (const [pattern, title, message, action] of ISSUES) {
    if (!pattern.test(detail)) continue;
    if (action === "login" && signedIn && title === "YouTube asks to sign in") {
      return {title, message:"Your saved sign-in may be stale. Sign in again and retry.", action};
    }
    return {title, message, action};
  }
  return {title:"Download failed", message:"Open the task log to see the cause of the error.", action:""};
}

export function isVideoJob(job) {
  return job.status === "done" && Boolean(job.file) && /\.(mkv|mp4|mov|webm|m4v)$/i.test(job.file);
}

export function isLibraryAudio(job) {
  return job.status === "done" && /\.(mp3|flac|wav|m4a|ogg|opus|aac)$/i.test(job.file || "");
}
