// Browsers only offer to install a site that has a service worker with a fetch handler. Orvo needs the network for
// every call, so this one caches nothing and sends every request straight through.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
