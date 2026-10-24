import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { repository } from '../src/projects.mjs';
import { Store } from '../src/store.mjs';

const requireFe=createRequire(path.join(repository('momentory','fe').path,'package.json'));
const {chromium}=requireFe('playwright');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}

test('390px browser manages Momentory and a separate project',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mobile-'));
  const port=await freePort(),token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex');
  const shotDir=path.resolve(import.meta.dirname,'..','data','screenshots'),shotFiles=[];
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:path.join(dir,'db.sqlite')},stdio:'ignore'});
  const browser=await chromium.launch({headless:true});const base=`http://127.0.0.1:${port}`;
  const worker=async(route,value)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${workerToken}`},body:JSON.stringify(value)});assert.equal(response.status,200);return response.json();};
  try{
    let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready);
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await page.goto(base);
    await page.locator('#token').fill(token);await page.locator('#login-form button').click();
    await page.locator('#goal').fill('Improve the home screen card layout and verify it');await page.locator('#new-task button').click();
    await page.locator('#task-detail h1').waitFor();
    const task=await page.evaluate(async()=>{const response=await fetch('/api/overview');return (await response.json()).tasks[0];});
    assert.equal(task.status,'QUEUED');
    const taskClaim=(await worker('/api/worker/claim',{id:'mobile-test',capabilities:['momentory:fe']})).task;assert.equal(taskClaim.id,task.id);
    await page.context().setOffline(true);
    await worker('/api/worker/complete',{id:'mobile-test',taskId:task.id,leaseNonce:taskClaim.lease_nonce,status:'AWAITING_APPROVAL',result:{diff:{changedFiles:['src/card.tsx']}},verification:{ok:true}});
    await page.context().setOffline(false);await page.reload();
    await page.locator('#decisions-now [role="button"]').first().click();
    await page.getByRole('button',{name:'승인',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#task-content')?.textContent?.includes('APPROVED'));
    await page.locator('#task-content form textarea').fill('Check the long text state');await page.getByRole('button',{name:'후속 작업 생성'}).click();
    await page.getByRole('button',{name:'작업 취소'}).click();await page.waitForFunction(()=>document.querySelector('#task-content')?.textContent?.includes('CANCELLED'));
    await page.locator('#nav-dashboard').click();await page.locator('#goal').fill('Explore two distinct home screen design alternatives');await page.locator('#mode').selectOption('EXPLORE');await page.locator('#new-task button').click();
    const designTask=await page.evaluate(async()=>{const response=await fetch('/api/overview');return (await response.json()).tasks[0];});
    const designClaim=(await worker('/api/worker/claim',{id:'mobile-test',capabilities:['momentory:fe']})).task;assert.equal(designClaim.id,designTask.id);
    const created=await worker('/api/worker/candidate',{id:'mobile-test',taskId:designTask.id,leaseNonce:designClaim.lease_nonce,provider:'claude',proposal:{name:'Layout A',layout:'card first'}});
    fs.mkdirSync(shotDir,{recursive:true});const images={};
    for(const kind of ['baseline','candidate']){const name=`${created.id}-${kind}.png`,file=path.join(shotDir,name);fs.writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64'));shotFiles.push(file);images[kind]=name;}
    const db=new Store(path.join(dir,'db.sqlite'));db.setCandidateScreenshot(created.id,images);db.close();
    await worker('/api/worker/complete',{id:'mobile-test',taskId:designTask.id,leaseNonce:designClaim.lease_nonce,status:'AWAITING_DESIGN_SELECTION',result:{},verification:{ok:false}});
    await page.locator('#nav-design').click();await page.getByRole('button',{name:'이 시안 선택'}).click();await page.locator('#nav-task').click();
    await page.waitForFunction(()=>document.querySelector('#task-content')?.textContent?.includes('SELECTED'));
    const width=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(width.content<=width.viewport+2,JSON.stringify(width));
    await page.locator('#nav-dashboard').click();await page.locator('#project').selectOption('sample');await page.locator('#goal').fill('Plan the sample project release notes');await page.locator('#task-type').selectOption('HUMAN_TASK');await page.locator('#new-task button').click();
    await page.waitForFunction(()=>document.querySelector('#task-content')?.textContent?.includes('HUMAN_TASK'));
    const sample=await page.evaluate(async()=>{const response=await fetch('/api/overview?project=sample');return await response.json();});assert.equal(sample.tasks.length,1);assert.equal(sample.tasks[0].project_id,'sample');
    const momentory=await page.evaluate(async()=>{const response=await fetch('/api/overview?project=momentory');return await response.json();});assert.ok(momentory.tasks.every(item=>item.project_id==='momentory'));
  }finally{await browser.close();const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;for(const file of shotFiles)fs.rmSync(file,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});
