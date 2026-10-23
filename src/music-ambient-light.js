// The main window and mini-player render the same bounded audio envelope.
export function paintAmbient(lights,levels){
  lights.forEach((light,i)=>{
    const value=Number(levels?.[i]),level=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
    light.style.opacity=String(.17+level*.66);
    light.style.transform=`translateY(${-level*5}%) scale(${1+level*.24})`;
  });
}
export function ambientArtwork(source){
  try{const url=new URL(source);if(url.protocol==='https:'&&!url.username&&!url.password&&['i.ytimg.com','lh3.googleusercontent.com','yt3.googleusercontent.com'].includes(url.hostname))return `url(${JSON.stringify(url.href)})`;}catch{}
  return 'none';
}
