// DrawingBot server for the Raspberry Pi: serves the app on the local network,
// owns the USB port of the plotter and runs uploaded projects by itself.
import http from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,writeFile,readdir,unlink,mkdir,stat} from 'node:fs/promises';
import {resolve,join,extname,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {composeJob,validateDocument,documentProject} from '../src/document.mjs';
import {Machine} from '../src/machine.mjs';
import {MarlinLink,SimulatedLink} from '../src/serial.mjs';
import {findSerialPort,NodeSerialTransport} from './node-serial.mjs';

const VERSION=typeof __DRAWINGBOT_VERSION__!=='undefined'?__DRAWINGBOT_VERSION__:'dev';
const here=dirname(fileURLToPath(import.meta.url));
const env=process.env;
const SIMULATE=process.argv.includes('--simulate')||env.DRAWINGBOT_SIMULATE==='1';
const PORT=Number(env.PORT||8790),HOST=env.HOST||'0.0.0.0';
const STATIC=resolve(env.DRAWINGBOT_STATIC||(existsSync(join(here,'app'))?join(here,'app'):join(here,'..','dist')));
const DATA=resolve(env.DRAWINGBOT_DATA||join(here,'..','.drawingbot-data'));
const JOBS=join(DATA,'jobs');
const PIN=String(env.DRAWINGBOT_PIN||'').trim();
const SERIAL=env.DRAWINGBOT_SERIAL||'auto';
const MAX_BODY=8e6,MAX_JOBS=200;

// ---- Live updates (Server-Sent Events) ----
const clients=new Set(),logs=[];
function send(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
function broadcast(event,data){for(const res of clients)send(res,event,data);}
let stateTimer=null;
function pushState(){
  if(stateTimer)return;
  stateTimer=setTimeout(()=>{stateTimer=null;broadcast('state',machine.snapshot());},80);
}
const machine=new Machine({
  onChange:pushState,
  onNotice:notice=>{console.log((notice.error?'! ':'· ')+notice.message);broadcast('notice',notice);},
  onLine:line=>{logs.push(line);if(logs.length>200)logs.shift();broadcast('log',line);}
});

// ---- Machine connection ----
let autoConnect=true,nextAttempt=0;
async function connectMachine(){
  if(SIMULATE)return machine.connect(h=>new SimulatedLink({onLine:h.onLine}),{simulated:true});
  const path=await findSerialPort(SERIAL);
  if(!path)throw Error('A CR-10 não foi encontrada numa porta USB do DrawingBot.');
  return machine.connect(h=>new MarlinLink({transport:new NodeSerialTransport(path),...h}));
}
const autoTimer=setInterval(async()=>{
  const s=machine.state;
  if(!autoConnect||s.connected||s.connecting||Date.now()<nextAttempt)return;
  nextAttempt=Date.now()+15000;
  try{await connectMachine();machine.notice('Máquina ligada ao DrawingBot. Começa pela origem X/Y.');}
  catch(error){console.log('Ligação automática: '+error.message);}
},3000);
autoTimer.unref();

const actions={
  async connect(){
    autoConnect=true;
    if(machine.state.connected)await machine.disconnect();
    await connectMachine();return 'Ligação pronta. Começa pela origem X/Y, com a caneta levantada.';
  },
  async disconnect(){autoConnect=false;await machine.disconnect();return 'Máquina desligada do DrawingBot.';},
  home:()=>machine.home(),
  setZero:p=>machine.setZero({lift:p.lift}),
  jog:p=>machine.jog({axis:p.axis,sign:p.sign,step:p.step,bedWidth:p.bedWidth,bedHeight:p.bedHeight}),
  penUp:p=>machine.penUp({lift:p.lift}),
  penDown:p=>machine.penDown({drawZ:p.drawZ}),
  release:()=>machine.release(),
  setBed:p=>machine.setBed({target:p.target}),
  endstops:()=>machine.endstops(),
  position:()=>machine.position(),
  pause:()=>machine.pause(),
  resume:()=>machine.resume(),
  cancel:()=>machine.cancel(),
  emergency:()=>machine.emergency()
};

// ---- Uploaded projects ----
let jobs=[];
const validId=id=>/^[a-z0-9]{6,40}$/.test(id);
async function loadJobs(){
  await mkdir(JOBS,{recursive:true});
  const list=[];
  for(const name of await readdir(JOBS)){
    if(!name.endsWith('.json'))continue;
    try{list.push(JSON.parse(await readFile(join(JOBS,name),'utf8')).meta);}catch{}
  }
  jobs=list.filter(j=>j&&validId(j.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function summary(project){
  const job=composeJob(project.objects,project.settings);
  if(job.errors.length)throw Error(job.errors.join(' '));
  return job;
}
async function addJob(body){
  if(jobs.length>=MAX_JOBS)throw httpError(409,'O DrawingBot já tem demasiados projetos. Apaga alguns antes de enviar mais.');
  let project;
  try{project=validateDocument(body);}catch(error){throw httpError(400,error.message);}
  let job;try{job=summary(project);}catch(error){throw httpError(400,error.message);}
  const id=Date.now().toString(36)+randomBytes(4).toString('hex');
  const meta={id,name:project.fileName,createdAt:new Date().toISOString(),strokes:job.metrics.strokes,seconds:Math.round(job.metrics.seconds),
    width:Math.round(job.bounds.width*10)/10,height:Math.round(job.bounds.height*10)/10,tip:job.settings.tip};
  await writeFile(join(JOBS,id+'.json'),JSON.stringify({meta,project:documentProject(project)}));
  jobs.unshift(meta);broadcast('jobs',jobs);return meta;
}
async function readJob(id){
  if(!validId(id))throw httpError(404,'Projeto não encontrado.');
  try{return JSON.parse(await readFile(join(JOBS,id+'.json'),'utf8'));}catch{throw httpError(404,'Projeto não encontrado.');}
}
async function startJob(id){
  const {meta,project}=await readJob(id);
  const valid=validateDocument(project);
  await machine.start(summary(valid),{name:meta.name});
  return `A desenhar «${meta.name}».`;
}
async function deleteJob(id){
  if(!validId(id))throw httpError(404,'Projeto não encontrado.');
  await unlink(join(JOBS,id+'.json')).catch(()=>{});
  jobs=jobs.filter(j=>j.id!==id);broadcast('jobs',jobs);
}

// ---- Optional PIN ----
const sessions=new Set();let failures=0,lockedUntil=0;
const digest=value=>createHash('sha256').update(String(value)).digest();
function cookies(req){
  const out={};for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim();}
  return out;
}
const authorized=req=>!PIN||sessions.has(cookies(req).drawingbot_session);
function login(req,res,pin){
  if(!PIN)return {ok:true};
  if(Date.now()<lockedUntil)throw httpError(429,'Demasiadas tentativas. Espera 30 segundos.');
  if(!timingSafeEqual(digest(pin),digest(PIN))){
    if(++failures>=5){failures=0;lockedUntil=Date.now()+30000;}
    throw httpError(401,'PIN errado.');
  }
  failures=0;const token=randomBytes(24).toString('hex');
  sessions.add(token);if(sessions.size>50)sessions.delete(sessions.values().next().value);
  res.setHeader('Set-Cookie',`drawingbot_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
  return {ok:true};
}

// ---- HTTP ----
function httpError(status,message){return Object.assign(Error(message),{status});}
function json(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
function readBody(req){
  return new Promise((resolveBody,reject)=>{
    if(!/^application\/json\b/i.test(req.headers['content-type']||''))return reject(httpError(415,'Pedido inválido.'));
    let size=0;const chunks=[];
    req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(httpError(413,'O projeto é demasiado grande.'));req.destroy();}else chunks.push(chunk);});
    req.on('end',()=>{try{resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(httpError(400,'JSON inválido.'));}});
    req.on('error',reject);
  });
}
function events(req,res){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 2000\n\n');
  send(res,'state',machine.snapshot());send(res,'jobs',jobs);
  for(const line of logs.slice(-60))send(res,'log',line);
  clients.add(res);
  const ping=setInterval(()=>res.write(': ping\n\n'),20000);
  req.on('close',()=>{clearInterval(ping);clients.delete(res);});
}
async function api(req,res,path){
  const method=req.method;
  // Cross-site pages cannot drive the plotter: JSON only and same-origin.
  if(method!=='GET'){
    const origin=req.headers.origin;
    if(origin){try{if(new URL(origin).host!==req.headers.host)throw 0;}catch{throw httpError(403,'Origem não autorizada.');}}
  }
  if(path==='info'&&method==='GET')return json(res,200,{app:'drawingbot',version:VERSION,simulated:SIMULATE,pinRequired:!!PIN});
  if(path==='session'){
    if(method==='GET')return json(res,200,{required:!!PIN,ok:authorized(req)});
    if(method==='POST'){const body=await readBody(req);return json(res,200,login(req,res,body.pin));}
  }
  if(!authorized(req))throw httpError(401,'Introduz o PIN do DrawingBot.');
  if(path==='events'&&method==='GET')return events(req,res);
  if(path==='state'&&method==='GET')return json(res,200,machine.snapshot());
  if(path==='log'&&method==='GET')return json(res,200,logs);
  let m;
  if((m=path.match(/^machine\/(\w+)$/))&&method==='POST'){
    const action=Object.hasOwn(actions,m[1])?actions[m[1]]:null;
    if(!action)throw httpError(404,'Ação desconhecida.');
    const params=await readBody(req);
    try{return json(res,200,{ok:true,result:await action(params||{})??null});}
    catch(error){throw error.status?error:httpError(409,error.message);}
  }
  if(path==='jobs'&&method==='GET')return json(res,200,jobs);
  if(path==='jobs'&&method==='POST')return json(res,201,await addJob(await readBody(req)));
  if((m=path.match(/^jobs\/([a-z0-9]+)$/))){
    if(method==='GET')return json(res,200,await readJob(m[1]));
    if(method==='DELETE'){await deleteJob(m[1]);return json(res,200,{ok:true});}
  }
  if((m=path.match(/^jobs\/([a-z0-9]+)\/start$/))&&method==='POST'){
    await readBody(req);
    try{return json(res,200,{ok:true,result:await startJob(m[1])});}
    catch(error){throw error.status?error:httpError(409,error.message);}
  }
  throw httpError(404,'Endereço desconhecido.');
}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json',
  '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.woff':'font/woff','.png':'image/png','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
async function staticFile(req,res,pathname){
  if(!['GET','HEAD'].includes(req.method))throw httpError(405,'Método não suportado.');
  let file=resolve(STATIC,'.'+decodeURIComponent(pathname));
  if(file!==STATIC&&!file.startsWith(STATIC+sep))throw httpError(404,'Não encontrado.');
  try{if((await stat(file)).isDirectory())file=join(file,'index.html');}catch{file=join(STATIC,'index.html');}
  let body;try{body=await readFile(file);}catch{throw httpError(404,'Não encontrado.');}
  res.writeHead(200,{'Content-Type':TYPES[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Content-Length':body.length});
  res.end(req.method==='HEAD'?undefined:body);
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
    const {pathname}=new URL(req.url,'http://drawingbot');
    if(pathname.startsWith('/api/'))await api(req,res,pathname.slice(5));
    else await staticFile(req,res,pathname);
  }catch(error){
    if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Erro interno do DrawingBot.'});
    if(!error.status)console.error(error);
  }
});

await loadJobs();
server.listen(PORT,HOST,()=>console.log(`DrawingBot ${VERSION} em http://${HOST}:${server.address().port}${SIMULATE?' (simulação)':''} · app: ${STATIC} · dados: ${DATA}`));
async function shutdown(){
  clearInterval(autoTimer);server.close();
  for(const res of clients)res.end();
  try{machine.runner?.cancel();await machine.link?.disconnect();}catch{}
  process.exit(0);
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
