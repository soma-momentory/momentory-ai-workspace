import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import { root, screenshotDirectory } from './config.mjs';
import { repository, project } from './projects.mjs';
import {childEnv,stopTree} from './provider.mjs';
import {wslCodexConfig,wslTrustedCommandLaunch,stopWslCodex,finishWslCodex} from './wslCodex.mjs';
import {verifyWslSetupBoundary,prepareWslDependency,cleanupStaleBoundaryCanaries} from './wslChecks.mjs';
import {validateMomentoryDesign} from './momentorySchema.mjs';

const screenRoots={'home-main':'studio-home-hero','rest-hub':'studio-rest-root','archive':'studio-archive-root','my-main':'studio-my-root','report':'studio-report-root'};
const labRepo=projectId=>repository(projectId,project(projectId).design.repo).path;
let ownedLab=null,ownedLabLaunch=null,ownedLabRepo=null,labStartup=null,labReady=false,labOutput='',labIdleTimer=null;
function stopOwnedLab(){
  if(labIdleTimer){clearTimeout(labIdleTimer);labIdleTimer=null;}
  if(ownedLabLaunch){stopWslCodex(ownedLabLaunch);finishWslCodex(ownedLabLaunch);}
  if(ownedLab){stopTree(ownedLab);ownedLab.stdout?.destroy();ownedLab.stderr?.destroy();}
  ownedLab=null;ownedLabLaunch=null;ownedLabRepo=null;labReady=false;
}
async function labResponds(url) {try {const response=await fetch(url,{signal:AbortSignal.timeout(1500)});return response.ok;}catch{return false;}}
async function ensureLab(url,projectId,checkout=null,signal=null) {
  if(signal?.aborted)throw new Error('Design capture cancelled before Lab start');
  if(labIdleTimer){clearTimeout(labIdleTimer);labIdleTimer=null;}
  if(labStartup)await labStartup;
  const fe=fs.realpathSync(checkout||labRepo(projectId));
  if(ownedLab&&ownedLabRepo!==fe){
    stopOwnedLab();
    for(let attempt=0;attempt<40&&await labResponds(url);attempt++)await new Promise(resolve=>setTimeout(resolve,250));
    if(await labResponds(url))throw new Error('Previous owned Design Lab did not release its port');
    ownedLab=null;ownedLabRepo=null;labReady=false;
  }
  if(await labResponds(url)) {
    if(ownedLab&&ownedLab.exitCode===null&&labReady&&ownedLabRepo===fe)return;
    throw new Error(`Design Lab port is occupied by an unowned process: ${url}. Stop it or set WORKSPACE_LAB_URL to a free loopback port.`);
  }
  if(labReady) {stopOwnedLab();labStartup=null;}
  if(!labStartup) labStartup=(async()=>{
    const cli=path.join(fe,'node_modules','expo','bin','cli');
    const linuxDependencies=process.platform==='win32';
    if(linuxDependencies){
      const step=repository(projectId,project(projectId).design.repo).setup?.find(item=>item.ifMissing==='node_modules');
      if(!step)throw new Error('Expo Lab dependency setup is not configured');
      const setup=await prepareWslDependency(fe,step,signal);
      if(!setup.ok)throw new Error(`Expo Lab dependency setup failed: ${setup.output.slice(-1000)}`);
    }
    if(!fs.existsSync(cli))throw new Error('Expo Lab CLI unavailable; install Momentory FE dependencies');
    const labDir=path.join(fe,'expo-lab');
    let executable=process.execPath,args=[cli,'start','--web','--port',new URL(url).port,'--host','localhost'];
    if(linuxDependencies){
      await verifyWslSetupBoundary(fe,'wsl-lab');
      const config=wslCodexConfig(fe),linuxCli=`${config.worktree}/node_modules/expo/bin/cli`;
      const sandbox=[config.binary,'sandbox','-p','ai-dev-workspace-wsl-lab','-P','workspace-lab','-C',config.worktree,'--','/bin/sh','-c','cd "$1" && shift && exec "$@"','lab',`${config.worktree}/expo-lab`,'/usr/bin/env','EXPO_NO_TELEMETRY=1',`PATH=${config.home}/.local/node_modules/node/bin:/usr/local/bin:/usr/bin:/bin`,`${config.home}/.local/node_modules/node/bin/node`,linuxCli,'start','--web','--port',new URL(url).port,'--host','localhost'];
      ownedLabLaunch=wslTrustedCommandLaunch(fe,sandbox);
      executable=ownedLabLaunch.executable;args=ownedLabLaunch.args;
    }
    ownedLab=spawn(executable,args,{cwd:labDir,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...childEnv(),EXPO_NO_TELEMETRY:'1'}});
    const launch=ownedLabLaunch;ownedLab.on('close',()=>finishWslCodex(launch));
    ownedLabRepo=fe;
    ownedLab.unref();
    let announcement='';for(const stream of [ownedLab.stdout,ownedLab.stderr])stream.on('data',chunk=>{announcement=(announcement+chunk.toString()).slice(-3000);labOutput=(labOutput+chunk.toString()).slice(-6000);});
    let spawnError=null;ownedLab.on('error',error=>{spawnError=error;});
    for(let attempt=0;attempt<360;attempt++) {
      if(signal?.aborted)throw new Error('Design capture cancelled during Lab start');
      if(await labResponds(url)){
        for(let n=0;n<40&&!announcement.includes(`Waiting on http://localhost:${new URL(url).port}`);n++)await new Promise(resolve=>setTimeout(resolve,100));
        if(!announcement.includes(`Waiting on http://localhost:${new URL(url).port}`))throw new Error('Expo Lab did not announce the requested port');
        if(ownedLab.exitCode!==null)throw new Error('Expo Lab process exited while another server answered on its port');
        labReady=true;return;
      }
      if(spawnError||ownedLab.exitCode!==null)throw new Error(`Expo Lab failed to start: ${spawnError||ownedLab.exitCode}; ${announcement.slice(-1500)}`);
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    stopOwnedLab();throw new Error(`Expo Lab did not become ready within 180 seconds: ${announcement.slice(-1500)}`);
  })().catch(error=>{labStartup=null;stopOwnedLab();throw error;});
  try{await labStartup;}finally{labStartup=null;}
}
process.once('beforeExit',stopOwnedLab);
process.on('exit',stopOwnedLab);
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
  if(exported?.version!==1||typeof exported.name!=='string'||exported.name.length>60)throw new Error('Invalid Studio export');
  const design=validateMomentoryDesign(exported.design,previous);
  const changedKeys=Object.keys(design).filter(key=>JSON.stringify(design[key])!==JSON.stringify(previous[key]));
  if(!changedKeys.length)return {changedKeys:[],alreadyApplied:true};
  const temporary=`${target}.workspace-${process.pid}.tmp`;
  try{fs.writeFileSync(temporary,`${JSON.stringify(design,null,2)}\n`,{flag:'wx'});fs.renameSync(temporary,target);}
  finally{if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});}
  return {changedKeys};
}
let captureGate=Promise.resolve();
export async function captureDesign(candidateId,exported,screen='home-main',projectId='momentory',checkout=null,signal=null) {
  const previous=captureGate;
  let release;
  captureGate=new Promise(resolve=>{release=resolve;});
  await previous;
  try{return await captureDesignExclusive(candidateId,exported,screen,projectId,checkout,signal);}
  finally{release();}
}
async function captureDesignExclusive(candidateId,exported,screen,projectId,checkout,signal) {
  if(signal?.aborted)throw new Error('Design capture cancelled');
  if(!screenRoots[screen]) throw new Error('Unsupported screen');
  const fe=fs.realpathSync(checkout||labRepo(projectId));
  cleanupStaleBoundaryCanaries(fe);
  const baseHead=execFileSync('git',['rev-parse','HEAD'],{cwd:fe,encoding:'utf8',timeout:10000}).trim();
  if(execFileSync('git',['status','--porcelain'],{cwd:fe,encoding:'utf8',timeout:10000}).trim())throw new Error('Design rendering checkout has unreviewed source changes');
  const lab=process.env.WORKSPACE_LAB_URL || project(projectId).design.labUrl;
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(lab)) throw new Error('Design Lab URL must be loopback');
  await ensureLab(lab,projectId,fe,signal);
  if(signal?.aborted)throw new Error('Design capture cancelled');
  const feRequire=createRequire(path.join(fe,'package.json'));
  const {chromium}=feRequire('playwright');
  const browser=await chromium.launch({headless:true});
  const dir=screenshotDirectory();fs.mkdirSync(dir,{recursive:true});
  const saveScreenshot=async(locator,name)=>{
    const image=await locator.screenshot({animations:'disabled'});
    const temporary=path.join(dir,`.capture-${randomUUID()}.tmp`);
    try{fs.writeFileSync(temporary,image,{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(dir,name));}
    finally{fs.rmSync(temporary,{force:true});}
  };
  const checkStructure=async(page,scenario)=>{
    if(screen!=='home-main'||!exported.design['home.hero.structure']?.length)return;
    const layout=await page.getByTestId('studio-preview-B').getByTestId('studio-home-structure').evaluate(element=>{
      const rect=element.getBoundingClientRect();
      const overlap=['studio-home-baba','studio-home-cta'].map(id=>{
        const other=element.parentElement?.querySelector(`[data-testid="${id}"]`);
        if(!other)return {id,missing:true};
        const box=other.getBoundingClientRect();
        return {id,area:Math.max(0,Math.min(rect.right,box.right)-Math.max(rect.left,box.left))*Math.max(0,Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top))};
      });
      const text=[...element.querySelectorAll('[data-testid^="studio-block-"]')].filter(node=>!node.querySelector('[data-testid^="studio-block-"]')).map(node=>{
        const style=getComputedStyle(node);
        return {id:node.getAttribute('data-testid'),fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};
      });
      return {overlap,text};
    });
    if(layout.overlap.some(item=>item.missing||item.area>1))throw new Error(`Structural block overlaps a hero component in ${scenario}: ${JSON.stringify(layout.overlap)}`);
    if(layout.text.some(item=>!Number.isFinite(item.fontSize)||!Number.isFinite(item.lineHeight)||item.lineHeight<item.fontSize*1.15||item.scrollHeight>item.clientHeight+1))throw new Error(`Structural text clips in ${scenario}: ${JSON.stringify(layout.text)}`);
  };
  let onAbort=null;
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1200},deviceScaleFactor:1});
    onAbort=()=>{page.close().catch(()=>{});stopOwnedLab();};
    signal?.addEventListener('abort',onAbort,{once:true});
    const browserErrors=[];
    page.on('pageerror',error=>browserErrors.push(String(error)));
    page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)browserErrors.push(`${response.status()} ${response.url()}`);});
    await page.addInitScript(({design,name})=>window.localStorage.setItem('momentory-design-studio-v1',JSON.stringify({active:name,drafts:{[name]:design}})),{design:exported.design,name:exported.name});
    await page.goto(`${lab}/#studio/${screen}`,{waitUntil:'domcontentloaded',timeout:120000});
    try{await page.getByTestId('studio-preview-A').waitFor({state:'visible',timeout:120000});}
    catch(error){throw new Error(`Studio preview did not render: ${String(error)}; browser=${browserErrors.slice(-8).join(' | ')}; lab=${labOutput.slice(-1800)}`);}
    await page.getByRole('button',{name:'기능 테스트 모드'}).click();
    await page.evaluate(()=>document.fonts.ready);
    if(screen==='home-main'&&exported.design['home.hero.structure']?.length){
      const structure=page.getByTestId('studio-preview-B').getByTestId('studio-home-structure');
      await structure.waitFor({state:'visible',timeout:5000});
      for(const block of exported.design['home.hero.structure'])for(const node of block.kind==='group'?block.children:[block])
        if(node.kind==='text' && !(await structure.getByText(node.text,{exact:true}).count()))throw new Error(`Structural Studio block did not render: ${node.id}`);
    }
    const matrix={};
    for(const width of [375,390,402,430]) {
      if(signal?.aborted)throw new Error('Design capture cancelled');
      await page.getByRole('button',{name:`${width}pt`}).click();
      const measure=await page.getByTestId('studio-preview-B').getByTestId(screenRoots[screen]).evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
      if(measure.scrollWidth-measure.clientWidth>2) throw new Error(`Horizontal overflow at ${width}pt`);
      await checkStructure(page,`${width}pt`);
      const baseline=`${candidateId}-${width===390?'':`${width}-`}baseline.png`,candidate=`${candidateId}-${width===390?'':`${width}-`}candidate.png`;
      await saveScreenshot(page.getByTestId('studio-preview-A').locator(':scope > div').last(),baseline);
      await saveScreenshot(page.getByTestId('studio-preview-B').locator(':scope > div').last(),candidate);
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
      await saveScreenshot(page.getByTestId('studio-preview-A').locator(':scope > div').last(),baseline);
      await saveScreenshot(page.getByTestId('studio-preview-B').locator(':scope > div').last(),candidate);
      states[key]={baseline,candidate,overflowPx:measure.scrollWidth-measure.clientWidth,scenario:label,fontScale:largeText?1.5:1};
    }
    return {baseline:matrix[390].baseline,candidate:matrix[390].candidate,matrix,states,screen,viewport:'1440x1200',baseHead};
  } finally {if(onAbort)signal?.removeEventListener('abort',onAbort);await browser.close();labIdleTimer=setTimeout(stopOwnedLab,30000);}
}
