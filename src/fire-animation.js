import {BurnProgress} from './burn-progress.js';

export class FireAnimation {
  constructor(element){
    this.element=element;this.track=element.querySelector('.track');
    this.fill=element.querySelector('.fill');this.active=false;this.percent=0;this.jobId=null;this.finishing=false;
    try {this.burn=new BurnProgress();}catch(error){console.warn('Using static download progress.',error.message);}
  }
  setActive(active,jobId=null){
    if(active&&jobId!==this.jobId){
      clearTimeout(this.finishTimer);this.finishing=false;this.percent=0;this.jobId=jobId;
      delete this.element.dataset.complete;this.burn?.mount(this.track,0,true);
    }
    this.active=active;
    if(!active&&this.finishing)return;
    this.element.hidden=!active;
    if(!active){this.jobId=null;this.burn?.mount(null,0,false);}
  }
  complete(jobId){
    if(this.jobId!==jobId||this.finishing)return;
    this.finishing=true;this.element.dataset.complete='true';this.percent=100;
    this.fill.style.width='100%';this.track.setAttribute('aria-valuenow','100');
    this.burn?.finish();
    clearTimeout(this.finishTimer);
    this.finishTimer=setTimeout(()=>{this.finishing=false;if(!this.active)this.setActive(false);delete this.element.dataset.complete;},1900);
  }
  setProgress(value){
    this.percent=Math.max(0,Math.min(100,Number(value)||0));
    this.fill.style.width=this.percent+'%';this.track.setAttribute('aria-valuenow',String(Math.round(this.percent)));
    if(this.burn){this.burn.burning=true;this.burn.setProgress(this.percent/100);this.burn.schedule();}
  }
}
