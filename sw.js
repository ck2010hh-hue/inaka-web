/* inaka 的工作台 — Service Worker（PWA 离线壳） */
const CACHE = 'inaka-wb-v2';
const ASSETS = [
  './', './index.html',
  './assets/css/style.css',
  './assets/js/store.js', './assets/js/app.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.skipWaiting(); }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // 外部同步 API（jsonbin.io）：不拦截，直接走网络（不缓存）
  if (url.hostname.indexOf('jsonbin') !== -1) return;
  if (e.request.method !== 'GET') return;
  // 网络优先：部署新版本后用户立即可见，失败才回退缓存（离线可用）
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.ok && url.origin === self.location.origin) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    }).catch(function () { return caches.match(e.request); })
  );
});
