/* Offline support: cache-first for everything the tour uses. The page itself fills the
   cache when you tap "Download the tour"; this worker serves from it when there is no signal. */
const SHELL = 'trnp-shell-df18d63b';
const SHELL_FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'data/tour.json', 'fonts/fonts.css', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('trnp-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
  // media: cache first. iPhones play audio with Range requests and stop after the first chunk if they
  // get a whole file back, so a ranged request for a cached file gets a proper 206 slice.
  const range = req.headers.get('range');
  e.respondWith(caches.match(req.url, { ignoreSearch: true }).then(hit => {
    if (!hit) return fetch(req);
    if (!range) return hit;
    return hit.arrayBuffer().then(buf => {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const size = buf.byteLength;
      let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
      if (!m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }
      end = Math.min(end, size - 1);
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
        'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg', 'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } });
    });
  }));
});
