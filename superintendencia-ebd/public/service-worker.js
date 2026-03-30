// Service Worker mínimo — habilita instalação PWA ("Instalar app" no Chrome)
// Estratégia: network-only — sem cache, sem modo offline complexo

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// O handler de fetch é obrigatório para o Chrome reconhecer este site como PWA instalável.
// Network-only: apenas repassa a requisição para a rede, sem nenhum cache.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})