import test from 'node:test';
import assert from 'node:assert/strict';
import {createCinemaHistory,cinemaHistoryRows} from '../src/cinema-history.js';
test('Cinema history restores useful cards without persisting stream addresses or music data',()=>{
 const map=new Map([['music-profile','untouched']]);const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const history=createCinemaHistory(storage);history.remember([{id:'abcdefghijk',title:'Video',duration:60,url:'signed-secret',http_headers:{Cookie:'secret'}}]);
 assert.equal(createCinemaHistory(storage).get()[0].title,'Video');assert.equal(map.get('music-profile'),'untouched');assert(!map.get('deviload-cinema-discovery-v1').includes('secret'));
 history.remember([]);assert.equal(history.get().length,1);const copy=history.get();copy[0].title='changed';assert.equal(history.get()[0].title,'Video');
});
test('Cinema history caps metadata, rejects invalid rows and survives corrupt or unavailable storage',()=>{
 const rows=[null,{},...Array.from({length:100},(_,i)=>({id:String(i).padStart(11,'0'),title:'x'.repeat(1000),channel:'y'.repeat(1000)}))];
 const compact=cinemaHistoryRows(rows);assert.equal(compact.length,20);assert(compact.every(x=>x.title.length===300&&x.channel.length===160));
 for(const raw of ['invalid','{}','x'.repeat(40000)])assert.deepEqual(createCinemaHistory({getItem:()=>raw}).get(),[]);
 const h=createCinemaHistory();h.remember(compact);assert.equal(h.get().length,20);
});
