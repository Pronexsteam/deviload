import {recommendWithReasons} from "./music-taste.js";
import {rankInterestMix} from "./music-interest-mixes.js";
import {createRecordingView} from "./music-recording-view.js";

function mappedScores(values,view,negative=false){
  if(!(values instanceof Map))return undefined;
  const mapped=new Map();
  for(const [id,value]of values){
    if(!Number.isFinite(value))continue;
    const key=view.ids([id])[0];if(!key)continue;
    mapped.set(key,negative?Math.min(mapped.get(key)||0,value):Math.max(mapped.get(key)||0,value));
  }
  return mapped;
}

function eligibleFamilies(candidates,view,eligible){
  if(typeof eligible!=="function")return candidates;
  const probes=[...candidates],seen=new Set(probes.map(item=>item.id)),families=new Map();
  // Confirmed bindings contain at most 400 distinct IDs in total. Probe those
  // aliases with the same eligibility rules, so a failed/skipped physical upload
  // cannot return under its logical ID. No metadata matching creates aliases.
  for(const item of candidates){
    const family=view.familyIds(item.id);families.set(item.id,family);
    for(const id of family)if(!seen.has(id)){seen.add(id);probes.push({...item,id});}
  }
  const allowed=new Set();
  // The session gate intentionally accepts only 2,000 items per invocation.
  // Keep that bound while checking the small set of extra alias probes too.
  for(let start=0;start<probes.length;start+=2000){
    const result=eligible(probes.slice(start,start+2000));
    for(const item of Array.isArray(result)?result:[])if(seen.has(item?.id))allowed.add(item.id);
  }
  return candidates.filter(item=>families.get(item.id).every(id=>allowed.has(id)));
}

// Adapt confirmed source aliases once per ranking, then apply either the global
// taste or one explicitly selected interest. The actual manual queue is never changed.
export function rankMusicRecommendations(items,saved,taste,{interestId,queue=[],eligible, ...options}={}){
  const recording=createRecordingView(saved,taste,{queue,now:options.now});
  const candidates=recording.items(items),allowed=eligibleFamilies(candidates,recording,eligible);
  const ranking={...options,exclude:recording.ids(options.exclude||[]),
    sessionItems:recording.items(options.sessionItems||[]),contextItems:recording.items(options.contextItems||[]),
    candidateScores:mappedScores(options.candidateScores,recording),itemAdjustments:mappedScores(options.itemAdjustments,recording,true)};
  return interestId?rankInterestMix(allowed,recording.saved,recording.taste,interestId,ranking):
    recommendWithReasons(allowed,recording.taste,recording.saved.favorites,ranking);
}
