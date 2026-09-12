/* 앱 셸을 캐시해 두어, 설치 후에는 서버가 꺼져 있어도 앱이 열리게 한다.
   파일을 고친 뒤에는 아래 CACHE 이름의 숫자를 올려야 새 버전이 반영된다. */
var CACHE = 'jvocab-v72';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/sync.js',
  './js/app.js',
  './js/firebase-config.js',
  './data/vocab.js',
  './data/kanji.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // cache:'reload' 로 받아야 브라우저 HTTP 캐시를 거치지 않고 새 파일이 온다.
      // 그냥 addAll 을 쓰면 옛 파일이 그대로 다시 캐시될 수 있다.
      return Promise.all(ASSETS.map(function (url) {
        return fetch(url, { cache: 'reload' })
          .then(function (res) { return res.ok ? c.put(url, res) : null; })
          .catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 네트워크를 먼저 시도하고, 안 되면(서버가 꺼져 있으면) 캐시로 응답한다.
// 서버를 켠 채로 파일을 고치면 바로 반영되고, 꺼져 있어도 앱은 열린다.
self.addEventListener('fetch', function (ev) {
  if (ev.request.method !== 'GET') return;
  // Firebase SDK·통신 같은 바깥 요청은 건드리지 않는다.
  // 캐시에 끼어들면 로그인이나 동기화가 엉킨다.
  if (new URL(ev.request.url).origin !== self.location.origin) return;
  // cache:'no-cache' 로 브라우저 HTTP 캐시를 반드시 서버에 확인시킨다.
  // 그냥 fetch 하면 GitHub Pages 가 준 옛 파일을 HTTP 캐시에서 꺼내 오고,
  // 그것을 다시 캐시에 써 버려서 설치 때 받아 둔 새 파일이 옛 것으로 덮인다.
  // 폰이 새 버전으로 안 넘어가던 이유다. (304 면 전송량도 거의 없다)
  ev.respondWith(
    fetch(ev.request, { cache: 'no-cache' })
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(ev.request, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(ev.request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});

// 페이지가 물어보면 지금 돌고 있는 버전을 알려 준다.
// 앱 버전(화면 쪽 BUILD)과 이 값이 다르면 옛 서비스워커가 아직 앉아 있다는 뜻이고,
// 그게 폰이 새 버전으로 안 넘어가던 일을 눈으로 볼 수 있게 해 준다.
self.addEventListener('message', function (ev) {
  var d = ev.data || {};
  if (d.ask === 'version') {
    if (ev.ports && ev.ports[0]) ev.ports[0].postMessage({ cache: CACHE });
  } else if (d.ask === 'skipWaiting') {
    self.skipWaiting();
  }
});
