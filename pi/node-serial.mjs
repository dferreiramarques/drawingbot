// Serial transport for Node.js on the Raspberry Pi (USB cable to the MKS board).
import {readdir} from 'node:fs/promises';

export async function findSerialPort(preferred='auto'){
  if(preferred&&preferred!=='auto')return preferred;
  try{
    const ids=(await readdir('/dev/serial/by-id')).sort();
    if(ids.length)return '/dev/serial/by-id/'+ids[0];
  }catch{}
  try{
    const devices=(await readdir('/dev')).filter(name=>/^tty(USB|ACM)\d+$/.test(name)).sort();
    if(devices.length)return '/dev/'+devices[0];
  }catch{}
  return null;
}

export class NodeSerialTransport {
  constructor(path){this.path=path;this.queue=[];this.waiters=[];this.ended=false;}
  async open(){
    const {SerialPort}=await import('serialport');
    // hupcl:false keeps DTR up on close, so reopening does not need an extra board reset.
    this.port=new SerialPort({path:this.path,baudRate:115200,autoOpen:false,hupcl:false});
    await new Promise((resolve,reject)=>this.port.open(error=>error?reject(error):resolve()));
    this.port.on('data',chunk=>this.push(chunk));
    this.port.on('close',()=>this.end());
    this.port.on('error',()=>this.end());
  }
  push(chunk){const waiter=this.waiters.shift();if(waiter)waiter({value:chunk,done:false});else this.queue.push(chunk);}
  end(){this.ended=true;for(const waiter of this.waiters.splice(0))waiter({value:undefined,done:true});}
  read(){
    if(this.queue.length)return Promise.resolve({value:this.queue.shift(),done:false});
    if(this.ended)return Promise.resolve({value:undefined,done:true});
    return new Promise(resolve=>this.waiters.push(resolve));
  }
  write(bytes){
    return new Promise((resolve,reject)=>this.port.write(Buffer.from(bytes),error=>{
      if(error)return reject(error);
      this.port.drain(drainError=>drainError?reject(drainError):resolve());
    }));
  }
  close(){
    return new Promise(resolve=>{
      if(!this.port?.isOpen){this.end();return resolve();}
      this.port.close(()=>{this.end();resolve();});
    });
  }
}
