// Local marks for familiar sources, and a domain badge for every other URL.
export const brands = [
  {id:"youtubemusic", name:"YouTube Music", domains:["music.youtube.com"]},
  {id:"youtube", name:"YouTube", domains:["youtube.com","youtu.be"]},
  {id:"twitch", name:"Twitch", domains:["twitch.tv"]},
  {id:"tiktok", name:"TikTok", domains:["tiktok.com"]},
  {id:"instagram", name:"Instagram", domains:["instagram.com","instagr.am"]},
  {id:"soundcloud", name:"SoundCloud", domains:["soundcloud.com"]},
  {id:"vk", name:"VK", domains:["vk.com","vkvideo.ru"]},
  {id:"pinterest", name:"Pinterest", domains:["pinterest.com","pin.it"]},
  {id:"x", name:"X", domains:["x.com","twitter.com"]},
  {id:"facebook", name:"Facebook", domains:["facebook.com","fb.watch","fb.com"]},
  {id:"vimeo", name:"Vimeo", domains:["vimeo.com"]},
  {id:"dailymotion", name:"Dailymotion", domains:["dailymotion.com","dai.ly"]},
  {id:"reddit", name:"Reddit", domains:["reddit.com","redd.it"]},
  {id:"bilibili", name:"Bilibili", domains:["bilibili.com","b23.tv"]},
  {id:"bandcamp", name:"Bandcamp", domains:["bandcamp.com"]},
  {id:"mixcloud", name:"Mixcloud", domains:["mixcloud.com"]},
  {id:"odysee", name:"Odysee", domains:["odysee.com"]},
  {id:"kick", name:"Kick", domains:["kick.com"]},
  {id:"rumble", name:"Rumble", domains:["rumble.com"]},
  {id:"niconico", name:"Niconico", domains:["nicovideo.jp","niconico.jp"]},
  {id:"tumblr", name:"Tumblr", domains:["tumblr.com"]},
];
export function brandForUrl(url) {
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
  const known = brands.find(brand => brand.domains.some(domain => host === domain || host.endsWith("." + domain)));
  return known || {id:"other", name:host, label:host.replace(/^m\./, "").slice(0,24)};
}
