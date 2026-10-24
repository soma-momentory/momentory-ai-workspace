import fs from 'node:fs';
import path from 'node:path';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

const continued=process.argv[2];
const cwd=process.env.WORKSPACE_REVIEW_CWD||root;
const prompt=continued?`Stop reading files and return your review verdict immediately based on the evidence you have already inspected in this session. Start with PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE. List only concrete remaining correctness or security issues with file and line evidence. Do not call tools or edit files.`:process.env.WORKSPACE_REVIEW_TARGET==='followup'?`Review the current dev HEAD against your prior findings: shared npm config/cache, PID reuse during WSL cleanup, bounded subprocess shutdown and live-scope success gating, Gradle cached dependency writes, and provider output buffering. Inspect source and tests, then return PASS or FIX_REQUIRED with only remaining concrete issues and file/line evidence. Do not edit files or use shell commands.`:`Independently review the current AI Development Workspace P0 release changes and the Momentory FE structural-design branch under worktrees/momentory/structural-design-p0. Read the actual files. Focus on (1) Windows WSL Codex root-deny isolation and bounded subprocess cleanup, (2) WSL verification commands and dependency setup, (3) partial-worktree and follow-up recovery, (4) structural design schema, editor, and isolated apply. Identify correctness and security failures with file/line evidence, and distinguish tested from untested behavior. Begin with PASS or FIX_REQUIRED. Do not edit files or use shell commands.`;
const result=await runProvider({provider:'claude',cwd,prompt,sessionId:continued||null,readOnly:true,timeoutMs:240000});
const dir=path.join(root,'data','reviews');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`claude-p0-${Date.now()}.json`);
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,code:result.code,sessionId:result.sessionId,result:result.result,file},null,2));
if(!result.ok)process.exitCode=1;
