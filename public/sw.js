const CACHE='drawingbot-v1.4.1';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('pen-studio-')||key.startsWith('drawingbot-'))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const assetPath=new URL(event.request.url).pathname.split('/').at(-1);
  const font=/\/fonts\/[\w.-]+\.(woff|json)$/.test(new URL(event.request.url).pathname);
  if(assetPath&&!font&&!['index.html','style.css','app.js','text.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].includes(assetPath))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&response.type!=='opaque'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(async()=>await caches.match(event.request)||(event.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));
});
