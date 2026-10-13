import {t,language,errorText} from './i18n.js';
import {sanitizeMusicCollection} from './music-profile.js';
export function openArtistPicker({invoke,button,cover,collections,save}){
 const modal=document.createElement('dialog');modal.className='music-library-dialog';modal.setAttribute('aria-label',t('Choose favorite artists'));
 const heading=document.createElement('h3');heading.textContent=t('Choose favorite artists');
 const note=document.createElement('p');note.textContent=t('Pick a few artists to shape your first recommendations. You can change them in your library.');
 const form=document.createElement('form'),input=document.createElement('input');input.type='search';input.required=true;input.maxLength=120;input.placeholder=t('Search artists');input.setAttribute('aria-label',t('Search artists'));
 const search=document.createElement('button');search.type='submit';search.textContent=t('Search');form.append(input,search);
 const results=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');const selected=new Map();let request=0;
 const finish=button(t('Save selection'),null,()=>{try{save([...selected.values()]);modal.close();}catch(error){status.textContent=errorText(error);}},'music-primary');finish.disabled=true;
 const previous=document.activeElement;modal.append(heading,note,form,results,status,finish,button(t('Close'),null,()=>modal.close(),'quiet small'));document.body.append(modal);modal.showModal();input.focus();
 modal.addEventListener('close',()=>{request++;modal.remove();if(previous?.isConnected)previous.focus();});
 form.addEventListener('submit',async event=>{event.preventDefault();const value=input.value.trim();if(!value)return;const token=++request;search.disabled=true;status.textContent=t('Searching artists…');results.replaceChildren();try{
  const data=await invoke('music_catalog',{kind:'search',value,filter:'artists',language:language()});if(token!==request)return;
  const seen=new Set();const artists=data.sections.flatMap(x=>x.items).filter(x=>x.kind==='artist'&&!seen.has(x.id)&&seen.add(x.id)).slice(0,20);
  for(const item of artists){const row=document.createElement('label');row.className='music-artist-choice';const box=document.createElement('input');box.type='checkbox';box.checked=selected.has(item.id)||collections().some(x=>x.id===item.id);box.disabled=collections().some(x=>x.id===item.id);const name=document.createElement('span');name.textContent=item.title;row.append(box,cover(item),name);box.addEventListener('change',()=>{const normalized=sanitizeMusicCollection(item);if(box.checked&&normalized)selected.set(item.id,normalized);else selected.delete(item.id);finish.disabled=!selected.size;status.textContent=t('{count} artists selected',{count:selected.size});});results.append(row);}
  status.textContent=artists.length?t('{count} artists selected',{count:selected.size}):t('No artists found');
 }catch(error){if(token===request)status.textContent=errorText(error);}finally{if(token===request)search.disabled=false;}});
}
