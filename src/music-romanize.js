const RUSSIAN=['a','b','v','g','d','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','kh','ts','ch','sh','shch','','y','','e','yu','ya'];
// Lowercase Russian letters are contiguous; the rest are Ukrainian and Belarusian.
const CYRILLIC=Object.fromEntries([...RUSSIAN.map((latin,i)=>[String.fromCodePoint(0x430+i),latin]),[0x451,'yo'],[0x454,'ye'],[0x456,'i'],[0x457,'yi'],[0x491,'g'],[0x45e,'w']].map(([key,value])=>[typeof key==='number'?String.fromCodePoint(key):key,value]));
const GREEK={\u03b1:'a',\u03ac:'a',\u03b2:'v',\u03b3:'g',\u03b4:'d',\u03b5:'e',\u03ad:'e',\u03b6:'z',\u03b7:'i',\u03ae:'i',\u03b8:'th',\u03b9:'i',\u03af:'i',\u03ca:'i',\u0390:'i',\u03ba:'k',\u03bb:'l',\u03bc:'m',\u03bd:'n',\u03be:'x',\u03bf:'o',\u03cc:'o',\u03c0:'p',\u03c1:'r',\u03c3:'s',\u03c2:'s',\u03c4:'t',\u03c5:'y',\u03cd:'y',\u03cb:'y',\u03b0:'y',\u03c6:'f',\u03c7:'ch',\u03c8:'ps',\u03c9:'o',\u03ce:'o'};
const HANGUL_INITIAL=['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const HANGUL_VOWEL=['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const HANGUL_FINAL=['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
const KANA={\u3042:'a',\u3044:'i',\u3046:'u',\u3048:'e',\u304a:'o',\u304b:'ka',\u304d:'ki',\u304f:'ku',\u3051:'ke',\u3053:'ko',\u3055:'sa',\u3057:'shi',\u3059:'su',\u305b:'se',\u305d:'so',\u305f:'ta',\u3061:'chi',\u3064:'tsu',\u3066:'te',\u3068:'to',\u306a:'na',\u306b:'ni',\u306c:'nu',\u306d:'ne',\u306e:'no',\u306f:'ha',\u3072:'hi',\u3075:'fu',\u3078:'he',\u307b:'ho',\u307e:'ma',\u307f:'mi',\u3080:'mu',\u3081:'me',\u3082:'mo',\u3084:'ya',\u3086:'yu',\u3088:'yo',\u3089:'ra',\u308a:'ri',\u308b:'ru',\u308c:'re',\u308d:'ro',\u308f:'wa',\u3092:'o',\u3093:'n',\u304c:'ga',\u304e:'gi',\u3050:'gu',\u3052:'ge',\u3054:'go',\u3056:'za',\u3058:'ji',\u305a:'zu',\u305c:'ze',\u305e:'zo',\u3060:'da',\u3062:'ji',\u3065:'zu',\u3067:'de',\u3069:'do',\u3070:'ba',\u3073:'bi',\u3076:'bu',\u3079:'be',\u307c:'bo',\u3071:'pa',\u3074:'pi',\u3077:'pu',\u307a:'pe',\u307d:'po',\u3094:'vu',\u3041:'a',\u3043:'i',\u3045:'u',\u3047:'e',\u3049:'o'};
const SMALL={\u3083:'ya',\u3085:'yu',\u3087:'yo'};
const SCRIPT=/[\u0400-\u04ff\u0370-\u03ff\uac00-\ud7a3\u3040-\u30ff]/;
const HAN=/[\u3400-\u9fff]/;

const hiragana=char=>{const code=char.codePointAt(0);return code>=0x30a1&&code<=0x30f6?String.fromCodePoint(code-0x60):char;};
const capitalize=(source,latin)=>source!==source.toLocaleLowerCase()&&latin?latin[0].toUpperCase()+latin.slice(1):latin;

function kana(text){
  const chars=[...text].map(hiragana);let out='';
  for(let i=0;i<chars.length;i++){
    const char=chars[i],next=chars[i+1];
    if(char==='\u3063'){const following=KANA[next]||'';out+=following?following[0]==='c'?'t':following[0]:'';continue;}
    if(char==='\u30fc'){out+=out.at(-1)||'';continue;}
    const base=KANA[char];
    if(base&&SMALL[next]&&base.endsWith('i')){const glide=SMALL[next],stem=base.slice(0,-1);out+=['sh','ch','j'].includes(stem)?stem+glide.slice(1):stem+glide;i++;continue;}
    out+=base??char;
  }
  return out;
}

function hangul(char){
  const code=char.codePointAt(0)-0xac00;if(code<0||code>11171)return char;
  return HANGUL_INITIAL[Math.floor(code/588)]+HANGUL_VOWEL[Math.floor(code%588/28)]+HANGUL_FINAL[code%28];
}

export function needsRomanization(text){return typeof text==='string'&&SCRIPT.test(text)&&!HAN.test(text);}

// Han characters need a dictionary; lines that contain them are left alone.
export function romanize(text){
  if(!needsRomanization(text))return '';
  text=text.replace(/([\u039f\u03bf\u038c\u03cc])([\u03c5\u03cd])/g,(_,o)=>o.toLowerCase()===o?'ou':'Ou');
  let out='',korean=false;
  const flushKana=buffer=>buffer?kana(buffer):'';let buffer='';
  for(const char of text){
    if(/[\u3040-\u30ff]/.test(char)){buffer+=char;continue;}
    out+=flushKana(buffer);buffer='';
    const lower=char.toLocaleLowerCase();
    if(CYRILLIC[lower]!==undefined)out+=capitalize(char,CYRILLIC[lower]);
    else if(GREEK[lower]!==undefined)out+=capitalize(char,GREEK[lower]);
    else if(/[\uac00-\ud7a3]/.test(char)){out+=(korean&&/[a-z]$/.test(out)?'':'')+hangul(char);korean=true;continue;}
    else out+=char;
    korean=false;
  }
  out+=flushKana(buffer);
  return out.replace(/\s+/g,' ').trim();
}

export function lyricsScript(lines){
  const text=lines.map(line=>line.text||'').join(' ');
  if(/[\uac00-\ud7a3]/.test(text))return 'ko';
  if(/[\u3040-\u30ff]/.test(text))return 'ja';
  if(HAN.test(text))return 'zh';
  if(/[\u0370-\u03ff]/.test(text))return 'el';
  if(/[\u0400-\u04ff]/.test(text))return /[\u0456\u0457\u0454\u0491]/i.test(text)?'uk':'ru';
  return /[A-Za-z]/.test(text)?'latin':'';
}

const STOPWORDS={en:['the','you','and','my','me','your','love','i','it','is','to','in','of','we'],es:['que','el','la','de','y','mi','tu','en','no','me','te','amor','por','con'],pt:['que','n\u00e3o','voc\u00ea','eu','meu','com','uma','de','e','o','do','da'],fr:['je','tu','le','la','et','les','des','pas','mon','est','une','moi'],de:['ich','du','und','die','der','das','nicht','mein','ist','mich','dich','ein'],it:['che','non','il','la','di','mi','ti','sono','per','una','cuore','amore']};

// Script first, then common words for Latin-script lyrics.
export function lyricsLanguage(lines){
  const script=lyricsScript(lines);if(script!=='latin')return script;
  const words=lines.map(line=>line.text||'').join(' ').toLocaleLowerCase().match(/[a-z\u00e0-\u00ff]+/g)||[];
  let best='en',score=0;
  for(const [code,list] of Object.entries(STOPWORDS)){const value=words.reduce((sum,word)=>sum+(list.includes(word)?1:0),0);if(value>score){best=code;score=value;}}
  return best;
}

const readable={ru:['ru','uk'],en:[],es:[]};

export function lyricsExtrasFor(lines,ui){
  const source=lyricsLanguage(lines),seen=readable[ui]||[];
  const foreign=Boolean(source)&&source!==ui&&!seen.includes(source);
  return {source,romanize:foreign&&lines.some(line=>needsRomanization(line.text)),translate:foreign&&source!=='zh'};
}

export function translatable(lines){return [...new Set(lines.map(line=>(line.text||'').trim()).filter(text=>text&&/\p{L}/u.test(text)&&text.length<=400))];}
