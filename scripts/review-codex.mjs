import fs from 'node:fs';
import path from 'node:path';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

const cwd=process.env.WORKSPACE_REVIEW_CWD||root;
const continued=process.argv[2];
const prompt=continued?`Stop reading files and give your review verdict now from the evidence already inspected. Begin PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE. List only concrete correctness or security issues with file and line evidence. Do not edit files.`:process.env.WORKSPACE_REVIEW_TARGET==='followup'
  ?`Review the current dev HEAD specifically against your prior five FIX_REQUIRED findings: Windows Design Lab launch isolation, selected-design approval diff purity, mobile follow-up request-ID retention after an accepted response, bounded child cleanup, and npm dependency marker integrity. Inspect the changed source and focused tests. Return PASS or FIX_REQUIRED with only remaining concrete issues and file/line evidence. Do not edit files.`
  :process.env.WORKSPACE_REVIEW_TARGET==='final'
  ?`Review this dev HEAD's release blocker fixes. Inspect src/wslCodex.mjs, src/wslChecks.mjs, src/codexProfile.mjs, src/git.mjs, src/server.mjs, src/store.mjs and the matching new integration tests. Focus on deep secret-file denial, WSL executable escape, approved-worktree fingerprint integrity, and accidental provider CLI override. Return PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE first, then only concrete issues with file and line evidence. Do not edit files.`
  :process.env.WORKSPACE_REVIEW_TARGET==='followup_fixes'
  ?`Re-review your two findings on the newer dev HEAD: src/git.mjs inherited untracked files crossing a linked destination directory, and src/server.mjs accepting a missing or misspelled Worker claim provider. Inspect the exact fixes and tests/approved-inheritance.integration.mjs and tests/http.test.mjs. Start PASS or FIX_REQUIRED; give only concrete remaining issues with file/line evidence. Do not edit files.`
  :process.env.WORKSPACE_REVIEW_TARGET==='fe'
  ?`Independently review this Momentory FE structural-design branch. Inspect actual code and tests for schema validation, add/delete/reorder/nest/unnest editor behavior, shared React Native rendering, safe apply and visual regression. Report concrete correctness or security failures with file/line evidence. Begin PASS or FIX_REQUIRED. Do not edit files.`
  :`Independently review this AI Development Workspace P0 release commit. Inspect actual code and tests for Windows WSL Codex isolation, bounded subprocess cleanup, dependency setup, partial worktree recovery, offline follow-up deduplication, and trusted isolated design apply. Report concrete correctness or security failures with file/line evidence. Distinguish tested from untested claims. Begin PASS or FIX_REQUIRED. Do not edit files.`;
const result=await runProvider({provider:'codex',cwd,prompt,sessionId:continued||null,readOnly:true,timeoutMs:240000});
const dir=path.join(root,'data','reviews');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`codex-p0-${Date.now()}.json`);
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,code:result.code,sessionId:result.sessionId,result:result.result,file},null,2));
if(!result.ok)process.exitCode=1;
