/* Firebase 자동 동기화
 *
 * 기기마다 쌓인 기록을 계정 하나로 합친다.
 * 합치는 규칙은 Store.importBackup 이 이미 갖고 있으므로
 * '받아서 합치고 → 다시 올리기' 만 하면 충돌 없이 수렴한다.
 *
 * 설정값이 없거나 인터넷이 안 되면 조용히 꺼진다. 앱은 그대로 동작한다.
 */
(function (global) {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var LAST_KEY = 'jvocab.lastSync.v1';
  var DOWN_KEY = 'jvocab.lastDown.v1';
  var UP_KEY = 'jvocab.lastUp.v1';
  var EMAIL_KEY = 'jvocab.email.v1';

  var cfg = global.FIREBASE_CONFIG || null;
  var fb = null;          // { app, auth, db, fns }
  var user = null;
  var busy = false;
  // 지금 어느 쪽으로 가고 있는지. '' 는 쉬는 중, 'down' 은 받는 중, 'up' 은 올리는 중.
  // 한 번에 도는 두 걸음이라도 어디서 멈췄는지는 보여야 한다.
  var phase = '';
  var lastResult = null;  // 마지막으로 받아서 합친 결과
  var listeners = [];

  function configured() {
    return !!(cfg && cfg.apiKey && cfg.databaseURL);
  }

  function onChange(fn) { listeners.push(fn); }

  function emit() {
    var s = status();
    listeners.forEach(function (fn) { try { fn(s); } catch (e) {} });
  }

  function status() {
    return {
      configured: configured(),
      signedIn: !!user,
      email: user ? user.email : (read(EMAIL_KEY) || ''),
      busy: busy,
      phase: phase,                              // '' | 'down' | 'up'
      last: Number(read(LAST_KEY) || 0),
      // 예전 버전은 한 시각만 남겼다. 그 시각은 '받고 올리기'를 다 마친 때라
      // 양쪽 모두의 마지막 시각으로 써도 맞다. 안 그러면 쭉 써 온 기기가
      // 한 번도 동기화한 적 없는 것처럼 보인다.
      lastDown: Number(read(DOWN_KEY) || read(LAST_KEY) || 0),
      lastUp: Number(read(UP_KEY) || read(LAST_KEY) || 0),
      result: lastResult,
      online: navigator.onLine
    };
  }

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- SDK 를 필요할 때만 불러온다 ---------- */

  var loading = null;
  function load() {
    if (fb) return Promise.resolve(fb);
    if (loading) return loading;
    if (!configured()) return Promise.reject(new Error('설정 없음'));

    loading = Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-database.js')
    ]).then(function (mods) {
      var appMod = mods[0], authMod = mods[1], dbMod = mods[2];
      var app = appMod.initializeApp(cfg);
      var auth = authMod.getAuth(app);
      var db = dbMod.getDatabase(app);

      fb = {
        auth: auth, db: db,
        signIn: authMod.signInWithEmailAndPassword,
        signUp: authMod.createUserWithEmailAndPassword,
        signOutFn: authMod.signOut,
        onAuth: authMod.onAuthStateChanged,
        ref: dbMod.ref, get: dbMod.get, set: dbMod.set
      };

      fb.onAuth(auth, function (u) {
        user = u;
        if (u && u.email) save(EMAIL_KEY, u.email);
        emit();
      });
      return fb;
    }).catch(function (e) {
      loading = null;
      throw e;
    });

    return loading;
  }

  /* ---------- 로그인 ---------- */

  function signIn(email, password) {
    return load().then(function (f) {
      return f.signIn(f.auth, email, password);
    });
  }

  function signUp(email, password) {
    return load().then(function (f) {
      return f.signUp(f.auth, email, password);
    });
  }

  function signOut() {
    if (!fb) return Promise.resolve();
    return fb.signOutFn(fb.auth).then(function () {
      user = null;
      drop(EMAIL_KEY);
      drop(LAST_KEY);
      drop(DOWN_KEY);
      drop(UP_KEY);
      lastResult = null;
      emit();
    });
  }

  /* ---------- 동기화 ---------- */

  function path() { return 'users/' + user.uid + '/backup'; }

  // 받기와 올리기는 따로 돈다.
  // 한쪽 기기가 이상해졌을 때 '올리기만' 하거나 '받기만' 할 수 있어야
  // 성한 쪽을 지키면서 고칠 수 있다. 묶여 있으면 받는 순간 덮어써진다.

  // 왜 아무 일도 안 일어났는지 적어 둔다. 조용히 끝나면 누른 사람이 영문을 모른다.
  function blocked(which) {
    var why = !user ? '로그인되어 있지 않습니다' : (!navigator.onLine ? '인터넷이 끊겨 있습니다' : '다른 동기화가 도는 중입니다');
    lastResult = { failedAt: which, downAt: 0, upAt: 0, found: false, merged: null, from: '', err: why };
    emit();
    return Promise.resolve(null);
  }

  // 앱을 켜고 바로 누르면 로그인이 아직 되살아나지 않아 user 가 비어 있다.
  // 그대로 돌려보내면 아무 일도 안 일어난 것처럼 보이므로, 되살아날 때까지 잠깐 기다린다.
  // (실제로 PC 에서 켜자마자 받기를 눌러 9월 27일 이후 받기가 안 되고 있었다)
  function ready() {
    if (user) return Promise.resolve(true);
    if (!read(EMAIL_KEY)) return Promise.resolve(false);   // 로그인한 적이 없으면 기다릴 것이 없다
    return load().then(function () {
      return new Promise(function (res) {
        var waited = 0;
        var tick = function () {
          if (user) return res(true);
          waited += 200;
          if (waited > 10000) return res(false);
          setTimeout(tick, 200);
        };
        tick();
      });
    }).catch(function () { return false; });
  }

  function down() {
    if (busy || !navigator.onLine) return blocked('down');
    phase = 'down'; lastResult = null; emit();        // 기다리는 동안에도 '받는 중' 으로 보인다
    return ready().then(function (ok) {
      if (!ok) { phase = ''; return blocked('down'); }
      return doDown();
    });
  }

  function doDown() {
    busy = true; phase = 'down'; lastResult = null; emit();

    var res = { found: false, merged: null, from: '', downAt: 0, upAt: 0 };
    return load().then(function (f) {
      return f.get(f.ref(f.db, path()));
    }).then(function (snap) {
      var remote = snap.exists() ? snap.val() : null;
      if (remote && Store.isBackup(remote)) {
        res.found = true;
        // 합치기 전에 먼저 적어 둔다. 올리기가 실제로 닿았는지 이걸로 안다.
        res.from = remote.device || '';
        res.remoteAt = remote.exportedAt || '';
        res.remoteHasSession = !!(remote.session && remote.session.queue);
        res.merged = Store.importBackup(remote);
      }
      res.downAt = Date.now();
      save(DOWN_KEY, String(res.downAt));
      lastResult = res;
      busy = false; phase = ''; emit();
      return res;
    }).catch(function (e) {
      // 왜 실패했는지 남긴다. '실패' 만 보이면 고칠 단서가 없다.
      lastResult = { failedAt: 'down', downAt: 0, upAt: 0, found: false, merged: null, from: '',
                     err: String((e && e.code) || (e && e.message) || e).slice(0, 120) };
      busy = false; phase = ''; emit();
      throw e;
    });
  }

  function up() {
    if (busy || !navigator.onLine) return blocked('up');
    phase = 'up'; lastResult = null; emit();
    return ready().then(function (ok) {
      if (!ok) { phase = ''; return blocked('up'); }
      return doUp();
    });
  }

  function doUp() {
    busy = true; phase = 'up'; lastResult = null; emit();

    var res = { found: false, merged: null, from: '', downAt: 0, upAt: 0 };
    return load().then(function (f) {
      return f.set(f.ref(f.db, path()), Store.exportAll());
    }).then(function () {
      res.upAt = Date.now();
      save(UP_KEY, String(res.upAt));
      save(LAST_KEY, String(res.upAt));
      lastResult = res;
      busy = false; phase = ''; emit();
      return res;
    }).catch(function (e) {
      lastResult = { failedAt: 'up', downAt: 0, upAt: 0, found: false, merged: null, from: '',
                     err: String((e && e.code) || (e && e.message) || e).slice(0, 120) };
      busy = false; phase = ''; emit();
      throw e;
    });
  }

  // 자동 동기화는 여전히 받고 나서 올린다. 그래야 두 기기가 합쳐진다.
  // 사람이 누르는 버튼만 나뉘어 있다.
  function sync() {
    if (busy || !navigator.onLine) return Promise.resolve(null);
    return down().then(function (res) {
      return up().then(function () { return res ? res.merged : null; });
    });
  }

  /* ---------- 자동 동기화는 하지 않는다 ---------- */
  // 언제 무엇이 오가는지 사람이 정한다. 앱이 알아서 올리고 받으면
  // 한쪽이 이상해졌을 때 손쓸 틈 없이 다른 쪽까지 덮인다.
  //
  // touch 는 앱 곳곳에서 부른다. 네트워크는 건드리지 않는다.
  // 올릴 것이 생겼다는 사실만 ☁ 아이콘에 비치게 한 번 다시 그린다.
  function touch() { emit(); }

  /* ---------- 시작 ---------- */

  function init() {
    if (!configured()) return;
    // 전에 로그인한 적이 있으면 SDK 를 미리 불러와 세션을 되살린다.
    if (read(EMAIL_KEY)) load().catch(function () {});

    // 켜질 때도, 꺼질 때도, 인터넷이 돌아올 때도 알아서 올리거나 받지 않는다.
    // 오가는 것은 사람이 받기·올리기를 누를 때뿐이다.
  }

  global.Sync = {
    init: init,
    status: status,
    onChange: onChange,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    sync: sync,
    down: down,
    up: up,
    touch: touch
  };
})(window);
