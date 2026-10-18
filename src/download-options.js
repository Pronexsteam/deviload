// Portable preferences are separate from exact stream IDs and per-link estimates.
export const validLanguage=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value);
export function languagePreferences(value={}){
  const audioLanguage=value.audioLanguage??'',subtitleLanguages=value.subtitleLanguages??['ru','en'],subtitleAuto=value.subtitleAuto??true;
  if((audioLanguage!==''&&!validLanguage(audioLanguage))||!Array.isArray(subtitleLanguages)||subtitleLanguages.length>12||
      subtitleLanguages.some(code=>!validLanguage(code))||typeof subtitleAuto!=='boolean')throw Error('Invalid language preferences');
  return {audioLanguage,subtitleLanguages:[...new Set(subtitleLanguages)],subtitleAuto};
}
export function inspectionKey(options){
  return JSON.stringify(['quality','profile','container','playlist','formatId','formatHasAudio','audioFormatId','audioLanguage','cookies','cookiesBrowser','cookiesAccount']
    .map(key=>options[key]??null));
}
export function sourceEstimate(info,options,address,key){
  if(!info||info.isList||options.playlist||inspectionKey(options)!==key||!info.sourceSize||!Number.isSafeInteger(info.sourceSize.bytes)||info.sourceSize.bytes<=0)return null;
  const canonical=value=>new URL(/^https?:\/\//i.test(value)?value:`https://${value}`).href;
  try{if(canonical(address)!==canonical(info.sourceSize.url))return null;}catch{return null;}
  return {...info.sourceSize};
}

export function wireDownloadDetails({t,onChange}){
  const audio=document.getElementById('audio-language'),stream=document.getElementById('audio-stream');
  const subtitles=document.getElementById('subtitle-language-list'),automatic=document.getElementById('subtitle-auto'),hint=document.getElementById('download-language-hint');
  let preferences=languagePreferences(),info=null,address='',streamId='';
  function audioLabel(format){return [format.language||t('Language unknown'),format.audioNote,format.audioCodec,format.bitrate?`${Math.round(format.bitrate)} kbps`:''].filter(Boolean).join(' · ');}
  function render(){
    const available=[...new Set((info?.formats||[]).filter(f=>f.hasAudio&&!f.hasVideo).map(f=>f.language).filter(validLanguage))].sort();
    audio.replaceChildren(new Option(t('Best available audio'),''));
    if(preferences.audioLanguage&&!available.includes(preferences.audioLanguage))available.push(preferences.audioLanguage);
    for(const code of available)audio.add(new Option(code,code));audio.value=preferences.audioLanguage;
    stream.replaceChildren(new Option(t('Choose automatically'),''));
    const formats=(info?.formats||[]).filter(f=>f.hasAudio&&!f.hasVideo&&(!preferences.audioLanguage||f.language===preferences.audioLanguage||f.language?.startsWith(preferences.audioLanguage+'-')));
    for(const format of formats)stream.add(new Option(audioLabel(format),format.id));
    const missingStream=!!streamId&&!formats.some(f=>f.id===streamId);
    if(missingStream)stream.add(new Option(t('Stream {id} is unavailable in this preview',{id:streamId}),streamId));
    stream.value=streamId;stream.disabled=(!formats.length&&!streamId)||!!info?.isList;
    automatic.checked=preferences.subtitleAuto;
    const languages=new Map((info?.subtitleLanguages||[]).map(item=>[item.code,item]));
    for(const code of preferences.subtitleLanguages)if(!languages.has(code))languages.set(code,{code,missing:!!info});
    if(!languages.size)for(const code of ['ru','en'])languages.set(code,{code});
    subtitles.replaceChildren();
    for(const item of [...languages.values()].sort((a,b)=>a.code.localeCompare(b.code))){
      const label=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');
      box.type='checkbox';box.checked=preferences.subtitleLanguages.includes(item.code);box.value=item.code;
      const kind=item.missing?t('Not available in this preview'):item.manual&&item.automatic?t('Manual and automatic'):item.manual?t('Manual captions'):item.automatic?t('Automatic captions'):'';
      text.textContent=[item.code,kind].filter(Boolean).join(' · ');
      box.onchange=()=>{const selected=[...subtitles.querySelectorAll('input:checked')].map(input=>input.value);if(selected.length>12){box.checked=false;return;}preferences.subtitleLanguages=selected;onChange();};
      label.append(box,text);subtitles.append(label);
    }
    hint.textContent=missingStream?t('Stream {id} is unavailable in this preview',{id:streamId}):info?.isList?t('Playlist languages vary by item. Exact audio streams apply to one video only.'):
      !info?t('Paste a link to see its audio tracks and subtitle languages.'):
      preferences.audioLanguage&&!formats.length?t('This preview has no audio track in the preferred language. Choose another language before downloading.'):
      !info.subtitleLanguages?.length?t('No subtitle languages were reported for this preview.'):t('Language availability is reported by the source. Automatic captions are marked separately.');
  }
  audio.onchange=()=>{preferences.audioLanguage=audio.value;streamId='';render();onChange();};
  stream.onchange=()=>{streamId=stream.value;onChange();};
  automatic.onchange=()=>{preferences.subtitleAuto=automatic.checked;onChange();};
  render();
  return {
    read:()=>({...languagePreferences(preferences),audioFormatId:streamId}),
    load:value=>{preferences=languagePreferences(value);streamId='';render();},
    update:(next,url)=>{if(address!==url)streamId='';info=next;address=url;render();},
    clearLink:()=>{info=null;address='';streamId='';render();},
    clearStream:()=>{streamId='';render();},translate:render,
    selectStream:format=>{preferences.audioLanguage=format.language||'';streamId=format.id;render();},
  };
}
