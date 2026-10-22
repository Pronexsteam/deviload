import {t,errorText,onLanguageChange} from './i18n.js';

// Independent request options: a gallery cannot inherit a video clip or stream.
export function galleryOptions(settings,{preview=null,selected=[]}={}) {
  const mode=settings.cookiesMode;
  return {folder:settings.folder,quality:'best',profile:'',container:'mp4',playlist:false,playlistItems:'',
    splitChapters:false,subtitles:false,sponsorblock:false,archive:false,
    cookies:mode==='file'?settings.cookies||'':mode==='account'?settings.signedInPath||'':'',cookiesAccount:mode==='account',
    cookiesBrowser:['chrome','edge','firefox','brave','safari'].includes(mode)?mode:'',rateMbps:settings.rateMbps||0,
    clipStart:null,clipEnd:null,clipFormat:'source',folderRule:'manual',nameRule:'title',formatId:'',audioFormatId:'',audioLanguage:'',
    downloadEngine:preview?'gallery-dl':'',galleryItems:preview?[...selected].sort((a,b)=>a-b):[],galleryFingerprint:preview?.fingerprint||''};
}

export function wireGalleryDownloads({button,invoke,getSettings,onQueued,onMessage}) {
  if(!button)return;
  const el=(tag,cls='')=>{const n=document.createElement(tag);n.className=cls;return n;};
  const dialog=el('dialog','gallery-dialog'),head=el('div','gallery-heading'),heading=el('h2'),close=el('button','outline');
  close.type='button';head.append(heading,close);
  const intro=el('p'),label=el('label'),input=el('input');input.type='url';input.maxLength=8192;input.id='gallery-source';
  label.htmlFor=input.id;
  const sourceRow=el('div','gallery-source-row'),read=el('button','outline'),install=el('button','outline');
  read.type=install.type='button';sourceRow.append(input,read);
  const engine=el('div','gallery-engine'),engineText=el('span');engine.append(engineText,install);
  const status=el('p','gallery-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const tools=el('div','gallery-tools'),all=el('button','outline small'),none=el('button','outline small'),count=el('span');
  all.type=none.type='button';tools.append(all,none,count);
  const list=el('div','gallery-items'),folder=el('p','gallery-folder'),footer=el('div','gallery-footer'),download=el('button','primary');
  download.type='button';footer.append(download);
  dialog.append(head,intro,label,sourceRow,engine,status,tools,list,folder,footer);document.body.append(dialog);
  let preview=null,selected=new Set(),generation=0,busy=false,available=false,installSupported=false,engineVersion='';
  let feedback='',failed=false;
  const say=(text,error=false)=>{feedback=text;failed=error;status.textContent=text;status.classList.toggle('error',error);};
  function controls(){read.disabled=busy||!available||!input.value.trim();install.disabled=busy;download.disabled=busy||!preview||!selected.size||preview.truncated;
    input.disabled=busy;all.disabled=none.disabled=busy||!preview;list.querySelectorAll('input').forEach(n=>n.disabled=busy);
    count.textContent=t('Selected: {count}',{count:selected.size});tools.hidden=!preview;}
  function translated(){heading.textContent=t('Photos and galleries');intro.textContent=t('Read a post or album, then choose the files to download. Videos keep using yt-dlp.');
    label.textContent=t('Post or album link');input.placeholder='https://';close.textContent=t('Close');close.setAttribute('aria-label',t('Close'));
    read.textContent=t('Read gallery');install.textContent=t('Install gallery engine');all.textContent=t('Select all');none.textContent=t('Clear selection');
    download.textContent=t('Download selected files');engineText.textContent=available?t('Gallery engine ready · {version}',{version:engineVersion}):installSupported?t('Optional engine · about 23 MB, downloaded once'):t('Install gallery-dl in PATH to use galleries on this platform.');
    install.hidden=available||!installSupported;folder.textContent=t('Save to: {folder}',{folder:getSettings().folder});controls();}
  function clear(){preview=null;selected.clear();list.replaceChildren();say('');controls();}
  function renderItems(){list.replaceChildren();for(const item of preview?.items||[]){
    const row=el('label','gallery-item'),check=el('input'),text=el('span'),name=el('strong'),details=el('small');check.type='checkbox';check.checked=selected.has(item.index);check.value=String(item.index);
    name.textContent=item.title;details.textContent=[String(item.index).padStart(2,'0'),item.extension.toUpperCase(),item.bytes?`${(item.bytes/1048576).toFixed(1)} MB`:''].filter(Boolean).join(' · ');
    text.append(name,details);row.append(check,text);check.addEventListener('change',()=>{if(check.checked)selected.add(item.index);else selected.delete(item.index);controls();});list.append(row);
  }controls();}
  async function perform(fn){if(busy)return;busy=true;controls();const token=++generation;
    try{await fn(token);}catch(error){if(token===generation&&dialog.open)say(errorText(error),true);}
    finally{busy=false;controls();}}
  button.addEventListener('click',async()=>{
    if(!invoke){onMessage?.(t('Open the installed Deviload app to download.'),true);return;}
    if(!dialog.open)dialog.showModal();input.value=document.getElementById('urls')?.value.trim().split(/\s+/)[0]||input.value;
    clear();translated();input.focus();
    await perform(async token=>{const info=await invoke('gallery_info');if(token!==generation||!dialog.open)return;available=info.available;installSupported=info.installationSupported;engineVersion=info.version;translated();});
  });
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{generation++;clear();});
  input.addEventListener('input',()=>{generation++;clear();});
  read.addEventListener('click',()=>perform(async token=>{
    clear();say(t('Reading gallery…'));const source=input.value.trim();
    const result=await invoke('gallery_inspect',{source,options:galleryOptions(getSettings())});
    if(token!==generation||!dialog.open)return;
    preview=result;selected=new Set(result.items.map(item=>item.index));renderItems();
    say(result.truncated?t('This gallery has more than 200 items. Use a smaller album or direct post link.'):t('Found files: {count}',{count:result.items.length}),result.truncated);
  }));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&!read.disabled){event.preventDefault();read.click();}});
  install.addEventListener('click',()=>perform(async token=>{
    say(t('Installing gallery engine…'));const info=await invoke('gallery_install');if(token!==generation||!dialog.open)return;
    available=info.available;installSupported=info.installationSupported;engineVersion=info.version;translated();say(available?t('Gallery engine installed.'):t('The downloaded gallery engine could not start.'),!available);
  }));
  all.addEventListener('click',()=>{selected=new Set(preview.items.map(item=>item.index));renderItems();});none.addEventListener('click',()=>{selected.clear();renderItems();});
  download.addEventListener('click',()=>perform(async token=>{
    const source=preview.source,settings=getSettings(),options=galleryOptions(settings,{preview,selected});
    const report=await invoke('preflight_download',{text:source,options,estimatedBytes:null});
    if(token!==generation||!dialog.open)return;
    if(!report.ready)throw Error(report.blockers.join('\n'));
    const added=await invoke('enqueue',{text:source,options,parallel:settings.parallel||2,scheduledAt:null,autoRetry:true,liveLimit:0,repeatDaily:false,preserveOptions:true});
    // Enqueue is an accepted mutation even when the dialog was closed meanwhile.
    onQueued?.();if(token!==generation||!dialog.open)return;
    if(added){onMessage?.(t('Tasks added: {count}',{count:added}));dialog.close();}else say(t('These links are already in the queue.'));
  }));
  onLanguageChange(()=>{translated();if(feedback)status.textContent=feedback;status.classList.toggle('error',failed);});translated();
}
