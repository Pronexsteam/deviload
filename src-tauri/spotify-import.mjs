// Public playlist metadata adapter. No account cookies, audio, or remote code execution.
// Web-player protocol research: SpotAPI/spotDL; independent implementation.
import {createHmac} from 'node:crypto';

const UNAVAILABLE='Could not read this public Spotify playlist or album. Try again later.';
const LIMITED='Music catalog is temporarily rate-limited. Try again later.';
const CHANGED='The Spotify playlist changed during import. Read the link again.';
export const SPOTIFY_MESSAGES=[UNAVAILABLE,LIMITED,CHANGED,'This Spotify playlist is too large to import in one session.','Spotify repeated a playlist page. Read the link again.','Some Spotify entries have no usable song metadata. They were kept in the import report.'];
const text=(v,n=300)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9]{22}$/.test(v);
export function playlistId(link){
  const u=new URL(link),m=u.pathname.match(/^\/(?:intl-[a-zA-Z-]{2,7}\/)?playlist\/([a-zA-Z0-9]{22})\/?$/);
  if(u.protocol!=='https:'||u.hostname!=='open.spotify.com'||u.username||u.password||u.port||u.hash||!m)throw Error(UNAVAILABLE);
  return m[1];
}
export function totp(bytes,seconds){
  if(!Array.isArray(bytes)||bytes.length<8||bytes.length>256||bytes.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error(UNAVAILABLE);
  const key=bytes.map((n,i)=>n^((i%33)+9)).join(''),counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds/30)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[19]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function scriptCandidates(js){
  // Read literal chunk-name/hash tables; never evaluate Spotify JavaScript.
  const tables=[...js.matchAll(/\{(?:\d+:"[a-zA-Z0-9_.-]+",?){2,}\}/g)].map(m=>new Map([...m[0].matchAll(/(\d+):"([a-zA-Z0-9_.-]+)"/g)].map(p=>[p[1],p[2]])));
  const names=new Set();
  for(const a of tables)for(const b of tables)if(a!==b)for(const [id,name]of a){const hash=b.get(id);if(/^[a-z][a-z0-9-]{2,100}$/.test(name)&&/^[a-f0-9]{8,64}$/.test(hash||''))names.add(`${name}.${hash}.js`);}
  return [...names].sort((a,b)=>Number(b.includes('routes-playlist.'))-Number(a.includes('routes-playlist.'))).slice(0,120);
}
export async function collectPlaylist(id,page,{signal,onProgress=()=>{}}={}){
  if(!validId(id))throw Error(UNAVAILABLE);
  const entries=[],unidentified=[],seen=new Set();let total=null,offset=0,name='',bytes=0;
  do{
    signal?.throwIfAborted();const value=await page(offset,343),p=value?.data?.playlistV2,c=p?.content;
    if(!c||!Array.isArray(c.items)||!Number.isSafeInteger(c.totalCount)||c.totalCount<0||c.items.length>343)throw Error(UNAVAILABLE);
    if(total!==null&&total!==c.totalCount)throw Error(CHANGED);
    total=c.totalCount;if(!offset)name=text(p.name)||'Imported Spotify playlist';
    if(!c.items.length&&offset<total||offset+c.items.length>total)throw Error(UNAVAILABLE);
    let fresh=0;
    for(const row of c.items){
      const d=row?.itemV2?.data,uri=d?.uri,id=typeof uri==='string'?uri.replace(/^spotify:track:/,''):'';
      if(!uri?.startsWith('spotify:track:')||!validId(id)){unidentified.push({position:offset+fresh,reason:'unsupported'});continue;}
      if(seen.has(uri))continue;seen.add(uri);fresh++;
      const title=text(d.name),artists=(d.artists?.items||[]).map(a=>text(a?.profile?.name,150)).filter(Boolean).slice(0,10);
      if(!title||!artists.length){unidentified.push({uri,reason:'metadata-unavailable'});continue;}
      const durationMs=d.trackDuration?.totalMilliseconds;
      const entry={key:uri,spotifyId:id,title,artists,album:text(d.albumOfTrack?.name),liked:false,plays:0,
        ...(Number.isFinite(durationMs)&&durationMs>0&&durationMs<=86400000?{durationMs}:{})};
      bytes+=JSON.stringify(entry).length*3;if(bytes>7*1024*1024)throw Error('This Spotify playlist is too large to import in one session.');
      entries.push(entry);
    }
    if(offset&&c.items.length&&!fresh&&offset+c.items.length<total)throw Error('Spotify repeated a playlist page. Read the link again.');
    offset+=c.items.length;onProgress(offset,total);
  }while(offset<total);
  return {source:'spotify',name,entries,unidentified,reportedTotal:total,receivedCount:offset,unavailableCount:unidentified.length,
    playlists:[{name,keys:entries.map(e=>e.key)}],warnings:unidentified.length?['Some Spotify entries have no usable song metadata. They were kept in the import report.']:[],completeness:'complete',origin:'link'};
}

export async function readPublicPlaylist(link,{fetcher=fetch,signal=AbortSignal.timeout(150000),onProgress}={}){
  const id=playlistId(link);let requests=0,totalBytes=0;
  async function get(url,init={},limit=8*1024*1024){
    const u=new URL(url),allowed=['open.spotify.com','open.spotifycdn.com','clienttoken.spotify.com','api-partner.spotify.com','code.thetadev.de'];
    if(u.protocol!=='https:'||!allowed.includes(u.hostname)||u.username||u.password||u.port||++requests>150)throw Error(UNAVAILABLE);
    const response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',...init.headers}});
    if(response.status===429){await response.body?.cancel();throw Error(LIMITED);}
    if(!response.ok){await response.body?.cancel();throw Error(UNAVAILABLE);}
    const reader=response.body.getReader(),parts=[];let length=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;totalBytes+=value.length;if(length>limit||totalBytes>40*1024*1024)throw Error(UNAVAILABLE);parts.push(value);}}finally{await reader.cancel();}
    return {text:Buffer.concat(parts).toString('utf8'),headers:response.headers};
  }
  const home=await get('https://open.spotify.com/');
  const encoded=home.text.match(/<script[^>]*id="appServerConfig"[^>]*>([^<]+)<\/script>/)?.[1];
  if(!encoded)throw Error(UNAVAILABLE);
  const config=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  const script=[...home.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]).find(s=>/^https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[a-f0-9]+\.js$/.test(s));
  if(!script||typeof config.clientVersion!=='string')throw Error(UNAVAILABLE);
  const [secrets,main]=await Promise.all([get('https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json',{},1024*1024),get(script)]);
  const versions=JSON.parse(secrets.text),version=Object.keys(versions).filter(v=>/^\d{1,6}$/.test(v)).map(Number).sort((a,b)=>b-a)[0];
  const serverDate=Date.parse(home.headers.get('date')||''),seconds=Number.isFinite(serverDate)?serverDate/1000:Date.now()/1000;
  const code=totp(versions[version],seconds);
  const auth=JSON.parse((await get('https://open.spotify.com/api/token?'+new URLSearchParams({reason:'init',productType:'web-player',totp:code,totpVer:String(version),totpServer:code}),{},1024*1024)).text);
  if(typeof auth.accessToken!=='string'||typeof auth.clientId!=='string')throw Error(UNAVAILABLE);
  const token=JSON.parse((await get('https://clienttoken.spotify.com/v1/clienttoken',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({client_data:{client_version:config.clientVersion,client_id:auth.clientId,js_sdk_data:{device_brand:'unknown',device_model:'unknown',os:'windows',os_version:'NT 10.0',device_id:crypto.randomUUID(),device_type:'computer'}}})},1024*1024)).text);
  if(token.response_type!=='RESPONSE_GRANTED_TOKEN_RESPONSE'||typeof token.granted_token?.token!=='string')throw Error(UNAVAILABLE);
  const hashIn=js=>js.match(/"fetchPlaylist","query","([a-f0-9]{64})"/)?.[1];
  let hash=hashIn(main.text);
  for(const file of hash?[]:scriptCandidates(main.text)){
    hash=hashIn((await get('https://open.spotifycdn.com/cdn/build/web-player/'+file)).text);if(hash)break;
  }
  if(!hash)throw Error(UNAVAILABLE);
  return collectPlaylist(id,async(offset,limit)=>{
    const query=new URLSearchParams({operationName:'fetchPlaylist',variables:JSON.stringify({uri:'spotify:playlist:'+id,offset,limit,enableWatchFeedEntrypoint:false}),extensions:JSON.stringify({persistedQuery:{version:1,sha256Hash:hash}})});
    return JSON.parse((await get('https://api-partner.spotify.com/pathfinder/v1/query?'+query,{method:'POST',headers:{authorization:'Bearer '+auth.accessToken,'client-token':token.granted_token.token,'spotify-app-version':config.clientVersion,'content-type':'application/json'}},4*1024*1024)).text);
  },{signal,onProgress});
}

if(import.meta.main){
  try{console.log(JSON.stringify(await readPublicPlaylist(Deno.args[0])));}
  catch(error){const message=error instanceof Error?error.message:'';console.log(JSON.stringify({error:SPOTIFY_MESSAGES.includes(message)?message:UNAVAILABLE}));Deno.exitCode=1;}
}
