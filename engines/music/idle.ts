// Releasing a guest worker never stops the decoder or the audio cache.
export function idleRelease(release:()=>void,delay=45000,schedule=setTimeout,cancel=clearTimeout){
 let timer:ReturnType<typeof setTimeout>|undefined;
 return {
  hold(){if(timer!==undefined)cancel(timer);timer=undefined;},
  arm(){this.hold();timer=schedule(()=>{timer=undefined;release();},delay);},
 };
}
