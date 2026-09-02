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
  var resultAll = [], resultWrong = [], resultView = 'wrong';  // 결과 화면 탭
  var navLock = false;      // 뒤로가기 처리 중에는 히스토리를 쌓지 않는다

  // 기기가 실제로 어느 버전을 돌고 있는지 확인하려고 남긴다.
  // 앱이 옛 캐시를 쓰고 있으면 이 숫자가 안 올라간다.
  var BUILD = 'v25';

  /* ---------------- 화면 ---------------- */

  /* ---------------- 안드로이드 뒤로가기 ---------------- */
  // 홈이 아닌 화면이나 덮개를 열 때 히스토리에 한 칸을 쌓아 둔다.
  // 그래야 뒤로가기가 앱을 끄지 않고 이전 화면으로 돌아온다.
  // 홈에서 뒤로가기를 누르면 쌓인 게 없으므로 안드로이드 관례대로 앱이 닫힌다.

  function pushNav() {
    if (navLock) return;
    try { history.pushState({ jv: 1 }, ''); } catch (e) {}
  }

  // 덮개를 닫는 버튼은 직접 숨기지 않고 뒤로가기를 부른다.
  // 그래야 쌓아 둔 히스토리가 정확히 하나씩 소모된다.
  function goBack() {
    try { history.back(); } catch (e) {}
  }

  // 뒤로가기가 돌아갈 화면. 문법 안에서는 문법 홈으로, 그다음이 첫 화면이다.
  var BACK_TO = {
    home: 'pick', gram: 'pick',
    day: 'home', study: 'home', result: 'home', time: 'home',
    gramCh: 'gram', gramStudy: 'gram'
  };

  function handleBack() {
    navLock = true;
    try {
      if (!$('syncPanel').hidden) $('syncPanel').hidden = true;
      else if (!$('howToPanel').hidden) $('howToPanel').hidden = true;
      else if (searchOpen) closeSearch();
      else if (view !== 'pick') goView(BACK_TO[view] || 'pick');
    } finally {
      navLock = false;
    }
  }

  // 화면으로 이동하면서 필요한 것을 다시 그린다.
  function goView(v) {
    if (v === 'pick')      { renderPick(); show('pick'); }
    else if (v === 'home') { renderHome(); show('home'); }
    else if (v === 'gram') { renderGramHome(); show('gram'); }
    else if (v === 'time') { renderTime(); show('time'); }
    else show(v);
  }

  function renderPick() {
    var v = Store.summarizeAll();
    var g = Store.gSummarizeAll();
    var pct = function (s) { return s.total ? Math.round(s.long / s.total * 100) : 0; };
    $('pkVocabSub').textContent = '해커스 JLPT 기출 단어장 · ' + v.total + '단어';
    $('pkGramSub').textContent  = 'JLPT 문법사전 N5~N1 · ' + g.total + '문형';
    $('pkVocabPct').textContent = pct(v) + '%';
    $('pkGramPct').textContent  = pct(g) + '%';
  }

  var VIEW_TITLE = {
    pick: '일본어 학습', home: '단어', gram: '문법',
    gramCh: '내용 보기', gramStudy: '문법'
  };

  function show(name) {
    if (name !== 'pick' && name !== view) pushNav();
    view = name;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    $('btnHome').hidden = (name === 'pick');
    $('btnTimeTop').hidden = (name === 'study' || name === 'gramStudy' || name === 'time');
    $('selBar').hidden = !(name === 'home' && selected.length);
    document.body.classList.toggle('has-selbar', name === 'home' && !!selected.length);
    $('topTitle').textContent = VIEW_TITLE[name] || '일본어 단어 장기기억';
    window.scrollTo(0, 0);
  }

  /* ---------------- 검색 패널 ---------------- */
  // 화면을 갈아끼우지 않고 위에 겹쳐 띄운다. 그래야 학습 중에 열어도
  // 풀던 카드와 진행 상황이 그대로 남는다.

  function openSearch() {
    searchOpen = true;
    pushNav();
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

  // 각 칸을 눌러 그 단계의 단어만 골라 학습할 수 있다.
  // 복습일이 안 됐어도 원할 때 시험 볼 수 있게 하려는 것.
  function statHTML(s, tappable) {
    var cell = function (cls, n, label, stage) {
      var on = tappable && n > 0;
      return '<' + (on ? 'button' : 'div') + ' class="stat ' + cls + (on ? ' tap' : '') + '"' +
        (on ? ' data-stage="' + stage + '"' : '') + '>' +
        '<span class="n">' + n + '</span><span class="l">' + label + '</span></' + (on ? 'button' : 'div') + '>';
    };
    return cell('total', s.total, '전체', 'all') +
           cell('unknown', s.unknown + s['new'], '모름 · 미학습', 'unknown') +
           cell('short', s.short, '단기기억', 'short') +
           cell('long', s.long, '장기기억', 'long');
  }

  var STAGE_NAME = { all: '전체', unknown: '모름 · 미학습', short: '단기기억', long: '장기기억' };

  // 다음 복습이 언제인지. 대기가 0일 때 보여준다.
  function nextDueText() {
    var next = 0;
    Store.allWords().forEach(function (e) {
      var r = Store.recOf(e.day, e.w);
      if (!r.seen) return;
      var d = Store.dueMs(r);
      if (!next || d < next) next = d;
    });
    if (!next) return '0개 대기';

    var ms = next - Date.now();
    if (ms <= 0) return '0개 대기';
    if (ms < 3600000)  return '다음 복습 ' + Math.max(1, Math.round(ms / 60000)) + '분 뒤';
    if (ms < 86400000) return '다음 복습 ' + Math.round(ms / 3600000) + '시간 뒤';
    return '다음 복습 ' + Math.round(ms / 86400000) + '일 뒤';
  }

  // 해당 단계의 단어만 모은다. entries 를 주면 그 안에서만 고른다.
  function byStage(stage, entries) {
    var src = entries || Store.allWords();
    if (stage === 'all') return src;
    return src.filter(function (e) {
      var st = Store.stageFor(e.day, e.w);
      return stage === 'unknown' ? (st === 'unknown' || st === 'new') : st === stage;
    });
  }

  /* ---------------- 홈 ---------------- */

  function renderHome() {
    var s = Store.summarizeAll();
    $('globalStats').innerHTML = statHTML(s, true);
    renderProgress(s);
    renderResume();

    var due = Store.dueList(), weak = Store.weakList();
    // 대기가 0이면 언제 다시 뜨는지 알려준다. 안 그러면 고장난 것처럼 보인다.
    $('reviewCount').textContent = due.length
      ? due.length + '개 대기'
      : nextDueText();
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
    var all = wordsOf(selected);
    var due = all.filter(function (e) { return Store.isDue(e.day, e.w); });
    // 모름·단기기억은 복습일과 상관없이 언제든 더 볼 수 있게 따로 뽑는다.
    var unk = byStage('unknown', all);
    var sht = byStage('short', all);
    $('selDays').textContent = dayLabel(selected);
    $('selWords').textContent = all.length + '단어 · 복습할 것 ' + due.length + '개';
    $('btnSelUnknown').textContent = '모름 ' + unk.length;
    $('btnSelShort').textContent = '단기 ' + sht.length;
    $('btnSelDue').textContent = '복습 ' + due.length;
    $('btnSelStudy').textContent = '전체 ' + all.length;
    $('btnSelUnknown').disabled = !unk.length;
    $('btnSelShort').disabled = !sht.length;
    $('btnSelDue').disabled = !due.length;
    $('btnSelStudy').disabled = !all.length;
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
    $('dayStats').innerHTML = statHTML(s, true);

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
          '<span class="wl-word" lang="ja">' + dictHTML(w.word) +
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
      // 정답을 봤으니 예문을 후리가나까지 붙여 다시 그린다.
      // 문제를 푸는 동안에는 읽는 법이 새면 안 되므로 한자만 보여줬다.
      var e = session.queue[session.index];
      $('detailBox').innerHTML = detailHTML(e.w, true);
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

  // 둘 다 O 로 찍고 바로 넘어간다. 아는 단어를 빠르게 지나가기 위한 지름길.
  function bothOk() {
    if ($('checkBox').hidden) return;
    pick('reading', 1);
    pick('meaning', 1);
    next();
  }

  // 읽는 법도 뜻도 모를 때. 둘 다 X 로 찍고 넘어간다.
  function bothNo() {
    if ($('checkBox').hidden) return;
    pick('reading', 0);
    pick('meaning', 0);
    next();
  }

  // 확실히 아는 단어를 복습 목록에서 빼고 장기기억으로 보낸다.
  function markKnown() {
    if ($('checkBox').hidden) return;
    var e = session.queue[session.index];
    var rec = Store.markKnown(e.day, e.w);
    session.results.push({ day: e.day, w: e.w, r: true, m: true, level: rec.level, known: true });
    advance();
  }

  function next() {
    if (picked.reading === null || picked.meaning === null) return;
    var e = session.queue[session.index];
    var rec = Store.grade(e.day, e.w, picked.reading === 1, picked.meaning === 1);
    session.results.push({ day: e.day, w: e.w, r: picked.reading === 1, m: picked.meaning === 1, level: rec.level });
    advance();
  }

  function advance() {
    session.index++;
    persistSession();
    if (global_Sync()) Sync.touch(); // 세션 중간에 앱을 꺼도 잃지 않게
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

    // 틀린 단어만 모아서 먼저 보여주고, 전체로도 넘겨볼 수 있게 한다.
    resultAll = res;
    resultWrong = wrong;
    resultView = wrong.length ? 'wrong' : 'all';
    renderResultList();

    $('retryCount').textContent = wrong.length + '개';
    $('btnRetryWrong').disabled = !wrong.length;
    session.wrong = wrong.map(function (x) { return { day: x.day, w: x.w }; });
    show('result');
  }

  function resultItemHTML(x) {
    var st = Store.stageOf(x.level, 1);
    var detail = detailHTML(x.w, true);
    var mark = x.known ? '이미 아는 단어'
      : '읽기 ' + (x.r ? 'O' : 'X') + ' · 뜻 ' + (x.m ? 'O' : 'X');
    return '<div class="wl-item' + (detail ? ' has-detail' : '') + '"' +
        (detail ? ' role="button" tabindex="0"' : '') + '>' +
      '<div class="wl-head">' +
        '<span class="wl-dot dot-' + st + '"></span>' +
        '<span class="wl-main">' +
          '<span class="wl-word" lang="ja">' + dictHTML(x.w.word) +
            '<span class="wl-reading">' + esc(x.w.reading) + '</span>' + posHTML(x.w.pos) +
          '</span>' +
          '<div class="wl-meaning">' + esc(x.w.meaning) + '</div>' +
        '</span>' +
        '<span class="wl-side">' + mark +
          '<span class="wl-day">' + Store.STAGE_LABEL[st] + '</span></span>' +
        (detail ? '<span class="wl-caret">▾</span>' : '') +
      '</div>' +
      (detail ? '<div class="wl-detail" hidden>' + detail + '</div>' : '') +
    '</div>';
  }

  function renderResultList() {
    var wrongOn = (resultView === 'wrong');
    var list = wrongOn ? resultWrong : resultAll;

    $('resultTabs').hidden = !resultWrong.length;  // 다 맞았으면 탭이 필요 없다
    $('tabWrong').textContent = '틀린 단어 ' + resultWrong.length;
    $('tabAll').textContent = '전체 ' + resultAll.length;
    $('tabWrong').classList.toggle('sel', wrongOn);
    $('tabAll').classList.toggle('sel', !wrongOn);

    $('resultEmpty').hidden = list.length > 0;
    $('resultEmpty').textContent = '틀린 단어가 없습니다. 전부 맞혔어요.';
    $('resultList').innerHTML = list.map(resultItemHTML).join('');
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
      if (view !== 'study' && view !== 'gramStudy') return;   // 문법 학습도 공부 시간에 넣는다
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
    $('syncBuild').textContent = BUILD;
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
      pushNav();
      $('syncPanel').hidden = false;
      renderSync(Sync.status());
    });
    $('btnSyncClose').addEventListener('click', goBack);
    $('syncPanel').addEventListener('click', function (ev) {
      if (ev.target === $('syncPanel')) goBack();
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

  /* ---------------- 단어 만드는 법 · 붙여넣기 추가 ---------------- */

  // Claude 에게 그대로 보내면 되는 지시문. 이 앱이 읽는 형식을 설명한다.
  var PROMPT = [
    '이 일본어 단어장 페이지에서 단어를 뽑아 아래 JSON 형식으로만 답해줘.',
    '설명은 빼고 JSON만.',
    '',
    '{',
    '  "day": 27,',
    '  "title": "페이지 하단에 적힌 주제",',
    '  "words": [',
    '    {',
    '      "no": 1558,',
    '      "word": "見送る",',
    '      "reading": "みおくる",',
    '      "pos": "동",',
    '      "meaning": "배웅하다",',
    '      "star": true,',
    '      "examples": [{',
    '        "jp": "友[とも]だちを空港[くうこう]まで見送[みおく]った。",',
    '        "ko": "친구를 공항까지 배웅했다."',
    '      }],',
    '      "grammar": [{ "form": "동사 사전형 + ところだ", "meaning": "-(하)려던 참이다" }],',
    '      "related": [{ "word": "見送り", "reading": "みおくり", "pos": "명", "meaning": "배웅, 전송" }]',
    '    }',
    '  ]',
    '}',
    '',
    '규칙:',
    '- word = 왼쪽 일본어 단어, reading = 가운데 히라가나(없으면 "-"), meaning = 오른쪽 한글 뜻',
    '- pos = 뜻 앞 작은 네모의 품사: 명 / 동 / い형 / な형 / 부',
    '- star = 단어 옆에 ★ 가 있으면 true, 없으면 생략',
    '- 예문의 한자에는 후리가나를 漢字[かな] 형태로 반드시 붙일 것.',
    '  한자마다가 아니라 읽기 단위로: 留学[りゅうがく]に行[い]く',
    '- grammar 는 예문 아래 [문형], related 는 [관련어]. 없으면 생략',
    '- 여러 Day 를 한 번에 주면 [ {...}, {...} ] 배열로',
    '- 확실하지 않은 글자는 지어내지 말고 그 단어를 빼고 어떤 걸 뺐는지 마지막에 알려줘'
  ].join('\n');

  function copyPrompt() {
    var done = function () {
      var b = $('btnCopyPrompt');
      b.textContent = '복사됨';
      setTimeout(function () { b.textContent = '프롬프트 복사'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(PROMPT).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = PROMPT;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function pasteAdd() {
    var text = $('pasteBox').value.trim();
    $('pasteErr').hidden = true;
    if (!text) { showPasteErr('붙여넣은 내용이 없습니다.'); return; }

    // Claude 가 ```json 으로 감싸 주는 경우가 흔하다.
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      showPasteErr('JSON 형식이 아닙니다. { 부터 } 까지 통째로 복사했는지 확인해 주세요.');
      return;
    }

    try {
      if (Store.isBackup(obj)) {
        var s = Store.importBackup(obj);
        finishPaste('백업을 합쳤습니다. 단어 ' + s.words + '개 확인.');
      } else {
        var n = Store.importText(JSON.stringify(obj));
        if (!n) { showPasteErr('단어를 찾지 못했습니다. day 와 words 가 있는지 확인해 주세요.'); return; }
        finishPaste(n + '개 Day를 추가했습니다.');
      }
    } catch (e) {
      showPasteErr('불러오지 못했습니다: ' + e.message);
    }
  }

  function showPasteErr(msg) {
    $('pasteErr').textContent = msg;
    $('pasteErr').hidden = false;
  }

  function finishPaste(msg) {
    $('pasteBox').value = '';
    $('howToPanel').hidden = true;
    renderHome();
    if (global_Sync()) Sync.sync().catch(function () {});  // 다른 기기로 바로 보낸다
    alert(msg);
  }

  /* ================= 문법 ================= */

  var gMode = null;        // 'learn' | 'cloze' | 'choice'
  var gQueue = [], gIdx = 0;
  var gTyped = '', gGraded = null, gPicked = null, gOpts = null;

  var G_NAME = { learn: '내용 보기', cloze: '빈칸 채우기', choice: '4지선다' };

  // 빈칸의 정답 = {{ }} 안의 내용에서 후리가나를 뺀 것.
  // 문형 이름(~をもとに)이 아니라 그 문장에 실제로 들어간 형태를 답으로 본다.
  function answerOf(ex) {
    var m = ex.jp.match(/\{\{([\s\S]*?)\}\}/);
    return m ? m[1].replace(/\[[^\]]*\]/g, '') : '';
  }

  // 비교 전 다듬기: 후리가나·물결표·공백을 빼고 전각/반각을 통일한다.
  function normAns(s) {
    s = String(s).replace(/\[[^\]]*\]/g, '').replace(/[~～]/g, '').replace(/\s+/g, '');
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s;
  }

  // 예문 렌더링. 후리가나는 漢字[かな], 문형 자리는 {{ }} 로 표시돼 있다.
  function gJP(jp, opt) {
    opt = opt || {};
    var out = '', i = 0, re = /\{\{([\s\S]*?)\}\}/g, m;
    var seg = function (t) {
      var s = '', last = 0, r = /([一-龯々〆ヶ]+)\[([^\]]*)\]/g, x;
      while ((x = r.exec(t)) !== null) {
        s += esc(t.slice(last, x.index));
        s += (opt.ruby && x[2]) ? '<ruby>' + esc(x[1]) + '<rt>' + esc(x[2]) + '</rt></ruby>' : esc(x[1]);
        last = x.index + x[0].length;
      }
      return s + esc(t.slice(last));
    };
    while ((m = re.exec(jp)) !== null) {
      out += seg(jp.slice(i, m.index));
      if (opt.blank)       out += '<span class="gblank">?</span>';
      else if (opt.reveal) out += '<span class="gblank filled">' + seg(m[1]) + '</span>';
      else                 out += '<mark>' + seg(m[1]) + '</mark>';
      i = m.index + m[0].length;
    }
    return out + seg(jp.slice(i));
  }

  function renderGramHome() {
    var s = Store.gSummarizeAll();
    var pct = s.total ? (s.long / s.total * 100) : 0;
    $('gProgLong').textContent = s.long;
    $('gProgTotal').textContent = '/ ' + s.total + ' 문형';
    $('gProgPct').innerHTML = (pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)) + '<i>%</i>';

    var t = s.total || 1;
    var seg = function (n, c) {
      return n ? '<i class="' + c + '" style="width:' + (n / t * 100).toFixed(3) + '%"></i>' : '';
    };
    $('gProgSeg').innerHTML =
      seg(s.long, 'long') + seg(s.short, 'short') + seg(s.unknown, 'unknown') + seg(s['new'], 'new');
    $('gStats').innerHTML = statHTML(s);

    var all = Store.allGram();
    var due = all.filter(function (it) { return Store.gIsDue(it); });
    $('gmClozeN').textContent = due.length + '개';
    $('gmChoiceN').textContent = due.length + '개';
    $('gEmptyNote').hidden = all.length > 0;
  }

  // 내용 보기는 챕터(레벨·섹션)를 먼저 고른다.
  function renderGramChapters() {
    var secs = Store.gramSections();
    $('gChList').innerHTML = secs.map(function (g) {
      var s = Store.gSummarize(g.items);
      var pct = s.total ? Math.round(s.long / s.total * 100) : 0;
      var nums = g.items.map(function (i) { return i.no; });
      var range = nums.length ? Math.min.apply(null, nums) + '~' + Math.max.apply(null, nums) : '';
      return '<button class="ch" data-k="' + esc(g.level + '-' + g.section) + '">' +
        '<span class="ch-lv">' + esc(g.level) + '</span>' +
        '<span class="ch-tx">' +
          '<span class="ch-t">' + String(g.section).padStart(2, '0') + '. ' + esc(g.sectionTitle) + '</span>' +
          '<span class="ch-s">' + g.items.length + '개 · ' + range + '번</span>' +
        '</span>' +
        '<span class="ch-n">' + pct + '%</span></button>';
    }).join('');
    show('gramCh');
  }

  function startGram(mode, items, label) {
    if (!items.length) return;
    gMode = mode;
    gQueue = Store.shuffleArr(items);
    if (mode === 'learn') {
      // 읽는 순서는 섞지 않는다. 책 순서대로 보는 게 자연스럽다.
      gQueue = items.slice();
    }
    gIdx = 0; gTyped = ''; gGraded = null; gPicked = null; gOpts = null;
    $('gLabel').textContent = label || G_NAME[mode];
    show('gramStudy');
    renderGramCard();
  }

  function renderGramCard() {
    if (gIdx >= gQueue.length) { renderGramDone(); return; }
    var it = gQueue[gIdx], h = '';

    $('gCount').textContent = (gIdx + 1) + ' / ' + gQueue.length;
    $('gFill').style.width = (gIdx / gQueue.length * 100) + '%';

    var st = Store.gStageFor(it);
    h += '<div class="card">';
    h += '<div class="card-meta">' +
         '<span class="badge ' + st + '">' + Store.STAGE_LABEL[st] + '</span>' +
         '<span class="card-no">' + esc(it.level) + ' · ' + it.no + (it.sub ? '-(' + it.sub + ')' : '') +
           (it.group ? ' · <span lang="ja">' + esc(it.group) + '</span>' : '') + '</span></div>';

    if (gMode === 'learn') {
      h += '<div class="gpat" lang="ja">' + esc(it.pattern) + '</div>';
      h += '<div class="gpatko">' + esc(it.ko) + '</div>';
      h += grow('의미', esc(it.meaning), '');
      h += grow('접속', esc(it.connect), 'cn');
      h += '<div class="detail-box">';
      it.examples.forEach(function (e) {
        h += '<div class="ex ruby"><p class="ex-jp" lang="ja">' + gJP(e.jp, { ruby: true }) + '</p>' +
             '<p class="ex-ko">' + esc(e.ko) + (e.type ? '<span class="gtag">' + esc(e.type) + '</span>' : '') + '</p></div>';
      });
      h += '</div><button class="next-btn" id="gNext">다음</button>';
    }

    if (gMode === 'cloze') {
      var e0 = it.examples[0];
      h += '<p class="ex-jp gq" lang="ja">' + gJP(e0.jp, gGraded ? { reveal: true, ruby: true } : { blank: true, ruby: true }) + '</p>';
      h += '<p class="ex-ko gqko">' + esc(e0.ko) + '</p>';
      if (!gGraded) {
        h += '<input class="ginp" id="gAns" lang="ja" placeholder="빈칸에 들어갈 말" ' +
             'autocomplete="off" autocapitalize="off" spellcheck="false">';
        h += '<button class="next-btn" id="gSubmit">확인</button>';
        h += '<button class="known-btn" id="gSkip">모르겠어요 · 정답 보기</button>';
      } else {
        var ok = (gGraded === 'right');
        h += '<div class="gjudge ' + (gGraded === 'skip' ? 'skip' : (ok ? 'right' : 'wrong')) + '">' +
             (gGraded === 'skip' ? '정답을 확인하세요' : (ok ? '정답입니다' : '틀렸습니다')) + '</div>';
        if (gGraded === 'wrong' && gTyped)
          h += '<div class="gcmp"><span class="cl">입력</span><span class="cv bad" lang="ja">' + esc(gTyped) + '</span></div>';
        h += '<div class="gcmp"><span class="cl">정답</span><span class="cv good" lang="ja">' + esc(answerOf(e0)) + '</span></div>';
        h += grow('문형', '<span lang="ja">' + esc(it.pattern) + '</span> <span class="gko">' + esc(it.ko) + '</span>', 'cn');
        h += grow('접속', esc(it.connect), 'cn');
        h += grow('의미', esc(it.meaning), 'dim');
        h += '<div class="check-box" style="margin-top:12px">' +
          gcheck('문형을 떠올렸나요?', 'pat') +
          gcheck('접속도 정확했나요?', 'con') +
          '</div>';
        h += '<button class="next-btn" id="gNext" disabled>다음</button>';
        if (gGraded === 'wrong')
          h += '<button class="known-btn" id="gOverride">이것도 맞는 표현이에요 · 정답 처리</button>';
      }
    }

    if (gMode === 'choice') {
      var e1 = it.examples[0];
      if (!gOpts) gOpts = Store.gChoices(it, 4);
      h += '<p class="ex-jp gq" lang="ja">' + gJP(e1.jp, { blank: true, ruby: true }) + '</p>';
      h += '<p class="ex-ko gqko">' + esc(e1.ko) + '</p>';
      h += '<div class="gopts">';
      gOpts.forEach(function (d, i) {
        var cls = '';
        if (gPicked !== null) cls = (Store.gKeyOf(d) === Store.gKeyOf(it)) ? ' right' : (i === gPicked ? ' wrong' : '');
        var why = (gPicked !== null)
          ? '<span class="why">' + esc(d.ko) + ' · ' + esc(d.connect) + '</span>' : '';
        h += '<button class="gopt' + cls + '" data-i="' + i + '"><span lang="ja">' + esc(d.pattern) + '</span>' + why + '</button>';
      });
      h += '</div>';
      if (gPicked !== null) h += '<button class="next-btn" id="gNext">다음</button>';
    }

    h += '</div>';
    $('gStage').innerHTML = h;
    bindGramCard();
  }

  function grow(k, v, cls) {
    return '<div class="grow"><span class="k">' + k + '</span><span class="v ' + (cls || '') + '">' + v + '</span></div>';
  }
  function gcheck(label, t) {
    return '<div class="check-row"><span class="check-label">' + label + '</span><div class="ox">' +
      '<button class="ox-btn o" data-g="' + t + '" data-v="1">O</button>' +
      '<button class="ox-btn x" data-g="' + t + '" data-v="0">X</button></div></div>';
  }

  var gPick = { pat: null, con: null };

  function bindGramCard() {
    var inp = $('gAns');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', function (ev) {
        // 일본어 IME 로 변환 중인 엔터는 확정용이므로 제출로 받으면 안 된다.
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); gSubmit(false); }
      });
    }
    if ($('gSubmit')) $('gSubmit').addEventListener('click', function () { gSubmit(false); });
    if ($('gSkip'))   $('gSkip').addEventListener('click', function () { gSubmit(true); });
    if ($('gOverride')) $('gOverride').addEventListener('click', function () {
      gGraded = 'right'; gPick.pat = 1; renderGramCard();
      $$('.ox-btn[data-g="pat"]').forEach(function (b) { b.classList.toggle('sel', b.dataset.v === '1'); });
      refreshGNext();
    });
    if ($('gNext')) $('gNext').addEventListener('click', gNext);

    $$('#gStage .ox-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        gPick[b.dataset.g] = Number(b.dataset.v);
        $$('#gStage .ox-btn[data-g="' + b.dataset.g + '"]').forEach(function (x) {
          x.classList.toggle('sel', x === b);
        });
        refreshGNext();
      });
    });
    $$('#gStage .gopt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (gPicked !== null) return;
        gPicked = Number(b.dataset.i);
        var it = gQueue[gIdx];
        var ok = Store.gKeyOf(gOpts[gPicked]) === Store.gKeyOf(it);
        Store.gGrade(it, ok, ok);
        if (global_Sync()) Sync.touch();
        renderGramCard();
      });
    });
  }

  function refreshGNext() {
    var b = $('gNext');
    if (b) b.disabled = (gPick.pat === null || gPick.con === null);
  }

  function gSubmit(skip) {
    var it = gQueue[gIdx], e0 = it.examples[0];
    var el = $('gAns');
    gTyped = el ? el.value.trim() : '';
    if (skip) gGraded = 'skip';
    else if (!gTyped) { if (el) el.focus(); return; }
    else gGraded = (normAns(gTyped) === normAns(answerOf(e0))) ? 'right' : 'wrong';

    // 자동 채점 결과를 체크칸에 미리 반영해 두고, 필요하면 사용자가 바꾼다.
    gPick.pat = (gGraded === 'right') ? 1 : 0;
    gPick.con = null;
    renderGramCard();
    $$('.ox-btn[data-g="pat"]').forEach(function (b) {
      b.classList.toggle('sel', Number(b.dataset.v) === gPick.pat);
    });
    refreshGNext();
  }

  function gNext() {
    var it = gQueue[gIdx];
    if (gMode === 'cloze') {
      if (gPick.pat === null || gPick.con === null) return;
      Store.gGrade(it, gPick.pat === 1, gPick.con === 1);
      if (global_Sync()) Sync.touch();
    }
    gIdx++; gTyped = ''; gGraded = null; gPicked = null; gOpts = null;
    gPick.pat = null; gPick.con = null;
    renderGramCard();
  }

  function renderGramDone() {
    $('gFill').style.width = '100%';
    $('gCount').textContent = gQueue.length + ' / ' + gQueue.length;
    $('gStage').innerHTML =
      '<div class="card gdone">' +
      '<div class="gdone-em">🎉</div>' +
      '<div class="gdone-t">' + G_NAME[gMode] + ' 끝</div>' +
      '<div class="gdone-s">' + gQueue.length + '개를 봤습니다</div>' +
      '<button class="next-btn" id="gHomeBtn">문법 홈으로</button></div>';
    $('gHomeBtn').addEventListener('click', function () { renderGramHome(); show('gram'); });
    if (global_Sync()) Sync.sync().catch(function () {});
  }

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
          '<p class="ex-jp" lang="ja">' + renderJP(ex.jp, w.word, withRuby) + '</p>' +
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
          return '<div class="gram-row"><span class="gram-form" lang="ja">' + dictHTML(r.word) +
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
    $('btnHome').addEventListener('click', function () { goBack(); });
    $('btnSearchTop').addEventListener('click', openSearch);
    $('btnSearchClose').addEventListener('click', goBack);

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
    $('btnSelUnknown').addEventListener('click', function () {
      startSession(byStage('unknown', wordsOf(selected)), dayLabel(selected) + ' · 모름');
    });
    $('btnSelShort').addEventListener('click', function () {
      startSession(byStage('short', wordsOf(selected)), dayLabel(selected) + ' · 단기기억');
    });
    $('btnSelStudy').addEventListener('click', function () {
      startSession(entriesOfDays(selected, false), dayLabel(selected));
    });
    $('btnSelDue').addEventListener('click', function () {
      startSession(entriesOfDays(selected, true), dayLabel(selected) + ' 복습');
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
    $('btnBothOk').addEventListener('click', bothOk);
    $('btnBothNo').addEventListener('click', bothNo);
    $('btnKnown').addEventListener('click', markKnown);
    $('tabWrong').addEventListener('click', function () { resultView = 'wrong'; renderResultList(); });
    $('tabAll').addEventListener('click', function () { resultView = 'all'; renderResultList(); });
    $$('.ox-btn').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.dataset.t, Number(b.dataset.v)); });
    });

    $('btnRetryWrong').addEventListener('click', function () {
      startSession(session.wrong, '틀린 단어 다시');
    });
    $('btnResultHome').addEventListener('click', function () { renderHome(); show('home'); });

    // 통계 칸을 눌러 그 단계의 단어만 학습한다. 복습일과 상관없이 원할 때 볼 수 있다.
    $('globalStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      startSession(byStage(st), STAGE_NAME[st]);
    });
    $('dayStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      startSession(byStage(st, wordsOf(currentDays)), dayLabel(currentDays) + ' · ' + STAGE_NAME[st]);
    });

    /* ----- 첫 화면 · 문법 ----- */
    $('pkVocab').addEventListener('click', function () { renderHome(); show('home'); });
    $('pkGram').addEventListener('click', function () { renderGramHome(); show('gram'); });

    $('gmLearn').addEventListener('click', renderGramChapters);
    $('gmCloze').addEventListener('click', function () {
      startGram('cloze', Store.allGram().filter(function (it) { return Store.gIsDue(it); }));
    });
    $('gmChoice').addEventListener('click', function () {
      startGram('choice', Store.allGram().filter(function (it) { return Store.gIsDue(it); }));
    });

    $('gChList').addEventListener('click', function (ev) {
      var b = ev.target.closest('.ch');
      if (!b) return;
      var g = Store.gramSections().filter(function (x) {
        return x.level + '-' + x.section === b.dataset.k;
      })[0];
      if (g) startGram('learn', g.items, g.level + ' · ' + String(g.section).padStart(2, '0'));
    });

    $('searchInput').addEventListener('input', runSearch);

    bindExpand($('dayWordList'));
    bindExpand($('searchResults'));
    bindExpand($('resultList'));

    $('btnUpload').addEventListener('click', function () { $('fileInput').click(); });
    $('btnBackup').addEventListener('click', exportBackup);

    $('btnHowTo').addEventListener('click', function () {
      $('pasteErr').hidden = true;
      pushNav();
      $('howToPanel').hidden = false;
    });
    $('btnHowToClose').addEventListener('click', goBack);
    $('howToPanel').addEventListener('click', function (ev) {
      if (ev.target === $('howToPanel')) goBack();
    });
    $('btnCopyPrompt').addEventListener('click', copyPrompt);
    $('btnPasteAdd').addEventListener('click', pasteAdd);

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
        if (ev.key === 'Escape') { ev.preventDefault(); goBack(); }
        return;
      }
      if (view !== 'study') return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!$('btnReveal').hidden) reveal();
        // 아무것도 체크하지 않은 채 Enter = 둘 다 알았음. 아는 단어는 Enter 두 번이면 지나간다.
        else if (picked.reading === null && picked.meaning === null) bothOk();
        else next();
      } else if (ev.key === '1') pick('reading', 1);
      else if (ev.key === '2') pick('reading', 0);
      else if (ev.key === '3') pick('meaning', 1);
      else if (ev.key === '4') pick('meaning', 0);
      else if (ev.key === '0') { ev.preventDefault(); bothNo(); }
      else if (ev.key === ' ') { ev.preventDefault(); reveal(); }
    });
  }

  Store.init();
  bind();
  bindSync();
  window.addEventListener('popstate', handleBack);
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, markActivity, true);
  });
  document.addEventListener('visibilitychange', markActivity);
  startClock();
  renderPick();
  show('pick');
})();
