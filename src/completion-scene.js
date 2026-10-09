// A bounded release of heat shared by the native UI and the design preview.
export class CompletionScene {
  constructor(){
    this.canvas=document.createElement('canvas');this.canvas.className='completion-scene';this.canvas.setAttribute('aria-hidden','true');
    this.ctx=this.canvas.getContext('2d');this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.frame=0;this.animations=[];
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
    this.reduced.addEventListener('change',()=>this.stop());addEventListener('resize',()=>this.stop());
    document.addEventListener('scroll',()=>this.stop(),{capture:true,passive:true});
  }
  stop(){
    cancelAnimationFrame(this.frame);this.frame=0;this.canvas.remove();
    this.animations.forEach(animation=>animation.cancel());this.animations=[];
    this.target?.classList.remove('completion-focus');
  }
  play(target,mascot=document.querySelector('.mascot-portrait')){
    this.stop();if(!this.ctx||document.hidden||this.reduced.matches)return;
    const bounds=target?.getBoundingClientRect();
    if(!bounds||bounds.bottom<0||bounds.top>innerHeight)return;
    this.target=target;target.classList.add('completion-focus');
    const stage=mascot?.querySelector('.companion-stage');
    if(stage)this.animations.push(stage.animate([
      {transform:'translateY(0) scale(1)'},
      {transform:'translateY(5px) scale(.955)',offset:.13},
      {transform:'translateY(-9px) scale(1.065)',offset:.36},
      {transform:'translateY(-3px) scale(1.018)',offset:.64},
      {transform:'translateY(0) scale(1)'}
    ],{duration:1400,easing:'cubic-bezier(.2,.7,.2,1)'}));
    const portrait=mascot?.getBoundingClientRect();
    this.origin=portrait?{x:portrait.x+portrait.width*.5,y:portrait.y+portrait.height*.54,r:portrait.width*.48}:null;
    const track=target.querySelector('.combustion-canvas')?.getBoundingClientRect()||bounds;
    this.line={x:Math.max(12,track.left+8),y:Math.min(innerHeight-24,track.bottom-21),w:Math.min(track.width-16,innerWidth-track.left-16)};
    this.width=innerWidth;this.height=innerHeight;
    const dpr=Math.min(devicePixelRatio,1.5);this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);document.body.append(this.canvas);this.started=performance.now();
    const tick=now=>{const time=now-this.started;if(time>=1800){this.stop();return;}this.draw(time);this.frame=requestAnimationFrame(tick);};
    this.frame=requestAnimationFrame(tick);
  }
  draw(time){
    const ctx=this.ctx,{x,y,w}=this.line;
    ctx.clearRect(0,0,this.width,this.height);ctx.globalCompositeOperation='lighter';
    const release=Math.max(0,(time-170)/1000),strength=Math.sin(Math.min(1,release/1.25)*Math.PI);
    if(this.origin&&time<1000){
      const {x:mx,y:my,r}=this.origin,phase=Math.min(1,time/1000);
      const glow=ctx.createRadialGradient(mx,my,r*.38,mx,my,r*(1+phase*.6));
      glow.addColorStop(0,'#f7490000');glow.addColorStop(.62,`rgba(245,67,15,${Math.sin(phase*Math.PI)*.16})`);glow.addColorStop(1,'#ff710000');
      ctx.fillStyle=glow;ctx.fillRect(mx-r*1.6,my-r*1.6,r*3.2,r*3.2);
      ctx.strokeStyle=`rgba(255,142,62,${Math.sin(phase*Math.PI)*.52})`;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.ellipse(mx,my,r*(.65+phase*.8),r*(1.05+phase*.5),-.25,-2.5,.7);ctx.stroke();
    }
    if(release<=0)return;
    const glow=ctx.createLinearGradient(0,y-65,0,y+18);
    glow.addColorStop(0,'#ff420000');glow.addColorStop(.76,`rgba(255,79,19,${strength*.32})`);glow.addColorStop(1,'#ff490000');
    ctx.fillStyle=glow;ctx.fillRect(x,y-65,w,83);
    ctx.strokeStyle=`rgba(255,219,159,${strength*.85})`;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y);ctx.stroke();
    for(let i=0;i<64;i++){
      const life=release-(i%8)*.026;if(life<0||life>1.4)continue;
      const seed=Math.abs(Math.sin(i*97.13)),alpha=Math.pow(1-life/1.4,2);
      const px=x+w*seed+Math.sin(i*1.7)*life*28,py=y-(35+seed*100)*life+18*life*life;
      ctx.strokeStyle=`rgba(255,${140+Math.round(seed*80)},${65+Math.round(seed*80)},${alpha})`;ctx.lineWidth=i%5===0?2:1;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-Math.sin(i*1.7)*2,py+2+seed*4);ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
  }
}
