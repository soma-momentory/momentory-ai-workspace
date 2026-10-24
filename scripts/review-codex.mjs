import fs from 'node:fs';
import path from 'node:path';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

const cwd=process.env.WORKSPACE_REVIEW_CWD||root;
const prompt=process.env.WORKSPACE_REVIEW_TARGET==='followup'
  ?`Review the current dev HEAD specifically against your prior five FIX_REQUIRED findings: Windows Design Lab launch isolation, selected-design approval diff purity, mobile follow-up request-ID retention after an accepted response, bounded child cleanup, and npm dependency marker integrity. Inspect the changed source and focused tests. Return PASS or FIX_REQUIRED with only remaining concrete issues and file/line evidence. Do not edit files.`
  :process.env.WORKSPACE_REVIEW_TARGET==='fe'
  ?`Independently review this Momentory FE structural-design branch. Inspect actual code and tests for schema validation, add/delete/reorder/nest/unnest editor behavior, shared React Native rendering, safe apply and visual regression. Report concrete correctness or security failures with file/line evidence. Begin PASS or FIX_REQUIRED. Do not edit files.`
  :`Independently review this AI Development Workspace P0 release commit. Inspect actual code and tests for Windows WSL Codex isolation, bounded subprocess cleanup, dependency setup, partial worktree recovery, offline follow-up deduplication, and trusted isolated design apply. Report concrete correctness or security failures with file/line evidence. Distinguish tested from untested claims. Begin PASS or FIX_REQUIRED. Do not edit files.`;
const result=await runProvider({provider:'codex',cwd,prompt,readOnly:true,timeoutMs:240000});
const dir=path.join(root,'data','reviews');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`codex-p0-${Date.now()}.json`);
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,code:result.code,sessionId:result.sessionId,result:result.result,file},null,2));
if(!result.ok)process.exitCode=1;
