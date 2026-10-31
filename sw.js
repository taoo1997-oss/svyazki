// Offline support. The app shell is served from cache and refreshed in the background;
// textbook scans (img/) and video clips (v/) live in a separate cache that survives app updates.
const SHELL = 'shell-v2';
const DATA = 'data-v2';  // v2: clips re-encoded in 720p under the same names
// no 'index.html': Cloudflare redirects it to './', and a redirected response can't answer a navigation
const SHELL_FILES = ['./', 'video.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

// a response that came through a redirect is rejected by the browser when served for a page load, so store a clean copy
const clean = res => res.redirected
  ? res.blob().then(b => new Response(b, {status: res.status, statusText: res.statusText, headers: res.headers}))
  : res;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => Promise.all(SHELL_FILES.map(f => fetch(f, {cache: 'reload'}).then(clean).then(r => {
      if (!r.ok) throw new Error(f + ' ' + r.status);
      return c.put(f, r);
    }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  // on GitHub Pages the clips live in sibling sites /svyazki-<dance>/, outside this scope but same origin
  if (rel.startsWith('img/') || rel.startsWith('v/') || /^\/svyazki-(samba|cha|rumba|paso|jive)\//.test(url.pathname)) {
    // big immutable files: cache first, remember everything that was opened once
    // partial requests go to the network; x-dl marks the offline screen's downloads, which cache themselves
    if (req.headers.has('range') || req.headers.has('x-dl')) return;
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(req, {ignoreSearch: true});
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }

  // app shell: answer from cache at once, refresh it for the next start
  const key = req.mode === 'navigate' ? './' : req;
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(key, {ignoreSearch: true});
    const fresh = fetch(req).then(clean).then(res => {
      if (res.ok && res.status === 200) c.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
