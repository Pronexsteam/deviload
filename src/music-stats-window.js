import {t,onLanguageChange,locale} from './i18n.js';

// "Your week in music": the listening summary card opens into a glass window. The window grows out of
// the card's own outline and pours back into it when closed.
const EASE='cubic-bezier(.2,.85,.15,1)',OPEN_MS=560,CLOSE_MS=380;
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
const minutes=seconds=>Math.round((Number(seconds)||0)/60);

export function createStatsWindow({weekly,findItem=()=>null,cover=()=>make('span','music-art'),motion=()=>true}){
  const dialog=make('dialog','music-stats-dialog');dialog.setAttribute('aria-labelledby','music-stats-title');
  document.body.append(dialog);
  let source=null,closing=null,period='week';

  function render(){
    // The week from day-by-day data; a month or the year from the monthly archive (Recap).
    const week=period==='week',summary=weekly.summary(),days=weekly.daily(),recap=week?null:weekly.recap(period);
    const artists=week?weekly.artists(5):recap.artists,songs=week?weekly.songs(5):recap.songs;
    const head=make('header','music-stats-head'),titles=make('div','');
    const range=new Intl.DateTimeFormat(locale(),{day:'numeric',month:'short'});
    const first=days[0]?new Date(days[0].date+'T12:00:00'):new Date(),last=days.at(-1)?new Date(days.at(-1).date+'T12:00:00'):new Date();
    const subtitle=week?`${range.format(first)} – ${range.format(last)}`:period==='month'?new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric'}).format(new Date()):String(new Date().getFullYear());
    const heading=week?t('Your week in music'):period==='month'?t('Your month in music'):t('Your year in music');
    titles.append(make('span','music-eyebrow',week?t('Your last 7 days'):t('Recap')),Object.assign(make('h2','',heading),{id:'music-stats-title'}),make('p','music-stats-range',subtitle));
    const tabs=make('div','music-stats-tabs');tabs.setAttribute('role','tablist');
    for(const [key,label]of [['week',t('Week')],['month',t('Month')],['year',t('Year')]]){const tab=make('button','',label);tab.type='button';tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(key===period));tab.addEventListener('click',()=>{if(period===key)return;period=key;const focus=render();dialog.querySelector(`.music-stats-tabs [aria-selected="true"]`)?.focus();dialog.querySelector('.music-stats-body')?.animate([{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0'}],{duration:260,easing:'cubic-bezier(.2,.85,.15,1)'});void focus;});tabs.append(tab);}
    titles.append(tabs);
    const close=make('button','music-stats-close','×');close.type='button';close.title=close.ariaLabel=t('Close');close.addEventListener('click',()=>hide());
    head.append(titles,close);

    const tiles=make('div','music-stats-tiles');
    const tile=(value,label,big=false)=>{const node=make('div','music-stats-tile'+(big?' is-big':''));node.append(make('strong','',value),make('span','',label));return node;};
    const active=days.filter(day=>day.seconds>0).length||1;
    if(week)tiles.append(tile(t('{minutes} min',{minutes:summary.totalMinutes}),t('Listening time'),true),tile(String(summary.totalQualifiedPlays),t('Listens')),
      tile(String(summary.uniqueTracks),t('Different songs')),tile(t('{minutes} min',{minutes:Math.round(summary.totalMinutes/active)}),t('On a listening day')));
    else tiles.append(tile(t('{minutes} min',{minutes:recap.minutes}),t('Listening time'),true),tile(String(recap.plays),t('Listens')),
      tile(recap.artists[0]?.name||'—',t('Top artist')),tile(recap.songs[0]?.title||'—',t('Top song')));

    const chart=make('section','music-stats-chart');chart.setAttribute('aria-label',period==='year'?t('Minutes per month'):t('Minutes per day'));
    if(period==='year'){
      const most=Math.max(1,...recap.months.map(entry=>entry.seconds)),name=new Intl.DateTimeFormat(locale(),{month:'short'}),current=new Date().getMonth();
      recap.months.forEach((entry,index)=>{
        const column=make('div','music-stats-day'+(index===current?' is-today':'')),bar=make('span','music-stats-bar');
        bar.style.setProperty('--height',`${entry.seconds?Math.max(6,entry.seconds/most*100):0}%`);bar.style.setProperty('--delay',`${index*35}ms`);
        column.append(make('span','music-stats-value',entry.seconds?String(minutes(entry.seconds)):''),bar,make('span','music-stats-weekday',name.format(new Date(new Date().getFullYear(),index,15))));
        chart.append(column);
      });
      chart.classList.add('is-year');
    }else if(week){
    const most=Math.max(1,...days.map(day=>day.seconds)),weekday=new Intl.DateTimeFormat(locale(),{weekday:'short'}),full=new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long'});
    days.forEach((day,index)=>{
      const date=new Date(day.date+'T12:00:00'),column=make('div','music-stats-day'+(index===days.length-1?' is-today':'')),bar=make('span','music-stats-bar');
      bar.style.setProperty('--height',`${day.seconds?Math.max(6,day.seconds/most*100):0}%`);bar.style.setProperty('--delay',`${index*45}ms`);
      column.title=`${full.format(date)}: ${t('{minutes} min',{minutes:minutes(day.seconds)})}`;
      column.append(make('span','music-stats-value',day.seconds?String(minutes(day.seconds)):''),bar,make('span','music-stats-weekday',weekday.format(date)));
      chart.append(column);
    });
    }

    const lists=make('div','music-stats-lists');
    const artistList=make('section','music-stats-list'),artistRows=make('ol','');artistList.append(make('h3','',t('Top artists')),artistRows);
    const top=artists[0]?.seconds||1;
    for(const artist of artists){const row=make('li',''),meter=make('span','music-stats-meter');meter.style.setProperty('--share',`${artist.seconds/top*100}%`);row.append(make('span','music-stats-name',artist.name),make('span','music-stats-time',t('{minutes} min',{minutes:minutes(artist.seconds)})),meter);artistRows.append(row);}
    const songList=make('section','music-stats-list is-songs'),songRows=make('ol','');songList.append(make('h3','',t('Top songs')),songRows);
    for(const song of songs){
      const row=make('li',''),art=make('span','music-stats-cover'),known=findItem(song.id);
      art.append(cover(known||{id:song.id,title:song.title,artists:[song.artist]}));
      const copy=make('span','music-stats-song');copy.append(make('strong','',known?.title||song.title),make('small','',(known?.artists||[song.artist]).join(', ')));
      row.append(art,copy,make('span','music-stats-time',t('{minutes} min',{minutes:minutes(song.seconds)})));songRows.append(row);
    }
    if(artists.length)lists.append(artistList);if(songs.length)lists.append(songList);
    const empty=week?!summary.totalSeconds:!recap.seconds;
    const note=make('p','music-stats-note',empty?t('Start listening and your week will show up here.'):week?t('Only listening on this device is counted. Private sessions are excluded.'):t('Recap counts listening on this device since the update that added it.'));
    const body=make('div','music-stats-body');body.append(tiles);if(period!=='month')body.append(chart);body.append(lists,note);
    dialog.replaceChildren(head,body);
    return close;
  }

  // The window's outline starts as the card's outline, then widens to the whole window.
  function outline(from){
    const box=dialog.getBoundingClientRect(),r=from.getBoundingClientRect();
    const top=Math.max(0,r.top-box.top),left=Math.max(0,r.left-box.left),right=Math.max(0,box.right-r.right),bottom=Math.max(0,box.bottom-r.bottom);
    return `inset(${top}px ${right}px ${bottom}px ${left}px round 18px)`;
  }
  function show(from){
    if(dialog.open)return;source=from||null;closing?.cancel();closing=null;
    const close=render();dialog.showModal();close.focus({preventScroll:true});
    if(!motion()||!source?.isConnected)return;
    dialog.animate([{clipPath:outline(source),opacity:.6},{clipPath:'inset(0px 0px 0px 0px round 28px)',opacity:1}],{duration:OPEN_MS,easing:EASE});
    dialog.querySelector('.music-stats-body')?.animate([{opacity:0,translate:'0 14px'},{opacity:0,offset:.25},{opacity:1,translate:'0 0'}],{duration:OPEN_MS,easing:EASE});
  }
  function hide(){
    if(!dialog.open||closing)return;
    if(!motion()||!source?.isConnected){dialog.close();return;}
    closing=dialog.animate([{clipPath:'inset(0px 0px 0px 0px round 28px)',opacity:1},{clipPath:outline(source),opacity:0}],{duration:CLOSE_MS,easing:'cubic-bezier(.4,0,.6,1)',fill:'forwards'});
    closing.finished.then(()=>{dialog.close();closing?.cancel();closing=null;}).catch(()=>{closing=null;});
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();hide();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)hide();});
  onLanguageChange(()=>{if(dialog.open)render();});
  return {open:show,close:hide};
}
