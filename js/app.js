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
  var BUILD = 'v58';

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
    day: 'home', study: 'home', result: 'home', time: 'home', browse: 'day',
    gramCh: 'gram', gramStudy: 'gramCh', gramList: 'gram'
  };

  function handleBack() {
    navLock = true;
    try {
      // 상세 창이 덮여 있으면 앱을 나가기 전에 파고든 만큼 먼저 되돌린다.
      if (dsIsOpen()) dsPop();
      else if (!$('syncPanel').hidden) $('syncPanel').hidden = true;
      else if (!$('howToPanel').hidden) $('howToPanel').hidden = true;
      else if (searchOpen) closeSearch();
      // 돌아보는 중이면 학습을 나가지 말고 풀던 문제로 먼저 돌아온다.
      else if (view === 'study' && peek !== null) peekClose();
      else if (view === 'gramStudy' && gPeek !== null) gPeekClose();
      else if (view === 'browse') goView(browseFrom);
      // 목록에서 좁혀 들어왔으면 화면을 나가기 전에 한 단계씩 되돌린다.
      else if (view === 'day' && setStack.length) applySet(setStack.pop());
      else if (view === 'gramList' && gSetStack.length) applyGSet(gSetStack.pop());
      // 문법 학습은 챕터에서 왔는지 묶음 목록에서 왔는지에 따라 돌아갈 곳이 다르다.
      else if (view === 'gramStudy') goView(gStudyFrom || 'gramCh');
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
    $('pkVocabSub').textContent = v.total + '단어';
    $('pkGramSub').textContent  = g.total + '문형';
    $('pkVocabPct').textContent = pct(v) + '%';
    $('pkGramPct').textContent  = pct(g) + '%';
  }

  var VIEW_TITLE = {
    pick: '일본어', home: '단어', gram: '문법', day: '단어', study: '단어', browse: '단어', time: '공부 시간',
    gramCh: '문법', gramStudy: '문법', gramList: '문법'
  };

  function show(name) {
    if (name !== 'study') taStop();   // 학습을 벗어나면 시계를 멈춘다
    if (name !== 'pick' && name !== view) pushNav();
    view = name;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    $('btnHome').hidden = (name === 'pick');
    $('btnTimeTop').hidden = (name === 'study' || name === 'gramStudy' || name === 'time');
    $('selBar').hidden = !(name === 'home' && selected.length);
    document.body.classList.toggle('has-selbar', name === 'home' && !!selected.length);
    $('topTitle').textContent = VIEW_TITLE[name] || '일본어';
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
    renderDaily();
    renderPosChips();
    renderRateChips();
    renderKanjiChips();
    $$('#dirChips .chip').forEach(function (c) {
      c.classList.toggle('sel', c.dataset.dir === quizDir);
    });

    var due = Store.dueList(), weak = Store.weakList();
    // 대기가 0이면 언제 다시 뜨는지 알려준다. 안 그러면 고장난 것처럼 보인다.
    $('reviewCount').textContent = due.length
      ? due.length + '개 대기'
      : nextDueText();
    $('weakCount').textContent = weak.length + '개';
    $('btnReviewToday').disabled = !due.length;
    $('btnWeakStudy').disabled = !weak.length;

    var shaky = Store.shakyList();
    $('shakyCount').textContent = shaky.length ? shaky.length + '개' : '아직 없음';
    $('btnShakyStudy').disabled = !shaky.length;

    var slow = Store.slowList();
    $('btnSlowList').hidden = !slow.length;
    if (slow.length) $('btnSlowList').textContent = '느린 단어 ' + slow.length;

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

  // 목록 화면은 Day 뿐 아니라 품사처럼 다른 기준으로 모은 묶음도 그대로 보여준다.
  // 그래서 화면을 하나 더 만들지 않고, 무엇을 담았는지만 currentSet 에 기억해 둔다.
  var currentSet = { entries: [], label: '' };
  var setDesc = null;    // 지금 보고 있는 묶음
  var setStack = [];     // 목록에서 더 좁혀 들어오기 전의 묶음들. 뒤로가기가 한 단계씩 되돌린다.

  function renderSet(entries, title, sub, showDay, info) {
    if (!entries.length) return;
    var d = { entries: entries.slice(), title: title, sub: sub, showDay: !!showDay, info: info || '' };
    // 같은 화면에서 더 좁혀 들어가는 경우(DAY 20 → 단기기억)에는
    // 화면이 바뀌지 않아 show() 가 히스토리를 쌓지 않는다. 직접 쌓아 둔다.
    if (view === 'day' && setDesc) { setStack.push(setDesc); pushNav(); }
    else setStack = [];
    applySet(d);
  }

  function applySet(d) {
    var entries = d.entries, showDay = d.showDay;
    currentSet = { entries: entries.slice(), label: d.title };
    setDesc = d;

    $('dayHeadTitle').textContent = d.title;
    $('dayHeadSub').textContent = d.sub;
    $('dayInfo').innerHTML = d.info || '';
    $('dayInfo').hidden = !d.info;

    var s = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    entries.forEach(function (e) { s.total++; s[Store.stageFor(e.day, e.w)]++; });
    $('dayStats').innerHTML = statHTML(s, true);

    var due = entries.filter(function (e) { return Store.isDue(e.day, e.w); });
    $('dayAllCount').textContent = entries.length + '개';
    $('dayDueCount').textContent = due.length + '개';
    $('btnStudyDue').disabled = !due.length;
    // '느린 단어' 목록에서만 한꺼번에 지우는 버튼을 낸다.
    $('btnClearSlow').hidden = (d.title !== '느린 단어');

    $('dayWordList').innerHTML = entries.map(function (e) {
      return itemHTML(e.day, e.w, showDay);
    }).join('');
    show('day');
  }

  function renderDays(dayNums) {
    var entries = wordsOf(dayNums);
    if (!entries.length) return;
    currentDays = dayNums.slice();

    var titles = dayNums.map(function (n) {
      var d = Store.getDay(n);
      return d && d.title ? d.title : '';
    }).filter(Boolean);

    renderSet(entries, dayLabel(dayNums),
      (titles.length ? titles.join(' · ') + ' · ' : '') + entries.length + '단어',
      dayNums.length > 1);
  }

  /* ---------------- 품사별 모아 보기 ---------------- */
  // 부사처럼 흩어져 있으면 헷갈리는 품사를 Day 와 상관없이 한자리에 모은다.
  // '명/부' 처럼 두 품사를 겸하는 단어는 양쪽에 다 들어가야 한다. 그래서 포함 여부로 본다.
  var POS_GROUPS = [
    { key: 'noun',  label: '명사',    has: '명' },
    { key: 'verb',  label: '동사',    has: '동' },
    { key: 'i-adj', label: 'い형용사', has: 'い형' },
    { key: 'na-adj',label: 'な형용사', has: 'な형' },
    { key: 'adv',   label: '부사',    has: '부' }
  ];

  function wordsOfPos(has) {
    return Store.allWords().filter(function (e) {
      return (e.w.pos || '').indexOf(has) > -1;
    });
  }

  // 오답률로 골라 학습한다. 어느 선부터 손볼지는 그때그때 다르다.
  var RATE_STEPS = [10, 20, 30, 40, 50, 70];

  function wordsOfRate(min) {
    return Store.allWords().filter(function (e) {
      var r = Store.recOf(e.day, e.w);
      // 한 번만 본 단어는 100%든 0%든 근거가 얇다. 흔들리는 단어와 같은 기준을 쓴다.
      return (r.tries || 0) >= 2 && Store.failRate(r) * 100 >= min;
    }).sort(function (a, b) {
      return Store.failRate(Store.recOf(b.day, b.w)) - Store.failRate(Store.recOf(a.day, a.w));
    });
  }

  function renderRateChips() {
    $('rateChips').innerHTML = RATE_STEPS.map(function (m) {
      var n = wordsOfRate(m).length;
      return '<button class="chip rate-chip" data-min="' + m + '"' + (n ? '' : ' disabled') + '>' +
        m + '%↑<i>' + n + '</i></button>';
    }).join('');
  }

  /* ---------------- 한자별 모아 보기 ---------------- */
  // 같은 한자가 단어마다 다르게 읽히는 것이 헷갈림의 큰 몫이다.
  // 生活(せい) · 生きる(い) · 芝生(ふ) 를 나란히 놓고 봐야 구별이 된다.

  var kanjiMap = null;   // 한자 → 그 한자가 들어간 단어들. 2500단어를 훑으므로 한 번만 만든다.

  function kanjiIndex() {
    if (kanjiMap) return kanjiMap;
    kanjiMap = {};
    Store.allWords().forEach(function (e) {
      var seen = {};
      (String(e.w.word).match(/[一-龯々]/g) || []).forEach(function (c) {
        if (seen[c]) return;          // 한 단어에 같은 한자가 두 번 나와도 한 번만
        seen[c] = 1;
        (kanjiMap[c] = kanjiMap[c] || []).push(e);
      });
    });
    return kanjiMap;
  }

  // 읽는 법 순으로 늘어놓으면 같은 소리로 읽히는 단어끼리 붙어서 비교하기 좋다.
  function wordsOfKanji(c) {
    var list = (kanjiIndex()[c] || []).slice();
    list.sort(function (a, b) {
      return (readingOf(a.w) || a.w.word).localeCompare(readingOf(b.w) || b.w.word, 'ja');
    });
    return list;
  }

  function renderKanjiChips() {
    var map = kanjiIndex();
    // 여러 단어에 나오는 한자일수록 읽는 법이 갈릴 여지가 크다. 많은 순으로 앞에 둔다.
    var top = Object.keys(map)
      .filter(function (c) { return map[c].length >= 3; })
      .sort(function (a, b) { return map[b].length - map[a].length; })
      .slice(0, 28);
    $('kanjiChips').innerHTML = top.map(function (c) {
      return '<button class="chip kanji-chip" data-k="' + esc(c) + '">' +
        '<span lang="ja">' + esc(c) + '</span><i>' + map[c].length + '</i></button>';
    }).join('');
  }

  function openKanji(c) {
    var list = wordsOfKanji(c);
    if (!list.length) return;
    currentDays = [];
    renderSet(list, '한자 ' + c, list.length + '단어 · 읽는 법 순', true, kanjiInfoHTML(c));
  }

  /* ---------------- 한자 한 글자의 사전 정보 ---------------- */
  // 자료는 data/kanji.js (build-kanji.ps1 이 KANJIDIC2·KRADFILE 에서 만든다).

  function kanjiDict(c) {
    var d = window.KANJI_DICT;
    return (d && d.kanji && d.kanji[c]) || null;
  }

  // 사전에는 음독이 가타카나로 들어 있다. 단어를 읽을 때 눈에 익은 히라가나로 바꿔 준다.
  function toHira(s) {
    return String(s).replace(/[ァ-ヶ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  // 훈독의 점은 오쿠리가나가 시작하는 자리다. 지워 버리면 어디까지가 한자인지 알 수 없다.
  // 점을 빼는 대신 뒷부분을 흐리게 두어 경계가 그대로 보이게 한다.
  function kunHTML(k) {
    var s = String(k), i = s.indexOf('.');
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + '<span class="ki-oku">' + esc(s.slice(i + 1)) + '</span>';
  }

  // 부수와 조각은 눌러서 건너뛸 수 있어야 그물이 된다.
  // 사전에 있고 실제로 쓰인 단어가 있는 것만 누를 수 있게 한다.
  function kanjiLink(ch) {
    var live = kanjiDict(ch) && (kanjiIndex()[ch] || []).length;
    if (!live) return '<span class="ki-part off" lang="ja">' + esc(ch) + '</span>';
    return '<button type="button" class="ki-part" lang="ja" data-k="' + esc(ch) + '">' + esc(ch) + '</button>';
  }

  // 뜻은 한국어가 본체다. 옮기지 못한 한자가 나오면 그때만 영어를 보여준다.
  function kiMeanHTML(k) {
    if (k.mean && k.mean.length) {
      return '<div class="ki-en">' + esc(k.mean.join(', ')) + '</div>';
    }
    if (k.en && k.en.length) {
      return '<div class="ki-en en">' + esc(k.en.join(', ')) + '</div>';
    }
    return '';
  }

  function kiRow(label, html) {
    return '<div class="ki-row"><span class="ki-label">' + label + '</span>' +
           '<span class="ki-value">' + html + '</span></div>';
  }

  function kanjiInfoHTML(c) {
    var k = kanjiDict(c);
    if (!k) return '';

    var tags = [];
    if (k.st) tags.push(k.st + '획');
    if (k.jl) tags.push('N' + k.jl);
    if (k.fq) tags.push('빈도 ' + k.fq);

    var rows = '';
    if (k.on && k.on.length) {
      rows += kiRow('음독', '<span lang="ja">' +
        k.on.map(function (x) { return esc(toHira(x)); }).join(', ') + '</span>');
    }
    if (k.kun && k.kun.length) {
      rows += kiRow('훈독', '<span lang="ja">' + k.kun.map(kunHTML).join(', ') + '</span>');
    }
    if (k.radc) {
      rows += kiRow('부수', kanjiLink(k.radc) +
        '<span class="ki-radko">' + esc(k.radko || '') + '</span>');
    }
    // 조각이 저 자신 하나뿐이면 쪼갤 것이 없다는 뜻이라 줄을 낸다.
    if (k.parts && k.parts.length > 1) {
      rows += kiRow('조각', k.parts.map(kanjiLink).join(''));
    }

    return '<div class="ki-top">' +
             '<div class="ki-char" lang="ja">' + esc(c) + '</div>' +
             '<div class="ki-head">' +
               (k.ko && k.ko.length ? '<div class="ki-ko">' + esc(k.ko.join(', ')) + '</div>' : '') +
               (tags.length ? '<div class="ki-tags">' + esc(tags.join(' · ')) + '</div>' : '') +
               kiMeanHTML(k) +
             '</div>' +
           '</div>' + rows;
  }

  function renderPosChips() {
    $('posChips').innerHTML = POS_GROUPS.map(function (g) {
      var n = wordsOfPos(g.has).length;
      if (!n) return '';
      return '<button class="chip pos-chip pos-' + g.key + '" data-has="' + esc(g.has) + '">' +
        esc(g.label) + '<i>' + n + '</i></button>';
    }).join('');
  }

  // 시험 기록. 왼쪽이 오래된 것, 오른쪽이 최근 것이다.
  //   ● 둘 다 맞음 · ◐ 하나만 맞음 · ○ 둘 다 틀림
  function histHTML(r, key) {
    if (!r.tries) return '';
    var marks = (r.hist || '').split('').map(function (c) {
      return '<i class="hm h' + c + '"></i>';
    }).join('');
    // 오답률이 흔들리는 단어의 기준이므로 그대로 보여준다.
    var txt = [(r.fails || 0)
      ? r.tries + '번 중 ' + r.fails + '번 틀림 · 오답률 ' + Math.round(Store.failRate(r) * 100) + '%'
      : r.tries + '번 다 맞음'];
    if (r.lapse) txt.push('장기기억에서 ' + r.lapse + '번 떨어짐');
    // 왜 이 단계에 있는지 따져 볼 수 있게 레벨과 다음 복습일을 같이 적는다.
    txt.push('Lv.' + (r.level || 0));
    if (r.due) {
      var ms = Store.dueMs(r) - Date.now();
      txt.push(ms <= 0 ? '복습 대기'
        : (ms < 86400000 ? '복습 ' + Math.max(1, Math.round(ms / 3600000)) + '시간 뒤'
                         : '복습 ' + Math.round(ms / 86400000) + '일 뒤'));
    }
    // 시간초과는 손이 미끄러지거나 키보드가 먹통이 돼도 찍힌다. 지울 수 있어야 한다.
    var slow = (r.slow && key)
      ? '<span class="slow-tag">시간초과 ' + r.slow + '번' +
        '<button class="slow-x" data-slow="' + esc(key) + '" title="이 기록 지우기">✕</button></span>'
      : '';
    return '<div class="hist">' + marks +
      '<span class="hist-txt">' + txt.join(' · ') + '</span>' + slow + '</div>' + logHTML(r);
  }

  // 채점 하나하나를 시각과 함께 보여준다. 최근 것이 위에 온다.
  var LOG_MODE = ['일 → 한', '한 → 일', '빈칸', '4지선다', '타임어택'];

  function logHTML(r) {
    var rows = Store.logEntries(r).filter(function (x) { return x.t; });
    if (!rows.length) return '';
    return '<div class="log">' + rows.slice().reverse().map(function (x) {
      var d = new Date(x.t);
      var when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      var mark = x.code === 9 ? '＋' : (x.code === 2 ? 'O' : (x.code === 1 ? '△' : 'X'));
      var cls = x.code === 0 ? 'n' : (x.code === 1 ? 'p' : 'y');
      return '<div class="log-row"><span class="lt">' + when + '</span>' +
        '<span class="lc ' + cls + '">' + mark + '</span>' +
        '<span class="lm">' + (x.code === 9 ? '아는 단어' : LOG_MODE[x.mode] || '') +
          (x.onTime === false ? ' · 미리' : (x.onTime ? ' · 복습일' : '')) + '</span></div>';
    }).join('') + '</div>';
  }

  // 목록 한 줄에 오답률을 같이 띄운다. 펼치지 않아도 어느 게 문제인지 보이게.
  function rateHTML(r) {
    if (!r.tries) return '';
    var p = Math.round(Store.failRate(r) * 100);
    return '<span class="wl-rate' + (p >= 50 ? ' hi' : (p > 0 ? ' mid' : '')) + '">' + p + '%</span>';
  }

  function itemHTML(day, w, showDay) {
    var st = Store.stageFor(day, w);
    var r = Store.recOf(day, w);
    var detail = histHTML(r, Store.keyOf(day, w)) + detailHTML(w, true);
    return '<div class="wl-item' + (detail ? ' has-detail' : '') + '"' +
        (detail ? ' role="button" tabindex="0"' : '') + '>' +
      '<div class="wl-head">' +
        '<span class="wl-dot dot-' + st + '"></span>' +
        '<span class="wl-main">' +
          '<span class="wl-word" lang="ja">' + dictHTML(w.word) +
            (readingOf(w) ? '<span class="wl-reading">' + esc(readingOf(w)) + '</span>' : '') + posHTML(w.pos) +
          '</span>' +
          '<div class="wl-meaning">' + esc(w.meaning) + '</div>' +
        '</span>' +
        '<span class="wl-side">' + Store.STAGE_LABEL[st] + rateHTML(r) +
          (showDay ? '<span class="wl-day">DAY ' + day + '</span>' : (r.seen ? '<span class="wl-day">Lv.' + r.level + '</span>' : '')) +
        '</span>' +
        (detail ? '<span class="wl-caret">▾</span>' : '') +
      '</div>' +
      (detail ? '<div class="wl-detail" hidden>' + detail + '</div>' : '') +
    '</div>';
  }

  // 단어 항목을 누르면 예문이 펼쳐진다.
  // 기록을 지운 뒤 지금 보고 있는 목록을 다시 그린다.
  // '느린 단어' 처럼 목록 자체가 조건으로 만들어진 것은 항목이 빠져야 한다.
  function refreshCurrentList() {
    if (view !== 'day' || !setDesc) return;
    if (setDesc.title === '느린 단어') {
      var list = Store.slowList();
      if (!list.length) { renderHome(); show('home'); return; }
      applyGSetLike(list);
      return;
    }
    applySet(setDesc);
  }

  function applyGSetLike(list) {
    applySet({ entries: list, title: '느린 단어',
               sub: list.length + '단어 · 제한시간을 넘긴 것', showDay: true });
  }

  function bindExpand(container) {
    container.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return; // 사전 링크는 펼침과 무관하게 동작
      // 시간초과 기록 지우기. 펼침이 같이 동작하지 않게 여기서 끊는다.
      var x = ev.target.closest('.slow-x');
      if (x) {
        ev.stopPropagation();
        Store.clearSlowKey(x.dataset.slow);
        if (global_Sync()) Sync.touch();
        refreshCurrentList();
        return;
      }
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

  /* ---------------- 넘기며 보기 ---------------- */
  // 목록을 훑는 대신 한 단어씩 넘겨 가며 읽는 화면. 채점하지 않고 진도도 건드리지 않는다.
  // 시험이 아니므로 순서는 섞지 않고 책 순서 그대로 두고, 읽는 법과 예문을 처음부터 보여준다.

  var browse = null;   // { list, index, label }

  var browseFrom = 'day';   // 넘기며 보기를 연 화면. 뒤로가기가 그 자리로 돌아간다.

  function startBrowse(entries, label) {
    if (!entries.length) return;
    browseFrom = (view === 'result') ? 'result' : 'day';
    browse = { list: entries.slice(), index: 0, label: label };
    show('browse');
    renderBrowseCard();
  }

  function renderBrowseCard() {
    var e = browse.list[browse.index];
    var st = Store.stageFor(e.day, e.w);
    var detail = histHTML(Store.recOf(e.day, e.w)) + detailHTML(e.w, true);

    $('brStage').innerHTML =
      '<div class="card">' +
        '<div class="card-meta">' +
          '<span class="badge ' + st + '">' + Store.STAGE_LABEL[st] + '</span>' +
          '<span class="card-no">DAY ' + e.day + (e.w.no ? ' · ' + e.w.no : '') + '</span>' +
        '</div>' +
        '<div class="jp-word" lang="ja">' + dictHTML(e.w.word, 'big') + '</div>' +
        '<div class="answer-box">' +
          '<div class="ans-row"><span class="ans-label">읽는 법</span>' +
            '<span class="ans-value reading" lang="ja">' + esc(readingOf(e.w) || e.w.word) + '</span></div>' +
          '<div class="ans-row"><span class="ans-label">뜻</span>' +
            '<span class="ans-value">' + posHTML(e.w.pos) + esc(e.w.meaning) + '</span></div>' +
        '</div>' +
        (detail ? '<div class="detail-box">' + detail + '</div>' : '') +
      '</div>';

    var n = browse.list.length;
    $('brCount').textContent = (browse.index + 1) + ' / ' + n;
    $('brLabel').textContent = browse.label;
    $('brFill').style.width = ((browse.index + 1) / n * 100) + '%';
    $('brPrev').disabled = browse.index === 0;
    $('brNext').textContent = (browse.index === n - 1) ? '목록으로' : '다음';
    window.scrollTo(0, 0);
  }

  function browseGo(step) {
    if (!browse) return;
    var i = browse.index + step;
    if (i < 0) return;
    if (i >= browse.list.length) { goView(browseFrom); return; }
    browse.index = i;
    renderBrowseCard();
  }

  /* ---------------- 학습 중 상세 보기 ---------------- */
  // 시험을 멈추지 않고 단어를 뜯어본다. 화면을 옮기는 대신 카드 위에 덮는다.
  // 옮겨 버리면 돌아왔을 때 정답을 봤는지 O 를 눌렀는지가 다 풀려 버린다.
  //
  // 단어 → 한자 → 그 한자를 쓰는 다른 단어 → 또 그 한자 … 로 계속 파고들 수 있고,
  // 들어간 만큼 ← 로 되돌아온다.

  var dsStack = [];    // 파고든 순서
  var dsWords = [];    // 지금 목록에 뜬 단어들. 눌렀을 때 이 배열에서 찾는다.

  function dsIsOpen() { return !$('detailSheet').hidden; }

  // 창이 열려 있는 동안 히스토리 한 칸을 계속 쥐고 있는다.
  // 폰의 뒤로가기가 앱을 나가는 대신 이 창의 한 단계를 무르게 하려는 것이다.
  // handleBack 안에서는 pushNav 가 navLock 에 막히므로 여기서는 직접 쌓는다.
  function dsArm() {
    try { history.pushState({ jv: 1, ds: 1 }, ''); } catch (e) {}
  }

  function dsShow(item) {
    dsStack = [item];
    dsRender();
    $('detailSheet').hidden = false;
    dsArm();
  }

  function dsOpen(w) { dsShow({ t: 'word', w: w }); }

  // 더 파고들 때는 히스토리를 더 쌓지 않는다. 쥐고 있는 한 칸을 계속 돌려 쓴다.
  function dsPush(item) {
    dsStack.push(item);
    dsRender();
  }

  // 뒤로가기 한 번. 폰의 뒤로가기도, 창 안의 ← 도, Escape 도 결국 여기로 온다.
  function dsPop() {
    if (dsStack.length > 1) {
      dsStack.pop();
      dsRender();
      dsArm();          // 아직 열려 있으니 다음 뒤로가기 몫을 다시 쥔다
    } else {
      dsHide();         // 마지막 장이었다. 쥐고 있던 칸을 놓아준다
    }
  }

  // 화면만 닫는다. 히스토리는 건드리지 않는다.
  function dsHide() {
    $('detailSheet').hidden = true;
    dsStack = [];
    dsWords = [];
  }

  // 통째로 닫기. 몇 단계를 파고들었든 쥐고 있는 칸은 하나뿐이라,
  // 마지막 한 장만 남겨 두고 뒤로가기를 한 번 부르면 그 칸까지 깔끔히 정리된다.
  function dsCloseAll() {
    if (!dsIsOpen()) return;
    dsStack = dsStack.slice(0, 1);
    goBack();
  }

  function dsRender() {
    var s = dsStack[dsStack.length - 1];
    $('btnDsBack').hidden = dsStack.length <= 1;

    if (s.t === 'word') {
      dsWords = [];
      $('dsTitle').textContent = s.w.word;
      $('dsBody').innerHTML =
        '<div class="ds-word">' +
          '<div class="ds-jp" lang="ja">' + esc(s.w.word) + '</div>' +
          '<div class="ds-read" lang="ja">' + esc(readingOf(s.w) || '') + '</div>' +
          '<div class="ds-mean">' + posHTML(s.w.pos) + esc(s.w.meaning) + '</div>' +
        '</div>' +
        '<div class="detail-box">' + detailHTML(s.w, true) + '</div>';
    } else {
      dsWords = wordsOfKanji(s.k);
      $('dsTitle').textContent = '한자 ' + s.k;
      $('dsBody').innerHTML =
        kanjiInfoHTML(s.k) +
        '<div class="ds-head">이 한자를 쓰는 단어 ' + dsWords.length + '</div>' +
        '<div class="ds-list">' + dsWords.map(function (e, i) {
          return '<button type="button" class="ds-item" data-i="' + i + '">' +
            '<span class="ds-item-w" lang="ja">' + esc(e.w.word) + '</span>' +
            '<span class="ds-item-r" lang="ja">' + esc(readingOf(e.w) || '') + '</span>' +
            '<span class="ds-item-m">' + esc(e.w.meaning) + '</span>' +
          '</button>';
        }).join('') + '</div>';
    }
    $('dsBody').scrollTop = 0;
  }

  /* ---------------- 잠깐 뜨는 안내 ---------------- */
  // 바퀴가 넘어가는 것처럼 알아야 하지만 손을 멈출 필요는 없는 일에 쓴다.

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    // 다시 그리기를 한 번 거쳐야 애니메이션이 처음부터 돈다.
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('on');
      setTimeout(function () { el.hidden = true; }, 250);
    }, 2200);
  }

  /* ---------------- 오늘 학습 ---------------- */
  // 매번 Day 를 고르는 것 자체가 일이다. 개수만 정해 두면 앱이 알아서 짠다.
  // 복습이 먼저다. 새 단어를 아무리 넣어도 복습을 놓치면 남는 것이 없다.

  var DAILY_KEY = 'jvocab.daily';
  var dailyCount = 30;
  try { dailyCount = Number(localStorage.getItem(DAILY_KEY)) || 30; } catch (e) {}

  function dailyPlan(n) {
    var due = Store.dueList().slice(0, n);
    var fresh = [];
    if (due.length < n) {
      fresh = Store.allWords().filter(function (e) {
        return Store.stageFor(e.day, e.w) === 'new';
      }).slice(0, n - due.length);
    }
    return { due: due, fresh: fresh, all: due.concat(fresh) };
  }

  function renderDaily() {
    var p = dailyPlan(dailyCount);
    $('dailyMix').textContent = p.all.length
      ? '복습 ' + p.due.length + ' · 새 단어 ' + p.fresh.length
      : '오늘 할 것이 없습니다';
    $('btnDailyStudy').disabled = !p.all.length;
    $$('#dailyCounts .chip').forEach(function (c) {
      c.classList.toggle('sel', Number(c.dataset.n) === dailyCount);
    });
  }

  /* ---------------- 학습 ---------------- */

  function startSession(entries, label, timed) {
    if (!entries.length) return;
    session = {
      queue: shuffle(entries.slice()),
      retry: [],                  // 이 바퀴에서 틀려 다음 바퀴로 넘길 것
      index: 0,
      total: entries.length,      // 목표 개수. 다시 낸다고 늘지 않는다
      done: 0,                    // 맞혀서 끝낸 개수
      lap: 1,
      miss: {},                   // 이 판에서 틀린 단어와 횟수
      label: label,
      // 타임어택은 일본어 → 뜻 으로만 낸다. 타자 속도가 섞이면 무엇을 잰 건지 알 수 없다.
      dir: timed ? 'jp2ko' : quizDir,
      timed: timed || 0,
      slow: 0,
      results: []
    };
    persistSession();
    show('study');
    renderCard();
  }

  /* ---------------- 틀린 단어는 이 판을 못 떠난다 ---------------- */
  // 판이 끝난 뒤에 몰아서 다시 보면 이미 잊은 뒤다. 맞힐 때까지 그 자리에서 다시 낸다.
  // 타임어택은 속도를 재는 판이라 예외다. 진도를 건드리지 않으므로 다시 내지도 않는다.

  function sessKey(e) { return e.day + '|' + (e.w.no || 0) + '|' + e.w.word; }

  function settle(e, ok) {
    if (ok) { session.done++; return; }
    session.miss[sessKey(e)] = (session.miss[sessKey(e)] || 0) + 1;
    session.retry.push(e);
  }

  /* ---------------- 학습 이어하기 ---------------- */

  function refOf(e) { return { d: e.day, n: e.w.no, w: e.w.word }; }

  function persistSession() {
    if (!session) return;
    Store.saveSession({
      label: session.label,
      dir: session.dir || 'jp2ko',
      index: session.index,
      total: session.total,
      done: session.done,
      lap: session.lap,
      miss: session.miss,
      timed: session.timed,
      queue: session.queue.map(refOf),
      retry: (session.retry || []).map(refOf),
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

    var retry = [];
    (s.retry || []).forEach(function (ref) {
      var e = hydrate(ref);
      if (e) retry.push(e);
    });

    // 옛 판에는 목표·진행이 없다. 남은 큐 길이로 메워 두면 이어하기가 깨지지 않는다.
    var total = s.total || (queue.length + retry.length);
    return {
      queue: queue, retry: retry, index: index,
      total: total,
      done: typeof s.done === 'number' ? s.done : index,
      lap: s.lap || 1,
      miss: s.miss || {},
      timed: s.timed || 0,
      slow: 0,
      label: s.label || '학습', dir: s.dir || 'jp2ko', results: results
    };
  }

  function renderResume() {
    var s = restoreSession();
    $('btnResume').hidden = !s;
    if (s) {
      $('resumeInfo').textContent = s.label + ' · ' + s.done + ' / ' + s.total;
    }
  }

  function entriesOfDays(dayNums, onlyDue) {
    return wordsOf(dayNums).filter(function (e) { return !onlyDue || Store.isDue(e.day, e.w); });
  }

  var picked = { reading: null, meaning: null };

  function renderCard() {
    if (peek !== null) peekClose();
    if (session.dir === 'ko2jp') { renderRevCard(); return; }
    $('revStage').hidden = true;
    $('card').hidden = false;
    var e = session.queue[session.index];
    var st = Store.stageFor(e.day, e.w);

    $('cardBadge').textContent = Store.STAGE_LABEL[st];
    $('cardBadge').className = 'badge ' + st;
    $('cardNo').textContent = 'DAY ' + e.day + (e.w.no ? ' · ' + e.w.no : '');
    $('jpWord').innerHTML = dictHTML(e.w.word, 'big');
    $('ansReading').textContent = readingOf(e.w) || e.w.word;
    $('ansMeaning').innerHTML = posHTML(e.w.pos) + esc(e.w.meaning);
    // 문제를 푸는 중에는 예문에 읽는 법이 보이면 안 되므로 한자 그대로 둔다.
    // 예문 자체는 힌트로 계속 보여주고, 해석·문형만 quiz 클래스로 가린다.
    $('detailBox').innerHTML = detailHTML(e.w, false);
    $('detailBox').className = 'detail-box quiz';
    $('detailBox').hidden = !$('detailBox').innerHTML;

    $('answerBox').hidden = true;
    $('checkBox').hidden = true;
    $('btnReveal').hidden = false;
    // 카드가 바뀌면 열려 있던 상세 창은 앞 단어의 것이라 닫는다.
    if (dsIsOpen()) dsHide();
    $('btnCardDetail').hidden = true;
    $('btnNext').hidden = true;
    $('btnNext').disabled = true;
    picked.reading = null; picked.meaning = null;
    $$('.ox-btn').forEach(function (b) { b.classList.remove('sel'); });

    renderProgressText();
    renderGap(e);
    taBegin();
  }

  /* ---------------- 다음에 언제 다시 나오는지 ---------------- */
  // 누르기 전에 결과가 보이면 판단이 빨라진다. O 를 눌러 놓고 '그래서 언제?' 를
  // 다시 찾아볼 일이 없어진다.

  function gapDayLabel(d) {
    if (d <= 0) return '오늘 다시';
    if (d === 1) return '내일';
    return d + '일 후';
  }

  function gapHourLabel(h) {
    return h > 0 ? h + '시간 후' : '내일';
  }

  function renderGap(e) {
    var g = session.timed ? null : Store.gapPreview(e.day, e.w);
    // 복습일 전에 미리 푸는 판은 일정을 건드리지 않는다. 방금 틀려서 다시 나온 단어가 그렇다.
    // 빈칸으로 두면 고장난 것처럼 보이므로 왜 비었는지를 적는다.
    $('gapOk').textContent = g ? gapDayLabel(g.okDays) : '그대로';
    $('gapOk').className = 'ox-gap' + (g && g.okLong ? ' long' : '');
    $('gapNo').textContent = g ? gapHourLabel(g.noHours) : '그대로';
    $('gapNo').className = 'ox-gap';
  }

  function reveal(timedOut) {
    if (!$('btnReveal').hidden) {
      taStop();   // 떠올린 순간 시계를 멈춘다
      if (timedOut) {
        $('taBar').hidden = false;
        $('taFill').style.width = '100%';
        $('taFill').className = 'out';
      }
      $('btnReveal').hidden = true;
      $('btnNext').hidden = false;
      $('answerBox').hidden = false;
      // 정답을 봤으니 예문을 후리가나까지 붙여 다시 그린다.
      // 문제를 푸는 동안에는 읽는 법이 새면 안 되므로 한자만 보여줬다.
      var e = session.queue[session.index];
      $('detailBox').innerHTML = detailHTML(e.w, true);
      $('detailBox').className = 'detail-box'; // 해석·문형 공개
      $('checkBox').hidden = false;
      $('btnCardDetail').hidden = false;
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
  // 정답을 보기 전에도 누를 수 있다. 단어를 보고 바로 안다 싶으면 그게 제일 빠르다.
  function markKnown() {
    // 타임어택은 진도를 건드리지 않는 판이다. 아는 단어 처리도 여기서는 막는다.
    if (!session || peek !== null || session.timed) return;
    var e = session.queue[session.index];
    var rec = Store.markKnown(e.day, e.w);
    session.results.push({ day: e.day, w: e.w, r: true, m: true, level: rec.level, known: true });
    settle(e, true);
    advance();
  }

  /* ---------------- 타임어택 ---------------- */
  // 속도는 기억이 얼마나 자동화됐는지를 보여준다. 4초 걸려 떠오르는 단어는
  // 문장 속에서는 못 잡고, 청해는 기다려 주지 않는다.
  //
  // 두 가지를 지킨다.
  //   ① 이미 익힌 단어에만 건다. 모르는 단어에 시간을 재면 떠올리려는 시도 자체를
  //      잘라 버려서, 시험의 학습 효과가 날아간다.
  //   ② 시간초과를 오답으로 치지 않는다. 아는데 느린 것과 모르는 것은 다른 문제다.
  //      따로 세어 '느린 단어'로 모아 준다.
  var taSec = 5;
  var taTimer = null, taStart = 0;

  function taStop() {
    if (taTimer) { clearInterval(taTimer); taTimer = null; }
    $('taBar').hidden = true;
  }

  // 떠올리는 동안에만 잰다. 정답을 본 뒤 O/X 를 고르는 시간은 재지 않는다.
  function taBegin() {
    taStop();
    if (!session || !session.timed) return;
    $('taBar').hidden = false;
    $('taFill').style.width = '100%';
    $('taFill').className = '';
    taStart = Date.now();
    taTimer = setInterval(function () {
      var left = session.timed * 1000 - (Date.now() - taStart);
      if (left <= 0) { taTimeUp(); return; }
      var pct = left / (session.timed * 1000) * 100;
      $('taFill').style.width = pct + '%';
      $('taFill').className = pct < 30 ? 'hot' : '';
    }, 50);
  }

  function taTimeUp() {
    taStop();
    var e = session.queue[session.index];
    Store.markSlow(e.day, e.w);
    session.slow = (session.slow || 0) + 1;
    reveal(true);
  }

  /* ---------------- 뜻 → 일본어 (직접 입력) ---------------- */
  // 일본어를 보고 뜻을 떠올리는 것과, 뜻을 보고 일본어를 꺼내는 것은 다른 능력이다.
  // 앞의 것만 하면 읽을 줄은 알아도 쓰지는 못한다.
  // 한자로 쓰든 읽는 법으로 쓰든 그 단어를 꺼낸 것이므로 둘 다 정답으로 본다.

  var DIR_KEY = 'jvocab.dir.v1';
  var quizDir = 'jp2ko';
  try { quizDir = localStorage.getItem(DIR_KEY) || 'jp2ko'; } catch (e) {}

  var revTyped = '', revGraded = null;   // null | 'right' | 'wrong' | 'skip'

  function jpAnswers(w) {
    var out = [String(w.word || '').trim()];
    var r = (w.reading || '').trim();
    // 한 단어에 읽는 법이 여럿인 것이 있다 (四 = し/よん).
    if (r && r !== '-' && r !== '―') {
      r.split(/[\/・,、|]/).forEach(function (x) { if (x.trim()) out.push(x.trim()); });
    }
    return out.filter(Boolean);
  }

  function checkJP(typed, w) {
    var t = normAns(typed);
    if (!t) return false;
    return jpAnswers(w).some(function (a) { return normAns(a) === t; });
  }

  function renderRevCard() {
    var e = session.queue[session.index], w = e.w;
    var st = Store.stageFor(e.day, e.w);
    var h = '<div class="card">' +
      '<div class="card-meta">' +
        '<span class="badge ' + st + '">' + Store.STAGE_LABEL[st] + '</span>' +
        '<span class="card-no">DAY ' + e.day + (w.no ? ' · ' + w.no : '') + '</span>' +
      '</div>' +
      '<div class="rev-ko">' + posHTML(w.pos) + esc(w.meaning) + '</div>';

    if (!revGraded) {
      // 예문에는 그 단어가 그대로 들어 있어 정답이 새므로 채점 전에는 감춘다.
      h += '<input class="ginp" id="revAns" lang="ja" placeholder="일본어로 쓰기 (한자 · 읽는 법 모두 정답)" ' +
           'autocomplete="off" autocapitalize="off" spellcheck="false">' +
           '<button class="next-btn" id="revSubmit">확인</button>' +
           '<button class="known-btn" id="revSkip">모르겠어요 · 정답 보기</button>';
    } else {
      var ok = (revGraded === 'right');
      h += '<div class="gjudge ' + (revGraded === 'skip' ? 'skip' : (ok ? 'right' : 'wrong')) + '">' +
           (revGraded === 'skip' ? '정답을 확인하세요' : (ok ? '정답입니다' : '틀렸습니다')) + '</div>';
      if (revTyped && !ok)
        h += '<div class="gcmp"><span class="cl">내 답</span>' +
             '<span class="cv bad" lang="ja">' + esc(revTyped) + '</span></div>';
      h += '<div class="answer-box">' +
        '<div class="ans-row"><span class="ans-label">단어</span>' +
          '<span class="ans-value" lang="ja">' + dictHTML(w.word) + '</span></div>' +
        '<div class="ans-row"><span class="ans-label">읽는 법</span>' +
          '<span class="ans-value reading" lang="ja">' + esc(readingOf(w) || w.word) + '</span></div>' +
        '</div>';
      var detail = detailHTML(w, true);
      if (detail) h += '<div class="detail-box">' + detail + '</div>';
      h += '<button class="next-btn" id="revNext">다음 <kbd>Enter</kbd></button>';
      if (!ok) h += '<button class="known-btn" id="revOverride">이것도 맞아요 · 정답 처리</button>';
    }
    h += '</div>';

    $('revStage').innerHTML = h;
    $('revStage').hidden = false;
    $('card').hidden = true;

    if ($('revAns')) {
      $('revAns').focus();
      $('revAns').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.isComposing) {
          ev.preventDefault(); ev.stopPropagation(); revSubmit(false);
        }
      });
    }
    if ($('revSubmit')) $('revSubmit').addEventListener('click', function () { revSubmit(false); });
    if ($('revSkip'))   $('revSkip').addEventListener('click', function () { revSubmit(true); });
    if ($('revNext'))   $('revNext').addEventListener('click', revNext);
    if ($('revOverride')) $('revOverride').addEventListener('click', function () {
      revGraded = 'right'; renderRevCard();
    });

    renderProgressText();
    $('studyLabel').textContent = session.label + ' · 뜻 → 일본어' +
      (session.lap > 1 ? ' · ' + session.lap + '바퀴' : '');
  }

  function revSubmit(skip) {
    var w = session.queue[session.index].w;
    var el = $('revAns');
    revTyped = el ? el.value.trim() : '';
    if (skip) revGraded = 'skip';
    else if (!revTyped) { if (el) el.focus(); return; }
    else revGraded = checkJP(revTyped, w) ? 'right' : 'wrong';
    renderRevCard();
  }

  function revNext() {
    if (!revGraded) return;
    var e = session.queue[session.index];
    var ok = (revGraded === 'right');
    var rec = Store.grade(e.day, e.w, ok, ok, 'ko2jp');
    session.results.push({ day: e.day, w: e.w, r: ok, m: ok, level: rec.level });
    settle(e, ok);
    revTyped = ''; revGraded = null;
    advance();
  }

  /* ---------------- 이미 푼 단어 돌아보기 ---------------- */
  // 다음으로 넘어가면 방금 본 단어를 다시 못 봐서 답답하다는 요청.
  // 채점은 이미 끝났으므로 여기서는 점수를 건드리지 않고 보여주기만 한다.

  var peek = null;   // 돌아보는 중이면 session.results 의 인덱스

  function peekOpen(i) {
    if (!session || !session.results.length) return;
    peek = Math.max(0, Math.min(i, session.results.length - 1));
    renderPeek();
  }

  function peekClose() {
    peek = null;
    $('peekStage').hidden = true;
    $('card').hidden = false;
    renderProgressText();
  }

  // 뒤로 가면 더 예전 단어, 앞으로 가면 결국 풀던 문제로 돌아온다.
  function peekGo(step) {
    if (peek === null) return;
    var i = peek + step;
    if (i < 0) return;
    if (i >= session.results.length) { peekClose(); return; }
    peek = i;
    renderPeek();
  }

  function renderPeek() {
    var x = session.results[peek];
    var st = Store.stageFor(x.day, x.w);
    var mark = x.known ? '아는 단어로 넘김'
      : '읽는 법 ' + (x.r ? 'O' : 'X') + ' · 뜻 ' + (x.m ? 'O' : 'X');
    var detail = detailHTML(x.w, true);

    $('peekStage').innerHTML =
      '<div class="card">' +
        '<div class="card-meta">' +
          '<span class="badge ' + st + '">' + Store.STAGE_LABEL[st] + '</span>' +
          '<span class="card-no">DAY ' + x.day + (x.w.no ? ' · ' + x.w.no : '') + '</span>' +
        '</div>' +
        '<div class="jp-word" lang="ja">' + dictHTML(x.w.word, 'big') + '</div>' +
        '<div class="answer-box">' +
          '<div class="ans-row"><span class="ans-label">읽는 법</span>' +
            '<span class="ans-value reading" lang="ja">' + esc(readingOf(x.w) || x.w.word) + '</span></div>' +
          '<div class="ans-row"><span class="ans-label">뜻</span>' +
            '<span class="ans-value">' + posHTML(x.w.pos) + esc(x.w.meaning) + '</span></div>' +
          '<div class="ans-row"><span class="ans-label">내 답</span>' +
            '<span class="peek-mark' + (x.r && x.m ? ' ok' : ' no') + '">' + mark + '</span></div>' +
        '</div>' +
        (detail ? '<div class="detail-box">' + detail + '</div>' : '') +
        '<div class="br-nav">' +
          '<button class="br-btn" id="peekPrev"' + (peek === 0 ? ' disabled' : '') + '>이전</button>' +
          '<button class="br-btn primary" id="peekNext">' +
            (peek === session.results.length - 1 ? '문제로 돌아가기' : '다음') + '</button>' +
        '</div>' +
      '</div>';

    $('peekStage').hidden = false;
    $('card').hidden = true;
    $('peekPrev').addEventListener('click', function () { peekGo(-1); });
    $('peekNext').addEventListener('click', function () { peekGo(1); });

    $('progressText').textContent = '돌아보기 ' + (peek + 1) + ' / ' + session.results.length;
    window.scrollTo(0, 0);
  }

  // 진행은 '맞혀서 끝낸 개수 / 목표'다. 틀려서 다시 낸다고 목표가 늘지는 않는다.
  function renderProgressText() {
    if (!session) return;
    $('progressText').textContent = session.done + ' / ' + session.total;
    $('studyLabel').textContent = session.label +
      (session.lap > 1 ? ' · ' + session.lap + '바퀴' : '');
    $('progressFill').style.width = (session.done / session.total * 100) + '%';
  }

  /* ---------------- 좌우로 밀어서 넘기기 ---------------- */
  // 폰에서 버튼을 찾아 누르는 것보다 미는 게 빠르다.
  // 세로로 더 움직였으면 화면을 스크롤하려는 것이므로 넘기지 않는다.
  function bindSwipe(el, onLeft, onRight) {
    var x0 = 0, y0 = 0, t0 = 0, live = false;
    el.addEventListener('touchstart', function (ev) {
      live = (ev.touches.length === 1);
      if (!live) return;
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', function (ev) {
      if (!live) return;
      live = false;
      var t = ev.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > 800) return;              // 오래 끌었으면 스크롤이나 길게 누르기
      if (Math.abs(dx) < 60) return;                  // 짧으면 탭
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;  // 세로가 더 크면 스크롤
      if (dx < 0) onLeft(); else onRight();
    }, { passive: true });
  }

  function next() {
    if (picked.reading === null || picked.meaning === null) return;
    var e = session.queue[session.index];
    var ok = (picked.reading === 1 && picked.meaning === 1);
    var rec = Store.grade(e.day, e.w, picked.reading === 1, picked.meaning === 1,
      session.timed ? 'timed' : 'jp2ko', !!session.timed);
    session.results.push({ day: e.day, w: e.w, r: picked.reading === 1, m: picked.meaning === 1, level: rec.level });
    settle(e, ok || !!session.timed);
    advance();
  }

  function advance() {
    session.index++;
    // 한 바퀴를 다 돌았는데 남은 것이 있으면 섞어서 다시 낸다.
    // 순서를 그대로 두면 앞 단어의 잔상으로 맞히게 되어 시험이 되지 않는다.
    if (session.index >= session.queue.length && session.retry.length) {
      session.queue = shuffle(session.retry);
      session.retry = [];
      session.index = 0;
      session.lap++;
      toast('남은 ' + session.queue.length + '단어를 섞어서 다시 냅니다');
    }
    persistSession();
    if (global_Sync()) Sync.touch(); // 세션 중간에 앱을 꺼도 잃지 않게
    if (session.index >= session.queue.length) renderResult();
    else renderCard();
  }

  /* ---------------- 결과 ---------------- */

  // 같은 단어의 여러 시도를 한 줄로 묶는다.
  // 레벨과 O·X 는 마지막 시도의 것을 쓰고, '한 번에 맞혔는지'는 첫 시도로 판단한다.
  function distinctResults() {
    var byKey = {}, order = [];
    session.results.forEach(function (x) {
      var k = x.day + '|' + (x.w.no || 0) + '|' + x.w.word;
      var prev = byKey[k];
      if (!prev) order.push(k);
      byKey[k] = {
        day: x.day, w: x.w, r: x.r, m: x.m, level: x.level, known: x.known,
        tries: (prev ? prev.tries : 0) + 1,
        firstOk: prev ? prev.firstOk : !!(x.r && x.m)
      };
    });
    return order.map(function (k) { return byKey[k]; });
  }

  function renderResult() {
    Store.clearSession(); // 다 풀었으므로 이어하기 대상이 아니다
    if (global_Sync()) Sync.sync().catch(function () {}); // 결과를 바로 올린다
    $('progressFill').style.width = '100%';
    $('progressText').textContent = session.total + ' / ' + session.total;
    // 틀린 단어는 맞힐 때까지 다시 나왔으므로 기록에 같은 단어가 여러 번 있다.
    // 결과는 단어 단위로 센다. 무엇을 몇 번 만났는지가 아니라 무엇이 어려웠는지가 궁금한 것이다.
    var res = distinctResults();
    var perfect = res.filter(function (x) { return x.firstOk; }).length;
    var wrong = res.filter(function (x) { return !x.firstOk; });

    $('resultSub').textContent = res.length + '단어 중 ' + perfect + '개를 한 번에';

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
    // 다시 나왔던 단어는 마지막에 결국 O 라서 O·X 를 적어 봐야 소용없다.
    // 몇 번 만에 맞혔는지가 그 단어의 성적이다.
    var mark = x.known ? '이미 아는 단어'
      : (x.tries > 1 ? x.tries + '번 만에 맞힘'
                     : '읽기 ' + (x.r ? 'O' : 'X') + ' · 뜻 ' + (x.m ? 'O' : 'X'));
    return '<div class="wl-item' + (detail ? ' has-detail' : '') + '"' +
        (detail ? ' role="button" tabindex="0"' : '') + '>' +
      '<div class="wl-head">' +
        '<span class="wl-dot dot-' + st + '"></span>' +
        '<span class="wl-main">' +
          '<span class="wl-word" lang="ja">' + dictHTML(x.w.word) +
            (readingOf(x.w) ? '<span class="wl-reading">' + esc(readingOf(x.w)) + '</span>' : '') + posHTML(x.w.pos) +
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

    $('resultListTitle').textContent = (wrongOn ? '틀린 단어 ' : '전체 ') + list.length;
    $('btnResultBrowse').hidden = !list.length;

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
    // 단어와 문법을 한 번에 찾는다. 찾는 사람은 그게 단어인지 문형인지 미리 모른다.
    var gHits = Store.gSearch(q);
    $('searchHint').textContent = hits.length + '개' +
      (gHits.length ? ' · 문형 ' + gHits.length + '개' : '');
    $('searchResults').innerHTML =
      hits.slice(0, 300).map(function (e) { return itemHTML(e.day, e.w, true); }).join('') +
      (gHits.length
        ? '<div class="section-head"><h2>문형 ' + gHits.length + '</h2></div>' +
          gHits.slice(0, 200).map(gItemHTML).join('')
        : '');
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

    // 아이콘(svg)은 그대로 두고 상태만 색으로 알린다.
    // 예전에는 여기서 textContent 로 이모지를 넣어 svg 를 지워 버렸다.
    $('btnSyncTop').classList.toggle('spin', st.busy);
    $('btnSyncTop').classList.toggle('on', st.signedIn);
    $('btnSyncTop').classList.toggle('off', !st.signedIn);
    $('btnSyncTop').title = st.signedIn
      ? '동기화 켜짐 · ' + st.email
      : '동기화 꺼짐 — 눌러서 로그인하면 PC와 폰이 자동으로 합쳐집니다';

    $('syncOut').hidden = st.signedIn;
    $('syncIn').hidden = !st.signedIn;
    $('syncBuild').textContent = BUILD;
    // v45 가 잘못 올린 것을 v47 이 되돌렸다. 무엇이 걸렸는지 볼 수 있게 한다.
    var undone = Store.undoneWords();
    $('undoRow').hidden = !undone.length;
    if (undone.length) $('btnUndoList').textContent = undone.length + '개 목록 보기';

    // 초기화 전 기록은 지우지 않고 남겨 둔다. 후회하면 여기서 되돌린다.
    // 언제 만들어진 백업인지 반드시 같이 보여준다.
    // 기기마다 백업 시점이 다르므로, 날짜를 봐야 어느 쪽을 되돌릴지 고를 수 있다.
    var bk = Store.resetBackup();
    $('resetRow').hidden = !bk;
    if (bk) {
      var d = new Date(bk.at || 0);
      var when = bk.at
        ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
          ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
        : '시점 불명';
      $('btnRestoreReset').textContent = when + ' · ' + bk.n + '개 되돌리기';
    }
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
  var gTypedAll = [];      // 예문별로 입력한 답
  var gWrong = [];         // 이번 학습에서 틀린 문형
  var gResults = [];       // 이번 학습에서 푼 문형과 그때의 답
  var gPromoted = {};      // 이번 학습에서 이미 레벨을 올린 문형

  // 예문마다 문제를 내므로 한 문형이 한 학습에서 두세 번 나온다.
  // 그때마다 레벨을 올리면 하루 만에 장기기억으로 올라가 복습 간격이 무너진다.
  // 그래서 레벨은 한 학습에 한 번만 올린다. 틀린 것은 나올 때마다 그대로 반영한다.
  function canPromote(it, ok) {
    if (!ok) return false;              // 틀렸으면 올릴 일이 없다
    var k = Store.gKeyOf(it);
    if (gPromoted[k]) return false;     // 이번 학습에서 이미 올렸다
    gPromoted[k] = 1;
    return true;
  }
  var gPeek = null;        // 돌아보는 중이면 gResults 의 인덱스
  var gRandCount = 20;     // 전체에서 랜덤으로 뽑을 개수 (0 = 전체)

  function gByStage(stage, items) {
    if (stage === 'all') return items;
    return items.filter(function (it) {
      var st = Store.gStageFor(it);
      return stage === 'unknown' ? (st === 'unknown' || st === 'new') : st === stage;
    });
  }

  var G_NAME = { learn: '내용 보기', cloze: '빈칸 채우기', choice: '4지선다' };
  // 단계 이름은 단어와 같지만 세는 단위가 다르다. 문법에서 '모르는 단어'는 말이 안 된다.
  var G_STAGE_LABEL = { 'new': '미학습', unknown: '모르는 문형', short: '단기기억', long: '장기기억' };

  // 후리가나 표기(漢字[かんじ]) 에서 읽는 법 앞에 올 수 있는 글자.
  // 한자만이 아니다. 숫자와 로마자에도 읽는 법이 붙는다: N1[いち], 1[いっ]か月[げつ]
  // 한자만 받으면 그 대괄호가 화면에 그대로 나온다.
  var RUBY_BASE = '[一-龯々〆ヶ0-9０-９A-Za-zＡ-Ｚａ-ｚ]+';
  function rubyRe() { return new RegExp('(' + RUBY_BASE + ')\\[([^\\]]*)\\]', 'g'); }

  // 빈칸의 정답 = {{ }} 안의 내용에서 후리가나를 뺀 것.
  // 문형 이름(~をもとに)이 아니라 그 문장에 실제로 들어간 형태를 답으로 본다.
  // ~たり~たりする 처럼 한 문형이 문장 안에서 두 자리로 갈라지기도 한다.
  // 그때는 빈칸이 여러 개이므로 조각을 모두 모아야 정답이 된다.
  function answerParts(ex) {
    var out = [], re = /\{\{([\s\S]*?)\}\}/g, m;
    while ((m = re.exec(ex.jp)) !== null) out.push(m[1].replace(/\[[^\]]*\]/g, ''));
    return out;
  }
  function answerOf(ex) { return answerParts(ex).join(''); }
  function answerText(ex) { return answerParts(ex).join(' + '); }

  // 비교 전 다듬기: 후리가나·물결표·공백을 빼고 전각/반각을 통일한다.
  function normAns(s) {
    // 빈칸이 여러 개면 조각을 이어서 답한다. 사이에 넣은 +, /, 공백은 없는 셈 친다.
    s = String(s).replace(/\[[^\]]*\]/g, '').replace(/[~～+＋/／･・]/g, '').replace(/\s+/g, '');
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s;
  }

  // 예문 렌더링. 후리가나는 漢字[かな], 문형 자리는 {{ }} 로 표시돼 있다.
  var BLANK_NO = ['①', '②', '③', '④'];

  function gJP(jp, opt) {
    opt = opt || {};
    var out = '', i = 0, re = /\{\{([\s\S]*?)\}\}/g, m, n = 0;
    // 빈칸이 둘 이상이면 번호를 붙인다. 어디를 몇 번째로 채우는지 알아야 한다.
    var many = (jp.match(/\{\{/g) || []).length > 1;
    var seg = function (t) {
      var s = '', last = 0, r = rubyRe(), x;
      while ((x = r.exec(t)) !== null) {
        s += esc(t.slice(last, x.index));
        s += (opt.ruby && x[2]) ? '<ruby>' + esc(x[1]) + '<rt>' + esc(x[2]) + '</rt></ruby>' : esc(x[1]);
        last = x.index + x[0].length;
      }
      return s + esc(t.slice(last));
    };
    while ((m = re.exec(jp)) !== null) {
      out += seg(jp.slice(i, m.index));
      var tag = many ? (BLANK_NO[n] || (n + 1)) : '';
      if (opt.blank)       out += '<span class="gblank">' + (tag || '?') + '</span>';
      else if (opt.reveal) out += '<span class="gblank filled">' + seg(m[1]) + '</span>';
      else                 out += '<mark>' + seg(m[1]) + '</mark>';
      i = m.index + m[0].length;
      n++;
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
    $('gStats').innerHTML = statHTML(s, true);
    renderGResume();

    var all = Store.allGram();
    var due = all.filter(function (it) { return Store.gIsDue(it); });
    $('gmClozeN').textContent = due.length + '문형';
    $('gmChoiceN').textContent = due.length + '문형';
    $('gEmptyNote').hidden = all.length > 0;

    var today = Store.gDueList(), weak = Store.gWeakList(), shaky = Store.gShakyList();
    $('gReviewCount').textContent = today.length ? today.length + '개 대기' : gNextDueText();
    $('gWeakCount').textContent = weak.length + '개';
    $('gShakyCount').textContent = shaky.length ? shaky.length + '개' : '아직 없음';
    $('btnGReview').disabled = !today.length;
    $('btnGWeak').disabled = !weak.length;
    $('btnGShaky').disabled = !shaky.length;

    $('gRandPool').textContent = '전체 ' + s.total + '문형';
    $('btnGRand').disabled = !s.total;
    $('btnGRand').textContent =
      gRandCount && gRandCount < s.total ? gRandCount + '개 뽑기' : '전체 뽑기';
  }

  // 대기가 0일 때 언제 다시 뜨는지 알려준다. 안 그러면 고장난 것처럼 보인다.
  function gNextDueText() {
    var next = 0;
    Store.allGram().forEach(function (it) {
      var r = Store.gRecOf(it);
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

  function renderGResume() {
    var s = Store.loadGSession();
    var ok = s && s.queue && s.index < s.queue.length;
    $('btnGResume').hidden = !ok;
    if (ok) {
      $('gResumeInfo').textContent =
        (G_NAME[s.mode] || '문법') + ' · ' + s.label + ' · ' + (s.index + 1) + ' / ' + s.queue.length;
    }
  }

  /* ---------------- 문형 묶음 목록 ---------------- */
  // 단어의 Day 목록과 같은 자리. 복습·모름·흔들림·랜덤·챕터를 모두 여기로 모은다.
  // 어떤 모드로 풀지는 이 화면에서 고른다.

  var gSet = { items: [], label: '' };
  var gSetDesc = null;
  var gSetStack = [];

  function renderGSet(items, title, sub) {
    if (!items.length) return;
    var d = { items: items.slice(), title: title, sub: sub };
    if (view === 'gramList' && gSetDesc) { gSetStack.push(gSetDesc); pushNav(); }
    else gSetStack = [];
    applyGSet(d);
  }

  function applyGSet(d) {
    gSet = { items: d.items.slice(), label: d.title };
    gSetDesc = d;

    $('gListTitle').textContent = d.title;
    $('gListSub').textContent = d.sub;

    var s = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    d.items.forEach(function (it) { s.total++; s[Store.gStageFor(it)]++; });
    $('gListStats').innerHTML = statHTML(s, true);

    var q = d.items.length + '문형';
    $('gListClozeN').textContent = q;
    $('gListChoiceN').textContent = q;
    $('gListLearnN').textContent = d.items.length + '문형';

    $('gListItems').innerHTML = d.items.map(gItemHTML).join('');
    show('gramList');
  }

  // 목록 한 줄. 눌러서 펼치면 의미·접속·예문과 시험 기록이 나온다.
  function gItemHTML(it) {
    var st = Store.gStageFor(it);
    var r = Store.gRecOf(it);
    var detail = histHTML(r) + gDetailHTML(it);
    return '<div class="wl-item has-detail" role="button" tabindex="0">' +
      '<div class="wl-head">' +
        '<span class="wl-dot dot-' + st + '"></span>' +
        '<span class="wl-main">' +
          '<span class="wl-word" lang="ja">' + esc(it.pattern) + '</span>' +
          '<div class="wl-meaning">' + esc(it.ko) + '</div>' +
        '</span>' +
        '<span class="wl-side">' + G_STAGE_LABEL[st] + rateHTML(r) +
          '<span class="wl-day">' + esc(it.level) + ' · ' + it.no + (it.sub ? '-' + it.sub : '') + '</span>' +
        '</span>' +
        '<span class="wl-caret">▾</span>' +
      '</div>' +
      '<div class="wl-detail" hidden>' + detail + '</div>' +
    '</div>';
  }

  function gDetailHTML(it) {
    var h = '';
    if (it.meaning) h += grow('의미', esc(it.meaning), 'dim');
    if (it.connect) h += grow('접속', esc(it.connect), 'cn');
    it.examples.forEach(function (e) {
      h += '<div class="ex ruby"><p class="ex-jp" lang="ja">' + gJP(e.jp, { ruby: true }) + '</p>' +
        '<p class="ex-ko">' + esc(e.ko) + (e.type ? '<span class="gtag">' + esc(e.type) + '</span>' : '') + '</p></div>';
    });
    return h;
  }

  // 세 모드 모두 챕터(레벨·섹션)를 먼저 고른다.
  var gPickMode = 'learn';

  function renderGramChapters(mode) {
    gPickMode = mode || 'learn';
    var secs = Store.gramSections();
    var h = '';

    // 채점하는 모드는 '전체' 로 복습일이 된 것만 한 번에 푸는 길을 남겨 둔다.
    // 매일 하는 복습은 챕터를 고를 일이 아니다.
    if (gPickMode !== 'learn') {
      var due = Store.allGram().filter(function (it) { return Store.gIsDue(it); });
      h += '<button class="ch" data-k="__all"' + (due.length ? '' : ' disabled') + '>' +
        '<span class="ch-lv">전체</span>' +
        '<span class="ch-tx"><span class="ch-t">오늘의 복습</span>' +
          '<span class="ch-s">복습일이 된 ' + due.length + '문형</span></span>' +
        '<span class="ch-n">' + due.length + '문형</span></button>';
    }

    h += secs.map(function (g) {
      var s = Store.gSummarize(g.items);
      var pct = s.total ? Math.round(s.long / s.total * 100) : 0;
      var nums = g.items.map(function (i) { return i.no; });
      var range = nums.length ? Math.min.apply(null, nums) + '~' + Math.max.apply(null, nums) : '';
      return '<button class="ch" data-k="' + esc(g.level + '-' + g.section) + '">' +
        '<span class="ch-lv">' + esc(g.level) + '</span>' +
        '<span class="ch-tx">' +
          '<span class="ch-t">' + String(g.section).padStart(2, '0') + '. ' + esc(g.sectionTitle) + '</span>' +
          '<span class="ch-s">' + g.items.length + '문형 · ' + range + '번' +
            '</span>' +
        '</span>' +
        '<span class="ch-n">' + pct + '%</span></button>';
    }).join('');

    $('gChList').innerHTML = h;
    $('gChTitle').textContent = G_NAME[gPickMode] + ' · 챕터 선택';
    show('gramCh');
  }

  function startGram(mode, items, label) {
    if (!items.length) return;
    gMode = mode;
    // 한 칸이 문형 하나다. 카드에는 그 문형의 예문을 책에 있는 대로 다 싣는다.
    var cards = items.map(function (it) { return { it: it, ex: 0 }; });
    // 읽는 순서는 섞지 않는다. 책 순서대로 보는 게 자연스럽다.
    gQueue = (mode === 'learn') ? cards : Store.shuffleArr(cards);
    gIdx = 0; gTyped = ''; gTypedAll = []; gGraded = null; gPicked = null; gOpts = null;
    gWrong = []; gResults = []; gPeek = null; gPromoted = {};
    // 어디서 들어왔는지 기억해 뒀다가 뒤로가기로 그 자리에 돌려보낸다.
    if (view === 'gramList' || view === 'gramCh') gStudyFrom = view;
    gLabelText = label || G_NAME[mode];
    $('gLabel').textContent = gLabelText;
    persistGSession();
    show('gramStudy');
    renderGramCard();
  }

  /* ----- 문법 이어서 학습 ----- */
  // 단어와 같은 방식. 문형 전체가 아니라 어느 문형인지 표시만 남긴다.

  var gLabelText = '';
  var gStudyFrom = 'gramCh';   // 학습을 시작한 화면

  function gRefOf(c) { return { l: c.it.level, n: c.it.no, s: c.it.sub || null, x: c.ex || 0 }; }

  function persistGSession() {
    if (!gQueue.length) return;
    Store.saveGSession({
      mode: gMode, label: gLabelText, index: gIdx,
      queue: gQueue.map(gRefOf),
      // 틀린 목록은 문형 단위라 예문 번호가 없다.
      wrong: gWrong.map(function (it) { return gRefOf({ it: it, ex: 0 }); })
    });
  }

  function restoreGSession() {
    var s = Store.loadGSession();
    if (!s || !s.queue) return false;
    var q = [];
    s.queue.forEach(function (ref) {
      var it = Store.findGram(ref.l, ref.n, ref.s);
      // 예문이 줄어든 자료를 다시 받았을 수도 있으므로 범위를 확인한다.
      if (it && (ref.x || 0) < Math.max(1, it.examples.length)) q.push({ it: it, ex: ref.x || 0 });
    });
    if (!q.length || s.index >= q.length) { Store.clearGSession(); return false; }
    gMode = s.mode; gQueue = q; gIdx = s.index;
    gWrong = (s.wrong || []).map(function (ref) {
      return Store.findGram(ref.l, ref.n, ref.s);
    }).filter(Boolean);
    gTyped = ''; gTypedAll = []; gGraded = null; gPicked = null; gOpts = null;
    gResults = []; gPeek = null; gPromoted = {};   // 돌아보기는 이번에 푼 것만 대상이다
    gLabelText = s.label || G_NAME[gMode];
    $('gLabel').textContent = gLabelText;
    return true;
  }

  function renderGramCard() {
    if (gPeek !== null) gPeekClose();
    if (gIdx >= gQueue.length) { renderGramDone(); return; }
    var cur = gQueue[gIdx], it = cur.it, h = '';

    $('gCount').textContent = (gIdx + 1) + ' / ' + gQueue.length;
    $('gFill').style.width = (gIdx / gQueue.length * 100) + '%';

    var st = Store.gStageFor(it);
    h += '<div class="card">';
    h += '<div class="card-meta">' +
         '<span class="badge ' + st + '">' + G_STAGE_LABEL[st] + '</span>' +
         '<span class="card-no">' + esc(it.level) + ' · ' + it.no + (it.sub ? '-' + it.sub : '') +
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
      // 읽기만 하는 화면이라 앞뒤로 자유롭게 넘긴다.
      h += '</div><div class="br-nav">' +
        '<button class="br-btn" id="gPrev"' + (gIdx === 0 ? ' disabled' : '') + '>이전</button>' +
        '<button class="br-btn primary" id="gNext">' +
          (gIdx === gQueue.length - 1 ? '끝내기' : '다음') + '</button>' +
        '</div>';
    }

    if (gMode === 'cloze') {
      // 책에 있는 예문을 다 낸다. 한 문장으로만 익히면 그 문장에서만 알아본다.
      it.examples.forEach(function (e, i) {
        var many = it.examples.length > 1;
        h += '<div class="qex">';
        if (many) h += '<span class="qno">' + (i + 1) + '</span>';
        h += '<div class="qbody">' +
          '<p class="ex-jp gq" lang="ja">' +
            gJP(e.jp, gGraded ? { reveal: true, ruby: true } : { blank: true, ruby: true }) + '</p>' +
          '<p class="ex-ko gqko">' + esc(e.ko) + '</p>';
        if (!gGraded) {
          var np = answerParts(e).length;
          h += '<input class="ginp" data-i="' + i + '" lang="ja" placeholder="' +
               (np > 1 ? BLANK_NO.slice(0, np).join(' ') + ' 순서대로' : '빈칸에 들어갈 말') + '" ' +
               'autocomplete="off" autocapitalize="off" spellcheck="false">';
        } else {
          var mine = gTypedAll[i] || '';
          var eok = normAns(mine) === normAns(answerOf(e));
          if (!eok && mine)
            h += '<div class="gcmp"><span class="cl">내 답</span>' +
                 '<span class="cv bad" lang="ja">' + esc(mine) + '</span></div>';
          h += '<div class="gcmp"><span class="cl">정답</span>' +
               '<span class="cv good" lang="ja">' + esc(answerText(e)) + '</span>' +
               '<span class="qok ' + (eok ? 'y' : 'n') + '">' + (eok ? 'O' : 'X') + '</span></div>';
        }
        h += '</div></div>';
      });

      if (!gGraded) {
        h += '<button class="next-btn" id="gSubmit">확인</button>';
        h += '<button class="known-btn" id="gSkip">모르겠어요 · 정답 보기</button>';
      } else {
        var right = gRightCount(it), total = it.examples.length;
        var ok = (gGraded === 'right');
        h += '<div class="gjudge ' + (gGraded === 'skip' ? 'skip' : (ok ? 'right' : 'wrong')) + '">' +
             (gGraded === 'skip' ? '정답을 확인하세요'
               : (total > 1 ? total + '개 중 ' + right + '개 정답' : (ok ? '정답입니다' : '틀렸습니다'))) +
             '</div>';
        h += grow('문형', '<span lang="ja">' + esc(it.pattern) + '</span> <span class="gko">' + esc(it.ko) + '</span>', 'cn');
        h += grow('접속', esc(it.connect), 'cn');
        h += grow('의미', esc(it.meaning), 'dim');
        // 입력한 답으로 이미 맞았는지 갈렸다. 다시 스스로 채점할 이유가 없다.
        h += '<button class="next-btn" id="gNext">다음 <kbd>Enter</kbd></button>';
        if (gGraded !== 'right')
          h += '<button class="known-btn" id="gOverride">이것도 맞는 표현이에요 · 정답 처리</button>';
      }
    }

    if (gMode === 'choice') {
      if (!gOpts) gOpts = Store.gChoices(it, 4);
      // 같은 문형이 쓰인 문장을 다 보여준다. 고르는 답은 하나다.
      it.examples.forEach(function (e, i) {
        var many = it.examples.length > 1;
        h += '<div class="qex">' + (many ? '<span class="qno">' + (i + 1) + '</span>' : '') +
          '<div class="qbody">' +
            '<p class="ex-jp gq" lang="ja">' +
              gJP(e.jp, gPicked !== null ? { reveal: true, ruby: true } : { blank: true, ruby: true }) + '</p>' +
            '<p class="ex-ko gqko">' + esc(e.ko) + '</p>' +
          '</div></div>';
      });
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

  function bindGramCard() {
    var inputs = $$('#gStage .ginp');
    if (inputs.length) inputs[0].focus();
    inputs.forEach(function (inp, i) {
      inp.addEventListener('keydown', function (ev) {
        // 마지막 칸이 아니면 Enter 로 다음 칸으로 내려간다.
        if (ev.key === 'Enter' && !ev.isComposing && i < inputs.length - 1) {
          ev.preventDefault(); ev.stopPropagation();
          inputs[i + 1].focus();
          return;
        }
        // 일본어 IME 로 변환 중인 엔터는 확정용이므로 제출로 받으면 안 된다.
        if (ev.key === 'Enter' && !ev.isComposing) {
          ev.preventDefault();
          // 여기서 멈추지 않으면 문서까지 올라가 '다음'까지 눌러 버린다.
          // 그러면 한 번의 Enter 로 제출과 넘김이 같이 일어나 정답을 못 본다.
          ev.stopPropagation();
          gSubmit(false);
        }
      });
    });
    if ($('gSubmit')) $('gSubmit').addEventListener('click', function () { gSubmit(false); });
    if ($('gSkip'))   $('gSkip').addEventListener('click', function () { gSubmit(true); });
    if ($('gOverride')) $('gOverride').addEventListener('click', function () {
      gGraded = 'right';
      renderGramCard();
    });
    if ($('gNext')) $('gNext').addEventListener('click', gNext);
    if ($('gPrev')) $('gPrev').addEventListener('click', gPrev);

    $$('#gStage .gopt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (gPicked !== null) return;
        gPicked = Number(b.dataset.i);
        var it = gQueue[gIdx].it;
        var ok = Store.gKeyOf(gOpts[gPicked]) === Store.gKeyOf(it);
        Store.gGrade(it, ok, ok, canPromote(it, ok), 'gchoice');
        gResults.push({ it: it, ok: ok, typed: gOpts[gPicked].pattern, answers: [], skipped: false });
        if (!ok) gWrong.push(it);
        if (global_Sync()) Sync.touch();
        persistGSession();
        renderGramCard();
      });
    });
  }

  // 예문마다 몇 개를 맞혔는지.
  function gRightCount(it) {
    var n = 0;
    it.examples.forEach(function (e, i) {
      if (normAns(gTypedAll[i] || '') === normAns(answerOf(e))) n++;
    });
    return n;
  }

  function gSubmit(skip) {
    var it = gQueue[gIdx].it;
    var inputs = $$('#gStage .ginp');

    gTypedAll = [];
    inputs.forEach(function (el) { gTypedAll[Number(el.dataset.i)] = el.value.trim(); });
    gTyped = gTypedAll.filter(Boolean).join(' / ');

    if (skip) gGraded = 'skip';
    else if (!gTyped) { if (inputs[0]) inputs[0].focus(); return; }
    // 예문을 다 맞혀야 정답이다. 하나만 맞히는 건 그 문장만 외운 것일 수 있다.
    else gGraded = (gRightCount(it) === it.examples.length) ? 'right' : 'wrong';

    renderGramCard();
  }

  function gNext() {
    var it = gQueue[gIdx].it;
    if (gMode === 'cloze') {
      if (!gGraded) return;                 // 아직 확인을 안 눌렀다
      // 입력한 답이 곧 채점 결과다. 따로 물어보지 않는다.
      var ok = (gGraded === 'right');
      Store.gGrade(it, ok, ok, canPromote(it, ok), 'gcloze');
      gResults.push({ it: it, ok: ok, typed: gTyped, answers: gTypedAll.slice(), skipped: gGraded === 'skip' });
      if (!ok) gWrong.push(it);
      if (global_Sync()) Sync.touch();
    }
    gIdx++; gTyped = ''; gTypedAll = []; gGraded = null; gPicked = null; gOpts = null;
    persistGSession();
    renderGramCard();
  }

  // 뒤로 넘기는 건 내용 보기에서만. 채점하는 모드는 답을 이미 매겼으므로 되돌리지 않는다.
  function gPrev() {
    if (gMode !== 'learn' || gIdx === 0) return;
    gIdx--;
    renderGramCard();
  }

  /* ----- 이미 푼 문형 돌아보기 ----- */
  // 단어 시험과 같다. 점수는 건드리지 않고 뭐라고 답했는지까지 보여만 준다.

  function gPeekOpen(i) {
    if (!gResults.length) return;
    gPeek = Math.max(0, Math.min(i, gResults.length - 1));
    renderGPeek();
  }

  function gPeekClose() {
    gPeek = null;
    $('gPeekStage').hidden = true;
    $('gStage').hidden = false;
    $('gCount').textContent = (gIdx + 1) + ' / ' + gQueue.length;
  }

  function gPeekGo(step) {
    if (gPeek === null) return;
    var i = gPeek + step;
    if (i < 0) return;
    if (i >= gResults.length) { gPeekClose(); return; }
    gPeek = i;
    renderGPeek();
  }

  function renderGPeek() {
    var x = gResults[gPeek], it = x.it;
    var mark = x.skipped ? '정답을 봤음' : (x.ok ? '정답' : '오답');
    var mine = x.answers || [];

    var body = '';
    it.examples.forEach(function (e, i) {
      var many = it.examples.length > 1;
      var eok = normAns(mine[i] || '') === normAns(answerOf(e));
      body += '<div class="qex">' + (many ? '<span class="qno">' + (i + 1) + '</span>' : '') +
        '<div class="qbody">' +
          '<p class="ex-jp gq" lang="ja">' + gJP(e.jp, { reveal: true, ruby: true }) + '</p>' +
          '<p class="ex-ko gqko">' + esc(e.ko) + '</p>' +
          (mine[i] && !eok
            ? '<div class="gcmp"><span class="cl">내 답</span>' +
              '<span class="cv bad" lang="ja">' + esc(mine[i]) + '</span></div>' : '') +
          '<div class="gcmp"><span class="cl">정답</span>' +
            '<span class="cv good" lang="ja">' + esc(answerText(e)) + '</span>' +
            (mine.length ? '<span class="qok ' + (eok ? 'y' : 'n') + '">' + (eok ? 'O' : 'X') + '</span>' : '') +
          '</div>' +
        '</div></div>';
    });

    $('gPeekStage').innerHTML =
      '<div class="card">' +
        '<div class="card-meta">' +
          '<span class="badge ' + Store.gStageFor(it) + '">' + G_STAGE_LABEL[Store.gStageFor(it)] + '</span>' +
          '<span class="card-no">' + esc(it.level) + ' · ' + it.no + (it.sub ? '-' + it.sub : '') + '</span>' +
        '</div>' +
        body +
        '<div class="gjudge ' + (x.skipped ? 'skip' : (x.ok ? 'right' : 'wrong')) + '">' + mark + '</div>' +
        grow('문형', '<span lang="ja">' + esc(it.pattern) + '</span> <span class="gko">' + esc(it.ko) + '</span>', 'cn') +
        grow('접속', esc(it.connect), 'cn') +
        grow('의미', esc(it.meaning), 'dim') +
        '<div class="br-nav">' +
          '<button class="br-btn" id="gPeekPrev"' + (gPeek === 0 ? ' disabled' : '') + '>이전</button>' +
          '<button class="br-btn primary" id="gPeekNext">' +
            (gPeek === gResults.length - 1 ? '문제로 돌아가기' : '다음') + '</button>' +
        '</div>' +
      '</div>';

    $('gPeekStage').hidden = false;
    $('gStage').hidden = true;
    $('gPeekPrev').addEventListener('click', function () { gPeekGo(-1); });
    $('gPeekNext').addEventListener('click', function () { gPeekGo(1); });
    $('gCount').textContent = '돌아보기 ' + (gPeek + 1) + ' / ' + gResults.length;
    window.scrollTo(0, 0);
  }

  function renderGramDone() {
    Store.clearGSession();   // 다 풀었으므로 이어하기 대상이 아니다
    $('gFill').style.width = '100%';
    $('gCount').textContent = gQueue.length + ' / ' + gQueue.length;

    // 같은 문형을 두 번 틀렸을 수도 있으니 한 번만 남긴다.
    var seen = {}, wrong = [];
    gWrong.forEach(function (it) {
      var k = Store.gKeyOf(it);
      if (!seen[k]) { seen[k] = 1; wrong.push(it); }
    });

    var h = '<div class="card gdone">' +
      '<div class="gdone-t">' + G_NAME[gMode] + ' 끝</div>' +
      '<div class="gdone-s">' + gQueue.length + '개 중 ' +
        (gMode === 'learn' ? gQueue.length + '개를 봤습니다'
                           : (gQueue.length - wrong.length) + '개 정답') + '</div>' +
      '</div>';

    if (wrong.length) {
      h += '<div class="section-head"><h2>틀린 문형 ' + wrong.length + '</h2></div>' +
        '<div class="word-list" id="gDoneList">' + wrong.map(gItemHTML).join('') + '</div>';
    }
    h += '<div class="row-btns">' +
      (wrong.length
        ? '<button class="big-btn primary" id="gRetryBtn"><span class="bb-title">틀린 것 다시</span>' +
          '<span class="bb-sub">' + wrong.length + '개</span></button>'
        : '') +
      '<button class="big-btn" id="gHomeBtn"><span class="bb-title">문법 홈으로</span>' +
      '<span class="bb-sub">&nbsp;</span></button></div>';

    $('gStage').innerHTML = h;
    if ($('gDoneList')) bindExpand($('gDoneList'));
    if ($('gRetryBtn')) $('gRetryBtn').addEventListener('click', function () {
      startGram(gMode, wrong, '틀린 문형 다시');
    });
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

  // 가나로만 된 단어는 책에 읽는 법이 '-' 로 적혀 있다. 단어 자체가 읽는 법이라 그렇다.
  // 그대로 찍으면 목록에 뜻 없는 작대기만 남으므로, 따로 보여줄 읽는 법이 없다고 본다.
  function readingOf(w) {
    var r = (w.reading || '').trim();
    return (!r || r === '-' || r === '―' || r === w.word) ? '' : r;
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
  var RUBY_RE = rubyRe();

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
  // 단어를 이루는 한자를 하나씩 펼친다. 음독·훈독·부수, 그리고 눌러서 그 한자가 쓰인 단어로.
  // 이 단어를 왜 이렇게 읽는지가 여기서 풀린다.
  function kanjiBreakdownHTML(w) {
    var seen = {}, rows = [];
    (String(w.word).match(/[一-龯]/g) || []).forEach(function (c) {
      if (seen[c]) return;              // 한 단어에 같은 한자가 두 번 나와도 한 번만
      seen[c] = 1;
      var k = kanjiDict(c);
      if (!k) return;

      var meta = [];
      if (k.ko && k.ko.length) meta.push('<b>' + esc(k.ko.join(', ')) + '</b>');
      if (k.st) meta.push(k.st + '획');
      if (k.radc) meta.push('부수 ' + esc(k.radc) + ' ' + esc(k.radko || ''));

      rows.push(
        '<div class="kb-row">' +
          '<button type="button" class="kb-char ki-part" lang="ja" data-k="' + esc(c) + '">' + esc(c) + '</button>' +
          '<div class="kb-body">' +
            '<div class="kb-meta">' + meta.join(' · ') + '</div>' +
            (k.mean && k.mean.length
              ? '<div class="kb-mean">' + esc(k.mean.join(', ')) + '</div>' : '') +
            (k.on && k.on.length
              ? '<div class="kb-line"><i>음독</i><span lang="ja">' +
                k.on.map(function (x) { return esc(toHira(x)); }).join(', ') + '</span></div>' : '') +
            (k.kun && k.kun.length
              ? '<div class="kb-line"><i>훈독</i><span lang="ja">' +
                k.kun.map(kunHTML).join(', ') + '</span></div>' : '') +
          '</div>' +
        '</div>'
      );
    });
    if (!rows.length) return '';
    return '<div class="gram kb"><span class="gram-tag kanji">한자 ' + rows.length + '</span>' +
           '<div class="kb-list">' + rows.join('') + '</div></div>';
  }

  function detailHTML(w, withRuby) {
    var parts = [];

    // 문제를 푸는 중에는 읽는 법이 새면 안 되므로 답을 본 뒤에만 펼친다.
    if (withRuby) {
      var kb = kanjiBreakdownHTML(w);
      if (kb) parts.push(kb);
    }

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

    $('btnRestoreReset').addEventListener('click', function () {
      var bk = Store.resetBackup();
      if (!bk) return;
      var bd = new Date(bk.at || 0);
      if (!confirm('이 기기가 ' + (bk.at ? (bd.getMonth() + 1) + '월 ' + bd.getDate() + '일 ' +
            ('0' + bd.getHours()).slice(-2) + ':' + ('0' + bd.getMinutes()).slice(-2) : '언젠가') +
            '에 남긴 기록 ' + bk.n + '개로 되돌립니다.\n' +
            '그 이후의 학습은 사라집니다. 계속할까요?')) return;
      var n = Store.restoreResetBackup();
      $('syncPanel').hidden = true;
      renderHome(); show('home');
      if (global_Sync()) Sync.sync().catch(function () {});
      alert(n + '개를 되돌렸습니다.');
    });

    $('btnUndoList').addEventListener('click', function () {
      var list = Store.undoneWords();
      if (!list.length) return;
      $('syncPanel').hidden = true;
      currentDays = [];
      renderSet(list, '되돌린 단어', list.length + '단어 · v45 가 잘못 올렸던 것', true);
    });

    $('dirChips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      quizDir = chip.dataset.dir;
      try { localStorage.setItem(DIR_KEY, quizDir); } catch (e) {}
      $$('#dirChips .chip').forEach(function (c) { c.classList.toggle('sel', c === chip); });
    });

    $('taChips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || chip.id === 'btnTimeAttack') return;
      taSec = Number(chip.dataset.sec);
      $$('#taChips .chip[data-sec]').forEach(function (c) { c.classList.toggle('sel', c === chip); });
    });
    $('btnTimeAttack').addEventListener('click', function () {
      var pool = Store.learnedList();
      if (!pool.length) { alert('아직 익힌 단어가 없습니다.\n먼저 학습을 해 보세요.'); return; }
      startSession(pool, '타임어택 ' + taSec + '초', taSec);
    });
    $('btnClearSlow').addEventListener('click', function () {
      var n = Store.slowList().length;
      if (!n || !confirm('시간초과 기록 ' + n + '개를 전부 지웁니다.\n학습 진도는 그대로입니다. 계속할까요?')) return;
      Store.clearAllSlow();
      if (global_Sync()) Sync.touch();
      renderHome(); show('home');
    });
    $('btnSlowList').addEventListener('click', function () {
      var list = Store.slowList();
      if (!list.length) return;
      currentDays = [];
      renderSet(list, '느린 단어', list.length + '단어 · 제한시간을 넘긴 것', true);
    });

    $('kanjiChips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.kanji-chip');
      if (chip) openKanji(chip.dataset.k);
    });

    // 한자 글자는 어디에 있든 눌러서 그 한자로 건너뛴다. 단어 상세, 결과 목록, 한자 사전 패널.
    // 목록 안에서는 펼침 토글이 같이 도는 것을 막아야 하므로 캡처 단계에서 끊는다.
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('.ki-part[data-k]');
      if (b) {
        ev.preventDefault();
        ev.stopPropagation();
        // 상세 창 안에서는 그 창에서 더 파고든다.
        if (b.closest('#detailSheet')) dsPush({ t: 'kanji', k: b.dataset.k });
        // 학습 중에는 화면을 옮기지 않는다. 풀던 카드 위에 창을 덮어 보여준다.
        else if (view === 'study') dsShow({ t: 'kanji', k: b.dataset.k });
        else openKanji(b.dataset.k);
        return;
      }
      var it = ev.target.closest('#detailSheet .ds-item[data-i]');
      if (it) {
        ev.preventDefault();
        ev.stopPropagation();
        var e = dsWords[Number(it.dataset.i)];
        if (e) dsPush({ t: 'word', w: e.w });
      }
    }, true);

    $('btnCardDetail').addEventListener('click', function () {
      if (!session || peek !== null) return;
      dsOpen(session.queue[session.index].w);
    });
    // ← 는 폰의 뒤로가기와 같은 길을 타야 히스토리가 어긋나지 않는다.
    $('btnDsBack').addEventListener('click', goBack);
    $('btnDsClose').addEventListener('click', dsCloseAll);
    // 바깥을 누르면 닫는다. 상자 안을 누른 것은 그대로 둔다.
    $('detailSheet').addEventListener('click', function (ev) {
      if (ev.target === this) dsCloseAll();
    });
    // 칩에 없는 한자는 직접 쳐서 연다. 입력한 것 중 첫 한자를 쓴다.
    $('kanjiInput').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      var m = String(this.value).match(/[一-龯々]/);
      if (!m) return;
      this.value = '';
      this.blur();
      openKanji(m[0]);
    });

    $('rateChips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.rate-chip');
      if (!chip) return;
      var m = Number(chip.dataset.min);
      var list = wordsOfRate(m);
      currentDays = [];
      renderSet(list, '오답률 ' + m + '% 이상', list.length + '단어 · 2번 이상 학습', true);
    });

    $('posChips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.pos-chip');
      if (!chip) return;
      var g = POS_GROUPS.filter(function (x) { return x.has === chip.dataset.has; })[0];
      var list = wordsOfPos(g.has);
      // 여러 Day 에서 모은 것이라 항목마다 어느 Day 인지 함께 보여준다.
      currentDays = [];
      renderSet(list, g.label, list.length + '단어 · 전체 Day', true);
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

    $('btnBrowse').addEventListener('click', function () {
      startBrowse(currentSet.entries, currentSet.label);
    });
    $('brPrev').addEventListener('click', function () { browseGo(-1); });
    $('brNext').addEventListener('click', function () { browseGo(1); });

    // 폰에서 좌우로 밀어 넘긴다. 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전.
    bindSwipe($('viewBrowse'),
      function () { browseGo(1); },
      function () { browseGo(-1); });
    bindSwipe($('viewGramStudy'),
      function () {
        if (gPeek !== null) gPeekGo(1);
        else if (gMode === 'learn' && gIdx < gQueue.length) gNext();
      },
      function () {
        if (gPeek !== null) gPeekGo(-1);
        else if (gMode === 'learn') gPrev();
        else gPeekOpen(gResults.length - 1);
      });
    // 학습 화면은 오른쪽으로 밀면 이미 푼 단어를 돌아본다.
    bindSwipe($('viewStudy'),
      function () { if (peek !== null) peekGo(1); },
      function () { peek === null ? peekOpen(session.results.length - 1) : peekGo(-1); });

    $('btnStudyAll').addEventListener('click', function () {
      startSession(currentSet.entries, currentSet.label);
    });
    $('btnStudyDue').addEventListener('click', function () {
      startSession(currentSet.entries.filter(function (e) { return Store.isDue(e.day, e.w); }), currentSet.label + ' 복습');
    });
    $('btnReviewToday').addEventListener('click', function () {
      startSession(Store.dueList(), '오늘의 복습');
    });
    $('btnWeakStudy').addEventListener('click', function () {
      startSession(Store.weakList(), '모르는 단어');
    });
    // 목록을 먼저 보여준다. 많이 흔들린 것부터 나오니 무엇이 문제인지 눈에 들어온다.
    $('btnShakyStudy').addEventListener('click', function () {
      var list = Store.shakyList();
      currentDays = [];
      renderSet(list, '흔들리는 단어', list.length + '단어 · 2번 이상 학습 · 오답률 50% 이상', true);
    });

    $('dailyCounts').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      dailyCount = Number(chip.dataset.n);
      try { localStorage.setItem(DAILY_KEY, dailyCount); } catch (e) {}
      renderDaily();
    });
    $('btnDailyStudy').addEventListener('click', function () {
      var p = dailyPlan(dailyCount);
      if (!p.all.length) return;
      startSession(p.all, '오늘 학습 ' + p.all.length + '단어');
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
    // 결과 목록도 카드로 한 장씩 넘겨 볼 수 있다. 틀린 것을 다시 읽는 게 핵심이라.
    $('btnResultBrowse').addEventListener('click', function () {
      var list = (resultView === 'wrong') ? resultWrong : resultAll;
      startBrowse(list, (resultView === 'wrong' ? '틀린 단어' : '학습한 단어'));
    });

    // 통계 칸을 눌러 그 단계의 단어만 학습한다. 복습일과 상관없이 원할 때 볼 수 있다.
    // 통계 칸을 누르면 바로 시험이 아니라 그 단계만 모은 목록으로 간다.
    // 목록을 훑을지, 시험을 볼지, 넘기며 볼지는 거기서 고른다.
    $('globalStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      var list = byStage(st);
      currentDays = [];
      renderSet(list, STAGE_NAME[st], list.length + '단어 · 전체 Day', true);
    });
    $('dayStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      var list = byStage(st, currentSet.entries);
      renderSet(list, currentSet.label + ' · ' + STAGE_NAME[st],
        list.length + '단어', setDesc ? setDesc.showDay : true);
    });

    /* ----- 첫 화면 · 문법 ----- */
    $('pkVocab').addEventListener('click', function () { renderHome(); show('home'); });
    $('pkGram').addEventListener('click', function () { renderGramHome(); show('gram'); });

    $('gmLearn').addEventListener('click', function () { renderGramChapters('learn'); });
    $('gmCloze').addEventListener('click', function () { renderGramChapters('cloze'); });
    $('gmChoice').addEventListener('click', function () { renderGramChapters('choice'); });

    /* ----- 문법 홈의 묶음 버튼 ----- */
    $('btnGResume').addEventListener('click', function () {
      if (!restoreGSession()) { renderGramHome(); return; }
      show('gramStudy');
      renderGramCard();
    });
    $('btnGReview').addEventListener('click', function () {
      var l = Store.gDueList();
      renderGSet(l, '오늘의 복습', l.length + '문형 · 복습일이 된 것');
    });
    $('btnGWeak').addEventListener('click', function () {
      var l = Store.gWeakList();
      renderGSet(l, '모르는 문형', l.length + '문형');
    });
    $('btnGShaky').addEventListener('click', function () {
      var l = Store.gShakyList();
      renderGSet(l, '흔들리는 문형', l.length + '문형 · 2번 이상 학습 · 오답률 50% 이상');
    });
    $('gRandCounts').addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      gRandCount = Number(chip.dataset.n);
      $$('#gRandCounts .chip').forEach(function (c) { c.classList.toggle('sel', c === chip); });
      renderGramHome();
    });
    $('btnGRand').addEventListener('click', function () {
      var pool = Store.shuffleArr(Store.allGram().slice());
      var n = gRandCount && gRandCount < pool.length ? gRandCount : pool.length;
      renderGSet(pool.slice(0, n), '랜덤 ' + n + '문형', n + '문형');
    });

    /* ----- 문형 묶음 목록 ----- */
    $('gListCloze').addEventListener('click', function () { startGram('cloze', gSet.items, gSet.label); });
    $('gListChoice').addEventListener('click', function () { startGram('choice', gSet.items, gSet.label); });
    $('gListLearn').addEventListener('click', function () { startGram('learn', gSet.items, gSet.label); });
    bindExpand($('gListItems'));
    // 통계 칸을 누르면 그 단계만 다시 모은다. 단어 쪽과 같은 동작이다.
    $('gListStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      var l = gByStage(st, gSet.items);
      renderGSet(l, gSet.label + ' · ' + STAGE_NAME[st], l.length + '문형');
    });
    $('gStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var st = b.dataset.stage;
      var l = gByStage(st, Store.allGram());
      renderGSet(l, STAGE_NAME[st], l.length + '문형 · 전체');
    });

    $('gChList').addEventListener('click', function (ev) {
      var b = ev.target.closest('.ch');
      if (!b) return;
      if (b.dataset.k === '__all') {
        startGram(gPickMode, Store.allGram().filter(function (it) { return Store.gIsDue(it); }),
          G_NAME[gPickMode]);
        return;
      }
      var g = Store.gramSections().filter(function (x) {
        return x.level + '-' + x.section === b.dataset.k;
      })[0];
      // 챕터를 직접 골랐으면 복습일과 상관없이 그 챕터를 통째로 낸다.
      if (g) startGram(gPickMode, g.items, g.level + ' · ' + String(g.section).padStart(2, '0'));
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
      // 상세 창이 덮여 있으면 채점 키가 뒤에서 돌면 안 된다.
      // Escape 는 한 칸 되돌아가고, 처음 자리면 창을 닫는다.
      if (dsIsOpen()) {
        if (ev.key === 'Escape') { ev.preventDefault(); goBack(); }
        return;
      }
      // 검색 패널이 열려 있으면 O/X 단축키가 검색어에 끼어들면 안 된다.
      if (searchOpen) {
        if (ev.key === 'Escape') { ev.preventDefault(); goBack(); }
        return;
      }
      // 입력칸에 쓰는 중에는 단축키가 끼어들면 안 된다.
      // 그 칸의 Enter 는 그 칸이 직접 받아 처리한다.
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (view === 'gramStudy') {
        // 돌아보는 중에는 좌우로만 움직인다.
        if (gPeek !== null) {
          if (ev.key === 'ArrowLeft')       { ev.preventDefault(); gPeekGo(-1); }
          else if (ev.key === 'ArrowRight') { ev.preventDefault(); gPeekGo(1); }
          else if (ev.key === 'Escape')     { ev.preventDefault(); gPeekClose(); }
          return;
        }
        // 내용 보기는 채점이 없으니 같은 키로 앞뒤로 넘긴다.
        if (gMode === 'learn' && gIdx < gQueue.length) {
          if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault(); gNext();
          } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); gPrev(); }
          return;
        }
        // 채점이 끝난 뒤에는 Enter 로 넘어간다. 채점 전 Enter 는 입력란이 받아 제출한다.
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); gPeekOpen(gResults.length - 1); return; }
        var graded = (gMode === 'cloze' && gGraded) || (gMode === 'choice' && gPicked !== null);
        if (graded && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); gNext(); }
        return;
      }
      // 넘기며 보기는 채점이 없으니 좌우 화살표와 Enter 로만 넘긴다.
      if (view === 'browse') {
        if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault(); browseGo(1);
        } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); browseGo(-1); }
        return;
      }
      if (view !== 'study') return;
      // 돌아보는 중에는 채점 키가 먹으면 안 된다. 좌우로만 움직인다.
      if (peek !== null) {
        if (ev.key === 'ArrowLeft')  { ev.preventDefault(); peekGo(-1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); peekGo(1); }
        else if (ev.key === 'Escape')     { ev.preventDefault(); peekClose(); }
        return;
      }
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault(); peekOpen(session.results.length - 1); return;
      }
      // + = 이 단어는 확실히 안다. 판단이 빨리 날 때 정답을 볼 것도 없이 넘긴다.
      // 방향과 상관없이 먹는다.
      if (ev.key === '+') { ev.preventDefault(); markKnown(); return; }
      // 뜻 → 일본어 는 입력이 채점이다. 채점 전 Enter 는 입력란이 받아 제출한다.
      if (session.dir === 'ko2jp') {
        if (revGraded && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); revNext(); }
        return;
      }
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
