const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const FIRMWARE_ID='CR-10 Desenho';

// Transport over the browser Web Serial API (USB connected to this computer).
export class WebSerialTransport {
  constructor(port){this.port=port;}
  async open(){
    await this.port.open({baudRate:115200,bufferSize:8192});
    try{await this.port.setSignals({dataTerminalReady:false,requestToSend:false});}catch{}
    this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();
  }
  read(){return this.reader.read();}
  write(bytes){return this.writer.write(bytes);}
  async close(){
    try{await this.reader?.cancel();}catch{}
    try{this.reader?.releaseLock();}catch{}
    try{this.writer?.releaseLock();await this.port.close();}catch{}
  }
}

export class MarlinLink {
  constructor({transport,onLine=()=>{},onReset=()=>{},onDisconnect=()=>{},bootDelay=8500}={}){
    this.transport=transport;this.onLine=onLine;this.onReset=onReset;this.onDisconnect=onDisconnect;this.bootDelay=bootDelay;
    this.pending=null;this.chain=Promise.resolve();this.connected=false;this.closing=false;
  }
  feed(line){
    line=line.trim();if(!line)return;
    this.onLine(line);
    if(line==='start'){
      this.onReset();this.pending?.reject(Error('A placa reiniciou. Repete a origem e o zero Z.'));return;
    }
    if(/^(Error:|!!|echo:.*(?:Printer halted|kill\(\) called))/i.test(line)){
      this.pending?.reject(Error(line));this.onReset();return;
    }
    if(!this.pending)return;
    const p=this.pending;p.lines.push(line);
    if(p.expect&&p.expect(line))p.seen=true;
    if(/^ok(?:\s|$)/.test(line)&&p.seen)p.resolve(p.lines.join('\n'));
  }
  async connect(){
    this.closing=false;
    await this.transport.open();
    this.connected=true;this.readTask=this.readLoop();
    await sleep(this.bootDelay); // The AVR and SD initialization may outlast a normal serial handshake.
    await this.sync();
    const identity=await this.command('M115',{expect:line=>line.includes('FIRMWARE_NAME:')});
    if(!identity.includes('EXTRUDER_COUNT:0')||!identity.includes(FIRMWARE_ID)){
      await this.disconnect();throw Error(`A placa não tem o firmware de desenho (${FIRMWARE_ID}). Não foram enviados movimentos.`);
    }
    await this.command('M84 S0');
    return identity;
  }
  async readLoop(){
    let buffer='';const decoder=new TextDecoder();
    try{
      while(!this.closing){const {value,done}=await this.transport.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'\n');
        let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);this.feed(line);}
        if(buffer.length>100000)throw Error('Resposta USB demasiado longa.');
      }
    }catch(error){if(!this.closing)this.onLine('Ligação interrompida: '+error.message);}
    finally{
      if(!this.closing){this.connected=false;this.pending?.reject(Error('A ligação USB foi interrompida.'));this.onDisconnect();}
    }
  }
  command(code,{expect,timeout=45000}={}){
    const run=()=>this.exchange(code,{expect,timeout});
    const result=this.chain.then(run);this.chain=result.catch(()=>{});return result;
  }
  exchange(code,{expect,timeout}){
    if(!this.connected)return Promise.reject(Error('Liga a máquina primeiro.'));
    return new Promise((resolve,reject)=>{
      const finish=(callback,value)=>{clearTimeout(timer);if(this.pending===pending)this.pending=null;callback(value);};
      const pending={expect,seen:!expect,lines:[],resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};
      const timer=setTimeout(()=>pending.reject(Error('Sem resposta da máquina. Interrompe o trabalho e verifica a ligação.')),timeout);
      this.pending=pending;this.onLine('→ '+code);
      Promise.resolve().then(()=>this.transport.write(new TextEncoder().encode(code+'\n'))).catch(error=>pending.reject(error));
    });
  }
  async sync(){
    const marker='DRAWINGBOT_SYNC_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
    return this.command('M118 '+marker,{expect:line=>line.includes(marker),timeout:15000});
  }
  async position(){
    const result=await this.command('M114',{expect:line=>/^X:[-\d.]+ Y:[-\d.]+ Z:[-\d.]+/.test(line)});
    const m=result.match(/X:([-\d.]+) Y:([-\d.]+) Z:([-\d.]+)/);
    if(!m)throw Error('Não foi possível ler a posição.');
    return {x:Number(m[1]),y:Number(m[2]),z:Number(m[3])};
  }
  async emergency(){
    if(this.connected)await this.transport.write(new TextEncoder().encode('M112\n'));
    this.pending?.reject(Error('Paragem de emergência. Reinicia a máquina e redefine as referências.'));
    this.onReset();
  }
  async disconnect(){
    this.closing=true;this.connected=false;this.pending?.reject(Error('Ligação terminada.'));
    try{await this.transport?.close();}catch{}
    try{await this.readTask;}catch{}
  }
}
export class SimulatedLink {
  constructor({onLine=()=>{}}={}){this.onLine=onLine;this.connected=true;this.pos={x:0,y:0,z:5};this.relative=false;this.simulated=true;this.bedTarget=0;}
  async connect(){this.connected=true;return "FIRMWARE_NAME:Simulado EXTRUDER_COUNT:0";}
  async sync(){return "";}
  async command(code){
    this.onLine('→ '+code);await sleep(/^G[01]\s/.test(code)?25:8);
    if(code==='G91')this.relative=true;if(code==='G90')this.relative=false;
    if(code.startsWith('G28')){if(code.includes('X'))this.pos.x=0;if(code.includes('Y'))this.pos.y=0;}
    if(/^G(?:0|1|92)\s/.test(code))for(const axis of ['X','Y','Z']){const m=code.match(new RegExp(axis+'(-?[\\d.]+)'));if(m)this.pos[axis.toLowerCase()]=Number(m[1])+(!code.startsWith('G92')&&this.relative?this.pos[axis.toLowerCase()]:0);}
    if(code.startsWith('M140')){const target=code.match(/S([\d.]+)/);if(target)this.bedTarget=Number(target[1]);}
    const response=code==='M119'?'x_min: open\ny_min: open\nok':code==='M105'?`ok B:20.00 /${this.bedTarget.toFixed(2)}`:'ok';this.onLine(response);return response;
  }
  async position(){return {...this.pos};}
  async emergency(){this.onLine('Emergência simulada');}
  async disconnect(){this.connected=false;}
}
export class JobRunner {
  constructor(link,{onProgress=()=>{},onState=()=>{},onPosition=()=>{}}={}){this.link=link;this.onProgress=onProgress;this.onState=onState;this.onPosition=onPosition;this.pauseRequested=false;this.cancelRequested=false;this.fault=false;}
  pause(){this.pauseRequested=true;this.onState('pausing');}
  resume(){this.pauseRequested=false;this.wake?.();}
  cancel(){this.cancelRequested=true;this.pauseRequested=false;this.wake?.();this.onState('stopping');}
  async run(job,commands){
    this.onState('running');await this.link.sync();
    try{
      for(let i=0;i<commands.length;i++){
        if(this.cancelRequested)break;
        if(this.pauseRequested){
          const pauseHeight=commands[i].safeZ??job.settings.lift;
          await this.link.command('M400');await this.link.command(`G0 Z${pauseHeight} F180`);await this.link.command('M400');
          this.onPosition(await this.link.position());this.onState('paused');
          await new Promise(resolve=>{this.wake=resolve;if(!this.pauseRequested)resolve();});this.wake=null;
          if(this.cancelRequested)break;
          this.onState('running');
          if(commands[i].penDown)await this.link.command(`G1 Z${job.settings.drawZ} F120`);
        }
        await this.link.command(commands[i].code);
        if(commands[i].position)this.onPosition(commands[i].position);
        this.onProgress((i+1)/commands.length);
      }
      await this.link.command('M400');
      if(this.cancelRequested){await this.link.command(`G0 Z${job.settings.lift} F180`);await this.link.command('M400');}
      await this.link.sync();this.onPosition(await this.link.position());
      this.onState(this.cancelRequested?'cancelled':'complete');
    }catch(error){this.fault=true;this.onState('error');throw error;}
  }
}
