import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanProfile,parseProfileExport,serializeProfiles} from '../src/download-profile-data.js';
import {mediaIdentity,isProcessing} from '../src/view-model.js';
const profile=()=>({name:'Pool player',options:{quality:'mp3',profile:'music',container:'mp4',folderRule:'author',nameRule:'title',playlist:false,splitChapters:false,subtitles:false,sponsorblock:false,archive:true,autoRetry:true,parallel:2,rateMbps:0,audioLanguage:"",subtitleLanguages:["ru","en"],subtitleAuto:true}});
test('profiles round-trip without credentials or machine-specific paths',()=>{
  const input=profile();Object.assign(input.options,{cookies:'private',cookiesBrowser:'chrome',proxy:'secret',folder:'C:\\private',formatId:'137',clipStart:7});
  const exported=serializeProfiles([input]);assert.deepEqual(parseProfileExport(exported),[profile()]);
  assert.ok(!exported.includes('private'));assert.ok(!exported.includes('secret'));
});
test('profile imports reject corrupt and incompatible data before changing settings',()=>{
  for(const value of ['null','{}','[]','broken',JSON.stringify({format:'deviload-profiles',version:2,profiles:[]})])assert.throws(()=>parseProfileExport(value));
  const invalid=profile();invalid.options.parallel=5;assert.throws(()=>cleanProfile(invalid));
  invalid.options.parallel=2;invalid.options.quality='--exec';assert.throws(()=>cleanProfile(invalid));
  assert.throws(()=>serializeProfiles(Array.from({length:33},profile)));
});
test('YouTube variants identify a downloaded item without confusing hosts',()=>{
  const key=mediaIdentity('https://youtube.com/watch?v=dQw4w9WgXcQ');
  for(const link of ['https://youtu.be/dQw4w9WgXcQ?si=tracking','https://music.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ'])assert.equal(mediaIdentity(link),key);
  assert.notEqual(mediaIdentity('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'),key);
  assert.equal(mediaIdentity('javascript:alert(1)'),'');
});
test('duplicate hints retain meaningful query parameters',()=>{
  assert.equal(mediaIdentity('https://www.instagram.com/reel/example/?igsh=tracking'),mediaIdentity('https://instagram.com/reel/example/'));
  assert.notEqual(mediaIdentity('https://example.com/?id=1'),mediaIdentity('https://example.com/?id=2'));
});
test('processing follows engine stage and never reports a recording as complete',()=>{
  assert.equal(isProcessing({status:'running',stage:'merging',percent:83}),true);
  assert.equal(isProcessing({status:'running',stage:'downloading',percent:100}),false);
  assert.equal(isProcessing({status:'running',percent:100}),true);
  assert.equal(isProcessing({status:'running',stage:'processing',live:true,percent:100}),false);
});
