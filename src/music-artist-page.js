import {t,language,errorText} from './i18n.js';

import {artistPageCandidates,exactArtist} from './music-artist-model.js';

// Tracks currently carry artist names, not stable artist browse IDs. Resolve a
// unique exact name; show choices instead of silently opening a different artist.
export function openArtistPage({item,invoke,button,cover,onOpen}){
 const names=[...new Set((item?.artists||[]).filter(name=>typeof name==='string'&&name.trim()).map(name=>name.trim()))];
 if(!names.length)return;
 const modal=document.createElement('dialog');modal.className='music-library-dialog music-artist-page';modal.setAttribute('aria-label',t('Artists'));
 const heading=document.createElement('h3');heading.textContent=t('Artists');
 const results=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 let request=0;const previous=document.activeElement;
 const open=artist=>{modal.close();onOpen(artist);};
 async function search(name){
  const token=++request;heading.textContent=name;results.replaceChildren();status.textContent=t('Searching artists…');
  try{
   const data=await invoke('music_catalog',{kind:'search',value:name,filter:'artists',language:language()});if(token!==request||!modal.open)return;
   const artists=artistPageCandidates(data),exact=exactArtist(artists,name);
   if(exact){open(exact);return;}
   for(const artist of artists){const row=button(artist.title,null,()=>open(artist),'music-artist-page-choice');const label=document.createElement('span');label.textContent=artist.title;row.replaceChildren(cover(artist,'',96),label);results.append(row);}
   status.textContent=artists.length?'':t('No artists found');
  }catch(error){if(token!==request||!modal.open)return;status.textContent=errorText(error);results.append(button(t('Search'),null,()=>search(name),'music-filter-chip'));}
 }
 modal.append(heading,results,status,button(t('Close'),null,()=>modal.close(),'quiet small'));document.body.append(modal);
 modal.addEventListener('close',()=>{++request;modal.remove();if(previous?.isConnected)previous.focus();});modal.showModal();
 if(names.length===1)search(names[0]);else for(const name of names)results.append(button(name,null,()=>search(name),'music-artist-page-choice'));
}
