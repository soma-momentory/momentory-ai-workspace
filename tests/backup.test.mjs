import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.mjs';

test('encrypted backup restores tasks, dependencies, decisions, settings and screenshots',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-backup-'));
  const options={dbFile:path.join(dir,'data','workspace.sqlite'),projectsFile:path.join(dir,'projects.json'),envFile:path.join(dir,'.env'),screenshotsDir:path.join(dir,'data','screenshots'),backupDir:path.join(dir,'backups'),key:randomBytes(32).toString('hex'),keep:2};
  fs.mkdirSync(path.dirname(options.dbFile),{recursive:true});fs.mkdirSync(options.screenshotsDir);
  fs.writeFileSync(options.projectsFile,JSON.stringify({projects:[{id:'sample',name:'Sample',repositories:{app:{path:'.',checks:[]}}}]}));
  fs.writeFileSync(options.envFile,'WORKSPACE_TOKEN=backup-fixture-secret\nWORKER_TOKEN=worker-fixture-secret\n');
  const screenshot='12345678-1234-1234-1234-123456789abc-candidate.png';
  fs.writeFileSync(path.join(options.screenshotsDir,screenshot),Buffer.from('PNG fixture'));
  const store=new Store(options.dbFile);
  const first=store.createTask({projectId:'sample',repo:'app',goal:'Plan the interface',type:'HUMAN_TASK'}, {mode:'FAST',provider:null,reason:'human'});
  const child=store.createTask({projectId:'sample',repo:'app',goal:'Implement the interface',dependsOn:[first.id]}, {mode:'FAST',provider:'codex',reason:'code'});
  store.addDecision(child.id,'risk',{question:'Approve?',basis:'fixture'});
  const candidate=store.addCandidate(child.id,'codex',{name:'fixture candidate'});
  store.setCandidateScreenshot(candidate,{candidate:screenshot,matrix:{390:{candidate:screenshot}}});
  store.close();
  try{
    const backup=createBackup(options);
    assert.equal(backup.tasks,2);
    const interrupted=`${options.dbFile}.rollback-fixture`;
    fs.renameSync(options.dbFile,interrupted);
    try{
      assert.throws(()=>createBackup(options),/Interrupted Workspace restore/);
      const result=spawnSync(process.execPath,['scripts/backup.mjs','create'],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',env:{...process.env,WORKSPACE_DATA_FILE:options.dbFile,WORKSPACE_PROJECTS_FILE:options.projectsFile,WORKSPACE_BACKUP_ENV_FILE:options.envFile,WORKSPACE_SCREENSHOTS_DIR:options.screenshotsDir,WORKSPACE_BACKUP_DIR:options.backupDir,WORKSPACE_BACKUP_KEY:options.key}});
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/Interrupted Workspace restore/);
      assert.equal(fs.existsSync(options.dbFile),false);
    }
    finally{fs.renameSync(interrupted,options.dbFile);}
    const names=['WORKSPACE_DATA_FILE','WORKSPACE_PROJECTS_FILE','WORKSPACE_BACKUP_ENV_FILE','WORKSPACE_SCREENSHOTS_DIR'];
    const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
    try{
      process.env.WORKSPACE_DATA_FILE=options.dbFile;
      for(const name of names.slice(1))delete process.env[name];
      assert.throws(()=>createBackup({key:options.key}),/Custom database requires/);
      assert.throws(()=>restoreBackup(backup.file,{key:options.key}),/Custom database requires/);
      delete process.env.WORKSPACE_DATA_FILE;
      assert.throws(()=>createBackup({dbFile:options.dbFile,key:options.key}),/Custom database requires/);
      assert.throws(()=>restoreBackup(backup.file,{dbFile:options.dbFile,key:options.key}),/Custom database requires/);
      process.env.WORKSPACE_PROJECTS_FILE=options.projectsFile;
      process.env.WORKSPACE_BACKUP_ENV_FILE=options.envFile;
      process.env.WORKSPACE_SCREENSHOTS_DIR=options.screenshotsDir;
      assert.throws(()=>createBackup({dbFile:options.dbFile,key:options.key}),/Custom database requires/);
      assert.throws(()=>restoreBackup(backup.file,{dbFile:options.dbFile,key:options.key}),/Custom database requires/);
    }finally{for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}
    const ciphertext=fs.readFileSync(backup.file,'utf8');
    assert.ok(!ciphertext.includes('backup-fixture-secret'));
    assert.ok(!ciphertext.includes('Implement the interface'));
    assert.deepEqual(verifyBackup(backup.file,options).screenshots,1);
    fs.rmSync(path.join(options.screenshotsDir,screenshot));
    assert.throws(()=>createBackup(options),/Referenced screenshot missing/);
    fs.writeFileSync(path.join(options.screenshotsDir,screenshot),Buffer.from('PNG fixture'));
    fs.writeFileSync(options.projectsFile,'changed');fs.writeFileSync(options.envFile,'changed');fs.writeFileSync(path.join(options.screenshotsDir,screenshot),'changed');
    const altered=new Store(options.dbFile);altered.patch(child.id,{status:'FAILED'},'test');altered.close();
    const damaged=path.join(dir,'damaged.awbackup');fs.writeFileSync(damaged,ciphertext.replace(/("ciphertext":")(.{1})/,(_,prefix,first)=>`${prefix}${first==='X'?'Y':'X'}`));
    assert.throws(()=>restoreBackup(damaged,options));
    assert.equal(fs.readFileSync(options.envFile,'utf8'),'changed');
    const failed=new Store(options.dbFile);assert.equal(failed.getTask(child.id).status,'FAILED');failed.close();
    assert.throws(()=>restoreBackup(backup.file,{...options,writeStage:(target,content)=>{fs.writeFileSync(target,content,{flag:'wx'});if(target.endsWith(screenshot))throw new Error('injected screenshot write failure');}}),/injected screenshot write failure/);
    assert.ok(!fs.readdirSync(path.dirname(options.screenshotsDir)).some(name=>name.includes('.restore-')));
    assert.equal(fs.readFileSync(options.projectsFile,'utf8'),'changed');
    assert.throws(()=>restoreBackup(backup.file,{...options,beforeReplace:(_,index)=>{if(index===1)throw new Error('injected rename failure');}}),/injected rename failure/);
    assert.equal(fs.readFileSync(options.projectsFile,'utf8'),'changed');
    const afterAbort=new Store(options.dbFile);assert.equal(afterAbort.getTask(child.id).status,'FAILED');afterAbort.close();
    const restored=restoreBackup(backup.file,{...options,restoreCredentials:true});
    assert.equal(restored.tasks,2);
    assert.match(fs.readFileSync(options.envFile,'utf8'),/backup-fixture-secret/);
    assert.equal(fs.readFileSync(path.join(options.screenshotsDir,screenshot),'utf8'),'PNG fixture');
    const current=new Store(options.dbFile);
    assert.deepEqual(current.getTask(child.id).dependsOn,[first.id]);
    assert.equal(current.getTask(child.id).status,'QUEUED');
    assert.equal(current.decisions(child.id).length,1);
    assert.equal(current.candidates(child.id)[0].screenshot.candidate,screenshot);
    current.close();
    fs.writeFileSync(options.envFile,'WORKSPACE_TOKEN=rotated-owner-token\nWORKER_TOKEN=rotated-worker-token\n');
    restoreBackup(backup.file,options);
    assert.match(fs.readFileSync(options.envFile,'utf8'),/rotated-owner-token/);
    const retained=restoreBackup(backup.file,{...options,removeRollback:()=>{throw new Error('injected cleanup failure');}});
    assert.ok(retained.cleanupPending.length>0);
    const afterCleanupFailure=new Store(options.dbFile);assert.equal(afterCleanupFailure.getTask(child.id).status,'QUEUED');afterCleanupFailure.close();
    for(const target of retained.cleanupPending)fs.rmSync(target,{recursive:true,force:true});
    createBackup(options);createBackup(options);
    assert.equal(fs.readdirSync(options.backupDir).filter(name=>name.endsWith('.awbackup')).length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
