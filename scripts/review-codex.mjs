import fs from 'node:fs';
import path from 'node:path';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

const prompt=`Independently review the uncommitted P0 release changes in this AI Development Workspace and the Momentory FE structural branch under worktrees/momentory/structural-design-p0. Inspect actual code. Focus on isolation fail-closed behavior, bounded subprocess cleanup, partial worktree and offline follow-up recovery, structural design schema and trusted isolated apply. Report only concrete correctness or security failures with file/line evidence. Distinguish tested from untested claims. Begin with PASS or FIX_REQUIRED. Do not edit files.`;
const result=await runProvider({provider:'codex',cwd:root,prompt,readOnly:true,timeoutMs:240000});
const dir=path.join(root,'data','reviews');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`codex-p0-${Date.now()}.json`);
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,code:result.code,sessionId:result.sessionId,result:result.result,file},null,2));
if(!result.ok)process.exitCode=1;
