// A music download must never inherit a video draft's links, clip or schedule.
export async function downloadMusic(invoke,item,settings) {
  if(!invoke)throw new Error("Open the installed Deviload app to download.");
  if(item?.kind!=="song"||!/^[A-Za-z0-9_-]{11}$/.test(item.id))throw new Error("Invalid music request");
  const mode=settings.cookiesMode;
  const request={text:`https://www.youtube.com/watch?v=${item.id}`,options:{
    folder:settings.folder,quality:"mp3",profile:"music",container:"mp4",playlist:false,playlistItems:"",
    splitChapters:false,subtitles:false,sponsorblock:settings.sponsorblock,archive:settings.archive,
    cookies:mode==="file"?settings.cookies:mode==="account"?settings.signedInPath||"":"",cookiesAccount:mode==="account",
    cookiesBrowser:["chrome","edge","firefox","brave","safari"].includes(mode)?mode:"",
    rateMbps:settings.rateMbps,clipStart:null,clipEnd:null,clipFormat:"source",
    folderRule:settings.folderRule,nameRule:settings.nameRule,formatId:"",formatHasAudio:false},
    parallel:settings.parallel,scheduledAt:null,autoRetry:settings.autoRetry,liveLimit:0,repeatDaily:false,preserveOptions:true};
  const report=await invoke("preflight_download",{text:request.text,options:request.options,estimatedBytes:null});
  if(!report.ready)throw new Error(report.blockers.join("\n"));
  return invoke("enqueue",request);
}
