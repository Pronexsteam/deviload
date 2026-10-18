import test from 'node:test';
import assert from 'node:assert/strict';
import {languagePreferences,inspectionKey,sourceEstimate} from '../src/download-options.js';
import {cleanProfile,parseProfileExport,serializeProfiles} from '../src/download-profile-data.js';

const options=()=>({quality:'1080',profile:'custom',container:'mp4',playlist:false,formatId:'137',formatHasAudio:false,
  audioFormatId:'140',audioLanguage:'ja',cookies:'',cookiesBrowser:'',cookiesAccount:false});
test('old portable profiles gain the same RU/EN subtitle defaults without carrying source IDs',()=>{
  const input={name:'Old',options:{quality:'1080',profile:'custom',container:'mp4',folderRule:'manual',nameRule:'title',playlist:false,splitChapters:false,
    subtitles:true,sponsorblock:false,archive:true,autoRetry:true,parallel:2,rateMbps:0}};
  const old=cleanProfile(input);assert.deepEqual(old.options.subtitleLanguages,['ru','en']);assert.equal(old.options.subtitleAuto,true);
  Object.assign(input.options,{audioLanguage:'ja',subtitleLanguages:['ja','es-419'],subtitleAuto:false,audioFormatId:'140',sourceSize:{bytes:800}});
  const [restored]=parseProfileExport(serializeProfiles([input]));
  assert.deepEqual(restored.options.subtitleLanguages,['ja','es-419']);assert.equal(restored.options.audioLanguage,'ja');assert.equal(restored.options.subtitleAuto,false);
  assert.ok(!('audioFormatId' in restored.options));assert.ok(!('sourceSize' in restored.options));
});
test('language preferences reject selectors and code-like values from profile imports',()=>{
  for(const value of ['--exec','en]/best','en,ja','en.*','en\nru',''])assert.throws(()=>languagePreferences({subtitleLanguages:[value]}));
  assert.throws(()=>languagePreferences({subtitleLanguages:Array(13).fill('en')}));
  assert.throws(()=>languagePreferences({audioLanguage:'--config'}));assert.throws(()=>languagePreferences({subtitleAuto:'true'}));
  assert.deepEqual(languagePreferences({subtitleLanguages:['ja','ja']}),{audioLanguage:'',subtitleLanguages:['ja'],subtitleAuto:true});
});
test('a paired estimate becomes unknown when a format, audio language or destination link changes',()=>{
  const current=options(),key=inspectionKey(current),info={isList:false,sourceSize:{url:'https://example.com/a',bytes:1200,approximate:true,complete:true}};
  assert.equal(sourceEstimate(info,current,'https://example.com/a',key).bytes,1200);
  assert.equal(sourceEstimate(info,current,'https://example.com/b',key),null);
  for(const changed of [{audioLanguage:'en'},{audioFormatId:'141'},{quality:'720'},{container:'mkv'},{formatId:'248'},{playlist:true}])
    assert.equal(sourceEstimate(info,{...current,...changed},'https://example.com/a',key),null);
  assert.equal(sourceEstimate({...info,isList:true},current,'https://example.com/a',key),null);
  assert.equal(sourceEstimate({sourceSize:{bytes:0}},current,'https://example.com/a',key),null);
});
