import {t,onLanguageChange} from './i18n.js';
import {artworkCandidates} from './music-artwork.js';
import {CARD,GAP,startingPick,togglePick,fitRows,cardFileName} from './music-lyric-card-model.js';

// "Share a line": a picture of one to four sung lines with the song's cover, to copy or save.
// It opens from the lyrics tools, or from a right click on a line.
const FONT='Inter,"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif';
const STYLES=[['cover','Cover'],['tint','Colour'],['night','Night']];

export function createLyricCard({invoke,button,lyrics,getSong}){
  const make=(tag,cls='')=>{const node=document.createElement(tag);if(cls)node.className=cls;return node;};
  const dialog=make('dialog','music-lyric-card-dialog');dialog.setAttribute('aria-labelledby','music-lyric-card-title');
  const head=make('header','music-lyric-card-head'),title=make('h2');title.id='music-lyric-card-title';
  const close=make('button','music-lyric-card-close');close.type='button';close.textContent='×';close.addEventListener('click',()=>dialog.close());
  head.append(title,close);
  const canvas=make('canvas','music-lyric-card-preview');canvas.width=CARD.width;canvas.height=CARD.height;canvas.setAttribute('role','img');
  const side=make('div','music-lyric-card-side'),styleLabel=make('p','music-lyric-card-label'),styles=make('div','music-lyric-card-styles');styles.setAttribute('role','radiogroup');
  const linesLabel=make('p','music-lyric-card-label'),list=make('div','music-lyric-card-lines');
  const actions=make('div','music-lyric-card-actions'),copy=make('button','music-lyric-card-copy'),save=make('button','music-lyric-card-save'),status=make('p','music-lyric-card-status');
  copy.type=save.type='button';status.setAttribute('role','status');actions.append(copy,save);
  side.append(styleLabel,styles,linesLabel,list,actions,status);
  const body=make('div','music-lyric-card-body');body.append(canvas,side);dialog.append(head,body);document.body.append(dialog);

  let snapshot={lines:[],active:-1},pick=[],style='cover',song=null,art=null,artFor='',drawing=0;
  const styleButtons=STYLES.map(([value])=>{
    const node=make('button','music-lyric-card-style');node.type='button';node.dataset.style=value;node.setAttribute('role','radio');
    node.addEventListener('click',()=>{style=value;syncStyles();void draw();});styles.append(node);return node;
  });
  function syncStyles(){for(const node of styleButtons)node.setAttribute('aria-checked',String(node.dataset.style===style));}

  function renderList(){
    list.replaceChildren(...snapshot.lines.map((text,index)=>{
      const row=make('button','music-lyric-card-line');row.type='button';row.textContent=text||'♪';row.disabled=!text.trim();
      row.setAttribute('role','checkbox');row.setAttribute('aria-checked',String(pick.includes(index)));
      row.addEventListener('click',()=>{pick=togglePick(pick,index,snapshot.lines);syncList();void draw();});
      return row;
    }));
    syncList();
    requestAnimationFrame(()=>list.children[pick[0]]?.scrollIntoView({block:'center'}));
  }
  function syncList(){[...list.children].forEach((row,index)=>row.setAttribute('aria-checked',String(pick.includes(index))));}

  // The cover is loaded with CORS, so the finished picture can still be copied and saved.
  function loadArt(image){
    if(image===artFor)return Promise.resolve(art);
    artFor=image;art=null;const url=artworkCandidates(image,1024)[0];if(!url)return Promise.resolve(null);
    return new Promise(resolve=>{const img=new Image();img.crossOrigin='anonymous';img.decoding='async';
      img.onload=()=>{if(artFor===image)art=img;resolve(art);};img.onerror=()=>resolve(null);img.src=url;});
  }
  const accent=()=>{const node=document.querySelector('.music-lyrics-content');const value=node&&getComputedStyle(node).getPropertyValue('--lyric-aura').trim();return value||'#9ab4ff';};
  function coverInto(ctx,img,x,y,w,h){const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight),sw=w/scale,sh=h/scale;ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h);}

  async function draw(withArt=true){
    const token=++drawing;const picture=withArt?await loadArt(song?.image||''):null;if(token!==drawing)return;
    await document.fonts?.ready;if(token!==drawing)return;
    const ctx=canvas.getContext('2d'),{width:W,height:H,pad}=CARD,tone=accent();
    ctx.save();ctx.clearRect(0,0,W,H);
    // Background.
    if(style==='cover'&&picture){ctx.filter='blur(80px) saturate(1.5) brightness(.5)';coverInto(ctx,picture,-160,-160,W+320,H+320);ctx.filter='none';}
    else if(style==='tint'||style==='cover'){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,tone);g.addColorStop(1,'#14151c');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.fillStyle='rgb(0 0 0 / .28)';ctx.fillRect(0,0,W,H);}
    else{const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#16171f');g.addColorStop(1,'#08090c');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    const shade=ctx.createLinearGradient(0,0,0,H);shade.addColorStop(0,'rgb(0 0 0 / .1)');shade.addColorStop(1,'rgb(0 0 0 / .35)');ctx.fillStyle=shade;ctx.fillRect(0,0,W,H);
    // The song: cover and names.
    const size=148,top=pad;
    if(picture){ctx.save();ctx.beginPath();ctx.roundRect(pad,top,size,size,22);ctx.clip();coverInto(ctx,picture,pad,top,size,size);ctx.restore();}
    else{ctx.fillStyle='rgb(255 255 255 / .12)';ctx.beginPath();ctx.roundRect(pad,top,size,size,22);ctx.fill();}
    const nameX=pad+size+32,nameWidth=W-nameX-pad;ctx.textBaseline='alphabetic';
    const clip=(text,font,max)=>{ctx.font=font;let value=String(text||'');while(value.length>1&&ctx.measureText(value).width>max)value=value.slice(0,-2)+'…';return value;};
    ctx.fillStyle='#fff';ctx.fillText(clip(song?.title,`700 46px ${FONT}`,nameWidth),nameX,top+64);
    ctx.fillStyle='rgb(255 255 255 / .72)';ctx.fillText(clip((song?.artists||[]).join(', ')||song?.subtitle,`500 34px ${FONT}`,nameWidth),nameX,top+114);
    // The lines, as large as they fit.
    const texts=pick.map(index=>snapshot.lines[index]).filter(Boolean),box={width:W-pad*2,height:H-top-size-pad-200};
    const measureAt=(text,px)=>{ctx.font=`800 ${px}px ${FONT}`;return ctx.measureText(text).width;};
    const {size:px,rows}=fitRows(texts,box,measureAt),line=px*1.18;
    const tall=rows.reduce((sum,row)=>sum+(row===null?GAP:1),0)*line;let y=top+size+80+(box.height-tall)/2+px;ctx.font=`800 ${px}px ${FONT}`;ctx.fillStyle='#fff';
    ctx.shadowColor='rgb(0 0 0 / .35)';ctx.shadowBlur=24;
    for(const row of rows){if(row===null){y+=line*GAP;continue;}ctx.fillText(row,pad,y);y+=line;}
    ctx.shadowBlur=0;
    // Brand.
    ctx.fillStyle=tone;ctx.beginPath();ctx.arc(pad+10,H-pad+2,10,0,Math.PI*2);ctx.fill();
    ctx.font=`700 30px ${FONT}`;ctx.fillStyle='rgb(255 255 255 / .85)';ctx.fillText('Devil Music',pad+34,H-pad+13);
    ctx.restore();
    canvas.setAttribute('aria-label',texts.join(' / '));
  }

  // A cover that will not travel (no CORS) is left out instead of failing the whole picture.
  async function blob(){
    const take=()=>new Promise((resolve,reject)=>{try{canvas.toBlob(value=>value?resolve(value):reject(new TypeError()),'image/png');}catch(error){reject(error);}});
    try{return await take();}catch{await draw(false);return take();}
  }
  const base64=png=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=reject;reader.readAsDataURL(png);});
  copy.addEventListener('click',async()=>{
    try{await invoke('copy_lyric_card',{png:await base64(await blob())});status.textContent=t('Copied. Paste it into a chat or a story.');}
    catch{status.textContent=t('Could not copy the picture. Save it instead.');}
  });
  save.addEventListener('click',async()=>{
    try{
      if(await invoke('save_lyric_card',{png:await base64(await blob()),name:cardFileName(song?.title,song?.artists?.[0])}))status.textContent=t('Picture saved.');
    }catch{status.textContent=t('Could not save the picture.');}
  });

  function labels(){
    title.textContent=t('Share a line');close.title=close.ariaLabel=t('Close');
    styleLabel.textContent=t('Look');linesLabel.textContent=t('Lines (up to four)');
    copy.textContent=t('Copy picture');save.textContent=t('Save picture');
    styleButtons.forEach((node,index)=>{const value=STYLES[index][1];node.textContent=value==='Cover'?t('Cover'):value==='Colour'?t('Colour'):t('Night');});
  }
  labels();onLanguageChange(labels);syncStyles();

  function open(at=-1){
    snapshot=lyrics.snapshot();song=getSong();
    if(!song||!snapshot.lines.some(line=>line.trim()))return false;
    pick=startingPick(snapshot.lines,at>=0?at:snapshot.active);status.textContent='';
    renderList();void draw();if(!dialog.open)dialog.showModal();return true;
  }
  // A right click on a lyric line starts the card from that line.
  document.addEventListener('contextmenu',event=>{
    const row=event.target instanceof Element&&event.target.closest('.music-lyrics-scroll .music-lyric-line');
    if(!row)return;
    const index=[...row.parentElement.children].indexOf(row);
    if(open(index))event.preventDefault();
  });
  return {open,button:(()=>{const node=button(t('Share a line'),'image',()=>open());node.classList.add('music-lyric-card-open');onLanguageChange(()=>{node.title=node.ariaLabel=t('Share a line');});return node;})()};
}
