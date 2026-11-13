import {build} from 'esbuild';
import {mkdir,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['src/app.mjs'],bundle:true,outfile:'dist/app.js',format:'iife',target:['chrome100','edge100'],minify:true,legalComments:'eof'});
console.log('Pen Studio ready in dist/');
