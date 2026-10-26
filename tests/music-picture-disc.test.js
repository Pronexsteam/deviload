import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPictureDisc,setPictureDiscArtwork} from '../src/music-picture-disc.js';

class Element extends EventTarget {
 constructor(){super();this.children=[];this.classList={add(){}};}
 setAttribute(){}
 replaceChildren(...nodes){this.children=nodes;}
 append(node){this.children.push(node);node.parent=this;}
 remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}
}
globalThis.document={createElement:()=>new Element()};
test('playback refreshes retain the rotor and decoded cover; only a new image replaces it',()=>{
 const disc=mountPictureDisc(),rotor=disc.children[0],url='https://lh3.googleusercontent.com/art=w120-h120';
 setPictureDiscArtwork(disc,url,480);const image=rotor.children[0];
 assert.equal(image.src,'https://lh3.googleusercontent.com/art=w480-h480');
 for(let i=0;i<100;i++)setPictureDiscArtwork(disc,url,480);
 assert.equal(rotor.children[0],image);assert.equal(disc.children[0],rotor);
 setPictureDiscArtwork(disc,'https://lh3.googleusercontent.com/next=w120-h120',480);
 assert.notEqual(rotor.children[0],image);assert.equal(disc.children[0],rotor);
});
test('missing, rejected and failed art retain the metallic disc without a broken image',()=>{
 const disc=mountPictureDisc(),rotor=disc.children[0];
 setPictureDiscArtwork(disc,'https://example.com/private.jpg');assert.equal(rotor.children.length,0);
 setPictureDiscArtwork(disc,'https://lh3.googleusercontent.com/art',144);
 rotor.children[0].dispatchEvent(new Event('error'));assert.equal(rotor.children.length,0);
 setPictureDiscArtwork(disc,'');assert.equal(disc.children[0],rotor);
});
