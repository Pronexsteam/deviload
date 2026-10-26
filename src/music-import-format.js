const MAX_BYTES=50*1024*1024;
const clean=(value,max=300)=>typeof value==="string"?value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max):"";
const norm=value=>value.normalize("NFKC").toLowerCase();
const videoId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value.trim())?value.trim():null;
const own=(value,key)=>value!==null&&typeof value==="object"&&Object.hasOwn(value,key);
function fromUrl(value){
  try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)return null;
    if(url.hostname==="youtu.be")return videoId(url.pathname.slice(1));
    if(["youtube.com","www.youtube.com","music.youtube.com","m.youtube.com"].includes(url.hostname)&&url.pathname==="/watch")return videoId(url.searchParams.get("v"));
  }catch{/* An arbitrary URL is not an importable video. */}return null;
}
function timestamp(value){
  if(typeof value!=="string")return undefined;
  const text=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)?value.replace(" ","T")+":00Z":value;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text))return undefined;
  const result=Date.parse(text);return Number.isFinite(result)&&result>=946684800000&&result<4133980800000?result:undefined;
}
// RFC 4180 quoting; the file-byte budget bounds input without truncating songs.
function csv(text,warn){
  const rows=[];let row=[],field="",quoted=false,closed=false,atStart=true;
  const endField=()=>{row.push(field);field="";closed=false;atStart=true;if(row.length>128)throw Error("Invalid music CSV.");};
  const endRow=()=>{endField();if(row.some(value=>value.trim())){rows.push(row);}row=[];};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){if(field.length<20000)field+='"';i++;}else{quoted=false;closed=true;}}else if(field.length<20000)field+=char;continue;}
    if(closed&&char!==","&&char!=="\r"&&char!=="\n")throw Error("Invalid music CSV.");
    if(char==='"'){if(!atStart)throw Error("Invalid music CSV.");quoted=true;atStart=false;}
    else if(char===",")endField();
    else if(char==="\r"||char==="\n"){if(char==="\r"&&text[i+1]==="\n")i++;endRow();}
    else{atStart=false;if(field.length<20000)field+=char;}
  }
  if(quoted)throw Error("Invalid music CSV.");
  if(field||row.length||closed)endRow();return rows;
}

// Only musical fields survive, including in custom exports and Spotify API responses.
export function parseMusicImport(text,filename=""){
  if(typeof text!=="string"||!text.trim())throw Error("The music import file is empty.");
  if(text.length>MAX_BYTES||new TextEncoder().encode(text).length>MAX_BYTES)throw Error("Choose a music export up to 50 MB.");
  text=text.replace(/^\uFEFF/,"");
  const basename=clean(String(filename).split(/[\\/]/).pop(),150).replace(/\.(json|csv)$/i,"");
  const result={source:null,name:basename||"Imported music",entries:[],playlists:[],warnings:[]},entries=new Map();
  const warn=message=>{if(!result.warnings.includes(message))result.warnings.push(message);};
  function add({title,artists=[],id,liked=false,plays=0,lastPlayed}){
    title=clean(title);artists=[...new Map(artists.map(value=>clean(value,150)).filter(Boolean).slice(0,10).map(value=>[norm(value),value])).values()];
    const validVideo=videoId(id);
    if(!validVideo&&(!title||!artists.length)){warn("Some incomplete or unsupported tracks were skipped.");return null;}
    const key=validVideo?"youtube:"+validVideo:result.source+":"+JSON.stringify([norm(title),artists.map(norm)]);
    let entry=entries.get(key);
    if(entry)warn("Repeated songs were combined.");
    if(!entry){
      entry={key,title,artists,liked:false,plays:0};if(validVideo)entry.videoId=validVideo;entries.set(key,entry);
    }
    if(!entry.title&&title)entry.title=title;if(!entry.artists.length&&artists.length)entry.artists=artists;
    entry.liked||=liked===true;entry.plays=Math.min(100,entry.plays+Math.max(0,plays));
    if(lastPlayed!==undefined&&(!entry.lastPlayed||lastPlayed>entry.lastPlayed))entry.lastPlayed=lastPlayed;
    return key;
  }
  const playlist=(name,keys)=>result.playlists.push({name:clean(name,60)||"Imported playlist",keys:[...new Set(keys.filter(Boolean))]});
  if(/^[\s]*[\[{]/.test(text)){
    let raw;try{raw=JSON.parse(text);}catch{throw Error("Invalid music JSON.");}
    result.source="spotify";
    const history=Array.isArray(raw)&&raw.some(row=>own(row,"msPlayed")&&own(row,"trackName")||own(row,"ms_played")&&own(row,"master_metadata_track_name"));
    const customRows=Array.isArray(raw)?raw:Array.isArray(raw?.tracks)?raw.tracks:Array.isArray(raw?.items)?raw.items:raw?.tracks?.items;
    const trackData=row=>row?.track&&typeof row.track==='object'?row.track:row;
    const recognizable=row=>{const item=trackData(row);return item&&typeof (item.title??item.name)==='string'&&Array.isArray(item.artists);};
    if(history){
      for(const row of raw){if(!row||typeof row!=="object")continue;
        const ms=row.msPlayed??row.ms_played;if(typeof ms!=="number"||!Number.isFinite(ms)||ms<30000||ms>86400000)continue;
        const title=row.trackName??row.master_metadata_track_name,artist=row.artistName??row.master_metadata_album_artist_name;
        if(!title||!artist)continue; // Podcast and audiobook records are not songs.
        add({title,artists:[artist],plays:1,lastPlayed:timestamp(row.endTime??row.ts)});
      }
    }else if(Array.isArray(customRows)&&customRows.some(recognizable)){
      const savedSongs=/(?:liked[ _-]*songs|saved[ _-]*tracks|your[ _-]*library)/i.test(basename)||(!Array.isArray(raw)&&Array.isArray(raw.items)&&raw.items.some(row=>own(row,'added_at')));
      for(const row of customRows){const item=trackData(row);
        if(!recognizable(row)||item.type&&item.type!=='track'){warn("Some incomplete or unsupported tracks were skipped.");continue;}
        add({title:item.title??item.name,artists:item.artists.map(artist=>typeof artist==='string'?artist:artist?.name),liked:savedSongs||row.liked===true||item.liked===true});
      }
      if(Array.isArray(raw?.unidentified)&&raw.unidentified.length)warn("The export also contains unidentified songs without enough metadata to match.");
    }else if(Array.isArray(raw?.tracks)&&(raw.tracks.length===0||raw.tracks.some(row=>own(row,"track")&&own(row,"artist")))){
      for(const row of raw.tracks){add({title:row?.track,artists:[row?.artist],liked:true});}
    }else if(Array.isArray(raw?.playlists)){
      for(const list of raw.playlists){
        if(!Array.isArray(list?.items)){warn("Some incomplete or unsupported tracks were skipped.");continue;}
        const keys=[];for(const row of list.items){if(!row?.track)continue;keys.push(add({title:row.track.trackName,artists:[row.track.artistName]}));}
        playlist(list.name,keys);
      }
    }else throw Error("Unsupported music export format.");
  }else{
    result.source="youtube";const rows=csv(text,warn);if(!rows.length)throw Error("The music import file is empty.");
    const header=rows.shift().map(value=>clean(value).toLowerCase()),index=(...names)=>header.findIndex(value=>names.includes(value));
    const titleAt=index("song title","track name","track title"),artistAt=index("artist name","artist names","artist name(s)","artist(s)"),idAt=index("video id"),urlAt=index("song url");
    const spotifyCsv=index('track uri','spotify uri')>=0||header.includes('track name');
    if(spotifyCsv)result.source='spotify';
    if(new Set(header).size!==header.length||!(titleAt>=0&&artistAt>=0||idAt>=0||urlAt>=0))throw Error("Unsupported music export format.");
    const keys=[];
    for(const row of rows){if(row.length!==header.length)throw Error("Invalid music CSV.");
      const id=videoId(row[idAt])||fromUrl(row[urlAt]);
      if(titleAt<0&&!id){warn("Some incomplete or unsupported tracks were skipped.");continue;}
      // A saved library song or a playlist membership is not necessarily a like.
      const artists=artistAt>=0?(spotifyCsv?row[artistAt].split(';'):[row[artistAt]]):[];
      keys.push(add({title:row[titleAt],artists,id,liked:spotifyCsv&&/(?:liked[ _-]*songs|saved[ _-]*tracks)/i.test(basename)}));
    }
    playlist(basename||(titleAt>=0?"YouTube Music library":"YouTube playlist"),keys);
  }
  result.entries=[...entries.values()];if(result.playlists.length===1)result.name=result.playlists[0].name;if(!result.entries.length)warn("No qualifying music was found in this file.");return result;
}
