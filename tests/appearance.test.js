import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

globalThis.document = {documentElement:{}};
const {THEMES, THEME_KEY, THEME_COLLECTION_KEY, THEME_COLLECTION, normalizeTheme, readTheme, applyTheme, wireAppearance} = await import("../src/appearance.js");
const {t} = await import("../src/i18n.js");
const bootstrap = readFileSync(new URL("../src/theme-init.js", import.meta.url), "utf8");

class Events extends EventTarget {}
function setup(saved = "ambient", blocked = false, {quick = false, native = true} = {}) {
  let stored = saved, writes = 0, glassStops = 0, languageStops = 0;
  const storage = {getItem(key){ if (blocked) throw Error("blocked"); return key===THEME_COLLECTION_KEY?THEME_COLLECTION:stored; },
    setItem(key,value){ if(blocked) throw Error("blocked"); if(key===THEME_COLLECTION_KEY){assert.equal(value,THEME_COLLECTION);return;} assert.equal(key,THEME_KEY); writes++; stored=value; }};
  const document = new Events(), window = new Events(), select = new Events();
  document.documentElement = {dataset:{},style:{}};
  select.value = "";
  const status = {textContent:""};
  const quickButton = new Events(), quickMenu = new Events(), quickLabel = {}, quickStatus = {};
  quickButton.attributes = {};quickButton.setAttribute = (key,value) => quickButton.attributes[key]=value;
  quickButton.focus = () => document.activeElement=quickButton;
  quickButton.getBoundingClientRect = () => ({right:500,bottom:60});
  quickButton.contains = node => node===quickButton;
  const quickItems = THEMES.map(theme => {
    const item = new Events();item.dataset={themeChoice:theme};item.attributes={};item.label={};
    item.setAttribute = (key,value) => item.attributes[key]=value;
    item.querySelector = () => item.label;item.focus = () => document.activeElement=item;
    return item;
  });
  quickMenu.style={};quickMenu.dataset={};quickMenu.querySelectorAll=()=>quickItems;
  quickMenu.removeAttribute=()=>{};quickMenu.contains=node=>node===quickMenu||quickItems.includes(node);
  if(native){
    const toggle = state => {quickMenu.open=state==="open";const event=new Event("toggle");Object.assign(event,{newState:state});quickMenu.dispatchEvent(event);};
    quickMenu.showPopover = () => toggle("open");quickMenu.hidePopover=()=>toggle("closed");
  }
  document.querySelectorAll = () => quick ? quickItems : [];
  document.getElementById = id => ({"appearance-theme":select,"appearance-status":status,
    ...(quick?{"quick-theme-button":quickButton,"quick-theme-menu":quickMenu,"quick-theme-label":quickLabel,"quick-theme-status":quickStatus}:{})})[id];
  window.localStorage = storage;
  window.innerWidth=1024;window.innerHeight=800;
  window.Event = Event; window.CustomEvent = CustomEvent;
  let languageListener;
  const options = {document,window,storage,glass:() => () => glassStops++,
    languageChange:listener => {languageListener=listener; return () => languageStops++;}};
  return {document,window,select,status,options,storage,quickButton,quickMenu,quickItems,quickLabel,quickStatus,setStored:value=>stored=value,
    writes:()=>writes,stops:()=>({glass:glassStops,language:languageStops}),language:()=>languageListener()};
}

test("first-paint bootstrap and runtime default to Ambient and preserve every explicit supported theme", () => {
  for (const value of [...THEMES,null,"classic","glass-light ","GLASS-LIGHT","__proto__","<script>"]) {
    const root = {dataset:{},style:{}};
    runInNewContext(bootstrap, {document:{documentElement:root},localStorage:{getItem:key=>key===THEME_COLLECTION_KEY?THEME_COLLECTION:value}});
    assert.equal(root.dataset.theme,normalizeTheme(value));
    assert.equal(root.dataset.motion,"reduced");
    assert.equal(root.style.colorScheme,value==="glass-light"?"light":"dark");
  }
  const root = {dataset:{},style:{}};
  runInNewContext(bootstrap,{document:{documentElement:root},get localStorage(){throw Error("blocked");}});
  assert.equal(root.dataset.theme,"ambient");
  assert.equal(readTheme({getItem(){throw Error("blocked");}}),"ambient");
  assert.equal(readTheme({getItem:()=>null}),"ambient");
  for(const theme of THEMES)assert.equal(readTheme({getItem:key=>key===THEME_COLLECTION_KEY?THEME_COLLECTION:theme}),theme);
});

test("the quick radio menu and Settings share theme selection, storage updates and persistence", () => {
  const f=setup("glass-light",false,{quick:true}), stop=wireAppearance(f.options);
  const item=value=>f.quickItems.find(node=>node.dataset.themeChoice===value);
  assert.equal(item("glass-light").attributes["aria-checked"],"true");
  assert.equal(item("aurora").attributes["aria-checked"],"false");
  f.quickButton.dispatchEvent(new Event("click"));
  assert.equal(f.quickMenu.open,true);assert.equal(f.document.activeElement,item("glass-light"));
  item("aurora").dispatchEvent(new Event("click"));
  assert.equal(f.select.value,"aurora");assert.equal(f.storage.getItem(THEME_KEY),"aurora");
  assert.equal(f.document.documentElement.dataset.theme,"aurora");
  assert.equal(item("aurora").attributes["aria-checked"],"true");
  assert.equal(item("glass-light").attributes["aria-checked"],"false");
  assert.equal(f.quickMenu.open,false);assert.equal(f.document.activeElement,f.quickButton);
  f.select.value="ambient";f.select.dispatchEvent(new Event("change"));
  assert.equal(item("ambient").attributes["aria-checked"],"true");
  f.setStored("prism");const update=new Event("storage");Object.assign(update,{key:THEME_KEY,storageArea:f.storage});f.window.dispatchEvent(update);
  assert.equal(f.select.value,"prism");assert.equal(item("prism").attributes["aria-checked"],"true");
  assert.equal(f.writes(),2);stop();
});

test("the quick menu supports arrow navigation, Home, End and Escape without changing a theme on focus", () => {
  const f=setup("aurora",false,{quick:true}), stop=wireAppearance(f.options);
  const key=(target,value)=>{const event=new Event("keydown",{cancelable:true});Object.defineProperty(event,"target",{value:target});Object.defineProperty(event,"key",{value});(target===f.quickButton?target:f.quickMenu).dispatchEvent(event);return event;};
  key(f.quickButton,"ArrowDown");assert.equal(f.quickMenu.open,true);assert.equal(f.document.activeElement,f.quickItems[0]);
  key(f.quickItems[0],"ArrowUp");assert.equal(f.document.activeElement,f.quickItems.at(-1));
  key(f.quickItems.at(-1),"Home");assert.equal(f.document.activeElement,f.quickItems[0]);
  key(f.quickItems[0],"End");assert.equal(f.document.activeElement,f.quickItems.at(-1));
  assert.equal(f.writes(),0);assert.equal(f.select.value,"aurora");
  assert.equal(key(f.quickItems.at(-1),"Escape").defaultPrevented,true);
  assert.equal(f.quickMenu.open,false);assert.equal(f.quickButton.attributes["aria-expanded"],"false");
  assert.equal(f.document.activeElement,f.quickButton);
  stop();f.quickButton.dispatchEvent(new Event("click"));assert.equal(f.quickMenu.open,false);
});

test("the quick chooser has a session-only fallback when popovers or storage are unavailable", () => {
  const f=setup(null,true,{quick:true,native:false}), stop=wireAppearance(f.options);
  f.quickButton.dispatchEvent(new Event("click"));assert.equal(f.quickMenu.hidden,false);
  f.quickItems.find(item=>item.dataset.themeChoice==="aurora").dispatchEvent(new Event("click"));
  assert.equal(f.quickMenu.hidden,true);assert.equal(f.document.documentElement.dataset.theme,"aurora");
  assert.equal(f.quickStatus.textContent,t("Theme applied for this session. Storage is unavailable."));
  assert.equal(f.status.textContent,f.quickStatus.textContent);stop();
});

test("changing themes persists appearance and motion without touching playback or requiring a reload", () => {
  const f=setup("glass-light"), notifications=[];
  f.document.addEventListener("deviload-theme-change",event=>notifications.push(event.detail.theme));
  const stop=wireAppearance(f.options);
  assert.equal(f.select.value,"glass-light");
  assert.equal(f.writes(),0);
  f.select.value="ambient"; f.select.dispatchEvent(new Event("change"));
  assert.equal(f.storage.getItem(THEME_KEY),"ambient");
  assert.equal(f.document.documentElement.dataset.motion,"reduced");
  f.select.value="classic"; f.select.dispatchEvent(new Event("change"));
  assert.equal(f.document.documentElement.dataset.motion,"reduced");
  assert.equal(f.document.documentElement.style.colorScheme,"dark");
  assert.deepEqual(notifications,["glass-light","ambient"]);
  assert.equal(f.writes(),2);
  assert.equal(wireAppearance(f.options),stop);
  f.language(); assert.equal(f.status.textContent,t("Your theme is saved on this device."));
  stop();stop();assert.deepEqual(f.stops(),{glass:1,language:1});
  f.select.dispatchEvent(new Event("change")); assert.equal(f.writes(),2);
});

test("open tool windows follow storage updates, clearing and invalid preferences without a write loop", () => {
  const f=setup(); wireAppearance(f.options);
  const notify=(key,area=f.storage)=>{
    const event=new Event("storage");Object.assign(event,{key,storageArea:area});f.window.dispatchEvent(event);
  };
  f.setStored("prism");notify("other");assert.equal(f.select.value,"ambient");
  notify(THEME_KEY,{});assert.equal(f.select.value,"ambient");
  notify(THEME_KEY);assert.equal(f.select.value,"prism");
  f.setStored("unsupported");notify(THEME_KEY);assert.equal(f.select.value,"ambient");
  f.setStored(null);notify(null);assert.equal(f.select.value,"ambient");
  assert.equal(f.writes(),0);
});
test("reselecting the same theme preserves settings without restarting visual listeners",()=>{
 const f=setup(),themes=[],motions=[];
 f.document.addEventListener("deviload-theme-change",e=>themes.push(e.detail.theme));
 f.document.addEventListener("deviload-motion-change",()=>motions.push(true));
 wireAppearance(f.options);
 for(let i=0;i<5;i++){f.select.value="ambient";f.select.dispatchEvent(new Event("change"));}
 assert.deepEqual(themes,["ambient"]);assert.equal(motions.length,1);assert.equal(f.storage.getItem(THEME_KEY),"ambient");
 for(const theme of ["aurora","prism","glass-light","ambient"]){f.select.value=theme;f.select.dispatchEvent(new Event("change"));}
 assert.deepEqual(themes,["ambient","aurora","prism","glass-light","ambient"]);assert.equal(motions.length,1);
});

test("blocked storage still applies the selected theme for this session with an honest status", () => {
  const f=setup(null,true),stop=wireAppearance(f.options);
  f.select.value="glass-light";f.select.dispatchEvent(new Event("change"));
  assert.equal(f.document.documentElement.dataset.theme,"glass-light");
  assert.equal(f.status.textContent,t("Theme applied for this session. Storage is unavailable."));
  const result=applyTheme("ambient",{...f.options,storage:null,persist:true});
  assert.deepEqual(result,{theme:"ambient",saved:false});
  const restored=new Event("pagehide");Object.assign(restored,{persisted:true});f.window.dispatchEvent(restored);
  assert.deepEqual(f.stops(),{glass:0,language:0});
  f.window.dispatchEvent(new Event("pagehide"));assert.deepEqual(f.stops(),{glass:1,language:1});stop();
});

test("collection migration forces Ambient exactly once and leaves unrelated settings intact",()=>{
 for(const previous of [null,"glass-light","matte-black","glass-black","midnight","spotify","classic","aurora","prism"]){
  const values=new Map([[THEME_KEY,previous],["deviload-lang","ru"],["music-profile","unchanged"]]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(readTheme(storage),"ambient");
  assert.equal(values.get(THEME_KEY),"ambient");assert.equal(values.get(THEME_COLLECTION_KEY),THEME_COLLECTION);
  assert.equal(values.get("deviload-lang"),"ru");assert.equal(values.get("music-profile"),"unchanged");
  for(const selected of THEMES){
   values.set(THEME_KEY,selected);
   const root={dataset:{},style:{}};
   runInNewContext(bootstrap,{document:{documentElement:root},localStorage:storage});
   assert.equal(root.dataset.theme,selected);assert.equal(readTheme(storage),selected);
  }
 }
 assert.deepEqual(THEMES,["ambient","glass-light","aurora","prism"]);
});
test("first paint performs the same migration before any runtime UI initializes",()=>{
 const values=new Map([[THEME_KEY,"glass-light"]]),writes=[];
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);}};
 const root={dataset:{},style:{}};
 runInNewContext(bootstrap,{document:{documentElement:root},localStorage:storage});
 assert.equal(root.dataset.theme,"ambient");assert.deepEqual(writes,[THEME_KEY,THEME_COLLECTION_KEY]);
 values.set(THEME_KEY,"prism");runInNewContext(bootstrap,{document:{documentElement:root},localStorage:storage});
 assert.equal(root.dataset.theme,"prism");assert.equal(writes.length,2);
});
