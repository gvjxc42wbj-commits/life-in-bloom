const CACHE = 'life-in-bloom-grocery-v1-20261104';
const ASSETS = ['./','./index.html','./styles.css','./grocery.css','./bloom-data.js','./bloom-personal.js','./bloom-insights.js','./bloom-appointments.js','./bloom-pages.js','./bloom-config.js','./bloom-grocery-store.js','./bloom-grocery.js','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
const STATIC_PATHS = new Set(ASSETS.map(path => new URL(path, self.location.href).pathname));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('sleep-in-bloom-')||k.startsWith('life-in-bloom-grocery-'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url = new URL(request.url);
  // Never cache account callbacks, APIs, user records, or arbitrary same-origin URLs.
  if(request.method!=='GET'||url.origin!==self.location.origin||url.search||!STATIC_PATHS.has(url.pathname))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||new Response('This app file is not available offline yet. Reconnect and refresh.',{status:503,headers:{'Content-Type':'text/plain'}}))));
});
