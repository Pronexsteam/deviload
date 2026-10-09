const choices={quality:['best','1080','720','480','mp3','flac','wav'],profile:['custom','music','archive','mobile','maximum'],container:['mp4','mkv','webm'],folderRule:['manual','media','source','server','author','date','playlist'],nameRule:['title','date','channel']};
const flags=['playlist','splitChapters','subtitles','sponsorblock','archive','autoRetry'];
export function cleanProfile(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid download profile');
  const name=typeof value.name==='string'?value.name.trim():'';
  if(!name||name.length>60)throw Error('Use a profile name of 1–60 characters');
  const input=value.options;
  if(!input||typeof input!=='object')throw Error('Missing profile options');
  const options={};
  for(const [key,allowed] of Object.entries(choices)){
    if(!allowed.includes(input[key]))throw Error('Invalid profile option');
    options[key]=input[key];
  }
  for(const key of flags){if(typeof input[key]!=='boolean')throw Error('Invalid profile option');options[key]=input[key];}
  for(const [key,min,max] of [['parallel',1,8],['rateMbps',0,1000]]){
    if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw Error('Invalid profile option');
    options[key]=input[key];
  }
  if(![1,2,3,4,6,8].includes(options.parallel))throw Error('Unsupported parallel download count');
  // Link-specific values, sign-in data and paths do not belong in portable profiles.
  return {name,options};
}
export function parseProfileExport(text){
  if(typeof text!=='string'||text.length>256000)throw Error('Profile file is too large');
  const data=JSON.parse(text);
  if(data?.format!=='deviload-profiles'||data.version!==1||!Array.isArray(data.profiles)||data.profiles.length>32)throw Error('Unsupported profile file');
  return data.profiles.map(cleanProfile);
}
export function serializeProfiles(profiles){
  if(profiles.length>32)throw Error('You can save up to 32 profiles');
  return JSON.stringify({format:'deviload-profiles',version:1,profiles:profiles.map(cleanProfile)},null,2);
}
