import test from "node:test";
import assert from "node:assert/strict";
import {createAppUpdateScheduler,isAppUpdateDismissed,dismissAppUpdate,clearAppUpdateDismissal,updateDownloadProgress,APP_UPDATE_INTERVAL,APP_UPDATE_RETRY,APP_UPDATE_SNOOZE} from "../src/app-update-prompt.js";

const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick = () => new Promise(resolve=>setImmediate(resolve));
test("startup, focus and manual checks share one native request and successful checks throttle for one hour",async()=>{
 let time=1000,calls=0;const request=deferred(),updates=[];
 const scheduler=createAppUpdateScheduler({check:()=>{calls++;return request.promise;},onUpdate:update=>updates.push(update),now:()=>time});
 const first=scheduler.check(),second=scheduler.check({manual:true});assert.equal(first,second);await tick();assert.equal(calls,1);
 request.resolve({version:"9.0.0",installable:true});await first;assert.equal(updates.length,1);
 time+=APP_UPDATE_INTERVAL-1;await scheduler.check();assert.equal(calls,1);
 time++;await scheduler.check();assert.equal(calls,2);
 await scheduler.check({manual:true});assert.equal(calls,3);
});
test("automatic failures back off without erasing a known update; manual retry is immediate",async()=>{
 let time=1,calls=0;const available={version:"3.0.0"};
 const scheduler=createAppUpdateScheduler({check:async()=>{calls++;if(calls===1)return available;throw Error("offline");},now:()=>time});
 await scheduler.check();time+=APP_UPDATE_INTERVAL;
 await assert.rejects(scheduler.check(),/offline/);assert.equal(scheduler.state.available,available);
 time+=APP_UPDATE_RETRY-1;await scheduler.check();assert.equal(calls,2);
 await assert.rejects(scheduler.check({manual:true}),/offline/);assert.equal(calls,3);
});
test("installation reserves the gate before waiting for a check and no background check can replace its handle",async()=>{
 const request=deferred();let calls=0;
 const scheduler=createAppUpdateScheduler({check:()=>{calls++;return request.promise;}});
 const pending=scheduler.check();await tick();const reserved=scheduler.holdInstall();
 assert.equal(scheduler.state.installing,true);await scheduler.check({manual:true});assert.equal(calls,1);
 assert.equal(await scheduler.holdInstall(),false);
 request.resolve({version:"3.0.1",installable:true});await pending;assert.equal(await reserved,true);
 await scheduler.check({manual:true});assert.equal(calls,1);
 scheduler.releaseInstall({recheck:true});await scheduler.check();assert.equal(calls,2);
});
test("Later dismisses only that version for six hours and works with blocked storage",()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 dismissAppUpdate(storage,"2.8.0",1000);assert.equal(isAppUpdateDismissed(storage,"2.8.0",1001),true);
 assert.equal(isAppUpdateDismissed(storage,"2.8.1",1001),false);
 assert.equal(isAppUpdateDismissed(storage,"2.8.0",1000+APP_UPDATE_SNOOZE),false);
 clearAppUpdateDismissal(storage);assert.equal(isAppUpdateDismissed(storage,"2.8.0",1001),false);
 const broken={getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();}};
 assert.doesNotThrow(()=>dismissAppUpdate(broken,"3.0.0"));assert.equal(isAppUpdateDismissed(broken,"3.0.0"),true);assert.doesNotThrow(()=>clearAppUpdateDismissal(broken));assert.equal(isAppUpdateDismissed(broken,"3.0.0"),false);
});
test("progress remains bounded and reaches installing only after download completion",()=>{
 assert.deepEqual(updateDownloadProgress(.432),{percent:43,phase:"downloading"});
 assert.deepEqual(updateDownloadProgress(1),{percent:100,phase:"installing"});
 assert.deepEqual(updateDownloadProgress(9),{percent:100,phase:"installing"});
 assert.deepEqual(updateDownloadProgress(-1),{percent:0,phase:"downloading"});
 assert.deepEqual(updateDownloadProgress(NaN),{percent:0,phase:"downloading"});
});
test("storage-denied Later stays version-specific, expires after six hours and manual clear reopens it",()=>{
 const storage={getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");},removeItem:()=>{throw Error("blocked");}};
 clearAppUpdateDismissal(storage);
 dismissAppUpdate(storage,"3.1.0",1000);
 assert.equal(isAppUpdateDismissed(storage,"3.1.0",1001),true);
 assert.equal(isAppUpdateDismissed(storage,"3.1.1",1001),false);
 assert.equal(isAppUpdateDismissed(storage,"3.1.0",1000+APP_UPDATE_SNOOZE-1),true);
 assert.equal(isAppUpdateDismissed(storage,"3.1.0",1000+APP_UPDATE_SNOOZE),false);
 dismissAppUpdate(storage,"3.1.0",2000);clearAppUpdateDismissal(storage);
 assert.equal(isAppUpdateDismissed(storage,"3.1.0",2001),false);
});
test("start listens once, checks visible focus only when due, and disposal removes timers and listeners",async()=>{
 const listeners={},removed=[],timers={},cleared=[];let calls=0,time=0;
 const host={addEventListener:(key,fn)=>listeners[key]=fn,removeEventListener:(key,fn)=>removed.push([key,fn])};
 const page={visibilityState:"visible",...host};
 const clock={setTimeout:fn=>(timers.start=fn,1),setInterval:fn=>(timers.interval=fn,2),clearTimeout:id=>cleared.push(id),clearInterval:id=>cleared.push(id)};
 const scheduler=createAppUpdateScheduler({check:async()=>{calls++;return null;},now:()=>time});
 const stop=scheduler.start({window:host,document:page,timers:clock});assert.equal(scheduler.start({window:host,document:page,timers:clock}),stop);
 timers.start();listeners.focus();await tick();assert.equal(calls,1);
 time+=APP_UPDATE_INTERVAL;page.visibilityState="hidden";listeners.focus();timers.interval();await tick();assert.equal(calls,1);
 page.visibilityState="visible";listeners.visibilitychange();await tick();assert.equal(calls,2);
 stop();assert.deepEqual(cleared,[1,2]);assert.equal(removed.length,3);
});
