export function artistPageCandidates(data){
 const seen=new Set();
 return (Array.isArray(data?.sections)?data.sections:[]).flatMap(section=>Array.isArray(section.items)?section.items:[])
  .filter(item=>item?.kind==='artist'&&typeof item.title==='string'&&/^UC[\w-]+$/.test(item.id)&&!seen.has(item.id)&&seen.add(item.id)).slice(0,20);
}
export function exactArtist(candidates,name){
 const normalize=value=>value.normalize('NFKC').trim().toLocaleLowerCase();
 const matches=candidates.filter(item=>normalize(item.title)===normalize(name));
 return matches.length===1?matches[0]:null;
}
