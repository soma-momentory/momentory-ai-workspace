import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { root } from './config.mjs';
import { repository, project } from './projects.mjs';
import {childEnv,stopTree} from './provider.mjs';
import {validateMomentoryDesign} from './momentorySchema.mjs';

const screenRoots={'home-main':'studio-home-hero','rest-hub':'studio-rest-root','archive':'studio-archive-root','my-main':'studio-my-root','report':'studio-report-root'};
const labRepo=projectId=>repository(projectId,project(projectId).design.repo).path;
let ownedLab=null,ownedLabRepo=null,labStartup=null,labReady=false;
async function labResponds(url) {try {const response=await fetch(url,{signal:AbortSignal.timeout(1500)});return response.ok;}catch{return false;}}
async function ensureLab(url,projectId) {
  if(labStartup){await labStartup;return;}
  if(await labResponds(url)) {
    if(ownedLab&&ownedLab.exitCode===null&&labReady&&ownedLabRepo===labRepo(projectId))return;
    throw new Error(`Design Lab port is occupied by an unowned process: ${url}. Stop it or set WORKSPACE_LAB_URL to a free loopback port.`);
  }
  if(labReady) {stopTree(ownedLab);ownedLab=null;labStartup=null;labReady=false;}
  if(!labStartup) labStartup=(async()=>{
    const fe=labRepo(projectId),cli=path.join(fe,'node_modules','expo','bin','cli');
    if(!fs.existsSync(cli))throw new Error('Expo Lab CLI unavailable; install Momentory FE dependencies');
    const labDir=path.join(fe,'expo-lab');
    ownedLab=spawn(process.execPath,[cli,'start','--web','--port',new URL(url).port,'--host','localhost'],{cwd:labDir,windowsHide:true,detached:process.platform!=='win32',stdio:'ignore',env:{...childEnv(),EXPO_NO_TELEMETRY:'1'}});
    ownedLabRepo=fe;
    ownedLab.unref();
    let spawnError=null;ownedLab.on('error',error=>{spawnError=error;});
    for(let attempt=0;attempt<120;attempt++) {
      if(await labResponds(url)){
        await new Promise(resolve=>setTimeout(resolve,300));
        if(ownedLab.exitCode!==null)throw new Error('Expo Lab process exited while another server answered on its port');
        labReady=true;return;
      }
      if(spawnError||ownedLab.exitCode!==null)throw new Error(`Expo Lab failed to start: ${spawnError||ownedLab.exitCode}`);
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    stopTree(ownedLab);throw new Error('Expo Lab did not become ready within 60 seconds');
  })().catch(error=>{labStartup=null;labReady=false;throw error;});
  await labStartup;
}
process.once('beforeExit',()=>{const lab=ownedLab;ownedLab=null;if(lab?.pid)stopTree(lab);});
process.on('exit',()=>{if(ownedLab?.pid)try{ownedLab.kill();}catch{}});
export async function validateExport(exported,projectId='momentory',checkout=null) {
  if(exported?.version!==1 || typeof exported.name!=='string' || exported.name.length>60) throw new Error('Invalid Studio export');
  const fe=checkout||labRepo(projectId);
  const approved=JSON.parse(fs.readFileSync(path.join(fe,project(projectId).design.outputPath),'utf8'));
  const design=validateMomentoryDesign(exported.design,approved);
  if(Object.keys(approved).every(key=>JSON.stringify(approved[key])===JSON.stringify(design[key]))) throw new Error('Studio export has no changes');
  return {version:1,name:exported.name,design};
}
export async function applySelectedDesign(exported,projectId,checkout){
  if(project(projectId).design.adapter!=='momentory-expo-lab')throw new Error('Unsupported design adapter');
  const target=path.resolve(checkout,project(projectId).design.outputPath),base=fs.realpathSync(checkout);
  if(!target.startsWith(path.resolve(checkout)+path.sep)||fs.lstatSync(target).isSymbolicLink()||!fs.realpathSync(path.dirname(target)).startsWith(base+path.sep))throw new Error('Unsafe design output path');
  const previous=JSON.parse(fs.readFileSync(target,'utf8'));
  const verified=await validateExport(exported,projectId,checkout);
  const changedKeys=Object.keys(verified.design).filter(key=>JSON.stringify(verified.design[key])!==JSON.stringify(previous[key]));
  const temporary=`${target}.workspace-${process.pid}.tmp`;
  try{fs.writeFileSync(temporary,`${JSON.stringify(verified.design,null,2)}\n`,{flag:'wx'});fs.renameSync(temporary,target);}
  finally{if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});}
  return {changedKeys};
}
export async function captureDesign(candidateId,exported,screen='home-main',projectId='momentory') {
  if(!screenRoots[screen]) throw new Error('Unsupported screen');
  const lab=process.env.WORKSPACE_LAB_URL || project(projectId).design.labUrl;
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(lab)) throw new Error('Design Lab URL must be loopback');
  await ensureLab(lab,projectId);
  const feRequire=createRequire(path.join(labRepo(projectId),'package.json'));
  const {chromium}=feRequire('playwright');
  const browser=await chromium.launch({headless:true});
  const dir=path.join(root,'data','screenshots');fs.mkdirSync(dir,{recursive:true});
  const checkStructure=async(page,scenario)=>{
    if(!exported.design['home.hero.structure']?.length)return;
    const overlap=await page.getByTestId('studio-preview-B').getByTestId('studio-home-structure').evaluate(element=>{
      const rect=element.getBoundingClientRect();
      return ['studio-home-baba','studio-home-cta'].map(id=>{
        const other=element.parentElement?.querySelector(`[data-testid="${id}"]`);
        if(!other)return {id,missing:true};
        const box=other.getBoundingClientRect();
        return {id,area:Math.max(0,Math.min(rect.right,box.right)-Math.max(rect.left,box.left))*Math.max(0,Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top))};
      });
    });
    if(overlap.some(item=>item.missing||item.area>1))throw new Error(`Structural block overlaps a hero component in ${scenario}: ${JSON.stringify(overlap)}`);
  };
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1200},deviceScaleFactor:1});
    await page.addInitScript(({design,name})=>window.localStorage.setItem('momentory-design-studio-v1',JSON.stringify({active:name,drafts:{[name]:design}})),{design:exported.design,name:exported.name});
    await page.goto(`${lab}/#studio/${screen}`,{waitUntil:'networkidle',timeout:30000});
    await page.getByTestId('studio-preview-A').waitFor({state:'visible'});
    await page.getByRole('button',{name:'기능 테스트 모드'}).click();
    await page.evaluate(()=>document.fonts.ready);
    if(exported.design['home.hero.structure']?.length){
      const structure=page.getByTestId('studio-preview-B').getByTestId('studio-home-structure');
      await structure.waitFor({state:'visible',timeout:5000});
      for(const block of exported.design['home.hero.structure'])for(const node of block.kind==='group'?block.children:[block])
        if(node.kind==='text' && !(await structure.getByText(node.text,{exact:true}).count()))throw new Error(`Structural Studio block did not render: ${node.id}`);
    }
    const matrix={};
    for(const width of [375,390,402,430]) {
      await page.getByRole('button',{name:`${width}pt`}).click();
      const measure=await page.getByTestId('studio-preview-B').getByTestId(screenRoots[screen]).evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
      if(measure.scrollWidth-measure.clientWidth>2) throw new Error(`Horizontal overflow at ${width}pt`);
      await checkStructure(page,`${width}pt`);
      const baseline=`${candidateId}-${width===390?'':`${width}-`}baseline.png`,candidate=`${candidateId}-${width===390?'':`${width}-`}candidate.png`;
      await page.getByTestId('studio-preview-A').locator(':scope > div').last().screenshot({path:path.join(dir,baseline),animations:'disabled'});
      await page.getByTestId('studio-preview-B').locator(':scope > div').last().screenshot({path:path.join(dir,candidate),animations:'disabled'});
      matrix[width]={baseline,candidate,overflowPx:measure.scrollWidth-measure.clientWidth};
    }
    const states={};
    if(screen==='home-main') for(const [key,label,largeText] of [['many-375','일정 10개 · 접기/펼치기',false],['long-375','긴 일정 제목',true]]) {
      await page.getByRole('button',{name:label,exact:true}).click();
      if(largeText) await page.getByRole('button',{name:/1\.5/}).first().click();
      await page.getByRole('button',{name:'375pt'}).click();
      const measure=await page.getByTestId('studio-preview-B').getByTestId(screenRoots[screen]).evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
      if(measure.scrollWidth-measure.clientWidth>2) throw new Error(`Horizontal overflow in ${key}`);
      await checkStructure(page,key);
      for(const side of ['A','B']) await page.getByTestId(`studio-preview-${side}`).evaluate(root=>{const scroller=[root,...root.querySelectorAll('*')].find(element=>getComputedStyle(element).overflowY==='auto'&&element.scrollHeight>element.clientHeight+20);if(scroller)scroller.scrollTop=scroller.scrollHeight-scroller.clientHeight;});
      const baseline=`${candidateId}-${key}-baseline.png`,candidate=`${candidateId}-${key}-candidate.png`;
      await page.getByTestId('studio-preview-A').locator(':scope > div').last().screenshot({path:path.join(dir,baseline),animations:'disabled'});
      await page.getByTestId('studio-preview-B').locator(':scope > div').last().screenshot({path:path.join(dir,candidate),animations:'disabled'});
      states[key]={baseline,candidate,overflowPx:measure.scrollWidth-measure.clientWidth,scenario:label,fontScale:largeText?1.5:1};
    }
    return {baseline:matrix[390].baseline,candidate:matrix[390].candidate,matrix,states,screen,viewport:'1440x1200'};
  } finally {await browser.close();}
}
