import {readdirSync} from "node:fs";
import {join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const root=fileURLToPath(new URL("../",import.meta.url));
function sources(folder){
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=join(folder,entry.name);
    return entry.isDirectory()?sources(path):entry.isFile()&&entry.name.endsWith(".js")?[path]:[];
  });
}
const files=sources(join(root,"src")).sort();
for(const file of files){
  const result=spawnSync(process.execPath,["--check",file],{stdio:"inherit",windowsHide:true});
  if(result.error){console.error(relative(root,file)+": "+result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`Syntax checked ${files.length} frontend files.`);
