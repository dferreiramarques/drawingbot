// Browser side of the DrawingBot Raspberry Pi server: same interface as Machine,
// but every action runs on the Pi, which owns the USB port and the running job.
import {initialState} from './machine.mjs';

export async function detectServer(base='./api/'){
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);
    const response=await fetch(base+'info',{signal:controller.signal,cache:'no-store'});clearTimeout(timer);
    if(!response.ok)return null;
    const info=await response.json();
    return info?.app==='drawingbot'?info:null;
  }catch{return null;}
}

export class RemoteMachine {
  constructor({base='./api/',onChange=()=>{},onNotice=()=>{},onLine=()=>{},onJobs=()=>{},onAuth=()=>{}}={}){
    this.base=base;this.onChange=onChange;this.onNotice=onNotice;this.onLine=onLine;this.onJobs=onJobs;this.onAuth=onAuth;
    this.state=initialState();this.remote=true;this.online=false;this.jobs=[];
  }
  async request(path,{method='GET',body}={}){
    const response=await fetch(this.base+path,{method,cache:'no-store',credentials:'same-origin',
      headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    let data={};try{data=await response.json();}catch{}
    if(response.status===401){this.onAuth();throw Error(data.error||'Introduz o PIN do DrawingBot.');}
    if(!response.ok)throw Error(data.error||`O DrawingBot respondeu ${response.status}.`);
    return data;
  }
  async session(){return this.request('session');}
  async login(pin){await this.request('session',{method:'POST',body:{pin:String(pin)}});this.open();}
  open(){
    this.events?.close();
    const events=new EventSource(this.base+'events');this.events=events;
    events.addEventListener('state',e=>{this.online=true;this.state=JSON.parse(e.data);this.onChange(this.state);});
    events.addEventListener('notice',e=>this.onNotice(JSON.parse(e.data)));
    events.addEventListener('log',e=>this.onLine(JSON.parse(e.data)));
    events.addEventListener('jobs',e=>{this.jobs=JSON.parse(e.data);this.onJobs(this.jobs);});
    events.onerror=()=>{
      if(this.online){this.online=false;this.onChange(this.state);}
      // A refused stream (e.g. session lost after a Pi restart) is not retried by the browser.
      if(events.readyState===EventSource.CLOSED&&this.events===events)setTimeout(async()=>{
        if(this.events!==events)return;
        try{const session=await this.session();if(session.required&&!session.ok)this.onAuth();else this.open();}
        catch{setTimeout(()=>this.events===events&&this.open(),3000);}
      },2000);
    };
  }
  close(){this.events?.close();this.events=null;}
  async action(name,params){const data=await this.request('machine/'+name,{method:'POST',body:params||{}});return data.result;}
  connect(){return this.action('connect');}
  disconnect(){return this.action('disconnect');}
  home(){return this.action('home');}
  setZero(p){return this.action('setZero',p);}
  jog(p){return this.action('jog',p);}
  penUp(p){return this.action('penUp',p);}
  penDown(p){return this.action('penDown',p);}
  release(){return this.action('release');}
  setBed(p){return this.action('setBed',p);}
  endstops(){return this.action('endstops');}
  position(){return this.action('position');}
  pause(){return this.action('pause');}
  resume(){return this.action('resume');}
  cancel(){return this.action('cancel');}
  emergency(){return this.action('emergency');}
  listJobs(){return this.request('jobs');}
  upload(project){return this.request('jobs',{method:'POST',body:project});}
  startJob(id){return this.request('jobs/'+encodeURIComponent(id)+'/start',{method:'POST',body:{}});}
  deleteJob(id){return this.request('jobs/'+encodeURIComponent(id),{method:'DELETE'});}
}
