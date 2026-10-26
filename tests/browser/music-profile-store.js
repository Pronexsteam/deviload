// Run in an isolated browser origin. Never use an installed user's WebView profile.
import {openMusicProfileStore} from '/music-profile-store.js';
import {PROFILE_KEY,exportMusicProfile,importMusicProfile,saveMusicProfile,readMusicProfile} from '/music-profile.js';
import {readTaste,recordListening,recommend} from '/music-taste.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const same=(a,b,message)=>check(JSON.stringify(a)===JSON.stringify(b),message);
const song=n=>({id:String(n).padStart(11,'0'),kind:'song',title:'Synthetic track '+n,subtitle:'Fixture artist',artists:['Fixture artist'],image:'https://i.ytimg.com/vi/00000000000/hqdefault.jpg'});
const readRecord=(name,key)=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('profiles');let value;
    tx.objectStore('profiles').get(key).onsuccess=event=>value=event.target.result;
    tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=()=>{db.close();reject(tx.error);};
  };
});
const putRecord=(name,key,value)=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('profiles','readwrite');
    tx.objectStore('profiles').put(value,key);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
  };
});
export async function runProfileStorageChecks(){
  const states=[],name='large-library-test',taste=readTaste();
  recordListening(taste,song(7),{seconds:90,duration:100,session:3},Date.now()-1000);
  taste.hiddenSongs=[song(8).id];taste.blockedArtists=['unwanted artist'];taste.mode='discovery';
  const saved={favorites:[song(1)],recent:[song(7)],volume:.37,volumeBeforeMute:.65,publicDiscovery:false,
    playlists:[{id:'night',name:'Night',description:'Original list',pinned:true,items:[song(2)]}],
    collections:[{kind:'artist',id:'UCabcdefghijk',title:'Fixture artist'}],
    interestMixes:[{id:'focus',name:'Focus',playlistIds:['night']}],
    sourceBindings:[{trackId:song(1).id,track:song(1),source:song(9)}]};
  const old=exportMusicProfile(saved,taste);localStorage.setItem(PROFILE_KEY,old);
  localStorage.setItem('fixture-settings','unchanged');
  let storage=await openMusicProfileStore({name,onState:state=>states.push({pending:state.pending,error:!!state.error})});
  same(readMusicProfile(storage),importMusicProfile(old),'Migration preserves every field');
  check(localStorage.getItem(PROFILE_KEY)===old,'Legacy backup remains unchanged');
  check(await readRecord(name,'previous')===old,'Migration creates backup');
  storage.setItem('fixture-settings','still here');check(localStorage.getItem('fixture-settings')==='still here','Unrelated settings still use original storage');
  const large={...saved,favorites:Array.from({length:40000},(_,n)=>song(n))};
  const largeRaw=exportMusicProfile(large,taste),bytes=new TextEncoder().encode(largeRaw).length;
  check(bytes>5*1024*1024,'Fixture exceeds localStorage capacity');
  await saveMusicProfile(storage,large,taste);
  check(await readRecord(name,'previous')===old,'Previous good snapshot retained');
  check(await readRecord(name,'current')===largeRaw,'All tracks committed');
  await storage.close();storage=await openMusicProfileStore({name,onState:state=>states.push({pending:state.pending,error:!!state.error})});
  same(readMusicProfile(storage),importMusicProfile(largeRaw),'Reopen retains complete large profile');
  const options={now:Date.now(),random:()=>0},candidates=[song(1),song(7),song(8)];
  same(recommend(candidates,readMusicProfile(storage).taste,large.favorites,options),recommend(candidates,taste,large.favorites,options),'Recommendation ranking preserved');
  const first=saveMusicProfile(storage,{...large,volume:.41},taste);
  const second=saveMusicProfile(storage,{...large,volume:.42},taste);
  await Promise.all([first,second]);check(importMusicProfile(await readRecord(name,'current')).saved.volume===.42,'Overlapping writes retain newest snapshot');
  const committed=await readRecord(name,'current'),backup=await readRecord(name,'previous');
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name===name&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
  let rejected=false;
  try{await saveMusicProfile(storage,{...large,volume:.88},taste);}catch{rejected=true;}
  finally{IDBDatabase.prototype.transaction=transaction;}
  check(rejected&&storage.error,'Failed transaction rejects and exposes retry state');
  check(await readRecord(name,'current')===committed,'Failed transaction preserves current profile');
  check(await readRecord(name,'previous')===backup,'Failed transaction preserves backup');
  check(readMusicProfile(storage).saved.volume===.88,'Unsaved changes retained in memory for retry');
  await storage.retry();check(!storage.error&&storage.pending===0,'Retry clears error only after commit');
  check(importMusicProfile(await readRecord(name,'current')).saved.volume===.88,'Retry persists pending snapshot');
  await storage.close();
  // A damaged modern profile cannot be replaced with the stale localStorage backup.
  const raw=await readRecord(name,'current');await putRecord(name,'current','{broken');
  let blocked=false;try{await openMusicProfileStore({name});}catch{blocked=true;}
  check(blocked,'Corrupt current profile fails closed');check(await readRecord(name,'current')==='{broken','Corrupt data retained for recovery');
  check(await readRecord(name,'previous')===committed,'Good backup survives corrupt load');
  await putRecord(name,'current',raw);
  const brokenName='broken-legacy-test';localStorage.setItem(PROFILE_KEY,'{invalid');
  blocked=false;try{await openMusicProfileStore({name:brokenName});}catch{blocked=true;}
  check(blocked&&localStorage.getItem(PROFILE_KEY)==='{invalid','Invalid legacy profile is never erased');
  localStorage.setItem(PROFILE_KEY,old);
  const splitName='legacy-split-test',splitData=new Map([['deviload-music-v1',JSON.stringify(saved)],['deviload-music-taste-v1',JSON.stringify(taste)]]);
  const legacy={getItem:key=>splitData.get(key)??null,setItem:(key,value)=>splitData.set(key,value)};
  const expected=readMusicProfile(legacy),split=await openMusicProfileStore({name:splitName,legacy});
  same(readMusicProfile(split),importMusicProfile(exportMusicProfile(expected.saved,expected.taste)),'Old split library and taste migrate together');await split.close();
  check(states.some(s=>s.pending>0)&&states.some(s=>s.error),'Pending and failure states are reported');
  check(localStorage.getItem(PROFILE_KEY)===old&&localStorage.getItem('fixture-settings')==='still here','Legacy profile and unrelated settings preserved');
  return {tracks:40000,bytes,checks:'migration, backup, reopen, taste/ranking, settings, overlapping writes, abort, retry, corruption protection, split legacy',name};
}
export async function checkAfterBrowserRestart(){
  const storage=await openMusicProfileStore({name:'large-library-test'}),profile=readMusicProfile(storage);
  check(profile.saved.favorites.length===40000,'All tracks survive browser process restart');
  check(profile.saved.volume===.88&&profile.saved.publicDiscovery===false,'Settings survive process restart');
  check(profile.taste.mode==='discovery'&&profile.taste.entries[song(7).id].score===2.5,'Taste survives process restart');
  await storage.close();return {restartTracks:profile.saved.favorites.length,volume:profile.saved.volume,tasteScore:profile.taste.entries[song(7).id].score};
}
