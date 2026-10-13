import {AudioCache,CACHE_LIMIT,CACHE_LIMITS,TRACK_LIMIT,byteRange,readBytes,validId} from './storage.ts';
function assert(value:unknown,message='Assertion failed'){if(!value)throw Error(message);}
Deno.test('ranges reject invalid requests and preserve exact boundaries',()=>{
 assert(JSON.stringify(byteRange('bytes=4-8',10))==='[4,8]');assert(JSON.stringify(byteRange('bytes=-3',10))==='[7,9]');
 for(const header of ['bytes=-0','bytes=10-','bytes=9-2','bytes=0-1,3-4','bytes=-']){let failed=false;try{byteRange(header,10);}catch{failed=true;}assert(failed,header);}
 assert(!validId('../secret'));assert(validId('2jsPEOiMNaA'));
});
Deno.test('cache survives restart, evicts oldest audio and never restores partial files',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root,20);await cache.open();
 const a={id:'abcdefghijk',file:crypto.randomUUID()+'.audio',size:12,at:1};await Deno.writeFile(cache.path(a.file),new Uint8Array(12).fill(7));await cache.commit(a,cache.epoch);
 const b={id:'lmnopqrstuv',file:crypto.randomUUID()+'.audio',size:12,at:2};await cache.makeSpace(12);await Deno.writeFile(cache.path(b.file),new Uint8Array(12).fill(9));await cache.commit(b,cache.epoch);
 assert(!await cache.find(a.id));assert(!!await cache.find(b.id));
 const partial=crypto.randomUUID()+'.audio';await Deno.writeFile(cache.path(partial),new Uint8Array(5));
 const fresh=new AudioCache(root,20);await fresh.open();assert(fresh.entries.length===1);assert(!await Deno.stat(cache.path(partial)).then(()=>true).catch(()=>false));
 assert((await readBytes(cache.path(b.file),4,3)).every(n=>n===9));
 const epoch=fresh.epoch;await fresh.clear(new Set([b.file]));await fresh.commit(b,epoch);assert(fresh.entries.length===0);assert((await Deno.stat(cache.path(b.file))).size===12);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('cache ignores path traversal and oversized metadata',async()=>{
 const root=await Deno.makeTempDir();try{await Deno.writeTextFile(root+'/index.json',JSON.stringify([{id:'abcdefghijk',file:'../secret',size:10,at:1}]));const cache=new AudioCache(root);await cache.open();assert(cache.entries.length===0);}finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('eviction protects playing and prepared tracks when the cache is full',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root,30);await cache.open();
 const entries=['abcdefghijk','lmnopqrstuv','0123456789_'].map((id,i)=>({id,file:crypto.randomUUID()+'.audio',size:10,at:i}));
 for(const entry of entries){await Deno.writeFile(cache.path(entry.file),new Uint8Array(10));await cache.commit(entry,cache.epoch);}
 const protectedFiles=new Set(entries.slice(0,2).map(e=>e.file));
 await cache.makeSpace(10,protectedFiles);
 assert(cache.entries.length===2);assert(cache.entries.every(e=>protectedFiles.has(e.file)));
 for(const file of protectedFiles)assert((await Deno.stat(cache.path(file))).size===10);
 let refused=false;try{await cache.makeSpace(20,protectedFiles);}catch{refused=true;}assert(refused);
 assert(cache.entries.length===2);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('cache size preferences are whitelisted, atomic and survive restart',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root);await cache.open();
 for(const limit of CACHE_LIMITS){await cache.setLimit(limit);const restarted=new AudioCache(root);await restarted.open();assert(restarted.limit===limit);}
 for(const limit of [0,-1,200,'1073741824',null,Number.NaN]){let refused=false;try{await cache.setLimit(limit);}catch{refused=true;}assert(refused);}
 assert(cache.limit===CACHE_LIMITS[2]);assert(JSON.parse(await Deno.readTextFile(root+'/config.json')).limit===CACHE_LIMITS[2]);
 assert(!await Deno.stat(root+'/config.tmp').then(()=>true).catch(()=>false));
 await Promise.all([cache.setLimit(CACHE_LIMITS[1]),cache.setLimit(CACHE_LIMIT)]);
 assert(cache.limit===CACHE_LIMIT);assert(JSON.parse(await Deno.readTextFile(root+'/config.json')).limit===CACHE_LIMIT);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('shrinking the cache evicts old audio while reserving active and prepared audio',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root);await cache.open();await cache.setLimit(CACHE_LIMITS[1]);
 const entries=['abcdefghijk','lmnopqrstuv','0123456789_','___________'].map((id,i)=>({id,file:crypto.randomUUID()+'.audio',size:TRACK_LIMIT,at:i}));
 for(const entry of entries){const file=await Deno.open(cache.path(entry.file),{write:true,create:true});await file.truncate(entry.size);file.close();await cache.commit(entry,cache.epoch);}
 await cache.setLimit(CACHE_LIMIT,TRACK_LIMIT,new Set([entries[0].file]));
 assert(cache.entries.length===2);assert(cache.entries.some(e=>e.file===entries[0].file));assert(cache.entries.some(e=>e.file===entries[3].file));
 assert((await Deno.stat(cache.path(entries[0].file))).size===TRACK_LIMIT);
 const restarted=new AudioCache(root);await restarted.open();assert(restarted.entries.length===2);assert(restarted.limit===CACHE_LIMIT);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('an impossible cache size change preserves the previous preference and files',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root);await cache.open();await cache.setLimit(CACHE_LIMITS[1]);
 const entry={id:'abcdefghijk',file:crypto.randomUUID()+'.audio',size:8,at:1};await Deno.writeFile(cache.path(entry.file),new Uint8Array(8));await cache.commit(entry,cache.epoch);
 let refused=false;try{await cache.setLimit(CACHE_LIMIT,CACHE_LIMIT+1);}catch{refused=true;}assert(refused);
 assert(cache.limit===CACHE_LIMITS[1]);assert(cache.entries.length===1);assert((await Deno.stat(cache.path(entry.file))).size===8);
 assert(JSON.parse(await Deno.readTextFile(root+'/config.json')).limit===CACHE_LIMITS[1]);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('cache preference write failure rolls back the in-memory limit',async()=>{
 const root=await Deno.makeTempDir();try{
 const cache=new AudioCache(root);await cache.open();await cache.setLimit(CACHE_LIMITS[1]);await Deno.mkdir(root+'/config.tmp');
 let refused=false;try{await cache.setLimit(CACHE_LIMITS[2]);}catch{refused=true;}assert(refused);assert(cache.limit===CACHE_LIMITS[1]);
 assert(JSON.parse(await Deno.readTextFile(root+'/config.json')).limit===CACHE_LIMITS[1]);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('invalid persisted cache preferences fall back to the bounded default',async()=>{
 const root=await Deno.makeTempDir();try{
 for(const config of ['{"limit":9999999999999}','{"limit":"5368709120"}','not json',' '.repeat(1025)]){
 await Deno.writeTextFile(root+'/config.json',config);const cache=new AudioCache(root);await cache.open();assert(cache.limit===CACHE_LIMIT);
 }
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('larger caches restore more than one thousand completed tracks',async()=>{
 const root=await Deno.makeTempDir();try{
 const entries=[];
 for(let i=0;i<1001;i++){const entry={id:String(i).padStart(11,'0'),file:crypto.randomUUID()+'.audio',size:4,at:i};await Deno.writeFile(root+'/'+entry.file,new Uint8Array(4));entries.push(entry);}
 await Deno.writeTextFile(root+'/index.json',JSON.stringify(entries));await Deno.writeTextFile(root+'/config.json',JSON.stringify({limit:CACHE_LIMITS[2]}));
 const cache=new AudioCache(root);await cache.open();assert(cache.entries.length===entries.length);assert(cache.limit===CACHE_LIMITS[2]);
 }finally{await Deno.remove(root,{recursive:true});}
});
