import {brandForUrl, brands} from './source-brands.js';
import {MascotMotion} from './mascot-motion.js';
import {t, onLanguageChange} from './i18n.js';
export {brandForUrl} from './source-brands.js';

// Reactions take priority over queue polling without restarting their animation.
export class DevilMascot {
  constructor(element) {
    this.element=element;this.state='idle';this.activity='idle';this.reaction=null;
    this.source=brands.find(brand=>brand.id==='youtube');this.pendingSource=this.source;
    this.host=document.createElement('div');
    this.host.className='mascot-portrait physical-grip';
    this.host.innerHTML='<div class="companion-stage"><img class="companion-art" src="assets/mascot-infernal/grip-v1.png" alt=""><div class="companion-prop"><span class="prop-logo" aria-hidden="true"></span><span class="prop-domain"></span><span class="prop-stamp" aria-hidden="true"></span></div></div>';
    element.append(this.host);
    this.prop=this.host.querySelector('.companion-prop');this.logo=this.host.querySelector('.prop-logo');
    this.domain=this.host.querySelector('.prop-domain');this.stamp=this.host.querySelector('.prop-stamp');
    this.caption=document.createElement('span');this.caption.className='companion-caption';element.append(this.caption);
    this.motion=new MascotMotion(this.host,this.prop);
    element.removeAttribute('aria-label');
    this.host.setAttribute('role','img');onLanguageChange(()=>this.sync());this.sync();
  }
  setState(state){this.state=state;if(['paused','pausing'].includes(state)&&this.reaction==='downloading'){clearTimeout(this.timer);this.reaction=null;}this.sync();}
  setActivity(activity){this.activity=activity;this.sync();}
  setSource(url){
    const source=brandForUrl(url);
    if(source)this.pendingSource=source;
    if(!this.reaction&&source)this.source=source;
    this.sync();
  }
  sync(){
    const state=this.reaction|| (this.activity==='sending'?'phone':this.state==='running'?'downloading':['paused','pausing'].includes(this.state)?'paused':this.state==='error'?'error':'idle');
    this.host.dataset.reaction=state;
    const phone=state==='phone',key=phone?'phone':this.source.id;
    if(this.prop.dataset.service!==key){
      this.prop.dataset.service=key;
      this.logo.hidden=!phone&&key==='other';this.domain.hidden=phone||key!=='other';
      if(phone||key!=='other')this.logo.style.setProperty('--logo',`url("${phone?'assets/icons/phone-transfer.svg':`assets/brands/${key}.svg`}")`);
      this.domain.textContent=key==='other'?this.source.label:'';
    }
    this.stamp.textContent={done:'✓',error:'!',paused:'Ⅱ',phone:'↑'}[state]||'';
    const label=t({idle:'Ready to download',downloading:'Downloading',paused:'Paused',done:'Download ready',error:'Needs attention',phone:'Sending to phone'}[state]);
    this.caption.textContent=label;
    this.host.setAttribute('aria-label',`${phone?t('Phone'):this.source.name} · ${label}`);
    this.motion.setState(state);
  }
  react(state,duration=2500){
    clearTimeout(this.timer);this.source=this.pendingSource;this.reaction=state;this.sync();
    this.timer=setTimeout(()=>{this.reaction=null;this.source=this.pendingSource;this.sync();},duration);
  }
  reactStart(){this.react('downloading',900);}
  reactCinema(){this.sync();}
  reactShare(){this.react('phone',1800);}
  reactSending(){this.react('phone',1800);}
  reactTransferDone(){this.react('done',3400);}
  celebrate(){this.react('done',3200);}
  fail(){this.react('error',3100);}
}
