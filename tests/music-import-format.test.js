import test from "node:test";
import assert from "node:assert/strict";
import {parseMusicImport} from "../src/music-import-format.js";
const parse=value=>parseMusicImport(JSON.stringify(value),"export.json");
const id="dQw4w9WgXcQ";

test("custom liked-song JSON preserves collaborations, deduplicates and excludes private metadata",()=>{
  const result=parseMusicImport(JSON.stringify({playlist:'https://open.spotify.com/playlist/private',spotifyCount:4,tracks:[
    {position:1,title:'First',artists:['One','Two'],album:'Album',cookie:'secret'},
    {position:2,title:'Second',artists:['Three']},{position:3,title:'First',artists:['One','Two']}
  ],unidentified:[{position:4,title:'',artists:['Various Artists'],reason:'Missing title'}]}),'spotify-liked-songs.json');
  assert.deepEqual(result.entries.map(e=>[e.title,e.artists,e.liked,e.plays]),[['First',['One','Two'],true,0],['Second',['Three'],true,0]]);
  assert.equal(result.warnings.length,2);assert.ok(!/private|secret|cookie|position|album/.test(JSON.stringify(result.entries)));
});

test("Spotify API saved tracks, raw track arrays and playlist pages keep their like semantics",()=>{
  const track={name:'Song',artists:[{name:'A'},{name:'B'}],type:'track',id:'spotify-id'};
  for(const value of [{items:[{added_at:'2026-10-01',track}]}, {tracks:[{...track,liked:true}]}])assert.equal(parse(value).entries[0].liked,true);
  for(const value of [[track],{tracks:{items:[{added_at:'2026-10-01',track}]}},{tracks:[{title:'Song',artists:['A']}] }])assert.equal(parse(value).entries[0].liked,false);
  assert.deepEqual(parse({items:[{track},null,{track:null},{name:'Podcast',artists:['Host'],type:'episode'}]}).entries.map(e=>e.title),['Song']);
});

test("Spotify CSV accepts Exportify columns and quoted artist names without inventing YouTube IDs",()=>{
  const result=parseMusicImport('Track URI,Track Name,Artist Name(s)\nspotify:track:abc,"Song, One","A;B"\n','liked-songs.csv');
  assert.equal(result.source,'spotify');assert.deepEqual(result.entries[0].artists,['A','B']);assert.equal(result.entries[0].liked,true);assert.equal(result.entries[0].videoId,undefined);
});

test("Spotify saved songs import likes but no unrelated private data",()=>{
  const result=parse({tracks:[{artist:"Artist",track:"Song",album:"Album",uri:"spotify:track:secret"}],profile:{email:"private@email"},cookies:"secret"});
  assert.equal(result.source,"spotify");assert.equal(result.entries[0].liked,true);assert.equal(result.entries[0].plays,0);
  assert.deepEqual(result.entries[0].artists,["Artist"]);assert.ok(!/secret|email|cookies|album/i.test(JSON.stringify(result)));
});
test("Spotify playlist order survives with duplicate tracks merged without automatic likes",()=>{
  const result=parse({playlists:[{name:"My mix",items:[{track:{trackName:"First",artistName:"A"}},{episode:{title:"Podcast"}},{track:{trackName:"Second",artistName:"B"}},{track:{trackName:"First",artistName:"A"}}]}]});
  assert.equal(result.entries.length,2);assert.equal(result.playlists[0].name,"My mix");assert.equal(result.name,"My mix");
  assert.deepEqual(result.playlists[0].keys,result.entries.map(entry=>entry.key));assert.equal(result.entries[0].liked,false);
});
test("standard and extended histories use stable keys and only qualifying musical plays",()=>{
  const normal=parse([{artistName:"Artist",trackName:"Song",msPlayed:30000,endTime:"2026-10-14 12:30"},{artistName:"Artist",trackName:"Song",msPlayed:29999,endTime:"2026-10-14 12:31"}]);
  const extended=parse([{master_metadata_album_artist_name:"Artist",master_metadata_track_name:"Song",ms_played:45000,ts:"2026-10-14T12:30:00Z",ip_addr_decrypted:"private"},{master_metadata_album_artist_name:null,master_metadata_track_name:null,ms_played:50000,episode_name:"Podcast"}]);
  assert.deepEqual(normal.entries,extended.entries);assert.equal(normal.entries[0].plays,1);assert.equal(normal.entries[0].liked,false);
  assert.equal(normal.entries[0].lastPlayed,Date.UTC(2026,9,14,12,30));
  const repeated=parse(Array.from({length:150},()=>({artistName:"Artist",trackName:"Song",msPlayed:40000})));assert.equal(repeated.entries[0].plays,100);
});
test("YouTube Music CSV handles BOM, escaped quotes, commas and multiline song names",()=>{
  const text='\uFEFFVideo ID,Song Title,Album Title,Artist Name\r\n'+id+',"A, \"\"quoted\"\"\nSong",Album,"Artist, Ensemble"\r\n';
  const result=parseMusicImport(text,"library songs.csv");assert.equal(result.source,"youtube");assert.equal(result.entries[0].title,'A, "quoted" Song');
  assert.deepEqual(result.entries[0].artists,["Artist, Ensemble"]);assert.equal(result.entries[0].videoId,id);assert.equal(result.entries[0].liked,false);
});
test("YouTube playlists accept ID-only records and strictly validate URL hosts",()=>{
  const result=parseMusicImport('Video ID,Playlist Video Creation Timestamp\n'+id+',2026-10-14T12:00:00Z\n',"C:\\Users\\person\\Night.csv");
  assert.equal(result.name,"Night");assert.equal(result.entries[0].title,"");assert.equal(result.entries[0].key,"youtube:"+id);
  const valid=parseMusicImport('Song URL\nhttps://music.youtube.com/watch?v='+id,"playlist.csv");assert.equal(valid.entries[0].videoId,id);
  for(const url of ['https://youtube.com.evil.test/watch?v='+id,'https://youtube.com@evil.test/watch?v='+id,'file:///private'])assert.equal(parseMusicImport("Song URL\n"+url,"x.csv").entries.length,0);
});
test("unknown and corrupted files fail clearly without accepting partial malformed CSV",()=>{
  for(const text of ['{"a":1}',"[{broken]","Not music\nhello",'Video ID\n"unfinished','Video ID\n"'+id+'"junk','Video ID\n'+id+',extra'])assert.throws(()=>parseMusicImport(text,"input"),/Invalid music|Unsupported music/);
  assert.throws(()=>parseMusicImport(""),/empty/);assert.throws(()=>parseMusicImport("x".repeat(50*1024*1024+1)),/50 MB/);
});
test("large imports retain every unique song beyond former row and track limits",()=>{
  const rows=Array.from({length:20002},(_,i)=>({artistName:"Artist",trackName:"Song "+i,msPlayed:30000}));
  const result=parse(rows);assert.equal(result.entries.length,20002);assert.ok(!result.warnings.some(w=>/Only the first/.test(w)));
  const csv=parseMusicImport("Video ID\n"+Array.from({length:20002},()=>id).join("\n"));assert.equal(csv.entries.length,1);assert.ok(!csv.warnings.some(w=>/Only the first/.test(w)));
});
