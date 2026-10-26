import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {createYouTubePlayer} from '../src/cinema-youtube-player.js';
test('isolated YouTube bridge validates parent and queues play/pause until the API is ready',()=>{
 const listeners={},commands=[],notifications=[];let options,active='';
 const parent={postMessage:data=>notifications.push(data)};
 const player={loadVideoById:arg=>commands.push(['play',arg.videoId]),cueVideoById:arg=>commands.push(['cue',arg.videoId]),pauseVideo:()=>commands.push(['pause']),getVideoData:()=>({video_id:active}),getCurrentTime:()=>12,getDuration:()=>90};
 const context={parent,location:{origin:'http://127.0.0.1:1234'},document:{createElement:()=>({}),head:{append(){}}},YT:{Player:function(id,opts){options=opts;return player;}}};
 context.window={addEventListener:(type,fn)=>listeners[type]=fn};
 runInNewContext(readFileSync(new URL('../src/cinema-youtube.js',import.meta.url),'utf8'),context);
 const message=(origin,data,source=parent)=>listeners.message({origin,source,data:{cinema:'youtube',...data}});
 message('https://evil.example',{action:'load',id:'abcdefghijk',token:1,play:true});
 context.window.onYouTubeIframeAPIReady();options.events.onReady();assert.equal(commands.length,0);
 message('http://tauri.localhost',{action:'load',id:'abcdefghijk',token:2,play:true});assert.deepEqual(commands[0],['play','abcdefghijk']);
 active='differentID';options.events.onStateChange({data:1});assert(!notifications.some(x=>x.event==='state'));
 active='abcdefghijk';options.events.onStateChange({data:1});assert.equal(notifications.at(-1).id,'abcdefghijk');assert.equal(notifications.at(-1).token,2);
 message('http://tauri.localhost',{action:'pause'});assert.equal(commands.at(-1)[0],'pause');
});
test('embedded window rejects stale and foreign messages and releases the frame on close',async()=>{
 const handlers={},states=[],failures=[],stage={classList:{add(){},remove(){}},prepend(node){this.frame=node;}};
 globalThis.window={addEventListener:(event,fn)=>handlers[event]=fn};globalThis.document={createElement:()=>({contentWindow:{postMessage(){}},setAttribute(){},remove(){this.removed=true;}})};
 let resolve;const api=createYouTubePlayer({dialog:{querySelector:()=>stage},invoke:()=>new Promise(r=>resolve=r),t:x=>x,onState:s=>states.push(s),onError:c=>failures.push(c),onBlocked(){}});
 const url='http://127.0.0.1:1234/'+'a'.repeat(48)+'/index.html';
 const start=api.start('abcdefghijk',true);api.stop();resolve(url);await start;assert(!stage.frame,'closed startup created an iframe');
 await api.start('abcdefghijk',true);const frame=stage.frame;const message=(origin,source,data)=>handlers.message({origin,source,data:{cinema:'youtube',...data}});
 message('https://evil.example',frame.contentWindow,{event:'bridge'});message('http://127.0.0.1:1234',{}, {event:'bridge'});assert.equal(states.length,0);
 // Capture the real generation sent to the bridge, without relying on its number.
 let payload;frame.contentWindow.postMessage=data=>payload=data;message('http://127.0.0.1:1234',frame.contentWindow,{event:'bridge'});assert.equal(payload.id,'abcdefghijk');
 message('http://127.0.0.1:1234',frame.contentWindow,{event:'state',token:payload.token-1,id:'abcdefghijk',state:1});assert.equal(states.length,0);
 message('http://127.0.0.1:1234',frame.contentWindow,{event:'state',token:payload.token,id:'abcdefghijk',state:1});assert.deepEqual(states,[1]);
 api.stop();assert(frame.removed);message('http://127.0.0.1:1234',frame.contentWindow,{event:'error',token:payload.token,code:100});assert.deepEqual(failures,[]);
});
