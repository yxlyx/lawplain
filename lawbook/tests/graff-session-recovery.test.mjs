import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

registerHooks({resolve(specifier,context,next){
 try{return next(specifier,context)}catch(error){
  if(error.code==='ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !extname(specifier))
   return next(specifier+'.ts',context);
  throw error;
 }
}});
const { GraffRun } = await import('../src/server/graff-run.ts');
const params={model:'test-model',providerEnv:{CODEGRAFF_API_KEY:'test-only'},prompt:'A question',systemPrompt:'Answer it',toolCallBudget:2};
const complete='The answer is supported by the cited source and the stated facts.';
const line=event=>JSON.stringify(event)+'\n';
function fakeSandbox(){
 const files=new Map(),commands=[];let creates=0,installs=0;
 return {files,commands,get creates(){return creates},get installs(){return installs},
  async createSandbox(){creates++;return 'same-sandbox'},
  async installGraff(){installs++},
  async runProcess(sid,opts){commands.push({sid,opts});return {stdout:'123',stderr:'',exitCode:0}},
  async readSandboxFile(_sid,path){return files.get(path)??null},
 };
}

test('follow-up launches preserve the sandbox and avoid reinstalling the runtime',async()=>{
 const box=fakeSandbox(),first=new GraffRun();
 await first.launch(box,params);
 const second=new GraffRun();
 const events=await second.launch(box,params,undefined,{sandboxId:first.sandboxId,runtimeReady:true});
 assert.equal(first.sandboxId,second.sandboxId);
 assert.notEqual(first.workDir,second.workDir);
 assert.equal(box.creates,1);assert.equal(box.installs,1);
 assert.ok(events.some(e=>e.type==='progress'&&e.message.includes('Reusing')));
 assert.ok(!events.some(e=>e.phase==='agent_install'));
 assert.equal(box.commands[1].opts.envs.RUN_DIR,second.workDir);
});

test('restoring a running parser preserves streamed text, partial tags, and the exact cursor',async()=>{
 const box=fakeSandbox(),run=new GraffRun();
 await run.launch(box,params);
 const out=run.workDir+'/graff.out';
 box.files.set(out,line({type:'text',text:'The answer '} )+line({type:'text',text:'<thi'}));
 const before=await run.poll(box);
 assert.equal(before.filter(e=>e.type==='delta').map(e=>e.text).join(''),'The answer ');
 const restored=GraffRun.restore(JSON.parse(JSON.stringify(run.snapshot())));
 box.files.set(out,box.files.get(out)+line({type:'text',text:'nk>private reasoning</think>is supported by the cited source and the stated facts.'})+line({type:'turn',text:complete,cost_usd:0.1,context_tokens:100}));
 box.files.set(run.workDir+'/graff.exit','0');
 const after=await restored.poll(box);
 assert.equal(after.filter(e=>e.type==='delta').map(e=>e.text).join(''),'is supported by the cited source and the stated facts.');
 assert.ok(!JSON.stringify(after).includes('private reasoning'));
 assert.equal(after.find(e=>e.type==='done')?.text,complete);
 assert.equal(restored.sandboxId,run.sandboxId);
 assert.equal(box.creates,1);assert.equal(box.commands.length,1);
});

test('restart after terminal output emits no duplicate answer',async()=>{
 const box=fakeSandbox(),run=new GraffRun();await run.launch(box,params);
 box.files.set(run.workDir+'/graff.out',line({type:'text',text:complete}));
 box.files.set(run.workDir+'/graff.exit','0');
 assert.ok((await run.poll(box)).some(e=>e.type==='done'));
 const restored=GraffRun.restore(JSON.parse(JSON.stringify(run.snapshot())));
 assert.deepEqual(await restored.poll(box),[]);
 assert.equal(restored.finalText,complete);
});

test('ambiguous launch response cannot spawn a second guest process',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'lawplain-launch-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const bin=join(root,'bin');await mkdir(bin);
 // macOS has no setsid. This fixture checks the real launch lock; group-stop
 // behavior is checked in the Linux sandbox during the live verification.
 await writeFile(join(bin,'setsid'),'#!/bin/bash\nexec "$@"\n',{mode:0o700});
 const agent=join(bin,'agent');
 await writeFile(agent,'#!/bin/bash\nprintf "started\\n" >> "$RUN_DIR/starts"\nprintf \'%s\\n\' \'{"type":"text","text":"'+complete+'"}\'\n',{mode:0o700});
 const execute=promisify(execFile);let lost=false,launches=0,saved;
 const box=fakeSandbox();
 box.runProcess=async(_sid,opts)=>{
  launches++;
  const result=await execute(opts.cmd,opts.args,{cwd:root,env:{...process.env,...opts.envs,PATH:bin+':'+process.env.PATH,GRAFF_BIN:agent}});
  if(!lost){lost=true;throw new Error('response lost after remote launch')}
  return {...result,exitCode:0};
 };
 box.readSandboxFile=async(_sid,path)=>{try{return await readFile(path,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}};
 let run=new GraffRun(Date.now(),join(root,'turn'));
 const checkpoint=async()=>{saved=JSON.parse(JSON.stringify(run.snapshot()))};
 await assert.rejects(run.launch(box,params,checkpoint,{checkpoint}),/response lost/);
 run=GraffRun.restore(saved);
 await run.launch(box,params,checkpoint,{sandboxId:run.sandboxId,checkpoint});
 for(let i=0;i<50&&!run.done;i++){await run.poll(box);if(!run.done)await new Promise(r=>setTimeout(r,20))}
 assert.equal(run.done,true);
 assert.equal(run.finalText,complete);
 assert.equal(await readFile(join(root,'turn','starts'),'utf8'),'started\n');
 assert.equal(launches,2);assert.equal(box.creates,1);assert.equal(box.installs,1);
});
