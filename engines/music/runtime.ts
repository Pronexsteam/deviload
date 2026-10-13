import { Platform, Log } from 'youtubei.js';
Log.setLevel(Log.Level.NONE);
export { safe } from './errors.ts';
Platform.shim.eval = async (data: any) => {
  const code = `self.onmessage=async e=>{try{self.postMessage({ok:true,value:await new Function(e.data)()})}catch(x){self.postMessage({ok:false,error:String(x)})}}`;
  const worker = new Worker('data:application/javascript,' + encodeURIComponent(code), {
    type: 'module', deno: { permissions: 'none' }
  } as any);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Interpreter timeout')), 4000);
      worker.onmessage = e => { clearTimeout(timer); e.data.ok ? resolve(e.data.value) : reject(Error(e.data.error)); };
      worker.onerror = () => { clearTimeout(timer); reject(Error('Interpreter worker failed')); };
      worker.postMessage(data.output);
    });
  } finally { worker.terminate(); }
};
