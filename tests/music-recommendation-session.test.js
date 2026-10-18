import test from "node:test";
import assert from "node:assert/strict";
import {createRecommendationSession} from "../src/music-recommendation-session.js";
import {readTaste,recommend} from "../src/music-taste.js";

const song=(n,artist=`Artist ${n}`)=>({id:String(n).padStart(11,"0"),kind:"song",title:`Song ${n}`,artists:[artist]});
const now=1800000000000,minute=60000;

test("radio seeds represent the chosen context, rotate artists and keep the request limit",()=>{
  const session=createRecommendationSession(),current=song(1,"Jazz A"),other=song(2,"Jazz B"),third=song(3,"Jazz C"),global=song(9,"Phonk");
  session.setContext([current,song(4,"Jazz A"),other,third]);
  assert.deepEqual(session.seeds(current,[global]).map(x=>x.id),[current.id,other.id]);
  const seen=new Set();for(let i=0;i<6;i++){const seeds=session.seeds(current,[global]);assert.equal(seeds.length,2);seen.add(seeds[1].id);assert.ok(!seeds.some(x=>x.id===global.id));}
  assert.ok(seen.has(other.id)&&seen.has(third.id));
  assert.deepEqual(session.seeds(current,[global],{limit:0}),[]);
  session.reset();assert.deepEqual(session.seeds(current,[global]).map(x=>x.id),[current.id,global.id]);
  session.setContext([current,...Array.from({length:80},(_,i)=>song(i+100,"Jazz A")),other,third]);
  assert.ok(session.contextItems().some(item=>item.id===other.id));
  assert.ok(session.contextItems().some(item=>item.id===third.id));
});

test("candidate merging preserves finite source/rank evidence and deduplicates without mutation",()=>{
  const session=createRecommendationSession(),a=song(1),b=song(2),c=song(3);
  const pools=[{seed:a,contextual:true,items:[a,b]},{seed:c,items:[b,c]}],copy=structuredClone(pools);
  const result=session.mergePools(pools);
  assert.deepEqual(result.items.map(x=>x.id),[a.id,b.id,c.id]);
  assert.ok(result.scores.get(b.id)>result.scores.get(c.id));
  assert.ok([...result.scores.values()].every(value=>value>=0&&value<=3));assert.deepEqual(pools,copy);
  const many=session.mergePools(Array.from({length:9},()=>({items:Array.from({length:2500},(_,i)=>song(i))})));
  assert.equal(many.items.length,2000);assert.equal(many.scores.size,2000);
  const disjoint=session.mergePools(Array.from({length:8},(_,pool)=>({items:Array.from({length:2000},(_,i)=>song(pool*2000+i))})));
  assert.equal(disjoint.items.length,2000);assert.equal(disjoint.scores.size,2000);
  assert.ok([...disjoint.scores.keys()].every(id=>disjoint.items.some(item=>item.id===id)));
});

test("visible impressions rotate recommendations without becoming dislikes or permanent exclusions",()=>{
  const session=createRecommendationSession(),profile=readTaste(),a=song(1),b=song(2),before=JSON.stringify(profile);
  session.markShown([a],now);const adjustment=session.options(now).itemAdjustments.get(a.id);
  session.markShown([a],now+1000);assert.equal(session.options(now+1000).itemAdjustments.get(a.id),adjustment*Math.exp(-1000/(60*minute)));
  assert.equal(recommend([a,b],profile,[],{now,random:()=>.5,limit:1,...session.options(now)})[0].id,b.id);
  assert.deepEqual(session.allowed([a],now),[a]);assert.equal(JSON.stringify(profile),before);
  assert.equal(session.options(now+6*60*minute).itemAdjustments.size,0);
});

test("only eligible distinct recommendation skips temporarily suppress an exact track",()=>{
  const session=createRecommendationSession(),a=song(1,"Shared"),b=song(2,"Shared");
  for(const evidence of [{intent:"navigation",seconds:8},{intent:"next",seconds:0},{intent:"next",seconds:30},{intent:"next",seconds:8,duration:20}])session.recordSkip(a,evidence,now);
  for(const sessionId of [undefined,NaN,Infinity,{},"1"])session.recordSkip(a,{intent:"next",seconds:8,duration:200,session:sessionId},now);
  assert.equal(session.options(now).itemAdjustments.size,0);
  const skip={intent:"next",seconds:8,duration:200,session:1};session.recordSkip(a,skip,now);session.recordSkip(a,skip,now+1000);
  assert.deepEqual(session.allowed([a,b],now+1000),[a,b]);
  session.recordSkip(a,{...skip,session:2},now+minute);assert.deepEqual(session.allowed([a,b],now+minute),[b]);
  assert.deepEqual(session.allowed([a,b],now+22*minute),[a,b]);
  session.recordListen(a,{seconds:35,duration:200});assert.equal(session.options(now+22*minute).itemAdjustments.has(a.id),false);
});

test("availability failures expire, permit manual recovery, and do not affect preference",()=>{
  const session=createRecommendationSession(),a=song(1),b=song(2);session.fail(a.id,now);
  assert.deepEqual(session.allowed([a,b],now),[b]);assert.equal(session.options(now).itemAdjustments.size,0);
  assert.deepEqual(session.allowed([a,b],now+91000),[a,b]);
  session.fail(a.id,now+100000);session.recover(a.id);assert.deepEqual(session.allowed([a],now+100001),[a]);
});

test("temporary state is bounded and private-boundary reset removes context and feedback",()=>{
  const session=createRecommendationSession();session.setContext(Array.from({length:100},(_,i)=>song(i)));
  assert.equal(session.contextItems().length,40);
  session.markShown(Array.from({length:900},(_,i)=>song(i)),now);assert.equal(session.options(now).itemAdjustments.size,500);
  session.recordSkip(song(999),{intent:"next",seconds:8,session:1},now);session.fail(song(998).id,now);
  const revision=session.revision;session.reset();assert.ok(session.revision>revision);
  assert.deepEqual(session.contextItems(),[]);assert.equal(session.options(now).itemAdjustments.size,0);assert.equal(session.allowed([song(998),song(999)],now).length,2);
});
