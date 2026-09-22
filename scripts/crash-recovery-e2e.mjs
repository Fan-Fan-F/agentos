import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { TaskRunner, StubAdapter } from '../packages/agents/dist/index.js';

const childMode=['child','followup-child'].includes(process.argv[2]);
const followupChild=process.argv[2]==='followup-child';
const root=childMode ? process.argv[3] : fs.mkdtempSync(path.join(os.tmpdir(),'agentos 崩溃 验证 '));
const repo=path.join(root,'repo');
const dataDir=path.join(root,'data');
const git=(args)=>{
 const result=spawnSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
};
if(childMode){
 const agent=new StubAdapter('claude',()=>{
   const task=JSON.parse(fs.readFileSync(path.join(root,'task.json'),'utf8'));
   const eventFile=path.join(dataDir,'tasks',task.id,'events.jsonl');
   const events=fs.readFileSync(eventFile,'utf8').trim().split('\n').map(JSON.parse);
   const worktree=events.find(e=>e.type==='worktree.created').payload.path;
   fs.writeFileSync(path.join(worktree,followupChild ? 'unsaved-followup.txt' : 'unsaved.txt'),'uncommitted crash output');
   process.kill(process.pid,'SIGKILL');
   throw new Error('Unreachable');
 });
 const runner=new TaskRunner({dataDir,adapters:[agent]});
 const task=followupChild ? JSON.parse(fs.readFileSync(path.join(root,'task.json'),'utf8')) : await runner.createTask({repoRoot:repo,objective:'recover a killed first run'});
 fs.writeFileSync(path.join(root,'task.json'),JSON.stringify(task));
 if(followupChild) await runner.followUp(task.id,{message:'crash after writing more output'});
 else await runner.runTask(task.id,{agentId:'claude'});
}else{
 fs.mkdirSync(repo);
 git(['init']);git(['config','user.name','agentos-crash-test']);git(['config','user.email','test@agentos.local']);
 fs.writeFileSync(path.join(repo,'README.md'),'baseline');git(['add','.']);git(['commit','-m','baseline']);
 const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'child',root],{encoding:'utf8',timeout:30000,windowsHide:true});
 assert.notEqual(child.status,0,'the child must actually crash');
 const task=JSON.parse(fs.readFileSync(path.join(root,'task.json'),'utf8'));
 const runner=new TaskRunner({dataDir,adapters:[new StubAdapter('claude',{finalMessage:'recovery contract only'}),new StubAdapter('codex',{finalMessage:'handoff recovery contract only'})]});
 assert.equal((await runner.getTask(task.id)).runs.length,0);
 assert.equal((await runner.getTask(task.id)).status,'running');
 // Inject valid JSON that is not an event into this disposable crashed task only.
 const eventsPath=path.join(dataDir,'tasks',task.id,'events.jsonl');
 const invalidEvents='null\n[]\n{"id":"broken","type":4}\n';
 fs.appendFileSync(eventsPath,invalidEvents);
 await runner.recoverAll();
 assert.ok(fs.readFileSync(eventsPath,'utf8').includes(invalidEvents),'invalid records remain on disk as evidence');
 const outcome=await runner.resumeTask(task.id);
 assert.equal(fs.readFileSync(path.join(outcome.worktreePath,'unsaved.txt'),'utf8'),'uncommitted crash output');
 assert.equal((await runner.getTask(task.id)).status,'waiting');
 assert.equal(fs.existsSync(path.join(repo,'unsaved.txt')),false);
 const followup=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'followup-child',root],{encoding:'utf8',timeout:30000,windowsHide:true});
 assert.notEqual(followup.status,0,'follow-up child must actually crash');
 assert.equal((await runner.getTask(task.id)).status,'running');
 await runner.recoverAll();
 const swapped=await runner.swapAgent(task.id,{toAgentId:'codex'});
 assert.equal(fs.readFileSync(path.join(swapped.worktreePath,'unsaved-followup.txt'),'utf8'),'uncommitted crash output');
 assert.equal(fs.existsSync(path.join(repo,'unsaved-followup.txt')),false);
 console.log(JSON.stringify({result:'PASS',type:'real Windows process kill + real Git; stub agent contract',root,filesPreserved:true,mainUntouched:true,handoffAfterCrash:true}));
}
