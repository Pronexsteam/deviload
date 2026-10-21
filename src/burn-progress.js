// A small GPU surface: unburnt material, charred trail, flame front and rising embers.
// Progress is supplied by the caller; this module never invents download progress.
const vertex = `attribute vec2 a_position; varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_time,u_progress,u_burning,u_release;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.03+vec2(4.2,8.3);a*=.5;}return v;}
void main(){
 vec2 p=v_uv*u_size;
 float x=p.x,y=p.y;
 float start=8.,end=u_size.x-8.,front=mix(start,end,u_progress);
 float ragged=(noise(vec2(y*.38,7.1))-.5)*4.;
 float burned=1.-smoothstep(front+ragged-.7,front+ragged+.7,x);
 float bar=smoothstep(16.,17.,y)*(1.-smoothstep(24.,25.,y))*smoothstep(start,start+2.,x)*(1.-smoothstep(end-2.,end,x));
 float grain=noise(p*1.7);
 float cracks=pow(1.-abs(noise(p*vec2(.42,.6))*2.-1.),17.);
 float trail=exp(-max(0.,front-x)/65.)*burned;
 vec3 cold=vec3(.14,.17,.20)+grain*.022;
 vec3 coal=vec3(.031,.025,.027)+grain*.035;
 float heat=trail*(.45+.55*u_burning)*cracks;
 vec3 base=mix(cold,coal,burned)+vec3(1.1,.16,.018)*heat;
 float edge=exp(-abs(x-front-ragged)*.85)*bar;
 base+=vec3(1.,.49,.12)*edge*u_burning;
 float alpha=bar;
 vec3 rgb=base*bar;
 // Hot cracks remain behind the flame. The front itself is irregular, never a glowing dot.
 float within=smoothstep(start,start+3.,x)*(1.-smoothstep(end-2.,end+2.,x));
 float glow=exp(-abs(y-22.)*.16)*exp(-abs(x-front+10.)*.035)*.18*u_burning*within;
 rgb+=vec3(.8,.14,.016)*glow;alpha=max(alpha,glow);
 float above=max(0.,y-23.);
 // Keep the flame's flow attached to its moving front instead of crossing
 // unrelated world-space noise on every progress update.
 float flowX=x-front;
 float wind=fbm(vec2(flowX*.065-u_time*.12,above*.038-u_time*.65));
 float core=exp(-pow((x-front+8.+(wind-.5)*12.)/18.,2.));
 float wake=exp(-max(0.,front-x)/55.)*burned*.34;
 float ignition=clamp((u_release-.10-(x/start)*.0004)/.95,0.,1.);
 float release=sin(ignition*3.14159)*step(0.,u_release);
 float strength=max((core+wake)*u_burning,release*1.4)*within;
 float tongues=fbm(vec2(flowX*.085+wind*1.3,above*.065-u_time*1.05));
 float flameHeight=(15.+21.*noise(vec2(flowX*.07,u_time*.32)))*strength;
 float density=(flameHeight-above)/11.+(tongues-.5)*1.3;
 float fire=smoothstep(.05,.75,density)*smoothstep(22.,25.,y)*u_burning*(1.-smoothstep(u_size.y-10.,u_size.y-2.,y));
 float hot=clamp(density*.55,0.,1.);
 vec3 fireColor=mix(vec3(.85,.055,.008),vec3(1.,.48,.025),smoothstep(.1,.65,hot));
 fireColor=mix(fireColor,vec3(1.,.91,.48),pow(hot,4.));
 rgb=rgb*(1.-fire)+fireColor*fire;alpha=max(alpha,fire);
 // A few coherent ember trajectories, with small grey fragments following behind.
 for(int i=0;i<14;i++){
   float seed=float(i),life=fract(u_time*(.25+hash(vec2(seed,1.))*.28)+hash(vec2(seed,4.)));
   float sx=front-hash(vec2(seed,3.))*51.-life*(8.+seed*1.2)+sin(life*7.+seed)*3.;
   float sy=26.+life*(29.+hash(vec2(seed,5.))*23.);
   float d=length((p-vec2(sx,sy))*vec2(1.,.55));
   float spark=(1.-smoothstep(.3,1.2,d))*smoothstep(0.,.14,life)*(1.-life)*u_burning*within;
   vec3 sparkColor=seed<10.?vec3(1.,.51,.13):vec3(.45,.4,.37);
   rgb+=sparkColor*spark;alpha=max(alpha,spark);
 }
 gl_FragColor=vec4(min(rgb,vec3(1.)),clamp(alpha,0.,1.));
}`;

export class BurnProgress {
 constructor(){
  this.canvas=document.createElement('canvas');this.canvas.className='combustion-canvas';this.canvas.setAttribute('aria-hidden','true');
  this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});
  this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.progress=0;this.burning=false;this.visible=false;this.raf=0;this.time=0;this.last=0;
  if(this.gl){const gl=this.gl;const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   this.program=gl.createProgram();const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));gl.useProgram(this.program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(this.program,'a_position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);this.uniform={};for(const name of ['size','time','progress','burning','release'])this.uniform[name]=gl.getUniformLocation(this.program,'u_'+name);
  }
  this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;this.schedule();});
  this.resize=new ResizeObserver(()=>{this.size();this.paint();});this.resize.observe(this.canvas);
  this.onVisibilityChange=()=>{this.last=0;this.lastPaint=performance.now();this.schedule();};
  this.onMotionChange=()=>{
   if(this.destroyed)return;
   cancelAnimationFrame(this.raf);this.raf=0;this.last=0;this.lastPaint=performance.now();
   if(this.finishing)this.burning=false;
   this.finishing=0;this.visual=this.progress;this.velocity=0;
   this.canvas.hidden=!this.gl||this.calm();this.host?.classList.toggle('has-combustion',!!this.gl&&!this.calm());
   this.size();this.paint();this.schedule();
  };
  this.onContextLost=event=>{event.preventDefault();cancelAnimationFrame(this.raf);this.raf=0;this.canvas.hidden=true;this.gl=null;this.host?.classList.remove('has-combustion');};
  document.addEventListener('visibilitychange',this.onVisibilityChange);this.reduced.addEventListener('change',this.onMotionChange);
  document.addEventListener('deviload-motion-change',this.onMotionChange);
  this.canvas.addEventListener('webglcontextlost',this.onContextLost);
 }
 calm(){return document.documentElement.dataset.motion==='reduced';}
 mount(host,progress,burning){if(this.destroyed)return;this.observer.disconnect();this.host=host;this.finishing=0;this.visual=progress;this.velocity=0;this.lastPaint=performance.now();this.progress=progress;this.burning=burning;this.last=0;cancelAnimationFrame(this.raf);this.raf=0;if(!host){this.visible=false;return;}host.append(this.canvas);host.classList.toggle('has-combustion',!!this.gl&&!this.calm());this.canvas.hidden=!this.gl||this.calm();host.setAttribute('role','progressbar');host.setAttribute('aria-label','Download progress');host.setAttribute('aria-valuemin','0');host.setAttribute('aria-valuemax','100');this.setProgress(progress);this.observer.observe(host);this.size();this.paint();this.schedule();}
 setProgress(progress){
  const target=Math.max(0,Math.min(1,Number(progress)||0));
  this.progress=target;
  if(this.host){this.host.setAttribute('aria-valuenow',String(Math.round(target*100)));this.host.style.setProperty('--progress',(target*100)+'%');}
  if(this.reduced.matches||!this.visible)this.paint();this.schedule();
 }
 finish(){this.finishing=this.calm()?0:performance.now();this.burning=!this.calm();this.setProgress(1);this.schedule();}
 size(){if(this.destroyed||this.calm()||!this.gl)return;const bounds=this.canvas.getBoundingClientRect();if(!bounds.width||!bounds.height)return;this.width=bounds.width;this.height=bounds.height;const dpr=Math.min(devicePixelRatio,1.25);this.canvas.width=Math.round(bounds.width*dpr);this.canvas.height=Math.round(bounds.height*dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
 paint(){if(this.destroyed||this.calm()||!this.gl||!this.width||!this.host)return;const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-(this.lastPaint??now))/1000));this.lastPaint=now;
  if(this.reduced.matches){this.visual=this.progress;this.velocity=0;}
  else {
   const displacement=(this.visual??this.progress)-this.progress,velocity=this.velocity||0,omega=16,decay=Math.exp(-omega*dt),spring=velocity+omega*displacement;
   this.visual=Math.max(0,Math.min(1,this.progress+(displacement+spring*dt)*decay));
   this.velocity=(velocity-omega*spring*dt)*decay;
   if(Math.abs(this.visual-this.progress)<.0001&&Math.abs(this.velocity)<.001){this.visual=this.progress;this.velocity=0;}
  }
  const heat=this.finishing?Math.max(0,1-Math.max(0,now-this.finishing-550)/650):1;if((this.finishing&&heat===0)||(!this.finishing&&this.progress===1&&this.visual>.999))this.burning=false;const gl=this.gl;gl.useProgram(this.program);gl.uniform2f(this.uniform.size,this.width,this.height);gl.uniform1f(this.uniform.time,this.reduced.matches?0:this.time);gl.uniform1f(this.uniform.progress,this.visual);gl.uniform1f(this.uniform.burning,this.burning&&!this.reduced.matches?heat:0);gl.uniform1f(this.uniform.release,this.finishing&&!this.reduced.matches?(now-this.finishing)/1000:-1);gl.drawArrays(gl.TRIANGLES,0,6);}
 schedule(){if(this.destroyed||this.calm()||!this.gl||!this.host||!this.visible||document.hidden||(!this.burning&&Math.abs(this.progress-(this.visual??this.progress))<.001)||this.reduced.matches){cancelAnimationFrame(this.raf);this.raf=0;this.last=0;return;}if(this.raf)return;this.raf=requestAnimationFrame(now=>{this.raf=0;if(this.last)this.time+=Math.min((now-this.last)/1000,.06);this.last=now;this.paint();this.schedule();});}
 destroy(){if(this.destroyed)return;this.destroyed=true;cancelAnimationFrame(this.raf);this.raf=0;this.observer.disconnect();this.resize.disconnect();document.removeEventListener('visibilitychange',this.onVisibilityChange);document.removeEventListener('deviload-motion-change',this.onMotionChange);this.reduced.removeEventListener('change',this.onMotionChange);this.canvas.removeEventListener('webglcontextlost',this.onContextLost);this.canvas.remove();this.host?.classList.remove('has-combustion');this.host=null;}
}
