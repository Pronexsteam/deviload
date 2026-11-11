// Releasing a guest worker never stops the decoder or the audio cache. Every song needs a token, so the worker stays
// for eight idle minutes: a quick next song no longer waits for BotGuard to start again.
export function idleRelease(release:()=>void,delay=8*60_000,schedule=setTimeout,cancel=clearTimeout){
 let timer:ReturnType<typeof setTimeout>|undefined;
 return {
  hold(){if(timer!==undefined)cancel(timer);timer=undefined;},
  arm(){this.hold();timer=schedule(()=>{timer=undefined;release();},delay);},
 };
}
