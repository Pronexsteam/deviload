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
  const node=tile(t(label),art,()=>onView(view));node.classList.add('music-quick-shortcut');return node;
 };
 const playlist=list=>{
  const art=document.createElement('span');art.className='music-quick-art';art.append(playlistArtwork(list,cover,96));
  const node=tile(list.name,art,()=>onPlaylist(list.id));node.classList.add('music-quick-playlist');return node;
 };
 function render(){
  // Shortcuts repeat the library panel, so they only appear while it is closed;
  // with the panel open, the same space shows more playlists.
  const lists=[...getPlaylists()].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).slice(0,5);
  grid.replaceChildren(hero,...SHORTCUTS.map(shortcut),...lists.map(playlist));
 }
 onLanguageChange(render);render();
 return {render};
}
