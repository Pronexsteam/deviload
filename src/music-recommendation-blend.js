const MINUTE=60000,MAX_FEEDBACK=32,WINDOW=90*MINUTE,HALF_LIFE=30*MINUTE;
const modes={balanced:{base:1/3,min:.22,max:.46},familiar:{base:1/6,min:.12,max:.24},discovery:{base:.5,min:.4,max:.64}};
const validId=value=>typeof value==="string"&&/^[\w-]{11}$/.test(value);

// A small, ephemeral two-cohort estimate: finishing unfamiliar songs can earn
// more discovery slots; repeatedly skipping them can reduce, never remove them.
// Neutral priors and capped evidence prevent one Next click or repeat loop from
// taking over. No artist, genre, audio feature or server-side profile is inferred.
export function adaptiveDiscoveryShare(mode,feedback,{now=Date.now()}={}){
  if(!Array.isArray(feedback)||!Number.isFinite(now)||now<0)return null;
  const bounds=Object.hasOwn(modes,mode)?modes[mode]:modes.balanced,cohorts=[{positive:0,total:0,count:0},{positive:0,total:0,count:0}],seen=new Set();
  let count=0;
  for(const row of feedback.slice(-MAX_FEEDBACK).reverse()){
    if(!validId(row?.id)||typeof row.familiar!=="boolean"||!["listen","skip"].includes(row.kind)||
      !Number.isSafeInteger(row.session)||row.session<0||!Number.isFinite(row.at)||row.at<0||row.at>now||now-row.at>=WINDOW)continue;
    const key=`${row.id}:${row.session}`;if(seen.has(key))continue;seen.add(key);
    const weight=Math.exp(-Math.LN2*(now-row.at)/HALF_LIFE),cohort=cohorts[Number(row.familiar)];
    // Cap events before applying age decay. Capping their decayed sum instead
    // would let a long session stay at full strength until every event expired.
    if(cohort.count>=4)continue;cohort.count++;
    // A qualified listen is useful, but completion carries more evidence. A
    // checkpoint may upgrade that same event, never create another vote.
    const strength=row.kind==="listen"?(row.completed===true?1:.5):1;
    cohort.total+=weight*strength;if(row.kind==="listen")cohort.positive+=weight*strength;
    count++;
  }
  if(!count)return null;
  const [novel,familiar]=cohorts,rate=cohort=>(1+cohort.positive)/(2+cohort.total);
  const confidence=Math.min(1,(novel.total+familiar.total)/4),shift=(rate(novel)-rate(familiar))*.4*confidence;
  return Math.max(bounds.min,Math.min(bounds.max,bounds.base+shift));
}
