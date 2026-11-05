import {t,onLanguageChange} from './i18n.js';
import {playlistArtwork} from './music-playlist-art.js';

const SHORTCUTS=[['favorites','Favorites','heart'],['recent','History','clock'],['offline','Downloaded music','download-simple']];

export function createMusicHomeTiles({hero,button,cover,getPlaylists,onView,onPlaylist}){
 const grid=document.createElement('div');grid.className='music-quick-grid';hero.before(grid);grid.append(hero);
 const tile=(label,art,action)=>{
  const node=button(label,null,action,'music-quick-tile'),name=document.createElement('strong');
  name.textContent=label;node.replaceChildren(art,name);return node;
 };
 const shortcut=([view,label,glyph])=>{
  const art=document.createElement('span'),icon=document.createElement('span');
  art.className='music-quick-art';art.dataset.tile=view;icon.className='icon';icon.dataset.icon=glyph;icon.setAttribute('aria-hidden','true');art.append(icon);
  return tile(t(label),art,()=>onView(view));
 };
 const playlist=list=>{
  const art=document.createElement('span');art.className='music-quick-art';art.append(playlistArtwork(list,cover,96));
  return tile(list.name,art,()=>onPlaylist(list.id));
 };
 function render(){
  const lists=[...getPlaylists()].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).slice(0,2);
  grid.replaceChildren(hero,...SHORTCUTS.map(shortcut),...lists.map(playlist));
 }
 onLanguageChange(render);render();
 return {render};
}
