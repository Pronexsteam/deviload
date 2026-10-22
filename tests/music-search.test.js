import test from "node:test";
import assert from "node:assert/strict";
import {wireMusicSearch} from "../src/music-search.js";

function fixture(platform="Windows"){
  const form=new EventTarget(),input=new EventTarget(),clear=new EventTarget(),page=new EventTarget(),queries=[],routes=[];
  let active=true,modal=false,focused=false,selections=0;
  Object.assign(input,{value:"",attributes:{},setAttribute(key,value){this.attributes[key]=value;},focus(){focused=true;},blur(){focused=false;},select(){selections++;}});
  clear.hidden=true;const shortcut={textContent:""};page.querySelector=()=>modal?{}:null;
  const search=wireMusicSearch({form,input,clear,shortcut,page,platform,isActive:()=>active,onSearch:query=>{queries.push(query);search.sync(query);},onClear:()=>{routes.push("home");search.sync("");}});
  function event(target,type,properties={}){const event=new Event(type,{cancelable:true});Object.assign(event,properties);target.dispatchEvent(event);return event;}
  return {form,input,clear,page,queries,routes,shortcut,search,event,focused:()=>focused,selections:()=>selections,
    type(value){input.value=value;event(input,"input");},submit(){return event(form,"submit");},
    key(key,properties={}){const event=new Event("keydown",{cancelable:true});Object.defineProperty(event,"target",{value:properties.target||input});Object.assign(event,{key,...properties});page.dispatchEvent(event);return event;},
    active(value){active=value;},modal(value){modal=value;}};
}

test("typing is a draft; submit normalizes its edges and coalesces the current query, including while loading",()=>{
  const h=fixture();h.type("  Daft Punk  ");assert.deepEqual(h.queries,[]);assert.equal(h.clear.hidden,false);
  assert.equal(h.submit().defaultPrevented,true);assert.deepEqual(h.queries,["Daft Punk"]);assert.equal(h.input.value,"Daft Punk");
  h.submit();h.type(" Daft Punk ");h.submit();assert.deepEqual(h.queries,["Daft Punk"]);
  h.type("Massive Attack");h.submit();assert.deepEqual(h.queries,["Daft Punk","Massive Attack"]);
});

test("route synchronization restores a previous query and leaving search clears the displayed label without fetching",()=>{
  const h=fixture();h.search.sync("First query");h.type("Unsubmitted draft");h.search.sync("Second query");
  h.search.sync("First query");assert.equal(h.input.value,"First query");assert.equal(h.clear.hidden,false);
  h.search.sync("");assert.equal(h.input.value,"");assert.equal(h.clear.hidden,true);assert.deepEqual(h.queries,[]);
});

test("failed search can be retried with Enter while successful unchanged results require no duplicate request",()=>{
  const h=fixture();h.search.sync("Jazz");h.submit();assert.deepEqual(h.queries,[]);
  h.search.allowRetry();h.submit();h.submit();assert.deepEqual(h.queries,["Jazz"]);
});

test("confirming IME text does not submit an unfinished query",()=>{
  const h=fixture();h.event(h.input,"compositionstart");h.type("東京");h.submit();
  assert.deepEqual(h.queries,[]);h.event(h.input,"compositionend");h.submit();assert.deepEqual(h.queries,["東京"]);
});

test("clear and Escape reset the draft and Escape in an empty field removes focus without another route",()=>{
  const h=fixture();h.type("Jazz");h.event(h.clear,"click");assert.equal(h.input.value,"");assert.equal(h.clear.hidden,true);assert.equal(h.focused(),true);
  h.type("Rock");assert.equal(h.key("Escape").defaultPrevented,true);assert.equal(h.input.value,"");assert.equal(h.focused(),true);
  const routes=h.routes.length;h.key("Escape");assert.equal(h.focused(),false);assert.equal(h.routes.length,routes);assert.deepEqual(h.queries,[]);
});

test("native search cancellation returns from search without issuing an empty search",()=>{
  const h=fixture();h.search.sync("Jazz");h.type("");h.event(h.input,"search");
  assert.deepEqual(h.queries,[]);assert.deepEqual(h.routes,["home"]);assert.equal(h.clear.hidden,true);
});

test("Control/Cmd K focuses and selects Music search only on its active page outside dialogs",()=>{
  for(const platform of ["Windows","MacIntel"]){
    const h=fixture(platform);h.type("Jazz");const event=h.key("k",platform==="Windows"?{ctrlKey:true}:{metaKey:true});
    assert.equal(event.defaultPrevented,true);assert.equal(h.focused(),true);assert.equal(h.selections(),1);
    assert.equal(h.shortcut.textContent,platform==="Windows"?"Ctrl K":"⌘ K");assert.equal(h.input.attributes["aria-keyshortcuts"],"Control+K Meta+K");
    h.active(false);assert.equal(h.key("k",{ctrlKey:true}).defaultPrevented,false);h.active(true);h.modal(true);
    assert.equal(h.key("k",{ctrlKey:true}).defaultPrevented,false);assert.equal(h.key("Escape").defaultPrevented,false);
    h.modal(false);assert.equal(h.key("k",{ctrlKey:true,altKey:true}).defaultPrevented,false);
    assert.equal(h.key("k",{ctrlKey:true,isComposing:true}).defaultPrevented,false);assert.equal(h.selections(),1);
    assert.deepEqual(h.queries,[]);assert.deepEqual(h.routes,[]);
  }
});

test("destroy removes handlers so recreating a Music workspace cannot duplicate search or shortcut actions",()=>{
  const h=fixture();h.search.destroy();h.type("Jazz");h.submit();h.key("k",{ctrlKey:true});
  assert.deepEqual(h.queries,[]);assert.equal(h.focused(),false);
});
