import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {repository} from '../src/projects.mjs';
import {captureDesign,validateExport} from '../src/design.mjs';

const server=http.createServer((_req,res)=>{res.writeHead(200);res.end('unrelated lab');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const previous=process.env.WORKSPACE_LAB_URL;
process.env.WORKSPACE_LAB_URL=`http://127.0.0.1:${server.address().port}`;
try{
  const approved=JSON.parse(fs.readFileSync(path.join(repository('momentory','fe').path,'src','design','studioApproved.json'),'utf8'));
  const exported=await validateExport({version:1,name:'Port provenance',design:{...approved,'home.hero.borderRadius':24}});
  await assert.rejects(captureDesign('unowned-lab-test',exported,'home-main'),/occupied by an unowned process/);
  console.log(JSON.stringify({status:'PASS',unownedLabRejected:true}));
}finally{if(previous===undefined)delete process.env.WORKSPACE_LAB_URL;else process.env.WORKSPACE_LAB_URL=previous;await new Promise(resolve=>server.close(resolve));}
