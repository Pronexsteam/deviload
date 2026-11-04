import {t,errorText,onLanguageChange} from './i18n.js';
import {readLocalLibrary} from './music-local-model.js';

export function createLocalLibrary({invoke,button,onChange}){
  const dialog=document.createElement('dialog');dialog.className='music-settings-dialog music-local-library';
  const title=document.createElement('h2'),help=document.createElement('p'),status=document.createElement('p'),actions=document.createElement('div');status.role='status';
  let pending=null,timer=null,latest={items:[],scanning:false,scanned:0,failed:0},choosing=false,actionError='';
  const choose=async folders=>{if(choosing||latest.scanning)return;choosing=true;actionError='';render();try{await invoke('music_local_choose',{folders});await load();}catch(e){actionError=errorText(e);}finally{choosing=false;render();}};
  const files=button('',null,()=>choose(false),'outline small'),folders=button('',null,()=>choose(true),'outline small');
  const scan=button('',null,async()=>{try{await invoke('music_local_scan',{cancel:false});await load();}catch(e){status.textContent=errorText(e);}},'outline small');
  const cancel=button('',null,async()=>{try{await invoke('music_local_scan',{cancel:true});await load();}catch(e){status.textContent=errorText(e);}},'outline small');
  const close=button('',null,()=>dialog.close(),'outline small');actions.className='music-preset-editor';actions.append(files,folders,scan,cancel);dialog.append(title,help,actions,status,close);document.body.append(dialog);
  function render(){title.textContent=t('Music on this device');help.textContent=t('Add audio files or folders. Files stay in place. After moving files, add their new folder and scan again.');
    for(const [control,label]of [[files,t('Add audio files')],[folders,t('Add music folder')],[scan,t('Scan again')],[cancel,t('Stop scan')],[close,t('Close')]])control.textContent=control.ariaLabel=label;
    files.disabled=folders.disabled=scan.disabled=choosing||latest.scanning;cancel.hidden=!latest.scanning;
    status.textContent=actionError|| (latest.error?errorText(latest.error):t(latest.scanning?'Scanning: {scanned}. Available: {count}. Skipped: {failed}.':'Available: {count}. Skipped: {failed}.',{scanned:latest.scanned||0,count:latest.items.length,failed:latest.failed||0}));
  }
  function load(){if(pending)return pending;clearTimeout(timer);
    pending=readLocalLibrary(invoke).then(packet=>{latest=packet;render();onChange(packet.items);if(packet.scanning)timer=setTimeout(()=>load().catch(e=>status.textContent=errorText(e)),2000);return packet.items;}).finally(()=>pending=null);return pending;
  }
  render();onLanguageChange(render);return {load,open(){render();if(!dialog.open)dialog.showModal();load().catch(e=>status.textContent=errorText(e));}};
}
