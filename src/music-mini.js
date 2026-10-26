import {mountPictureDisc,setPictureDiscArtwork} from "./music-picture-disc.js";
import {t,onLanguageChange} from './i18n.js';
import {paintAmbient,ambientArtwork} from './music-ambient-light.js';
import {registerPlaybackRange,isRangeDragging} from './player-controls.js';
import {wireMiniQueue} from './music-mini-queue.js';
const $=id=>document.getElementById(id),invoke=window.__TAURI__.core.invoke;
const time=n=>`${Math.floor((Number(n)||0)/60)}:${String(Math.floor((Number(n)||0)%60)).padStart(2,'0')}`;
const glyphs={play:'play',pause:'pause',previous:'skip-back',next:'skip-forward',repeat:'repeat',shuffle:'shuffle',volume:'speaker-high',muted:'speaker-high'};
function icon(id,name,one=false){const button=$(id);if(button.dataset.icon===name+one)return;button.dataset.icon=name+one;const glyph=document.createElement('span');glyph.className='mini-glyph';glyph.setAttribute('aria-hidden','true');glyph.style.setProperty('--mini-glyph',`url('./assets/icons/${glyphs[name]}.svg')`);button.replaceChildren(glyph);if(id==='mini-repeat')button.dataset.repeat=one?'one':'all';if(id==='mini-mute')button.dataset.muted=String(name==='muted');}
const record=mountPictureDisc(document.querySelector(".mini-art"));
let state={},pinned=false,receivedAt=0;
const queueView=wireMiniQueue({invoke});
registerPlaybackRange($('mini-progress'),()=>state.duration?Math.min(state.duration,state.position+(state.playing?Math.min(1.1,(performance.now()-receivedAt)/1000):0))/state.duration:0);
$('mini-progress').step='any';
const glow=document.createElement('div');glow.className='mini-ambient-glow';glow.setAttribute('aria-hidden','true');
const lights=Array.from({length:3},()=>{const node=document.createElement('span');glow.append(node);return node;});document.body.prepend(glow);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let lightTimeout=0;
const resetLight=()=>{clearTimeout(lightTimeout);paintAmbient(lights,[0,0,0]);};
reduced.addEventListener('change',resetLight);
function render(value){state=value||{};receivedAt=performance.now();document.documentElement.dataset.theme=['ambient','glass-light','aurora','prism'].includes(state.theme)?state.theme:'ambient';$('mini-title').textContent=state.title||t('Pick your first track');$('mini-artist').textContent=state.artist||'';
 document.documentElement.style.setProperty('--ambient-art',ambientArtwork(state.image));
 if(!state.playing||!['ambient','aurora','prism'].includes(state.theme)||reduced.matches)resetLight();
 document.querySelector('.mini-art').classList.toggle('is-playing',!!state.playing);
 setPictureDiscArtwork(record,state.image,144);
 icon('mini-play',state.playing?'pause':'play');icon('mini-previous','previous');icon('mini-next','next');icon('mini-repeat','repeat',state.repeat==='one');icon('mini-shuffle','shuffle');icon('mini-mute',state.volume>0?'volume':'muted');
 $('mini-play').disabled=!state.active;$('mini-previous').disabled=!state.previousEnabled;$('mini-next').disabled=!state.nextEnabled;
 $('mini-repeat').setAttribute('aria-pressed',String(state.repeat!=='off'));$('mini-shuffle').setAttribute('aria-pressed',String(!!state.shuffle));$('mini-mute').setAttribute('aria-pressed',String(!state.volume));
 $('mini-position').textContent=time(state.position);$('mini-duration').textContent=time(state.duration);if(!isRangeDragging($('mini-progress')))$('mini-progress').value=state.duration?Math.min(1,state.position/state.duration):0;$('mini-progress').disabled=!state.duration;
 if(!isRangeDragging($('mini-volume')))$('mini-volume').value=state.volume||0;labels();queueView.update(state);
}
function labels(){for(const [id,label]of [['mini-pin',t('Always on top')],['mini-show',t('Open Devil Music')],['mini-close',t('Close')],['mini-play',state.playing?t('Pause'):t('Play')],['mini-previous',t('Previous track')],['mini-next',t('Next track')],['mini-repeat',state.repeat==='one'?t('Repeat one song'):state.repeat==='all'?t('Repeat queue'):t('Repeat off')],['mini-shuffle',t('Shuffle')],['mini-mute',state.volume>0?t('Mute'):t('Unmute')],['mini-volume',t('Volume')],['mini-progress',t('Playback position')]])$(id).title=$(id).ariaLabel=label;$('mini-pin').setAttribute('aria-pressed',String(pinned));$('mini-volume').setAttribute('aria-valuetext',Math.round(Number($('mini-volume').value)*100)+'%');}
async function action(action,value){try{const result=await invoke('music_mini_action',{action,value});if(action==='pin')pinned=result;labels();$('mini-status').textContent='';}catch{$('mini-status').textContent=t('Could not control playback.');}}
for(const name of ['pin','show','previous','play','next','repeat','shuffle','mute','close'])$('mini-'+name).addEventListener('click',()=>action(name));
$('mini-volume').addEventListener('input',()=>{labels();action('volume',Number($('mini-volume').value));});
$('mini-volume').addEventListener('wheel',event=>{event.preventDefault();$('mini-volume').value=String(Math.max(0,Math.min(1,Number($('mini-volume').value)+(event.deltaY<0?.03:-.03))));$('mini-volume').dispatchEvent(new Event('input'));},{passive:false});
$('mini-progress').addEventListener('input',()=>action('seek',Number($('mini-progress').value)));
$('mini-drag').addEventListener('mousedown',event=>{if(event.button===0&&!event.target.closest('button'))action('drag');});
await window.__TAURI__.event.listen('music-mini-ambient',({payload})=>{
 if(!['ambient','aurora','prism'].includes(state.theme)||!state.playing||reduced.matches||payload?.image!==(state.image||''))return;
 paintAmbient(lights,payload.levels);clearTimeout(lightTimeout);lightTimeout=setTimeout(resetLight,350);
});
await window.__TAURI__.event.listen('music-mini-state',({payload})=>render(payload));render(await invoke('music_mini_state'));onLanguageChange(()=>render(state));
