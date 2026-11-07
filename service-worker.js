const CACHE = 'life-in-bloom-food-v49-20261107';
const ASSETS = ['./','./index.html','./styles.css','./grocery.css','./commerce.css','./food.css','./habits.css','./dog.css','./wellness.css','./bloom-data.js','./bloom-personal.js','./bloom-insights.js','./bloom-appointments.js','./bloom-pages.js','./bloom-config.js','./bloom-grocery-store.js','./bloom-drafts.js','./bloom-food-model.js','./bloom-food-import.js','./bloom-commerce.js','./bloom-food.js','./bloom-grocery.js','./bloom-habits-model.js','./bloom-reader.js','./bloom-habits.js','./bloom-dog-model.js','./bloom-dog.js','./bloom-wellness.js','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/dog-companion.jpeg','./icons/bloom-botanical.svg'];
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const STATIC_PATHS = new Set(ASSETS.map(path => new URL(path, self.location.href).pathname));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(async cache=>{
  await cache.addAll(ASSETS);
  try { await cache.add(new Request(SDK,{mode:'cors',credentials:'omit'})); } catch (_) {}
}).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('sleep-in-bloom-')||k.startsWith('life-in-bloom-grocery-')||k.startsWith('life-in-bloom-food-'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url = new URL(request.url);
  const localStatic=url.origin===self.location.origin&&!url.search&&STATIC_PATHS.has(url.pathname);
  const pinnedSdk=url.href===SDK;
  // Only named static files and the exact pinned SDK; never APIs, private
  // records, signed attachment links, or account query URLs.
  if(request.method!=='GET'||(!localStatic&&!pinnedSdk))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||new Response('This app file is not available offline yet. Reconnect and refresh.',{status:503,headers:{'Content-Type':'text/plain'}}))));
});
