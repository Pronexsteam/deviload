const KEY="deviload-app-release-notes";
const shown=new Set();
export function shouldShowReleaseNotes(storage,version){
  if(typeof version!=="string"||!version.trim()||shown.has(version))return false;
  try{return storage?.getItem(KEY)!==`deviload-${version}`;}catch{return true;}
}
export function markReleaseNotesSeen(storage,version){
  if(typeof version!=="string"||!version.trim())return;
  shown.add(version);try{storage?.setItem(KEY,`deviload-${version}`);}catch{/* Once per session with unavailable storage. */}
}
