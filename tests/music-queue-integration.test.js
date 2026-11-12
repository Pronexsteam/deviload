import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createPlaybackOrder} from '../src/music-session.js';
import {insertNext,reorderTrack} from '../src/music-state.js';
// Line endings depend on how the checkout was made (CRLF on Windows CI), and the markers below span lines.
const source=readFileSync(new URL('../src/devil-music.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
const code=between('  function toggleShuffle(','  function renderQueue(')+between('  function syncQueue(','  function removeTrack(')+between('  function miniQueue(','  function cancelResolution(');
const miniControl=between('  window.__TAURI__?.event\n    ?.listen("music-mini-queue",','  return {\n    open(');
const song=n=>({id:String(n).padStart(11,'0'),kind:'song',title:`Song ${n}`});
function queueUI(){
 let miniHandler;const queue=Array.from({length:8},(_,n)=>song(n)),ctx={queue,current:queue[2],index:2,shuffle:true,repeat:'off',sourceRevision:0,nextPlan:null,
  order:createPlaybackOrder(()=>.7),automaticQueueIds:new Set(),insertNext,reorderTrack,musicRoom:null,cleared:null,displaySubtitle:()=>'',
  syncDock(){},persistSession(){},renderQueue(){},status(){},t:value=>value,queuePanel:{querySelector:()=>null},miniPlayer:null,roomControlsPlayback:()=>false,
  window:{__TAURI__:{event:{listen:(_name,handler)=>{miniHandler=handler;return Promise.resolve();}}}}};
 ctx.playbackCandidates=()=>ctx.queue;ctx.order.visit(queue[0].id,queue);ctx.order.visit(queue[2].id,queue);
 const actions=runInNewContext(`(()=>{${code};${miniControl};return {displayedQueue,miniQueue,move,playNext,toggleShuffle};})()`,ctx);return{ctx,...actions,miniMove:payload=>miniHandler({payload})};
}
test('main queue, mini queue, drag ordering and Next agree with shuffle enabled',()=>{
 const ui=queueUI(),shown=ui.displayedQueue();assert.equal(shown[0].id,ui.ctx.current.id);
 assert.deepEqual(Array.from(ui.miniQueue(),item=>item.id),Array.from(shown.slice(1),item=>item.id));
 const last=shown.at(-1);ui.move(last.id,1);
 assert.equal(ui.displayedQueue()[1].id,last.id);assert.equal(ui.miniQueue()[0].id,last.id);
 const next=ui.ctx.order.next(ui.ctx.queue,ui.ctx.index,false,true);assert.equal(ui.ctx.queue[next].id,last.id);
});
test('Play next can replay a heard song and dragging it changes the actual order',()=>{
 const ui=queueUI();ui.playNext(song(0));assert.equal(ui.miniQueue()[0].id,song(0).id);
 assert.equal(ui.displayedQueue()[1].id,song(0).id);
 ui.move(song(0).id,3);const shown=ui.displayedQueue();assert.equal(shown[3].id,song(0).id);
 assert.equal(ui.miniQueue()[0].id,shown[1].id);
 assert.equal(ui.ctx.queue[ui.ctx.order.next(ui.ctx.queue,ui.ctx.index,false,true)].id,shown[1].id);
});
test('repeat with a one-song library does not duplicate the current row',()=>{
 const ui=queueUI();ui.ctx.queue=[ui.ctx.current];ui.ctx.repeat='all';ui.ctx.index=0;
 assert.equal(ui.displayedQueue().length,1);
});
test('turning shuffle off preserves a dragged order and explicit Play next in both windows',()=>{
 const ui=queueUI();ui.move(song(7).id,1);ui.playNext(song(0));const before=Array.from(ui.miniQueue(),item=>item.id);
 ui.toggleShuffle();assert.equal(ui.ctx.shuffle,false);
 assert.deepEqual(Array.from(ui.miniQueue(),item=>item.id),before);
 assert.deepEqual(Array.from(ui.displayedQueue().slice(ui.ctx.index+1),item=>item.id),before);
 for(const id of before){const next=ui.ctx.order.next(ui.ctx.queue,ui.ctx.index,false,false);assert.equal(ui.ctx.queue[next].id,id);ui.ctx.index=next;ui.ctx.current=ui.ctx.queue[next];ui.ctx.order.visit(id,ui.ctx.queue);}
});
test('sequential dragging supersedes an older Play next in either window',()=>{
 for(const mini of [false,true]){
  const ui=queueUI();ui.ctx.shuffle=false;ui.playNext(song(0));
  if(mini)ui.miniMove({action:'move',id:song(0).id});else ui.move(song(0).id,ui.ctx.queue.length-1);
  const expected=ui.ctx.queue[ui.ctx.index+1].id;
  assert.notEqual(expected,song(0).id);assert.equal(ui.miniQueue()[0].id,expected);
  assert.equal(ui.ctx.queue[ui.ctx.order.next(ui.ctx.queue,ui.ctx.index,false,false)].id,expected);
  assert.equal(ui.ctx.order.previous(ui.ctx.queue),song(0).id,'reordering preserves previous history');
 }
});
