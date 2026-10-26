export function roomPosition(packet,elapsed=0){
 const state=packet?.state||{},position=Number.isFinite(state.position)?Math.max(0,state.position):0;
 const extra=state.playing?(Math.min(30000,Math.max(0,packet.age_ms||0))+Math.min(4000,Math.max(0,packet.transport_ms||0))+Math.max(0,elapsed))/1000:0;
 return Math.min(state.duration>0?state.duration:86400,position+extra);
}
export function roomCorrection(actual,expected){
 const drift=expected-actual;
 if(Math.abs(drift)>1.25)return {seek:expected,rate:1};
 return {seek:null,rate:Math.abs(drift)<.12?1:drift>0?1.025:.975};
}
