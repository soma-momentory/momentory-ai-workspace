import assert from 'node:assert/strict';
import path from 'node:path';
import {verifyTask} from '../src/engine.mjs';
import {repository} from '../src/projects.mjs';

const task={project_id:'sample',repo:'app'};
const cwd=repository('sample','app').path;
const result=await verifyTask(task,cwd);
assert.equal(result.ok,true,JSON.stringify(result.checks));
assert.equal(result.checks.length,2);
console.log(JSON.stringify({status:'PASS',cwd:path.basename(cwd),checks:result.checks.map(({command,ok})=>({command,ok}))}));
