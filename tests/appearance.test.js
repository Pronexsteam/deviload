import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

globalThis.document = {documentElement:{}};
const {THEMES, THEME_KEY, normalizeTheme, readTheme, applyTheme, wireAppearance} = await import("../src/appearance.js");
const {t} = await import("../src/i18n.js");
const bootstrap = readFileSync(new URL("../src/theme-init.js", import.meta.url), "utf8");

class Events extends EventTarget {}
function setup(saved = "classic", blocked = false) {
  let stored = saved, writes = 0, glassStops = 0, languageStops = 0;
  const storage = {getItem(){ if (blocked) throw Error("blocked"); return stored; },
    setItem(key,value){ if(blocked) throw Error("blocked"); assert.equal(key,THEME_KEY); writes++; stored=value; }};
  const document = new Events(), window = new Events(), select = new Events();
  document.documentElement = {dataset:{},style:{}};
  select.value = "";
  const status = {textContent:""};
  document.getElementById = id => ({"appearance-theme":select,"appearance-status":status})[id];
  window.localStorage = storage;
  window.Event = Event; window.CustomEvent = CustomEvent;
  let languageListener;
  const options = {document,window,storage,glass:() => () => glassStops++,
    languageChange:listener => {languageListener=listener; return () => languageStops++;}};
  return {document,window,select,status,options,storage,setStored:value=>stored=value,
    writes:()=>writes,stops:()=>({glass:glassStops,language:languageStops}),language:()=>languageListener()};
}

test("first-paint bootstrap and runtime agree for every supported theme; untrusted preferences stay Classic", () => {
  for (const value of [...THEMES,null,"glass-light ","GLASS-LIGHT","__proto__","<script>"]) {
    const root = {dataset:{},style:{}};
    runInNewContext(bootstrap, {document:{documentElement:root},localStorage:{getItem:()=>value}});
    assert.equal(root.dataset.theme,normalizeTheme(value));
    assert.equal(root.dataset.motion,value&&THEMES.includes(value)&&value!=="classic"?"reduced":"full");
    assert.equal(root.style.colorScheme,value==="glass-light"?"light":"dark");
  }
  const root = {dataset:{},style:{}};
  runInNewContext(bootstrap,{document:{documentElement:root},get localStorage(){throw Error("blocked");}});
  assert.equal(root.dataset.theme,"classic");
  assert.equal(readTheme({getItem(){throw Error("blocked");}}),"classic");
});

test("changing themes persists appearance and motion without touching playback or requiring a reload", () => {
  const f=setup("glass-light"), notifications=[];
  f.document.addEventListener("deviload-theme-change",event=>notifications.push(event.detail.theme));
  const stop=wireAppearance(f.options);
  assert.equal(f.select.value,"glass-light");
  assert.equal(f.writes(),0);
  f.select.value="matte-black"; f.select.dispatchEvent(new Event("change"));
  assert.equal(f.storage.getItem(THEME_KEY),"matte-black");
  assert.equal(f.document.documentElement.dataset.motion,"reduced");
  f.select.value="classic"; f.select.dispatchEvent(new Event("change"));
  assert.equal(f.document.documentElement.dataset.motion,"full");
  assert.equal(f.document.documentElement.style.colorScheme,"dark");
  assert.deepEqual(notifications,["glass-light","matte-black","classic"]);
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
  f.setStored("glass-black");notify("other");assert.equal(f.select.value,"classic");
  notify(THEME_KEY,{});assert.equal(f.select.value,"classic");
  notify(THEME_KEY);assert.equal(f.select.value,"glass-black");
  f.setStored("unsupported");notify(THEME_KEY);assert.equal(f.select.value,"classic");
  f.setStored(null);notify(null);assert.equal(f.select.value,"classic");
  assert.equal(f.writes(),0);
});

test("blocked storage still applies the selected theme for this session with an honest status", () => {
  const f=setup(null,true),stop=wireAppearance(f.options);
  f.select.value="glass-light";f.select.dispatchEvent(new Event("change"));
  assert.equal(f.document.documentElement.dataset.theme,"glass-light");
  assert.equal(f.status.textContent,t("Theme applied for this session. Storage is unavailable."));
  const result=applyTheme("matte-black",{...f.options,storage:null,persist:true});
  assert.deepEqual(result,{theme:"matte-black",saved:false});
  const restored=new Event("pagehide");Object.assign(restored,{persisted:true});f.window.dispatchEvent(restored);
  assert.deepEqual(f.stops(),{glass:0,language:0});
  f.window.dispatchEvent(new Event("pagehide"));assert.deepEqual(f.stops(),{glass:1,language:1});stop();
});
