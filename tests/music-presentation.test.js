import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/music-presentation.js',import.meta.url),'utf8');
const update=source.slice(source.indexOf('update(item, downloading = false, meta = {}) {'),source.indexOf('    notify(text, undo) {'));
test('upgraded artwork for the same recording refreshes the open player without replaying arrival animations',()=>{
 const node=()=>({renders:0,replaceChildren(value){this.renders++;this.content=value;},setAttribute(){},classList:{toggle(){},remove(){},add(){}}});
 const ctx={motion:{update(){}},showMedia(){},current:null,currentImage:'',playing:false,stage:{open:true},cover:(item,_label,size)=>({image:item.image,size}),
  t:s=>s,wake(){},requestAnimationFrame(){ctx.animations++;},animations:0};
 for(const name of ['background','previewArt','ambient','scene','notice','info','artwork','facts','reason','preview','previewTitle','previewArtist','expand','download','dislike','block'])ctx[name]=node();
 const run=runInNewContext(`({${update}}).update`,ctx),track={id:'same',image:'small',title:'Track',artists:['Artist']};
 run(track);const animations=ctx.animations;track.image='large';run(track);
 assert.equal(ctx.artwork.content.image,'large');assert.equal(ctx.artwork.content.size,1024);assert.equal(ctx.previewArt.content.size,640);
 assert.equal(ctx.animations,animations);assert.equal(ctx.background.renders,2);
 run(track);assert.equal(ctx.background.renders,2);assert.equal(ctx.artwork.renders,2);
});
