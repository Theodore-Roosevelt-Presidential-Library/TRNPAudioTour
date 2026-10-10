/* Offline support: cache-first for everything the tour uses. The page itself fills the
   cache when you tap "Download the tour"; this worker serves from it when there is no signal. */
const SHELL = 'trnp-shell-v1';
const SHELL_FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'data/tour.json', 'fonts/fonts.css', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  // tour data and code: network first (so updates arrive), cache when offline
  if (/\/(data\/tour\.json|js\/app\.js|css\/app\.css|index\.html)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // media: cache first (audio range requests are served from the full cached file)
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
