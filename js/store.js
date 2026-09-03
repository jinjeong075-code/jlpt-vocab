/* 단어 데이터 + 학습 기록 저장소 */
(function (global) {
  'use strict';

  var VOCAB_KEY = 'jvocab.vocab.v1';
  var GRAM_KEY  = 'jvocab.grammar.v1';
  var PROG_KEY  = 'jvocab.progress.v1';
  var TIME_KEY  = 'jvocab.time.v1';
  var SESS_KEY  = 'jvocab.session.v1';
  var DEV_KEY   = 'jvocab.device.v1';

  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;

  // 레벨별 다음 복습까지의 간격(일). 레벨이 오를수록 간격이 벌어지면서
  // 단기기억 → 장기기억으로 넘어간다.
  //
  // 2026년 12월 시험에 맞춘 값이다. Cepeda 외(2008)에 따르면 최적 간격은
  // 시험까지 남은 기간의 10~20% 이고, 9월 기준 약 95일 남았으므로 10~19일이다.
  // 그래서 최고 간격을 21일로 두었다. 시험이 멀어지면 이 값을 늘리면 된다.
  var INTERVALS = [0, 1, 3, 7, 14, 21];
  var MAX_LEVEL = INTERVALS.length - 1;
  var LONG_LEVEL = 4; // 이 레벨부터 장기기억

  // 하나라도 X 를 눌렀을 때 다시 만나는 간격. 연속으로 틀리면 조금씩 벌어진다.
  //   1회 1시간 → 2회 4시간 → 3회 이상 다음날
  // 둘 다 맞힌 단어에는 쓰지 않는다. 짧은 간격 반복은 같은 노력 대비 덜 남기
  // 때문에, 아직 확실히 모르는 단어에만 쓰는 것이 연구에 맞다.
  // 0 은 '시간이 아니라 다음날' 을 뜻한다 (아래 retryAt 참고).
  var RETRY_HOURS = [1, 4, 0];

  // 책에 쓰이는 품사 표기. CSV에서 품사 칸을 알아보는 데 쓴다.
  var POS_RE = /^(명|동|い형|な형|부|접속|감|연체|조수|접두|접미|명·동|형)$/;

  function today() {
    var d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
  }

  // 다음 복습 시각. 예전에는 날짜 번호(2만 남짓)로 저장했는데
  // 시간 단위 복습을 넣으면서 밀리초 시각으로 바꿨다.
  // 예전 기록은 숫자가 작으므로 그것으로 구분해 변환한다.
  function dueMs(r) {
    var d = r.due || 0;
    return d < 1e9 ? d * DAY_MS : d;
  }

  // 하루 이상 간격은 그 날 0시부터 복습할 수 있게 맞춘다.
  // 정확히 24시간 뒤로 두면 밤에 공부한 단어가 다음 날 밤에야 떠서,
  // 아침에 앱을 열었을 때 복습할 게 없어 보인다.
  function nextAt(days) {
    if (days <= 0) return Date.now();
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + days * DAY_MS;
  }

  // 틀린 횟수에 따른 다시 만날 시각. 마지막 단계는 시간이 아니라 다음날이다.
  function retryAt(miss) {
    var h = RETRY_HOURS[Math.min(miss, RETRY_HOURS.length) - 1];
    return h > 0 ? Date.now() + h * HOUR_MS : nextAt(1);
  }

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var days = {};      // { "26": {day, title, words:[...]} }
  var gram = {};      // { "N3-2": {level, section, sectionTitle, items:[...]} }
  var progress = {};  // { "26-1552": {...}, "g:N3-41-1": {...} }  단어와 문법이 한 곳에
  var timeLog = {};   // { "2026-08-27": { 기기id: 초 } }
  var deviceId = '';  // 이 기기를 구분하는 값. PC와 폰의 공부 시간을 따로 세는 데 쓴다.

  function keyOf(day, word) {
    return day + '-' + (word.no != null ? word.no : word.word);
  }

  // 문법은 'g:' 를 붙여 단어와 절대 겹치지 않게 한다.
  // 그래서 진도 저장소가 하나로 유지되고 동기화도 그대로 동작한다.
  function gKeyOf(item) {
    return 'g:' + item.level + '-' + item.no + (item.sub ? '-' + item.sub : '');
  }

  /* ---------- 문법 데이터 ---------- */

  function normalizeGramItem(x) {
    if (!x || !x.pattern) return null;
    var exs = [];
    (Array.isArray(x.examples) ? x.examples : []).forEach(function (e) {
      if (!e || !e.jp) return;
      exs.push({
        jp: String(e.jp).trim(),
        ko: String(e.ko == null ? '' : e.ko).trim(),
        type: String(e.type == null ? '' : e.type).trim()
      });
    });
    return {
      no: x.no != null ? Number(x.no) : null,
      sub: x.sub != null ? Number(x.sub) : null,
      group: String(x.group == null ? '' : x.group).trim(),
      pattern: String(x.pattern).trim(),
      ko: String(x.ko == null ? '' : x.ko).trim(),
      meaning: String(x.meaning == null ? '' : x.meaning).trim(),
      connect: String(x.connect == null ? '' : x.connect).trim(),
      examples: exs
    };
  }

  function normalizeGram(obj) {
    if (!obj || !obj.level || !Array.isArray(obj.items)) return null;
    var items = [];
    obj.items.forEach(function (x) {
      var it = normalizeGramItem(x);
      if (it) { it.level = String(obj.level).trim(); it.section = Number(obj.section) || 0; items.push(it); }
    });
    if (!items.length) return null;
    return {
      level: String(obj.level).trim(),
      section: Number(obj.section) || 0,
      sectionTitle: String(obj.sectionTitle || '').trim(),
      items: items
    };
  }

  function gramFileKey(g) { return g.level + '-' + g.section; }

  function loadGram(list) {
    var n = 0;
    (Array.isArray(list) ? list : [list]).forEach(function (o) {
      var g = normalizeGram(o);
      if (g) { gram[gramFileKey(g)] = g; n++; }
    });
    if (n) write(GRAM_KEY, gram);
    return n;
  }

  // 내장 문법(data\grammar.js)을 저장된 것과 합친다.
  // 추출이 진행 중이라 단원이 계속 늘고 내용도 고쳐지므로, 앱을 켤 때마다 확인한다.
  // 문항이 줄어드는 쪽으로는 절대 덮지 않는다 - 동기화로 받은 더 많은 자료를 지우면 안 된다.
  // 진도는 'g:' 키로 따로 저장하므로 내용을 갈아 끼워도 학습 기록은 남는다.
  function mergeDefaultGram(list) {
    var n = 0;
    (Array.isArray(list) ? list : [list]).forEach(function (o) {
      var g = normalizeGram(o);
      if (!g) return;
      var cur = gram[gramFileKey(g)];
      if (!cur || cur.items.length <= g.items.length) { gram[gramFileKey(g)] = g; n++; }
    });
    if (n) write(GRAM_KEY, gram);
    return n;
  }

  // 책의 레벨 순서대로 정렬한다.
  var LEVEL_ORDER = ['N5+N4', 'N5', 'N4', 'N3', 'N2', 'N1'];
  function levelRank(l) {
    var i = LEVEL_ORDER.indexOf(l);
    return i < 0 ? 99 : i;
  }

  function gramSections() {
    return Object.keys(gram).map(function (k) { return gram[k]; })
      .sort(function (a, b) {
        return levelRank(a.level) - levelRank(b.level) || a.section - b.section;
      });
  }

  function gramLevels() {
    var seen = {}, out = [];
    gramSections().forEach(function (g) {
      if (!seen[g.level]) { seen[g.level] = { level: g.level, items: [], sections: [] }; out.push(seen[g.level]); }
      seen[g.level].sections.push(g);
      seen[g.level].items = seen[g.level].items.concat(g.items);
    });
    return out;
  }

  function allGram() {
    var out = [];
    gramSections().forEach(function (g) {
      g.items.forEach(function (it) { out.push(it); });
    });
    return out;
  }

  function gRecOf(item) {
    return progress[gKeyOf(item)] ||
      { level: 0, due: 0, seen: 0, rO: 0, rX: 0, mO: 0, mX: 0, last: 0 };
  }

  function gStageFor(item) {
    var r = gRecOf(item);
    return stageOf(r.level, r.seen);
  }

  function gIsDue(item) {
    var r = gRecOf(item);
    if (!r.seen) return true;
    return dueMs(r) <= Date.now();
  }

  // 채점은 단어와 같은 규칙을 쓴다.
  //   patternOk = 문형을 떠올렸나, connectOk = 접속이 정확했나
  function gGrade(item, patternOk, connectOk) {
    var k = gKeyOf(item);
    var r = progress[k] || { level: 0, due: 0, seen: 0, rO: 0, rX: 0, mO: 0, mX: 0, last: 0 };
    var wasLong = isLong(r);

    if (patternOk) r.rO++; else r.rX++;
    if (connectOk) r.mO++; else r.mX++;

    if (patternOk && connectOk) {
      r.level = Math.min(MAX_LEVEL, r.level + 1);
      r.miss = 0;
      r.due = nextAt(INTERVALS[r.level]);
    } else {
      // 하나라도 X 면 같은 날 다시 낸다 (1시간 → 4시간 → 다음날).
      if (patternOk || connectOk) r.level = Math.min(r.level, LONG_LEVEL - 1);
      else                        r.level = Math.max(0, r.level - 2);
      r.miss = Math.min((r.miss || 0) + 1, RETRY_HOURS.length);
      r.due = retryAt(r.miss);
    }
    logAttempt(r, wasLong, patternOk && connectOk, patternOk || connectOk);
    r.seen++;
    r.last = Date.now();
    progress[k] = r;
    write(PROG_KEY, progress);
    return r;
  }

  function gShakyList() {
    return allGram().filter(function (it) { return isShaky(gRecOf(it)); })
      .sort(function (a, b) { return shakyScore(gRecOf(b)) - shakyScore(gRecOf(a)); });
  }

  function gSummarize(items) {
    var s = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    items.forEach(function (it) { s.total++; s[gStageFor(it)]++; });
    return s;
  }

  function gSummarizeAll() { return gSummarize(allGram()); }

  // 4지선다 보기. 같은 묶음(group)을 우선 쓰고, 모자라면 접속이 비슷한 것에서 채운다.
  function gChoices(item, n) {
    n = n || 4;
    var all = allGram();
    var same = function (a, b) { return gKeyOf(a) === gKeyOf(b); };
    var pool = all.filter(function (d) {
      return !same(d, item) && item.group && d.group === item.group && d.level === item.level;
    });
    if (pool.length < n - 1) {
      var more = all.filter(function (d) {
        return !same(d, item) && pool.indexOf(d) < 0 &&
               d.connect.charAt(0) === item.connect.charAt(0);
      });
      pool = pool.concat(shuffleArr(more));
    }
    if (pool.length < n - 1) {
      var rest = all.filter(function (d) { return !same(d, item) && pool.indexOf(d) < 0; });
      pool = pool.concat(shuffleArr(rest));
    }
    var opts = pool.slice(0, n - 1).concat([item]);
    return shuffleArr(opts);
  }

  function shuffleArr(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- 데이터 적재 ---------- */

  function normalizeExamples(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (e) {
      if (typeof e === 'string') return { jp: e.trim(), ko: '' };
      if (!e || !e.jp) return null;
      return { jp: String(e.jp).trim(), ko: String(e.ko == null ? '' : e.ko).trim() };
    }).filter(Boolean);
  }

  function normalizeGrammar(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (g) {
      // "동사 보통형 + だけあって -(인) 만큼" 처럼 한 줄로 줘도 받아들인다.
      if (typeof g === 'string') {
        var s = g.trim();
        if (!s) return null;
        var m = s.split(/\s+[-–—]\s+|\s{2,}/);
        return m.length > 1 ? { form: m[0].trim(), meaning: m.slice(1).join(' ').trim() }
                            : { form: s, meaning: '' };
      }
      if (!g || !g.form) return null;
      return { form: String(g.form).trim(), meaning: String(g.meaning == null ? '' : g.meaning).trim() };
    }).filter(Boolean);
  }

  function normalizeRelated(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (r) {
      if (!r || !r.word) return null;
      return {
        word: String(r.word).trim(),
        reading: String(r.reading == null ? '' : r.reading).trim(),
        pos: String(r.pos == null ? '' : r.pos).trim(),
        meaning: String(r.meaning == null ? '' : r.meaning).trim()
      };
    }).filter(Boolean);
  }

  function normalizeDay(obj) {
    if (!obj || obj.day == null || !Array.isArray(obj.words)) return null;
    var words = [];
    obj.words.forEach(function (w) {
      if (!w || !w.word) return;
      words.push({
        no: w.no != null ? w.no : null,
        word: String(w.word).trim(),
        reading: (w.reading == null || w.reading === '') ? '-' : String(w.reading).trim(),
        pos: String(w.pos == null ? '' : w.pos).trim(),
        meaning: String(w.meaning == null ? '' : w.meaning).trim(),
        star: !!w.star,
        examples: normalizeExamples(w.examples),
        grammar: normalizeGrammar(w.grammar),
        related: normalizeRelated(w.related)
      });
    });
    if (!words.length) return null;
    return { day: Number(obj.day), title: String(obj.title || '').trim(), words: words };
  }

  function addDays(list) {
    var added = 0;
    list.forEach(function (raw) {
      var d = normalizeDay(raw);
      if (!d) return;
      days[d.day] = d;
      added++;
    });
    if (added) write(VOCAB_KEY, days);
    return added;
  }

  // CSV/TSV: day,no,word,reading,meaning  (헤더 줄은 있어도 되고 없어도 됨)
  function parseDelimited(text) {
    var sep = text.indexOf('\t') > -1 ? '\t' : ',';
    var byDay = {};
    text.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var raw = line.split(sep);
      if (raw.length < 5) return;
      var cell = function (i) { return String(raw[i] == null ? '' : raw[i]).trim().replace(/^"|"$/g, ''); };
      if (!/^\d+$/.test(cell(0))) return; // 헤더 등 건너뜀
      var d = Number(cell(0));
      if (!byDay[d]) byDay[d] = { day: d, title: '', words: [] };
      // 품사 칸은 있어도 되고 없어도 된다. 5번째 칸이 품사 표기면 품사로 본다.
      var hasPos = POS_RE.test(cell(4));
      var mStart = hasPos ? 5 : 4;
      // 뜻에 쉼표가 흔하므로 그 뒤부터 줄 끝까지를 통째로 뜻으로 본다.
      byDay[d].words.push({
        no: /^\d+$/.test(cell(1)) ? Number(cell(1)) : null,
        word: cell(2), reading: cell(3),
        pos: hasPos ? cell(4) : '',
        meaning: raw.slice(mStart).join(sep).trim().replace(/^"|"$/g, '')
      });
    });
    return Object.keys(byDay).map(function (k) { return byDay[k]; });
  }

  function importText(text) {
    var trimmed = text.replace(/^﻿/, '').trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      var json = JSON.parse(trimmed);
      return addDays(Array.isArray(json) ? json : [json]);
    }
    return addDays(parseDelimited(trimmed));
  }

  /* ---------- 기억 단계 ---------- */

  // 레벨 0 = 아직 못 맞춘 단어, 1~3 = 간격이 짧은 단기기억,
  // 4~5 = 14일·21일 간격을 견딘 장기기억.
  /* ---------- 채점 기록 ---------- */
  // 지금 레벨만 보면 '한 번도 안 틀리고 올라온 단어'와 '올라갔다 떨어지기를
  // 반복한 단어'가 똑같아 보인다. 그래서 시험 결과를 따로 남긴다.
  // 기기 사이로 동기화되므로 짧게. 최근 12번만 남긴다.
  //   '2' 둘 다 정답 · '1' 하나만 정답 · '0' 둘 다 오답
  var HIST_MAX = 12;

  function logAttempt(r, wasLong, bothOk, oneOk) {
    r.tries = (r.tries || 0) + 1;
    if (!bothOk) {
      r.fails = (r.fails || 0) + 1;
      // 장기기억까지 갔다가 다시 틀렸다. '안다고 생각했는데 틀리는' 단어의 표시.
      if (wasLong) r.lapse = (r.lapse || 0) + 1;
    }
    r.hist = ((r.hist || '') + (bothOk ? '2' : (oneOk ? '1' : '0'))).slice(-HIST_MAX);
  }

  function isLong(r) { return !!r.seen && r.level >= LONG_LEVEL; }

  // 흔들리는 정도. 장기기억에서 떨어진 적이 있으면 훨씬 무겁게 본다.
  function shakyScore(r) {
    return (r.lapse || 0) * 3 + (r.fails || 0);
  }

  // 흔들리는 단어 = 맞았다 틀렸다 하는 단어.
  //   ① 장기기억까지 갔다가 다시 틀린 적이 있다
  //   ② 두 번 넘게 틀렸다
  function isShaky(r) {
    return !!r.seen && ((r.lapse || 0) >= 1 || (r.fails || 0) >= 2);
  }

  function stageOf(level, seen) {
    if (!seen) return 'new';
    if (level === 0) return 'unknown';
    return level < LONG_LEVEL ? 'short' : 'long';
  }

  var STAGE_LABEL = { 'new': '미학습', unknown: '모르는 단어', short: '단기기억', long: '장기기억' };

  function recOf(day, word) {
    var k = keyOf(day, word);
    return progress[k] || { level: 0, due: 0, seen: 0, rO: 0, rX: 0, mO: 0, mX: 0, last: 0 };
  }

  function stageFor(day, word) {
    var r = recOf(day, word);
    return stageOf(r.level, r.seen);
  }

  function isDue(day, word) {
    var r = recOf(day, word);
    if (!r.seen) return true;
    return dueMs(r) <= Date.now();
  }

  /* ---------- 채점 ---------- */
  // 읽는 법 O/X, 뜻 O/X 두 체크로 점수를 갱신한다.
  //   둘 다 O  → 레벨 +1 (간격이 늘어남 = 장기기억으로 이동)
  //   하나만 O → 레벨을 3 이하로 내리고 내일 다시
  //   둘 다 X  → 레벨 -2, 그리고 같은 날 다시 (1시간 → 4시간 → 다음날)
  function grade(day, word, readingOk, meaningOk) {
    var k = keyOf(day, word);
    var r = progress[k] || { level: 0, due: 0, seen: 0, rO: 0, rX: 0, mO: 0, mX: 0, last: 0 };
    // 레벨을 손대기 전에 장기기억이었는지 기억해 둔다.
    var wasLong = isLong(r);

    if (readingOk) r.rO++; else r.rX++;
    if (meaningOk) r.mO++; else r.mX++;

    if (readingOk && meaningOk) {
      r.level = Math.min(MAX_LEVEL, r.level + 1);
      r.miss = 0;
      r.due = nextAt(INTERVALS[r.level]);
    } else {
      // 하나라도 X 면 같은 날 다시 낸다 (1시간 → 4시간 → 다음날).
      if (readingOk || meaningOk) {
        // 하나만 모르면 장기기억으로 인정하지 않는다.
        // 이미 장기기억이던 단어도 단기기억으로 끌어내린다.
        r.level = Math.min(r.level, LONG_LEVEL - 1);
      } else {
        // 둘 다 모르면 레벨을 두 단계 떨어뜨린다.
        // 장기기억(4·5)이던 단어는 단기기억(2·3)으로 재분류되고,
        // 원래 낮았던 단어만 '아예 모르는 단어'(0)로 내려간다.
        r.level = Math.max(0, r.level - 2);
      }
      r.miss = Math.min((r.miss || 0) + 1, RETRY_HOURS.length);
      r.due = retryAt(r.miss);
    }

    logAttempt(r, wasLong, readingOk && meaningOk, readingOk || meaningOk);
    r.seen++;
    r.last = Date.now();
    progress[k] = r;
    write(PROG_KEY, progress);
    return r;
  }

  /* ---------- 조회 ---------- */

  function allDays() {
    return Object.keys(days).map(Number).sort(function (a, b) { return a - b; })
      .map(function (d) { return days[d]; });
  }

  function getDay(n) { return days[n] || null; }

  function allWords() {
    var out = [];
    allDays().forEach(function (d) {
      d.words.forEach(function (w) { out.push({ day: d.day, title: d.title, w: w }); });
    });
    return out;
  }

  function summarize(words, dayNo) {
    var s = { total: words.length, unknown: 0, short: 0, long: 0, 'new': 0 };
    words.forEach(function (w) { s[stageFor(dayNo, w)]++; });
    return s;
  }

  function summarizeAll() {
    var s = { total: 0, unknown: 0, short: 0, long: 0, 'new': 0 };
    allWords().forEach(function (e) {
      s.total++;
      s[stageFor(e.day, e.w)]++;
    });
    return s;
  }

  // 이미 확실히 아는 단어를 곧바로 장기기억으로 보낸다.
  // 복습으로 증명된 것과 구분할 수 있게 known 표시를 남겨 둔다.
  function markKnown(day, word) {
    var k = keyOf(day, word);
    var r = progress[k] || { level: 0, due: 0, seen: 0, rO: 0, rX: 0, mO: 0, mX: 0, last: 0 };
    r.level = MAX_LEVEL;
    r.miss = 0;
    r.due = nextAt(INTERVALS[MAX_LEVEL]);
    r.seen = (r.seen || 0) + 1;
    r.known = 1;
    r.last = Date.now();
    progress[k] = r;
    write(PROG_KEY, progress);
    return r;
  }

  function dueList() {
    return allWords().filter(function (e) { return recOf(e.day, e.w).seen && isDue(e.day, e.w); });
  }

  function weakList() {
    return allWords().filter(function (e) {
      var st = stageFor(e.day, e.w);
      return st === 'unknown' || st === 'new';
    });
  }

  // 흔들리는 단어. 많이 흔들린 것부터 앞에 온다.
  // 장기기억에 있어 복습 대상이 아닌 단어도 여기에는 들어온다. 그게 요점이다.
  function shakyList() {
    return allWords().filter(function (e) { return isShaky(recOf(e.day, e.w)); })
      .sort(function (a, b) {
        return shakyScore(recOf(b.day, b.w)) - shakyScore(recOf(a.day, a.w));
      });
  }

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return allWords().filter(function (e) {
      return e.w.word.toLowerCase().indexOf(q) > -1
          || e.w.reading.toLowerCase().indexOf(q) > -1
          || e.w.meaning.toLowerCase().indexOf(q) > -1;
    });
  }

  /* ---------- 공부 시간 ---------- */

  // 기기마다 한 번 만들어 두고 계속 쓴다. 기기를 알아보는 용도일 뿐
  // 개인 정보는 담지 않는다.
  function ensureDeviceId() {
    var id = null;
    try { id = localStorage.getItem(DEV_KEY); } catch (e) {}
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(DEV_KEY, id); } catch (e) {}
    }
    return id;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // 공부 시간은 날짜별로 '기기마다 따로' 쌓는다.
  //   timeLog = { "2026-08-27": { "d3f9a1c2": 1200, "d7b0e4aa": 1800 } }
  // 이렇게 두면 기기를 합칠 때 기기별로 큰 값을 취하면 되므로,
  // 같은 날 PC와 폰에서 공부한 시간이 제대로 더해지면서도
  // 같은 백업을 여러 번 넣어도 시간이 부풀지 않는다.

  function sumRec(rec) {
    if (!rec) return 0;
    if (typeof rec === 'number') return rec;   // 기기별로 나누기 전의 옛 기록
    var s = 0;
    Object.keys(rec).forEach(function (k) { s += rec[k] || 0; });
    return s;
  }

  function addTime(sec) {
    if (!(sec > 0)) return;
    var k = dateKey(new Date());
    var rec = timeLog[k];
    if (typeof rec === 'number') rec = wrapLegacy(rec);
    if (!rec) rec = {};
    rec[deviceId] = (rec[deviceId] || 0) + sec;
    timeLog[k] = rec;
    write(TIME_KEY, timeLog);
  }

  function wrapLegacy(n) {
    var o = {};
    o[deviceId] = n;
    return o;
  }

  function timeOn(d) { return sumRec(timeLog[dateKey(d)]); }

  function timeToday() { return timeOn(new Date()); }

  function timeTotal() {
    var sum = 0;
    Object.keys(timeLog).forEach(function (k) { sum += sumRec(timeLog[k]); });
    return sum;
  }

  // 오늘까지 최근 n일을 오래된 순으로 돌려준다.
  function recentDays(n) {
    var out = [], now = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push({ date: d, key: dateKey(d), sec: sumRec(timeLog[dateKey(d)]) });
    }
    return out;
  }

  // 공부한 날이 며칠인지 (하루라도 기록이 있으면 1일)
  function studiedDayCount() {
    return Object.keys(timeLog).filter(function (k) { return sumRec(timeLog[k]) > 0; }).length;
  }

  /* ---------- 진행 중인 학습 저장 ---------- */
  // 단어 전체를 저장하지 않고 (day, no, word) 참조만 남긴다.
  // 나중에 단어 파일을 다시 올려도 어긋나지 않는다.

  function saveSession(s) { write(SESS_KEY, s); }

  function loadSession() { return read(SESS_KEY, null); }

  function clearSession() {
    try { localStorage.removeItem(SESS_KEY); } catch (e) {}
  }

  // 저장해 둔 참조로 실제 단어를 되찾는다. 못 찾으면 null.
  function findWord(dayNo, no, wordText) {
    var d = days[dayNo];
    if (!d) return null;
    var hit = null;
    d.words.forEach(function (w) {
      if (hit) return;
      if (no != null && w.no === no) hit = w;
      else if (no == null && w.word === wordText) hit = w;
    });
    if (!hit && wordText) {
      d.words.forEach(function (w) { if (!hit && w.word === wordText) hit = w; });
    }
    return hit;
  }

  /* ---------- 백업 · 기기 간 합치기 ---------- */

  function exportAll() {
    return {
      jvocab: 1,                       // 이 파일이 백업임을 알아보는 표시
      device: deviceId,                // 어느 기기에서 나온 백업인지
      exportedAt: new Date().toISOString(),
      vocab: days,
      grammar: gram,
      progress: progress,
      time: timeLog
    };
  }

  function isBackup(obj) {
    return !!(obj && obj.jvocab && obj.progress !== undefined);
  }

  // 다른 기기의 백업을 현재 기기 기록과 합친다.
  //  - 단어/문법: 같은 Day·단원은 내용이 더 많은 쪽을 남긴다
  //  - 진도: 단어마다 '마지막으로 학습한 시각'이 더 나중인 쪽을 채택
  //  - 시간: 날짜별로 더 큰 값을 채택 (같은 파일을 두 번 넣어도 부풀지 않도록)
  //
  // 내용을 줄이는 쪽으로 덮지 않는 것이 중요하다. 동기화는 '받아서 합치고 다시 올리기'라
  // 낡은 백업이 새 자료를 덮으면 그 결과가 그대로 클라우드에 올라가 영영 사라진다.
  // 실제로 문법 단원이 늘어난 뒤에도 옛 백업에 눌려 일부만 보이던 문제가 있었다.
  function importBackup(obj) {
    var stat = { days: 0, words: 0, mine: 0, theirs: 0, dates: 0 };

    if (obj.vocab) {
      Object.keys(obj.vocab).forEach(function (k) {
        var d = normalizeDay(obj.vocab[k]);
        if (!d) return;
        var cur = days[d.day];
        if (cur && cur.words.length > d.words.length) return;
        days[d.day] = d; stat.days++;
      });
      write(VOCAB_KEY, days);
    }

    if (obj.grammar) {
      Object.keys(obj.grammar).forEach(function (k) {
        var g = normalizeGram(obj.grammar[k]);
        if (!g) return;
        var cur = gram[gramFileKey(g)];
        if (cur && cur.items.length > g.items.length) return;
        gram[gramFileKey(g)] = g; stat.gram = (stat.gram || 0) + 1;
      });
      write(GRAM_KEY, gram);
    }

    if (obj.progress) {
      Object.keys(obj.progress).forEach(function (k) {
        var incoming = obj.progress[k];
        var current = progress[k];
        if (!incoming) return;
        stat.words++;
        if (!current) { progress[k] = incoming; stat.theirs++; return; }
        if ((incoming.last || 0) > (current.last || 0)) {
          progress[k] = incoming; stat.theirs++;
        } else {
          stat.mine++;
        }
      });
      write(PROG_KEY, progress);
    }

    if (obj.time) {
      Object.keys(obj.time).forEach(function (k) {
        var inc = obj.time[k];
        var cur = timeLog[k];
        // 아주 예전 백업은 숫자로 들어온다. 어느 기기 것인지 알 수 있게 표시해 둔다.
        if (typeof inc === 'number') {
          var legacyKey = 'legacy:' + (obj.device || 'unknown');
          var tmp = {}; tmp[legacyKey] = inc; inc = tmp;
        }
        if (typeof cur === 'number') cur = wrapLegacy(cur);
        if (!cur) cur = {};
        if (!inc) return;

        var changed = false;
        // 기기별로 더 큰 값을 남긴다. 같은 백업을 다시 넣어도 그대로다.
        Object.keys(inc).forEach(function (dev) {
          if ((inc[dev] || 0) > (cur[dev] || 0)) { cur[dev] = inc[dev]; changed = true; }
        });
        timeLog[k] = cur;
        if (changed) stat.dates++;
      });
      write(TIME_KEY, timeLog);
    }
    stat.time = timeTotal();

    return stat;
  }

  function resetProgress() {
    progress = {};
    write(PROG_KEY, progress);
  }

  /* ---------- 초기화 ---------- */

  function init() {
    days = read(VOCAB_KEY, {});
    gram = read(GRAM_KEY, {});
    if (window.DEFAULT_GRAMMAR) mergeDefaultGram(window.DEFAULT_GRAMMAR);
    progress = read(PROG_KEY, {});
    timeLog = read(TIME_KEY, {});
    deviceId = ensureDeviceId();

    // 예전에는 다음 복습일을 날짜 번호로 저장했다. 시간 단위 복습을 넣으면서
    // 밀리초 시각으로 바꿨으므로, 옛 기록을 한 번 변환해 둔다.
    // (변환하지 않으면 1970년으로 읽혀 전부 복습 대상이 된다)
    var conv = false;
    Object.keys(progress).forEach(function (k) {
      var r = progress[k];
      if (!r || !r.due) return;
      if (r.due < 1e9) { r.due = r.due * DAY_MS; conv = true; return; }

      // 잠깐 '정확히 24시간 뒤'로 잡히던 때가 있었다. 그러면 밤에 공부한 단어가
      // 다음 날 밤에야 떠서 아침에 복습할 게 없어 보인다.
      // 하루 이상 남은 복습은 그 날 0시로 당겨 준다.
      var d = new Date(r.due);
      if (r.due - Date.now() > 12 * HOUR_MS && (d.getHours() || d.getMinutes())) {
        d.setHours(0, 0, 0, 0);
        r.due = d.getTime();
        conv = true;
      }
    });
    if (conv) write(PROG_KEY, progress);

    // 기기별로 나누기 전의 옛 기록(날짜 -> 숫자)을 지금 형태로 바꿔 둔다.
    // 여기서 미리 바꿔 두지 않으면 백업을 내보낼 때 숫자로 나가고,
    // 그 백업을 되넣을 때 같은 시간이 두 번 더해진다.
    var migrated = false;
    Object.keys(timeLog).forEach(function (k) {
      if (typeof timeLog[k] === 'number') {
        timeLog[k] = wrapLegacy(timeLog[k]);
        migrated = true;
      }
    });
    if (migrated) write(TIME_KEY, timeLog);
    if (global.DEFAULT_VOCAB) {
      // 내장 데이터는 저장된 것이 없을 때만 채워 넣는다(업로드본을 덮지 않음).
      global.DEFAULT_VOCAB.forEach(function (d) {
        if (!days[d.day]) {
          var n = normalizeDay(d);
          if (n) days[n.day] = n;
        }
      });
      write(VOCAB_KEY, days);
    }
  }

  global.Store = {
    init: init,
    importText: importText,
    allDays: allDays,
    getDay: getDay,
    allWords: allWords,
    search: search,
    grade: grade,
    recOf: recOf,
    stageFor: stageFor,
    stageOf: stageOf,
    isDue: isDue,
    summarize: summarize,
    summarizeAll: summarizeAll,
    dueList: dueList,
    weakList: weakList,
    shakyList: shakyList,
    shakyScore: shakyScore,
    resetProgress: resetProgress,
    markKnown: markKnown,
    dueMs: dueMs,

    // 문법
    loadGram: loadGram,
    gramSections: gramSections,
    gramLevels: gramLevels,
    allGram: allGram,
    gKeyOf: gKeyOf,
    gRecOf: gRecOf,
    gStageFor: gStageFor,
    gIsDue: gIsDue,
    gGrade: gGrade,
    gShakyList: gShakyList,
    gSummarize: gSummarize,
    gSummarizeAll: gSummarizeAll,
    gChoices: gChoices,
    shuffleArr: shuffleArr,

    exportAll: exportAll,
    isBackup: isBackup,
    importBackup: importBackup,
    saveSession: saveSession,
    loadSession: loadSession,
    clearSession: clearSession,
    findWord: findWord,
    addTime: addTime,
    timeOn: timeOn,
    timeToday: timeToday,
    timeTotal: timeTotal,
    recentDays: recentDays,
    studiedDayCount: studiedDayCount,
    STAGE_LABEL: STAGE_LABEL,
    INTERVALS: INTERVALS,
    MAX_LEVEL: MAX_LEVEL
  };
})(window);
