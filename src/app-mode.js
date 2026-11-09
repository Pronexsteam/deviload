import {t,onLanguageChange} from './i18n.js';

// "Only Devil Music": the app opens straight into music and hides the downloader, Cinema, Cut and
// Convert. It is one setting of the same app, so updates and data stay exactly the same.
export const MODE_KEY='deviload-app-mode';
export function readMode(storage=globalThis.localStorage){try{return storage?.getItem(MODE_KEY)==='music'?'music':'all';}catch{return 'all';}}

export function wireAppMode({navigate,host,isNewcomer=()=>false,storage=globalThis.localStorage}){
  const root=document.documentElement;
  let mode=readMode(storage);
  const save=()=>{try{storage?.setItem(MODE_KEY,mode);}catch{/* Kept for this session. */}};
  function apply(){
    root.classList.toggle('music-only',mode==='music');toggle.input.checked=mode==='music';
    // The general Deviload tour is about the downloader, so a music-only start skips it.
    if(mode==='music'){try{storage?.setItem('deviload-tour-v1','seen');}catch{/* It may show once. */}navigate('music');}
  }

  // The switch in music settings.
  const row=document.createElement('label');row.className='app-mode-toggle';
  const input=document.createElement('input');input.type='checkbox';const text=document.createElement('span'),note=document.createElement('small');
  row.append(input,text,note);const head=host?.querySelector('.music-preferences-head');if(head)head.after(row);else host?.prepend(row);const toggle={input};
  input.addEventListener('change',()=>{mode=input.checked?'music':'all';save();apply();});

  // A newcomer chooses once, on the first start.
  let welcome=null;
  if(isNewcomer()&&!storage?.getItem(MODE_KEY)){
    welcome=document.createElement('dialog');welcome.className='app-mode-welcome';
    welcome.innerHTML='<h2></h2><p></p><div class="app-mode-choices"><button type="button" data-mode="all"><strong></strong><span></span></button><button type="button" data-mode="music"><strong></strong><span></span></button></div>';
    for(const button of welcome.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{mode=button.dataset.mode;save();apply();welcome.close();});
    welcome.addEventListener('cancel',event=>event.preventDefault());
    document.body.append(welcome);
  }
  function labels(){
    text.textContent=t('Show only Devil Music');
    note.textContent=t('Downloads, Cinema, Cut and Convert are hidden. Switch back here at any time.');
    if(!welcome)return;
    welcome.querySelector('h2').textContent=t('How will you use Deviload?');
    welcome.querySelector('p').textContent=t('You can change this later in music settings.');
    const [all,music]=welcome.querySelectorAll('[data-mode]');
    all.querySelector('strong').textContent=t('Everything');all.querySelector('span').textContent=t('Music, downloads, Cinema, Cut and Convert.');
    music.querySelector('strong').textContent=t('Only Devil Music');music.querySelector('span').textContent=t('A music player and nothing else around it.');
  }
  labels();onLanguageChange(labels);apply();
  if(welcome)requestAnimationFrame(()=>welcome.showModal());
  return {get mode(){return mode;}};
}
