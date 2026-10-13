import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
const root=resolve(import.meta.dirname,'..'),cwd=resolve(root,'engines/music'),out=resolve(root,'src-tauri/music-engine');
const deno=process.env.DENO_BIN||resolve(root,'bin',process.platform==='win32'?'deno.exe':'deno');
const version=Number(process.env.MUSIC_ENGINE_VERSION||1);if(!Number.isSafeInteger(version)||version<1)throw Error('Invalid music engine version');
await mkdir(out,{recursive:true});
for(const [source,name,format]of [['engine.ts','engine.mjs','esm'],['po-worker.ts','po-worker.ts','esm'],['node_modules/.deno/jsdom@24.1.3/node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js','xhr-sync-worker.js','cjs']]){
 const result=spawnSync(deno,['bundle','--frozen','--minify','--keep-names','--format',format,source,'-o',resolve(out,name)],{cwd,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);
}
const po=resolve(out,'po-worker.ts');await writeFile(po,"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);\n"+await readFile(po,'utf8'));
const files={};for(const name of ['engine.mjs','po-worker.ts','xhr-sync-worker.js'])files[name]=(await readFile(resolve(out,name),'utf8'));
// The signed payload is compressed; the verifier bounds both compressed and expanded sizes.
await writeFile(resolve(out,'payload.json.gz'),gzipSync(JSON.stringify({version,protocol:1,files}),{level:9}));
const licenses=[];
for(const folder of await readdir(resolve(cwd,'node_modules/.deno'))){
 if(folder==='node_modules')continue;
 const modules=resolve(cwd,'node_modules/.deno',folder,'node_modules');
 async function visit(base){for(const name of await readdir(base).catch(()=>[])){
   if(name.startsWith('@')){await visit(resolve(base,name));continue;}
   const dir=resolve(base,name);let pkg;try{pkg=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));}catch{continue;}
   if(licenses.some(l=>l.name===pkg.name&&l.version===pkg.version))continue;
   const names=(await readdir(dir)).filter(n=>/^(licen[cs]e|notice)(?:[-.]|$)/i.test(n));
   let text=(await Promise.all(names.map(async name=>name+'\n'+await readFile(resolve(dir,name),'utf8')))).join('\n\n');
   if(!text)text=await readFile(resolve(cwd,'licenses',pkg.name.replaceAll('/','-')+'-'+pkg.version+'.txt'),'utf8');
   licenses.push({name:pkg.name,version:pkg.version,license:pkg.license,text});
 }}await visit(modules);
}
await writeFile(resolve(root,'LICENSES/music-engine.json'),JSON.stringify(licenses,null,2)+'\n');
console.log('Music engine bundled. Nothing published.');
