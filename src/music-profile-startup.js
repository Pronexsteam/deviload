import {openMusicProfileStore} from './music-profile-store.js';
import {t,onLanguageChange} from './i18n.js';

export function initializeMusic({createMusic,...options}){
  let music=null,storage=null,wantsOpen=false,starting=true,state={pending:0,error:null};
  const banner=document.createElement('div'),label=document.createElement('span'),retry=document.createElement('button');
  banner.className='music-status';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
  retry.type='button';retry.className='outline small';banner.append(label,retry);
  document.getElementById('music-status').before(banner);
  function render(){
    banner.hidden=!starting&&!state.error;
    banner.classList.toggle('error',!!state.error);
    label.textContent=starting?t('Opening your music library…'):state.error
      ?(storage?t('Music changes are not saved yet. Free some disk space and retry before closing.'):t('Music library storage is unavailable. Your saved data has not been replaced.'))
      :'';
    retry.textContent=t('Retry');retry.hidden=!state.error;retry.disabled=starting||state.pending>0;
  }
  async function start(){
    starting=true;state.error=null;render();
    try{
      storage=await openMusicProfileStore({onState:value=>{state=value;render();}});
      music=createMusic({...options,storage});
      if(wantsOpen)music.open();
    }catch(error){state.error=error;}
    finally{starting=false;render();}
  }
  retry.addEventListener('click',()=>{if(storage)storage.retry().catch(()=>{});else start();});
  // Don't discard an in-flight import through a normal browser/window navigation.
  window.addEventListener('beforeunload',event=>{if(storage&&(storage.pending||storage.error)){event.preventDefault();event.returnValue='';}});
  onLanguageChange(render);start();
  return {open(){wantsOpen=true;music?.open();}};
}
