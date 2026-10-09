import {MascotRenderer} from './mascot-renderer.js';
const ROOT='assets/mascot-infernal/';
const CLIPS={
  idle:{file:'idle-atlas.png',duration:7600,loop:true,anchors:[[97,204],[97,204],[98,204],[98,204],[97,204],[97,204],[97,204],[97,204]]},
  done:{file:'success-atlas.png',duration:1250,loop:false,anchors:[[100,211],[100,211],[100,211],[100,211],[100,211],[100,211],[100,211],[100,211]]},
  error:{file:'error-atlas.png',duration:2100,loop:false,anchors:[[107,214],[104,214],[99,214],[99,214],[96,210],[96,210],[96,210],[96,210]]}
};

// Draw registered sprite cells; the logo uses the same interpolated frame anchor.
export class MascotMotion {
  constructor(host,prop){
    this.host=host;this.prop=prop;this.stage=host.querySelector('.companion-stage');
    this.still=host.querySelector('.companion-art');
    this.canvas=document.createElement('canvas');this.canvas.className='companion-frames';
    this.canvas.width=384;this.canvas.height=512;this.canvas.setAttribute('aria-hidden','true');
    this.ctx=null;this.renderer=null;
    this.buffer=document.createElement('canvas');this.buffer.width=384;this.buffer.height=512;
    this.bufferCtx=this.buffer.getContext('2d');
    this.images={};this.state='idle';this.time=0;this.last=0;this.frame=0;this.visible=true;this.ready=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced.addEventListener('change',()=>{this.stop();this.render();this.schedule();});
    document.addEventListener('visibilitychange',()=>{this.stop();this.schedule();});
    this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;this.stop();this.schedule();});
    this.observer.observe(host);
    this.load();
  }
  async load(){
    try{
      await Promise.all(Object.entries(CLIPS).map(async([key,clip])=>{
        const image=new Image();image.src=ROOT+clip.file;await image.decode();
        if(image.width!==1536||image.height!==1024)throw Error('Unexpected sprite atlas dimensions');
        this.images[key]=image;
      }));
      try{
        const response=await fetch(ROOT+'motion-vectors.json');
        if(!response.ok)throw Error('Motion vectors unavailable');
        const vectors=await response.json();
        this.renderer=new MascotRenderer(this.canvas,this.images,vectors);
        this.host.dataset.interpolation='motion';
      }catch(error){
        this.canvas=document.createElement('canvas');this.canvas.className='companion-frames';
        this.canvas.width=384;this.canvas.height=512;this.canvas.setAttribute('aria-hidden','true');
        this.ctx=this.canvas.getContext('2d',{alpha:true});
        this.host.dataset.interpolation='blend';
        console.warn('Using blended companion frames.',error.message);
      }
      this.stage.prepend(this.canvas);this.still.hidden=true;this.host.classList.add('has-frame-animation');
      this.host.dataset.motionReady='true';this.ready=true;this.render();this.schedule();
    }catch(error){this.host.dataset.motionReady='false';console.warn('Companion animation unavailable; keeping the still illustration.',error.message);}
  }
  clipKey(){return this.state==='done'?'done':this.state==='error'?'error':'idle';}
  setState(state){
    if(this.state===state)return;
    const previousClip=this.clipKey();
    this.stop();
    this.state=state;
    if(previousClip!==this.clipKey()){
      if(this.renderer)this.renderer.capture();
      else{this.bufferCtx.clearRect(0,0,384,512);this.bufferCtx.drawImage(this.canvas,0,0);}
      this.previousAnchor=this.anchor||[97,204];this.transition=420;
      this.time=0;
    }
    this.render();this.schedule();
  }
  stop(){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;}
  schedule(){
    const clip=CLIPS[this.clipKey()];
    if(!this.ready||this.frame||document.hidden||!this.visible||this.reduced.matches||this.state==='paused'||(!clip.loop&&this.time>=clip.duration&&!this.transition))return;
    this.frame=requestAnimationFrame(now=>{
      this.frame=0;
      // Keep wall-clock timing when the browser throttles frames. Hidden views
      // reset last in stop(), so resuming cannot skip an entire reaction.
      const delta=this.last?Math.max(0,now-this.last):0;this.last=now;
      this.time+=delta*(this.state==='downloading'?1.1:1);
      this.transition=Math.max(0,(this.transition||0)-delta);
      this.render();this.schedule();
    });
  }
  render(){
    if(!this.ready)return;
    const key=this.clipKey(),clip=CLIPS[key],image=this.images[key];
    const still=this.reduced.matches;
    const progress=Math.min(1,this.time/clip.duration);
    const ease=value=>value*value*(3-2*value);
    // Idle atlas poses change the torso silhouette. Hold the grip pose and let
    // the renderer flex the wings and lower flames without stretching the body.
    const position=still?(clip.loop?0:7):clip.loop?0:ease(progress)*7;
    const first=Math.floor(position),next=Math.min(7,first+1),mix=position-first;
    const weight=this.transition&&!still?ease(this.transition/420):0;
    if(this.renderer)this.renderer.render(key,first,clip.loop?first:next,mix,weight,clip.loop&&!still&&this.state!=='paused'?this.time/1000:null);
    else{
      const ctx=this.ctx;ctx.clearRect(0,0,384,512);
      const draw=(index,alpha)=>{ctx.globalAlpha=alpha;ctx.drawImage(image,index%4*384,Math.floor(index/4)*512,384,512,0,0,384,512);};
      draw(first,(1-mix)*(1-weight));ctx.globalCompositeOperation='lighter';draw(next,mix*(1-weight));
      if(weight){ctx.globalAlpha=weight;ctx.drawImage(this.buffer,0,0);}
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    }
    let anchor=clip.anchors[first].map((v,i)=>v*(1-mix)+clip.anchors[next][i]*mix);
    if(weight)anchor=anchor.map((v,i)=>v*(1-weight)+this.previousAnchor[i]*weight);
    this.anchor=anchor;
    this.prop.style.left=((anchor[0]-24)/384*100)+'%';
    this.prop.style.top=((anchor[1]-16)/512*100)+'%';
    this.host.dataset.clip=key;this.host.dataset.frame=String(first);
  }
}
