import fs from 'node:fs';
import path from 'node:path';
import { root } from './config.mjs';

const idPattern = /^[a-z][a-z0-9_-]{1,39}$/;
export function projects() {
  const file=process.env.WORKSPACE_PROJECTS_FILE || path.join(root,'projects.json');
  const entries=JSON.parse(fs.readFileSync(file,'utf8')).projects;
  if(!Array.isArray(entries)||!entries.length) throw new Error('No projects configured');
  const result=new Map();
  for(const item of entries) {
    if(!idPattern.test(item.id)||result.has(item.id)||typeof item.name!=='string'||!item.repositories||typeof item.repositories!=='object') throw new Error('Invalid project configuration');
    if(item.design?.contextFiles&&(!Array.isArray(item.design.contextFiles)||item.design.contextFiles.some(file=>typeof file!=='string'||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))))throw new Error(`Invalid design context paths for ${item.id}`);
    const repositories={};
    for(const [key,repo] of Object.entries(item.repositories)) {
      if(!idPattern.test(key)||typeof repo.path!=='string'||!Array.isArray(repo.checks)||!repo.checks.every(check=>Array.isArray(check)&&check.length>0&&check.every(arg=>typeof arg==='string'))||(repo.setup&&(!Array.isArray(repo.setup)||!repo.setup.every(step=>typeof step.ifMissing==='string'&&Array.isArray(step.command)&&step.command.length>0&&step.command.every(arg=>typeof arg==='string'))))||(repo.checkTimeoutMs!=null&&(!Number.isInteger(repo.checkTimeoutMs)||repo.checkTimeoutMs<1000||repo.checkTimeoutMs>900000))) throw new Error(`Invalid repository ${item.id}/${key}`);
      const override=process.env[`WORKSPACE_REPO_${item.id}_${key}`.toUpperCase()];
      repositories[key]={...repo,path:path.resolve(root,override||repo.path)};
    }
    result.set(item.id,{id:item.id,name:item.name,repositories,design:item.design||{adapter:'generic'}});
  }
  return result;
}
export function project(id) {const item=projects().get(id);if(!item)throw new Error(`Unknown project ${id}`);return item;}
export function repository(projectId,repoId) {const repo=project(projectId).repositories[repoId];if(!repo)throw new Error(`Unknown repository ${projectId}/${repoId}`);return repo;}
export function publicProjects() {return [...projects().values()].map(item=>({id:item.id,name:item.name,repositories:Object.fromEntries(Object.entries(item.repositories).map(([key,repo])=>[key,{stack:repo.stack}])),design:item.design}));}
