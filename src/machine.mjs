// Machine state and safe action sequences. Shared by the browser (USB/simulation)
// and the Raspberry Pi server, so both enforce the same rules.
import {jobCommands} from './geometry.mjs';
import {JobRunner} from './serial.mjs';

export const JOG_STEPS=[.1,1,5,10];

export function initialState(){
  return {connected:false,connecting:false,simulated:false,busy:false,running:false,homed:false,zero:false,fault:false,
    position:{x:null,y:null,z:null},runState:'idle',progress:0,job:null,bed:{temp:null,target:null},endstops:null};
}

export class Machine {
  constructor({onChange=()=>{},onNotice=()=>{},onLine=()=>{},pollInterval=6000}={}){
    this.onChange=onChange;this.onNotice=onNotice;this.onLine=onLine;this.pollInterval=pollInterval;
    this.state=initialState();this.link=null;this.runner=null;this.pollTimer=null;
  }
  set(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
  snapshot(){return structuredClone(this.state);}
  notice(message,error=false){this.onNotice({message,error});}
  line(text){
    this.onLine(text);
    const temp=text.match(/\bB:([\d.]+)\s*\/([\d.]+)/);
    if(temp)this.set({bed:{temp:Number(temp[1]),target:Number(temp[2])}});
  }
  handlers(){return {onLine:text=>this.line(text),onReset:()=>this.handleReset(),onDisconnect:()=>this.handleDisconnect()};}
  clearReferences(){this.set({homed:false,zero:false});}
  handleReset(){
    const patch={homed:false,zero:false};
    if(this.runner){this.runner.cancel();Object.assign(patch,{fault:true,runState:'error'});}
    this.set(patch);this.notice('A placa reiniciou. Repete a origem X/Y e o contacto Z.');
  }
  handleDisconnect(){
    this.stopPolling();this.runner?.cancel();
    this.set({connected:false,fault:true,homed:false,zero:false});
    this.notice('USB desligado. As referências precisam de ser definidas novamente.',true);
  }

  // createLink(handlers) must return an unconnected link with connect().
  async connect(createLink,{simulated=false}={}){
    if(this.state.connected||this.state.connecting)throw Error('A máquina já está ligada.');
    this.set({connecting:true,fault:false,homed:false,zero:false,simulated});
    const link=createLink(this.handlers());
    try{
      await link.connect();this.link=link;
      this.set({connected:true,runState:'idle',progress:0,job:null});
      await link.sync();this.set({position:await link.position()});await link.command('M105');
      this.startPolling();
    }catch(error){
      try{await link.disconnect();}catch{}
      this.link=null;this.set({connected:false,simulated:false});throw error;
    }finally{this.set({connecting:false});}
  }
  async disconnect(){
    if(this.runner)throw Error('Termina o trabalho antes de desligar.');
    this.stopPolling();const link=this.link;this.link=null;
    try{await link?.disconnect();}finally{this.state=initialState();this.set({});}
  }
  stopPolling(){clearInterval(this.pollTimer);this.pollTimer=null;}
  startPolling(){
    this.stopPolling();if(!this.pollInterval)return;
    this.pollTimer=setInterval(()=>{
      const s=this.state;
      if(s.connected&&!s.busy&&!this.runner&&!s.connecting&&!s.fault)
        this.act(async()=>{this.set({position:await this.link.position()});await this.link.command('M105');}).catch(()=>{});
    },this.pollInterval);
    this.pollTimer.unref?.();
  }

  async act(action){
    const s=this.state;
    if(!s.connected)throw Error('Liga a máquina primeiro.');
    if(s.fault)throw Error('Reinicia a ligação e redefine as referências.');
    if(s.busy||this.runner)throw Error('A máquina está ocupada.');
    this.set({busy:true});
    try{await this.link.sync();return await action();}
    catch(error){if(!this.link?.connected){this.set({connected:false,homed:false,zero:false});}throw error;}
    finally{this.set({busy:false});}
  }
  async refresh(){const p=await this.link.position();this.set({position:p});return p;}

  async home(){
    return this.act(async()=>{
      await this.link.command('G28 X Y',{timeout:90000});await this.link.command('M400');
      this.set({homed:true});await this.refresh();return 'Origem X/Y definida.';
    });
  }
  async setZero({lift}){
    lift=checkNumber(lift,.2,20,'Altura de levantamento inválida.');
    if(!this.state.homed)return Promise.reject(Error('Faz primeiro a origem X/Y.'));
    return this.act(async()=>{
      await this.link.command('M400');await this.link.command('G92 Z0');this.set({zero:true});
      await this.link.command('G90');await this.link.command(`G0 Z${lift} F180`);await this.link.command('M400');
      await this.refresh();return 'Contacto definido. A caneta está levantada.';
    });
  }
  async jog({axis,sign,step,bedWidth=300,bedHeight=300}){
    if(!['x','y','z'].includes(axis)||![1,-1].includes(Number(sign))||!JOG_STEPS.includes(Number(step)))
      return Promise.reject(Error('Movimento inválido.'));
    step=Number(step);
    if(axis==='z'||!this.state.homed)step=Math.min(step,1);
    return this.act(async()=>{
      const p=await this.link.position(),delta=step*Number(sign),next=p[axis]+delta;
      const limit=checkNumber(axis==='x'?bedWidth:bedHeight,20,300,'Área útil inválida.');
      if(axis!=='z'&&this.state.homed&&(next<0||next>limit))throw Error('Esse movimento sai da área útil.');
      await this.link.command('G91');
      try{await this.link.command(`G1 ${axis.toUpperCase()}${delta.toFixed(3)} F${axis==='z'?120:1200}`);await this.link.command('M400');}
      finally{await this.link.command('G90');}
      await this.refresh();
    });
  }
  async penUp({lift}){
    lift=checkNumber(lift,.2,20,'Altura de levantamento inválida.');
    return this.act(async()=>{
      await this.link.command('G90');
      if(this.state.zero)await this.link.command(`G0 Z${lift} F180`);
      else{await this.link.command('G91');await this.link.command(`G0 Z${lift} F180`);await this.link.command('G90');}
      await this.link.command('M400');await this.refresh();
    });
  }
  async penDown({drawZ}){
    drawZ=checkNumber(drawZ,-2,20,'Altura de desenho inválida.');
    if(!this.state.zero)return Promise.reject(Error('Define primeiro o contacto Z.'));
    return this.act(async()=>{await this.link.command('G90');await this.link.command(`G1 Z${drawZ} F120`);await this.link.command('M400');await this.refresh();});
  }
  async release(){
    return this.act(async()=>{await this.link.command('M400');await this.link.command('M18');this.clearReferences();return 'Motores livres. Repete as referências antes de desenhar.';});
  }
  async setBed({target}){
    target=checkNumber(target,0,60,'Escolhe uma temperatura entre 0 e 60 °C.');
    return this.act(async()=>{await this.link.command(`M140 S${target}`);await this.link.command('M105');return target?`Cama definida para ${target} °C, sem espera.`:'Aquecimento da cama desligado.';});
  }
  async endstops(){
    return this.act(async()=>{
      const result=await this.link.command('M119');
      const text=result.replace(/\nok$/,'').replace(/x_min:/,'X:').replace(/y_min:/,'Y:').replace(/TRIGGERED/g,'acionado').replace(/open/g,'livre');
      this.set({endstops:text});return text;
    });
  }
  async position(){return this.act(()=>this.refresh());}

  // Starts a job and returns once it is running. Completion is reported through notices and state.
  async start(job,{name='Desenho'}={}){
    const s=this.state;
    if(!s.connected||s.fault)throw Error('Liga a máquina e redefine as referências.');
    if(s.busy||this.runner)throw Error('A máquina está ocupada.');
    if(!s.homed||!s.zero)throw Error('Faz a origem X/Y e define o contacto Z antes de desenhar.');
    if(!job||job.errors?.length)throw Error(job?.errors?.join(' ')||'Não existe desenho preparado.');
    this.set({busy:true});
    let commands,active;
    try{
      await this.link.sync();await this.refresh();
      active=structuredClone(job);commands=jobCommands(active);
    }catch(error){this.set({busy:false});throw error;}
    const runner=new JobRunner(this.link,{
      onProgress:value=>this.set({progress:value}),
      onState:value=>this.set({runState:value}),
      onPosition:p=>this.set({position:{...this.state.position,...p}})});
    this.runner=runner;
    this.set({busy:false,running:true,progress:0,job:{name,strokes:job.metrics?.strokes||0}});
    this.done=runner.run(active,commands).then(()=>{
      const simulated=this.state.simulated;
      this.notice(this.state.runState==='complete'?(simulated?'Simulação terminada: Z10 mm e Y no máximo.':'Desenho terminado: caneta a 10 mm e Y no máximo.'):'Trabalho terminado. A caneta ficou levantada.');
    },error=>{
      this.set({fault:true,homed:false,zero:false,runState:'error'});this.notice(error.message,true);
    }).finally(()=>{this.runner=null;this.set({running:false});});
  }
  pause(){if(!this.runner)throw Error('Não há nenhum trabalho a correr.');if(this.state.runState==='paused')this.runner.resume();else this.runner.pause();}
  resume(){if(!this.runner)throw Error('Não há nenhum trabalho a correr.');this.runner.resume();}
  cancel(){this.runner?.cancel();}
  async emergency(){
    this.runner?.cancel();
    this.set({fault:true,homed:false,zero:false,runState:'error'});
    await this.link?.emergency();
    this.notice('Emergência enviada. Reinicia a máquina e volta a ligar.',true);
  }
}

function checkNumber(value,min,max,message){
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw Error(message);
  return n;
}
