import { Innertube, UniversalCache, Constants } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils';
import { safe } from './runtime.ts';
import { fileURLToPath } from 'node:url';
import { AudioCache, TRACK_LIMIT, byteRange, readBytes, writeBytes, same, validId } from './storage.ts';

const emit = (message: unknown) => console.log(JSON.stringify(message));
const cache = new AudioCache('./audio');
await cache.open();
let stopped = false, serial = 0, selection = 0, selected = '', limitedUntil = 0;
let prepared = '';
let foregroundGeneration = 0;
const sessions = new Map<string, Track>();
const pending = new Map<number,{resolve:(data:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const inflight = new Map<string,Promise<Track>>();
const resolving = new Map<string,AbortController>();
const openingDeadlines = new Map<string,AbortSignal>();
const tokens = new Map<number,{resolve:(token:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const restricted = (error: unknown) => /403|429|LOGIN_REQUIRED|UNPLAYABLE|AGE_CHECK_REQUIRED|not a bot|sign in|rate limit/i.test(safe(error));
const aborted = (error: unknown) => /abort|cancel/i.test(safe(error));
async function network(input: RequestInfo | URL, init?: RequestInit) {
  if (Date.now() < limitedUntil) throw Error('429 Playback temporarily limited');
  const url = new URL(input instanceof Request ? input.url : String(input));
  let selectionSignal: AbortSignal | undefined;
  if(url.pathname.endsWith('/player')){
    try{const payload=JSON.parse(typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'{}');selectionSignal=openingDeadlines.get(payload.videoId)||sessions.get(payload.videoId)?.control.signal;}catch{}
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
function guest() {
  if (poPromise && Date.now()-poAt<20*60000) return poPromise;
  po?.terminate(); for(const p of tokens.values()){clearTimeout(p.timer);p.reject(Error('Guest session refreshed'));}tokens.clear();
  poAt=Date.now();
  po = new Worker(new URL('./po-worker.ts',import.meta.url),{type:'module',deno:{permissions:{read:[fileURLToPath(new URL('.',import.meta.url))],write:false,env:true,net:['www.youtube.com','www.google.com','jnn-pa.googleapis.com'],run:false,ffi:false}}} as any);
  poPromise=new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Guest session timeout')),15000);
    po!.onmessage=e=>{if(e.data.ready){clearTimeout(timer);resolve();return;}const p=tokens.get(e.data.key);if(p){tokens.delete(e.data.key);clearTimeout(p.timer);e.data.error?p.reject(Error('Guest token unavailable')):p.resolve(e.data.token);}};
    po!.onerror=e=>{e.preventDefault();clearTimeout(timer);reject(Error('Guest session failed'));};
  });const attempt=poPromise;attempt.catch(()=>{if(poPromise===attempt)poPromise=undefined;});return attempt;
}
async function mint(id:string) {await guest();return new Promise<string>((resolve,reject)=>{const key=++serial,timer=setTimeout(()=>{tokens.delete(key);reject(Error('Guest token timeout'));},5000);tokens.set(key,{resolve,reject,timer});po!.postMessage({key,id});});}
function fallback(id:string) {return new Promise<any>((resolve,reject)=>{const key=++serial,timer=setTimeout(()=>{pending.delete(key);reject(Error('Reserve timeout'));},35000);pending.set(key,{resolve,reject,timer});emit({event:'fallback',key,id});});}
function protectedFiles() {return new Set([...sessions.values()].filter(t=>t.id===selected||t.id===prepared||t.readers>0).map(t=>t.file));}
class Track {
  token=crypto.randomUUID();file=crypto.randomUUID()+'.audio';prefix=new Uint8Array();available=0;complete=false;error='';readers=0;
  control=new AbortController();started=false;at=Date.now();epoch=cache.epoch;
  constructor(readonly id:string,readonly size:number){}
  async read(offset:number,length:number) {
    if(offset<this.prefix.length)return this.prefix.slice(offset,Math.min(this.prefix.length,offset+length));
    const deadline=Date.now()+65000;
    while(this.available<Math.min(this.size,offset+length)){
      if(this.error)throw Error(this.error);if(this.control.signal.aborted)throw Error('Cancelled');
      if(Date.now()>deadline)throw Error('Audio continuation timed out');await new Promise(r=>setTimeout(r,20));
    }
    return readBytes(cache.path(this.file),offset,Math.min(length,this.size-offset));
  }
  cancel(){if(!this.complete){this.control.abort();this.error='Cancelled';} }
  async append(stream:ReadableStream<Uint8Array>) {
    const file=await Deno.open(cache.path(this.file),{read:true,write:true,create:true});let offset=0;
    const reader=stream.getReader();
    try {
      while(true){
        if(this.control.signal.aborted)throw Error('Cancelled');
        const {value,done}=await reader.read();if(done)break;
        if(offset+value.length>this.size)throw Error('Audio size mismatch');
        const prefixLength=Math.max(0,Math.min(value.length,this.prefix.length-offset));
        if(prefixLength&&!same(value.subarray(0,prefixLength),this.prefix.subarray(offset,offset+prefixLength)))throw Error('Audio streams differ');
        const priorLength=Math.max(0,Math.min(value.length,this.available-offset));
        if(priorLength&&!same(value.subarray(0,priorLength),await readBytes(cache.path(this.file),offset,priorLength)))throw Error('Audio streams differ');
        await file.seek(offset,Deno.SeekMode.Start);await writeBytes(file,value);offset+=value.length;
        this.available=Math.max(this.available,offset);
      }
      if(offset!==this.size)throw Error('Incomplete audio stream');await file.sync();
    }finally{file.close();await reader.cancel().catch(()=>{});}
  }
  start(){
    if(this.started||this.complete)return;this.started=true;
    void this.download().catch(error=>{this.error=restricted(error)?'Playback unavailable or temporarily limited':'Audio continuation failed';emit({event:'diagnostic',stage:'continuation',id:this.id,error:safe(error)});}).finally(()=>{if(!this.complete&&this.control.signal.aborted)void this.remove();});
  }
  async download(){
    let sabr:SabrStream|undefined;
    try{
      try{
        const client=await fullSession();
        const info=await client.getBasicInfo(this.id,{client:'WEB'});
        if(info.playability_status?.status!=='OK')throw Error(info.playability_status?.status||'Unplayable');
        const format=info.streaming_data?.adaptive_formats.find(f=>f.itag===140&&!f.is_drc);
        if(!format||Number(format.content_length)!==this.size)throw Error('Audio streams differ');
        const config=info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;
        const url=await client.session.player!.decipher(info.streaming_data!.server_abr_streaming_url);
        if(this.control.signal.aborted)throw Error('Cancelled');
        sabr=new SabrStream({fetch:(input,init)=>network(input,{...init,signal:AbortSignal.any([this.control.signal,...(init?.signal?[init.signal]:[])])}),poToken:await mint(this.id),formats:info.streaming_data!.adaptive_formats.map(buildSabrFormat),serverAbrStreamingUrl:url,videoPlaybackUstreamerConfig:config!,clientInfo:{clientName:Number(Constants.CLIENT_NAME_IDS[client.session.context.client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),clientVersion:client.session.context.client.clientVersion}});
        this.control.signal.addEventListener('abort',()=>sabr?.abort(),{once:true});
        const {audioStream}=await sabr.start({enabledTrackTypes:EnabledTrackTypes.AUDIO_ONLY,audioFormat:140,preferMP4:true,maxRetries:0,stallDetectionMs:5000});
        await this.append(audioStream);
      }catch(error){
        sabr?.abort();
        if(this.control.signal.aborted||aborted(error)||restricted(error)||/streams differ|size mismatch/.test(safe(error)))throw error;
        const source=await fallback(this.id);if(this.control.signal.aborted)throw Error('Cancelled');
        const url=new URL(source.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.username||url.password)throw Error('Invalid reserve source');
        const response=await fetch(url,{signal:AbortSignal.any([this.control.signal,AbortSignal.timeout(40000)])});
        if(!response.ok||Number(response.headers.get('content-length'))!==this.size){await response.body?.cancel();throw Error('Reserve audio differs');}
        await this.append(response.body!);
      }
      this.complete=true;this.prefix=new Uint8Array();
      await cache.commit({id:this.id,file:this.file,size:this.size,at:Date.now()},this.epoch);
    }finally{sabr?.abort();}
  }
  async remove(){if(!cache.entries.some(e=>e.file===this.file))await Deno.remove(cache.path(this.file)).catch(()=>{});}
}
async function getTrack(id:string,preload:boolean,refresh:boolean,generation:number):Promise<Track>{
  let track=sessions.get(id);
  if(track?.complete&&!await Deno.stat(cache.path(track.file)).then(s=>s.size===track!.size).catch(()=>false)){sessions.delete(id);track=undefined;}
  if(track&&!track.error&&!track.control.signal.aborted&&!refresh){if(!preload)track.start();return track;}
  if(inflight.has(id))return inflight.get(id)!;
  const control=new AbortController();resolving.set(id,control);
  // A stalled opening must release the foreground to the reserve promptly.
  const openingSignal=AbortSignal.any([control.signal,AbortSignal.timeout(5000)]);openingDeadlines.set(id,openingSignal);
  const job=(async()=>{
    const cached=!refresh?await cache.find(id):undefined;
    if(cached){track=new Track(id,cached.size);track.file=cached.file;track.available=cached.size;track.complete=true;}
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
      url.searchParams.set('cpn',info.cpn);url.searchParams.set('range',`0-${Math.min(size,1048576)-1}`);
      const response=await network(url,{signal:openingSignal});
      if(!response.ok){await response.body?.cancel();throw Error('Audio HTTP '+response.status);}
      track=new Track(id,size);
      const pieces:Uint8Array[]=[];let received=0;
      const reader=response.body!.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>Math.min(size,1048576))throw Error('Opening audio too large');pieces.push(value);}}finally{await reader.cancel().catch(()=>{});}
      track.prefix=new Uint8Array(received);let position=0;for(const bytes of pieces){track.prefix.set(bytes,position);position+=bytes.length;}
      if(track.prefix.length!==Math.min(size,1048576))throw Error('Incomplete opening audio');
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
  const track=[...sessions.values()].find(t=>'/'+t.token===url.pathname);
  if(!track)return new Response(null,{status:404});
  let start:number,end:number;try{[start,end]=byteRange(request.headers.get('range'),track.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${track.size}`}});}
  const headers:HeadersInit={'Content-Type':'audio/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
  if(request.headers.has('range'))headers['Content-Range']=`bytes ${start}-${end}/${track.size}`;
  if(request.method==='HEAD')return new Response(null,{status:request.headers.has('range')?206:200,headers});
  if(track.readers>=6)return new Response(null,{status:503});track.readers++;let closed=false;
  const finish=()=>{if(!closed){closed=true;track.readers--;if(track.id!==selected&&track.readers===0)void track.remove();}};
  const body=new ReadableStream<Uint8Array>({async pull(controller){try{if(closed)return;const bytes=await track.read(start,Math.min(65536,end-start+1));if(closed)return;start+=bytes.length;controller.enqueue(bytes);if(start>end){finish();controller.close();}}catch(e){finish();controller.error(e);}},cancel(){finish();}});
  return new Response(body,{status:request.headers.has('range')?206:200,headers});
});
emit({event:'ready',port:server.addr.port,version:'1.0.0'});
async function command(cmd:any){
  try{
    if(cmd.action==='prepare'){void fullSession();void guest();return;}
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
    if(cmd.action!=='play'||!validId(cmd.id))throw Error('Invalid music request');
    void fullSession();void guest();
    if(Number(cmd.generation)<foregroundGeneration)throw Error('Cancelled');
    if(!cmd.preload)foregroundGeneration=Number(cmd.generation)||foregroundGeneration;
    if(!cmd.preload)select(cmd.id);else{if(prepared&&prepared!==cmd.id)throw Error('Preload busy');prepared=cmd.id;}
    const generation=selection,track=await getTrack(cmd.id,!!cmd.preload,!!cmd.refresh,generation);
    if(generation!==selection&&selected!==cmd.id)throw Error('Cancelled');
    if(!cmd.preload)track.start();
    emit({key:cmd.key,data:{url:`http://127.0.0.1:${server.addr.port}/${track.token}`}});
  }catch(error){emit({key:cmd.key,error:restricted(error)?'Playback unavailable or temporarily limited':aborted(error)?'Cancelled':safe(error),restricted:restricted(error)});}
}
let buffer='';
for await(const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())){
  buffer+=chunk;if(buffer.length>65536)break;
  let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{void command(JSON.parse(line));}catch{}}
}
stopped=true;for(const track of sessions.values())track.cancel();po?.terminate();await server.shutdown();
