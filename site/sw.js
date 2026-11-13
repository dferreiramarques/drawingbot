// A app saiu da raiz do site para ./app/. Este service worker substitui o antigo da raiz:
// apaga as caches antigas, desregista-se e recarrega as páginas abertas.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(/^(pen-studio-|drawingbot-v1\.[01]\.)/.test(key))await caches.delete(key);
  await self.registration.unregister();
  for(const client of await self.clients.matchAll({type:'window'}))client.navigate(client.url);
})()));
