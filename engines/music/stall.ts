export function stallClock(limit:number,now:()=>number=Date.now){
  let seen=-1,since=now();
  return (progress:number)=>{
    if(progress>seen){seen=progress;since=now();return false;}
    return now()-since>limit;
  };
}
