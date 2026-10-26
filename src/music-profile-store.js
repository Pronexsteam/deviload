import {PROFILE_KEY,exportMusicProfile,importMusicProfile,readMusicProfile} from './music-profile.js';

export const MUSIC_PROFILE_DATABASE='deviload-music-profile';
const TABLE='profiles',CURRENT='current',BACKUP='previous';
const unavailable=()=>Error('Music library storage is unavailable. Your saved data has not been replaced.');

function transaction(db,mode,action){
  return new Promise((resolve,reject)=>{
    let tx,result;
    try{
      tx=db.transaction(TABLE,mode,mode==='readwrite'?{durability:'strict'}:undefined);
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(tx.error||unavailable());
      tx.onerror=()=>{}; // The abort event is authoritative; no partial commit counts as saved.
      action(tx.objectStore(TABLE),value=>result=value,tx);
    }catch(error){try{tx?.abort();}catch{}reject(error);}
  });
}

// Only the music profile moves. Session, appearance and unrelated settings retain their keys.
// Keep the synchronous in-memory view used by playback, and acknowledge persistence on commit.
export async function openMusicProfileStore({indexedDB=globalThis.indexedDB,legacy=globalThis.localStorage,name=MUSIC_PROFILE_DATABASE,onState=()=>{}}={}){
  if(!indexedDB)throw unavailable();
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);let abandoned=false;
    request.onupgradeneeded=()=>request.result.createObjectStore(TABLE);
    request.onerror=()=>reject(request.error||unavailable());
    request.onblocked=()=>{abandoned=true;reject(unavailable());};
    request.onsuccess=()=>{if(abandoned)request.result.close();else resolve(request.result);};
  });
  db.onversionchange=()=>db.close();
  let current;
  try{
    const existing=await transaction(db,'readonly',(store,done)=>{
      const request=store.get(CURRENT);request.onsuccess=()=>done(request.result);
    });
    if(existing!==undefined){importMusicProfile(existing);current=existing;}
    else{
      const old=legacy?.getItem(PROFILE_KEY);
      // A corrupt modern profile must never fall back to an empty legacy collection.
      if(old!==null&&old!==undefined){importMusicProfile(old);current=old;}
      else{const {saved,taste}=readMusicProfile(legacy);current=exportMusicProfile(saved,taste);}
      current=await transaction(db,'readwrite',(store,done)=>{
        const request=store.get(CURRENT);
        request.onsuccess=()=>{
          // Another window may have completed migration while this one was opening.
          if(request.result!==undefined){done(request.result);return;}
          store.put(current,CURRENT);store.put(current,BACKUP);done(current);
        };
      });
      importMusicProfile(current);
    }
  }catch(error){db.close();throw error;}
  let pending=0,failure=null,latest=Promise.resolve(),revision=0;
  const announce=()=>{try{onState({pending,error:failure});}catch{/* Rendering cannot interrupt a commit. */}};
  const write=value=>{
    const turn=++revision;
    const promise=transaction(db,'readwrite',(store)=>{
      const request=store.get(CURRENT);
      request.onsuccess=()=>{
        if(request.result!==undefined)store.put(request.result,BACKUP);
        store.put(value,CURRENT);
      };
    });
    current=value;pending++;announce();
    latest=promise.then(()=>{if(turn===revision)failure=null;},error=>{failure=error;throw error;})
      .finally(()=>{pending--;announce();});
    // Background playback saves report through onState. Explicit imports also await this promise.
    latest.catch(()=>{});
    return latest;
  };
  return {
    getItem:key=>key===PROFILE_KEY?current:legacy?.getItem(key)??null,
    setItem:(key,value)=>key===PROFILE_KEY?write(value):legacy?.setItem(key,value),
    removeItem:key=>{if(key===PROFILE_KEY)throw unavailable();return legacy?.removeItem(key);},
    flush:()=>latest,
    retry:()=>write(current),
    get pending(){return pending;},
    get error(){return failure;},
    close:async()=>{await latest;db.close();}
  };
}
