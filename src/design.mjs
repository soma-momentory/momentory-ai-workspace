import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { root } from './config.mjs';
import { repository, project } from './projects.mjs';

const screenRoots={'home-main':'studio-home-hero','rest-hub':'studio-rest-root','archive':'studio-archive-root','my-main':'studio-my-root','report':'studio-report-root'};
const labRepo=projectId=>repository(projectId,project(projectId).design.repo).path;
export function designApplyArgs(projectId,exportFile) {if(project(projectId).design.adapter!=='momentory-expo-lab')throw new Error('Unsupported design adapter');return [path.join('expo-lab','scripts','apply-design.mjs'),exportFile,'--write'];}
export async function validateExport(exported,projectId='momentory') {
  if(exported?.version!==1 || typeof exported.name!=='string' || exported.name.length>60) throw new Error('Invalid Studio export');
  const fe=labRepo(projectId);
  const approved=JSON.parse(fs.readFileSync(path.join(fe,project(projectId).design.outputPath),'utf8'));
  const module=await import(pathToFileURL(path.join(fe,'expo-lab','scripts','apply-design.mjs')).href);
  return {version:1,name:exported.name,design:module.validateDesign(exported.design,approved)};
}
export async function captureDesign(candidateId,exported,screen='home-main',projectId='momentory') {
  if(!screenRoots[screen]) throw new Error('Unsupported screen');
  const feRequire=createRequire(path.join(labRepo(projectId),'package.json'));
  const {chromium}=feRequire('playwright');
  const browser=await chromium.launch({headless:true});
  const dir=path.join(root,'data','screenshots');fs.mkdirSync(dir,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1200},deviceScaleFactor:1});
    await page.addInitScript(({design,name})=>window.localStorage.setItem('momentory-design-studio-v1',JSON.stringify({active:name,drafts:{[name]:design}})),{design:exported.design,name:exported.name});
    const lab=process.env.WORKSPACE_LAB_URL || project(projectId).design.labUrl;
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(lab)) throw new Error('Design Lab URL must be loopback');
    await page.goto(`${lab}/#studio/${screen}`,{waitUntil:'networkidle',timeout:30000});
    await page.getByTestId('studio-preview-A').waitFor({state:'visible'});
    await page.getByRole('button',{name:'기능 테스트 모드'}).click();
    await page.evaluate(()=>document.fonts.ready);
    const matrix={};
    for(const width of [375,390,402,430]) {
      await page.getByRole('button',{name:`${width}pt`}).click();
      const measure=await page.getByTestId('studio-preview-B').getByTestId(screenRoots[screen]).evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
      if(measure.scrollWidth-measure.clientWidth>2) throw new Error(`Horizontal overflow at ${width}pt`);
      const baseline=`${candidateId}-${width===390?'':`${width}-`}baseline.png`,candidate=`${candidateId}-${width===390?'':`${width}-`}candidate.png`;
      await page.getByTestId('studio-preview-A').locator(':scope > div').last().screenshot({path:path.join(dir,baseline),animations:'disabled'});
      await page.getByTestId('studio-preview-B').locator(':scope > div').last().screenshot({path:path.join(dir,candidate),animations:'disabled'});
      matrix[width]={baseline,candidate,overflowPx:measure.scrollWidth-measure.clientWidth};
    }
    return {baseline:matrix[390].baseline,candidate:matrix[390].candidate,matrix,screen,viewport:'1440x1200'};
  } finally {await browser.close();}
}
