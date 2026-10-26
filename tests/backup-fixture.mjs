import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
export function backupFixture(db,token,workerToken,projectsFile=null){
  const key=randomBytes(32).toString('hex');
  const envFile=`${db}.env`,screenshotsDir=`${db}.screenshots`,backupDir=`${db}.backups`,configuredProjects=projectsFile||`${db}.projects.json`;
  fs.mkdirSync(path.dirname(envFile),{recursive:true});
  fs.mkdirSync(screenshotsDir,{recursive:true});
  if(!projectsFile)fs.copyFileSync(path.join(root,'projects.json'),configuredProjects);
  fs.writeFileSync(envFile,`WORKSPACE_TOKEN=${token}\nWORKER_TOKEN=${workerToken}\nWORKSPACE_BACKUP_KEY=${key}\n`,{flag:'wx',mode:0o600});
  return {WORKSPACE_BACKUP_KEY:key,WORKSPACE_BACKUP_ENV_FILE:envFile,WORKSPACE_SCREENSHOTS_DIR:screenshotsDir,WORKSPACE_BACKUP_DIR:backupDir,WORKSPACE_PROJECTS_FILE:configuredProjects};
}
