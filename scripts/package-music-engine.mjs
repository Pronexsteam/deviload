// Produces a signed update envelope locally. It never uploads or publishes.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),payload=resolve(root,'src-tauri/music-engine/payload.json.gz');
if(!process.env.TAURI_SIGNING_PRIVATE_KEY)throw Error('TAURI_SIGNING_PRIVATE_KEY is required');
const result=spawnSync(process.execPath,[resolve(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign',payload],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status||1);
const bytes=await readFile(payload),signature=(await readFile(payload+'.sig','utf8')).trim();
await mkdir(resolve(root,'dist'),{recursive:true});
await writeFile(resolve(root,'dist/music-engine.json'),JSON.stringify({payload:bytes.toString('base64'),signature})+'\n');
console.log('Signed music engine update written to dist/music-engine.json. Nothing published.');
