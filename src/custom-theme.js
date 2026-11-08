import {t,onLanguageChange} from './i18n.js';
import {markDecorative} from './music-motion.js';

import {readCustom,saveCustom,normalizeCustom,customVariables} from './custom-theme-model.js';
export {normalizeCustom,customVariables} from './custom-theme-model.js';

// The background layer, the settings dialog and the theme menu's Customize button.
export function wireCustomTheme({invoke,convertFileSrc,applyTheme,document=globalThis.document,storage=globalThis.localStorage}){
  if(!document?.body)return null;
  const root=document.documentElement;
  let settings=readCustom(storage);
  const layer=document.createElement('div');layer.id='custom-backdrop';layer.setAttribute('aria-hidden','true');
  document.body.prepend(layer);
  let shown='';
  const isCustom=()=>root.dataset.variant==='custom';
  function paintVariables(){for(const [name,value] of Object.entries(customVariables(settings)))if(value===null)root.style.removeProperty(name);else root.style.setProperty(name,value);}
  // Only the active theme keeps its media loaded; a video also rests while the window is hidden.
  function paintMedia(){
    const want=isCustom()&&settings.background?`${settings.background.kind}:${settings.background.path}`:'';
    if(want!==shown){
      shown=want;layer.replaceChildren();
      if(want){
        // A background video is decoration: the music neither pauses it nor stops for it.
        const node=settings.background.kind==='video'?markDecorative(document.createElement('video')):document.createElement('img');
        node.src=convertFileSrc?convertFileSrc(settings.background.path):settings.background.path;
        if(node.tagName==='VIDEO'){node.muted=true;node.defaultMuted=true;node.volume=0;node.loop=true;node.playsInline=true;node.autoplay=true;node.setAttribute('disablepictureinpicture','');node.setAttribute('muted','');node.addEventListener('volumechange',()=>{if(!node.muted||node.volume>0){node.muted=true;node.volume=0;}});}
        else node.alt='';
        node.addEventListener('error',()=>{if(shown===want){settings={...settings,background:null};saveCustom(storage,settings);paint();}},{once:true});
        layer.append(node);
      }
    }
    const video=layer.querySelector('video');
    if(video){if(document.hidden||!isCustom())video.pause();else video.play().catch(()=>{});}
  }
  function paint(){paintVariables();paintMedia();sync();}
  function update(next){settings=normalizeCustom({...settings,...next});saveCustom(storage,settings);paint();}

  // Settings dialog.
  const dialog=document.createElement('dialog');dialog.className='custom-theme-dialog';dialog.setAttribute('aria-labelledby','custom-theme-title');
  dialog.innerHTML=`<form method="dialog" class="custom-theme-form">
    <h2 id="custom-theme-title"></h2>
    <div class="custom-theme-preview" data-preview></div>
    <div class="custom-theme-row"><button type="button" class="custom-theme-choose" data-choose></button><button type="button" class="custom-theme-remove" data-remove></button></div>
    <p class="custom-theme-hint" data-hint></p>
    <label class="custom-theme-range"><span data-label="blur"></span><input type="range" min="0" max="60" step="1" data-setting="blur"><output data-out="blur"></output></label>
    <label class="custom-theme-range"><span data-label="dim"></span><input type="range" min="0" max="85" step="1" data-setting="dim"><output data-out="dim"></output></label>
    <label class="custom-theme-range"><span data-label="panels"></span><input type="range" min="15" max="100" step="1" data-setting="panels"><output data-out="panels"></output></label>
    <label class="custom-theme-range"><span data-label="ambient"></span><input type="range" min="0" max="100" step="1" data-setting="ambient"><output data-out="ambient"></output></label>
    <div class="custom-theme-row custom-theme-accent"><label class="custom-theme-check"><input type="checkbox" data-cover><span data-label="cover"></span></label><input type="color" data-accent></div>
    <p class="custom-theme-status" role="status" data-status></p>
    <div class="custom-theme-actions"><button type="button" class="custom-theme-reset" data-reset></button><button type="submit" class="custom-theme-done" data-done></button></div>
  </form>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  const status=text=>{$('[data-status]').textContent=text||'';};
  function labels(){
    $('#custom-theme-title').textContent=t('Your own theme');
    $('[data-choose]').textContent=settings.background?t('Change background'):t('Choose photo, GIF or video');
    $('[data-remove]').textContent=t('Remove background');
    $('[data-hint]').textContent=t('PNG, JPEG, WebP, GIF, MP4 or WebM up to 300 MB, about 2 to 5 minutes of Full HD video. Videos loop without sound; a short loop of 10 to 60 seconds looks best.');
    $('[data-label="blur"]').textContent=t('Blur');$('[data-label="dim"]').textContent=t('Darken');$('[data-label="ambient"]').textContent=t('Ambient light');$('[data-label="panels"]').textContent=t('Panels');
    $('[data-label="cover"]').textContent=t('Accent from the cover');
    $('[data-reset]').textContent=t('Reset');$('[data-done]').textContent=t('Done');
    $('[data-accent]').setAttribute('aria-label',t('Accent colour'));
    customize.textContent=t('Customize…');
  }
  function sync(){
    for(const name of ['blur','dim','panels','ambient']){$(`[data-setting="${name}"]`).value=String(settings[name]);$(`[data-out="${name}"]`).textContent=name==='blur'?`${settings[name]} px`:`${settings[name]}%`;}
    $('[data-cover]').checked=!settings.accent;$('[data-accent]').value=settings.accent||'#9ad0ff';$('[data-accent]').disabled=!settings.accent;
    $('[data-remove]').hidden=!settings.background;
    $('[data-preview]').textContent=settings.background?(settings.background.kind==='video'?t('Video background'):t('Picture background')):t('No background chosen');
    labels();
  }
  for(const input of dialog.querySelectorAll('[data-setting]'))input.addEventListener('input',()=>update({[input.dataset.setting]:input.value}));
  $('[data-cover]').addEventListener('change',event=>update({accent:event.target.checked?'':($('[data-accent]').value||'#9ad0ff')}));
  $('[data-accent]').addEventListener('input',event=>{if(!$('[data-cover]').checked)update({accent:event.target.value});});
  $('[data-choose]').addEventListener('click',async()=>{
    status(t('Saving the background…'));
    try{const background=await invoke('custom_background_choose');status('');if(background)update({background});}
    catch(error){status(String(error?.message||error||t('Could not save the background.')));}
  });
  $('[data-remove]').addEventListener('click',()=>{invoke('custom_background_clear').catch(()=>{});update({background:null});});
  $('[data-reset]').addEventListener('click',()=>{const background=settings.background;settings=normalizeCustom({background});saveCustom(storage,settings);paint();});

  // The theme menu gets a Customize button under "Your own"; it also switches to that theme.
  const customize=document.createElement('button');customize.type='button';customize.className='quick-theme-customize';customize.setAttribute('aria-haspopup','dialog');
  const custom=document.querySelector('[data-theme-choice="custom"]');
  custom?.after(customize);
  customize.addEventListener('click',()=>{document.getElementById('quick-theme-menu')?.hidePopover?.();if(!isCustom())applyTheme?.('custom',{persist:true});sync();if(!dialog.open)dialog.showModal();});

  document.addEventListener('deviload-theme-change',paint);
  document.addEventListener('visibilitychange',paintMedia);
  onLanguageChange(labels);
  // A saved file must be allowed again after a restart; a missing one is forgotten.
  if(settings.background)invoke('custom_background_allow',{path:settings.background.path}).then(found=>{settings={...settings,background:found||null};saveCustom(storage,settings);paint();}).catch(()=>paint());
  else paint();
  return {open:()=>customize.click(),get settings(){return settings;}};
}
