import test from 'node:test';
import assert from 'node:assert/strict';
import {musicShortcut} from '../src/music-shortcuts.js';

const target=(match=null)=>({closest:selector=>match&&selector.split(',').some(part=>part.trim().startsWith(match.tag))?match:null});
const press=(code,extra={})=>({code,key:'',target:target(),...extra});

test('letter shortcuts follow the physical key, so a Russian layout works too',()=>{
 assert.equal(musicShortcut(press('KeyL',{key:'\u0434'})),'like');
 assert.equal(musicShortcut(press('KeyM',{key:'\u044c'})),'mute');
 assert.equal(musicShortcut(press('KeyL',{repeat:true})),null);
});

test('typing never triggers a shortcut, while a slider keeps letters and its own arrows',()=>{
 assert.equal(musicShortcut(press('KeyL',{target:target({tag:'input',tagName:'INPUT',type:'search'})})),null);
 assert.equal(musicShortcut(press('Space',{target:target({tag:'textarea',tagName:'TEXTAREA'})})),null);
 const slider=target({tag:'input',tagName:'INPUT',type:'range'});
 assert.equal(musicShortcut(press('KeyM',{target:slider})),'mute');
 assert.equal(musicShortcut(press('ArrowLeft',{target:slider})),null);
});

test('space and plain arrows stay with a focused button',()=>{
 const focused=target({tag:'button',tagName:'BUTTON'});
 assert.equal(musicShortcut(press('Space',{target:focused})),null);
 assert.equal(musicShortcut(press('ArrowRight',{target:focused})),null);
 assert.equal(musicShortcut(press('Space')),'play');
 assert.equal(musicShortcut(press('ArrowRight')),'forward');
});

test('ctrl arrows change track and volume, other modifiers are left alone',()=>{
 assert.equal(musicShortcut(press('ArrowRight',{ctrlKey:true})),'next');
 assert.equal(musicShortcut(press('ArrowDown',{ctrlKey:true})),'quieter');
 assert.equal(musicShortcut(press('KeyL',{ctrlKey:true})),null);
 assert.equal(musicShortcut(press('KeyL',{altKey:true})),null);
 assert.equal(musicShortcut(press('KeyL',{shiftKey:true})),null);
 assert.equal(musicShortcut(press('Slash',{key:'?',shiftKey:true})),'help');
});
