import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackCandidates} from '../src/music-playback-candidates.js';
import {createRecommendationSession} from '../src/music-recommendation-session.js';
const song=n=>({id:String(n).padStart(11,'0'),title:`Song ${n}`,kind:'song',artists:['Artist']});

test('large manual queues bypass recommendation scans and keep their array identity',()=>{
 const queue=Array.from({length:5000},(_,n)=>song(n));
 const fail=()=>assert.fail('manual metadata must not be resolved or ranked');
 assert.equal(playbackCandidates(queue,{automatic:new Set(),family:fail,source:fail,allowed:fail}),queue);
});

test('automatic songs after 2000 manual entries remain eligible and only automatic aliases are probed',()=>{
 const queue=Array.from({length:2500},(_,n)=>song(n)),session=createRecommendationSession();let probes=0;
 const options={automatic:new Set([queue[2499].id]),allowed:items=>{probes+=items.length;return session.allowed(items);}};
 assert.equal(playbackCandidates(queue,options),queue);assert.equal(probes,1);
 session.fail(queue[2499].id);
 assert.equal(playbackCandidates(queue,options).length,2499);
});

test('automatic aliases respect temporary failures, hidden songs and source artists without filtering manual choices',()=>{
 const queue=[song(1),song(2),song(3),song(4)],automatic=new Set(queue.map(item=>item.id)),session=createRecommendationSession();
 const alias=song(9).id;session.fail(alias);
 const options={automatic,currentId:queue[0].id,family:id=>id===queue[1].id?[id,alias]:[id],hidden:[queue[0].id,queue[2].id],blocked:['blocked'],source:item=>({...item,artists:['blocked']}),allowed:items=>session.allowed(items)};
 assert.deepEqual(playbackCandidates(queue,options),[queue[0]]);
 automatic.delete(queue[1].id);assert.deepEqual(playbackCandidates(queue,options),queue.slice(0,2));
});

test('automatic eligibility batches large queues without silently dropping their tail',()=>{
 const queue=Array.from({length:4500},(_,n)=>song(n)),session=createRecommendationSession(),batches=[];
 assert.equal(playbackCandidates(queue,{automatic:new Set(queue.map(item=>item.id)),allowed:items=>{batches.push(items.length);return session.allowed(items);}}),queue);
 assert.deepEqual(batches,[2000,2000,500]);
});
