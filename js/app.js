/* 화면 전환 · 학습 진행 · 검색 */
(function () {
  'use strict';

  var $  = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var view = 'home';
  var currentDays = [];   // 상세 화면에서 보고 있는 Day 번호들
  var selected = [];      // 홈에서 체크한 Day 번호들
  var session = null;     // { queue, index, label, results }
  var randCount = 20;     // 전체 랜덤 학습에서 뽑을 개수 (0 = 전체)
  var calDate = new Date(); // 달력에서 보고 있는 달
  var searchOpen = false;   // 검색 패널이 떠 있는지

  /* ---------------- 화면 ---------------- */

  function show(name) {
    view = name;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    $('btnHome').hidden = (name === 'home');
    $('btnTimeTop').hidden = (name === 'time' || name === 'study');
    $('selBar').hidden = !(name === 'home' && selected.length);
    document.body.classList.toggle('has-selbar', name === 'home' && !!selected.length);
    window.scrollTo(0, 0);
  }

  /* ---------------- 검색 패널 ---------------- */
  // 화면을 갈아끼우지 않고 위에 겹쳐 띄운다. 그래야 학습 중에 열어도
  // 풀던 카드와 진행 상황이 그대로 남는다.

  function openSearch() {
    searchOpen = true;
    $('searchPanel').hidden = false;
    document.body.classList.add('no-scroll');
    runSearch();
    $('searchInput').focus();
    $('searchInput').select();
  }

  function closeSearch() {
    searchOpen = false;
    $('searchPanel').hidden = true;
    document.body.classList.remove('no-scroll');
  }

  function statHTML(s) {
    return [
      '<div class="stat total"><span class="n">' + s.total + '</span><span class="l">전체</span></div>',
      '<div class="stat unknown"><span class="n">' + (s.unknown + s['new']) + '</span><span class="l">모름 · 미학습</span></div>',
      '<div class="stat short"><span class="n">' + s.short + '</span><span class="l">단기기억</span></div>',
      '<div class="stat long"><span class="n">' + s.long + '</span><span class="l">장기기억</span></div>'
    ].join('');
  }

  /* ---------------- 홈 ---------------- */

  function renderHome() {
    var s = Store.summarizeAll();
    $('globalStats').innerHTML = statHTML(s);
    renderProgress(s);
    renderResume();

    var due = Store.dueList(), weak = Store.weakList();
    $('reviewCount').textContent = due.length + '개 대기';
    $('weakCount').textContent = weak.length + '개';
    $('btnReviewToday').disabled = !due.length;
    $('btnWeakStudy').disabled = !weak.length;

    $('randPool').textContent = '전체 ' + s.total + '단어';
    $('btnRandStudy').disabled = !s.total;
    $('btnRandStudy').textContent =
      randCount && randCount < s.total ? randCount + '개 랜덤 학습' : '전체 랜덤 학습';

    var days = Store.allDays();
    $('emptyNote').hidden = days.length > 0;
    $('dayGrid').innerHTML = days.map(function (d) {
      var ds = Store.summarize(d.words, d.day);
      var t = ds.total || 1;
      var pct = function (n) { return (n / t * 100).toFixed(2) + '%'; };
      return '<button class="day-cell' + (isSel(d.day) ? ' sel' : '') + '" data-day="' + d.day + '">' +
        '<span class="dn">DAY ' + d.day + '</span>' +
        '<span class="dt">' + esc(d.title || (d.words.length + '단어')) + '</span>' +
        '<span class="dbar">' +
          '<i class="b-long" style="width:' + pct(ds.long) + '"></i>' +
          '<i class="b-short" style="width:' + pct(ds.short) + '"></i>' +
          '<i class="b-unknown" style="width:' + pct(ds.unknown) + '"></i>' +
        '</span></button>';
    }).join('');

    $('btnSelAll').textContent = (selected.length === days.length && days.length) ? '선택 해제' : '전체 선택';
    renderSelBar();
  }

  /* ---------------- Day 다중 선택 ---------------- */

  function isSel(n) { return selected.indexOf(n) > -1; }

  function toggleSel(n) {
    var i = selected.indexOf(n);
    if (i > -1) selected.splice(i, 1); else selected.push(n);
    selected.sort(function (a, b) { return a - b; });
  }

  function wordsOf(dayNums) {
    var out = [];
    dayNums.forEach(function (n) {
      var d = Store.getDay(n);
      if (d) d.words.forEach(function (w) { out.push({ day: d.day, w: w }); });
    });
    return out;
  }

  function dayLabel(dayNums) {
    if (dayNums.length === 1) return 'DAY ' + dayNums[0];
    if (dayNums.length <= 3) return 'DAY ' + dayNums.join(', ');
    return 'DAY ' + dayNums[0] + ' 외 ' + (dayNums.length - 1) + '개';
  }

  function renderSelBar() {
    var bar = $('selBar');
    bar.hidden = !selected.length;
    document.body.classList.toggle('has-selbar', !!selected.length && view === 'home');
    if (!selected.length) return;
    var n = wordsOf(selected).length;
    $('selDays').textContent = dayLabel(selected);
    $('selWords').textContent = n + '단어';
    $('btnSelStudy').disabled = !n;
  }

  // 홈 상단의 진도 카드. '외웠다'의 기준은 장기기억이다.
  function renderProgress(s) {
    var t = s.total || 1;
    var pct = s.total ? (s.long / s.total * 100) : 0;

    $('progLong').textContent = s.long;
    $('progTotal').textContent = '/ ' + s.total + ' 단어';
    $('progPct').innerHTML = (pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)) + '<i>%</i>';

    var seg = function (n, cls) {
      return n ? '<i class="' + cls + '" style="width:' + (n / t * 100).toFixed(3) + '%"></i>' : '';
    };
    $('progSeg').innerHTML =
      seg(s.long, 'long') + seg(s.short, 'short') + seg(s.unknown, 'unknown') + seg(s['new'], 'new');
  }

  /* ---------------- Day 상세 ---------------- */

  function renderDays(dayNums) {
    var entries = wordsOf(dayNums);
    if (!entries.length) return;
    currentDays = dayNums.slice();

    var titles = dayNums.map(function (n) {
      var d = Store.getDay(n);
      return d && d.title ? d.title : '';
    }).filter(Boolean);

    $('dayHeadTitle').textContent = dayLabel(dayNums);
    $('dayHeadSub').textContent =
      (titles.length ? titles.join(' · ') + ' · ' : '') + entries.length + '단어';

    var s = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    entries.forEach(function (e) { s.total++; s[Store.stageFor(e.day, e.w)]++; });
    $('dayStats').innerHTML = statHTML(s);

    var due = entries.filter(function (e) { return Store.isDue(e.day, e.w); });
    $('dayAllCount').textContent = entries.length + '개';
    $('dayDueCount').textContent = due.length + '개';
    $('btnStudyDue').disabled = !due.length;

    $('dayWordList').innerHTML = entries.map(function (e) {
      return itemHTML(e.day, e.w, dayNums.length > 1);
    }).join('');
    show('day');
  }

  function itemHTML(day, w, showDay) {
    var st = Store.stageFor(day, w);
    var r = Store.recOf(day, w);
    var detail = detailHTML(w, true);
    return '<div class="wl-item' + (detail ? ' has-detail' : '') + '"' +
        (detail ? ' role="button" tabindex="0"' : '') + '>' +
      '<div class="wl-head">' +
        '<span class="wl-dot dot-' + st + '"></span>' +
        '<span class="wl-main">' +
          '<span class="wl-word">' + dictHTML(w.word) +
            '<span class="wl-reading">' + esc(w.reading) + '</span>' + posHTML(w.pos) +
          '</span>' +
          '<div class="wl-meaning">' + esc(w.meaning) + '</div>' +
        '</span>' +
        '<span class="wl-side">' + Store.STAGE_LABEL[st] +
          (showDay ? '<span class="wl-day">DAY ' + day + '</span>' : (r.seen ? '<span class="wl-day">Lv.' + r.level + '</span>' : '')) +
        '</span>' +
        (detail ? '<span class="wl-caret">▾</span>' : '') +
      '</div>' +
      (detail ? '<div class="wl-detail" hidden>' + detail + '</div>' : '') +
    '</div>';
  }

  // 단어 항목을 누르면 예문이 펼쳐진다.
  function bindExpand(container) {
    container.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return; // 사전 링크는 펼침과 무관하게 동작
      var item = ev.target.closest('.wl-item.has-detail');
      if (!item || !container.contains(item)) return;
      var d = item.querySelector('.wl-detail');
      d.hidden = !d.hidden;
      item.classList.toggle('open', !d.hidden);
    });
    container.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var item = ev.target.closest('.wl-item.has-detail');
      if (!item) return;
      ev.preventDefault();
      item.click();
    });
  }

  /* ---------------- 학습 ---------------- */

  function startSession(entries, label) {
    if (!entries.length) return;
    session = {
      queue: shuffle(entries.slice()),
      index: 0,
      label: label,
      results: []
    };
    persistSession();
    show('study');
    renderCard();
  }

  /* ---------------- 학습 이어하기 ---------------- */

  function refOf(e) { return { d: e.day, n: e.w.no, w: e.w.word }; }

  function persistSession() {
    if (!session) return;
    Store.saveSession({
      label: session.label,
      index: session.index,
      queue: session.queue.map(refOf),
      results: session.results.map(function (x) {
        return { d: x.day, n: x.w.no, w: x.w.word, r: x.r, m: x.m, level: x.level };
      })
    });
  }

  function hydrate(ref) {
    var w = Store.findWord(ref.d, ref.n, ref.w);
    return w ? { day: ref.d, w: w } : null;
  }

  // 저장된 학습을 복원한다. 단어 데이터가 바뀌어 못 찾는 항목은 버린다.
  function restoreSession() {
    var s = Store.loadSession();
    if (!s || !s.queue || !s.queue.length) return null;

    var queue = [], dropped = 0;
    s.queue.forEach(function (ref, i) {
      var e = hydrate(ref);
      if (e) queue.push(e);
      else if (i < s.index) dropped++;
    });
    if (!queue.length) { Store.clearSession(); return null; }

    var results = [];
    (s.results || []).forEach(function (x) {
      var e = hydrate(x);
      if (e) results.push({ day: e.day, w: e.w, r: x.r, m: x.m, level: x.level });
    });

    var index = Math.min(Math.max(0, s.index - dropped), queue.length);
    if (index >= queue.length) { Store.clearSession(); return null; }

    return { queue: queue, index: index, label: s.label || '학습', results: results };
  }

  function renderResume() {
    var s = restoreSession();
    $('btnResume').hidden = !s;
    if (s) {
      $('resumeInfo').textContent =
        s.label + ' · ' + (s.index + 1) + ' / ' + s.queue.length;
    }
  }

  function entriesOfDays(dayNums, onlyDue) {
    return wordsOf(dayNums).filter(function (e) { return !onlyDue || Store.isDue(e.day, e.w); });
  }

  var picked = { reading: null, meaning: null };

  function renderCard() {
    var e = session.queue[session.index];
    var st = Store.stageFor(e.day, e.w);

    $('cardBadge').textContent = Store.STAGE_LABEL[st];
    $('cardBadge').className = 'badge ' + st;
    $('cardNo').textContent = 'DAY ' + e.day + (e.w.no ? ' · ' + e.w.no : '');
    $('jpWord').innerHTML = dictHTML(e.w.word, 'big');
    $('ansReading').textContent = e.w.reading;
    $('ansMeaning').innerHTML = posHTML(e.w.pos) + esc(e.w.meaning);
    // 문제를 푸는 중에는 예문에 읽는 법이 보이면 안 되므로 한자 그대로 둔다.
    // 예문 자체는 힌트로 계속 보여주고, 해석·문형만 quiz 클래스로 가린다.
    $('detailBox').innerHTML = detailHTML(e.w, false);
    $('detailBox').className = 'detail-box quiz';
    $('detailBox').hidden = !$('detailBox').innerHTML;

    $('answerBox').hidden = true;
    $('checkBox').hidden = true;
    $('btnReveal').hidden = false;
    $('btnNext').disabled = true;
    picked.reading = null; picked.meaning = null;
    $$('.ox-btn').forEach(function (b) { b.classList.remove('sel'); });

    var n = session.queue.length;
    $('progressText').textContent = (session.index + 1) + ' / ' + n;
    $('studyLabel').textContent = session.label;
    $('progressFill').style.width = (session.index / n * 100) + '%';
  }

  function reveal() {
    if (!$('btnReveal').hidden) {
      $('btnReveal').hidden = true;
      $('answerBox').hidden = false;
      $('detailBox').className = 'detail-box'; // 해석·문형 공개
      $('checkBox').hidden = false;
    }
  }

  function pick(type, val) {
    if ($('checkBox').hidden) return;
    picked[type] = val;
    $$('.ox-btn[data-t="' + type + '"]').forEach(function (b) {
      b.classList.toggle('sel', Number(b.dataset.v) === val);
    });
    $('btnNext').disabled = (picked.reading === null || picked.meaning === null);
  }

  function next() {
    if (picked.reading === null || picked.meaning === null) return;
    var e = session.queue[session.index];
    var rec = Store.grade(e.day, e.w, picked.reading === 1, picked.meaning === 1);
    session.results.push({ day: e.day, w: e.w, r: picked.reading === 1, m: picked.meaning === 1, level: rec.level });

    session.index++;
    persistSession();
    if (session.index >= session.queue.length) renderResult();
    else renderCard();
  }

  /* ---------------- 결과 ---------------- */

  function renderResult() {
    Store.clearSession(); // 다 풀었으므로 이어하기 대상이 아니다
    if (global_Sync()) Sync.sync().catch(function () {}); // 결과를 바로 올린다
    $('progressFill').style.width = '100%';
    var res = session.results;
    var perfect = res.filter(function (x) { return x.r && x.m; }).length;
    var wrong = res.filter(function (x) { return !x.r || !x.m; });

    $('resultSub').textContent = res.length + '단어 중 ' + perfect + '개 정답';

    var s = { total: res.length, unknown: 0, short: 0, long: 0, 'new': 0 };
    res.forEach(function (x) { s[Store.stageOf(x.level, 1)]++; });
    $('resultStats').innerHTML = statHTML(s);

    $('resultList').innerHTML = res.map(function (x) {
      var st = Store.stageOf(x.level, 1);
      var detail = detailHTML(x.w, true);
      return '<div class="wl-item' + (detail ? ' has-detail' : '') + '"' +
          (detail ? ' role="button" tabindex="0"' : '') + '>' +
        '<div class="wl-head">' +
          '<span class="wl-dot dot-' + st + '"></span>' +
          '<span class="wl-main">' +
            '<span class="wl-word">' + dictHTML(x.w.word) +
              '<span class="wl-reading">' + esc(x.w.reading) + '</span>' + posHTML(x.w.pos) +
            '</span>' +
            '<div class="wl-meaning">' + esc(x.w.meaning) + '</div>' +
          '</span>' +
          '<span class="wl-side">읽기 ' + (x.r ? 'O' : 'X') + ' · 뜻 ' + (x.m ? 'O' : 'X') +
            '<span class="wl-day">' + Store.STAGE_LABEL[st] + '</span></span>' +
          (detail ? '<span class="wl-caret">▾</span>' : '') +
        '</div>' +
        (detail ? '<div class="wl-detail" hidden>' + detail + '</div>' : '') +
      '</div>';
    }).join('');

    $('retryCount').textContent = wrong.length + '개';
    $('btnRetryWrong').disabled = !wrong.length;
    session.wrong = wrong.map(function (x) { return { day: x.day, w: x.w }; });
    show('result');
  }

  /* ---------------- 검색 ---------------- */

  function runSearch() {
    var q = $('searchInput').value;
    var hits = Store.search(q);
    if (!q.trim()) {
      $('searchHint').textContent = '';
      $('searchResults').innerHTML = '';
      return;
    }
    $('searchHint').textContent = hits.length + '개';
    $('searchResults').innerHTML = hits.slice(0, 300).map(function (e) {
      return itemHTML(e.day, e.w, true);
    }).join('');
  }

  /* ---------------- 공부 시간 측정 ---------------- */
  // 학습 화면에 머무는 동안만 센다. 화면을 켜두고 자리를 비운 시간은
  // IDLE_MS 를 넘긴 순간부터 세지 않으므로 실제 공부한 시간에 가깝게 남는다.

  var TICK_MS = 5000;
  var IDLE_MS = 90000;
  var lastActivity = Date.now();

  function markActivity() { lastActivity = Date.now(); }

  function startClock() {
    setInterval(function () {
      if (view !== 'study') return;
      if (document.hidden) return;
      if (Date.now() - lastActivity > IDLE_MS) return;
      Store.addTime(TICK_MS / 1000);
    }, TICK_MS);
  }

  function fmtDur(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h && m) return h + '시간 ' + m + '분';
    if (h) return h + '시간';
    if (m) return m + '분';
    return sec ? '1분 미만' : '0분';
  }

  // 달력에서 칸 색 농도를 정하는 기준(분)
  function calLevel(sec) {
    var m = sec / 60;
    if (!m) return 0;
    if (m < 20) return 1;
    if (m < 40) return 2;
    if (m < 60) return 3;
    return 4;
  }

  function renderTime() {
    var total = Store.timeTotal();
    $('timeToday').textContent = fmtDur(Store.timeToday());
    $('timeTotal').textContent = fmtDur(total);
    $('timeTotalMin').textContent = '총 ' + Math.round(total / 60).toLocaleString() + '분';
    renderCalendar();
  }

  function renderCalendar() {
    var y = calDate.getFullYear(), mo = calDate.getMonth();
    var today = new Date();
    var isThisMonth = (y === today.getFullYear() && mo === today.getMonth());

    $('calTitle').textContent = y + '년 ' + (mo + 1) + '월';
    $('calNext').disabled = isThisMonth;

    var first = new Date(y, mo, 1);
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var cells = [], monthSec = 0, studied = 0;

    for (var i = 0; i < first.getDay(); i++) cells.push('<div class="cal-cell blank"></div>');

    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(y, mo, d);
      var sec = Store.timeOn(date);
      monthSec += sec;
      if (sec) studied++;
      var future = date > today && !(isThisMonth && d === today.getDate());
      var cls = 'cal-cell lv' + calLevel(sec) +
        (isThisMonth && d === today.getDate() ? ' today' : '') +
        (future ? ' future' : '');
      cells.push(
        '<div class="' + cls + '" title="' + (mo + 1) + '/' + d + ' · ' + fmtDur(sec) + '">' +
          '<span class="cd">' + d + '</span>' +
          (sec ? '<span class="ct">' + fmtCell(sec) + '</span>' : '') +
        '</div>'
      );
    }

    $('calGrid').innerHTML = cells.join('');
    $('calFoot').textContent = studied
      ? (mo + 1) + '월 ' + studied + '일 공부 · ' + fmtDur(monthSec)
      : (mo + 1) + '월 기록 없음';
  }

  // 달력 칸은 좁으므로 짧게 쓴다. 90분 -> 1.5h, 40분 -> 40m
  function fmtCell(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + 'm';
    var h = m / 60;
    return (h % 1 === 0 ? h : h.toFixed(1)) + 'h';
  }

  /* ---------------- 동기화 ---------------- */

  function fmtAgo(ts) {
    if (!ts) return '아직 없음';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
  }

  function renderSync(st) {
    $('btnSyncTop').hidden = !st.configured;
    if (!st.configured) return;

    $('btnSyncTop').textContent = st.busy ? '⟳' : '☁';
    $('btnSyncTop').classList.toggle('spin', st.busy);
    $('btnSyncTop').classList.toggle('on', st.signedIn);

    $('syncOut').hidden = st.signedIn;
    $('syncIn').hidden = !st.signedIn;
    if (st.signedIn) {
      $('syncWho').textContent = st.email;
      $('syncLast').textContent = st.busy ? '동기화 중…' : fmtAgo(st.last);
      $('btnSyncNow').disabled = st.busy || !st.online;
      $('btnSyncNow').textContent = st.busy ? '동기화 중…'
        : (st.online ? '지금 동기화' : '오프라인');
    } else if (st.email) {
      $('syncEmail').value = $('syncEmail').value || st.email;
    }
  }

  function syncError(e) {
    var m = String((e && e.code) || (e && e.message) || e);
    if (m.indexOf('invalid-credential') > -1 || m.indexOf('wrong-password') > -1
        || m.indexOf('user-not-found') > -1) return '이메일이나 비밀번호가 맞지 않습니다.';
    if (m.indexOf('email-already-in-use') > -1) return '이미 있는 계정입니다. 로그인을 눌러 주세요.';
    if (m.indexOf('weak-password') > -1) return '비밀번호는 6자 이상이어야 합니다.';
    if (m.indexOf('invalid-email') > -1) return '이메일 형식이 올바르지 않습니다.';
    if (m.indexOf('network') > -1) return '인터넷 연결을 확인해 주세요.';
    return m;
  }

  function showSyncErr(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function bindSync() {
    if (!global_Sync()) return;

    Sync.onChange(renderSync);
    renderSync(Sync.status());

    $('btnSyncTop').addEventListener('click', function () {
      showSyncErr('syncErr', ''); showSyncErr('syncErr2', '');
      $('syncPanel').hidden = false;
      renderSync(Sync.status());
    });
    $('btnSyncClose').addEventListener('click', function () { $('syncPanel').hidden = true; });
    $('syncPanel').addEventListener('click', function (ev) {
      if (ev.target === $('syncPanel')) $('syncPanel').hidden = true;
    });

    var creds = function () {
      return [$('syncEmail').value.trim(), $('syncPw').value];
    };

    $('btnSignIn').addEventListener('click', function () {
      var c = creds();
      showSyncErr('syncErr', '');
      Sync.signIn(c[0], c[1])
        .then(function () { $('syncPw').value = ''; })
        .catch(function (e) { showSyncErr('syncErr', syncError(e)); });
    });

    $('btnSignUp').addEventListener('click', function () {
      var c = creds();
      showSyncErr('syncErr', '');
      Sync.signUp(c[0], c[1])
        .then(function () { $('syncPw').value = ''; })
        .catch(function (e) { showSyncErr('syncErr', syncError(e)); });
    });

    $('btnSyncNow').addEventListener('click', function () {
      showSyncErr('syncErr2', '');
      Sync.sync()
        .then(function () { renderHome(); })
        .catch(function (e) { showSyncErr('syncErr2', syncError(e)); });
    });

    $('btnSignOut').addEventListener('click', function () {
      Sync.signOut().then(function () { showSyncErr('syncErr', ''); });
    });

    Sync.init();
  }

  function global_Sync() { return typeof Sync !== 'undefined' && Sync; }

  /* ---------------- 백업 내보내기 ---------------- */

  function exportBackup() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    var name = 'jvocab-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';

    var blob = new Blob([JSON.stringify(Store.exportAll())], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /* ---------------- 유틸 ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 단어를 누르면 네이버 일본어사전에서 그 단어를 검색해 새 탭으로 연다.
  function dictHTML(word, cls) {
    return '<a class="dict ' + (cls || '') + '" target="_blank" rel="noopener"' +
      ' title="네이버 일본어사전에서 보기"' +
      ' href="https://ja.dict.naver.com/#/search?query=' + encodeURIComponent(word) + '">' +
      esc(word) + '</a>';
  }

  function posHTML(pos) {
    if (!pos) return '';
    return '<span class="pos pos-' + posClass(pos) + '">' + esc(pos) + '</span>';
  }

  function posClass(pos) {
    if (pos.indexOf('い형') === 0) return 'i-adj';
    if (pos.indexOf('な형') === 0) return 'na-adj';
    if (pos.indexOf('동') === 0) return 'verb';
    if (pos.indexOf('명') === 0) return 'noun';
    if (pos.indexOf('부') === 0) return 'adv';
    return 'etc';
  }

  // 표제어에서 예문 안을 찾을 기준이 되는 한자를 뽑는다. 동사는 활용하므로
  // 한자 부분만 잡는다. (見送る → 見送, お祝い → 祝, 合図 → 合図)
  function stemOf(word) {
    var runs = String(word).match(/[一-龯々]+/g);
    return runs && runs.length
      ? runs.reduce(function (a, b) { return b.length >= a.length ? b : a; })
      : String(word);
  }

  function markPlain(text, stem) {
    if (!stem || !text) return esc(text);
    var re = new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    var out = '', last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0].length) break;
      out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  // 예문은 `漢字[かんじ]` 표기로 저장한다.
  //   withRuby=false → 한자만 (문제 풀 때: 읽는 법이 보이면 안 됨)
  //   withRuby=true  → 한자 위에 읽는 법 (책 지면 그대로: 검색·목록에서 볼 때)
  var RUBY_RE = /([一-龯々〆ヶ]+)\[([^\]]*)\]/g;

  function renderJP(jp, word, withRuby) {
    var stem = stemOf(word);
    var out = '', last = 0, m;
    RUBY_RE.lastIndex = 0;
    while ((m = RUBY_RE.exec(jp)) !== null) {
      out += markPlain(jp.slice(last, m.index), stem);
      var kanji = m[1], kana = m[2];
      var body = (withRuby && kana)
        ? '<ruby>' + esc(kanji) + '<rt>' + esc(kana) + '</rt></ruby>'
        : esc(kanji);
      out += (stem && kanji.indexOf(stem) > -1) ? '<mark>' + body + '</mark>' : body;
      last = m.index + m[0].length;
    }
    return out + markPlain(jp.slice(last), stem);
  }

  // 예문 · 문형 · 관련어 블록. 학습 카드와 단어 목록에서 함께 쓴다.
  function detailHTML(w, withRuby) {
    var parts = [];

    (w.examples || []).forEach(function (ex) {
      parts.push(
        '<div class="ex' + (withRuby ? ' ruby' : '') + '">' +
          '<p class="ex-jp">' + renderJP(ex.jp, w.word, withRuby) + '</p>' +
          (ex.ko ? '<p class="ex-ko">' + esc(ex.ko) + '</p>' : '') +
        '</div>'
      );
    });

    if ((w.grammar || []).length) {
      parts.push('<div class="gram"><span class="gram-tag">문형</span><div class="gram-list">' +
        w.grammar.map(function (g) {
          return '<div class="gram-row"><span class="gram-form">' + esc(g.form) + '</span>' +
            (g.meaning ? '<span class="gram-mean">' + esc(g.meaning) + '</span>' : '') + '</div>';
        }).join('') + '</div></div>');
    }

    if ((w.related || []).length) {
      parts.push('<div class="gram"><span class="gram-tag rel">관련어</span><div class="gram-list">' +
        w.related.map(function (r) {
          return '<div class="gram-row"><span class="gram-form">' + dictHTML(r.word) +
            (r.reading ? ' <i>' + esc(r.reading) + '</i>' : '') + '</span>' +
            '<span class="gram-mean">' + posHTML(r.pos) + esc(r.meaning) + '</span></div>';
        }).join('') + '</div></div>');
    }

    return parts.join('');
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 이벤트 ---------------- */

  function bind() {
    $('btnHome').addEventListener('click', function () { renderHome(); show('home'); });
    $('btnSearchTop').addEventListener('click', openSearch);
    $('btnSearchClose').addEventListener('click', closeSearch);

    $('btnResume').addEventListener('click', function () {
      var s = restoreSession();
      if (!s) { renderHome(); return; }
      session = s;
      show('study');
      renderCard();
    });
    $('btnTimeTop').addEventListener('click', function () {
      calDate = new Date();
      renderTime();
      show('time');
    });
    $('calPrev').addEventListener('click', function () {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
      renderCalendar();
    });
    $('calNext').addEventListener('click', function () {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
      renderCalendar();
    });

    $('dayGrid').addEventListener('click', function (ev) {
      var cell = ev.target.closest('.day-cell');
      if (!cell) return;
      var n = Number(cell.dataset.day);
      toggleSel(n);
      cell.classList.toggle('sel', isSel(n));
      $('btnSelAll').textContent =
        (selected.length === Store.allDays().length && selected.length) ? '선택 해제' : '전체 선택';
      renderSelBar();
    });

    $('btnSelAll').addEventListener('click', function () {
      var all = Store.allDays().map(function (d) { return d.day; });
      selected = (selected.length === all.length) ? [] : all;
      renderHome();
    });
    $('btnSelClear').addEventListener('click', function () {
      selected = [];
      renderHome();
    });
    $('btnSelView').addEventListener('click', function () { renderDays(selected); });
    $('btnSelStudy').addEventListener('click', function () {
      startSession(entriesOfDays(selected, false), dayLabel(selected));
    });

    $('btnStudyAll').addEventListener('click', function () {
      startSession(entriesOfDays(currentDays, false), dayLabel(currentDays));
    });
    $('btnStudyDue').addEventListener('click', function () {
      startSession(entriesOfDays(currentDays, true), dayLabel(currentDays) + ' 복습');
    });
    $('btnReviewToday').addEventListener('click', function () {
      startSession(Store.dueList(), '오늘의 복습');
    });
    $('btnWeakStudy').addEventListener('click', function () {
      startSession(Store.weakList(), '모르는 단어');
    });

    $('randCounts').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      randCount = Number(chip.dataset.n);
      $$('#randCounts .chip').forEach(function (c) { c.classList.toggle('sel', c === chip); });
      renderHome();
    });
    $('btnRandStudy').addEventListener('click', function () {
      var pool = shuffle(Store.allWords());
      var n = randCount && randCount < pool.length ? randCount : pool.length;
      startSession(pool.slice(0, n), '랜덤 ' + n + '단어');
    });

    $('btnReveal').addEventListener('click', reveal);
    $('btnNext').addEventListener('click', next);
    $$('.ox-btn').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.dataset.t, Number(b.dataset.v)); });
    });

    $('btnRetryWrong').addEventListener('click', function () {
      startSession(session.wrong, '틀린 단어 다시');
    });
    $('btnResultHome').addEventListener('click', function () { renderHome(); show('home'); });

    $('searchInput').addEventListener('input', runSearch);

    bindExpand($('dayWordList'));
    bindExpand($('searchResults'));
    bindExpand($('resultList'));

    $('btnUpload').addEventListener('click', function () { $('fileInput').click(); });
    $('btnBackup').addEventListener('click', exportBackup);

    // 단어 파일과 백업 파일을 같은 버튼으로 받는다. 내용을 보고 알아서 구분한다.
    $('fileInput').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files);
      var done = 0, days = 0, errs = [], merged = null;

      files.forEach(function (f) {
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var text = String(fr.result).replace(/^﻿/, '').trim();
            var obj = (text.charAt(0) === '{' || text.charAt(0) === '[') ? JSON.parse(text) : null;
            if (obj && Store.isBackup(obj)) {
              var s = Store.importBackup(obj);
              merged = merged
                ? { days: merged.days + s.days, words: merged.words + s.words, theirs: merged.theirs + s.theirs }
                : s;
            } else {
              days += Store.importText(text);
            }
          } catch (e) { errs.push(f.name); }
          if (++done === files.length) finish();
        };
        fr.onerror = function () { errs.push(f.name); if (++done === files.length) finish(); };
        fr.readAsText(f, 'utf-8');
      });

      function finish() {
        ev.target.value = '';
        renderHome();
        var msg = [];
        if (merged) {
          msg.push('백업을 합쳤습니다.');
          msg.push('단어 ' + merged.words + '개 중 ' + merged.theirs + '개가 더 최신이라 갱신됐습니다.');
          if (merged.days) msg.push('Day ' + merged.days + '개도 함께 들어왔습니다.');
        }
        if (days) msg.push(days + '개 Day를 불러왔습니다.');
        if (!msg.length && !errs.length) msg.push('불러올 내용이 없습니다.');
        if (errs.length) msg.push('실패: ' + errs.join(', '));
        alert(msg.join('\n'));
      }
    });

    document.addEventListener('keydown', function (ev) {
      // 검색 패널이 열려 있으면 O/X 단축키가 검색어에 끼어들면 안 된다.
      if (searchOpen) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeSearch(); }
        return;
      }
      if (view !== 'study') return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!$('btnReveal').hidden) reveal();
        else next();
      } else if (ev.key === '1') pick('reading', 1);
      else if (ev.key === '2') pick('reading', 0);
      else if (ev.key === '3') pick('meaning', 1);
      else if (ev.key === '4') pick('meaning', 0);
      else if (ev.key === ' ') { ev.preventDefault(); reveal(); }
    });
  }

  Store.init();
  bind();
  bindSync();
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, markActivity, true);
  });
  document.addEventListener('visibilitychange', markActivity);
  startClock();
  renderHome();
  show('home');
})();
