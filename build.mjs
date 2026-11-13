import {build} from 'esbuild';
import {mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const pkg=JSON.parse(await readFile('package.json','utf8'));
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['src/app.mjs'],bundle:true,outfile:'dist/app.js',format:'iife',target:['chrome100','edge100','safari15','firefox100'],minify:true,legalComments:'eof'});
console.log('DrawingBot app ready in dist/');

// Raspberry Pi package: server + app + installer → dist-pi/drawingbot-pi.tar.gz
if(process.argv.includes('--pi')){
  const out='dist-pi/drawingbot';
  await rm('dist-pi',{recursive:true,force:true});
  await mkdir(out+'/systemd',{recursive:true});
  await cp('dist',out+'/app',{recursive:true});
  await build({entryPoints:['pi/server.mjs'],bundle:true,outfile:out+'/server.mjs',platform:'node',format:'esm',target:'node18',
    external:['serialport'],define:{__DRAWINGBOT_VERSION__:JSON.stringify(pkg.version)},legalComments:'eof',
    banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}});
  // Shell scripts and units must keep Unix line endings even when built on Windows.
  const lf=async(from,to)=>writeFile(to,(await readFile(from,'utf8')).replace(/\r\n/g,'\n'));
  for(const file of ['install.sh','apply-config.sh','drawingbot.txt'])await lf('pi/'+file,out+'/'+file);
  for(const file of ['drawingbot.service','drawingbot-config.service'])await lf('pi/systemd/'+file,out+'/systemd/'+file);
  await writeFile(out+'/package.json',JSON.stringify({name:'drawingbot-pi',version:pkg.version,private:true,type:'module',
    dependencies:{serialport:pkg.piDependencies.serialport}},null,2)+'\n');
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  execFileSync(npm,['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--no-package-lock'],{cwd:out,stdio:'inherit',shell:process.platform==='win32'});
  execFileSync('tar',['-czf','dist-pi/drawingbot-pi.tar.gz','-C','dist-pi','drawingbot'],{stdio:'inherit'});
  console.log('Raspberry Pi package ready: dist-pi/drawingbot-pi.tar.gz');
}
