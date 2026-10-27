// Refresh PUBLIC evidence into a new ignored directory; never changes approval inputs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const destination=path.resolve(process.argv[2]||'');
if(!destination.startsWith(path.join(root,'data')+path.sep)||fs.existsSync(destination))throw new Error('Pass a new directory under this Workspace data/');
fs.mkdirSync(destination,{recursive:true,mode:0o700});
const evidence=path.join(root,'evidence/t7-h');
const signatures=JSON.parse(fs.readFileSync(path.join(evidence,'signature-downloads.json'))).artifacts;
const keys=JSON.parse(fs.readFileSync(path.join(evidence,'key-sources.json')));
const jobs=[...signatures.map(s=>({name:s.path,url:s.url,expectedSha256:s.signatureSha256,expectedStatus:s.httpStatus,limit:50000})),
  ...keys.map(k=>({name:k.name,url:k.url,expectedSha256:k.sha256,expectedStatus:k.status,limit:8*1024*1024}))];
const hosts=new Set(['repo.maven.apache.org','plugins.gradle.org','raw.githubusercontent.com','keyserver.ubuntu.com','downloads.apache.org','spring.io','logback.qos.ch','docs.gradle.org']);
let next=0;const results=[];
await Promise.all(Array.from({length:6},async()=>{
  while(next<jobs.length){
    const job=jobs[next++];const url=new URL(job.url);
    if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password)throw new Error('Unreviewed public evidence origin');
    try{
      const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>job.limit)throw new Error('Evidence size limit');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks),digest=createHash('sha256').update(bytes).digest('hex');
      const file=createHash('sha256').update(job.url).digest('hex')+'.public';
      if(response.status===200)fs.writeFileSync(path.join(destination,file),bytes,{flag:'wx',mode:0o600});
      results.push({...job,httpStatus:response.status,sha256:digest,file:response.status===200?file:null,
        byteMatch:job.expectedSha256?digest===job.expectedSha256:null,statusMatch:response.status===job.expectedStatus,location:response.headers.get('location')});
    }catch(error){results.push({...job,error:error.message});}
  }
}));
fs.writeFileSync(path.join(destination,'refresh-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),approvalIssued:false,results},null,2));
console.log(JSON.stringify({checked:results.length,errors:results.filter(r=>r.error).length,changed:results.filter(r=>r.byteMatch===false).length,approvalIssued:false}));
