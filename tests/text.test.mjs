import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TEXT_FONTS,TEXT_CATEGORIES,parseFont,layoutText} from '../src/text.mjs';
import {bounds,createJob,fillPaths,validateProject} from '../src/geometry.mjs';

async function load(id){
  const info=TEXT_FONTS.find(f=>f.id===id),file=await readFile(new URL('../public/fonts/'+info.file,import.meta.url));
  return parseFont(id,info.mode==='fill'?file.buffer.slice(file.byteOffset,file.byteOffset+file.length):JSON.parse(file.toString('utf8')));
}

test('there are two fonts per category in each mode, and every font file loads with Portuguese accents',async()=>{
  for(const mode of ['fill','line'])for(const [category] of TEXT_CATEGORIES)
    assert.equal(TEXT_FONTS.filter(f=>f.mode===mode&&f.category===category).length,2,`${mode}/${category}`);
  for(const info of TEXT_FONTS){
    const font=await load(info.id);
    const result=layoutText(font,{content:'Ação Ç é',capHeight:10});
    assert.ok(result.paths.length>0,info.id);assert.deepEqual(result.missing,[],info.id);
    const H=layoutText(font,{content:'H',capHeight:10}),b=bounds(H.paths);
    assert.ok(Math.abs(b.maxY-10)<.6,`${info.id}: cap height ${b.maxY}`);
  }
});

test('filled text is closed contours marked for fill; single-line text is open strokes',async()=>{
  const fill=layoutText(await load('roboto'),{content:'O',capHeight:20});
  assert.ok(fill.paths.length>=2&&fill.paths.every(p=>p.closed&&p.fill),'O has an outer and an inner contour');
  const line=layoutText(await load('hershey-sans'),{content:'L',capHeight:20});
  assert.ok(line.paths.every(p=>!p.fill)&&line.paths.some(p=>!p.closed));
});

test('lines are aligned and spaced by the line height',async()=>{
  const font=await load('hershey-sans');
  const left=layoutText(font,{content:'IIIIII\nI',align:'left',capHeight:10,lineHeight:1.5});
  const right=layoutText(font,{content:'IIIIII\nI',align:'right',capHeight:10,lineHeight:1.5});
  const lastLine=r=>bounds(r.paths.filter(p=>p.points.every(v=>v.y<0)));
  assert.ok(lastLine(right).minX>lastLine(left).minX+8,`${lastLine(left).minX} vs ${lastLine(right).minX}`);
  assert.ok(Math.abs(left.height-(10+font.units*1.5*10/font.cap))<1e-6);
  assert.throws(()=>layoutText(font,{content:'   '}),/Escreve/);
});

test('fill hatches the inside of a letter in a zig-zag and keeps the ink within the outline',async()=>{
  const glyph=layoutText(await load('montserrat'),{content:'I',capHeight:20}).paths;
  const job=createJob(glyph,{width:4,tip:.5,originX:50,originY:50});
  const hatch=job.paths.filter(p=>!p.closed),outline=job.paths.filter(p=>p.closed);
  assert.equal(outline.length,1);
  assert.ok(hatch.length<=2&&hatch.reduce((n,p)=>n+p.points.length,0)>60,'hatch rows are joined into a zig-zag without pen lifts');
  const original=bounds(job.original),drawn=bounds(job.paths);
  assert.ok(drawn.minX>=original.minX+.24&&drawn.maxX<=original.maxX-.24,'outline is half a tip inside');
  assert.equal(fillPaths([{closed:true,points:[{x:0,y:0},{x:.3,y:0},{x:.3,y:5},{x:0,y:5}]}],.5).warnings.length,1,'too thin for the tip');
});

test('projects keep the fill flag and the editable text settings',()=>{
  const square={closed:true,fill:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]};
  const project=validateProject({format:'drawingbot',version:1,paths:[square],text:{content:'Olá',font:'roboto',mode:'fill',align:'diagonal',capHeight:9999}});
  assert.equal(project.paths[0].fill,true);
  assert.deepEqual(project.text,{content:'Olá',font:'roboto',mode:'fill',align:'center',lineHeight:1.25,capHeight:20,width:null});
});
