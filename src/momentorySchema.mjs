const assets=new Set(['rest-baba-sleep','home-baba-idle','home-baba-wave','rest-records','rest-treasures']);
const fonts=new Set(['Gaegu-Regular','Gaegu-Bold','KyoboHandwriting2025lyb']);
const alignments=new Set(['left','center','right']);
const ranges={
  'home.hero.borderRadius':[0,40], 'home.bubble.borderRadius':[0,40],
  'home.bubble.paddingHorizontal':[8,32], 'home.bubbleText.fontSize':[18,34],
  'home.bubbleText.letterSpacing':[-1,4], 'home.cta.paddingHorizontal':[12,36],
  'rest.heading.fontSize':[22,40], 'rest.wishPaper.paddingLeft':[8,28],
  'rest.wishSummary.fontSize':[16,30], 'rest.wishSummary.letterSpacing':[-1,4],
  'rest.babaImage.opacity':[0.2,1], 'rest.wishPhoto.width':[80,130],
  'rest.wishPhoto.rotation':[-15,15], 'archive.titleWrap.paddingHorizontal':[8,32],
  'archive.title.fontSize':[24,44], 'archive.calendar.borderRadius':[0,32],
  'my.profileCard.borderRadius':[0,32], 'my.profileCard.paddingHorizontal':[8,32],
  'my.profileCard.shadowOpacity':[0,0.4], 'report.weekTitlePaper.paddingHorizontal':[8,32],
  'report.weekTitlePaper.borderRadius':[0,24], 'report.weekTitle.fontSize':[24,40],
  'report.weekTitle.letterSpacing':[-1,4], 'report.summary.minHeight':[100,200]
};
const invalidText=/[\u0000-\u001f\u007f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u;
export function validateStructure(value){
  if(!Array.isArray(value)||value.length>8)throw new Error('Invalid hero structure');
  const ids=new Set();let count=0;
  const visit=(blocks,depth)=>blocks.map(node=>{
    if(!node||typeof node!=='object'||Array.isArray(node)||typeof node.id!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(node.id)||ids.has(node.id)||++count>12)throw new Error('Invalid hero block');
    ids.add(node.id);
    if(node.kind==='text'&&Object.keys(node).length===3&&typeof node.text==='string'&&node.text.trim()&&node.text.length<=80&&!invalidText.test(node.text))return {id:node.id,kind:'text',text:node.text};
    if(node.kind==='group'&&Object.keys(node).length===3&&depth===0&&Array.isArray(node.children)&&node.children.length<=6)return {id:node.id,kind:'group',children:visit(node.children,1)};
    throw new Error('Unsupported hero block');
  });
  return visit(value,0);
}
export function validateMomentoryDesign(design,approved){
  if(!design||typeof design!=='object'||Array.isArray(design)||!approved||typeof approved!=='object'||Array.isArray(approved))throw new Error('Invalid Studio design');
  const keys=Object.keys(approved);
  if(Object.keys(design).length!==keys.length||Object.keys(design).some(key=>!Object.hasOwn(approved,key)))throw new Error('Unknown or missing design keys');
  const output={};
  for(const key of keys){
    const value=design[key];
    if(key==='home.hero.structure'){output[key]=validateStructure(value);continue;}
    if(ranges[key]){const [min,max]=ranges[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid ${key}`);}
    else if(key.endsWith('.fontFamily')){if(!fonts.has(value))throw new Error(`Invalid ${key}`);}
    else if(key.endsWith('.textAlign')){if(!alignments.has(value))throw new Error(`Invalid ${key}`);}
    else if(key==='rest.babaImage.assetId'){if(!assets.has(value))throw new Error(`Invalid ${key}`);}
    else if(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value))throw new Error(`Invalid ${key}`);
    output[key]=value;
  }
  return output;
}
