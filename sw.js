/* inaka 的工作台 — Service Worker 已停用
 * 本文件唯一作用：让此前已注册旧 SW 的浏览器在下次加载时自动注销 SW 并清空缓存，
 * 之后工作台改为直连 GitHub Pages + 资源版本戳（?v=N）保证更新，不再依赖 SW 离线缓存。
 */
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    self.registration.unregister().then(function () {
      return caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      });
    }).then(function () { return self.clients.claim(); })
  );
});
