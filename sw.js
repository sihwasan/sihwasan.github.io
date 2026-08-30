/* 시화산노회 홈페이지 - 서비스 워커
 *
 * 앱 설치를 위해 필요하며, 인터넷이 끊겨도 마지막으로 본 화면을 보여준다.
 * 항상 서버를 먼저 확인하므로(network-first) 수정한 내용이 곧바로 반영된다.
 */

var CACHE = 'shs-v2';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll([
        './', './index.html', './css/style.css',
        './js/main.js', './js/auth.js', './js/data.js',
        './images/logo.svg', './manifest.webmanifest'
      ]).catch(function () { /* 일부 실패해도 설치는 진행 */ });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  /* 다른 서버(Supabase 등)와 조회 외 요청은 그대로 통과시킨다 */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
