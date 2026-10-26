import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {root,loadEnv,assertNoInterruptedRestore,screenshotDirectory} from '../src/config.mjs';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.mjs';
import {Store} from '../src/store.mjs';

const [command,file]=process.argv.slice(2);
const envFile=process.env.WORKSPACE_DATA_FILE?process.env.WORKSPACE_BACKUP_ENV_FILE:path.join(root,'.env');
if(!envFile)throw new Error('Set WORKSPACE_BACKUP_ENV_FILE for a custom database');
if(command==='init'){
  if(!fs.existsSync(envFile))throw new Error('Run npm run setup first');
  const content=fs.readFileSync(envFile,'utf8');
  if(/^WORKSPACE_BACKUP_KEY=/m.test(content))throw new Error('Backup key already exists; preserved');
  fs.appendFileSync(envFile,`${content.endsWith('\n')?'':'\n'}WORKSPACE_BACKUP_KEY=${randomBytes(32).toString('hex')}\n`);
  console.log('Backup key added to the ignored .env. Keep an offline copy of this key.');
  process.exit(0);
}
loadEnv(envFile);
function hostRunning(host,port){return new Promise(resolve=>{const socket=net.connect({host,port});socket.setTimeout(1000);socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});}
if(command==='create'){
  if(process.env.WORKSPACE_DATA_FILE&&(!process.env.WORKSPACE_PROJECTS_FILE||!process.env.WORKSPACE_SCREENSHOTS_DIR))throw new Error('Custom database requires projects and screenshots paths');
  const database=process.env.WORKSPACE_DATA_FILE||path.join(root,'data','workspace.sqlite');
  assertNoInterruptedRestore([database,process.env.WORKSPACE_PROJECTS_FILE||path.join(root,'projects.json'),envFile,process.env.WORKSPACE_SCREENSHOTS_DIR||screenshotDirectory()]);
  if(!fs.existsSync(database))throw new Error('Workspace database missing; start the Workspace before creating a backup');
  const store=new Store();store.close();
  console.log(JSON.stringify(createBackup()));
}
else if(command==='verify'){
  if(!file)throw new Error('Usage: npm run backup:verify -- <file.awbackup>');
  console.log(JSON.stringify(verifyBackup(path.resolve(file))));
}else if(command==='restore'){
  if(!file)throw new Error('Usage: npm run backup:restore -- <file.awbackup>');
  if(process.env.WORKSPACE_DATA_FILE&&!process.env.WORKSPACE_PORT)throw new Error('Set WORKSPACE_PORT for a custom database restore');
  if((await Promise.all(['127.0.0.1','::1'].map(host=>hostRunning(host,Number(process.env.WORKSPACE_PORT||4178))))).some(Boolean))throw new Error('Stop the Workspace launcher before restore');
  const restoreCredentials=process.argv.includes('--restore-credentials');
  console.log(JSON.stringify(restoreBackup(path.resolve(file),{restoreCredentials})));
}else throw new Error('Use init, create, verify, or restore');
