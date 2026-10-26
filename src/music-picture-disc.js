import {loadArtwork,safeArtworkUrl} from "./music-artwork.js";

const records=new WeakMap();
export function mountPictureDisc(root=document.createElement("span")){
  root.classList.add("picture-disc");root.setAttribute("aria-hidden","true");
  const rotor=document.createElement("span");rotor.className="picture-disc-rotor";
  root.replaceChildren(rotor);records.set(root,{rotor,image:"",size:0});return root;
}
export function setPictureDiscArtwork(root,image,size=320){
  const state=records.get(root);if(!state)return;
  const safe=safeArtworkUrl(image);
  if(state.image===safe&&state.size===size)return;
  state.image=safe;state.size=size;state.rotor.replaceChildren();
  if(!safe)return;
  const img=document.createElement("img");
  if(loadArtwork(img,safe,size))state.rotor.append(img);
}
