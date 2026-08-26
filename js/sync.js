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
  var EMAIL_KEY = 'jvocab.email.v1';

  var cfg = global.FIREBASE_CONFIG || null;
  var fb = null;          // { app, auth, db, fns }
  var user = null;
  var busy = false;
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
      last: Number(read(LAST_KEY) || 0),
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
        if (u) sync();   // 로그인되면 바로 한 번 맞춘다
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
      emit();
    });
  }

  /* ---------- 동기화 ---------- */

  function path() { return 'users/' + user.uid + '/backup'; }

  // 받아서 합치고 → 합친 결과를 다시 올린다.
  function sync() {
    if (!user || busy || !navigator.onLine) return Promise.resolve(null);
    busy = true; emit();

    return load().then(function (f) {
      return f.get(f.ref(f.db, path()));
    }).then(function (snap) {
      var remote = snap.exists() ? snap.val() : null;
      var stat = null;
      if (remote && Store.isBackup(remote)) {
        stat = Store.importBackup(remote);
      }
      return fb.set(fb.ref(fb.db, path()), Store.exportAll()).then(function () {
        save(LAST_KEY, String(Date.now()));
        return stat;
      });
    }).then(function (stat) {
      busy = false; emit();
      return stat;
    }).catch(function (e) {
      busy = false; emit();
      throw e;
    });
  }

  /* ---------- 학습 중 자동 저장 ---------- */
  // 세션을 끝내지 않고 앱을 꺼도 잃지 않도록, 단어를 채점할 때마다
  // 타이머를 다시 걸어 마지막 채점 후 잠시 뒤에 한 번 올린다.

  var IDLE_PUSH_MS = 20000;
  var timer = null;

  function touch() {
    if (!user) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      sync().catch(function () {});
    }, IDLE_PUSH_MS);
  }

  /* ---------- 시작 ---------- */

  function init() {
    if (!configured()) return;
    // 전에 로그인한 적이 있으면 SDK 를 미리 불러와 세션을 되살린다.
    if (read(EMAIL_KEY)) load().catch(function () {});

    global.addEventListener('online', function () { if (user) sync().catch(function () {}); });

    // 앱을 덮거나 끌 때 마지막 상태를 올린다.
    // visibilitychange 는 확실하지 않은 경우가 있어 pagehide 도 같이 건다.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && user) sync().catch(function () {});
    });
    global.addEventListener('pagehide', function () {
      if (user) sync().catch(function () {});
    });
  }

  global.Sync = {
    init: init,
    status: status,
    onChange: onChange,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    sync: sync,
    touch: touch
  };
})(window);
