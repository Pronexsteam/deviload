import { Innertube, UniversalCache, Constants } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils';
import { safe } from './runtime.ts';
import { restricted, playbackError } from './errors.ts';
import { fileURLToPath } from 'node:url';
import { AudioCache, TRACK_LIMIT, byteRange, readBytes, writeBytes, same, validId } from './storage.ts';
import { pendingOpening } from './opening.ts';
import { idleRelease } from './idle.ts';
import { stallClock } from './stall.ts';
import { Ranges } from './ranges.ts';
import { segmentIndex, segmentAt, type SegmentIndex } from './segments.ts';
import { clipFormat, clipHeights } from './clip.ts';
import { onSegment, snapshot, resumeState, type Snapshot } from './resume.ts';

const SEEK_AHEAD = 524288, SEEK_SPACING = 300, SEEK_LIMIT = 24;
// A music video is fetched about a minute ahead of what is watched, not to the end; the last two stay for a reopen.
const CLIP_AHEAD_S = 75, CLIP_RESUME_S = 40, CLIPS_KEPT = 2;
const emit = (message: unknown) => console.log(JSON.stringify(message));
const cache = new AudioCache('./audio');
await cache.open();
let stopped = false, serial = 0, selection = 0, selected = '', limitedUntil = 0;
let prepared = '', readerSerial = 0;
let foregroundGeneration = 0;
const sessions = new Map<string, Track>();
// A song's music video plays muted beside the audio; only one is kept at a time.
let clip: Track | undefined;
const keptClips: Track[] = [];
const pending = new Map<number,{resolve:(data:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const inflight = new Map<string,Promise<Track>>();
const resolving = new Map<string,AbortController>();
const openingDeadlines = new Map<string,AbortSignal>();
const tokens = new Map<number,{resolve:(token:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const aborted = (error: unknown) => /abort|cancel/i.test(safe(error));
async function network(input: RequestInfo | URL, init?: RequestInit) {
  if (Date.now() < limitedUntil) throw Error('429 Playback temporarily limited');
  const url = new URL(input instanceof Request ? input.url : String(input));
  let selectionSignal: AbortSignal | undefined;
  if(url.pathname.endsWith('/player')){
    try{const payload=JSON.parse(typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'{}');selectionSignal=openingDeadlines.get(payload.videoId)||sessions.get(payload.videoId)?.control.signal||(clip?.id===payload.videoId?clip?.control.signal:undefined);}catch{}
  }
  const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal?[init.signal]:[]),...(selectionSignal?[selectionSignal]:[]),AbortSignal.timeout(url.hostname.endsWith('.googlevideo.com')?60000:12000)]) });
  if (response.status === 429) { limitedUntil=Date.now()+Math.max(60,Math.min(86400,Number(response.headers.get('retry-after'))||60))*1000; await response.body?.cancel(); throw Error('429 Playback temporarily limited'); }
  return response;
}
// The initial direct fragment needs no remote player or session bootstrap.
// Prepare the richer SABR session concurrently, never on the first-audio path.
const client = await Innertube.create({fetch:network,lang:'en',location:'US',generate_session_locally:true,retrieve_player:false,retrieve_innertube_config:false});
let fullClient:Promise<Innertube>|undefined;
function fullSession(){
  if(!fullClient){const attempt=Innertube.create({cache:new UniversalCache(true,'./session'),fetch:network,lang:'en',location:'US',enable_session_cache:true});fullClient=attempt;attempt.catch(()=>{if(fullClient===attempt)fullClient=undefined;});}
  return fullClient;
}
let po: Worker | undefined, poAt = 0, poPromise: Promise<void> | undefined;
const guestIdle=idleRelease(()=>{if(tokens.size){guestIdle.arm();return;}po?.terminate();po=undefined;poPromise=undefined;poAt=0;});
function guest() {
  guestIdle.hold();
  if (poPromise && Date.now()-poAt<20*60000) {guestIdle.arm();return poPromise;}
  po?.terminate(); for(const p of tokens.values()){clearTimeout(p.timer);p.reject(Error('Guest session refreshed'));}tokens.clear();
  poAt=Date.now();
  po = new Worker(new URL('./po-worker.ts',import.meta.url),{type:'module',deno:{permissions:{read:[fileURLToPath(new URL('.',import.meta.url))],write:false,env:true,net:['www.youtube.com','www.google.com','jnn-pa.googleapis.com'],run:false,ffi:false}}} as any);
  poPromise=new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Guest session timeout')),15000);
    po!.onmessage=e=>{if(e.data.ready){clearTimeout(timer);resolve();return;}const p=tokens.get(e.data.key);if(p){tokens.delete(e.data.key);clearTimeout(p.timer);e.data.error?p.reject(Error('Guest token unavailable')):p.resolve(e.data.token);}};
    po!.onerror=e=>{e.preventDefault();clearTimeout(timer);reject(Error('Guest session failed'));};
  });const attempt=poPromise;attempt.then(()=>guestIdle.arm(),()=>{if(poPromise===attempt){po?.terminate();po=undefined;poPromise=undefined;}});return attempt;
}
async function mint(id:string) {try{await guest();guestIdle.hold();return await new Promise<string>((resolve,reject)=>{const key=++serial,timer=setTimeout(()=>{tokens.delete(key);reject(Error('Guest token timeout'));},5000);tokens.set(key,{resolve,reject,timer});po!.postMessage({key,id});});}finally{guestIdle.arm();}}
function fallback(id:string) {return new Promise<any>((resolve,reject)=>{const key=++serial,timer=setTimeout(()=>{pending.delete(key);reject(Error('Reserve timeout'));},35000);pending.set(key,{resolve,reject,timer});emit({event:'fallback',key,id});});}
function protectedFiles() {return new Set([...sessions.values()].filter(t=>t.id===selected||t.id===prepared||t.readers>0).map(t=>t.file));}
class Track {
  token=crypto.randomUUID();file=crypto.randomUUID()+'.audio';prefix=new Uint8Array();ranges=new Ranges();complete=false;error='';readers=0;
  control=new AbortController();started=false;at=Date.now();epoch=cache.epoch;
  readAt=0;parked=false;choice={height:0,wanted:0,heights:[] as number[]};
  index:SegmentIndex|undefined;resume:Snapshot|undefined;want:number|undefined;claim=0;sessionAt=0;starts=0;session:{from:number;control:AbortController}|undefined;
  constructor(readonly id:string,readonly size:number,readonly itag=140,readonly video=false){}
  async read(offset:number,length:number,reader=0,gone=()=>false) {
    if(this.video)this.readAt=offset;
    if(offset<this.prefix.length)return this.prefix.slice(offset,Math.min(this.prefix.length,offset+length));
    const end=Math.min(this.size,offset+length),stalled=stallClock(65000);
    while(!this.ranges.covers(offset,end)){
      if(this.error)throw Error(this.error);if(this.control.signal.aborted||gone())throw Error('Cancelled');
      this.request(offset,reader);
      if(stalled(this.ranges.total))throw Error('Audio continuation timed out');await new Promise(r=>setTimeout(r,20));
    }
    return readBytes(cache.path(this.file),offset,end-offset);
  }
  request(offset:number,reader:number){
    // Only the newest listener may move the download, and never in a tight loop.
    const session=this.session;if(!session||session.control.signal.aborted||!this.index||!this.resume||reader<this.claim||this.starts>=SEEK_LIMIT)return;
    const head=this.ranges.gap(session.from,this.size)??this.size;
    if(offset>=session.from&&offset<=head+SEEK_AHEAD||Date.now()-this.sessionAt<SEEK_SPACING)return;
    this.claim=reader;this.want=offset;session.control.abort();
  }
  next(){
    if(this.want!==undefined){const at=this.ranges.gap(this.want,this.size);if(at!==undefined)return at;this.want=undefined;}
    return this.ranges.gap(0,this.size);
  }
  cancel(){if(!this.complete){this.control.abort();this.error='Cancelled';if(!this.readers)this.prefix=new Uint8Array();} }
  async place(file:Deno.FsFile,offset:number,bytes:Uint8Array){
    const end=offset+bytes.length;if(end>this.size)throw Error('Audio size mismatch');
    for(const [start,stop]of this.ranges.overlaps(offset,end))
      if(!same(bytes.subarray(start-offset,stop-offset),await readBytes(cache.path(this.file),start,stop-start)))throw Error('Audio streams differ');
    if(this.ranges.covers(offset,end))return false;
    await file.seek(offset,Deno.SeekMode.Start);await writeBytes(file,bytes);this.ranges.add(offset,end);return true;
  }
  async copy(file:Deno.FsFile,stream:ReadableStream<Uint8Array>){
    const reader=stream.getReader();let offset=0;
    try{
      while(true){
        if(this.control.signal.aborted)throw Error('Cancelled');
        const {value,done}=await reader.read();if(done)break;
        await this.place(file,offset,value);offset+=value.length;
      }
    }finally{await reader.cancel().catch(()=>{});}
    if(offset!==this.size)throw Error('Incomplete audio stream');
  }
  start(){
    if(this.started||this.complete)return;this.started=true;
    void this.download().catch(error=>{this.error=restricted(error)?'Playback unavailable or temporarily limited':'Audio continuation failed';emit({event:'diagnostic',stage:'continuation',id:this.id,error:safe(error)});}).finally(()=>{if(!this.complete&&this.control.signal.aborted)void this.remove();});
  }
  async download(){
    const file=await Deno.open(cache.path(this.file),{read:true,write:true,create:true});
    try{
      if(this.prefix.length)await this.place(file,0,this.prefix);
      this.index=segmentIndex(this.prefix);if(this.index?.end!==this.size)this.index=undefined;
      try{await this.stream(file);}catch(error){
        if(this.video||this.control.signal.aborted||aborted(error)||restricted(error)||/streams differ|size mismatch/.test(safe(error)))throw error;
        const source=await fallback(this.id);if(this.control.signal.aborted)throw Error('Cancelled');
        const url=new URL(source.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.username||url.password)throw Error('Invalid reserve source');
        const response=await fetch(url,{signal:AbortSignal.any([this.control.signal,AbortSignal.timeout(40000)])});
        if(!response.ok||Number(response.headers.get('content-length'))!==this.size){await response.body?.cancel();throw Error('Reserve audio differs');}
        await this.copy(file,response.body!);
      }
      if(!this.ranges.covers(0,this.size))throw Error('Incomplete audio stream');await file.sync();
    }finally{file.close();}
    this.complete=true;this.prefix=new Uint8Array();
    if(this.video)return;
    await cache.commit({id:this.id,file:this.file,size:this.size,at:Date.now()},this.epoch);
  }
  async stream(file:Deno.FsFile){
    // Only uncached foreground audio needs the heavier guest session.
    void guest();
    const client=await fullSession();
    const info=await client.getBasicInfo(this.id,{client:'WEB'});
    if(info.playability_status?.status!=='OK')throw Error(info.playability_status?.status||'Unplayable');
    const format=info.streaming_data?.adaptive_formats.find(f=>f.itag===this.itag&&!f.is_drc);
    if(!format||Number(format.content_length)!==this.size)throw Error('Audio streams differ');
    const config=info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;
    const url=await client.session.player!.decipher(info.streaming_data!.server_abr_streaming_url);
    if(this.control.signal.aborted)throw Error('Cancelled');
    const poToken=await mint(this.id),formats=info.streaming_data!.adaptive_formats.map(buildSabrFormat);
    const clientInfo={clientName:Number(Constants.CLIENT_NAME_IDS[client.session.context.client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),clientVersion:client.session.context.client.clientVersion};
    for(let from=this.next();from!==undefined;from=this.next()){
      if(this.control.signal.aborted)throw Error('Cancelled');
      if(this.video){await this.pace(from);from=this.next();if(from===undefined)break;}
      const segment=this.index&&this.resume?segmentAt(this.index,from):-1;
      const state=segment>0?resumeState(this.resume!,this.index!,segment,this.itag):undefined;
      const control=new AbortController(),signal=AbortSignal.any([this.control.signal,control.signal]);
      const sabr=new SabrStream({fetch:(input,init)=>network(input,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}),poToken,formats,serverAbrStreamingUrl:url,videoPlaybackUstreamerConfig:config!,clientInfo});
      const session={from:state?this.index!.starts[segment]:0,control};this.session=session;this.sessionAt=Date.now();this.starts++;
      let fresh=false,added=false,failure:unknown,writing=Promise.resolve();
      onSegment(sabr,(header,bytes)=>{
        const itag=header.itag??header.formatId?.itag;if(itag!==undefined&&itag!==this.itag)return;
        this.resume=snapshot(sabr)??this.resume;
        writing=writing.then(async()=>{
          if(signal.aborted)return;
          const offset=header.startRange!==undefined?Number(header.startRange):header.isInitSeg?0:this.index?.starts[(header.sequenceNumber||0)-1];
          if(offset===undefined||!Number.isSafeInteger(offset))throw Error('Unplaced audio segment');
          if(await this.place(file,offset,bytes)){fresh=added=true;if(this.video&&offset-this.readAt>this.byteRate()*CLIP_AHEAD_S)control.abort();}
          // Stop once this session reaches audio another session already wrote.
          else if(fresh&&this.index)control.abort();
        }).catch(error=>{failure=error;control.abort();});
      });
      const stop=()=>sabr.abort();signal.addEventListener('abort',stop,{once:true});
      try{
        const streams=await sabr.start({...(this.video?{enabledTrackTypes:EnabledTrackTypes.VIDEO_ONLY,videoFormat:this.itag,audioFormat:140}:{enabledTrackTypes:EnabledTrackTypes.AUDIO_ONLY,audioFormat:140}),preferMP4:true,maxRetries:state?2:0,stallDetectionMs:5000,...(state?{state}:{})});
        const reader=(this.video?streams.videoStream:streams.audioStream).getReader();
        try{while(!(await reader.read()).done);}catch(error){if(!signal.aborted)throw error;}
        await writing;
      }finally{signal.removeEventListener('abort',stop);sabr.abort();if(this.session===session)this.session=undefined;}
      if(failure)throw failure;
      if(this.control.signal.aborted)throw Error('Cancelled');
      if(!added&&!control.signal.aborted)throw Error('Incomplete audio stream');
    }
  }
  byteRate(){const seconds=(this.index?.times.at(-1)||0)/1000;return seconds>0?this.size/seconds:Infinity;}
  // A video waits while it is far enough ahead of the viewer, or while it is put aside.
  async pace(from:number){
    while(!this.control.signal.aborted&&(this.parked||from-this.readAt>this.byteRate()*CLIP_RESUME_S)){
      await new Promise(resolve=>setTimeout(resolve,200));from=this.next()??from;
    }
  }
  async remove(){if(this.video||!cache.entries.some(e=>e.file===this.file))await Deno.remove(cache.path(this.file)).catch(()=>{});}
}
// The first megabyte comes from a direct URL, so playback starts before a SABR session exists.
async function openingBytes(url:URL,cpn:string,size:number,signal:AbortSignal){
  url.searchParams.set('cpn',cpn);url.searchParams.set('range',`0-${Math.min(size,1048576)-1}`);
  const response=await network(url,{signal});
  if(!response.ok){await response.body?.cancel();throw Error('Audio HTTP '+response.status);}
  const pieces:Uint8Array[]=[];let received=0;
  const reader=response.body!.getReader();
  try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>Math.min(size,1048576))throw Error('Opening audio too large');pieces.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const prefix=new Uint8Array(received);let position=0;for(const bytes of pieces){prefix.set(bytes,position);position+=bytes.length;}
  if(prefix.length!==Math.min(size,1048576))throw Error('Incomplete opening audio');
  return prefix;
}
function dropClip(track:Track){track.cancel();void track.remove();}
// The current video is put aside rather than thrown away, so going back to it costs nothing.
function stopClip(){
  if(!clip)return;const old=clip;clip=undefined;
  if(old.error||!old.size||old.control.signal.aborted){dropClip(old);return;}
  old.parked=true;old.session?.control.abort();keptClips.unshift(old);
  while(keptClips.length>CLIPS_KEPT)dropClip(keptClips.pop()!);
}
async function openClip(id:string,height:number){
  if(clip?.id===id&&clip.choice.wanted===height&&!clip.error&&!clip.control.signal.aborted)return clip;
  stopClip();
  const kept=keptClips.findIndex(track=>track.id===id&&track.choice.wanted===height&&!track.error);
  if(kept>=0){const track=keptClips.splice(kept,1)[0];track.parked=false;clip=track;return track;}
  // The video continues through a full session; it warms up while the opening fragment loads.
  void guest()?.catch(()=>{});void fullSession().catch(()=>{});
  const control=new AbortController(),signal=AbortSignal.any([control.signal,AbortSignal.timeout(12000)]);
  const holder=new Track(id,0,0,true);holder.control=control;clip=holder;
  const info=await client.getBasicInfo(id,{client:'IOS'});
  if(info.playability_status?.status!=='OK')throw Error(info.playability_status?.status||'Unplayable');
  const formats=info.streaming_data?.adaptive_formats||[],format=clipFormat(formats,height);
  if(!format)throw Error('Unsupported video format');
  const url=new URL(await format.decipher(client.session.player));
  if(url.protocol!=='https:'||!url.hostname.endsWith('.googlevideo.com'))throw Error('Invalid video source');
  const prefix=await openingBytes(url,info.cpn,Number(format.content_length),signal);
  if(clip!==holder)throw Error('Cancelled');
  const track=new Track(id,Number(format.content_length),format.itag,true);track.prefix=prefix;
  track.choice={height:Number(format.height),wanted:height,heights:clipHeights(formats)};clip=track;track.start();return track;
}
async function getTrack(id:string,preload:boolean,refresh:boolean,generation:number):Promise<Track>{
  let track=sessions.get(id);
  if(track?.complete&&!await Deno.stat(cache.path(track.file)).then(s=>s.size===track!.size).catch(()=>false)){sessions.delete(id);track=undefined;}
  if(track&&!track.error&&!track.control.signal.aborted&&!refresh){if(!preload)track.start();return track;}
  const pending=await pendingOpening(id,inflight,resolving);if(pending)return pending;
  if(generation!==selection&&selected!==id)throw Error('Cancelled');
  // Another waiter may have started a replacement while cancellation settled.
  if(inflight.has(id))return inflight.get(id)!;
  const control=new AbortController();resolving.set(id,control);
  // A stalled opening must release the foreground to the reserve promptly.
  const openingSignal=AbortSignal.any([control.signal,AbortSignal.timeout(5000)]);openingDeadlines.set(id,openingSignal);
  const job=(async()=>{
    const cached=!refresh?await cache.find(id):undefined;
    if(cached){track=new Track(id,cached.size);track.file=cached.file;track.ranges.add(0,cached.size);track.complete=true;}
    else{
      if(preload&&[...sessions.values()].some(t=>!t.complete&&t.id!==selected&&t.id!==id&&!t.control.signal.aborted))throw Error('Preload busy');
      const info=await client.getBasicInfo(id,{client:'IOS'});
      if(info.playability_status?.status!=='OK')throw Error(info.playability_status?.status||'Unplayable');
      const format=info.streaming_data?.adaptive_formats.find(f=>f.itag===140&&!f.is_drc);
      const size=Number(format?.content_length);if(!format||!Number.isSafeInteger(size)||size<=0||size>TRACK_LIMIT)throw Error('Unsupported audio format');
      if(control.signal.aborted)throw Error('Cancelled');
      const reserved=size+[...sessions.values()].filter(t=>!t.complete&&!t.control.signal.aborted).reduce((n,t)=>n+t.size,0);
      await cache.makeSpace(reserved,protectedFiles());
      const url=new URL(await format.decipher(client.session.player));
      if(url.protocol!=='https:'||!url.hostname.endsWith('.googlevideo.com'))throw Error('Invalid audio source');
      track=new Track(id,size);track.prefix=await openingBytes(url,info.cpn,size,openingSignal);
    }
    if(control.signal.aborted||(generation!==selection&&selected!==id))throw Error('Cancelled');
    sessions.get(id)?.cancel();sessions.set(id,track!);
    for(const [key,old]of sessions)if(sessions.size>12&&key!==selected&&key!==prepared&&old.readers===0){old.cancel();sessions.delete(key);void old.remove();}
    if(!preload||selected===id)track!.start();return track!;
  })();inflight.set(id,job);
  try{return await job;}catch(error){
    if(openingSignal.aborted&&!control.signal.aborted)throw Error('Opening audio timed out');
    throw error;
  }finally{if(inflight.get(id)===job){inflight.delete(id);resolving.delete(id);openingDeadlines.delete(id);}}
}
function select(id:string){
  selected=id;selection++;
  for(const [key,control]of resolving)if(key!==id)control.abort();
  for(const [key,track]of sessions)if(key!==id&&!track.complete){track.cancel();if(!track.started)void track.remove();}
  for(const track of sessions.values())if(track.id!==id&&track.readers===0)void track.remove();
  prepared='';
}
const server=Deno.serve({hostname:'127.0.0.1',port:0,onListen:()=>{}},request=>{
  const url=new URL(request.url);
  if(url.hostname!=='127.0.0.1'||url.port!==String(server.addr.port))return new Response(null,{status:403});
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  const track=[...sessions.values(),...(clip?[clip]:[])].find(t=>'/'+t.token===url.pathname);
  if(!track)return new Response(null,{status:404});
  let start:number,end:number;try{[start,end]=byteRange(request.headers.get('range'),track.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${track.size}`}});}
  const headers:HeadersInit={'Content-Type':track.video?'video/mp4':'audio/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
  if(request.headers.has('range'))headers['Content-Range']=`bytes ${start}-${end}/${track.size}`;
  if(request.method==='HEAD')return new Response(null,{status:request.headers.has('range')?206:200,headers});
  if(track.readers>=(track.video?16:6))return new Response(null,{status:503});track.readers++;let closed=false;const reader=++readerSerial;
  const finish=()=>{if(!closed){closed=true;track.readers--;if(!track.video&&track.id!==selected&&track.readers===0)void track.remove();}};
  const body=new ReadableStream<Uint8Array>({async pull(controller){try{if(closed)return;const bytes=await track.read(start,Math.min(65536,end-start+1),reader,()=>closed);if(closed)return;start+=bytes.length;controller.enqueue(bytes);if(start>end){finish();controller.close();}}catch(e){finish();controller.error(e);}},cancel(){finish();}});
  return new Response(body,{status:request.headers.has('range')?206:200,headers});
});
emit({event:'ready',port:server.addr.port,version:'1.0.0'});
async function command(cmd:any){
  try{
    if(cmd.action==='prepare'){return;}
    if(cmd.action==='reserve'){const p=pending.get(cmd.key);if(p){pending.delete(cmd.key);clearTimeout(p.timer);cmd.error?p.reject(Error(cmd.error)):p.resolve(cmd);}return;}
    if(cmd.action==='cancel'){
      if(Number(cmd.generation)<foregroundGeneration)return;
      foregroundGeneration=Number(cmd.generation)||foregroundGeneration;
      for(const control of resolving.values())control.abort();
      for(const track of sessions.values())if(track.id!==selected&&!track.complete){track.cancel();if(!track.started)void track.remove();}
      prepared='';selection++;emit({key:cmd.key,data:null});return;
    }
    if(cmd.action==='cache'){
      if(cmd.limit!==undefined&&cmd.limit!==null){
        const reserved=[...sessions.values()].filter(t=>!t.complete&&!t.control.signal.aborted).reduce((n,t)=>n+t.size,0);
        await cache.setLimit(cmd.limit,reserved,protectedFiles());
      }
      if(cmd.clear){await cache.clear(protectedFiles());for(const [id,track]of sessions)if(id!==selected&&track.readers===0){track.cancel();sessions.delete(id);void track.remove();}}
      emit({key:cmd.key,data:{bytes:cache.entries.reduce((n,e)=>n+e.size,0),limit:cache.limit}});return;
    }
    if(cmd.action==='clip'){
      // No video: stop the current one, or only warm the session up for a music video soon.
      if(!cmd.id){if(cmd.warm){void guest()?.catch(()=>{});void fullSession().catch(()=>{});}else stopClip();emit({key:cmd.key,data:null});return;}
      if(!validId(cmd.id))throw Error('Invalid music request');
      const track=await openClip(cmd.id,Math.max(144,Math.min(2160,Number(cmd.height)||720)));
      emit({key:cmd.key,data:{url:`http://127.0.0.1:${server.addr.port}/${track.token}`,height:track.choice.height,heights:track.choice.heights}});return;
    }
    if(cmd.action!=='play'||!validId(cmd.id))throw Error('Invalid music request');
    if(Number(cmd.generation)<foregroundGeneration)throw Error('Cancelled');
    if(!cmd.preload)foregroundGeneration=Number(cmd.generation)||foregroundGeneration;
    if(!cmd.preload)select(cmd.id);else{
      // A newer next-track choice replaces the old one, which only holds its opening audio.
      if(prepared&&prepared!==cmd.id){resolving.get(prepared)?.abort();const old=sessions.get(prepared);if(old&&!old.complete&&!old.started&&old.readers===0){old.cancel();sessions.delete(prepared);void old.remove();}}
      prepared=cmd.id;
    }
    const generation=selection,track=await getTrack(cmd.id,!!cmd.preload,!!cmd.refresh,generation);
    if(generation!==selection&&selected!==cmd.id)throw Error('Cancelled');
    if(!cmd.preload)track.start();
    emit({key:cmd.key,data:{url:`http://127.0.0.1:${server.addr.port}/${track.token}`}});
  }catch(error){emit({key:cmd.key,error:playbackError(error),restricted:restricted(error)});}
}
let buffer='';
for await(const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())){
  buffer+=chunk;if(buffer.length>65536)break;
  let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{void command(JSON.parse(line));}catch{}}
}
stopped=true;guestIdle.hold();for(const track of sessions.values())track.cancel();stopClip();for(const track of keptClips)track.cancel();po?.terminate();await server.shutdown();
