import test from 'node:test';
import assert from 'node:assert/strict';
import {MarlinLink,JobRunner} from '../src/serial.mjs';
test('stale ACKs cannot satisfy a position query before a position line arrives',async()=>{
  const link=new MarlinLink();link.connected=true;
  link.transport={write:async()=>{queueMicrotask(()=>{link.feed('ok');link.feed('X:12.50 Y:8.00 Z:3.00 Count X:1000 Y:640 Z:1200');link.feed('ok');});}};
  assert.deepEqual(await link.position(),{x:12.5,y:8,z:3});
});
test('an AVR restart rejects the pending operation and invalidates references',async()=>{
  let reset=false;const link=new MarlinLink({onReset:()=>reset=true});link.connected=true;
  link.transport={write:async()=>queueMicrotask(()=>link.feed('start'))};
  await assert.rejects(link.command('M400'),/reiniciou/);assert.equal(reset,true);
});
test('firmware error cannot be mistaken for a successful motion',async()=>{
  const link=new MarlinLink();link.connected=true;link.transport={write:async()=>queueMicrotask(()=>link.feed('Error:Printer halted'))};
  await assert.rejects(link.command('G28 X Y'),/halted/);
});
test('pause drains motion, lifts the pen and resumes at drawing height',async()=>{
  const sent=[],states=[];let runner;
  const link={sync:async()=>{},position:async()=>({x:1,y:1,z:3}),command:async code=>{sent.push(code);}};
  runner=new JobRunner(link,{onProgress:n=>{if(n===.5)runner.pause();},onState:state=>{states.push(state);if(state==='paused')queueMicrotask(()=>runner.resume());}});
  await runner.run({settings:{lift:3,drawZ:0}},[{code:'G1 X1 Y1',penDown:true},{code:'G1 X2 Y2',penDown:true}]);
  assert.ok(states.includes('paused'));assert.deepEqual(sent.slice(1,5),['M400','G0 Z3 F180','M400','G1 Z0 F120']);assert.equal(states.at(-1),'complete');
});
test('cancel never sends remaining drawing moves and lifts after the planner drains',async()=>{
  const sent=[];let runner;
  const link={sync:async()=>{},position:async()=>({x:1,y:1,z:3}),command:async code=>sent.push(code)};
  runner=new JobRunner(link,{onProgress:()=>runner.cancel()});
  await runner.run({settings:{lift:3,drawZ:0}},[{code:'G1 X1 Y1'},{code:'G1 X100 Y100'}]);
  assert.ok(!sent.includes('G1 X100 Y100'));assert.deepEqual(sent.slice(-3),['M400','G0 Z3 F180','M400']);
});
test('pausing in the finishing sequence never lowers the pen below the 10 mm clearance',async()=>{
  const sent=[];let runner;
  const link={sync:async()=>{},position:async()=>({x:20,y:300,z:10}),command:async code=>sent.push(code)};
  runner=new JobRunner(link,{onProgress:n=>{if(n===.5)runner.pause();},onState:state=>{if(state==='paused')queueMicrotask(()=>runner.resume());}});
  await runner.run({settings:{lift:3,drawZ:0}},[{code:'G0 Z10 F180',safeZ:10},{code:'G0 Y300 F2400',safeZ:10}]);
  assert.ok(!sent.includes('G0 Z3 F180'));assert.deepEqual(sent.slice(1,5),['M400','G0 Z10 F180','M400','G0 Y300 F2400']);
});
