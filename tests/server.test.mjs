import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const square={closed:true,points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]};
const project={format:'drawingbot',version:1,fileName:'quadrado.svg',settings:{width:20},paths:[square]};

async function startServer(env={}){
  const data=await mkdtemp(join(tmpdir(),'drawingbot-'));
  const child=spawn(process.execPath,['pi/server.mjs','--simulate'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',DRAWINGBOT_DATA:data,...env},stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{
    let out='';child.stdout.on('data',d=>{out+=d;const m=out.match(/:(\d+)/);if(m)resolve(Number(m[1]));});
    child.on('exit',code=>reject(Error('server exited '+code)));setTimeout(()=>reject(Error('timeout')),8000);
  });
  const base=`http://127.0.0.1:${port}/api/`;
  let cookie='';
  const call=async(path,{method='GET',body,headers={}}={})=>{
    const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>null)};
  };
  const stop=async()=>{child.kill();await rm(data,{recursive:true,force:true});};
  return {call,stop};
}
const until=async(check,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition not met');};

test('the Pi server stores uploaded projects and runs them by itself',async()=>{
  const {call,stop}=await startServer();
  try{
    assert.equal((await call('info')).data.app,'drawingbot');
    await until(async()=>(await call('state')).data.connected);
    assert.equal((await call('jobs',{method:'POST',body:{...project,paths:[]}})).status,400);
    const upload=await call('jobs',{method:'POST',body:project});
    assert.equal(upload.status,201);assert.equal(upload.data.strokes,1);
    assert.equal((await call('jobs')).data.length,1);
    assert.equal((await call(`jobs/${upload.data.id}/start`,{method:'POST',body:{}})).status,409,'refused before references');
    assert.equal((await call('machine/home',{method:'POST',body:{}})).status,200);
    assert.equal((await call('machine/setZero',{method:'POST',body:{lift:3}})).status,200);
    assert.equal((await call(`jobs/${upload.data.id}/start`,{method:'POST',body:{}})).status,200);
    await until(async()=>(await call('state')).data.runState==='complete');
    assert.equal((await call(`jobs/${upload.data.id}`,{method:'DELETE'})).status,200);
    assert.equal((await call('jobs')).data.length,0);
  }finally{await stop();}
});

test('cross-site and non-JSON requests cannot move the machine',async()=>{
  const {call,stop}=await startServer();
  try{
    assert.equal((await call('machine/home',{method:'POST',body:{},headers:{Origin:'http://example.com'}})).status,403);
    assert.equal((await call('machine/home',{method:'POST',body:{},headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await call('machine/nope',{method:'POST',body:{}})).status,404);
  }finally{await stop();}
});

test('with a PIN, the API needs a session cookie',async()=>{
  const {call,stop}=await startServer({DRAWINGBOT_PIN:'4321'});
  try{
    assert.equal((await call('info')).data.pinRequired,true);
    assert.equal((await call('state')).status,401);
    assert.equal((await call('session',{method:'POST',body:{pin:'0000'}})).status,401);
    assert.equal((await call('session',{method:'POST',body:{pin:'4321'}})).status,200);
    assert.equal((await call('state')).status,200);
  }finally{await stop();}
});

const bash=spawnSync('bash',['--version']).status===0;
test('drawingbot.txt tolerates Windows line endings, quotes and comments',{skip:!bash&&'bash not available'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'drawingbot-conf-'));
  try{
    const conf=join(dir,'drawingbot.txt');
    await writeFile(conf,'﻿wifi_ssid = "Casa Rede"\r\nwifi_password=segredo123\r\n# pin=999\r\npin=4321\r\nhostname=DrawingBot\r\nserial_port=;reboot\r\n');
    const result=spawnSync('bash',['pi/apply-config.sh'],{env:{...process.env,DRY_RUN:'1',DRAWINGBOT_CONF:conf,DRAWINGBOT_STATE:join(dir,'state')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/ssid «Casa Rede»/);
    assert.doesNotMatch(result.stdout,/segredo123/);
    assert.match(result.stdout,/set-hostname drawingbot/);
    assert.match(result.stdout,/DRAWINGBOT_SERIAL=auto, PIN definido/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
