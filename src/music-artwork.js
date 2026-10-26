export function safeArtworkUrl(raw){
 if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return '';
 let url;try{url=new URL(raw);}catch{return '';}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['i.ytimg.com','lh3.googleusercontent.com','yt3.googleusercontent.com'].includes(url.hostname))return '';
 return raw;
}
export function applyBrowseArtwork(item,sections,artwork,id){
 if(!item||item.id!==id||artwork?.id!==id||!safeArtworkUrl(artwork.image))return {item,sections};
 const updated={...item,image:artwork.image};
 // Unlabelled album tracklists may omit per-song artwork. Do not use artist
 // portraits for songs, or an album cover for labelled recommendation shelves.
 const rows=item.kind==='album'?sections.map(section=>!section.title&&section.items.every(row=>row.kind==='song')?
  {...section,items:section.items.map(row=>safeArtworkUrl(row.image)?row:{...row,image:artwork.image})}:section):sections;
 return {item:updated,sections:rows};
}
export function artworkCandidates(raw,size=320){
 if(!safeArtworkUrl(raw))return [];
 const url=new URL(raw);
 const target=Math.max(64,Math.min(1024,Number.isFinite(size)?Math.ceil(size):320));
 let preferred=raw;
 let fallback=raw;
 if(url.hostname==='i.ytimg.com'){
  // default.jpg is only 120×90: a square crop blurs even a 48px row at
  // Windows 150–200% scale. mqdefault keeps those small covers sharp.
  const variant=target<=180?'mqdefault':target<=480?'hqdefault':'maxresdefault';
  preferred=raw.replace(/\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)(?=[?#]|$)/,`/${variant}.$1`);
  if(target>480)fallback=raw.replace(/\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)(?=[?#]|$)/,'/hqdefault.$1');
 }else preferred=raw.replace(/=w\d+-h\d+(?=[-?&#]|$)/,`=w${target}-h${target}`).replace(/=s\d+(?=[-?&#]|$)/,`=s${target}`);
 return [...new Set([preferred,fallback,raw])];
}

// Configure lazy decoding before assigning src, so an offscreen shelf cannot
// start eager requests merely while its image nodes are being constructed.
export function loadArtwork(img,raw,size=320){
 const urls=artworkCandidates(raw,size);if(!urls.length)return false;
 let index=0;
 img.alt='';img.loading='lazy';img.decoding='async';
 const fallback=()=>{if(index+1<urls.length)img.src=urls[++index];else img.remove();};
 img.addEventListener('error',fallback);
 img.addEventListener('load',()=>{if(size>480&&index+1<urls.length&&img.naturalWidth<=120)fallback();});
 img.src=urls[0];return true;
}
