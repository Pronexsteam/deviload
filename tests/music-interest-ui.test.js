import test from "node:test";
import assert from "node:assert/strict";

class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.attributes={};this.className="";this.textContent="";this.disabled=false;this.isConnected=false;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);node.connect(this.isConnected);}}
  connect(value){this.isConnected=value;for(const child of this.children)child.connect(value);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(name,fn){const listeners=this.listeners.get(name)||[];listeners.push(fn);this.listeners.set(name,listeners);}
  emit(name){const event={target:this,preventDefault(){}};for(const fn of this.listeners.get(name)||[])fn(event);}
  querySelector(selector){return descendants(this).find(node=>selector==="[role=alert]"&&node.attributes.role==="alert")||null;}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit("close");}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.connect(false);}
  set innerHTML(_){throw Error("Interest UI must use textContent, never HTML from saved names");}
}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function setupDom(){const body=new Node("body");body.connect(true);globalThis.document={body,documentElement:{},activeElement:null,createElement:tag=>new Node(tag)};return body;}
setupDom();globalThis.localStorage={getItem:()=>"en"};
const {createInterestMixesUI}=await import("../src/music-interest-ui.js");
const {rememberInterestTrack}=await import("../src/music-interest-mixes.js");
const song=n=>({kind:"song",id:String(n).padStart(11,"0"),title:`Track ${n}`,artists:["Artist"]});
const playlist=(id,items=[song(1)])=>({id,name:`Playlist ${id}`,items});
function setup(saved={playlists:[playlist("a"),playlist("b")],interestMixes:[]}){
  setupDom();const opens=[],notices=[],writes=[];let succeeds=true;
  const button=(label,glyph,action,cls="")=>{const node=new Node("button");node.type="button";node.textContent=label;node.className=cls;node.addEventListener("click",action);return node;};
  const ui=createInterestMixesUI({saved,button,cover:item=>{const node=new Node("span");node.textContent=item?.title||"art";return node;},
    commit:next=>{writes.push(next);if(!succeeds)return false;saved.interestMixes=next;return true;},onOpen:id=>opens.push(id),notify:(message,error=false)=>notices.push({message,error})});
  return {saved,ui,opens,notices,writes,setSucceeds:value=>{succeeds=value;}};
}
const all=(node,predicate)=>descendants(node).filter(predicate);
const input=modal=>all(modal,node=>node.tagName==="INPUT"&&node.type==="text")[0];
const form=modal=>all(modal,node=>node.tagName==="FORM")[0];
const action=(root,label)=>all(root,node=>node.tagName==="BUTTON"&&node.textContent===label)[0];
const currentDialog=()=>document.body.children.find(node=>node.tagName==="DIALOG"&&node.open);

test("failed storage keeps the draft open and cannot pretend the mix was saved or mutate playlists",()=>{
  const app=setup(),before=JSON.stringify(app.saved.playlists);app.setSucceeds(false);
  const modal=app.ui.edit(null,"a");input(modal).value="<script>Focus</script>";form(modal).emit("submit");
  assert.equal(modal.open,true);assert.equal(app.opens.length,0);assert.deepEqual(app.saved.interestMixes,[]);
  assert.ok(modal.querySelector("[role=alert]").textContent.includes("Could not save"));
  app.setSucceeds(true);form(modal).emit("submit");
  assert.equal(modal.open,false);assert.equal(app.saved.interestMixes.length,1);assert.equal(app.opens[0],app.saved.interestMixes[0].id);
  assert.equal(app.saved.interestMixes[0].name,"<script>Focus</script>");assert.deepEqual(app.saved.interestMixes[0].playlistIds,["a"]);
  assert.equal(JSON.stringify(app.saved.playlists),before);
  const root=new Node("div");document.body.append(root);app.ui.render(root);
  const title=all(root,node=>node.textContent==="<script>Focus</script>")[0];assert.ok(title);assert.equal(title.attributes.translate,"no");
  assert.ok(action(root,"Open mix").className.includes("music-text-button"));
});

test("the editor enforces eight selected playlist refs and re-enables choices after deselection",()=>{
  const app=setup({playlists:Array.from({length:10},(_,i)=>playlist(`p${i}`)),interestMixes:[]});
  const modal=app.ui.edit(),boxes=all(modal,node=>node.tagName==="INPUT"&&node.type==="checkbox");
  assert.equal(all(modal,node=>node.tagName==="STRONG"&&node.textContent==="Playlist p0")[0].attributes.translate,"no");
  input(modal).value="Many";input(modal).emit("input");
  assert.equal(action(modal,"Save mix").disabled,true);
  for(const box of boxes.slice(0,8)){box.checked=true;box.emit("change");}
  assert.equal(boxes[8].disabled,true);boxes[8].checked=true;boxes[8].emit("change");assert.equal(boxes[8].checked,false);
  boxes[0].checked=false;boxes[0].emit("change");assert.equal(boxes[8].disabled,false);
  boxes[8].checked=true;boxes[8].emit("change");form(modal).emit("submit");
  assert.equal(app.saved.interestMixes[0].playlistIds.length,8);assert.ok(!app.saved.interestMixes[0].playlistIds.includes("p0"));
});

test("saving an open editor preserves discoveries added by qualified playback after the editor opened",()=>{
  const saved={playlists:[playlist("a")],interestMixes:[{id:"work",name:"Work",playlistIds:["a"],learnedIds:[song(10).id]}]},app=setup(saved);
  const modal=app.ui.edit("work");input(modal).value="Renamed";
  saved.interestMixes=rememberInterestTrack(saved.interestMixes,"work",song(11).id);
  form(modal).emit("submit");assert.deepEqual(saved.interestMixes[0].learnedIds,[song(11).id,song(10).id]);
  assert.equal(saved.interestMixes[0].name,"Renamed");
});

test("deleting a mix requires its own action and removes only that config",()=>{
  const saved={playlists:[playlist("a")],interestMixes:[{id:"work",name:"Work",playlistIds:["a"]}]},app=setup(saved),before=JSON.stringify(saved.playlists);
  const modal=app.ui.edit("work");action(modal,"Delete interest mix").emit("click");
  const confirmation=currentDialog();assert.notEqual(confirmation,modal);assert.equal(saved.interestMixes.length,1);
  action(confirmation,"Delete interest mix").emit("click");assert.deepEqual(saved.interestMixes,[]);assert.equal(JSON.stringify(saved.playlists),before);assert.deepEqual(app.opens,[null]);
});

test("compact home stays quiet without mixes; full library explains missing sources and keeps edit available",()=>{
  const app=setup({playlists:[],interestMixes:[]}),root=new Node("div");document.body.append(root);
  assert.equal(app.ui.render(root,{compact:true}),null);assert.equal(root.children.length,0);
  app.ui.render(root);assert.equal(action(root,"Create interest mix").disabled,true);
  assert.ok(all(root,node=>node.textContent.includes("Create a playlist first")).length);
  app.saved.interestMixes=[{id:"empty",name:"Empty",playlistIds:["gone"]}];
  const another=new Node("div");document.body.append(another);app.ui.render(another);
  assert.equal(action(another,"Open mix").disabled,true);assert.equal(action(another,"Edit interest mix").disabled,false);
});
