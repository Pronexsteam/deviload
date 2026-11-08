// Settings of the "Your own" theme: kept within range, stored on this device, carried to CSS.
const KEY='deviload-custom-theme';
export const CUSTOM_DEFAULTS=Object.freeze({blur:24,dim:45,ambient:70,panels:66,accent:'',background:null});
const clamp=(value,low,high,fallback)=>Number.isFinite(Number(value))&&value!==null&&value!==''?Math.min(high,Math.max(low,Math.round(Number(value)))):fallback;

/** Settings of the "Your own" theme, with anything unusable replaced by its default. */
export function normalizeCustom(value){
  const background=value?.background&&typeof value.background.path==='string'&&value.background.path&&['image','video'].includes(value.background.kind)
    ?{path:value.background.path,kind:value.background.kind}:null;
  const accent=/^#[0-9a-f]{6}$/i.test(value?.accent||'')?value.accent.toLowerCase():'';
  return {blur:clamp(value?.blur,0,60,24),dim:clamp(value?.dim,0,85,45),ambient:clamp(value?.ambient,0,100,70),panels:clamp(value?.panels,15,100,66),accent,background};
}
export function readCustom(storage){try{return normalizeCustom(JSON.parse(storage?.getItem(KEY)||'null'));}catch{return normalizeCustom(null);}}
export function saveCustom(storage,value){try{storage?.setItem(KEY,JSON.stringify(normalizeCustom(value)));return true;}catch{return false;}}
/** The CSS variables that carry the settings to the stylesheet. */
export function customVariables(value){
  const s=normalizeCustom(value);
  return {'--custom-blur':`${s.blur}px`,'--custom-dim':(s.dim/100).toFixed(2),'--custom-ambient':(s.ambient/100).toFixed(2),'--custom-panel':(s.panels/100).toFixed(2),'--custom-accent':s.accent||null};
}
