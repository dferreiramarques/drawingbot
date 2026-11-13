import {build} from 'esbuild';
import {mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const pkg=JSON.parse(await readFile('package.json','utf8'));
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['src/app.mjs'],bundle:true,outfile:'dist/app.js',format:'iife',target:['chrome100','edge100','safari15','firefox100'],minify:true,legalComments:'eof'});
await build({entryPoints:['src/text.mjs'],bundle:true,outfile:'dist/text.js',format:'iife',globalName:'DrawingBotText',target:['chrome100','edge100','safari15','firefox100'],minify:true,legalComments:'eof'});
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

// GitHub Pages site: product page at the root, guide from docs/GUIA.md, app in app/, Pi files in pi/.
if(process.argv.includes('--site')){
  const {marked}=await import('marked');
  const {posix}=await import('node:path');
  const {existsSync}=await import('node:fs');
  const REPO='https://github.com/dferreiramarques/drawingbot';
  await rm('dist-site',{recursive:true,force:true});
  await cp('site','dist-site',{recursive:true});
  await rm('dist-site/guia.template.html');
  await cp('dist','dist-site/app',{recursive:true});
  if(existsSync('dist-pi/drawingbot-pi.tar.gz')){
    await mkdir('dist-site/pi',{recursive:true});
    await cp('dist-pi/drawingbot-pi.tar.gz','dist-site/pi/drawingbot-pi.tar.gz');
    await cp('dist-pi/drawingbot/install.sh','dist-site/pi/install.sh');
  }
  const slug=text=>text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/<[^>]+>/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const repoLink=href=>{
    if(/^([a-z]+:|#|\/)/i.test(href))return href;
    const [path,hash='']=href.split('#');
    const target=posix.normalize(posix.join('docs',path));
    return `${REPO}/${target.endsWith('/')?'tree':'blob'}/main/${target.replace(/\/$/,'')}${hash?'#'+hash:''}`;
  };
  marked.use({walkTokens(token){if(token.type==='link')token.href=repoLink(token.href);}});
  const toc=[];
  let html=marked.parse(await readFile('docs/GUIA.md','utf8'));
  html=html.replace(/<h([23])>(.*?)<\/h\1>/g,(_,level,inner)=>{
    const id=slug(inner);if(level==='2')toc.push(`<li><a href="#${id}">${inner.replace(/<[^>]+>/g,'')}</a></li>`);
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  const template=await readFile('site/guia.template.html','utf8');
  await mkdir('dist-site/guia',{recursive:true});
  await writeFile('dist-site/guia/index.html',template.replace('{{toc}}',toc.join('')).replace('{{content}}',html));
  console.log('Site ready in dist-site/');
}
