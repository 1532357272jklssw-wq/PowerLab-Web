const CACHE_NAME = 'powerlab-shell-v5'
const SHELL = ['./','index.html','app.css?v=4','app.js?v=4','manifest.webmanifest','assets/icon.svg','assets/icon-192.png','assets/icon-512.png','data/question-bank.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./')))
    return
  }
  if (url.pathname.endsWith('/data/question-bank.json')) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE_NAME).then((cache) => cache.put('./data/question-bank.json', copy))
      return response
    }).catch(() => caches.match('./data/question-bank.json')))
    return
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone()
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
    return response
  })))
})
