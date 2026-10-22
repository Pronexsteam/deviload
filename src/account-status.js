// A saved download source and a saved embedded YouTube session are independent.
// This view deliberately makes no claim about server-side authentication: file
// validation only checks the cookie format and expiry, and browsers are read by
// yt-dlp when the user starts a download.
const browsers = Object.freeze({firefox:"Firefox", chrome:"Chrome", edge:"Edge", brave:"Brave", safari:"Safari"});

export function downloadAuthView({mode = "account", cookiePath = "", savedMode = "account", savedPath = "", hasEmbeddedSession = false} = {}) {
  const path = typeof cookiePath === "string" ? cookiePath.trim() : "";
  const previousPath = typeof savedPath === "string" ? savedPath.trim() : "";
  const sourceSaved = mode === savedMode && (mode !== "file" || Boolean(path) && path === previousPath);
  const base = {embeddedSession:Boolean(hasEmbeddedSession), sourceSaved, sourcePending:!sourceSaved, params:{}};
  if (mode === "file") return {...base, kind:"file", action:"accounts", label:"Cookies file",
    title:sourceSaved ? "Saved cookies file. Site access is checked when downloading." : "Cookies file not applied. Open account settings to save this source."};
  if (Object.hasOwn(browsers, mode)) return {...base, kind:"browser", action:"accounts", label:browsers[mode], params:{browser:browsers[mode]},
    title:sourceSaved ? "Cookies from {browser} selected. Site access is checked when downloading." : "Cookies from {browser} not applied. Open account settings to save this source."};
  if (mode === "none") return {...base, kind:"none", action:"accounts", label:"No cookies",
    title:sourceSaved ? "Downloads run without cookies. Open account settings to change the source." : "Cookies source not applied. Open account settings to save this choice."};
  return {...base, kind:"account", action:hasEmbeddedSession ? "youtube" : "signin", label:hasEmbeddedSession ? "YouTube" : "Sign in",
    title:hasEmbeddedSession ? "Saved YouTube session · open YouTube" : "Sign in to YouTube"};
}
