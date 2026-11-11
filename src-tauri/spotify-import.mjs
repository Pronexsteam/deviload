// Playlist metadata adapter: public playlists, and the person's own library when they signed in to Spotify in
// Deviload. Reads song lists only: no audio, no remote code execution, nothing written to the account.
// Web-player protocol research: SpotAPI/spotDL; independent implementation.
import {createHmac} from 'node:crypto';

const UNAVAILABLE='Could not read this public Spotify playlist or album. Try again later.';
const LIMITED='Music catalog is temporarily rate-limited. Try again later.';
const CHANGED='The Spotify playlist changed during import. Read the link again.';
const SIGNED_OUT='Sign in to Spotify again to read your library.';
const LIBRARY='Could not read your Spotify library. Try again later.';
const PARTIAL='Some of your Spotify playlists could not be read.';
const EMPTY='No importable music was found.';
export const SPOTIFY_MESSAGES=[UNAVAILABLE,LIMITED,CHANGED,SIGNED_OUT,LIBRARY,PARTIAL,EMPTY,'This Spotify playlist is too large to import in one session.','Spotify repeated a playlist page. Read the link again.','Some Spotify entries have no usable song metadata. They were kept in the import report.'];
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

// One web-player session: an access token (the person's own when their sp_dc cookie is given), a client token and
// the query hashes the web player itself uses.
export async function webSession({fetcher=fetch,signal=AbortSignal.timeout(150000),cookie='',secrets:supplied='',maxRequests=150,maxBytes=40*1024*1024}={}){
  let requests=0,totalBytes=0;
  async function get(url,init={},limit=8*1024*1024,wait=15000){
    const u=new URL(url),allowed=['open.spotify.com','open.spotifycdn.com','clienttoken.spotify.com','api-partner.spotify.com','code.thetadev.de'];
    if(u.protocol!=='https:'||!allowed.includes(u.hostname)||u.username||u.password||u.port||++requests>maxRequests)throw Error(UNAVAILABLE);
    // The sign-in cookie goes to open.spotify.com only, the host that issued it.
    const own=cookie&&u.hostname==='open.spotify.com'?{cookie:'sp_dc='+cookie}:{};
    const response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(wait)]),headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',...own,...init.headers}});
    if(response.status===429){await response.body?.cancel();throw Error(LIMITED);}
    if(!response.ok){await response.body?.cancel();throw Error(UNAVAILABLE);}
    const reader=response.body.getReader(),parts=[];let length=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;totalBytes+=value.length;if(length>limit||totalBytes>maxBytes)throw Error(UNAVAILABLE);parts.push(value);}}finally{await reader.cancel();}
    return {text:Buffer.concat(parts).toString('utf8'),headers:response.headers};
  }
  const home=await get('https://open.spotify.com/');
  const encoded=home.text.match(/<script[^>]*id="appServerConfig"[^>]*>([^<]+)<\/script>/)?.[1];
  if(!encoded)throw Error(UNAVAILABLE);
  const config=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  const script=[...home.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]).find(s=>/^https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[a-f0-9]+\.js$/.test(s));
  if(!script||typeof config.clientVersion!=='string')throw Error(UNAVAILABLE);
  // The app fetches the shared web-player secrets itself when it can; some networks reach that host only slowly.
  const [secrets,main]=await Promise.all([supplied&&supplied.length<=1024*1024?{text:supplied}:get('https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json',{},1024*1024,45000),get(script)]);
  const versions=JSON.parse(secrets.text),version=Object.keys(versions).filter(v=>/^\d{1,6}$/.test(v)).map(Number).sort((a,b)=>b-a)[0];
  const serverDate=Date.parse(home.headers.get('date')||''),seconds=Number.isFinite(serverDate)?serverDate/1000:Date.now()/1000;
  const code=totp(versions[version],seconds);
  const auth=JSON.parse((await get('https://open.spotify.com/api/token?'+new URLSearchParams({reason:'init',productType:'web-player',totp:code,totpVer:String(version),totpServer:code}),{},1024*1024)).text);
  if(typeof auth.accessToken!=='string'||typeof auth.clientId!=='string')throw Error(UNAVAILABLE);
  if(cookie&&auth.isAnonymous!==false)throw Error(SIGNED_OUT);
  const token=JSON.parse((await get('https://clienttoken.spotify.com/v1/clienttoken',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({client_data:{client_version:config.clientVersion,client_id:auth.clientId,js_sdk_data:{device_brand:'unknown',device_model:'unknown',os:'windows',os_version:'NT 10.0',device_id:crypto.randomUUID(),device_type:'computer'}}})},1024*1024)).text);
  if(token.response_type!=='RESPONSE_GRANTED_TOKEN_RESPONSE'||typeof token.granted_token?.token!=='string')throw Error(UNAVAILABLE);
  const hashes=new Map(),files=scriptCandidates(main.text),pattern=op=>new RegExp('"'+op+'","query","([a-f0-9]{64})"');
  async function hash(op){
    if(hashes.has(op))return hashes.get(op);
    let found=main.text.match(pattern(op))?.[1];
    for(const file of found?[]:files){found=(await get('https://open.spotifycdn.com/cdn/build/web-player/'+file)).text.match(pattern(op))?.[1];if(found)break;}
    if(!found)throw Error(UNAVAILABLE);
    hashes.set(op,found);return found;
  }
  async function query(op,variables){
    const params=new URLSearchParams({operationName:op,variables:JSON.stringify(variables),extensions:JSON.stringify({persistedQuery:{version:1,sha256Hash:await hash(op)}})});
    return JSON.parse((await get('https://api-partner.spotify.com/pathfinder/v1/query?'+params,{method:'POST',headers:{authorization:'Bearer '+auth.accessToken,'client-token':token.granted_token.token,'spotify-app-version':config.clientVersion,'content-type':'application/json'}},4*1024*1024)).text);
  }
  return {query};
}

export async function readPublicPlaylist(link,{fetcher=fetch,signal=AbortSignal.timeout(150000),onProgress,secrets=''}={}){
  const id=playlistId(link),session=await webSession({fetcher,signal,secrets});
  return collectPlaylist(id,(offset,limit)=>session.query('fetchPlaylist',{uri:'spotify:playlist:'+id,offset,limit,enableWatchFeedEntrypoint:false}),{signal,onProgress});
}

// A liked song from the library page, in the shape playlists use.
export function likedEntry(row){
  const track=row?.track,d=track?.data,uri=track?._uri,id=typeof uri==='string'?uri.replace(/^spotify:track:/,''):'';
  if(d?.__typename!=='Track'||!uri?.startsWith('spotify:track:')||!validId(id))return null;
  const title=text(d.name),artists=(d.artists?.items||[]).map(a=>text(a?.profile?.name,150)).filter(Boolean).slice(0,10);
  if(!title||!artists.length)return null;
  const durationMs=d.duration?.totalMilliseconds;
  return {key:uri,spotifyId:id,title,artists,album:text(d.albumOfTrack?.name),liked:true,plays:0,
    ...(Number.isFinite(durationMs)&&durationMs>0&&durationMs<=86400000?{durationMs}:{})};
}
// The person's playlists from their library page, folders flattened.
export function libraryPlaylists(page){
  const items=page?.data?.me?.libraryV3?.items;
  if(!Array.isArray(items))throw Error(LIBRARY);
  return items.map(row=>row?.item).filter(item=>item?.__typename==='PlaylistResponseWrapper'&&/^spotify:playlist:[a-zA-Z0-9]{22}$/.test(item._uri||''))
    .map(item=>({id:item._uri.slice(17),name:text(item.data?.name,120)||'Spotify playlist'}));
}
// Joins liked songs and playlists: a song appears once, and a liked song stays liked wherever else it appears.
export function joinLibrary(liked,lists,failed){
  const entries=new Map(),playlists=[];
  for(const entry of liked)if(!entries.has(entry.key))entries.set(entry.key,entry);
  if(liked.length)playlists.push({name:'Liked Songs',keys:[...new Set(liked.map(e=>e.key))]});
  for(const list of lists){
    for(const entry of list.entries)if(!entries.has(entry.key))entries.set(entry.key,{...entry,liked:false});
    if(list.entries.length)playlists.push({name:list.name,keys:list.entries.map(e=>e.key)});
  }
  return {source:'spotify',name:'My Spotify library',origin:'account',entries:[...entries.values()],playlists,
    warnings:failed?[PARTIAL]:[],completeness:failed?'unknown':'complete'};
}

export async function readLibrary(cookie,{fetcher=fetch,signal=AbortSignal.timeout(600000),pause=150,maxPlaylists=200,maxLiked=10000,secrets=''}={}){
  if(!/^[A-Za-z0-9_-]{20,2048}$/.test(cookie||''))throw Error(SIGNED_OUT);
  const session=await webSession({fetcher,signal,cookie,secrets,maxRequests:2500,maxBytes:160*1024*1024});
  const wait=()=>new Promise(resolve=>setTimeout(resolve,pause));
  const liked=[];let offset=0,total=Infinity;
  while(offset<total&&offset<maxLiked){
    signal.throwIfAborted();
    const page=(await session.query('fetchLibraryTracks',{offset,limit:50}))?.data?.me?.library?.tracks;
    if(!page||!Array.isArray(page.items)||!Number.isSafeInteger(page.totalCount))throw Error(LIBRARY);
    total=page.totalCount;
    for(const row of page.items){const entry=likedEntry(row);if(entry)liked.push(entry);}
    if(!page.items.length)break;
    offset+=page.items.length;await wait();
  }
  const found=[];offset=0;total=Infinity;
  while(offset<total&&found.length<maxPlaylists){
    const page=await session.query('libraryV3',{filters:['Playlists'],order:null,textFilter:'',features:['LIKED_SONGS','YOUR_EPISODES_V2','PRERELEASES','PRERELEASES_V2','EVENTS'],limit:50,offset,flatten:true,expandedFolders:[],folderUri:null,includeFoldersWhenFlattening:true});
    const library=page?.data?.me?.libraryV3;
    if(!library||!Array.isArray(library.items))throw Error(LIBRARY);
    total=Number.isSafeInteger(library.totalCount)?library.totalCount:0;
    found.push(...libraryPlaylists(page));
    if(!library.items.length)break;
    offset+=library.items.length;await wait();
  }
  const lists=[],seen=new Set();let failed=0;
  for(const {id,name} of found.slice(0,maxPlaylists)){
    if(seen.has(id))continue;seen.add(id);
    try{
      const list=await collectPlaylist(id,(offset,limit)=>session.query('fetchPlaylist',{uri:'spotify:playlist:'+id,offset,limit,enableWatchFeedEntrypoint:false}),{signal});
      lists.push({name,entries:list.entries});
    }catch(error){
      if(error?.message===LIMITED){failed++;break;}
      failed++;
    }
    await wait();
  }
  if(!liked.length&&!lists.some(l=>l.entries.length))throw Error(EMPTY);
  return joinLibrary(liked,lists,failed);
}

if(import.meta.main){
  try{
    // The sign-in cookie arrives in the environment, never on the command line where other programs can read it.
    const secrets=Deno.env.get('DEVILOAD_SPOTIFY_SECRETS')||'';
    const result=Deno.args[0]==='--library'?await readLibrary(Deno.env.get('DEVILOAD_SPOTIFY_SESSION')||'',{secrets}):await readPublicPlaylist(Deno.args[0],{secrets});
    console.log(JSON.stringify(result));
  }
  catch(error){const message=error instanceof Error?error.message:'';console.log(JSON.stringify({error:SPOTIFY_MESSAGES.includes(message)?message:Deno.args[0]==='--library'?LIBRARY:UNAVAILABLE}));Deno.exitCode=1;}
}
