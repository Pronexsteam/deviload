// Cache only complete artist pages. A partial search result should be retried
// on the next visit so it cannot become the permanent artist discography.
export function createArtistCatalog(invoke,now=Date.now){
  const pages=new Map();
  return async function loadArtist(artist,language,refresh=false){
    const key=language+"|"+artist.id;
    const previous=pages.get(key);
    if(!refresh&&previous&&now()-previous.at<300000)return previous.page;
    try{
      const page=await invoke("music_catalog",{kind:"browse",value:artist.id,language});
      if(!page.sections?.some(section=>section.items?.length))throw Error("Music is unavailable right now. Check your connection and try again.");
      pages.delete(key);
      pages.set(key,{at:now(),page});
      if(pages.size>12)pages.delete(pages.keys().next().value);
      return page;
    }catch(error){
      if(previous)return {...previous.page,notice:"cached"};
      if(["YouTube declined this catalog request.","YouTube is temporarily limiting catalog requests."].includes(String(error?.message||error)))throw error;
      const search=await invoke("music_catalog",{kind:"search",value:artist.title,filter:"songs",language});
      const name=value=>String(value).normalize("NFKC").trim().toLowerCase();
      const songs=(search.sections||[]).flatMap(section=>section.items||[]).filter(item=>
        item.kind==="song"&&item.artists?.some(credit=>name(credit)===name(artist.title)));
      if(!songs.length)throw error;
      return {sections:[{title:artist.title,items:songs}],notice:"songs"};
    }
  };
}
