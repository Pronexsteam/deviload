// Tauri's cached AppRun is created with mode 0770. linuxdeploy preserves that
// mode as AppRun.wrapped, but SquashFS assigns it to root:root. A different
// user then cannot launch the mounted image. Set 0755 before bundling/signing.
import {chmod,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';

if(process.platform==='linux'){
  const arch=process.env.TAURI_ENV_ARCH||process.arch;
  if(!['x64','x86_64'].includes(arch))throw Error('The AppImage launcher is pinned for Linux x86_64 only.');
  const configured=process.env.XDG_CACHE_HOME;
  const cache=join(configured&&isAbsolute(configured)?configured:join(homedir(),'.cache'),'tauri');
  const path=join(cache,'AppRun-x86_64');
  const digest='f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f';
  const valid=bytes=>createHash('sha256').update(bytes).digest('hex')===digest;
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes||!valid(bytes)){
    const response=await fetch('https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64',{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Could not download the AppImage launcher: '+response.status);
    bytes=Buffer.from(await response.arrayBuffer());
    if(!valid(bytes))throw Error('AppImage launcher checksum mismatch.');
    await mkdir(cache,{recursive:true});
    const temporary=path+'.'+process.pid+'.tmp';
    await writeFile(temporary,bytes,{mode:0o755});await rename(temporary,path);
  }
  await chmod(path,0o755);
  console.log('Verified AppImage launcher; executable permissions set to 0755 before packaging.');
}
