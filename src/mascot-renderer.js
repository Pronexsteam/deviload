// Warp both source frames toward an intermediate pose, then blend their colors.
// The motion field is measured offline; runtime work is two small indexed draws.
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
export class MascotRenderer {
  constructor(canvas,images,vectors){
    this.canvas=canvas;this.images=images;this.vectors=vectors;
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
    if(!gl)throw Error('WebGL unavailable');
    this.gl=gl;this.columns=vectors.columns;this.rows=vectors.rows;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 aPosition;attribute vec2 aUV;varying vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,0.0,1.0);}');
    const fragment=shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D uImage;uniform float uWeight;varying vec2 vUV;void main(){gl_FragColor=texture2D(uImage,vUV)*uWeight;}');
    this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    gl.deleteShader(vertex);gl.deleteShader(fragment);gl.useProgram(this.program);
    this.weight=gl.getUniformLocation(this.program,'uWeight');
    this.vertices=new Float32Array(this.columns*this.rows*4);
    this.vertexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);
    for(const [name,offset] of [['aPosition',0],['aUV',8]]){const a=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);}
    const indices=[];
    for(let y=0;y<this.rows-1;y++)for(let x=0;x<this.columns-1;x++){const a=y*this.columns+x,b=a+1,c=a+this.columns,d=c+1;indices.push(a,c,b,b,c,d);}
    this.count=indices.length;this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    this.textures={};for(const [key,image] of Object.entries(images))this.textures[key]=this.texture(image);
    this.previousTexture=this.texture(null);this.hasPrevious=false;
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);gl.viewport(0,0,canvas.width,canvas.height);
  }
  texture(image){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);return t;}
  capture(){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.previousTexture);gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,this.canvas.width,this.canvas.height,0);this.hasPrevious=true;}
  draw(texture,index,flow,amount,weight,snapshot=false,idleTime=null){
    if(weight<=0)return;
    const gl=this.gl,w=this.vectors.width,h=this.vectors.height;
    const beat=idleTime===null?0:(1-Math.cos(idleTime*Math.PI*2/5.6))*.5;
    for(let y=0;y<this.rows;y++)for(let x=0;x<this.columns;x++){
      const i=y*this.columns+x,j=i*4,u=x/(this.columns-1),v=y/(this.rows-1);
      this.vertices[j]=u+(flow?flow[i*2]*amount/w:0);
      this.vertices[j+1]=v+(flow?flow[i*2+1]*amount/h:0);
      if(idleTime!==null){
        // Flex the outer wing membranes while the face, torso and grip stay put.
        const side=u<.5?-1:1;
        const outer=smooth((Math.abs(u-.5)-.22)/.22);
        const height=smooth((v-.02)/.12)*smooth((.79-v)/.19);
        const grip=u<.5?1-smooth((u-.035)/.045)*smooth((v-.27)/.045)*(1-smooth((v-.51)/.05)):1-smooth((.88-u)/.08)*smooth((v-.48)/.08);
        const wing=outer*height*grip;
        this.vertices[j]-=side*wing*beat*16/w;
        this.vertices[j+1]-=wing*beat*7/h;
        const t=Math.max(0,Math.min(1,(v-.63)/.24)),flame=t*t*(3-2*t);
        this.vertices[j]+=flame*Math.sin(idleTime*1.7+v*17+u*3)*1.8/w;
        this.vertices[j+1]+=flame*Math.sin(idleTime*1.3+u*11-v*4)*.9/h;
      }
      this.vertices[j+2]=snapshot?u:(index%4+u)/4;
      // copyTexImage2D uses framebuffer coordinates, with the origin at bottom left.
      this.vertices[j+3]=snapshot?1-v:(Math.floor(index/4)+v)/2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1f(this.weight,weight);gl.drawElements(gl.TRIANGLES,this.count,gl.UNSIGNED_SHORT,0);
  }
  render(key,first,next,mix,previousWeight=0,idleTime=null){
    const gl=this.gl;gl.clear(gl.COLOR_BUFFER_BIT);
    const weight=this.hasPrevious?previousWeight:0,pair=this.vectors.clips[key][Math.min(first,next)];
    const reverse=first>next,forward=pair?.[reverse?1:0],backward=pair?.[reverse?0:1];
    if(first===next)this.draw(this.textures[key],first,null,0,1-weight,false,idleTime);
    else{
      this.draw(this.textures[key],first,forward,mix,(1-mix)*(1-weight));
      this.draw(this.textures[key],next,backward,1-mix,mix*(1-weight));
    }
    if(weight)this.draw(this.previousTexture,0,null,0,weight,true);
  }
}
