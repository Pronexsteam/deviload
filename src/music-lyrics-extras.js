import {t,onLanguageChange} from './i18n.js';
import {romanize,lyricsExtrasFor,translatable} from './music-romanize.js';

const PREFS='deviload-lyrics-extras-v1',CACHE='deviload-lyrics-translations-v2',OLD_CACHE='deviload-lyrics-translations-v1',LIMIT=2000;

function readCache(storage){
  try{storage.removeItem(OLD_CACHE);}catch{}
  try{const rows=JSON.parse(storage.getItem(CACHE)||'[]');return Array.isArray(rows)?rows.filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&typeof row[1]==='string').slice(-LIMIT):[];}catch{return [];}
}

// Translations are cached per line, so plain and word-timed versions of one song share them.
export function lyricsExtras({invoke,button,toolbar,storage,language,isPrivate=()=>false,onNote=()=>{}}){
  let prefs={romanize:false,translate:false};
  try{const saved=JSON.parse(storage.getItem(PREFS)||'{}');prefs={romanize:saved.romanize===true,translate:saved.translate===true};}catch{}
  let body=null,lines=[],info={source:'',romanize:false,translate:false},serial=0,queue=Promise.resolve();
  const cache=new Map(readCache(storage));
  const keyFor=text=>`${info.source}>${language()}:${text}`;
  const roman=button(t('Romanization'),'text-aa',()=>{prefs.romanize=!prefs.romanize;save();paint();});
  const translate=button(t('Translate lyrics'),'translate',()=>{prefs.translate=!prefs.translate;save();if(prefs.translate)load();else{onNote('');paint();}});
  for(const node of [roman,translate]){node.hidden=true;node.classList.add('music-lyrics-extra-toggle');}
  toolbar.append(roman,translate);
  function save(){try{storage.setItem(PREFS,JSON.stringify(prefs));}catch{}sync();}
  function sync(){
    roman.hidden=!info.romanize;translate.hidden=!info.translate;
    roman.setAttribute('aria-pressed',String(prefs.romanize));translate.setAttribute('aria-pressed',String(prefs.translate));
    roman.title=roman.ariaLabel=t('Romanization');translate.title=translate.ariaLabel=t('Translate lyrics');
  }
  function paint(){
    if(!body)return;
    for(const [index,line] of lines.entries()){
      const row=body.children[index];if(!row)continue;
      row.querySelectorAll(':scope>.music-lyric-extra').forEach(node=>node.remove());
      const add=(text,kind)=>{if(!text||text===line.text)return;const span=document.createElement('span');span.className='music-lyric-extra '+kind;span.textContent=text;row.append(span);};
      if(prefs.romanize&&info.romanize)add(romanize(line.text),'is-roman');
      if(prefs.translate&&info.translate)add(cache.get(keyFor((line.text||'').trim())),'is-translation');
    }
  }
  function remember(){
    while(cache.size>LIMIT)cache.delete(cache.keys().next().value);
    if(!isPrivate())try{storage.setItem(CACHE,JSON.stringify([...cache]));}catch{}
  }
  // Requests run one after another: a second version of the lyrics waits for the
  // first answer and then asks only for the lines that are still missing.
  function load(){
    const token=++serial;
    const run=async()=>{
      if(token!==serial||!info.translate||!body)return;
      const source=info.source,target=language(),missing=translatable(lines).filter(text=>!cache.has(keyFor(text)));
      if(!missing.length){onNote(t('Translation: MyMemory'));paint();return;}
      onNote(t('Translating…'));
      try{
        const result=await invoke('music_translate_lyrics',{lines:missing,source,target});
        missing.forEach((text,i)=>{const value=typeof result?.[i]==='string'?result[i].trim():'';if(value)cache.set(`${source}>${target}:${text}`,value);});
        remember();
        if(token===serial){onNote(t('Translation: MyMemory'));paint();}
      }catch(error){
        if(token===serial)onNote(String(error?.message||error).includes('limit')?t('The free translation limit for today is used up.'):t('Translation is unavailable right now.'));
      }
    };
    queue=queue.then(run,run);
  }
  onLanguageChange(()=>{sync();if(body){info=lyricsExtrasFor(lines,language());sync();paint();if(prefs.translate)load();}});
  return {
    attach(next,nextLines){
      body=next;lines=nextLines;serial++;
      info=body?lyricsExtrasFor(lines,language()):{source:'',romanize:false,translate:false};
      onNote('');sync();paint();if(prefs.translate&&info.translate)load();
    }
  };
}
