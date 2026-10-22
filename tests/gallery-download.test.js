import test from 'node:test';
import assert from 'node:assert/strict';
// This module also wires a browser dialog; the option projection itself needs
// only the language module's document language target during import.
globalThis.document={documentElement:{}};
const {galleryOptions}=await import('../src/gallery-download.js');

test('gallery requests preserve folder and auth but cannot inherit a video draft',()=>{
  const settings={folder:'D:/media',cookiesMode:'firefox',cookies:'secret-file',signedInPath:'embedded',rateMbps:5,clipStart:20,playlist:true,formatId:'137',quality:'mp3'};
  const initial=galleryOptions(settings);assert.equal(initial.folder,settings.folder);assert.equal(initial.cookiesBrowser,'firefox');assert.equal(initial.cookies,'');
  for(const field of ['playlist','subtitles','sponsorblock','archive','splitChapters'])assert.equal(initial[field],false);
  assert.equal(initial.clipStart,null);assert.equal(initial.formatId,'');assert.equal(initial.quality,'best');assert.equal(initial.downloadEngine,'');
  const preview={fingerprint:'a'.repeat(64)};
  const selected=new Set([4,1]);const request=galleryOptions({...settings,cookiesMode:'account'},{preview,selected});
  assert.deepEqual(request.galleryItems,[1,4]);assert.deepEqual([...selected],[4,1]);assert.equal(request.galleryFingerprint,preview.fingerprint);
  assert.equal(request.downloadEngine,'gallery-dl');assert.equal(request.cookies,'embedded');assert.equal(request.cookiesBrowser,'');
  assert.equal(galleryOptions({...settings,cookiesMode:'file'}).cookies,'secret-file');
});
