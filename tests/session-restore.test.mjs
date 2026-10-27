import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.mjs';

const root=path.resolve(import.meta.dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const tables=['tasks','events','workers','decisions','design_candidates','followup_requests'];
function business(file){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(tables.map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}finally{db.close();}}
function sessions(file){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT count(*) AS n FROM browser_sessions').get().n;}finally{db.close();}}
async function freePort(){const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});assert.ok(![4178,4195].includes(port));return port;}
async function waitUntil(predicate,message){for(let n=0;n<100;n++){if(await predicate())return;await delay(50);}assert.fail(message);}
function launch(args,env){
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
  const item={child,logs:'',ended:null};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>item.logs=(item.logs+chunk.toString()).slice(-6000));
  item.ended=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('exit',(code,signal)=>resolve({code,signal}));});
  return item;
}
async function stop(item,signal='SIGTERM'){if(!item)return;if(item.child.exitCode===null&&item.child.signalCode===null)item.child.kill(signal);await item.ended;}
async function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'t9-session-restore-')));
  const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
  const options={dbFile:path.join(dir,'workspace.sqlite'),projectsFile:path.join(dir,'projects.json'),envFile:path.join(dir,'private.env'),screenshotsDir:path.join(dir,'screenshots'),backupDir:path.join(dir,'backups'),key};
  fs.mkdirSync(options.screenshotsDir);fs.writeFileSync(options.projectsFile,JSON.stringify({projects:[{id:'safe',name:'Synthetic restore project',repositories:{app:{path:dir,stack:'node',checks:[]}},design:{adapter:'generic'}}]}));
  fs.writeFileSync(options.envFile,`WORKSPACE_TOKEN=${token}\nWORKER_TOKEN=${workerToken}\nWORKSPACE_BACKUP_KEY=${key}\n`,{mode:0o600});
  const store=new Store(options.dbFile);
  const approved=store.createTask({projectId:'safe',repo:'app',goal:'Synthetic approved history'}, {mode:'FAST',provider:'codex',reason:'fixture'});
  store.patch(approved.id,{status:'AWAITING_APPROVAL',result:{summary:'Preserve this historical result'}},'synthetic_change');
  const decision=store.addDecision(approved.id,'result',{basis:'Synthetic review'});store.resolveDecision(decision,'APPROVED');
  const rejected=store.createTask({projectId:'safe',repo:'app',goal:'Synthetic rejected history'}, {mode:'FAST',provider:'codex',reason:'fixture'});
  store.resolveDecision(store.addDecision(rejected.id,'risk',{basis:'Synthetic rejection'}),'REJECTED');store.close();
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const env={...process.env,WORKSPACE_HOST:'127.0.0.1',WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_BACKUP_KEY:key,WORKSPACE_DATA_FILE:options.dbFile,WORKSPACE_PROJECTS_FILE:options.projectsFile,WORKSPACE_BACKUP_ENV_FILE:options.envFile,WORKSPACE_SCREENSHOTS_DIR:options.screenshotsDir,WORKSPACE_BACKUP_DIR:options.backupDir};delete env.WORKSPACE_PUBLIC_URL;
  const children=new Set();let server=null;
  const request=(route,cookie,method='GET',body)=>fetch(base+route,{method,headers:{Origin:base,Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const f={dir,options,env,base,token,workerToken,approvedId:approved.id,decisionId:decision,children,request,
    spawn(args,overrides={}){const item=launch(args,{...env,...overrides});children.add(item);return item;},
    async start(){server=f.spawn(['src/server.mjs']);await waitUntil(async()=>{if(server.child.exitCode!==null)assert.fail(`Controlled server exited: ${server.logs}`);try{return (await request('/api/session')).status===401;}catch{return false;}},'Controlled server did not start');},
    async stop(signal){await stop(server,signal);server=null;},
    async login(){const response=await request('/api/login',null,'POST',{token});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];},
    async status(cookie){return (await request('/api/session',cookie)).status;}
  };
  t.after(async()=>{for(const child of children)await stop(child);fs.rmSync(dir,{recursive:true,force:true});});return f;
}

test('restored backups never reactivate revoked or previously active browser cookies',async t=>{
  const f=await fixture(t);await f.start();const revoked=await f.login(),active=await f.login();
  assert.equal(await f.status(revoked),200);assert.equal(await f.status(active),200);
  const snapshot=business(f.options.dbFile),credentials=hash(fs.readFileSync(f.options.envFile));
  const backup=createBackup(f.options);assert.equal(verifyBackup(backup.file,f.options).tasks,2);
  assert.equal((await f.request('/api/logout',revoked,'POST',{})).status,200);
  assert.equal(await f.status(revoked),401);await f.stop();await f.start();assert.equal(await f.status(revoked),401);
  await f.stop('SIGKILL');await f.start();assert.equal(await f.status(revoked),401);assert.equal(await f.status(active),200);
  await f.stop();restoreBackup(backup.file,f.options);await f.start();
  const restored={revoked:await f.status(revoked),active:await f.status(active)};
  t.diagnostic(JSON.stringify({phase:'after-restore',expected:{revoked:401,active:401},actual:restored}));
  assert.equal(restored.revoked,401,'Revoked cookie was reactivated by restoring a pre-logout backup');assert.equal(restored.active,401,'Every pre-restore browser session must be invalidated');
  const fresh=await f.login();assert.equal(await f.status(fresh),200);assert.equal(sessions(f.options.dbFile),1);assert.deepEqual(business(f.options.dbFile),snapshot);
  assert.equal(hash(fs.readFileSync(f.options.envFile)),credentials,'Restore must preserve current login/worker/backup credentials');
  assert.equal((await f.request('/api/worker/heartbeat',null,'POST',{})).status,401);
  const worker=await fetch(f.base+'/api/worker/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${f.workerToken}`},body:JSON.stringify({id:'synthetic-worker',capabilities:[]})});assert.equal(worker.status,200,'Worker credential must remain valid');
  await f.stop();restoreBackup(backup.file,f.options);await f.start();
  for(const cookie of [revoked,active,fresh])assert.equal(await f.status(cookie),401,'Repeated restore reactivated an old session');
  const secondFresh=await f.login();assert.equal(await f.status(secondFresh),200);
  const [expiry,id]=secondFresh.split('=')[1].split('.'),past=String(Date.now()-1000);
  const expired=`workspace_session=${past}.${id}.${createHmac('sha256',f.token).update(`${past}.${id}`).digest('hex')}`;
  const db=new DatabaseSync(f.options.dbFile);db.prepare('UPDATE browser_sessions SET expires_at=? WHERE id_hash=?').run(Number(past),hash(id));db.close();
  assert.equal(await f.status(expired),401,'A correctly signed expired cookie must be denied');
  assert.equal(await f.status(secondFresh),401,'A cookie no longer matching its database row must be denied');
  assert.ok(Number(expiry)>Date.now());assert.deepEqual(business(f.options.dbFile),snapshot);
  t.diagnostic('PASS: logout, graceful/SIGKILL restart, all-session invalidation, two restores, fresh login, expiry, credentials and history');
});

test('session invalidation is complete in the staged database before live installation',async t=>{
  const f=await fixture(t);await f.start();await f.login();await f.stop();const snapshot=business(f.options.dbFile),backup=createBackup(f.options);let inspected=false;
  restoreBackup(backup.file,{...f.options,beforeReplace:(_target,index)=>{if(index===0){const stage=fs.readdirSync(f.dir).find(name=>name.startsWith('workspace.sqlite.restore-'));assert.ok(stage);assert.equal(sessions(path.join(f.dir,stage)),0);assert.deepEqual(business(path.join(f.dir,stage)),snapshot);inspected=true;}}});
  assert.ok(inspected);assert.equal(sessions(f.options.dbFile),0);assert.deepEqual(business(f.options.dbFile),snapshot);
});

test('corruption, staging and replacement failures preserve the current DB and authentication',async t=>{
  const f=await fixture(t);await f.start();const old=await f.login();const backup=createBackup(f.options);await f.request('/api/logout',old,'POST',{});const active=await f.login();await f.stop();
  const current=business(f.options.dbFile),credentials=hash(fs.readFileSync(f.options.envFile));
  const damaged=path.join(f.dir,'damaged.awbackup'),envelope=JSON.parse(fs.readFileSync(backup.file));const ciphertext=Buffer.from(envelope.ciphertext,'base64');ciphertext[0]^=1;envelope.ciphertext=ciphertext.toString('base64');fs.writeFileSync(damaged,JSON.stringify(envelope));
  const failedInvalidation=()=>restoreBackup(backup.file,{...f.options,writeStage:(target,content)=>{
    fs.writeFileSync(target,content,{flag:'wx',mode:0o600});
    if(target.startsWith(`${f.options.dbFile}.restore-`)){
      const staged=new DatabaseSync(target);try{staged.exec("CREATE TRIGGER deny_session_delete BEFORE DELETE ON browser_sessions BEGIN SELECT RAISE(ABORT, 'Injected session invalidation failure'); END");}finally{staged.close();}
    }
  }});
  for(const attempt of [()=>restoreBackup(damaged,f.options),()=>restoreBackup(backup.file,{...f.options,writeStage:()=>{throw new Error('Injected stage failure');}}),failedInvalidation,()=>restoreBackup(backup.file,{...f.options,beforeReplace:(_target,index)=>{if(index===1)throw new Error('Injected replacement failure');}})]){
    assert.throws(attempt);assert.deepEqual(business(f.options.dbFile),current);assert.equal(hash(fs.readFileSync(f.options.envFile)),credentials);
    assert.equal(fs.readdirSync(f.dir).some(name=>/\.(?:restore|rollback)-/.test(name)),false);
    await f.start();assert.equal(await f.status(old),401);assert.equal(await f.status(active),200);await f.stop();
  }
  restoreBackup(backup.file,f.options);await f.start();assert.equal(await f.status(old),401);assert.equal(await f.status(active),401);assert.equal(await f.status(await f.login()),200);
});

test('explicit credential restoration also requires fresh browser logins',async t=>{
  const f=await fixture(t);await f.start();const old=await f.login(),backup=createBackup(f.options),archivedCredentials=hash(fs.readFileSync(f.options.envFile));await f.stop();
  fs.writeFileSync(f.options.envFile,`WORKSPACE_TOKEN=${randomBytes(32).toString('hex')}\nWORKER_TOKEN=${randomBytes(32).toString('hex')}\nWORKSPACE_BACKUP_KEY=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
  restoreBackup(backup.file,{...f.options,restoreCredentials:true});assert.equal(hash(fs.readFileSync(f.options.envFile)),archivedCredentials);
  await f.start();assert.equal(await f.status(old),401);assert.equal(await f.status(await f.login()),200);
});

test('live servers exclude restore while concurrent requests retain the current state',async t=>{
  const f=await fixture(t);await f.start();const cookie=await f.login(),backup=createBackup(f.options),snapshot=business(f.options.dbFile);
  const requests=Array.from({length:12},()=>f.status(cookie));
  assert.throws(()=>restoreBackup(backup.file,f.options),/database.*in use|Stop the Workspace/i);
  assert.deepEqual(await Promise.all(requests),Array(12).fill(200));assert.equal(await f.status(cookie),200);assert.deepEqual(business(f.options.dbFile),snapshot);
  await f.stop();restoreBackup(backup.file,f.options);await f.start();assert.equal(await f.status(cookie),401);
});

test('restore excludes server startup and a second restore before any staging file exists',async t=>{
  const f=await fixture(t);await f.start();const old=await f.login();await f.stop();const backup=createBackup(f.options);
  const ready=path.join(f.dir,'restore-ready'),release=path.join(f.dir,'restore-release');
  const code=`import fs from 'node:fs';import {restoreBackup} from './src/backup.mjs';const {file,options,ready,release}=JSON.parse(process.env.TEST_RESTORE);let first=true;restoreBackup(file,{...options,writeStage(target,content){if(first){first=false;fs.writeFileSync(ready,'ready');const until=Date.now()+15000;while(!fs.existsSync(release)){if(Date.now()>until)throw Error('Controlled restore pause timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}fs.writeFileSync(target,content,{flag:'wx',mode:0o600});}});`;
  const restorer=f.spawn(['--input-type=module','-e',code],{TEST_RESTORE:JSON.stringify({file:backup.file,options:f.options,ready,release})});
  try{
    await waitUntil(()=>fs.existsSync(ready),'Restorer did not reach the pre-stage pause');
    assert.equal(fs.readdirSync(f.dir).some(name=>name.includes('.restore-')),false);
    const port=await freePort(),contender=f.spawn(['src/server.mjs'],{WORKSPACE_PORT:String(port)});
    await waitUntil(()=>contender.child.exitCode!==null,'Server accepted startup during the pre-stage restore window');
    assert.notEqual(contender.child.exitCode,0);assert.match(contender.logs,/database.*in use/i);
    assert.throws(()=>restoreBackup(backup.file,f.options),/database.*in use/i);
  }finally{fs.writeFileSync(release,'release');await restorer.ended;}
  assert.equal(restorer.child.exitCode,0,restorer.logs);await f.start();assert.equal(await f.status(old),401);assert.equal(await f.status(await f.login()),200);
});

test('legacy uncompressed backups without a session table migrate to empty sessions',async t=>{
  const f=await fixture(t),db=new DatabaseSync(f.options.dbFile);db.exec('DROP TABLE browser_sessions; ALTER TABLE tasks DROP COLUMN approval_base_head');db.close();
  const snapshot=business(f.options.dbFile),backup=createBackup(f.options),envelope=JSON.parse(fs.readFileSync(backup.file));
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(f.options.key,'hex'),Buffer.from(envelope.iv,'base64'));
  decipher.setAAD(Buffer.from('AI_DEV_WORKSPACE_BACKUP|1|gzip'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const plain=gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]));
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(f.options.key,'hex'),iv),ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  const legacy=path.join(f.dir,'legacy.awbackup');fs.writeFileSync(legacy,JSON.stringify({magic:'AI_DEV_WORKSPACE_BACKUP',format:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
  assert.equal(verifyBackup(legacy,f.options).tasks,2);restoreBackup(legacy,{...f.options,restoreCredentials:true});await f.start();assert.equal(sessions(f.options.dbFile),0);assert.equal(await f.status(await f.login()),200);
  const migrated=business(f.options.dbFile);for(const row of migrated.tasks)delete row.approval_base_head;assert.deepEqual(migrated,snapshot);
});

test('killing a partially completed restore releases its lock but keeps startup fail closed',async t=>{
  const f=await fixture(t);await f.start();await f.login();await f.stop();const backup=createBackup(f.options),ready=path.join(f.dir,'partial-restore-ready');
  const code=`import fs from 'node:fs';import {restoreBackup} from './src/backup.mjs';const {file,options,ready}=JSON.parse(process.env.TEST_RESTORE);restoreBackup(file,{...options,beforeReplace(_target,index){if(index===1){fs.writeFileSync(ready,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);throw Error('Controlled crash was not injected');}}});`;
  const restorer=f.spawn(['--input-type=module','-e',code],{TEST_RESTORE:JSON.stringify({file:backup.file,options:f.options,ready})});
  await waitUntil(()=>fs.existsSync(ready),'Restorer did not install its sanitized DB');assert.equal(sessions(f.options.dbFile),0);
  await stop(restorer,'SIGKILL');
  assert.throws(()=>restoreBackup(backup.file,f.options),/Interrupted Workspace restore/,'OS lock must release after crash, while partial restore markers block reuse');
  const server=f.spawn(['src/server.mjs']);await waitUntil(()=>server.child.exitCode!==null,'Server exposed a partially restored database');assert.notEqual(server.child.exitCode,0);assert.match(server.logs,/Interrupted Workspace restore/);
});
