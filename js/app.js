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
  var pkResume = '';        // 첫 화면의 이어서 학습이 가리키는 곳. '' | 'word' | 'gram'

  // 기기가 실제로 어느 버전을 돌고 있는지 확인하려고 남긴다.
  // 앱이 옛 캐시를 쓰고 있으면 이 숫자가 안 올라간다.
  var BUILD = 'v121';

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
    day: 'home', study: 'home', result: 'home', time: 'home', browse: 'day', exams: 'home', affix: 'home',
    stories: 'home', story: 'stories', kanji: 'pick',
    gramCh: 'gram', gramStudy: 'gramCh', gramList: 'gram',
    mid: 'pick', midNote: 'mid', midWords: 'mid', midQuiz: 'mid', midSet: 'mid', midResult: 'mid', midBrowse: 'mid', midText: 'mid'
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
      // 시험 대비: 돌아보기 중이면 풀던 문제로, 아니면 들어온 자리로 돌아간다.
      else if (view === 'midQuiz' && mid && mid.peek != null) midPeekClose();
      else if (view === 'midQuiz') goView(mid ? mid.from : 'mid');
      else if (view === 'midResult') goView(midRes ? midRes.from : 'mid');
      else if (view === 'midBrowse') goView(midBrowse ? midBrowse.from : 'mid');
      // 목록에서 좁혀 들어왔으면 화면을 나가기 전에 한 단계씩 되돌린다.
      else if (view === 'day' && setStack.length) applySet(setStack.pop());
      else if (view === 'day' && setReturn.length) backFromSet();
      else if (view === 'gramList' && gSetStack.length) applyGSet(gSetStack.pop());
      // 문법 학습은 챕터에서 왔는지 묶음 목록에서 왔는지에 따라 돌아갈 곳이 다르다.
      else if (view === 'gramStudy') goView(gStudyFrom || 'gramCh');
      // 시험 기록에서 연 결과 화면이면 홈이 아니라 기록 목록으로 돌아간다.
      else if (view === 'result' && resultFrom === 'exams') goView('exams');
      // 한자 기록만 보던 중이면 한자 화면으로 돌아간다.
      else if (view === 'exams' && examsOnlyKanji) goView('kanji');
      // 한자 쪽에서 시작한 학습은 한자 화면으로 돌아간다. 단어 홈으로 떨어지면 길을 잃는다.
      else if (view === 'study' && studyFrom === 'kanji') goView('kanji');
      else if (view === 'result' && resultFrom === 'kanji') goView('kanji');
      // Day 목록에서 건너온 글이면 그 목록으로 돌아간다.
      else if (view === 'story' && storyFrom === 'day') goView('day');
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
    else if (v === 'exams') { renderExams(); show('exams'); }
    else if (v === 'stories') { renderStories(); show('stories'); }
    else if (v === 'mid')  { renderMid(); show('mid'); }
    else if (v === 'midSet') { renderMidSet(); show('midSet'); }
    else if (v === 'midResult') { renderMidResList(); show('midResult'); }
    else if (v === 'kanji') { examsOnlyKanji = false; renderKanjiList(); renderKjResume(); show('kanji'); renderKjSelBar(); }
    else show(v);
  }

  /* ---------------- 앱으로 설치 ---------------- */
  // 브라우저로 주소만 열면 '받는 화면' 이 따로 없어서 어떻게 까는지 모른다.
  // 크롬이 설치할 수 있다고 알려 주면(beforeinstallprompt) 첫 화면에 버튼을 띄운다.
  // 사파리(아이폰)는 그 신호가 없어서 '공유 → 홈 화면에 추가' 를 글로 알려 준다.
  var installPrompt = null;

  function isInstalled() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  function renderInstall() {
    var btn = $('btnInstall');
    if (!btn) return;
    if (isInstalled()) { btn.hidden = true; return; }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (installPrompt) {
      btn.hidden = false;
      $('installSub').textContent = '홈 화면에 추가해서 앱처럼 씁니다';
    } else if (ios) {
      btn.hidden = false;
      $('installSub').textContent = '아래 공유 버튼 → 홈 화면에 추가';
    } else {
      btn.hidden = true;
    }
  }

  function doInstall() {
    if (!installPrompt) {
      toast('브라우저 메뉴에서 [앱 설치] 또는 [홈 화면에 추가] 를 누르세요');
      return;
    }
    installPrompt.prompt();
    installPrompt.userChoice.then(function (r) {
      if (r && r.outcome === 'accepted') { installPrompt = null; renderInstall(); }
    });
  }

  function renderPick() {
    var v = Store.summarizeAll();
    var g = Store.gSummarizeAll();
    var pct = function (s) { return s.total ? Math.round(s.long / s.total * 100) : 0; };
    $('pkVocabSub').textContent = v.total + '단어';
    $('pkGramSub').textContent  = g.total + '문형';
    $('pkVocabPct').textContent = pct(v) + '%';
    $('pkGramPct').textContent  = pct(g) + '%';

    // 한자는 그 한자가 든 단어를 모두 장기기억으로 넘겼을 때 다 외운 것으로 센다.
    // 세는 대상은 한자 화면에 실제로 나오는 글자(앞 구간 단어에 다 들어 있는 것은 뺀다).
    var map = kanjiIndex(), covered = coveredKanji(), kDone = 0;
    var ks = Object.keys(map).filter(function (c) { return !covered[c]; });
    ks.forEach(function (c) {
      var all = map[c].every(function (e) { return Store.stageFor(e.day, e.w) === 'long'; });
      if (all) kDone++;
    });
    $('pkKanjiSub').textContent = ks.length + '자';
    $('pkKanjiPct').textContent = (ks.length ? Math.round(kDone / ks.length * 100) : 0) + '%';

    // 첫 화면에는 시험 대비 칸과 이어서 학습 버튼을 두지 않는다(사용자 요청). 이어서 학습은 각 모드 안에 있다.
    $('pkMid').hidden = true;
    $('btnPkResume').hidden = true;
    pkResume = '';
  }

  var VIEW_TITLE = {
    pick: '일본어', home: '단어', gram: '문법', day: '단어', study: '단어', browse: '단어', time: '공부 시간',
    gramCh: '문법', gramStudy: '문법', gramList: '문법', exams: '시험 기록', affix: '단어',
    stories: '문단 읽기', story: '문단 읽기', kanji: '한자',
    mid: '시험 대비', midNote: '시험 대비', midWords: '시험 대비', midQuiz: '시험 대비',
    midSet: '시험 대비', midResult: '시험 대비', midBrowse: '시험 대비', midText: '본문 해설'
  };

  function show(name) {
    if (name !== 'study') taStop();   // 학습을 벗어나면 시계를 멈춘다
    if (name !== 'pick' && name !== view) pushNav();
    view = name;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    // 아래 고정 버튼은 학습 화면에서만 나온다. 화면 밖에 있으므로 여기서 같이 여닫는다.
    $('studyBar').hidden = (name !== 'study');
    $('midBar').hidden = (name !== 'midQuiz');
    $('btnHome').hidden = (name === 'pick');
    $('btnTimeTop').hidden = (name === 'study' || name === 'gramStudy' || name === 'time');
    // 고른 것 바는 Day 를 고르는 홈과 한자를 고르는 한자 화면에서만 보인다.
    var onSel = (name === 'home' && selected.length) || (name === 'kanji' && kjSel.length);
    $('selBar').hidden = !onSel;
    document.body.classList.toggle('has-selbar', !!onSel);
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
    $('examCount').textContent = Store.examList().length + '회';
    var af = Store.getAffixes();
    var afN = af ? af.prefixes.length + af.suffixes.length : 0;
    $('btnAffix').hidden = !afN;
    if (afN) $('affixCount').textContent = afN + '개';
    var stDays = {}, stN = 0;
    Store.storyList().forEach(function (s) { if (!stDays[s.day]) { stDays[s.day] = 1; stN++; } });
    $('btnStory').hidden = !stN;
    if (stN) $('storyCount').textContent = stN + ' Day';
    renderDaily();
    renderPosChips();
    renderLcChips();
    renderRateChips();
    renderKanjiChips();
    $$('#dirChips .chip').forEach(function (c) {
      c.classList.toggle('sel', c.dataset.dir === quizDir);
    });

    var due = Store.dueList();
    // 대기가 0이면 언제 다시 뜨는지 알려준다. 안 그러면 고장난 것처럼 보인다.
    $('reviewCount').textContent = due.length
      ? due.length + '개 대기'
      : nextDueText();
    $('btnReviewToday').disabled = !due.length;

    var shaky = Store.shakyList();
    $('shakyCount').textContent = shaky.length ? shaky.length + '개' : '아직 없음';
    $('btnShakyStudy').disabled = !shaky.length;
    var marked = Store.markedList();
    $('markedCount').textContent = marked.length ? marked.length + '개' : '아직 없음';
    $('btnMarkedStudy').disabled = !marked.length;

    var slow = Store.slowList();
    $('btnSlowList').hidden = !slow.length;
    if (slow.length) $('btnSlowList').textContent = '느린 단어 ' + slow.length;

    $('randPool').textContent = '전체 ' + s.total + '단어';
    $('btnRandStudy').disabled = !s.total;
    $('btnRandStudy').textContent =
      randCount && randCount < s.total ? randCount + '개 랜덤 학습' : '전체 랜덤 학습';

    var days = gridDays();
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

  /* ---------------- 듣기 수업 단어 ---------------- */
  // 대학 듣기 수업(일본어LCⅡ) 과별 단어. 과 목록은 시험 대비 자료(exam.js 의 lc 과)에 있고,
  // 단어장에 이미 있는 단어는 그 단어를, 없던 단어는 숨은 DAY 202~208 의 단어를 가리킨다.
  // 숨은 DAY 는 Day 격자에 내지 않는다(과별로만 본다).
  var LC_DAY_BASE = 200;
  function gridDays() { return Store.allDays().filter(function (d) { return d.day < LC_DAY_BASE; }); }

  function lcLessons() {
    var d = Store.examData();
    return ((d && d.lessons) || []).filter(function (L) { return L.lc; });
  }

  function lcWords(L) {
    var byWR = {}, byW = {};
    Store.allWords().forEach(function (e) {
      var r = e.w.reading === '-' ? '' : e.w.reading;
      var k = e.w.word + '|' + r;
      // 같은 단어가 숨은 DAY 와 책에 둘 다 있으면 책 쪽(기록이 쌓인 쪽)을 쓴다
      if (!byWR[k] || byWR[k].day >= LC_DAY_BASE) byWR[k] = e;
      if (!byW[e.w.word] || byW[e.w.word].day >= LC_DAY_BASE) byW[e.w.word] = e;
    });
    var out = [], seen = {};
    (L.vocab || []).forEach(function (v) {
      var e = byWR[v.word + '|' + (v.reading || '')] || byW[v.word];
      if (!e) return;
      var key = e.day + '-' + (e.w.no || e.w.word);
      if (seen[key]) return;
      seen[key] = 1;
      out.push(e);
    });
    return out;
  }

  function renderLcChips() {
    var ls = lcLessons();
    $('lcHead').hidden = $('lcChips').hidden = !ls.length;
    $('lcChips').innerHTML = ls.map(function (L) {
      return '<button class="chip" data-lc="' + esc(L.set) + '">' + esc(L.no) + ' <i>' + lcWords(L).length + '</i></button>';
    }).join('');
  }

  /* ---------------- Day 다중 선택 ---------------- */

  function isSel(n) { return selected.indexOf(n) > -1; }

  function toggleSel(n) {
    var i = selected.indexOf(n);
    if (i > -1) selected.splice(i, 1); else selected.push(n);
    selected.sort(function (a, b) { return a - b; });
  }

  // 한 칸만 눌러도 한 판 분량이 모이게, 화면에 이어지는 뒤 칸들을 함께 고른다.
  // 100단어가 모이면 멈추고, 다음 칸을 더해 120단어를 넘기게 되면 더하지 않는다.
  // 아무것도 고르지 않았을 때만 이어 붙인다. 하나라도 골라 둔 뒤에는 누른 칸만 켜고 끈다.
  var CHAIN_MIN = 100, CHAIN_MAX = 120;

  function chainPick(keys, from, countOf) {
    var at = keys.indexOf(from);
    var out = [from], total = countOf(out);
    for (var j = at + 1; j < keys.length && total < CHAIN_MIN; j++) {
      var next = out.concat([keys[j]]);
      var n = countOf(next);          // 한자는 단어가 겹치므로 그때마다 중복 없이 다시 센다
      if (n > CHAIN_MAX) break;
      out = next; total = n;
    }
    return out;
  }

  function wordsOf(dayNums) {
    var out = [];
    dayNums.forEach(function (n) {
      var d = Store.getDay(n);
      if (d) d.words.forEach(function (w) { out.push({ day: d.day, w: w }); });
    });
    return out;
  }

  // 단어 하나에 붙는 Day 표시. 두 책에 같이 실려 N2 로 모은 단어는
  // 'DAY 30→81' 처럼 원래 외우던 Day 도 같이 적는다. 펼친 적 없는 Day 의 단어가
  // 복습에 떠도 어디서 온 것인지 바로 보이게 하려는 것이다.
  function dayOf(day, w) {
    if (day >= 200 && day < 300) return '듣기 ' + (day - 200) + '과';   // 숨은 DAY 202~208
    var from = w ? Store.fromDay(day, w) : 0;
    return 'DAY ' + (from ? from + '→' + day : day);
  }

  function dayLabel(dayNums) {
    if (dayNums.length === 1) return 'DAY ' + dayNums[0];
    if (dayNums.length <= 3) return 'DAY ' + dayNums.join(', ');
    return 'DAY ' + dayNums[0] + ' 외 ' + (dayNums.length - 1) + '개';
  }

  // 한자 화면에서 고른 한자들의 바. Day 바와 같은 자리, 같은 버튼을 쓴다.
  function renderKjSelBar() {
    var bar = $('selBar');
    bar.hidden = !kjSel.length;
    document.body.classList.toggle('has-selbar', !!kjSel.length && view === 'kanji');
    if (!kjSel.length) return;
    var all = wordsOfKanjiList(kjSel);
    // 한자 모드의 복습은 한자 모드로 공부한 단어만 낸다.
    var due = all.filter(function (e) { return Store.isKanjiSeen(e.day, e.w) && Store.isDue(e.day, e.w); });
    var unk = byStage('unknown', all);
    var sht = byStage('short', all);
    $('selDays').textContent = kjLabel(kjSel);
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

  // src 는 이 목록이 어디서 왔는지다. 'kanji' 면 여기서 시작한 학습도 한자 모드로 센다.
  function renderSet(entries, title, sub, showDay, info, src) {
    if (!entries.length) return;
    var d = { entries: entries.slice(), title: title, sub: sub, showDay: !!showDay, info: info || '', src: src || '' };
    // 같은 화면에서 더 좁혀 들어가는 경우(DAY 20 → 단기기억)에는
    // 화면이 바뀌지 않아 show() 가 히스토리를 쌓지 않는다. 직접 쌓아 둔다.
    if (view === 'day' && setDesc) { setStack.push(setDesc); pushNav(); }
    else {
      // 넘기며 보기·결과 화면처럼 목록이 아닌 곳에서 건너왔으면, 뒤로가기가 그 화면으로 돌아가야 한다.
      // 그 밑에 깔려 있던 목록도 함께 적어 둔다. 그 화면에서 한 번 더 뒤로 가면 원래 목록이 나와야 한다.
      // 홈에서 연 것은 돌아갈 곳이 홈이라 적을 것이 없다.
      if (view !== 'home' && view !== 'pick') {
        setReturn.push({ view: view, desc: setDesc, stack: setStack, days: currentDays.slice() });
      } else {
        setReturn = [];
      }
      setStack = [];
    }
    applySet(d);
  }

  // 목록이 아닌 화면에서 목록으로 건너왔던 자리. 뒤로가기가 하나씩 꺼내 쓴다.
  var setReturn = [];

  function backFromSet() {
    var r = setReturn.pop();
    setStack = r.stack || [];
    currentDays = r.days || [];
    // 화면은 옮기지 않고, 밑에 깔린 목록만 원래대로 되돌려 둔다.
    if (r.desc) applySet(r.desc, true);
    else setDesc = null;
    goView(r.view);
  }

  function applySet(d, quiet) {
    var entries = d.entries, showDay = d.showDay;
    currentSet = { entries: entries.slice(), label: d.title, src: d.src || '' };
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
    // 한 Day 를 통째로 볼 때만 그 Day 의 글로 건너가는 버튼을 낸다.
    var oneDay = (currentDays.length === 1 && d.title === dayLabel(currentDays)) ? currentDays[0] : 0;
    $('btnDayStory').hidden = !(oneDay && Store.getStory(oneDay));
    $('btnDayStory').dataset.day = oneDay || '';

    $('dayWordList').innerHTML = entries.map(function (e) {
      return itemHTML(e.day, e.w, showDay);
    }).join('');
    if (!quiet) show('day');
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

  // 같은 소리를 두 번 겹친 낱말(ぶかぶか·ちらちら·ぶかぶかだ·馬鹿馬鹿しい).
  // 뜻이 서로 비슷비슷해서 흩어 놓으면 헷갈린다. 한자리에 모아 견주며 외우려는 것.
  var REP_TAILS = ['', 'だ', 'する', 'しい', 'い', 'と', 'に'];

  function isRepWord(word) {
    var w = String(word || '').replace(/[（）()]/g, '');
    for (var i = 0; i < REP_TAILS.length; i++) {
      var t = REP_TAILS[i];
      if (t && w.slice(-t.length) !== t) continue;
      var s = t ? w.slice(0, w.length - t.length) : w;
      if (s.length >= 2 && s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2)) return true;
    }
    return false;
  }

  function repWords() {
    return Store.allWords().filter(function (e) { return isRepWord(e.w.word); });
  }

  // 한자가 한 글자도 없는 히라가나 단어(おととい·ぶかぶか).
  // 한자별 학습으로는 어느 칸에도 안 들어가서 영영 안 나온다. 그래서 따로 모아 둔다.
  // 가타카나 단어(コンセント)는 따로 묶인 Day 가 있어 여기서 뺀다.
  function noKanjiWords() {
    return kanjiModeWords().filter(function (e) {
      return !/[一-龯々]/.test(e.w.word) && !/[ァ-ヺー]/.test(e.w.word);
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

  // 한자별 학습은 책 단어장(DAY 1~90)만 본다. DAY 91~ 은 책 밖에서 더한 보충 단어라 뺀다.
  var KANJI_LAST_DAY = 90;

  function kanjiModeWords() {
    return Store.allWords().filter(function (e) { return e.day <= KANJI_LAST_DAY; });
  }

  function kanjiIndex() {
    if (kanjiMap) return kanjiMap;
    kanjiMap = {};
    kanjiModeWords().forEach(function (e) {
      var seen = {};
      (String(e.w.word).match(/[一-龯々]/g) || []).forEach(function (c) {
        if (seen[c]) return;          // 한 단어에 같은 한자가 두 번 나와도 한 번만
        seen[c] = 1;
        (kanjiMap[c] = kanjiMap[c] || []).push(e);
      });
    });
    return kanjiMap;
  }

  // Day 가 낮은 것부터 늘어놓는다. 먼저 배운 단어가 위에 와야 새 단어를 아는 단어에 이어 붙이기 쉽다.
  // 같은 Day 안에서는 책에 실린 순서(번호)대로.
  function wordsOfKanji(c) {
    var list = (kanjiIndex()[c] || []).slice();
    list.sort(function (a, b) {
      return (a.day - b.day) || ((a.w.no || 0) - (b.w.no || 0)) ||
        (readingOf(a.w) || a.w.word).localeCompare(readingOf(b.w) || b.w.word, 'ja');
    });
    return list;
  }

  /* ---------------- 한자별 학습 ---------------- */
  // 한자를 고르면 그 한자가 든 단어만 모아 학습한다(진도는 단어 진도 그대로).
  // 많이 나오는 한자부터 외우는 편이 남는 것이 많아, 단어 수로 단계를 나눠 보여 준다.
  // 단어 수로 나눈 구간. 겹치지 않게 끊어 두어, 한 단계를 끝내면 다음 단계는 모두 새 한자다.
  // 마지막 구간(2~1개)에서는 '앞 구간 단어에 다 들어 있는 한자'를 뺀다(coveredKanji).
  var KANJI_STEPS = [
    { lo: 10, hi: 0,  label: '단어 10개 이상' },   // hi 0 은 위가 없다는 뜻
    { lo: 5,  hi: 9,  label: '단어 9~5개' },
    { lo: 3,  hi: 4,  label: '단어 4~3개' },
    { lo: 1,  hi: 2,  label: '단어 2~1개' }
  ];
  var kanjiStep = 0;   // 지금 보고 있는 구간 번호
  var stepWords = [];  // 그 구간 한자들이 쓰인 단어(중복 없이)
  var stepDue = [];    // 그중 복습할 때가 된 것
  var kjSel = [];      // 골라 둔 한자들. Day 여러 개 고르기와 같은 방식이다.

  function kjIsSel(c) { return kjSel.indexOf(c) > -1; }

  function kjToggle(c) {
    var i = kjSel.indexOf(c);
    if (i > -1) kjSel.splice(i, 1); else kjSel.push(c);
  }

  // 고른 한자들이 쓰인 단어를 중복 없이 모은다.
  function wordsOfKanjiList(list) {
    var out = [], seen = {};
    list.forEach(function (c) {
      (kanjiIndex()[c] || []).forEach(function (e) {
        var k = e.day + '-' + (e.w.no || e.w.word);
        if (seen[k]) return;
        seen[k] = 1;
        out.push(e);
      });
    });
    return out;
  }

  function kjLabel(list) {
    if (list.length === 1) return '한자 ' + list[0];
    if (list.length <= 4) return '한자 ' + list.join('');
    return '한자 ' + list.slice(0, 3).join('') + ' 외 ' + (list.length - 3) + '자';
  }

  // 1~2개 단어에만 쓰인 한자 가운데, 그 단어가 모두 '3개 이상 쓰인 한자'의 단어이기도 한 것.
  // 앞 단계를 하면 그 단어를 어차피 다 보게 되므로, 마지막 '전체' 단계에서는 빼서 목록을 가볍게 한다.
  var coveredCache = null;

  function coveredKanji() {
    if (coveredCache) return coveredCache;
    var map = kanjiIndex();
    var common = {};
    Object.keys(map).forEach(function (c) { if (map[c].length >= 3) common[c] = 1; });
    // 단어마다 '3개 이상 쓰인 한자'를 품고 있는지 미리 본다
    var hasCommon = function (e) {
      var ks = String(e.w.word).match(/[一-龯々]/g) || [];
      for (var i = 0; i < ks.length; i++) if (common[ks[i]]) return true;
      return false;
    };
    coveredCache = {};
    Object.keys(map).forEach(function (c) {
      if (map[c].length >= 3) return;
      var all = map[c].every(hasCommon);
      if (all) coveredCache[c] = 1;
    });
    return coveredCache;
  }

  // 한자 모드의 주의할 단어: ★ 를 붙인 단어 가운데 한자가 든 책 단어(DAY 1~90)만.
  function kanjiMarked() {
    return Store.markedList().filter(function (e) {
      return e.day <= KANJI_LAST_DAY && /[一-龯々]/.test(e.w.word);
    });
  }

  // 한자 모드의 시험 기록: 한자 화면에서 시작한 판만(이름이 '한자' 로 시작한다).
  function kanjiExams() {
    return Store.examList().filter(function (r) { return /^한자/.test(String(r.label || '')); });
  }

  // 한자 한 글자의 단어들이 어디까지 외워졌는지. 단어 학습 기록을 그대로 센다.
  function kanjiStat(c) {
    var list = kanjiIndex()[c] || [];
    var s = { n: list.length, due: 0, long: 0, short: 0, unknown: 0 };
    list.forEach(function (e) {
      if (Store.isDue(e.day, e.w)) s.due++;
      var st = Store.stageFor(e.day, e.w);
      if (st === 'long') s.long++;
      else if (st === 'short') s.short++;
      else s.unknown++;          // 모름과 미학습은 한 칸으로 묶는다(홈 통계와 같은 기준)
    });
    return s;
  }

  // 칸 순서는 학습할수록 바뀌면 안 된다. 한 칸을 눌러 이어서 묶을 때 이미 한 한자가 다시 끼어든다.
  // '한자 모드로 단어를 다 본 한자'를 맨 앞에(한 번 다 보면 그대로다). 나머지는 단어 수, 그다음 사용 빈도순.
  // 단어장에서 단어가 빠져 단어 수가 바뀌어도 이미 한 한자가 뒤로 섞여 들지 않는다.
  // 거의 다 본 한자(90% 이상)도 한 것으로 친다. 나중에 단어 한두 개가 더해져도 뒤로 섞이지 않게.
  function kjDone(c) {
    var ws = kanjiIndex()[c] || [];
    var seen = ws.filter(function (e) { return Store.isKanjiSeen(e.day, e.w); }).length;
    return ws.length && seen >= ws.length * 0.9 ? 1 : 0;
  }
  function kjFq(c) {
    var k = window.KANJI_DICT && window.KANJI_DICT.kanji && window.KANJI_DICT.kanji[c];
    return (k && k.fq) || 9999;
  }

  function renderKanjiList() {
    var map = kanjiIndex();
    var covered = coveredKanji();
    var inStep = function (c, i) {
      var r = KANJI_STEPS[i], n = map[c].length;
      if (n < r.lo || (r.hi && n > r.hi)) return false;
      return r.lo > 2 || !covered[c];   // 마지막 구간에서만 가려낸다
    };
    var all = Object.keys(map);
    var counts = KANJI_STEPS.map(function (r, i) {
      return all.filter(function (c) { return inStep(c, i); }).length;
    });
    $('kanjiTabs').innerHTML = KANJI_STEPS.map(function (r, i) {
      return '<button class="res-tab' + (i === kanjiStep ? ' sel' : '') + '" data-step="' + i + '">' +
        esc(r.label) + ' <i>' + counts[i] + '</i></button>';
    }).join('');

    // 많이 나오는 한자가 앞에. 같은 수면 이미 외운 것이 뒤로 가게 둔다.
    var list = all.filter(function (c) { return inStep(c, kanjiStep); })   // 지금 구간의 한자만
      .map(function (c) { return { k: c, s: kanjiStat(c), d: kjDone(c), f: kjFq(c) }; })
      .sort(function (a, b) { return (b.d - a.d) || (b.s.n - a.s.n) || (a.f - b.f) || a.k.localeCompare(b.k, 'ja'); });

    var done = list.filter(function (x) { return x.s.long === x.s.n; }).length;
    var due = list.reduce(function (n, x) { return n + (x.s.due ? 1 : 0); }, 0);
    var nk = noKanjiWords().length;
    $('btnNoKanji').hidden = !nk;
    $('btnNoKanji').textContent = '히라가나 단어 ' + nk;

    // 위 진도 카드: 한자 모드에 나오는 한자 전체 가운데 몇 자를 다 외웠는가.
    // 한 자를 '다 외웠다'는 그 한자의 단어가 모두 장기기억이 됐다는 뜻이다.
    var shown = all.filter(function (c) {
      for (var i = 0; i < KANJI_STEPS.length; i++) if (inStep(c, i)) return true;
      return false;
    });
    var kp = { total: shown.length, long: 0, short: 0, unknown: 0, 'new': 0 };
    shown.forEach(function (c) {
      var s = kanjiStat(c);
      if (s.long === s.n) kp.long++;
      else if (s.long || s.short) kp.short++;   // 손은 댔으나 아직 다 외우지 못한 한자
      else kp.unknown++;
    });
    var pct = kp.total ? kp.long / kp.total * 100 : 0;
    $('kjProgDone').textContent = kp.long;
    $('kjProgTotal').textContent = '/ ' + kp.total + ' 자';
    $('kjProgPct').innerHTML = (pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)) + '<i>%</i>';
    var seg = function (n, cls) {
      return n ? '<i class="' + cls + '" style="width:' + (n / (kp.total || 1) * 100).toFixed(3) + '%"></i>' : '';
    };
    $('kjProgSeg').innerHTML = seg(kp.long, 'long') + seg(kp.short, 'short') + seg(kp.unknown, 'unknown');

    // 지금 구간의 단어(한자가 여럿인 단어는 한 번만) 통계와 학습 버튼
    stepWords = [];
    var seen = {};
    list.forEach(function (x) {
      (kanjiIndex()[x.k] || []).forEach(function (e) {
        var key = e.day + '-' + (e.w.no || e.w.word);
        if (seen[key]) return;
        seen[key] = 1;
        stepWords.push(e);
      });
    });
    var ws = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    stepWords.forEach(function (e) { ws.total++; ws[Store.stageFor(e.day, e.w)]++; });
    $('kanjiStats').innerHTML = statHTML(ws, true);

    // 복습은 '한자 모드에서 공부한 단어' 만 낸다. Day 학습으로 본 단어는 섞지 않는다.
    var seen = stepWords.filter(function (e) { return Store.isKanjiSeen(e.day, e.w); });
    stepDue = seen.filter(function (e) { return Store.isDue(e.day, e.w); });
    $('kjReviewCount').textContent = stepDue.length
      ? stepDue.length + '개 대기 · 한자로 공부한 ' + seen.length + '단어 중'
      : (seen.length ? '한자로 공부한 ' + seen.length + '단어, 지금은 없음' : '아직 한자로 공부한 단어가 없음');
    $('btnKanjiReview').disabled = !stepDue.length;
    $('kjStudyCount').textContent = stepWords.length + '단어';
    $('btnKanjiStudy').disabled = !stepWords.length;

    // 주의할 단어와 시험 기록도 한자 쪽 것만 센다.
    var marked = kanjiMarked();
    $('kjMarkedCount').textContent = marked.length ? marked.length + '개' : '아직 없음';
    $('btnKjMarked').disabled = !marked.length;
    var exams = kanjiExams();
    $('kjExamCount').textContent = exams.length + '회';
    $('btnKjExams').disabled = !exams.length;

    var hidden = Object.keys(covered).length;
    $('kanjiSub').textContent = list.length + '자 · 다 외운 한자 ' + done + ' · 복습할 것이 있는 한자 ' + due +
      (KANJI_STEPS[kanjiStep].lo === 1 && hidden ? ' · 앞 구간 단어에 다 들어 있는 ' + hidden + '자는 뺌' : '');

    $('kanjiGrid').innerHTML = list.map(function (x) {
      var full = x.s.long === x.s.n;
      var t = x.s.n || 1;
      var pct = function (n) { return (n / t * 100).toFixed(2) + '%'; };
      return '<button type="button" class="kj-cell' + (full ? ' done' : '') + (kjIsSel(x.k) ? ' sel' : '') +
        '" data-k="' + esc(x.k) + '">' +
        '<span class="kj-char" lang="ja">' + esc(x.k) + '</span>' +
        // 장기기억 · 단기기억 · 모름(미학습 포함). 색은 Day 칸·홈 통계와 같다.
        '<span class="kj-nums">' +
          '<i class="n-long">' + x.s.long + '</i>' +
          '<i class="n-short">' + x.s.short + '</i>' +
          '<i class="n-unknown">' + x.s.unknown + '</i>' +
        '</span>' +
        '<span class="dbar">' +
          '<i class="b-long" style="width:' + pct(x.s.long) + '"></i>' +
          '<i class="b-short" style="width:' + pct(x.s.short) + '"></i>' +
          '<i class="b-unknown" style="width:' + pct(x.s.unknown) + '"></i>' +
        '</span>' +
        (x.s.due ? '<span class="kj-due">' + x.s.due + '</span>' : '') +
      '</button>';
    }).join('');
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
    renderSet(list, '한자 ' + c, list.length + '단어 · Day 순', true, kanjiInfoHTML(c), 'kanji');
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
    var rep = repWords().length;
    $('posChips').innerHTML = POS_GROUPS.map(function (g) {
      var n = wordsOfPos(g.has).length;
      if (!n) return '';
      return '<button class="chip pos-chip pos-' + g.key + '" data-has="' + esc(g.has) + '">' +
        esc(g.label) + '<i>' + n + '</i></button>';
    }).join('') +
    (rep ? '<button class="chip rep-chip" id="chipRep">반복어<i>' + rep + '</i></button>' : '');
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
        markBtnHTML(day, w, 'sm') +
        '<span class="wl-side">' + Store.STAGE_LABEL[st] + rateHTML(r) +
          (showDay ? '<span class="wl-day">' + dayOf(day, w) + '</span>' : (r.seen ? '<span class="wl-day">Lv.' + r.level + '</span>' : '')) +
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
          '<span class="card-meta-right"><span class="card-no">' + dayOf(e.day, e.w) + (e.w.no ? ' · ' + e.w.no : '') + '</span>' + markBtnHTML(e.day, e.w) + '</span>' +
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

  // 학습을 어디서 시작했는지. 나갈 때 그 화면으로 돌아간다.
  var studyFrom = 'home';

  // src 가 'kanji' 면 한자 모드에서 시작한 학습이다. 푼 단어를 한자 모드 쪽에 적어 두고,
  // 한자 모드의 복습은 그 단어들만 다시 낸다.
  function startSession(entries, label, timed, src) {
    if (!entries.length) return;
    studyFrom = (src === 'kanji') ? 'kanji' : 'home';
    session = {
      src: src || '',
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

  var saveWarned = false;

  function persistSession() {
    if (!session) return;
    var ok = Store.saveSession({
      label: session.label,
      src: session.src || '',
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
    // 저장이 안 되면 이어하기도 없다. 모르고 지나가면 공부한 자리를 잃는다.
    if (!ok && !saveWarned) {
      saveWarned = true;
      var si = Store.storageInfo();
      toast('저장 공간이 꽉 차 이어하기를 저장하지 못했습니다 (' +
        Math.round(si.used / 1024) + 'KB / ' + Math.round(si.limit / 1024) + 'KB)');
    }
  }

  function hydrate(ref) {
    // 두 책에 같이 실린 단어는 N2 쪽으로 옮겨졌을 수 있다. locate 가 옮겨진 곳까지 찾아 준다.
    return Store.locate(ref.d, ref.n, ref.w);
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
      label: s.label || '학습', src: s.src || '', dir: s.dir || 'jp2ko', results: results
    };
  }

  // 이어하기 버튼 하나를 채운다. 풀다 만 것이 있을 때만 나온다.
  // onlyKanji 는 한자 화면용. 한자 쪽에서 시작한 것만 받는다.
  function fillResume(btnId, infoId, onlyKanji) {
    var b = $(btnId);
    var s = restoreSession();
    if (s && (!onlyKanji || s.src === 'kanji')) {
      b.hidden = false;
      $(infoId).textContent = s.label + ' · ' + s.done + ' / ' + s.total;
      return 'live';
    }
    b.hidden = true;
    return '';
  }

  function renderResume() { fillResume('btnResume', 'resumeInfo', false); }

  // 한자 화면의 이어하기. 한자 쪽에서 시작한 학습일 때만 나온다.
  function renderKjResume() { fillResume('btnKjResume', 'kjResumeInfo', true); }

  function resumeSession() {
    var s = restoreSession();
    if (!s) { goView(view === 'kanji' ? 'kanji' : 'home'); return; }
    session = s;
    studyFrom = (s.src === 'kanji') ? 'kanji' : 'home';
    show('study');
    renderCard();
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
    $('studyBar').hidden = false;
    var e = session.queue[session.index];
    var st = Store.stageFor(e.day, e.w);

    $('cardBadge').textContent = Store.STAGE_LABEL[st];
    $('cardBadge').className = 'badge ' + st;
    $('cardNo').textContent = dayOf(e.day, e.w) + (e.w.no ? ' · ' + e.w.no : '');
    $('btnMark').dataset.mark = Store.keyOf(e.day, e.w);
    $('btnMark').classList.toggle('on', Store.isMarked(e.day, e.w));
    $('btnMark').setAttribute('aria-pressed', Store.isMarked(e.day, e.w));
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
    var g = (session.timed || isRetryNow(e)) ? null : Store.gapPreview(e.day, e.w);
    // 타임어택과 이 판에서 다시 나온 단어는 아무것도 안 바뀐다('그대로').
    // 복습일 전에 미리 푸는 단어는 맞히면 그대로, 틀리면 내려간다. 그대로 적어 준다.
    $('gapOk').textContent = (!g || g.early) ? '그대로' : gapDayLabel(g.okDays);
    $('gapOk').className = 'ox-gap' + (g && !g.early && g.okLong ? ' long' : '');
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
      // O 나 X 를 누르면 바로 넘어가므로 '다음' 버튼은 쓸 일이 없다.
      $('answerBox').hidden = false;
      // 정답을 봤으니 예문을 후리가나까지 붙여 다시 그린다.
      // 문제를 푸는 동안에는 읽는 법이 새면 안 되므로 한자만 보여줬다.
      var e = session.queue[session.index];
      $('detailBox').innerHTML = detailHTML(e.w, true);
      $('detailBox').className = 'detail-box'; // 해석·문형 공개
      // 예문이 없는 단어는 문제를 푸는 동안 이 칸이 비어 숨겨져 있었다.
      // 정답을 본 뒤에는 한자 풀이가 들어가므로 다시 열어 준다.
      $('detailBox').hidden = !$('detailBox').innerHTML;
      $('checkBox').hidden = false;
      $('btnCardDetail').hidden = false;
    }
  }

  // 읽는 법과 뜻을 따로 묻지 않는다. 알았으면 O, 아니면 X 하나로 끝낸다.
  // 기록에는 여전히 둘 다에 같은 값이 들어간다. 예전 진도와 오답률이 그대로 이어진다.
  function bothOk() {
    if ($('checkBox').hidden) return;
    picked.reading = 1; picked.meaning = 1;
    next();
  }

  function bothNo() {
    if ($('checkBox').hidden) return;
    picked.reading = 0; picked.meaning = 0;
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
        '<span class="card-meta-right"><span class="card-no">' + dayOf(e.day, w) + (w.no ? ' · ' + w.no : '') + '</span>' + markBtnHTML(e.day, w) + '</span>' +
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
    $('studyBar').hidden = true;

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
    $('studyBar').hidden = false;
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
          '<span class="card-meta-right"><span class="card-no">' + dayOf(x.day, x.w) + (x.w.no ? ' · ' + x.w.no : '') + '</span>' + markBtnHTML(x.day, x.w) + '</span>' +
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
    $('studyBar').hidden = true;
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

  // 이 판에서 이미 틀려 다시 나온 단어인가. 다시 나온 것을 맞히는 건 방금 본 것을 되뇌는 것이라
  // 외웠다는 증거가 못 된다. 그래서 레벨과 복습일을 올리지 않고 기록만 남긴다(연습).
  // 시계로만 보면 판이 길어질 때(복습이 밀려 몇백 개일 때) 한 시간이 지나 버려 레벨이 올라갔다.
  function isRetryNow(e) {
    return !!(session && session.miss && session.miss[sessKey(e)]);
  }

  function next() {
    if (picked.reading === null || picked.meaning === null) return;
    var e = session && session.queue[session.index];
    if (!e) return;                 // 판이 이미 끝난 뒤에 버튼이 한 번 더 눌린 경우
    var ok = (picked.reading === 1 && picked.meaning === 1);
    var rec = Store.grade(e.day, e.w, picked.reading === 1, picked.meaning === 1,
      session.timed ? 'timed' : 'jp2ko', !!session.timed || isRetryNow(e));
    if (session.src === 'kanji') Store.markKanjiSeen(e.day, e.w);
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
    // 여기서 자동으로 올리지 않는다. 올리기는 클라우드를 이 기기 내용으로 덮는 일이라,
    // 다른 기기가 올려 둔 이어하기를 말없이 지워 버린다. 실제로 그것 때문에
    // 폰에서 올린 학습이 PC 에서 안 받아졌다. 올릴 것이 생겼다는 표시만 남긴다.
    if (global_Sync()) Sync.touch();
    $('progressFill').style.width = '100%';
    $('progressText').textContent = session.total + ' / ' + session.total;
    // 틀린 단어는 맞힐 때까지 다시 나왔으므로 기록에 같은 단어가 여러 번 있다.
    // 결과는 단어 단위로 센다. 무엇을 몇 번 만났는지가 아니라 무엇이 어려웠는지가 궁금한 것이다.
    var res = distinctResults();
    var perfect = res.filter(function (x) { return x.firstOk; }).length;
    saveExam(res);
    fillResult(res, res.length + '단어 중 ' + perfect + '개를 한 번에', '', studyFrom);
  }

  // 밀린 복습이 많을 때 여기까지만 하고 끊는다.
  // 푼 단어는 이미 채점되어 진도에 들어갔으므로, 남은 것만 다음 '오늘의 복습' 에 다시 뜬다.
  function stopSession() {
    if (!session) return;
    var res = distinctResults();
    if (!res.length) {                 // 한 문제도 풀지 않았으면 결과를 낼 것이 없다
      Store.clearSession();
      goView(studyFrom);
      return;
    }
    var left = Math.max(0, session.queue.length - session.index) + session.retry.length;
    var perfect = res.filter(function (x) { return x.firstOk; }).length;
    $('progressFill').style.width = Math.round(session.index / Math.max(1, session.total) * 100) + '%';
    $('progressText').textContent = session.index + ' / ' + session.total;
    saveExam(res);
    Store.clearSession();              // 이어하기로 남기지 않는다. 남은 단어는 복습 목록에 그대로 있다.
    if (global_Sync()) Sync.touch();
    fillResult(res, res.length + '단어 중 ' + perfect + '개를 한 번에',
      left ? '여기까지 하고 멈췄습니다. 남은 ' + left + '단어는 복습 목록에 그대로 있습니다.' : '', studyFrom);
  }

  function resultItemHTML(x) {
    var st = Store.stageOf(x.level, 1);
    var detail = detailHTML(x.w, true);
    // 다시 나왔던 단어는 마지막에 결국 O 라서 O·X 를 적어 봐야 소용없다.
    // 몇 번 만에 맞혔는지가 그 단어의 성적이다.
    var mark = x.known ? '이미 아는 단어'
      : (x.tries > 1 ? x.tries + '번 만에 맞힘' : (x.r ? '한 번에 맞힘' : '틀림'));
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
        markBtnHTML(x.day, x.w, 'sm') +
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

  /* ---------------- 주의할 단어 ---------------- */
  // 공부하다 헷갈리는 단어에 별을 붙여 따로 모은다. 진도와는 상관없다.
  // 카드든 목록이든 어디서 누르든 같은 단어의 별이 한꺼번에 바뀐다.

  function markBtnHTML(day, w, cls) {
    var k = Store.keyOf(day, w), on = Store.isMarkedKey(k);
    return '<button type="button" class="mark-btn' + (cls ? ' ' + cls : '') + (on ? ' on' : '') + '"' +
      ' data-mark="' + esc(k) + '" aria-pressed="' + on + '"' +
      ' title="주의할 단어 (*)" aria-label="주의할 단어">★</button>';
  }

  function toggleMark(k) {
    var on = Store.toggleMarkKey(k);
    $$('.mark-btn[data-mark]').forEach(function (b) {
      if (b.dataset.mark !== k) return;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    if (global_Sync()) Sync.touch();
  }

  // 지금 화면에 떠 있는 단어의 키. 키보드 * 가 이 단어의 별을 바꾼다.
  function currentMarkKey() {
    if (view === 'browse' && browse && browse.list && browse.list[browse.index]) {
      var b = browse.list[browse.index];
      return Store.keyOf(b.day, b.w);
    }
    if (view === 'study' && session) {
      var e = peek !== null ? session.results[peek] : session.queue[session.index];
      if (e) return Store.keyOf(e.day, e.w);
    }
    return null;
  }

  /* ---------------- 접두어·접미어 ---------------- */
  // N2 단어장에 따로 실린 표를 탭으로 나눠 훑어본다. 예시 단어는 눌러서 사전으로 간다.
  var affixTab = 'pre';

  function renderAffix() {
    var af = Store.getAffixes();
    if (!af) return;
    var list = affixTab === 'pre' ? af.prefixes : af.suffixes;
    $('affixSub').textContent = '접두어 ' + af.prefixes.length + ' · 접미어 ' + af.suffixes.length;
    $('tabPre').textContent = '접두어 ' + af.prefixes.length;
    $('tabSuf').textContent = '접미어 ' + af.suffixes.length;
    $('tabPre').classList.toggle('sel', affixTab === 'pre');
    $('tabSuf').classList.toggle('sel', affixTab !== 'pre');
    $('affixList').innerHTML = list.map(function (x) {
      return '<div class="wl-item af-item">' +
        '<div class="wl-head"><span class="wl-main">' +
          '<span class="wl-word" lang="ja">' + esc(x.word) +
            (x.reading ? '<span class="wl-reading">' + esc(x.reading) + '</span>' : '') +
          '</span>' +
          '<div class="wl-meaning">' + esc(x.meaning) + '</div>' +
        '</span></div>' +
        (x.examples.length
          ? '<div class="af-ex">' + x.examples.map(function (e) {
              return '<span class="af-one">' +
                '<span class="af-w" lang="ja">' + dictHTML(e.word) + '</span>' +
                (e.reading ? '<span class="af-r" lang="ja">' + esc(e.reading) + '</span>' : '') +
                '<span class="af-m">' + esc(e.meaning) + '</span>' +
              '</span>';
            }).join('') + '</div>'
          : '') +
      '</div>';
    }).join('');
  }

  /* ---------------- 문단 읽기 ---------------- */
  // 한 Day 의 단어를 모두 넣어 지은 글을 읽는다. 채점하지 않고 진도도 건드리지 않는다.
  // 처음에는 한자만 보인다. 읽는 법을 떠올려 본 뒤 뜻 보기를 누르면
  // 그 문단에만 후리가나와 해석, 들어 있는 단어가 나온다.
  // 외울 단어는 글 속에 색으로 표시해 두고, 뜻을 연 뒤에는 눌러서 상세 창을 띄울 수 있다.
  var storyDay = 0, storySet = 1, storyFrom = 'stories';
  var storyWords = [];   // 지금 화면에 그린 단어들. data-w 가 이 배열의 자리다.

  // Day 제목은 단어장 쪽을 따른다. 글 파일의 제목은 짧게 적어 둔 것이라.
  function storyDayTitle(s) {
    var d = Store.getDay(s.day);
    return (d && d.title) || s.title;
  }

  // 같은 Day 의 글이 여러 편이면 한 칸으로 묶는다. 편은 글 화면의 탭에서 고른다.
  function storyDays() {
    var out = [], at = {};
    Store.storyList().forEach(function (s) {
      if (at[s.day] === undefined) { at[s.day] = out.length; out.push({ day: s.day, first: s, n: 0 }); }
      out[at[s.day]].n++;
    });
    return out;
  }

  function renderStories() {
    var days = storyDays(), total = 0;
    days.forEach(function (d) { total += d.n; });
    $('storiesSub').textContent = days.length + ' Day · ' + total + '편';
    $('storyGrid').innerHTML = days.map(function (d) {
      return '<button class="day-cell" data-day="' + d.day + '">' +
        '<span class="dn">DAY ' + d.day + (d.n > 1 ? '<small class="st-n">' + d.n + '편</small>' : '') + '</span>' +
        '<span class="dt">' + esc(storyDayTitle(d.first)) + '</span>' +
      '</button>';
    }).join('');
  }

  // 漢字[かな] 를 글자 단위로 편다. 후리가나가 붙은 덩어리는 한 칸, 나머지는 한 글자가 한 칸.
  function storyUnits(jp) {
    var units = [], last = 0, r = rubyRe(), x;
    var plain = function (t) {
      for (var i = 0; i < t.length; i++) units.push({ b: t.charAt(i), rt: '' });
    };
    while ((x = r.exec(jp)) !== null) {
      plain(jp.slice(last, x.index));
      units.push({ b: x[1], rt: x[2] });
      last = x.index + x[0].length;
    }
    plain(jp.slice(last));
    return units;
  }

  // 단어마다 글 속 어느 칸에 있는지 찾아 칸의 주인을 정한다.
  // 칸 경계에 딱 맞고 아직 주인이 없는 자리를 먼저 쓴다. 音楽 속의 楽 같은 곳을 피하려는 것.
  // 그런 자리가 없으면(二年生 속의 年生) 처음 나온 자리를 쓴다.
  function storyOwners(units, words, idx) {
    var plain = '', at = [], isStart = {}, isEnd = {};
    units.forEach(function (u) {
      isStart[plain.length] = 1;
      at.push(plain.length);
      plain += u.b;
      isEnd[plain.length] = 1;
    });
    var owner = units.map(function () { return -1; });
    var free = function (s, e) {
      for (var i = 0; i < units.length; i++) {
        if (at[i] < e && at[i] + units[i].b.length > s && owner[i] > -1) return false;
      }
      return true;
    };
    words.forEach(function (x, wi) {
      var f = x.form;
      if (!f || idx[wi] < 0) return;
      var pos = -1, first = -1, k = plain.indexOf(f);
      while (k > -1) {
        if (first < 0) first = k;
        if (isStart[k] && isEnd[k + f.length] && free(k, k + f.length)) { pos = k; break; }
        k = plain.indexOf(f, k + 1);
      }
      if (pos < 0) pos = first;
      if (pos < 0) return;
      var end = pos + f.length;
      units.forEach(function (u, i) {
        if (owner[i] < 0 && at[i] < end && at[i] + u.b.length > pos) owner[i] = idx[wi];
      });
    });
    return owner;
  }

  function storyUnitHTML(u) {
    return u.rt ? '<ruby>' + esc(u.b) + '<rt>' + esc(u.rt) + '</rt></ruby>' : esc(u.b);
  }

  function storyParaHTML(day, p) {
    var idx = p.words.map(function (x) {
      var hit = x.no != null ? Store.locate(day, x.no, null) : null;
      if (!hit) return -1;
      storyWords.push(hit);
      return storyWords.length - 1;
    });
    var units = storyUnits(p.jp);
    var owner = storyOwners(units, p.words, idx);

    var text = '', i = 0;
    while (i < units.length) {
      var o = owner[i];
      if (o < 0) { text += storyUnitHTML(units[i]); i++; continue; }
      var s = '';
      while (i < units.length && owner[i] === o) { s += storyUnitHTML(units[i]); i++; }
      text += '<mark data-w="' + o + '">' + s + '</mark>';
    }

    var list = idx.filter(function (n) { return n > -1; }).map(function (n) {
      var e = storyWords[n];
      return '<button type="button" class="ds-item" data-w="' + n + '">' +
        '<span class="ds-item-w" lang="ja">' + esc(e.w.word) + '</span>' +
        '<span class="ds-item-r" lang="ja">' + esc(readingOf(e.w) || '') + '</span>' +
        '<span class="ds-item-m">' + esc(e.w.meaning) + '</span>' +
      '</button>';
    }).join('');

    // 뜻 보기는 글 위에 둔다. 긴 문단이면 아래에 두었을 때 버튼을 찾아 스크롤해야 한다.
    return '<div class="st-para">' +
      // 급수는 뜻 보기와 한 줄에 작게 둔다. 급수를 안 매긴 문단이면 버튼만 나온다.
      '<div class="st-head">' +
        (p.level ? '<span class="st-lv">' + esc(p.level) + '</span>' : '') +
        '<button type="button" class="mini-btn go st-toggle">뜻 보기</button>' +
      '</div>' +
      '<p class="st-jp" lang="ja">' + text + '</p>' +
      '<div class="st-more" hidden>' +
        '<p class="st-ko">' + esc(p.ko) + '</p>' +
        '<div class="ds-list st-words">' + list + '</div>' +
      '</div>' +
    '</div>';
  }

  // set 을 주지 않으면 지금 보던 편을 이어 간다. 그 Day 에 그 편이 없으면 1편부터.
  function openStory(day, from, set) {
    var sets = Store.storySets(day);
    if (!sets.length) return;
    var want = set || storySet, s = sets[0];
    sets.forEach(function (x) { if (x.set === want) s = x; });
    if (from) storyFrom = from;
    storyDay = day;
    storySet = s.set;
    storyWords = [];
    var n = 0;
    s.paragraphs.forEach(function (p) { n += p.words.length; });
    $('storyTitle').textContent = 'DAY ' + day;
    $('storySub').textContent = storyDayTitle(s) + ' · ' + n + '단어';
    $('storySets').hidden = sets.length < 2;
    $('storySets').innerHTML = sets.length < 2 ? '' : sets.map(function (x) {
      return '<button type="button" class="res-tab' + (x.set === s.set ? ' sel' : '') + '" data-set="' + x.set + '">' +
        x.set + '편</button>';
    }).join('');
    $('storyParas').innerHTML = s.paragraphs.map(function (p) { return storyParaHTML(day, p); }).join('');

    var list = storyDays(), at = -1;
    list.forEach(function (x, i) { if (x.day === day) at = i; });
    var nav = function (btn, x, label) {
      btn.hidden = !x;
      btn.dataset.day = x ? x.day : '';
      btn.textContent = x ? label.replace('#', x.day) : '';
    };
    nav($('stPrev'), list[at - 1], '‹ DAY #');
    nav($('stNext'), list[at + 1], 'DAY # ›');
    show('story');
    window.scrollTo(0, 0);
  }

  /* ---------------- 결과 화면 채우기 ---------------- */
  // 방금 끝낸 판과 시험 기록에서 다시 연 판이 같은 화면을 쓴다.
  // from 은 뒤로가기가 돌아갈 곳이다. 기록에서 열었으면 기록 목록으로 돌아간다.
  var resultRetry = [], resultFrom = 'home';

  function fillResult(res, title, meta, from) {
    var wrong = res.filter(function (x) { return !x.firstOk; });

    $('resultSub').textContent = title;
    $('resultMeta').textContent = meta || '';
    $('resultMeta').hidden = !meta;

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
    resultRetry = wrong.map(function (x) { return { day: x.day, w: x.w }; });
    resultFrom = from || 'home';
    show('result');
  }

  /* ---------------- 시험 기록 ---------------- */
  // 한 판을 끝낼 때마다 그 판에서 무엇을 틀렸는지 남긴다. 기록일 뿐 진도는 건드리지 않는다.
  // 단어 내용이 아니라 (Day, 번호, 글자) 참조만 남긴다. 쌓여도 가볍고 기기가 달라도 맞는다.

  var EXAM_DIR = { jp2ko: '일본어 → 뜻', ko2jp: '뜻 → 일본어', timed: '타임어택' };

  function saveExam(res) {
    if (!session || session.recorded || !res.length) return;
    session.recorded = true;
    Store.addExam({
      at: Date.now(),
      label: session.label || '학습',
      dir: session.timed ? 'timed' : (session.dir || 'jp2ko'),
      it: res.map(function (x) {
        var o = { d: x.day, w: x.w.word, t: x.tries || 1, l: x.level || 0 };
        if (x.w.no != null) o.n = x.w.no;
        if (x.firstOk) o.f = 1;
        if (x.r) o.r = 1;
        if (x.known) o.k = 1;
        return o;
      })
    });
  }

  function examItems(rec) {
    var it = rec.it;
    if (it && !Array.isArray(it)) it = Object.keys(it).map(function (k) { return it[k]; });
    return (it || []).filter(Boolean);
  }

  // 날짜마다 몇 번째 시험인지 매긴다. 폰과 PC 기록이 섞여도 시각 순서대로 센다.
  function numberedExams() {
    var perDay = {};
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return Store.examList().map(function (rec) {
      var d = new Date(rec.at);
      var date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      perDay[date] = (perDay[date] || 0) + 1;
      return { rec: rec, date: date, time: p(d.getHours()) + ':' + p(d.getMinutes()), no: perDay[date] };
    });
  }

  function examMeta(rec) {
    return (rec.label || '학습') + (EXAM_DIR[rec.dir] ? ' · ' + EXAM_DIR[rec.dir] : '');
  }

  // 한자 쪽에서 들어오면 한자 학습 기록만 보여 준다. 뒤로가기도 한자 화면으로 간다.
  var examsOnlyKanji = false;

  function renderExams() {
    var rows = numberedExams().reverse();   // 최근 것이 위
    if (examsOnlyKanji) rows = rows.filter(function (x) { return /^한자/.test(String(x.rec.label || '')); });
    $('examsSub').textContent = rows.length + '회' + (examsOnlyKanji ? ' · 한자 학습' : '');
    $('examsEmpty').hidden = rows.length > 0;
    $('examList').innerHTML = rows.map(function (x) {
      var items = examItems(x.rec);
      var wrong = items.filter(function (o) { return !o.f; }).length;
      return '<button class="ex-row" data-id="' + esc(x.rec.id) + '">' +
        '<span class="ex-main">' +
          '<span class="ex-when">' + x.date + ' ' + x.time + '</span>' +
          '<span class="ex-no">' + x.no + '회</span>' +
          '<span class="ex-label">' + esc(examMeta(x.rec)) + '</span>' +
        '</span>' +
        '<span class="ex-side">' +
          '<span class="ex-wrong' + (wrong ? '' : ' zero') + '">' + (wrong ? '틀림 ' + wrong : '다 맞힘') + '</span>' +
          '<span class="ex-total">' + items.length + '단어</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  function openExam(id) {
    var x = null;
    numberedExams().forEach(function (e) { if (e.rec.id === id) x = e; });
    if (!x) return;
    var res = [];
    examItems(x.rec).forEach(function (o) {
      var hit = Store.locate(o.d, o.n != null ? o.n : null, o.w);
      if (!hit) return;   // 그 사이 단어 데이터가 바뀌어 못 찾으면 뺀다
      res.push({ day: hit.day, w: hit.w, r: !!o.r, m: !!o.r, level: o.l || 0,
                 known: !!o.k, tries: o.t || 1, firstOk: !!o.f });
    });
    var perfect = res.filter(function (e) { return e.firstOk; }).length;
    fillResult(res, x.date + ' ' + x.time + ' · ' + x.no + '회',
      examMeta(x.rec) + ' · ' + res.length + '단어 중 ' + perfect + '개를 한 번에', 'exams');
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

  // 클라우드에 지금 올라와 있는 것. 받기를 누르기 전에도 보이게 겉표지만 읽어 온다.
  // '올리기 13시간 전' 은 이 기기가 올린 때라서, 폰에서 방금 올린 것과 헷갈렸다.
  function renderCloud() {
    var el = $('syncCloud');
    if (!el) return;
    el.textContent = '확인 중…';
    Sync.peek().then(function (r) {
      if (!r || r.offline) { el.textContent = '인터넷이 끊겨 있어 확인 못 함'; return; }
      if (r.signedOut) { el.textContent = '로그인하면 보입니다'; return; }
      if (r.err) { el.textContent = '확인 실패 — ' + r.err; return; }
      if (!r.at) { el.textContent = '아직 아무것도 없음'; return; }
      var t = new Date(r.at).getTime();
      var who = r.device
        ? (r.device === Store.deviceId() ? '이 기기' : '다른 기기')
        : '';
      el.textContent = fmtAgo(t) + ' 올린 것' + (who ? ' · ' + who : '') +
        (t > (Sync.status().lastDown || 0) ? ' · 아직 안 받음' : ' · 받아 둠');
    }).catch(function () { el.textContent = '확인 실패'; });
  }

  function renderSync(st) {
    $('btnSyncTop').hidden = !st.configured;
    if (!st.configured) return;

    // 아이콘(svg)은 그대로 두고 상태만 색으로 알린다.
    // 예전에는 여기서 textContent 로 이모지를 넣어 svg 를 지워 버렸다.
    // 자동으로 올리지 않으므로, 마지막 올리기 이후에 바뀐 것이 있으면 표시한다.
    var unsent = st.signedIn && Store.lastChange() > (st.lastUp || 0);
    $('btnSyncTop').classList.toggle('spin', st.busy);
    $('btnSyncTop').classList.toggle('on', st.signedIn && !unsent);
    $('btnSyncTop').classList.toggle('wait', !!unsent);
    $('btnSyncTop').classList.toggle('off', !st.signedIn);
    // 돌고 있을 때는 어느 쪽으로 가는 중인지 아이콘 옆 화살표로 알린다.
    $('btnSyncTop').classList.toggle('dn', st.phase === 'down');
    $('btnSyncTop').classList.toggle('up', st.phase === 'up');
    $('btnSyncTop').title = st.phase === 'down' ? '클라우드에서 받는 중'
      : st.phase === 'up' ? '이 기기 기록을 올리는 중'
      : unsent ? '올리지 않은 기록이 있습니다 — 눌러서 올리기'
      : st.signedIn
        ? '올릴 것 없음 · ' + st.email
        : '로그인 안 됨 — 눌러서 로그인';

    $('syncOut').hidden = st.signedIn;
    $('syncIn').hidden = !st.signedIn;
    // 로그인 화면에서는 받기·올리기 줄이 가려져 있다. 막힌 이유를 여기서라도 알려 준다.
    if (!st.signedIn && st.result && st.result.err) showSyncErr('syncErr', st.result.err);
    $('syncBuild').textContent = BUILD;
    var si = Store.storageInfo();
    var pct = Math.round(si.used / si.limit * 100);
    $('syncStore').textContent = Math.round(si.used / 1024) + ' / ' + Math.round(si.limit / 1024) + 'KB · ' + pct + '%' +
      (si.err ? ' · 저장 실패함' : '');
    $('syncStore').classList.toggle('bad', pct >= 95 || !!si.err);
    // v45 가 잘못 올린 것을 v47 이 되돌렸다. 무엇이 걸렸는지 볼 수 있게 한다.
    var undone = Store.undoneWords();
    $('undoRow').hidden = !undone.length;
    if (undone.length) $('btnUndoList').textContent = undone.length + '개 목록 보기';

    if (st.signedIn) {
      $('syncWho').textContent = st.email;
      renderSyncDir(st);
      var off = st.busy || !st.online;
      $('btnSyncDown').disabled = off;
      $('btnSyncUp').disabled = off;
      $('btnSyncDown').textContent = st.phase === 'down' ? '받는 중…' : (st.online ? '받기' : '오프라인');
      $('btnSyncUp').textContent   = st.phase === 'up'   ? '올리는 중…' : (st.online ? '올리기' : '오프라인');
    } else if (st.email) {
      $('syncEmail').value = $('syncEmail').value || st.email;
    }
  }

  /* ---------------- 동기화 방향 표시 ---------------- */
  // 받기와 올리기를 한 줄씩 따로 보여준다. 예전에는 '마지막 동기화' 한 줄뿐이라
  // 올라간 것인지 내려온 것인지, 반만 되고 멈춘 것인지 알 수 없었다.

  // 합친 결과를 사람이 읽는 한 줄로.
  // theirs 와 dates 만 쓴다. days·gram 은 같은 내용을 다시 받아도 올라가는 수라
  // '새로 받은 것'을 뜻하지 않는다. 그걸 적으면 매번 Day 50개 받았다고 거짓말을 한다.
  // 클라우드에 놓인 것이 어느 기기가 언제 올린 것인지. 올리기가 닿았는지를 여기서 본다.
  function cloudNote(r) {
    var bits = [];
    if (r.remoteAt) {
      var d = new Date(r.remoteAt);
      if (!isNaN(d)) bits.push((d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ' 올린 것');
    }
    bits.push(r.remoteHasSession ? '학습 자리 있음' : '학습 자리 없음');
    return bits.join(' · ');
  }

  function mergeNote(m) {
    if (!m) return '';
    var bits = [];
    if (m.theirs) bits.push('진도 ' + m.theirs + '개');
    if (m.dates) bits.push('공부 시간 ' + m.dates + '일');
    if (m.exams) bits.push('시험 기록 ' + m.exams + '회');
    // 이어하기가 왜 왔는지/왜 안 왔는지는 따로 적는다. 제일 헷갈리는 자리다.
    var note = Store.sessionNote();
    bits.push(note || '이어하기 변화 없음');
    return bits.join(' · ');
  }

  function renderSyncDir(st) {
    var r = st.result;
    var down = $('stepDown'), up = $('stepUp');

    // 받기
    down.className = 'sync-step' + (st.phase === 'down' ? ' live' : '');
    if (st.phase === 'down') {
      $('syncDownV').textContent = '받는 중…';
      $('syncDownNote').textContent = '';
    } else {
      $('syncDownV').textContent = st.lastDown ? fmtAgo(st.lastDown) : '아직 없음';
      $('syncDownNote').textContent = (r && r.downAt)
        ? (r.found ? cloudNote(r) + ' — ' + mergeNote(r.merged) : '클라우드에 아직 아무것도 없음')
        : '';
      if (r && r.failedAt === 'down') {
        down.className = 'sync-step fail';
        $('syncDownNote').textContent = '실패' + (r.err ? ' — ' + r.err : '');
      }
    }

    // 올리기
    up.className = 'sync-step' + (st.phase === 'up' ? ' live' : '');
    if (st.phase === 'up') {
      $('syncUpV').textContent = '올리는 중…';
      $('syncUpNote').textContent = '';
    } else if (st.phase === 'down') {
      $('syncUpV').textContent = '기다림';
      $('syncUpNote').textContent = '';
    } else {
      $('syncUpV').textContent = st.lastUp ? fmtAgo(st.lastUp) : '아직 없음';
      $('syncUpNote').textContent = '';
      // 받기는 됐는데 올리기가 안 된 상태. 이게 제일 헷갈리던 자리라 못 박아 둔다.
      if (r && r.failedAt === 'up') {
        up.className = 'sync-step fail';
        $('syncUpNote').textContent = '실패' + (r.err ? ' — ' + r.err : ' — 이 기기 기록이 아직 안 올라갔습니다');
      }
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

  /* ---------------- 앱 업데이트 ---------------- */
  // 폰이 새 버전으로 안 넘어가던 이유는 서비스워커에 있었다.
  // 세 군데를 고쳤다. (1) 받아 온 파일을 브라우저 HTTP 캐시가 가로채 옛것을 주고
  // 그것이 다시 캐시에 덮이던 것, (2) sw.js 자체가 캐시돼 새 워커를 못 보던 것,
  // (3) 앱 목록에서 되살릴 때는 검사할 기회조차 없던 것.
  // 그래도 안 되면 사람이 직접 눌러 확인할 수 있어야 한다. 아래가 그 버튼이다.

  var wantReload = false;

  // 지금 앉아 있는 서비스워커가 몇 번인지 물어본다. 대답이 없으면 빈 문자열.
  function swVersion() {
    var sw = navigator.serviceWorker;
    if (!sw || !sw.controller) return Promise.resolve('');
    return new Promise(function (ok) {
      var ch = new MessageChannel(), done = false;
      ch.port1.onmessage = function (e) {
        done = true; ok((e.data && e.data.cache) || '');
      };
      try { sw.controller.postMessage({ ask: 'version' }, [ch.port2]); }
      catch (e) { return ok(''); }
      // 옛 서비스워커는 이 물음을 모른다. 대답이 없는 것도 답이다.
      setTimeout(function () { if (!done) ok('(옛 버전)'); }, 1200);
    });
  }

  function renderSwVersion() {
    var el = $('syncSw');
    if (!el) return;
    if (!navigator.serviceWorker) { el.textContent = '설치 안 됨'; return; }
    swVersion().then(function (v) {
      // 캐시 이름은 jvocab-v72 꼴이다. 뒤의 v72 만 보인다.
      var short = v ? v.replace(/^jvocab-/, '') : '설치 안 됨';
      el.textContent = short;
      el.classList.toggle('stale', !!v && short !== BUILD);
    });
  }

  // 새 워커가 설치되면 곧바로 자리를 넘겨받게 한다.
  function takeOver(w) {
    if (!w) return;
    var poke = function () {
      if (w.state === 'installed' || w.state === 'activated') {
        try { w.postMessage({ ask: 'skipWaiting' }); } catch (e) {}
      }
    };
    w.addEventListener('statechange', poke);
    poke();
  }

  function checkUpdate() {
    var b = $('btnUpdate');
    if (!navigator.serviceWorker) { toast('이 브라우저에서는 확인할 수 없습니다'); return; }
    b.disabled = true;
    b.textContent = '확인 중…';
    var reset = function (msg) {
      b.disabled = false;
      b.textContent = '업데이트 확인';
      if (msg) toast(msg);
      renderSwVersion();
    };
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return reset('설치되어 있지 않습니다');
      return reg.update().then(function () {
        var fresh = reg.installing || reg.waiting;
        if (!fresh) return reset('이미 최신입니다');
        b.textContent = '새 버전 받는 중…';
        wantReload = true;
        takeOver(fresh);
        // 자리를 넘겨받으면 controllerchange 가 새로 고친다.
        // 그게 안 와도 10초 뒤에는 그냥 새로 고친다. 받아는 놨으니 손해가 없다.
        setTimeout(function () { if (wantReload) location.reload(); }, 10000);
      });
    }).catch(function () { reset('확인 실패 — 인터넷을 확인해 주세요'); });
  }

  function bindUpdate() {
    var b = $('btnUpdate');
    if (b) b.addEventListener('click', checkUpdate);
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // 버튼을 눌러서 기다리던 중이면 바로 새로 고친다.
      // 그렇지 않으면 학습하다 화면이 날아가지 않게, 알리기만 한다.
      if (wantReload) { wantReload = false; location.reload(); return; }
      renderSwVersion();
      toast('새 버전이 준비됐습니다. 앱을 다시 열면 적용됩니다');
    });
  }

  function bindSync() {
    if (!global_Sync()) return;

    Sync.onChange(renderSync);
    renderSync(Sync.status());

    $('btnSyncTop').addEventListener('click', function () {
      showSyncErr('syncErr', ''); showSyncErr('syncErr2', '');
      pushNav();
      $('syncPanel').hidden = false;
      renderSwVersion();
      renderSync(Sync.status());
      renderCloud();
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

    $('btnSyncDown').addEventListener('click', function () {
      showSyncErr('syncErr2', '');
      Sync.down()
        .then(function () {
          renderHome();
          renderCloud();
          // 이어하기가 어떻게 됐는지는 제일 헷갈리는 자리다. 작은 글씨 말고 크게 알린다.
          var note = Store.sessionNote();
          if (note) toast(note);
        })
        .catch(function (e) { showSyncErr('syncErr2', syncError(e)); });
    });
    // 올리기는 클라우드를 이 기기 내용으로 덮는다. 되돌릴 수 없으니 한 번 묻는다.
    $('btnSyncUp').addEventListener('click', function () {
      var s = Store.summarizeAll();
      if (!confirm('이 기기의 기록을 클라우드에 덮어씁니다.\n' +
                   '학습한 단어 ' + (s.total - s['new']) + '개 · 장기기억 ' + s.long + '개\n\n' +
                   '다른 기기에만 있던 기록은 사라집니다. 계속할까요?')) return;
      showSyncErr('syncErr2', '');
      Sync.up()
        .then(function () { renderHome(); renderCloud(); })
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
  }

  /* ---------------- 백업 내보내기 ---------------- */

  // 남에게 주는 자료 파일. 단어·문법·글만 들어가고 학습 기록은 빠진다.
  // 받는 사람은 앱을 깐 뒤 [＋ 파일 불러오기] 로 이 파일 하나만 넣으면 된다.
  function exportDataFile() {
    var data = Store.exportData();
    var n = Object.keys(data.vocab || {}).length;
    saveJson(data, '자료', ' · ' + n + ' Day');
  }

  function exportBackup() {
    saveJson(Store.exportAll(), '', '');
  }

  function saveJson(obj, tag, note) {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    var name = 'jvocab-' + (tag ? tag + '-' : '') + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';

    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    toast(name + ' 저장' + (note || ''));
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

  /* ---------------- 시험 대비 (대학 수업) ---------------- */
  // 대학 일본어 수업 중간고사 대비. 자료는 Store.examData() 한 곳에서만 온다
  // (PC 는 data/exam.js 내장본, 폰은 받기로 받은 것). 이 파일에는 책 내용을 두지 않는다.
  // 푼 기록은 단어 진도와 따로 Store.examProg 에 쌓는다.
  //
  // 화면과 흐름은 단어 시험을 그대로 따른다.
  //   묶음 화면(Day 화면 꼴) → 풀기: 정답 보기 → O/X, 틀린 것은 이 판에서 섞어 다시 → 결과
  //   넘기며 보기: 정답·해설을 펼친 채 이전/다음.
  // 객관식이라 보기를 눌러 고를 수도 있다. 고르면 그 자리에서 채점되고 '다음' 만 남는다.
  // 모의고사만 시험처럼 끝에 한꺼번에 채점한다.

  var MID_KIND = {
    content: 'A 독해 · 내용', grammar: 'A 독해 · 문법', reading: 'A 단어 · 읽기',
    word: 'A 단어 · 뜻', blank: 'B 문법 · 빈칸', usage: 'B 문법 · 문장 찾기', vocab: '단어'
  };
  var MID_KIND_ORDER = ['content', 'grammar', 'reading', 'word', 'blank', 'usage'];
  var MID_NUM = ['①', '②', '③', '④'];
  // 모의고사 25문제를 이만큼씩 뽑는다. 범위가 네 과 + 2과 추가자료라 고르게 나눴다.
  var MID_QUOTA = { L2: 5, EX: 2, L6: 6, L9: 6, L10: 6 };

  var mid = null;        // 지금 푸는 판
  var midTick = null;    // 모의고사 시계
  var midSetCur = null;  // 보고 있는 문제 묶음 { key, title, sub, list }
  var midBrowse = null;  // 넘기며 보기 { list, index, label, from }
  var midRes = null;     // 결과 화면 { all, wrong, view, label, from }

  function midData() { return Store.examData(); }
  function midQs() { var d = midData(); return (d && d.questions) || []; }
  function midSetOf(q) { return q.set || ('L' + q.lesson); }
  function midSetName(set) {
    if (set === 'EX') return '2과 추가자료';
    if (/^LC/.test(set)) return '듣기 ' + String(set).slice(2) + '과';   // 듣기 수업 과별 단어장
    return String(set).replace('L', '') + '과';
  }
  function midIsWord(q) { return /^W:/.test(q.id); }   // 단어 목록으로 그 자리에서 만든 문제(기록 안 함)
  function midUnit(q) { return !q ? '문제' : (q.type === 'word' ? '단어' : (q.type === 'sent' ? '문장' : '문제')); }
  // 낼 차례. 본문 쓰기는 글 흐름대로 교재 순서, 나머지는 섞는다.
  function midOrder(list) {
    var sent = list.length && list.every(function (q) { return q.type === 'sent'; });
    return sent ? list.slice().sort(function (a, b) { return a.no - b.no; }) : shuffle(list.slice());
  }
  function midNo(q) { var m = /-(\d+)$/.exec(q.id); return m ? Number(m[1]) + '번' : '단어'; }

  function midLesson(set) {
    var d = midData();
    return d ? (d.lessons || []).filter(function (L) { return L.set === set; })[0] : null;
  }

  function midDday() {
    var d = midData();
    if (!d || !d.info || !d.info.date) return '';
    var ex = new Date(d.info.date);
    var a = new Date(ex.getFullYear(), ex.getMonth(), ex.getDate());
    var now = new Date();
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var n = Math.round((a - b) / 86400000);
    return n > 0 ? 'D-' + n : (n === 0 ? 'D-DAY' : '끝남');
  }

  // 마지막으로 푼 결과 기준(한 판에서 처음 낸 답). 다음에 한 번에 맞히면 틀린 문제에서 빠진다.
  function midStat(list) {
    var p = Store.examProg(), s = { n: list.length, done: 0, ok: 0, bad: 0 };
    list.forEach(function (q) {
      var r = p[q.id];
      if (!r) return;
      s.done++;
      if (r.ok) s.ok++; else s.bad++;
    });
    return s;
  }

  function midWrongList() {
    var p = Store.examProg();
    return midQs().filter(function (q) { return p[q.id] && !p[q.id].ok; });
  }

  function midBar(s) {
    var t = s.n || 1;
    return '<span class="dbar mid-bar">' +
      '<i class="b-long" style="width:' + (s.ok / t * 100).toFixed(2) + '%"></i>' +
      '<i class="b-unknown" style="width:' + (s.bad / t * 100).toFixed(2) + '%"></i></span>';
  }

  // 밑줄(__말__)을 그려 준다. 빈칸 （　　） 은 글자 그대로 둔다.
  function midText(s) {
    return esc(String(s || '')).replace(/__(.+?)__/g, function (all, w) {
      // 지시문의 「__　__の読み方」 처럼 비어 있는 밑줄은 시험지처럼 넓은 자리로 그린다.
      return /^[\s　]*$/.test(w) ? '<u class="mid-u mid-ph">　　　</u>' : '<u class="mid-u">' + w + '</u>';
    });
  }

  // 목록 한 줄에 보일 글. 지시문이 「…選びなさい」 같은 틀이면 지문 쪽이 그 문제를 더 잘 알려 준다.
  function midOneLine(q) {
    var s = (q.passage && /選びなさい|どれですか|ものを/.test(q.q)) ? q.passage : q.q;
    return String(s || '').replace(/\n/g, ' ');
  }

  /* ----- 시험 대비 첫 화면 ----- */

  function renderMid() {
    var d = midData();
    $('btnMidMock').disabled = !d;
    if (!d) {
      $('midHead').innerHTML = '<div class="card mid-head"><p class="sub">자료가 아직 없습니다. PC 에서 올리기 → 이 기기에서 받기.</p></div>';
      $('midKinds').innerHTML = '';
      $('midLessons').innerHTML = '';
      $('btnMidResume').hidden = true;
      $('btnMidWrong').disabled = true;
      return;
    }
    var info = d.info || {}, all = midQs(), s = midStat(all);
    $('midHead').innerHTML =
      '<div class="card mid-head">' +
        '<div class="mid-h1"><span class="mid-title">' + esc(info.title || '시험') + '</span>' +
          '<span class="mid-dday">' + midDday() + '</span></div>' +
        (info.when ? '<div class="mid-h2">' + esc(info.when) + '</div>' : '') +
        (info.format ? '<div class="mid-h2">' + esc(info.format) + '</div>' : '') +
        midBar(s) +
        '<div class="mid-h3">풀어 본 문제 ' + s.done + ' / ' + s.n + ' · 맞힘 ' + s.ok + ' · 틀림 ' + s.bad + '</div>' +
      '</div>';

    // 풀다 나온 판이 있으면 이어서 풀 수 있게.
    var live = mid && !mid.finished;
    $('btnMidResume').hidden = !live;
    if (live) {
      $('midResumeLabel').textContent = mid.mode === 'mock' ? '모의고사 이어서' : '이어서 풀기';
      $('midResumeInfo').textContent = mid.label + ' · ' + (mid.mode === 'mock'
        ? mid.picks.filter(function (x) { return x != null; }).length + ' / ' + mid.queue.length + ' 답함'
        : mid.done + ' / ' + mid.total);
    }
    $('midMockSub').textContent = (info.count || 25) + '문제 · ' + (info.minutes || 60) + '분 · 끝에 채점';
    var wrong = midWrongList();
    $('midWrongSub').textContent = wrong.length ? wrong.length + '문제' : '아직 없음';
    $('btnMidWrong').disabled = !wrong.length;

    $('midKinds').innerHTML = MID_KIND_ORDER.map(function (k) {
      var n = all.filter(function (q) { return q.kind === k; }).length;
      return n ? '<button class="chip" data-kind="' + k + '">' + MID_KIND[k] + ' <i>' + n + '</i></button>' : '';
    }).join('');

    midVocabMap = null; midReadMap = null;   // 받기로 단어장이 바뀌었을 수 있다
    var lessons = d.lessons || [];
    // 듣기 수업(lc) 과는 단어 모드에서 본다.
    $('midLessons').innerHTML = lessons.filter(function (L) { return !L.lc; }).map(function (L) {
      var qs = all.filter(function (q) { return midSetOf(q) === L.set; });
      var st = midStat(qs);
      var words = (L.vocab || []).length + midExtraWords(L).length;
      var sents = midSentItems(L.set).length;
      return '<div class="mid-ls">' +
        '<div class="mid-ls-h">' +
          '<span class="mid-ls-no">' + esc(L.no) + '</span>' +
          '<span class="mid-ls-t"><span lang="ja">' + esc(L.jp || '') + '</span> <span class="mid-ls-ko">' + esc(L.ko || '') + '</span></span>' +
          (qs.length ? '<span class="mid-ls-st">' + st.ok + ' / ' + st.n + '</span>' : '') +
        '</div>' + (qs.length ? midBar(st) : '') +
        '<div class="mid-ls-btns">' +
          '<button class="chip" data-act="note" data-set="' + L.set + '">정리</button>' +
          ((L.text || []).length ? '<button class="chip" data-act="text" data-set="' + L.set + '">본문 해설</button>' : '') +
          (sents ? '<button class="chip" data-act="sents" data-set="' + L.set + '">본문 쓰기 ' + sents + '</button>' : '') +
          (words ? '<button class="chip" data-act="words" data-set="' + L.set + '">단어 ' + words + '</button>' : '') +
          (qs.length ? '<button class="chip" data-act="set" data-set="' + L.set + '">문제 ' + qs.length + '</button>' : '') +
        '</div></div>';
    }).join('');
  }

  function midHeadHTML(L) {
    return '<div class="mid-nh"><span class="mid-ls-no">' + esc(L.no) + '</span> ' +
      '<span lang="ja">' + esc(L.jp || '') + '</span> <span class="mid-ls-ko">' + esc(L.ko || '') + '</span></div>';
  }

  function openMidNote(set) {
    var L = midLesson(set);
    if (!L) return;
    var h = midHeadHTML(L);
    if ((L.text || []).length) {
      h += '<div class="section-head mt-link"><h2></h2><div class="head-actions">' +
        '<button class="mini-btn" data-act="sents" data-set="' + set + '">본문 쓰기</button>' +
        '<button class="mini-btn go" data-act="text" data-set="' + set + '">본문 해설 · 문단별</button></div></div>';
    }
    if ((L.facts || []).length) {
      h += '<div class="secto">본문 핵심</div><ul class="mid-facts">' +
        L.facts.map(function (f) { return '<li>' + midText(f) + '</li>'; }).join('') + '</ul>';
    }
    if ((L.grammar || []).length) {
      h += '<div class="secto">문형</div>';
      L.grammar.forEach(function (g, i) {
        h += '<div class="card mid-g">' +
          '<div class="mid-gp" lang="ja">' + MID_NUM[i] + ' ' + esc(g.pattern) + '</div>' +
          '<div class="mid-gm">' + esc(g.meaning) + '</div>' +
          (g.usage ? grow('용법', esc(g.usage), 'dim') : '') +
          (g.connection ? grow('접속', esc(g.connection), '') : '') +
          (g.examples || []).map(function (e) {
            return '<div class="ex"><p class="ex-jp" lang="ja">' + midText(e.jp) + '</p><p class="ex-ko">' + esc(e.ko) + '</p></div>';
          }).join('') +
          (g.in_text ? '<div class="mid-intext"><span class="k">본문</span><span lang="ja">' + midText(g.in_text) + '</span></div>' : '') +
        '</div>';
      });
    }
    (L.extra || []).forEach(function (x, i) {
      if (!i) h += '<div class="secto">추가자료</div>';
      h += '<div class="card mid-g"><div class="mid-gp">' + midText(x.h) + '</div>' +
        (x.lines || []).map(function (l) { return '<p class="mid-xl">' + midText(l) + '</p>'; }).join('') + '</div>';
    });
    if ((L.reading || []).length) {
      h += '<div class="secto">독해문제 · 누르면 답</div>';
      L.reading.forEach(function (r, i) {
        h += '<div class="mid-qa"><p class="ex-jp" lang="ja">' + (i + 1) + '. ' + midText(r.q) + '</p>' +
          '<div class="mid-qa-a" hidden><p class="ex-jp" lang="ja">' + midText(r.a) + '</p>' +
          (r.ko ? '<p class="ex-ko">' + esc(r.ko) + '</p>' : '') + '</div></div>';
      });
    }
    var n = midQs().filter(function (q) { return midSetOf(q) === set; }).length;
    if (n) h += '<button class="next-btn mid-go" data-act="set" data-set="' + set + '">이 과 문제 ' + n + '개</button>';
    $('midNote').innerHTML = h;
    show('midNote');
  }

  /* ----- 본문에서 더 뽑은 단어 ----- */
  // 해설의 【어휘】 가운데 교재 단어 목록에 없는 것(빌드에서 모음). 화면에 낼 때 JLPT 단어장에서
  // 이미 장기기억으로 외운 것은 뺀다. 외워 갈수록 줄어든다.
  var midVocabMap = null;
  function midNorm(w) { return String(w || '').replace(/[（(][^)）]*[)）]/g, '').replace(/(する|だ|な)$/, '').trim(); }
  function midVocabIndex() {
    if (midVocabMap) return midVocabMap;
    midVocabMap = {};
    Store.allWords().forEach(function (e) {
      String(e.w.word).split(/[\/／]/).forEach(function (f) {
        var k = midNorm(f);
        if (k && !midVocabMap[k]) midVocabMap[k] = e;
      });
    });
    return midVocabMap;
  }
  function midExtraWords(L) {
    var map = midVocabIndex();
    return (L.extraWords || []).map(function (v) {
      var e = map[midNorm(v.word)];
      return { v: v, e: e, st: e ? Store.stageFor(e.day, e.w) : null };
    }).filter(function (x) { return x.st !== 'long'; });
  }

  /* ----- 단어 카드 (단어 모드의 학습 카드와 같다) ----- */
  // 교재 단어 + 본문에서 더 뽑은 단어. 단어 → 정답 보기 → 읽는 법·뜻 → O/X 로 넘기며 외운다.
  // 예문은 본문(회화)에서 그 단어가 나온 문장이다. 푸는 동안에는 후리가나 없이 보여 준다.

  // 본문 해설에서 그 단어가 들어간 첫 문장. 활용형으로 나올 수 있어 끝 가나를 하나 떼고도 찾는다.
  function midFindSentence(L, word) {
    var base = midNorm(word);
    if (!base) return null;
    var keys = [base];
    if (/[ぁ-ん]$/.test(base) && base.length > 1) keys.push(base.slice(0, -1));
    var hit = null;
    (L.text || []).some(function (sec) {
      return sec.paras.some(function (p) {
        return p.sents.some(function (z) {
          var plain = String(z.jp).replace(/\[[^\]]*\]/g, '').replace(/\{\{|\}\}/g, '');
          for (var i = 0; i < keys.length; i++) {
            if (plain.indexOf(keys[i]) > -1) { hit = { jp: z.jp, ko: z.ko, key: keys[i] }; return true; }
          }
          return false;
        });
      });
    });
    return hit;
  }

  function midWordItems(set) {
    var L = midLesson(set);
    if (!L) return [];
    // 듣기 수업 단어: 소단원 이름과, 단어장에 있으면 그 DAY·단계를 붙인다.
    var lcTag = function (v) {
      var e = midVocabIndex()[midNorm(v.word)];
      return (v.sec || '') + (e ? ' · 단어장 ' + dayOf(e.day, e.w) + ' · ' + (Store.STAGE_LABEL[Store.stageFor(e.day, e.w)] || '') : '');
    };
    var mk = function (v, extra, x) {
      return {
        id: 'V:' + set + ':' + v.word, type: 'word', set: set, kind: 'vocab', lc: !!L.lc,
        word: v.word, reading: v.reading, meaning: v.meaning, extra: extra,
        tag: L.lc ? lcTag(v) :
          extra ? (x.e ? '단어장 ' + dayOf(x.e.day, x.e.w) + ' · ' + (Store.STAGE_LABEL[x.st] || '') : '본문 · 새 단어') : '',
        ex: midFindSentence(L, v.word)
      };
    };
    return (L.vocab || []).map(function (v) { return mk(v, false); })
      .concat(midExtraWords(L).map(function (x) { return mk(x.v, true, x); }));
  }

  // 예문의 그 단어 자리를 표시한다(단어 카드의 예문처럼).
  function midExHTML(q, withRuby) {
    if (!q.ex) return '';
    var html = gJP(q.ex.jp, { ruby: withRuby });
    var key = esc(q.ex.key);
    if (key) html = html.split(key).join('<mark>' + key + '</mark>');
    return '<div class="ex' + (withRuby ? ' ruby' : '') + '"><p class="ex-jp" lang="ja">' + html + '</p>' +
      (withRuby && q.ex.ko ? '<p class="ex-ko">' + esc(q.ex.ko) + '</p>' : '') + '</div>';
  }

  function midWordBodyHTML(q, o) {
    var r = (q.reading && q.reading !== q.word) ? q.reading : q.word;
    var h = '<div class="jp-word" lang="ja">' + esc(q.word) + '</div>';
    if (o.reveal) {
      h += '<div class="answer-box">' +
        '<div class="ans-row"><span class="ans-label">읽는 법</span><span class="ans-value reading" lang="ja">' + esc(r) + '</span></div>' +
        '<div class="ans-row"><span class="ans-label">뜻</span><span class="ans-value">' + esc(q.meaning) + '</span></div>' +
      '</div>';
    }
    var ex = midExHTML(q, !!o.reveal);
    if (ex || (o.reveal && q.tag)) {
      h += '<div class="detail-box' + (o.reveal ? '' : ' quiz') + '">' + ex +
        (o.reveal && q.tag ? '<p class="card-no mid-wsrc">' + esc(q.tag) + '</p>' : '') + '</div>';
    }
    return h;
  }

  function midWordItemHTML(q, state, side) {
    var dot = state === 'ok' ? 'dot-long' : (state === 'bad' ? 'dot-unknown' : 'dot-new');
    var r = (q.reading && q.reading !== q.word) ? q.reading : '';
    return '<div class="wl-item' + (q.ex ? ' has-detail' : '') + ' mid-li" role="button" tabindex="0">' +
      '<div class="wl-head"><span class="wl-dot ' + dot + '"></span>' +
        '<div class="wl-main"><div><span class="wl-word" lang="ja">' + esc(q.word) + '</span>' +
          (r ? '<span class="wl-reading" lang="ja">' + esc(r) + '</span>' : '') + '</div>' +
          '<div class="wl-meaning">' + esc(q.meaning) + '</div></div>' +
        '<span class="wl-side">' + (q.extra ? '<span class="wl-day">본문</span>' : '') + esc(side || '') + '</span>' +
        (q.ex ? '<span class="wl-caret">▾</span>' : '') + '</div>' +
      (q.ex ? '<div class="wl-detail" hidden>' + midExHTML(q, true) +
        (q.tag ? '<p class="card-no mid-wsrc">' + esc(q.tag) + '</p>' : '') + '</div>' : '') +
    '</div>';
  }

  /* ----- 본문 해설 (문단 읽기 해설집과 같은 꼴) ----- */
  // 문단 하나씩 넘기며 읽는다. 문단 글(후리가나) → 문단 번역 → 문장마다 번역·【구조】·문형·【어휘】.
  var midTextCur = null;   // { set, sec, para, furi }

  function openMidText(set, sec, para) {
    var L = midLesson(set);
    if (!L || !(L.text || []).length) return;
    midTextCur = { set: set, sec: sec || 0, para: para || 0, furi: midTextCur ? midTextCur.furi : true };
    renderMidText();
    show('midText');
  }

  // 「인용」은 일본어 글꼴로, 《문형》은 눈에 띄게.
  function midItemFmt(s) {
    return esc(String(s || ''))
      .replace(/「([^」]*)」/g, '<span class="mt-q" lang="ja">「$1」</span>')
      .replace(/《([^》]*)》/g, '<span class="mt-pat">《$1》</span>');
  }

  function midTextStep(d) {
    var c = midTextCur, secs = midLesson(c.set).text;
    var s = c.sec, p = c.para + d;
    if (p < 0) { s--; if (s < 0) return null; p = secs[s].paras.length - 1; }
    else if (p >= secs[s].paras.length) { s++; if (s >= secs.length) return null; p = 0; }
    return { sec: s, para: p, label: secs[s].title + ' P' + (p + 1) };
  }

  function midTextGo(d) {
    var t = midTextStep(d);
    if (!t) return;
    midTextCur.sec = t.sec; midTextCur.para = t.para;
    renderMidText();
  }

  function renderMidText() {
    var c = midTextCur, L = midLesson(c.set);
    var secs = L.text, S = secs[c.sec], P = S.paras[c.para];
    var opt = { ruby: c.furi };
    var talk = /회화/.test(S.title);
    var h = midHeadHTML(L);
    h += '<div class="res-tabs mt-tabs">' + secs.map(function (s, i) {
      return '<button class="res-tab' + (i === c.sec ? ' sel' : '') + '" data-sec="' + i + '">' + esc(s.title) + '</button>';
    }).join('') + '<button class="res-tab mt-furi' + (c.furi ? ' sel' : '') + '" data-furi="1">후리가나</button></div>';
    h += '<div class="chips mt-paras">' + S.paras.map(function (p, i) {
      return '<button class="chip' + (i === c.para ? ' sel' : '') + '" data-para="' + i + '">P' + (i + 1) + '</button>';
    }).join('') + '</div>';

    h += '<div class="st-para mt-para">' +
      '<div class="st-head"><span class="st-lv">' + esc(S.title) + ' P' + (c.para + 1) + '</span></div>' +
      '<p class="st-jp mt-jp" lang="ja">' + P.sents.map(function (s) { return gJP(s.jp, opt); }).join(talk ? '<br>' : '') + '</p>' +
      (P.ko ? '<p class="st-ko">' + esc(P.ko) + '</p>' : '') +
    '</div>';

    P.sents.forEach(function (s, i) {
      h += '<div class="mt-s">' +
        '<div class="mt-s-jp" lang="ja"><span class="mt-no">' + (i + 1) + '</span><span class="mt-s-t">' + gJP(s.jp, opt) + '</span></div>' +
        (s.ko ? '<div class="mt-s-ko">' + esc(s.ko) + '</div>' : '') +
        (s.st ? '<div class="mt-row"><span class="mt-tag">구조</span><span class="mt-st">' + midItemFmt(s.st) + '</span></div>' : '') +
        ((s.items || []).length ? '<ul class="mt-its">' + s.items.map(function (it) { return '<li>' + midItemFmt(it) + '</li>'; }).join('') + '</ul>' : '') +
        ((s.voc || []).length ? '<div class="mt-row"><span class="mt-tag">어휘</span><span class="mt-voc">' + s.voc.map(function (v) {
            return '<span class="mt-v"><b lang="ja">' + esc(v.w) + '</b><i lang="ja">' + esc(v.r) + '</i>' + esc(v.m) + '</span>';
          }).join('') + '</span></div>' : '') +
      '</div>';
    });

    var prev = midTextStep(-1), next = midTextStep(1);
    h += '<div class="st-nav">' +
      '<button class="mini-btn" data-step="-1"' + (prev ? '' : ' hidden') + '>‹ ' + (prev ? esc(prev.label) : '') + '</button>' +
      '<button class="mini-btn go" data-step="1"' + (next ? '' : ' hidden') + '>' + (next ? esc(next.label) : '') + ' ›</button>' +
    '</div>';
    $('midText').innerHTML = h;
    window.scrollTo(0, 0);
  }

  // 단어 목록에서 읽기 문제를 그 자리에서 만든다. 오답은 같은 과 단어의 읽기.
  // 본문에서 더 뽑은 단어(아직 못 외운 것)도 같이 낸다.
  function midWordQuiz(set) {
    var L = midLesson(set);
    if (!L) return;
    var all = (L.vocab || []).concat(midExtraWords(L).map(function (x) { return x.v; }));
    var pool = all.filter(function (v) {
      return /[一-龯々]/.test(v.word) && v.reading && v.reading !== v.word;
    });
    var readings = [];
    pool.forEach(function (v) { if (readings.indexOf(v.reading) < 0) readings.push(v.reading); });
    if (readings.length < 4) return;
    var list = shuffle(pool.slice()).map(function (v) {
      var others = shuffle(readings.filter(function (r) { return r !== v.reading; })).slice(0, 3);
      var opts = shuffle([v.reading].concat(others));
      return {
        id: 'W:' + set + ':' + v.word, set: set, part: 'A', kind: 'reading', src: '단어 목록', passage: '',
        q: '__' + v.word + '__の読み方として正しいものを選びなさい。', q_ko: v.meaning,
        opts: opts, ans: opts.indexOf(v.reading), why: v.word + '（' + v.reading + '）= ' + v.meaning
      };
    });
    midStart('practice', list, midSetName(set) + ' 읽기 4지선다', 'midSet');
  }

  /* ----- 문제 묶음 화면 (단어의 Day 화면과 같은 꼴) ----- */

  function openMidSet(key) {
    var all = midQs(), list, title, sub;
    if (key === 'wrong') {
      list = midWrongList(); title = '틀린 문제'; sub = '마지막으로 풀 때 처음에 틀린 문제';
    } else if (key.indexOf('sents:') === 0) {
      var ss = key.slice(6), SL = midLesson(ss);
      list = midSentItems(ss);
      title = midSetName(ss) + ' 본문 쓰기';
      sub = '해석을 보고 일본어 문장으로 · ' + list.length + '문장' + (SL ? ' · ' + SL.jp : '');
    } else if (key.indexOf('words:') === 0) {
      var ws = key.slice(6), WL = midLesson(ws);
      list = midWordItems(ws);
      var nx = list.filter(function (q) { return q.extra; }).length;
      title = midSetName(ws) + ' 단어';
      sub = (WL && WL.lc) ? list.length + '단어 · ' + WL.jp
        : '교재 ' + (list.length - nx) + (nx ? ' · 본문에서 더 뽑은 것 ' + nx : '') + (WL ? ' · ' + WL.jp : '');
    } else if (key.indexOf('kind:') === 0) {
      var k = key.slice(5);
      list = all.filter(function (q) { return q.kind === k; }); title = MID_KIND[k]; sub = '네 과 + 2과 추가자료';
    } else {
      var L = midLesson(key);
      list = all.filter(function (q) { return midSetOf(q) === key; });
      title = midSetName(key) + (L && key !== 'EX' ? ' ' + L.jp : '');
      sub = L ? L.ko : '';
    }
    midSetCur = { key: key, title: title, sub: sub, list: list };
    renderMidSet();
    show('midSet');
  }

  function midStatCells(cells) {
    return cells.map(function (c) {
      return '<div class="stat ' + c[0] + '"><span class="n">' + c[1] + '</span><span class="l">' + c[2] + '</span></div>';
    }).join('');
  }

  function renderMidSet() {
    var c = midSetCur;
    if (!c) return;
    if (c.key === 'wrong') c.list = midWrongList();   // 풀고 오면 줄어든다
    var words = c.key.indexOf('words:') === 0, sents = c.key.indexOf('sents:') === 0;
    var unit = words ? '단어' : (sents ? '문장' : '문제');
    var p = Store.examProg(), s = midStat(c.list);
    var wrong = c.list.filter(function (q) { return p[q.id] && !p[q.id].ok; });
    $('msTitle').textContent = c.title;
    $('msSub').textContent = c.sub || '';
    $('msStats').innerHTML = midStatCells([['total', s.n, '전체'], ['', s.n - s.done, '안 해 본 ' + unit],
                                           ['unknown', s.bad, '틀림'], ['long', s.ok, '맞힘']]);
    $('msAllTitle').textContent = words ? '전체 학습' : '전체 풀기';
    $('msAllCount').textContent = c.list.length + unit;
    $('btnMsAll').disabled = !c.list.length;
    $('msWrongCount').textContent = wrong.length + unit;
    $('btnMsWrong').disabled = !wrong.length;
    $('msListTitle').textContent = unit + ' 목록';
    $('btnMsBrowse').disabled = !c.list.length;
    $('btnMsWQuiz').hidden = !words;
    $('msList').innerHTML = c.list.map(function (q) {
      var r = p[q.id], st = r ? (r.ok ? 'ok' : 'bad') : 'new', side = r ? (r.ok ? '맞힘' : '틀림') : '';
      if (q.type === 'word') return midWordItemHTML(q, st, side);
      if (q.type === 'sent') return midSentItemHTML(q, st, side, true);
      return midItemHTML(q, st, side, null);
    }).join('') || '<p class="empty-note">' + unit + '이 없습니다</p>';
  }

  // 목록 한 줄. 누르면 정답과 해설이 펼쳐진다(단어 목록과 같다).
  function midItemHTML(q, state, side, pick) {
    var dot = state === 'ok' ? 'dot-long' : (state === 'bad' ? 'dot-unknown' : 'dot-new');
    return '<div class="wl-item has-detail mid-li" role="button" tabindex="0">' +
      '<div class="wl-head"><span class="wl-dot ' + dot + '"></span>' +
        '<div class="wl-main"><div class="mid-li-q" lang="ja">' + midText(midOneLine(q)) + '</div>' +
          '<div class="wl-meaning">' + midSetName(midSetOf(q)) + ' ' + midNo(q) + ' · ' + (MID_KIND[q.kind] || '') + '</div></div>' +
        (side ? '<span class="wl-side">' + esc(side) + '</span>' : '') +
        '<span class="wl-caret">▾</span></div>' +
      '<div class="wl-detail" hidden>' + midBodyHTML(q, { reveal: true, pick: pick }) + '</div>' +
    '</div>';
  }

  /* ----- 문제 카드 (풀기·돌아보기·넘기며 보기·목록이 같이 쓴다) ----- */

  // o.tap: 보기를 눌러 고를 수 있다 / o.reveal: 정답·해설을 편다 / o.pick: 고른 보기
  function midBodyHTML(q, o) {
    o = o || {};
    if (q.type === 'word') return midWordBodyHTML(q, o);
    var h = '';
    if (q.passage) h += '<div class="mid-psg" lang="ja">' + midText(q.passage) + '</div>';
    h += '<p class="mid-qt" lang="ja">' + midText(q.q) + '</p>';
    h += '<div class="gopts mid-opts">';
    q.opts.forEach(function (op, i) {
      var cls = '';
      if (o.reveal) cls = (i === q.ans) ? ' right' : (i === o.pick ? ' wrong' : '');
      else if (o.pick === i) cls = ' sel';
      var tag = o.tap ? 'button' : 'div';
      h += '<' + tag + ' class="gopt mid-opt' + cls + '" data-i="' + i + '">' +
        '<span class="mid-on">' + MID_NUM[i] + '</span><span class="mid-ot">' + midText(op) + '</span></' + tag + '>';
    });
    h += '</div>';
    if (o.reveal) {
      h += '<div class="answer-box mid-ans">' +
        '<div class="ans-row"><span class="ans-label">정답</span>' +
          '<span class="ans-value" lang="ja">' + MID_NUM[q.ans] + ' ' + midText(q.opts[q.ans]) + '</span></div>' +
        (o.pick != null && o.pick !== q.ans
          ? '<div class="ans-row"><span class="ans-label">내 답</span><span class="ans-value bad" lang="ja">' +
              MID_NUM[o.pick] + ' ' + midText(q.opts[o.pick]) + '</span></div>' : '') +
        (q.q_ko ? '<div class="ans-row"><span class="ans-label">문제 뜻</span><span class="ans-value ko">' + esc(q.q_ko) + '</span></div>' : '') +
      '</div>';
      if (q.why || q.src) {
        h += '<div class="detail-box mid-detail">' +
          (q.why ? '<p class="mid-why">' + midText(q.why) + '</p>' : '') +
          (q.src ? '<p class="card-no">' + esc(q.src) + '</p>' : '') + '</div>';
      }
    }
    return h;
  }

  function midCardHTML(q, o) {
    if (q.type === 'sent') return midSentCardHTML(q);
    if (q.type === 'word') {
      // 단어 카드: 배지는 이 단어를 지난번에 맞혔는지(단어 모드의 단계 배지 자리).
      var r = Store.examProg()[q.id];
      var st = !r ? ['new', '미학습'] : (r.ok ? ['long', '맞힘'] : ['unknown', '틀림']);
      return '<div class="card mid-q mid-wc">' +
        '<div class="card-meta"><span class="badge ' + st[0] + '">' + st[1] + '</span>' +
          '<span class="card-no">' + midSetName(q.set) + ' · ' + (q.lc ? esc(q.tag.split(' · ')[0]) : (q.extra ? '본문 단어' : '교재 단어')) + '</span></div>' +
        midBodyHTML(q, o) + '</div>';
    }
    return '<div class="card mid-q">' +
      '<div class="card-meta"><span class="badge">' + (MID_KIND[q.kind] || '') + '</span>' +
        '<span class="card-no">' + midSetName(midSetOf(q)) + ' · ' + midNo(q) + '</span></div>' +
      midBodyHTML(q, o) + '</div>';
  }

  /* ----- 풀기 ----- */

  function midMock() {
    var all = midQs(), p = Store.examProg(), out = [];
    // 아직 안 푼 것 → 틀린 것 → 맞힌 것 순으로. 같은 무리 안에서는 섞는다.
    var rank = function (q) { var r = p[q.id]; return !r ? 0 : (r.ok ? 2 : 1); };
    var byRank = function (list) { return shuffle(list.slice()).sort(function (a, b) { return rank(a) - rank(b); }); };
    Object.keys(MID_QUOTA).forEach(function (set) {
      var pool = all.filter(function (q) { return midSetOf(q) === set; });
      var A = byRank(pool.filter(function (q) { return q.part === 'A'; }));
      var B = byRank(pool.filter(function (q) { return q.part !== 'A'; }));
      var n = MID_QUOTA[set];
      var na = Math.min(A.length, Math.round(n * 0.6));
      var pick = A.slice(0, na).concat(B.slice(0, n - na));
      var rest = A.slice(na).concat(B.slice(n - na));
      while (pick.length < n && rest.length) pick.push(rest.shift());
      out = out.concat(pick);
    });
    midStart('mock', out, '모의고사', 'mid');
  }

  function midStart(mode, list, label, from) {
    if (!list.length) return;
    stopMidTick();
    var d = midData() || {}, mins = (d.info && d.info.minutes) || 60;
    mid = {
      mode: mode, queue: list.slice(), idx: 0, retry: [], lap: 1, total: list.length, done: 0,
      label: label, from: from || 'mid', finished: false,
      state: 'ask', pick: null,       // 지금 카드: ask → picked(보기를 고름) / self(정답 보기로 엶)
      res: {}, order: [],             // 이 판의 결과: 처음 낸 답 기준
      picks: mode === 'mock' ? list.map(function () { return null; }) : null,
      start: Date.now(), deadline: mode === 'mock' ? Date.now() + mins * 60000 : 0, peek: null
    };
    $('midTimer').textContent = '';
    show('midQuiz');
    if (mode === 'mock') startMidTick();
    renderMidQ();
  }

  function startMidTick() {
    stopMidTick();
    var tick = function () {
      if (!mid || mid.mode !== 'mock' || mid.finished) { stopMidTick(); return; }
      var left = mid.deadline - Date.now();
      if (left <= 0) {
        stopMidTick();
        // 다른 화면에 가 있으면 돌아왔을 때 마감한다.
        if (view === 'midQuiz') { toast('시간이 끝나 제출했습니다'); midFinish(); }
        return;
      }
      var mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
      $('midTimer').textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    };
    tick();
    midTick = setInterval(tick, 1000);
  }

  function stopMidTick() { if (midTick) { clearInterval(midTick); midTick = null; } }

  function renderMidQ() {
    var m = mid;
    if (!m || m.finished) return;
    if (m.peek != null) midPeekClose();
    var mock = m.mode === 'mock';
    var q = m.queue[m.idx];
    $('midCount').textContent = mock ? (m.idx + 1) + ' / ' + m.queue.length : m.done + ' / ' + m.total;
    $('midFill').style.width = ((mock ? m.idx / m.queue.length : m.done / m.total) * 100) + '%';
    $('midLabel').textContent = m.label + (m.lap > 1 ? ' · ' + m.lap + '바퀴째' : '');
    $('btnMidStop').hidden = mock;
    if (q.type === 'sent') { renderMidSentQ(q); return; }   // 뜻 보고 본문 쓰기는 입력 카드
    var o = mock ? { tap: true, pick: m.picks[m.idx] }
                 : { tap: m.state === 'ask', reveal: m.state !== 'ask', pick: m.pick };
    $('midStage').innerHTML = midCardHTML(q, o);
    $$('#midStage button.mid-opt').forEach(function (b) {
      b.addEventListener('click', function () { midPick(Number(b.dataset.i)); });
    });
    midBarState();
    window.scrollTo(0, 0);
  }

  /* ----- 뜻 보고 본문 쓰기 (단어 모드의 '뜻 → 일본어 · 입력' 과 같은 꼴) ----- */
  // 본문·회화 문장의 해석을 보여 주고 일본어 문장을 쳐서 맞힌다. 채점은 교재 문장 기준이다.
  // 문장부호·띄어쓰기는 보지 않고, 후리가나가 달린 낱말은 한자로 쓰든 읽기로 쓰든 정답이다.

  // 회화는 한 사람이 말한 몇 문장이 한 칸이다. 한 문장씩 채점하도록 일본어·해석을 문장 끝에서 나눈다.
  // 「」 '' 안의 문장부호에서는 나누지 않는다. 두 쪽 문장 수가 다르면 나누지 않는다.
  function midSplitJ(s) {
    var out = [], cur = '', depth = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      cur += c;
      if (c === '「' || c === '『') depth++;
      else if (c === '」' || c === '』') depth--;
      else if (depth <= 0 && /[。？！?!]/.test(c)) {
        while (i + 1 < s.length && /[。？！?!…）)]/.test(s[i + 1])) cur += s[++i];
        out.push(cur.trim()); cur = '';
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function midSplitK(s) {
    var out = [], cur = '', q = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      cur += c;
      if (c === '“' || c === '‘' || c === '「') q++;
      else if (c === '”' || c === '’' || c === '」') q--;
      else if (q <= 0 && /[.?!]/.test(c)) {
        while (i + 1 < s.length && /[.?!…)]/.test(s[i + 1])) cur += s[++i];
        if (i + 1 >= s.length || s[i + 1] === ' ') { out.push(cur.trim()); cur = ''; }
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // 해설 줄은 앞머리 「…」 로 어느 문장 이야기인지 안다. ～ … 로 끊긴 조각이 모두 들어 있는 문장에 붙인다.
  function midItemFor(it, plain) {
    var keys = String(it).match(/^(?:「[^」]*」)+/);
    if (!keys) return false;
    return keys[0].slice(1, -1).split('」「').some(function (k) {
      var bits = k.replace(/（[^）]*）/g, '').split(/[～…]/).filter(function (b) { return b; });
      return bits.length && bits.every(function (b) { b = midSentNorm(b); return !b || plain.indexOf(b) >= 0; });
    });
  }

  function midSentItems(set) {
    var L = midLesson(set), out = [];
    if (!L) return out;
    var blank = /[①②③④⑤⑥⑦⑧⑨⑩]/;   // 정답 대본이 없는 듣기 빈칸이 든 문장은 뺀다
    // うん。 ね。 そうそう。 같은 맞장구(다섯 글자 미만)도 쓸 거리가 없어 뺀다.
    (L.text || []).forEach(function (sec, si) {
      sec.paras.forEach(function (p, pi) {
        p.sents.forEach(function (z, zi) {
          var sp = midSpeaker(z.jp), id = 'S:' + set + ':' + si + '-' + pi + '-' + zi;
          var where = sec.title + ' P' + (pi + 1) + '-' + (zi + 1);
          var ko = String(z.ko || '').replace(/^[AB][：:]\s*/, '');
          var J = midSplitJ(midSentSrc(z.jp)), K = midSplitK(ko);
          if (J.length < 2 || J.length !== K.length) {
            if (blank.test(z.jp) || midSentNorm(J.join('').replace(/\[[^\]]*\]/g, '')).length < 5) return;
            out.push({ id: id, no: out.length, type: 'sent', set: set, kind: 'sent', jp: z.jp, ko: ko, sp: sp,
                       items: z.items || [], where: where });
            return;
          }
          J.forEach(function (j, k) {
            if (blank.test(j)) return;
            var plain = midSentNorm(j.replace(/\[[^\]]*\]/g, ''));
            if (plain.length < 5) return;
            out.push({ id: id + '-' + k, no: out.length, type: 'sent', set: set, kind: 'sent', jp: j, ko: K[k], sp: sp,
                       items: (z.items || []).filter(function (it) { return midItemFor(it, plain); }),
                       where: where + ' (' + (k + 1) + '/' + J.length + ')' });
          });
        });
      });
    });
    return out;
  }

  function midSentSrc(jp) { return String(jp || '').replace(/\{\{|\}\}/g, '').replace(/^[AB][：:]\s*/, ''); }
  function midSpeaker(jp) { var m = /^([AB])[：:]/.exec(String(jp || '')); return m ? m[1] : ''; }

  // 비교용: 전각·반각을 맞추고 문장부호와 띄어쓰기를 지운다.
  function midSentNorm(s) {
    s = String(s || '');
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.replace(/[\s、。，．,.!?！？「」『』（）()・…―—"'“”‘’]/g, '');
  }

  // 정답과 글자 단위로 맞춰 보기. 채점도 이것으로 한다(고칠 곳이 0 이면 정답).
  // 정답은 낱말마다 '한자 그대로' 와 '후리가나 읽기' 두 갈래가 끝에서 다시 만나는 격자다.
  // 섞어 써도 되지만 한 낱말 안에서 한자와 읽기를 반씩 쓴 것은 틀린다.
  // 입력 글자 하나를 넣거나·바꾸거나, 정답 글자 하나를 빠뜨리면 1 씩 센다.
  function midSentSegs(jp) {
    var src = midSentSrc(jp), re = rubyRe(), last = 0, x, segs = [];
    var plain = function (t) {
      for (var i = 0; i < t.length; i++) { var a = midSentNorm(t[i]); segs.push({ t: t[i], alts: a ? [a] : [] }); }
    };
    while ((x = re.exec(src)) !== null) {
      plain(src.slice(last, x.index));
      // 1965年[ねん] 처럼 앞에 붙은 숫자는 후리가나가 덮지 않으니 따로 뗀다(1965ねん 도 맞게).
      var base = x[1], lead = /^[0-9０-９A-Za-zＡ-Ｚａ-ｚ]+(?=[^0-9０-９A-Za-zＡ-Ｚａ-ｚ])/.exec(base);
      if (lead && x[2]) { plain(lead[0]); base = base.slice(lead[0].length); }
      midSplitRuby(base, x[2] || '').forEach(function (pr) {
        var b = midSentNorm(pr[0]), r = midSentNorm(pr[1]);
        segs.push({ base: pr[0], rt: pr[1], alts: (r && r !== b) ? [b, r] : [b] });
      });
      last = x.index + x[0].length;
    }
    plain(src.slice(last));
    return segs;
  }

  // 후리가나가 여러 낱말에 한 덩어리로 달린 곳(鎌倉時代[かまくらじだい])을 낱말로 가르기 위한 사전.
  // read: 두 글자 이상 한자어 → 읽기들. JLPT 단어장·시험 단어의 표제어와, 예문·본문 후리가나 가운데
  //       두 글자 이상인 것에서 모은다(気[き] 같은 한 글자 조각까지 넣으면 人気 를 人|気 로 가른다).
  // head: JLPT 단어장 표제어. 표제어인 덩어리(人間関係 …)는 한 낱말이니 가르지 않는다.
  var midReadMap = null;
  function midReadIndex() {
    if (midReadMap) return midReadMap;
    var read = {}, head = {}, KJ = /^[一-龯々〆ヶ]+$/, KN = /^[ぁ-ゖー]+$/;
    var strip = function (w, r) {
      w = String(w || '').replace(/[（(][^)）]*[)）]/g, '').trim();
      r = String(r || '').replace(/[（(][^)）]*[)）]/g, '').trim();
      // 注意する/ちゅういする 처럼 낱말 쪽이 する·だ·な 로 끝날 때만 읽기에서도 뗀다(はな 의 な 는 그대로)
      var m = /(する|だ|な)$/.exec(w);
      if (m && r.slice(-m[1].length) === m[1]) { w = w.slice(0, -m[1].length); r = r.slice(0, -m[1].length); }
      // 앞뒤로 같은 가나(送り仮名, お盆 의 お)는 떼고 한자 부분만 남긴다
      while (w && r && w.slice(-1) === r.slice(-1) && !KJ.test(w.slice(-1))) { w = w.slice(0, -1); r = r.slice(0, -1); }
      while (w && r && w[0] === r[0] && !KJ.test(w[0])) { w = w.slice(1); r = r.slice(1); }
      return KJ.test(w) && KN.test(r) ? [w, r] : null;
    };
    var add = function (p) {
      if (!p || p[0].length < 2) return;
      var a = read[p[0]] || (read[p[0]] = []);
      if (a.indexOf(p[1]) < 0) a.push(p[1]);
    };
    // 시험 단어 목록에는 鎌倉時代·花火大会 같은 구도 들어 있어, 표제어(가르지 않음)는 JLPT 단어장 것만 친다.
    var word = function (w, r, isHead) { var p = strip(w, r); if (p) { if (isHead) head[p[0]] = 1; add(p); } };
    var scan = function (jp) {
      var re = rubyRe(), x, s = String(jp || '');
      while ((x = re.exec(s)) !== null) if (x[2] && KJ.test(x[1])) add([x[1], x[2]]);
    };
    Store.allWords().forEach(function (e) {
      var ws = String(e.w.word || '').split(/[\/／]/), rs = String(e.w.reading || '').split(/[\/／]/);
      ws.forEach(function (w, k) { word(w, rs[k] || rs[0], true); });
      (e.w.examples || []).forEach(function (ex) { scan(ex.jp); });
    });
    var d = midData();
    ((d && d.lessons) || []).forEach(function (L) {
      (L.vocab || []).concat(L.extraWords || []).forEach(function (v) { word(v.word, v.reading); });
      (L.text || []).forEach(function (sec) {
        sec.paras.forEach(function (p) { p.sents.forEach(function (z) { scan(z.jp); }); });
      });
      (L.grammar || []).forEach(function (g) { (g.examples || []).forEach(function (ex) { scan(ex.jp); }); });
    });
    return (midReadMap = { read: read, head: head });
  }

  // 한 덩어리를 사전의 한자어(읽기가 그 자리에 꼭 맞는 것)와, 그 사이에 낀 두 글자 이상의 모르는 말로
  // 가른다. 모르는 말끼리 붙거나 한 글자짜리 조각은 두지 않는다(一人[ひとり] 같은 숙자훈을 지킨다).
  // 사전 말이 가장 많이 덮는 쪽, 같으면 덜 잘게(긴 낱말) 가른 쪽. 못 가르면 통째로 둔다.
  function midSplitRuby(b, r) {
    if (b.length < 4 || !r || !/^[一-龯々〆ヶ]+$/.test(b)) return [[b, r]];
    var ix = midReadIndex(), dict = ix.read, memo = {};
    if (ix.head[b]) return [[b, r]];
    var go = function (i, j, prevUnk) {
      if (i === b.length) return j === r.length ? { cov: 0, n: 0, parts: [] } : null;
      var key = i + ',' + j + ',' + (prevUnk ? 1 : 0);
      if (key in memo) return memo[key];
      var best = null;
      var take = function (sub, w, rd, known) {
        if (!sub) return;
        var c = { cov: sub.cov + (known ? w.length : 0), n: sub.n + 1, parts: [[w, rd]].concat(sub.parts) };
        if (!best || c.cov > best.cov || (c.cov === best.cov && c.n < best.n)) best = c;
      };
      for (var i2 = i + 2; i2 <= b.length; i2++) {
        if (i === 0 && i2 === b.length) break;          // 덩어리 통째는 후보가 아니다
        var w = b.slice(i, i2), rds = dict[w] || [];
        for (var k = 0; k < rds.length; k++) {
          if (r.substr(j, rds[k].length) === rds[k]) take(go(i2, j + rds[k].length, false), w, rds[k], true);
        }
        if (!prevUnk) {
          for (var j2 = j + 1; j2 <= r.length; j2++) take(go(i2, j2, true), w, r.slice(j, j2), false);
        }
      }
      return (memo[key] = best);
    };
    var res = go(0, 0, false);
    return (res && res.n > 1 && res.cov > 0) ? res.parts : [[b, r]];
  }

  // 입력을 글자로 가른다. 반각 탁점처럼 앞 글자에 붙는 것은 한 글자로 본다.
  function midTypedUnits(typed) {
    var s = String(typed || ''), out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (/[\uD800-\uDBFF]/.test(c) && i + 1 < s.length) c += s[++i];
      while (i + 1 < s.length && /[\u3099\u309A\uFF9E\uFF9F]/.test(s[i + 1])) c += s[++i];
      out.push({ raw: c, n: midSentNorm(c) });
    }
    return out;
  }

  // 같은 표시가 이어지는 글자들을 한 덩어리로 감싼다.
  function midRuns(parts) {
    var h = '', cls = null;
    parts.forEach(function (p) {
      if (p.cls !== cls) { if (cls) h += '</span>'; if (p.cls) h += '<span class="' + p.cls + '">'; cls = p.cls; }
      h += p.html;
    });
    return cls ? h + '</span>' : h;
  }

  // 가나를 '비슷한 글자' 끼리 같게: 가타카나→히라가나, 탁점·반탁점 떼기, 작은 글자→큰 글자.
  function midKanaKey(c) {
    var x = c.charCodeAt(0);
    if (x >= 0x30A1 && x <= 0x30F6) c = String.fromCharCode(x - 0x60);
    try { c = c.normalize('NFD').replace(/[\u3099\u309A]/g, ''); } catch (e) {}
    var small = 'ぁぃぅぇぉっゃゅょゎ', big = 'あいうえおつやゆよわ', k = small.indexOf(c);
    return k >= 0 ? big[k] : c;
  }

  function midSentDiff(typed, q) {
    var units = midTypedUnits(typed), T = [];
    units.forEach(function (u, ui) { for (var k = 0; k < u.n.length; k++) T.push({ c: u.n[k], u: ui }); });
    var segs = midSentSegs(q.jp);

    // 격자: inc[v] = v 로 들어오는 글자 길. 마디 번호는 길 방향으로만 커진다.
    var inc = [[]], cur = 0;
    segs.forEach(function (s, si) {
      if (!s.alts.length) return;               // 문장부호는 보지 않는다
      var tails = [];
      s.alts.forEach(function (a, ai) {
        var u = cur;
        for (var k = 0; k < a.length; k++) {
          var e = { from: u, c: a[k], seg: si, alt: ai };
          if (k === a.length - 1) { tails.push(e); break; }
          inc.push([e]); u = inc.length - 1;
        }
      });
      inc.push(tails); cur = inc.length - 1;
    });

    // 어디가 틀렸는지 사람이 보기 좋게 맞추려고 비용을 이렇게 준다(채점은 고칠 곳 수로만 한다):
    // 바꾸기 100(か↔が 처럼 비슷한 가나는 50), 빠뜨리기·더 쓰기는 한 덩어리를 여는 데 100 + 글자마다 50,
    // 맞은 글자는 −1(같은 비용이면 맞은 글자가 많은 쪽).
    var SUB = 100, NEAR = 50, OPEN = 100, EXT = 50, INF = 1e12;
    var N = inc.length, n = T.length, M = [], X = [], Y = [], BM = [], BX = [], BY = [];
    var min3 = function (a, b, c) { return a <= b && a <= c ? [a, 'M'] : (b <= c ? [b, 'X'] : [c, 'Y']); };
    for (var v = 0; v < N; v++) {
      M[v] = []; X[v] = []; Y[v] = []; BM[v] = []; BX[v] = []; BY[v] = [];
      for (var i = 0; i <= n; i++) {
        var m = (v === 0 && i === 0) ? 0 : INF, bm = null, x = INF, bx = null;
        for (var j = 0; j < inc[v].length; j++) {
          var e = inc[v][j], u = e.from;
          if (i > 0) {   // 맞음·바꿈: 입력 글자 하나와 정답 글자 하나
            var t = T[i - 1].c, cost = t === e.c ? -1 : (midKanaKey(t) === midKanaKey(e.c) ? NEAR : SUB);
            var p = min3(M[u][i - 1], X[u][i - 1], Y[u][i - 1]);
            if (p[0] + cost < m) { m = p[0] + cost; bm = { e: e, s: p[1], k: t === e.c ? 'ok' : 'sub' }; }
          }
          // 빠뜨림: 정답 글자만 지나간다
          var xo = Math.min(M[u][i], Y[u][i]) + OPEN + EXT, xe = X[u][i] + EXT;
          if (xe <= xo) { if (xe < x) { x = xe; bx = { e: e, s: 'X' }; } }
          else if (xo < x) { x = xo; bx = { e: e, s: M[u][i] <= Y[u][i] ? 'M' : 'Y' }; }
        }
        var y = INF, by = null;
        if (i > 0) {   // 더 씀: 입력 글자만 지나간다
          var yo = Math.min(M[v][i - 1], X[v][i - 1]) + OPEN + EXT, ye = Y[v][i - 1] + EXT;
          if (ye <= yo) { y = ye; by = 'Y'; } else { y = yo; by = M[v][i - 1] <= X[v][i - 1] ? 'M' : 'X'; }
        }
        M[v][i] = m; BM[v][i] = bm; X[v][i] = x; BX[v][i] = bx; Y[v][i] = y; BY[v][i] = by;
      }
    }

    // 되짚기: 입력의 어느 글자가 틀렸고, 정답의 어느 낱말을 놓쳤고, 어디서 빠뜨렸는지.
    var tBad = [], gap = {}, segBad = {}, steps = 0, dist = 0;
    v = N - 1; i = n;
    var st = min3(M[v][i], X[v][i], Y[v][i])[1], guard = 0;
    while ((v > 0 || i > 0) && guard++ < 100000) {
      if (st === 'Y') { tBad[i - 1] = true; dist++; st = BY[v][i]; i--; continue; }
      var h = st === 'M' ? BM[v][i] : BX[v][i];
      if (!h) break;
      steps++;
      if (st === 'M') {
        if (h.k === 'sub') { tBad[i - 1] = true; segBad[h.e.seg] = true; dist++; }
        i--;
      } else { segBad[h.e.seg] = true; gap[i] = true; dist++; }
      st = h.s; v = h.e.from;
    }
    var ok = n > 0 && dist === 0;
    var sim = n ? Math.max(0, Math.round((1 - dist / Math.max(n, steps)) * 100)) : 0;

    // 내 답: 맞은 글자 · 틀린 글자 · 빠뜨린 자리(▏).
    var uBad = [], uGap = [];
    T.forEach(function (t, k) { if (tBad[k]) uBad[t.u] = true; });
    Object.keys(gap).forEach(function (k) { k = Number(k); uGap[k < n ? T[k].u : units.length] = true; });
    var mine = [];
    units.forEach(function (u, k) {
      if (uGap[k]) mine.push({ cls: null, html: '<i class="d-gap"></i>' });
      mine.push({ cls: !u.n ? null : (uBad[k] ? 'd-bad' : 'd-ok'), html: esc(u.raw) });
    });
    if (uGap[units.length]) mine.push({ cls: null, html: '<i class="d-gap"></i>' });

    // 정답: 틀렸거나 빠뜨린 낱말을 칠한다.
    var ans = segs.map(function (s, si) {
      var body = s.base != null
        ? (s.rt ? '<ruby>' + esc(s.base) + '<rt>' + esc(s.rt) + '</rt></ruby>' : esc(s.base))
        : esc(s.t);
      return { cls: segBad[si] ? 'd-miss' : null, html: body };
    });

    return { ok: ok, sim: ok ? 100 : sim, mine: midRuns(mine), ans: midRuns(ans) };
  }

  function midSentBadge(q) {
    var r = Store.examProg()[q.id];
    return !r ? ['new', '미학습'] : (r.ok ? ['long', '맞힘'] : ['unknown', '틀림']);
  }

  // 정답(후리가나) · 해석 · 이 문장의 문형 해설. 넘기며 보기·돌아보기·목록이 같이 쓴다.
  // jpHTML 은 채점 뒤 틀린 낱말을 칠한 정답(midSentDiff 의 ans).
  function midSentAnswerHTML(q, jpHTML) {
    var sp = q.sp || midSpeaker(q.jp);
    return '<div class="answer-box mid-sans">' +
        '<p class="mid-sjp" lang="ja">' + (sp ? '<span class="mid-sp">' + sp + '</span>' : '') + (jpHTML || gJP(midSentSrc(q.jp), { ruby: true })) + '</p>' +
      '</div>' +
      ((q.items || []).length ? '<div class="detail-box mid-detail"><ul class="mt-its">' +
        q.items.map(function (it) { return '<li>' + midItemFmt(it) + '</li>'; }).join('') + '</ul></div>' : '');
  }

  function midSentPromptHTML(q) {
    var sp = q.sp || midSpeaker(q.jp);
    return '<div class="rev-ko mid-sko">' + (sp ? '<span class="mid-sp">' + sp + '</span>' : '') + esc(q.ko) + '</div>';
  }

  function midSentCardHTML(q) {
    var b = midSentBadge(q);
    return '<div class="card mid-q">' +
      '<div class="card-meta"><span class="badge ' + b[0] + '">' + b[1] + '</span>' +
        '<span class="card-no">' + midSetName(q.set) + ' · ' + esc(q.where) + '</span></div>' +
      midSentPromptHTML(q) + midSentAnswerHTML(q) + '</div>';
  }

  function renderMidSentQ(q) {
    var m = mid, b = midSentBadge(q);
    var h = '<div class="card mid-q">' +
      '<div class="card-meta"><span class="badge ' + b[0] + '">' + b[1] + '</span>' +
        '<span class="card-no">' + midSetName(q.set) + ' · ' + esc(q.where) + '</span></div>' +
      midSentPromptHTML(q);
    if (m.state === 'ask') {
      h += '<input class="ginp mid-sinp" id="midSentAns" lang="ja" placeholder="일본어로 쓰기" ' +
           'autocomplete="off" autocapitalize="off" spellcheck="false">' +
           '<button class="next-btn" id="midSentSubmit">확인</button>' +
           '<button class="known-btn" id="midSentSkip">모르겠어요 · 정답 보기</button>';
    } else {
      var ok = m.graded === 'right', d = m.diff, marks = d && !d.ok;
      h += '<div class="gjudge ' + (m.graded === 'skip' ? 'skip' : (ok ? 'right' : 'wrong')) + '">' +
           (m.graded === 'skip' ? '정답을 확인하세요'
             : ok ? (marks ? '정답으로 처리 · 일치 ' + m.sim + '%' : '정답입니다')
             : '틀렸습니다 · 일치 ' + m.sim + '%') + '</div>';
      // 내 답은 맞은 글자 · 틀린 글자 · 빠뜨린 자리로, 정답은 놓친 낱말을 칠해 보여 준다.
      if (marks)
        h += '<div class="gcmp"><span class="cl">내 답</span><span class="cv mid-styped" lang="ja">' + d.mine + '</span></div>';
      h += midSentAnswerHTML(q, marks ? d.ans : '');
      h += '<button class="next-btn" id="midSentNext">다음 <kbd>Enter</kbd></button>';
      if (!ok) h += '<button class="known-btn" id="midSentOk">이것도 맞아요 · 정답 처리</button>';
    }
    h += '</div>';
    $('midStage').innerHTML = h;
    $('midBar').hidden = true;      // 단어 모드의 입력 카드처럼 아래 바 없이 카드 안 버튼으로 간다
    if ($('midSentAns')) {
      $('midSentAns').focus();
      $('midSentAns').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); midSentSubmit(false); }
      });
    }
    if ($('midSentSubmit')) $('midSentSubmit').addEventListener('click', function () { midSentSubmit(false); });
    if ($('midSentSkip')) $('midSentSkip').addEventListener('click', function () { midSentSubmit(true); });
    if ($('midSentNext')) $('midSentNext').addEventListener('click', midSentNext);
    if ($('midSentOk')) $('midSentOk').addEventListener('click', function () { mid.graded = 'right'; renderMidQ(); });
    window.scrollTo(0, 0);
  }

  function midSentSubmit(skip) {
    var m = mid;
    if (!m || m.state !== 'ask') return;
    var q = m.queue[m.idx], el = $('midSentAns');
    m.typed = el ? el.value.trim() : '';
    m.diff = null;
    if (skip) { m.graded = 'skip'; m.sim = 0; }
    else if (!m.typed) { if (el) el.focus(); return; }
    else { var r = midSentDiff(m.typed, q); m.graded = r.ok ? 'right' : 'wrong'; m.sim = r.sim; m.diff = r; }
    m.state = 'typed';
    renderMidQ();
  }

  function midSentNext() {
    var m = mid;
    if (!m || m.state !== 'typed') return;
    var ok = m.graded === 'right';
    m.typed = ''; m.graded = null; m.sim = 0; m.diff = null;
    midAnswer(ok);
  }

  // from: 묶음 화면의 목록이면 펼친 안에 '여기서부터 시험 보기' 를 둔다.
  function midSentItemHTML(q, state, side, from) {
    var dot = state === 'ok' ? 'dot-long' : (state === 'bad' ? 'dot-unknown' : 'dot-new');
    return '<div class="wl-item has-detail mid-li" role="button" tabindex="0">' +
      '<div class="wl-head"><span class="wl-dot ' + dot + '"></span>' +
        '<div class="wl-main"><div class="mid-li-ko">' + esc(q.ko) + '</div>' +
          '<div class="wl-meaning">' + esc(q.where) + '</div></div>' +
        (side ? '<span class="wl-side">' + esc(side) + '</span>' : '') +
        '<span class="wl-caret">▾</span></div>' +
      '<div class="wl-detail" hidden>' +
        (from ? '<button class="mini-btn go mid-from" data-from="' + q.no + '">여기서부터 시험 보기</button>' : '') +
        midSentAnswerHTML(q) + '</div>' +
    '</div>';
  }

  // 고른 문장부터 끝까지 교재 순서대로.
  function midSentFrom(no) {
    var c = midSetCur;
    if (!c || c.key.indexOf('sents:') !== 0) return;
    var list = c.list.filter(function (q) { return q.no >= no; }), first = list[0];
    if (first) midStart('practice', midOrder(list), c.title + ' · ' + first.where + '부터', 'midSet');
  }

  // 아래 바: 단어 시험과 같다. 정답 보기 → O/X. 보기를 골랐으면 채점이 끝났으니 '다음' 만.
  function midBarState() {
    var m = mid, mock = m.mode === 'mock';
    $('btnMidReveal').hidden = mock || m.state !== 'ask';
    $('midOX').hidden = mock || m.state !== 'self';
    $('btnMidNext').hidden = mock || m.state !== 'picked';
    $('btnMidNext').disabled = false;
    $('btnMidPrev').hidden = !mock;
    $('btnMidFwd').hidden = !mock;
    if (mock) {
      $('btnMidPrev').disabled = m.idx === 0;
      var answered = m.picks.filter(function (x) { return x != null; }).length;
      $('btnMidFwd').innerHTML = (m.idx === m.queue.length - 1)
        ? '제출 · ' + answered + '/' + m.queue.length : '다음 <kbd>→</kbd>';
    }
  }

  function midPick(i) {
    var m = mid;
    if (!m || m.finished || m.peek != null) return;
    if (m.mode === 'mock') { m.picks[m.idx] = i; renderMidQ(); return; }   // 제출 전까지 바꿀 수 있다
    var ty = m.queue[m.idx].type;
    if (m.state !== 'ask' || ty === 'word' || ty === 'sent') return;       // 단어·문장 카드는 보기가 없다
    m.pick = i; m.state = 'picked';
    renderMidQ();
  }

  function midReveal() {
    var m = mid;
    if (!m || m.finished || m.mode === 'mock' || m.state !== 'ask') return;
    m.state = 'self';
    renderMidQ();
  }

  // O/X 를 누르거나(정답 보기로 연 경우), 고른 보기로 채점된 뒤 '다음' 을 누를 때.
  function midAnswer(ok) {
    var m = mid;
    if (!m || m.finished || m.mode === 'mock' || m.state === 'ask') return;
    var q = m.queue[m.idx];
    var r = m.res[q.id];
    if (!r) {
      // 기록은 이 판에서 처음 낸 답으로만 남긴다. 다시 나와서 맞힌 것은 '틀린 문제' 에서 빼지 않는다.
      r = m.res[q.id] = { q: q, tries: 0, firstOk: ok, pick: m.pick };
      m.order.push(q.id);
      if (!midIsWord(q)) {
        Store.examGrade(q.id, ok);
        if (global_Sync()) Sync.touch();
      }
    }
    r.tries++;
    r.lastOk = ok;
    if (ok) m.done++; else m.retry.push(q);
    m.idx++; m.state = 'ask'; m.pick = null;
    // 틀린 문제는 이 판을 못 떠난다. 한 바퀴를 다 돌면 섞어서 다시 낸다.
    if (m.idx >= m.queue.length && m.retry.length) {
      m.queue = midOrder(m.retry); m.retry = []; m.idx = 0; m.lap++;
      toast('남은 ' + m.queue.length + midUnit(m.queue[0]) + (m.queue[0].type === 'sent' ? '을 다시 냅니다' : '를 섞어서 다시 냅니다'));
    }
    if (m.idx >= m.queue.length) { midFinish(); return; }
    renderMidQ();
  }

  function midNextPicked() {
    var m = mid;
    if (!m || m.state !== 'picked') return;
    midAnswer(m.pick === m.queue[m.idx].ans);
  }

  function midGo(d) {
    var m = mid;
    if (!m || m.finished || m.mode !== 'mock') return;
    var n = m.idx + d;
    if (n < 0 || n >= m.queue.length) return;
    m.idx = n;
    renderMidQ();
  }

  function midFwd() {
    var m = mid;
    if (!m || m.mode !== 'mock') return;
    if (m.idx < m.queue.length - 1) { midGo(1); return; }
    var left = m.picks.filter(function (x) { return x == null; }).length;
    if (left && !confirm(left + '문제를 안 풀었습니다. 그래도 제출할까요?')) return;
    midFinish();
  }

  // 여기까지: 푼 것만 결과로. 남은 문제는 묶음에 그대로 남는다.
  function midStop() {
    var m = mid;
    if (!m || m.finished) return;
    if (!m.order.length) { m.finished = true; stopMidTick(); goView(m.from); return; }
    midFinish(true);
  }

  function midFinish(stopped) {
    var m = mid;
    if (!m || m.finished) return;
    stopMidTick();
    m.finished = true;
    m.end = Date.now();
    var items;
    if (m.mode === 'mock') {
      // 안 푼 문제도 시험에서는 틀린 것이다. 틀린 문제로 모아 다시 풀게 한다.
      items = m.queue.map(function (q, i) {
        var ok = m.picks[i] === q.ans;
        Store.examGrade(q.id, ok);
        return { q: q, tries: 1, firstOk: ok, pick: m.picks[i] };
      });
      if (global_Sync()) Sync.touch();
    } else {
      items = m.order.map(function (id) { return m.res[id]; });
    }
    openMidResult(items, m, stopped);
  }

  /* ----- 돌아보기 (←): 이 판에서 이미 푼 문제를 읽기만 한다 ----- */

  function midPeekOpen(i) {
    var m = mid;
    if (!m || m.finished || m.mode === 'mock' || !m.order.length) return;
    if (i < 0 || i >= m.order.length) return;
    m.peek = i;
    var r = m.res[m.order[i]];
    $('midPeek').innerHTML =
      '<div class="mid-peek-bar">' +
        '<button class="mini-btn" id="mpPrev"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
        '<span>돌아보기 ' + (i + 1) + ' / ' + m.order.length + '</span>' +
        '<button class="mini-btn" id="mpNext">→</button>' +
        '<button class="mini-btn go" id="mpClose">풀던 문제로</button>' +
      '</div>' + midCardHTML(r.q, { reveal: true, pick: r.pick });
    $('midPeek').hidden = false;
    $('midStage').hidden = true;
    $('midBar').hidden = true;
    $('mpPrev').addEventListener('click', function () { midPeekOpen(m.peek - 1); });
    $('mpNext').addEventListener('click', function () {
      if (m.peek >= m.order.length - 1) midPeekClose(); else midPeekOpen(m.peek + 1);
    });
    $('mpClose').addEventListener('click', midPeekClose);
    window.scrollTo(0, 0);
  }

  function midPeekClose() {
    if (!mid) return;
    mid.peek = null;
    $('midPeek').hidden = true;
    $('midStage').hidden = false;
    var cq = mid.queue[mid.idx];
    $('midBar').hidden = (view !== 'midQuiz') || !!(cq && cq.type === 'sent');
  }

  /* ----- 결과 (단어 시험 결과와 같은 꼴) ----- */

  function openMidResult(items, m, stopped) {
    var n = items.length, first = items.filter(function (x) { return x.firstOk; }).length;
    var mock = m.mode === 'mock';
    var mins = Math.max(1, Math.round(((m.end || Date.now()) - m.start) / 60000));
    if (mock) {
      var none = items.filter(function (x) { return x.pick == null; }).length;
      $('mrTitle').textContent = first + ' / ' + n + ' · ' + Math.round(first / n * 100) + '점';
      $('mrStats').innerHTML = midStatCells([['total', n, '전체'], ['long', first, '맞힘'],
                                             ['unknown', n - first - none, '틀림'], ['', none, '안 품']]);
    } else {
      var later = items.filter(function (x) { return !x.firstOk && x.lastOk; }).length;
      var unit = midUnit(items[0] && items[0].q);
      $('mrTitle').textContent = n + unit + ' 중 ' + first + '개를 한 번에';
      $('mrStats').innerHTML = midStatCells([['total', n, unit === '단어' ? '본 단어' : '푼 ' + unit], ['long', first, '한 번에'],
                                             ['short', later, '다시 풀어 맞힘'], ['unknown', n - first - later, '못 맞힘']]);
    }
    var left = (!mock && stopped) ? (m.queue.length - m.idx) + m.retry.length : 0;
    $('mrMeta').textContent = m.label + ' · ' + mins + '분' + (left ? ' · 여기까지 하고 멈춤(남은 ' + left + midUnit(items[0] && items[0].q) + ')' : '');
    $('mrMeta').hidden = false;

    var byKind = {};
    items.forEach(function (x) {
      var k = byKind[x.q.kind] || (byKind[x.q.kind] = { n: 0, ok: 0 });
      k.n++; if (x.firstOk) k.ok++;
    });
    $('mrKinds').innerHTML = MID_KIND_ORDER.filter(function (k) { return byKind[k]; }).map(function (k) {
      return '<span class="mid-kd">' + MID_KIND[k] + '<b>' + byKind[k].ok + '/' + byKind[k].n + '</b></span>';
    }).join('');

    midRes = { all: items, wrong: items.filter(function (x) { return !x.firstOk; }),
               view: 'wrong', label: m.label, from: m.from, mock: mock };
    if (!midRes.wrong.length) midRes.view = 'all';
    renderMidResList();
    $('mrRetryCount').textContent = midRes.wrong.length + midUnit(items[0] && items[0].q);
    $('btnMrRetry').disabled = !midRes.wrong.length;
    show('midResult');
  }

  function midTriesLabel(x, mock) {
    if (mock) return x.pick == null ? '안 품' : (x.firstOk ? '맞힘' : '틀림');
    if (x.firstOk) return '한 번에 맞힘';
    return x.lastOk ? x.tries + '번 만에 맞힘' : '틀림';
  }

  function renderMidResList() {
    var r = midRes;
    if (!r) return;
    var list = r.view === 'wrong' ? r.wrong : r.all;
    $('mrTabWrong').classList.toggle('sel', r.view === 'wrong');
    $('mrTabAll').classList.toggle('sel', r.view === 'all');
    var unit = midUnit(r.all[0] && r.all[0].q);
    $('mrTabWrong').textContent = '틀린 ' + unit;
    $('mrListTitle').textContent = r.view === 'wrong' ? '틀린 ' + unit : '전체';
    $('mrEmpty').hidden = list.length > 0;
    $('mrEmpty').textContent = '한 번에 다 맞혔습니다';
    $('btnMrBrowse').disabled = !list.length;
    $('mrList').innerHTML = list.map(function (x) {
      var st = x.firstOk ? 'ok' : 'bad', side = midTriesLabel(x, r.mock);
      if (x.q.type === 'word') return midWordItemHTML(x.q, st, side);
      if (x.q.type === 'sent') return midSentItemHTML(x.q, st, side);
      return midItemHTML(x.q, st, side, x.pick);
    }).join('');
  }

  /* ----- 넘기며 보기 (단어의 넘기며 보기와 같다) ----- */

  // list 는 문제 그대로이거나, 결과 화면에서 온 { q, pick } 묶음이다.
  function midBrowseStart(list, label) {
    if (!list.length) return;
    midBrowse = { list: list.slice(), index: 0, label: label, from: view };
    show('midBrowse');
    renderMidBrowse();
  }

  function renderMidBrowse() {
    var b = midBrowse, x = b.list[b.index];
    // 결과 화면에서 온 { q, pick } 묶음인지는 q 가 객체인지로 가린다(문제 자체에도 글자 q 가 있다).
    var wrap = !!x.q && typeof x.q === 'object';
    var q = wrap ? x.q : x, pick = wrap ? x.pick : null;
    $('mbStage').innerHTML = midCardHTML(q, { reveal: true, pick: pick });
    var n = b.list.length;
    $('mbCount').textContent = (b.index + 1) + ' / ' + n;
    $('mbLabel').textContent = b.label;
    $('mbFill').style.width = ((b.index + 1) / n * 100) + '%';
    $('mbPrev').disabled = b.index === 0;
    $('mbNext').textContent = (b.index === n - 1) ? '목록으로' : '다음';
    window.scrollTo(0, 0);
  }

  function midBrowseGo(step) {
    var b = midBrowse;
    if (!b) return;
    var i = b.index + step;
    if (i < 0) return;
    if (i >= b.list.length) { goView(b.from); return; }
    b.index = i;
    renderMidBrowse();
  }

  /* ----- 키보드: 단어 시험과 같다 ----- */
  // Enter = 정답 보기 → O, 0 = X, 1~4 = 보기 고르기, ← = 돌아보기.
  // 모의고사는 ← → 로 오가고 Enter 로 다음.
  function midKey(ev) {
    var m = mid;
    if (!m || m.finished) return;
    var k = ev.key;
    if (m.peek != null) {
      if (k === 'ArrowLeft') { ev.preventDefault(); midPeekOpen(m.peek - 1); }
      else if (k === 'ArrowRight') { ev.preventDefault(); if (m.peek >= m.order.length - 1) midPeekClose(); else midPeekOpen(m.peek + 1); }
      else if (k === 'Escape') { ev.preventDefault(); midPeekClose(); }
      return;
    }
    if (k >= '1' && k <= '4') { ev.preventDefault(); midPick(Number(k) - 1); return; }
    if (m.mode === 'mock') {
      if (k === 'ArrowRight' || k === 'Enter') { ev.preventDefault(); midFwd(); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); midGo(-1); }
      return;
    }
    if (k === 'ArrowLeft') { ev.preventDefault(); midPeekOpen(m.order.length - 1); return; }
    // 본문 쓰기: 입력칸의 Enter 는 입력칸이 받는다. 채점 뒤 Enter 는 다음.
    if (m.queue[m.idx].type === 'sent') {
      // 버튼('이것도 맞아요' 등)에 포커스가 있으면 Enter 는 그 버튼이 받는다
      if (ev.target && ev.target.closest && ev.target.closest('button, a')) return;
      if ((k === 'Enter' || k === ' ') && m.state === 'typed') { ev.preventDefault(); midSentNext(); }
      return;
    }
    if (k === 'Enter' || k === ' ') {
      ev.preventDefault();
      if (m.state === 'ask') midReveal();
      else if (m.state === 'self') midAnswer(true);
      else midNextPicked();
      return;
    }
    if (k === '0' && m.state === 'self') { ev.preventDefault(); midAnswer(false); }
  }

  function midBrowseKey(ev) {
    if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); midBrowseGo(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); midBrowseGo(-1); }
  }

  // 목록 줄을 누르면 정답·해설이 펼쳐진다.
  function midListToggle(ev) {
    var item = ev.target.closest('.wl-item.has-detail');
    if (!item) return;
    if (ev.target.closest('.wl-detail')) return;   // 펼친 안쪽을 누르는 것은 접지 않는다
    var d = item.querySelector('.wl-detail');
    d.hidden = !d.hidden;
    item.classList.toggle('open', !d.hidden);
  }

  function bindMid() {
    $('pkMid').addEventListener('click', function () { goView('mid'); });
    $('btnMidMock').addEventListener('click', function () {
      if (mid && mid.mode === 'mock' && !mid.finished && !confirm('풀던 모의고사를 버리고 새로 시작할까요?')) return;
      midMock();
    });
    $('btnMidResume').addEventListener('click', function () {
      if (!mid || mid.finished) { renderMid(); return; }
      show('midQuiz');
      if (mid.mode === 'mock') {
        if (Date.now() >= mid.deadline) { toast('시간이 끝나 제출했습니다'); midFinish(); return; }
        startMidTick();
      }
      renderMidQ();
    });
    $('btnMidWrong').addEventListener('click', function () { openMidSet('wrong'); });
    $('midKinds').addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (c) openMidSet('kind:' + c.dataset.kind);
    });
    // 과 카드·정리·단어 화면의 버튼은 data-act 하나로 받는다.
    ['midLessons', 'midNote'].forEach(function (id) {
      $(id).addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act]');
        if (b) {
          var set = b.dataset.set, act = b.dataset.act;
          if (act === 'note') openMidNote(set);
          else if (act === 'words') openMidSet('words:' + set);
          else if (act === 'sents') openMidSet('sents:' + set);
          else if (act === 'wquiz') midWordQuiz(set);
          else if (act === 'set') openMidSet(set);
          else if (act === 'text') openMidText(set);
          return;
        }
        var hide = ev.target.closest('[data-hide]');
        if (hide) {
          hide.classList.toggle('sel');
          $$('#midWords .mid-wt').forEach(function (t) {
            t.classList.toggle('hide-' + hide.dataset.hide, hide.classList.contains('sel'));
          });
          $$('#midWords .mid-wt td.peek').forEach(function (td) { td.classList.remove('peek'); });
          return;
        }
        var td = ev.target.closest('#midWords .mid-wt td');
        if (td) { td.classList.toggle('peek'); return; }
        var qa = ev.target.closest('.mid-qa');
        if (qa) { var a = qa.querySelector('.mid-qa-a'); a.hidden = !a.hidden; }
      });
    });

    // 묶음 화면
    $('btnMsAll').addEventListener('click', function () {
      if (midSetCur) midStart('practice', midOrder(midSetCur.list), midSetCur.title, 'midSet');
    });
    $('btnMsWrong').addEventListener('click', function () {
      if (!midSetCur) return;
      var p = Store.examProg();
      var w = midSetCur.list.filter(function (q) { return p[q.id] && !p[q.id].ok; });
      midStart('practice', midOrder(w), midSetCur.title + ' · 틀린 것', 'midSet');
    });
    $('btnMsBrowse').addEventListener('click', function () {
      if (midSetCur) midBrowseStart(midSetCur.list, midSetCur.title);
    });
    $('btnMsWQuiz').addEventListener('click', function () {
      if (midSetCur && midSetCur.key.indexOf('words:') === 0) midWordQuiz(midSetCur.key.slice(6));
    });
    $('msList').addEventListener('click', function (ev) {
      var f = ev.target.closest('[data-from]');
      if (f) { midSentFrom(Number(f.dataset.from)); return; }
      midListToggle(ev);
    });

    // 풀기
    $('btnMidReveal').addEventListener('click', midReveal);
    $('btnMidO').addEventListener('click', function () { midAnswer(true); });
    $('btnMidX').addEventListener('click', function () { midAnswer(false); });
    $('btnMidNext').addEventListener('click', midNextPicked);
    $('btnMidPrev').addEventListener('click', function () { midGo(-1); });
    $('btnMidFwd').addEventListener('click', midFwd);
    $('btnMidStop').addEventListener('click', midStop);

    // 결과
    $('mrTabWrong').addEventListener('click', function () { if (midRes) { midRes.view = 'wrong'; renderMidResList(); } });
    $('mrTabAll').addEventListener('click', function () { if (midRes) { midRes.view = 'all'; renderMidResList(); } });
    $('btnMrBrowse').addEventListener('click', function () {
      if (!midRes) return;
      midBrowseStart(midRes.view === 'wrong' ? midRes.wrong : midRes.all,
                     midRes.label + ' · ' + (midRes.view === 'wrong' ? '틀린 문제' : '전체'));
    });
    $('btnMrRetry').addEventListener('click', function () {
      if (!midRes || !midRes.wrong.length) return;
      midStart('practice', midOrder(midRes.wrong.map(function (x) { return x.q; })), midRes.label + ' · 틀린 것', midRes.from);
    });
    $('btnMrBack').addEventListener('click', function () { goView('mid'); });
    $('mrList').addEventListener('click', midListToggle);

    // 넘기며 보기
    $('mbPrev').addEventListener('click', function () { midBrowseGo(-1); });
    $('mbNext').addEventListener('click', function () { midBrowseGo(1); });

    // 본문 해설: 본문/회화 탭, 후리가나, 문단 번호, 앞뒤 문단
    $('midText').addEventListener('click', function (ev) {
      var c = midTextCur, b;
      if (!c) return;
      if ((b = ev.target.closest('[data-sec]'))) { c.sec = Number(b.dataset.sec); c.para = 0; renderMidText(); return; }
      if ((b = ev.target.closest('[data-furi]'))) { c.furi = !c.furi; renderMidText(); return; }
      if ((b = ev.target.closest('[data-para]'))) { c.para = Number(b.dataset.para); renderMidText(); return; }
      if ((b = ev.target.closest('[data-step]'))) { midTextGo(Number(b.dataset.step)); }
    });
  }

  /* ---------------- 이벤트 ---------------- */

  function bind() {
    bindMid();
    $('btnHome').addEventListener('click', function () { goBack(); });
    $('btnSearchTop').addEventListener('click', openSearch);
    $('btnSearchClose').addEventListener('click', goBack);

    $('btnResume').addEventListener('click', resumeSession);
    $('btnKjResume').addEventListener('click', resumeSession);
    // 첫 화면의 이어서 학습. 단어든 한자든 문법이든 풀던 자리로 바로 들어간다.
    $('btnPkResume').addEventListener('click', function () {
      if (pkResume === 'gram') {
        if (!restoreGSession()) { renderPick(); return; }
        show('gramStudy');
        renderGramCard();
        return;
      }
      resumeSession();
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
      if (!selected.length) {
        var order = $$('#dayGrid .day-cell').map(function (c) { return Number(c.dataset.day); });
        selected = chainPick(order, n, function (l) { return wordsOf(l).length; });
        selected.sort(function (a, b) { return a - b; });
        $$('#dayGrid .day-cell').forEach(function (c) {
          c.classList.toggle('sel', isSel(Number(c.dataset.day)));
        });
      } else {
        toggleSel(n);
        cell.classList.toggle('sel', isSel(n));
      }
      $('btnSelAll').textContent =
        (selected.length === gridDays().length && selected.length) ? '선택 해제' : '전체 선택';
      renderSelBar();
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
      // 주의할 단어 별. 카드든 목록이든 여기서 받는다. 목록 펼침이 같이 돌지 않게 끊는다.
      var mk = ev.target.closest('.mark-btn[data-mark]');
      if (mk) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleMark(mk.dataset.mark);
        return;
      }
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

    $('lcChips').addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-lc]');
      if (!c) return;
      var L = lcLessons().filter(function (x) { return x.set === c.dataset.lc; })[0];
      if (!L) return;
      var list = lcWords(L);
      if (!list.length) return;
      currentDays = [];
      renderSet(list, '듣기 ' + L.no + ' · ' + L.jp, list.length + '단어', true);
    });
    $('posChips').addEventListener('click', function (ev) {
      // 반복어(ぶかぶか 꼴)는 품사가 아니라 낱말 모양으로 모은다.
      if (ev.target.closest('.rep-chip')) {
        var reps = repWords();
        if (!reps.length) return;
        currentDays = [];
        renderSet(reps, '반복어', reps.length + '단어 · 전체 Day', true);
        return;
      }
      var chip = ev.target.closest('.pos-chip');
      if (!chip) return;
      var g = POS_GROUPS.filter(function (x) { return x.has === chip.dataset.has; })[0];
      var list = wordsOfPos(g.has);
      // 여러 Day 에서 모은 것이라 항목마다 어느 Day 인지 함께 보여준다.
      currentDays = [];
      renderSet(list, g.label, list.length + '단어 · 전체 Day', true);
    });

    $('btnSelAll').addEventListener('click', function () {
      var all = gridDays().map(function (d) { return d.day; });
      selected = (selected.length === all.length) ? [] : all;
      renderHome();
    });
    // 바의 버튼은 Day 선택과 한자 선택이 함께 쓴다. 보고 있는 화면으로 갈라 준다.
    var onKanji = function () { return view === 'kanji'; };
    var kjAll = function () { return wordsOfKanjiList(kjSel); };

    $('btnSelClear').addEventListener('click', function () {
      if (onKanji()) { kjSel = []; renderKanjiList(); renderKjSelBar(); return; }
      selected = [];
      renderHome();
    });
    $('btnSelView').addEventListener('click', function () {
      if (onKanji()) {
        if (!kjSel.length) return;
        if (kjSel.length === 1) { openKanji(kjSel[0]); return; }   // 한 자면 한자 풀이까지 보여 준다
        currentDays = [];
        renderSet(kjAll(), kjLabel(kjSel), kjSel.length + '자 · ' + kjAll().length + '단어', true, '', 'kanji');
        return;
      }
      renderDays(selected);
    });
    $('btnSelUnknown').addEventListener('click', function () {
      if (onKanji()) { startSession(byStage('unknown', kjAll()), kjLabel(kjSel) + ' · 모름', 0, 'kanji'); return; }
      startSession(byStage('unknown', wordsOf(selected)), dayLabel(selected) + ' · 모름');
    });
    $('btnSelShort').addEventListener('click', function () {
      if (onKanji()) { startSession(byStage('short', kjAll()), kjLabel(kjSel) + ' · 단기기억', 0, 'kanji'); return; }
      startSession(byStage('short', wordsOf(selected)), dayLabel(selected) + ' · 단기기억');
    });
    $('btnSelStudy').addEventListener('click', function () {
      if (onKanji()) { startSession(kjAll(), kjLabel(kjSel), 0, 'kanji'); return; }
      startSession(entriesOfDays(selected, false), dayLabel(selected));
    });
    $('btnSelDue').addEventListener('click', function () {
      if (onKanji()) {
        // 한자 모드 복습: 한자 모드로 공부한 단어 가운데 복습일이 된 것
        var due = kjAll().filter(function (e) { return Store.isKanjiSeen(e.day, e.w) && Store.isDue(e.day, e.w); });
        startSession(due, kjLabel(kjSel) + ' 복습', 0, 'kanji');
        return;
      }
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
      startSession(currentSet.entries, currentSet.label, 0, currentSet.src);
    });
    $('btnStudyDue').addEventListener('click', function () {
      startSession(currentSet.entries.filter(function (e) { return Store.isDue(e.day, e.w); }),
        currentSet.label + ' 복습', 0, currentSet.src);
    });
    $('btnReviewToday').addEventListener('click', function () {
      startSession(Store.dueList(), '오늘의 복습');
    });
    // 목록을 먼저 보여준다. 많이 흔들린 것부터 나오니 무엇이 문제인지 눈에 들어온다.
    $('btnMarkedStudy').addEventListener('click', function () {
      var list = Store.markedList();
      if (!list.length) return;
      currentDays = [];
      renderSet(list, '주의할 단어', list.length + '단어', true);
    });
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

    $('btnRetryWrong').addEventListener('click', function () {
      startSession(resultRetry, '틀린 단어 다시');
    });
    // 한자 쪽에서 온 결과면 한자 화면으로 돌려보낸다.
    $('btnResultHome').addEventListener('click', function () {
      if (resultFrom === 'kanji') { goView('kanji'); return; }
      renderHome(); show('home');
    });
    // 시험 기록. 줄을 누르면 그 판의 결과 화면이 그대로 열린다.
    // 접두어·접미어. 탭으로 접두어와 접미어를 오간다.
    $('btnStopStudy').addEventListener('click', function () { stopSession(); });
    $('btnAffix').addEventListener('click', function () { affixTab = 'pre'; renderAffix(); show('affix'); });
    // 한자별 학습. 단계를 고르고, 한자를 누르면 그 한자가 든 단어 목록으로 간다.
    $('pkKanji').addEventListener('click', function () { goView('kanji'); });
    $('btnInstall').addEventListener('click', doInstall);
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();          // 크롬이 제 자리에 띄우는 작은 배너 대신 우리 버튼으로 받는다
      installPrompt = ev;
      renderInstall();
    });
    window.addEventListener('appinstalled', function () { installPrompt = null; renderInstall(); });
    renderInstall();
    $('kanjiTabs').addEventListener('click', function (ev) {
      var t = ev.target.closest('.res-tab');
      if (t) { kanjiStep = Number(t.dataset.step); renderKanjiList(); }
    });
    // Day 고르기와 같다: 눌러서 고르고, 바의 버튼으로 목록을 보거나 학습을 시작한다.
    // 마우스로 쭉 훑어서 여러 한자를 한 번에 고른다. 하나씩 누르는 것이 번거로워서다.
    // 시작한 칸이 꺼져 있으면 지나가는 칸을 켜고, 켜져 있으면 끈다(지우개처럼 쓸 수 있다).
    // 손가락(터치)은 그대로 둔다. 쓸어 넘기기가 화면 넘기기와 겹치면 목록을 못 내린다.
    var kjDrag = null;        // { on: true|false, last: '한자', n: 칸 수 }
    var kjDragDid = false;    // 방금 끌어서 골랐다. 뒤따라오는 click 은 무시한다.

    function kjPaint(c) {
      if (!c || c.dataset.k === kjDrag.last) return;
      kjDrag.last = c.dataset.k;
      if (kjIsSel(c.dataset.k) !== kjDrag.on) {
        kjToggle(c.dataset.k);
        c.classList.toggle('sel', kjIsSel(c.dataset.k));
        kjDrag.n++;
        renderKjSelBar();
      }
    }

    $('kanjiGrid').addEventListener('pointerdown', function (ev) {
      if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
      var c = ev.target.closest('.kj-cell');
      if (!c) return;
      // 시작 칸은 아직 건드리지 않는다. 그냥 누른 것이면 click 이 하던 일을 그대로 해야 한다.
      kjDrag = { on: !kjIsSel(c.dataset.k), last: '', n: 0, from: c };
      ev.preventDefault();      // 끌 때 글자가 잡히지 않게
    });

    $('kanjiGrid').addEventListener('pointermove', function (ev) {
      if (!kjDrag || ev.pointerType !== 'mouse') return;
      var c = ev.target.closest ? ev.target.closest('.kj-cell') : null;
      if (!c) {   // 칸 사이 틈을 지날 때를 위해 좌표로도 한 번 찾아 본다
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        c = el && el.closest ? el.closest('.kj-cell') : null;
      }
      if (!c || c === kjDrag.from) return;      // 아직 시작 칸 안이면 누른 것일 뿐이다
      if (!kjDrag.n) kjPaint(kjDrag.from);      // 움직인 순간 시작 칸부터 칠한다
      kjPaint(c);
    });

    var kjDragEnd = function () {
      if (!kjDrag) return;
      kjDragDid = kjDrag.n > 0;
      kjDrag = null;
    };
    $('kanjiGrid').addEventListener('pointerup', kjDragEnd);
    window.addEventListener('pointerup', kjDragEnd);
    window.addEventListener('pointercancel', kjDragEnd);

    $('kanjiGrid').addEventListener('click', function (ev) {
      if (kjDragDid) { kjDragDid = false; return; }   // 끌어서 고른 뒤에 따라오는 click
      var c = ev.target.closest('.kj-cell');
      if (!c) return;
      if (!kjSel.length) {
        var order = $$('#kanjiGrid .kj-cell').map(function (x) { return x.dataset.k; });
        kjSel = chainPick(order, c.dataset.k, function (l) { return wordsOfKanjiList(l).length; });
        $$('#kanjiGrid .kj-cell').forEach(function (x) {
          x.classList.toggle('sel', kjIsSel(x.dataset.k));
        });
      } else {
        kjToggle(c.dataset.k);
        c.classList.toggle('sel', kjIsSel(c.dataset.k));
      }
      renderKjSelBar();
    });
    // 이 구간의 단어를 바로 학습한다. 단어 홈의 버튼들과 같은 동작이다.
    $('btnKanjiReview').addEventListener('click', function () {
      if (stepDue.length) startSession(stepDue.slice(), '한자 ' + KANJI_STEPS[kanjiStep].label + ' 복습', 0, 'kanji');
    });
    $('btnKanjiStudy').addEventListener('click', function () {
      if (stepWords.length) startSession(stepWords.slice(), '한자 ' + KANJI_STEPS[kanjiStep].label, 0, 'kanji');
    });
    // 통계 칸을 누르면 그 상태의 단어만 모아 본다(단어 홈과 같다).
    $('kanjiStats').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stat.tap');
      if (!b) return;
      var stage = b.dataset.stage;
      var list = stage === 'all' ? stepWords.slice()
        : stepWords.filter(function (e) {
            var st = Store.stageFor(e.day, e.w);
            return stage === 'unknown' ? (st === 'unknown' || st === 'new') : st === stage;
          });
      if (!list.length) return;
      currentDays = [];
      renderSet(list, '한자 ' + KANJI_STEPS[kanjiStep].label + ' · ' + STAGE_NAME[stage], list.length + '단어', true, '', 'kanji');
    });
    // 한자가 없어 어느 칸에도 안 들어가는 단어를 한자리에 모아 본다.
    $('btnNoKanji').addEventListener('click', function () {
      var list = noKanjiWords();
      if (!list.length) return;
      currentDays = [];
      // 한자가 없어 어느 구간에도 안 들어가는 단어다. 한자 모드 복습에 올릴 자리가 없으므로
      // 보통 학습으로 센다(한자로 공부한 단어 표에 적지 않는다).
      renderSet(list, '히라가나 단어', list.length + '단어 · 전체 Day', true);
    });
    $('tabPre').addEventListener('click', function () { affixTab = 'pre'; renderAffix(); });
    $('tabSuf').addEventListener('click', function () { affixTab = 'suf'; renderAffix(); });
    // 문단 읽기. 홈에서는 Day 목록으로, Day 화면에서는 그 Day 의 글로 바로 간다.
    $('btnStory').addEventListener('click', function () { renderStories(); show('stories'); });
    $('storyGrid').addEventListener('click', function (ev) {
      var c = ev.target.closest('.day-cell');
      if (c) openStory(Number(c.dataset.day), 'stories', 1);
    });
    $('btnDayStory').addEventListener('click', function () {
      var n = Number(this.dataset.day);
      if (n) openStory(n, 'day', 1);
    });
    $('storySets').addEventListener('click', function (ev) {
      var t = ev.target.closest('.res-tab');
      if (t) { openStory(storyDay, null, Number(t.dataset.set)); }
    });
    $('stPrev').addEventListener('click', function () { if (this.dataset.day) openStory(Number(this.dataset.day)); });
    $('stNext').addEventListener('click', function () { if (this.dataset.day) openStory(Number(this.dataset.day)); });
    $('storyParas').addEventListener('click', function (ev) {
      var box = ev.target.closest('.st-para');
      if (!box) return;
      if (ev.target.closest('.st-toggle')) {
        var open = !box.classList.contains('open');
        box.classList.toggle('open', open);
        box.querySelector('.st-more').hidden = !open;
        box.querySelector('.st-toggle').textContent = open ? '뜻 숨기기' : '뜻 보기';
        return;
      }
      // 뜻을 열기 전에는 단어를 눌러도 아무 일이 없다. 읽는 법이 먼저 새어 나오면 안 된다.
      if (!box.classList.contains('open')) return;
      var m = ev.target.closest('[data-w]');
      var e = m ? storyWords[Number(m.dataset.w)] : null;
      if (e) dsOpen(e.w);
    });
    $('btnExamLog').addEventListener('click', function () { examsOnlyKanji = false; renderExams(); show('exams'); });
    $('btnKjExams').addEventListener('click', function () { examsOnlyKanji = true; renderExams(); show('exams'); });
    $('btnKjMarked').addEventListener('click', function () {
      var list = kanjiMarked();
      if (!list.length) return;
      currentDays = [];
      renderSet(list, '한자 · 주의할 단어', list.length + '단어', true, '', 'kanji');
    });
    $('examList').addEventListener('click', function (ev) {
      var b = ev.target.closest('.ex-row');
      if (b) openExam(b.dataset.id);
    });
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
    $('btnShareData').addEventListener('click', exportDataFile);

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
      if (view === 'midQuiz') { midKey(ev); return; }
      if (view === 'midBrowse') { midBrowseKey(ev); return; }
      if (view === 'midText') {
        if (ev.key === 'ArrowRight') { ev.preventDefault(); midTextGo(1); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); midTextGo(-1); }
        return;
      }
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
      // * = 지금 보고 있는 단어에 별을 붙이거나 뗀다. 넘기며 보기·시험·돌아보기 어디서든 먹는다.
      // 입력란 안에서는 글자로 둔다.
      if (ev.key === '*' && !/^(INPUT|TEXTAREA)$/.test(ev.target.tagName || '')) {
        var markK = currentMarkKey();
        if (markK) { ev.preventDefault(); toggleMark(markK); return; }
      }
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
      // 정답을 보기 전이면 Enter 가 정답 보기, 본 뒤에는 O. 아는 단어는 Enter 두 번이면 지나간다.
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!$('btnReveal').hidden) reveal();
        else bothOk();
      }
      else if (ev.key === '1') { ev.preventDefault(); bothOk(); }
      else if (ev.key === '2' || ev.key === '0') { ev.preventDefault(); bothNo(); }
      else if (ev.key === ' ') { ev.preventDefault(); reveal(); }
    });
  }

  Store.init();
  bind();
  bindSync();
  bindUpdate();
  window.addEventListener('popstate', handleBack);
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, markActivity, true);
  });
  document.addEventListener('visibilitychange', markActivity);
  startClock();
  renderPick();
  show('pick');
})();
