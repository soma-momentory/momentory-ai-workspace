import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {repository} from '../src/projects.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.mjs';
import {Store} from '../src/store.mjs';

const root=path.resolve(import.meta.dirname,'..');
const requireFe=createRequire(path.join(repository('momentory','fe').path,'package.json'));
const {chromium}=requireFe('playwright');
const run=randomUUID(),dir=path.join(root,'data',`release-e2e-${run}`),repo=path.join(dir,'project');
const db=path.join(dir,'workspace.sqlite'),projectFile=path.join(dir,'projects.json');
const port=await new Promise(resolve=>{const listener=net.createServer();listener.listen(0,'127.0.0.1',()=>{const value=listener.address().port;listener.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const backupEnv=backupFixture(db,token,workerToken,projectFile);
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,WORKSPACE_PROJECTS_FILE:projectFile,...backupEnv};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child=null,logs='',passed=false,taskWorktree=null;
function start(){child=spawn(process.execPath,['src/local.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));}
async function ready(){for(let i=0;i<120;i++){try{if((await fetch(base)).ok)return;}catch{}await wait(500);}throw new Error(`Workspace failed to start: ${logs}`);}
async function stop(){if(!child)return;const current=child;const exited=new Promise(resolve=>current.once('exit',resolve));if(current.connected)current.send('stop');await Promise.race([exited,wait(35000)]);if(current.exitCode===null)current.kill();child=null;}
async function detail(id,cookie){const response=await fetch(`${base}/api/tasks/${id}`,{headers:{Cookie:cookie,Origin:base}});assert.equal(response.status,200);return response.json();}
fs.mkdirSync(repo,{recursive:true});
fs.writeFileSync(path.join(repo,'index.mjs'),"export function greeting(name) { return `Hi, ${name}!`; }\n");
fs.writeFileSync(path.join(repo,'index.test.mjs'),"import test from 'node:test'; import assert from 'node:assert/strict'; import {greeting} from './index.mjs'; test('greeting',()=>assert.equal(greeting('Workspace'),'Hello, Workspace!'));\n");
execFileSync('git',['init','-b','dev'],{cwd:repo});execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['-c','user.name=Release Test','-c','user.email=release@example.invalid','commit','-m','broken baseline'],{cwd:repo});
fs.writeFileSync(projectFile,JSON.stringify({projects:[{id:'release',name:'Release Fixture',repositories:{app:{path:repo,stack:'node',checks:[['node','--check','index.mjs'],['node','--test']]}},design:{adapter:'generic'}}]},null,2));
const browser=await chromium.launch({headless:true});
try{
  start();await ready();
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await page.goto(base);
  await page.locator('#token').fill(token);await page.locator('#login-form button').click();
  await page.locator('#project option[value="release"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#project').inputValue(),'release');
  await page.locator('#goal').fill('Fix greeting in index.mjs so the existing test passes; preserve the test file.');
  await page.locator('#provider').selectOption('codex');
  await page.locator('#mode').selectOption('FAST');
  await page.locator('#new-task button').click();await page.locator('#task-detail h1').waitFor();
  const taskId=await page.evaluate(async()=>{const data=await (await fetch('/api/overview?project=release')).json();return data.tasks[0].id;});
  assert.ok(taskId);
  const cookie=(await page.context().cookies()).find(item=>item.name==='workspace_session');assert.ok(cookie);
  const cookieHeader=`workspace_session=${cookie.value}`;
  let outcome;
  for(let i=0;i<360;i++){outcome=await detail(taskId,cookieHeader);if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(outcome.task.status))break;await wait(1000);}
  assert.equal(outcome.task.status,'AWAITING_APPROVAL',JSON.stringify({status:outcome.task.status,logs,result:outcome.task.result}));
  taskWorktree=outcome.task.worktree;
  assert.deepEqual(outcome.task.result.diff.changedFiles,['index.mjs']);
  assert.ok(outcome.task.verification.checks.every(item=>item.ok));
  assert.ok(outcome.events.some(item=>item.kind==='claimed'));
  assert.ok(outcome.events.some(item=>item.kind==='approval_requested'));
  await page.waitForFunction(()=>document.querySelector('#task-content')?.textContent?.includes('AWAITING_APPROVAL'));
  await page.locator('#task-content .candidate button').first().click();
  for(let i=0;i<30;i++){outcome=await detail(taskId,cookieHeader);if(outcome.task.status==='APPROVED')break;await wait(500);}
  assert.equal(outcome.task.status,'APPROVED');
  assert.ok(outcome.events.some(item=>item.kind==='approval_resolved'));
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width,JSON.stringify(dimensions));
  assert.equal(fs.readFileSync(path.join(repo,'index.mjs'),'utf8').includes('Hi, '),true,'Original Git repository must remain unchanged');
  await stop();start();await ready();
  const restored=await detail(taskId,cookieHeader);
  assert.equal(restored.task.status,'APPROVED');
  assert.ok(restored.events.length>=outcome.events.length);
  await stop();
  const backupOptions={dbFile:db,projectsFile:projectFile,envFile:backupEnv.WORKSPACE_BACKUP_ENV_FILE,screenshotsDir:backupEnv.WORKSPACE_SCREENSHOTS_DIR,backupDir:backupEnv.WORKSPACE_BACKUP_DIR,key:backupEnv.WORKSPACE_BACKUP_KEY};
  assert.ok(fs.readdirSync(backupOptions.backupDir).some(name=>name.endsWith('.awbackup')),'Launcher initial backup missing');
  const saved=createBackup(backupOptions);
  assert.equal(verifyBackup(saved.file,backupOptions).tasks,1);
  const corrupted=new Store(db);corrupted.patch(taskId,{status:'FAILED'},'injected_post_backup_change');corrupted.close();
  assert.equal(restoreBackup(saved.file,backupOptions).tasks,1);
  start();await ready();
  assert.equal((await detail(taskId,cookieHeader)).task.status,'APPROVED');
  passed=true;
  console.log(JSON.stringify({status:'PASS',taskId,provider:'codex',checks:outcome.task.verification.checks.map(item=>({command:item.command,ok:item.ok})),events:restored.events.length,mobileWidth:dimensions.width,historyAfterRestart:true,backupRestored:true,project:repo},null,2));
}finally{
  await stop();await browser.close();
  if(passed&&taskWorktree){
    execFileSync('git',['worktree','remove','--force',taskWorktree],{cwd:repo});
    if(!dir.startsWith(path.join(root,'data')+path.sep))throw new Error('Unsafe release fixture cleanup path');
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
