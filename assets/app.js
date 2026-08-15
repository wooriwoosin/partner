/* 협력점 관리앱 - 프론트엔드 (vanilla JS) */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!CFG.API_URL;
  var TOKEN = '', USER = '', ROLE = '';
  try {
    TOKEN = localStorage.getItem('partner_token') || '';
    USER = localStorage.getItem('partner_user') || '';
    ROLE = localStorage.getItem('partner_role') || '';
  } catch (e) {}
  function isAdmin() { return ROLE === 'admin'; }
  var SERVER_VER = '';   // 서버(Apps Script)가 알려주는 코드 버전
  // 방금 서버에서 받아온 데이터가 최신인지 눈으로 확인할 수 있게 요약 표시
  function showDataStamp() {
    var el = document.getElementById('dataStamp');
    if (!el) return;
    var sales = STATE.all.filter(function (c) { return c.업체구분 === '판매점'; });
    var mkO = sales.filter(function (c) { return c.전달마커 === 'O'; }).length;
    var wN = sales.filter(function (c) { return c.웹접수 === 'N' && c.웹회신 === 'N'; }).length;
    var t = new Date();
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2), ss = ('0' + t.getSeconds()).slice(-2);
    el.textContent = '데이터 ' + hh + ':' + mm + ':' + ss + ' 기준 · 판매점 ' + sales.length +
      '개 중 마커O ' + mkO + ' · 웹접수·회신 N ' + wN;
  }

  function checkServerVersion() {
    var el = document.getElementById('verWarn');
    if (el) el.style.display = (LIVE && !SERVER_VER) ? '' : 'none';
  }

  /* ============ 분류 엔진 (build_seed.py 와 동일 규칙) ============ */
  var SALES_SYMS = ['■■', '□□', '■', '□'];
  var PARTNER_SYMS = ['★★', '☆☆', '◆◆', '◇◇', '★', '☆', '◆', '◇'];
  var INCENTIVE_SYMS = ['◆◆', '◇◇', '◆', '◇'];
  var ALL_SYMS = '■□★☆◆◇●○◎';

  function leadSymbol(soan) {
    var s = soan || '';
    if (s.charAt(0) === '●') return '●';
    var m = s.match(/^(\d+)\./);
    if (m) return m[0];
    var arr = SALES_SYMS.concat(PARTNER_SYMS);
    for (var i = 0; i < arr.length; i++) if (s.indexOf(arr[i]) === 0) return arr[i];
    return '';
  }
  function classify(soan) {
    var s = soan || '';
    if (s.charAt(0) === '●') return '자점';
    if (/^\d+\./.test(s)) return '자점';
    for (var i = 0; i < SALES_SYMS.length; i++) if (s.indexOf(SALES_SYMS[i]) === 0) return '판매점';
    for (var j = 0; j < PARTNER_SYMS.length; j++) if (s.indexOf(PARTNER_SYMS[j]) === 0) return '협력점';
    return '미분류';
  }
  function isIncentive(soan) {
    var s = soan || '';
    for (var i = 0; i < INCENTIVE_SYMS.length; i++) if (s.indexOf(INCENTIVE_SYMS[i]) === 0) return true;
    return false;
  }
  function companyName(soan) {
    var s = (soan || '').replace(/^\d+\./, '');
    var re = new RegExp('^[' + ALL_SYMS + ']+'); s = s.replace(re, '');
    var re2 = new RegExp('[' + ALL_SYMS + ']+$'); s = s.replace(re2, '');
    return s.trim();
  }
  function markerFromName(name) {
    var m = (name || '').match(/[\(（]\s*([oO○ＯxX×？?])\s*[\)）]/);
    if (!m) return '';
    var map = { o: 'O', O: 'O', '○': 'O', 'Ｏ': 'O', x: 'X', X: 'X', '×': 'X', '?': '?', '？': '?' };
    return map[m[1]] || '';
  }
  // 구분 + 마커 -> 웹접수/웹회신 기본값 (판매점·협력점 공통 규칙)
  //  · 마커 O = 우리가 대신 전달 → 업체는 웹을 쓰지 않음 → 웹접수 N · 웹회신 N
  //  · 마커 X = 업체가 직접 웹 처리        → 웹접수 Y · 웹회신 Y
  function derive(gubun, marker, webY) {
    var d = { 소통채널: '', 웹접수: 'N', 웹회신: 'N', 상태: '활성' };
    if (gubun === '판매점') d.소통채널 = '카카오톡채널';
    else if (gubun === '협력점') d.소통채널 = '카카오톡단체방';
    if (marker === 'X') { d.웹접수 = 'Y'; d.웹회신 = 'Y'; }
    else if (marker === 'O') { d.웹접수 = 'N'; d.웹회신 = 'N'; }
    else if (webY === 'Y') { d.웹접수 = 'Y'; d.웹회신 = 'Y'; }
    return d;
  }
  // 판매점은 (X) 표기가 있을 때만 X, 그 외(O·?·표기없음)는 모두 O 로 본다.
  // (원장에 (?) 로 적힌 판매점이 물음표로 넘어오는 것을 막기 위함)
  function defaultMarker(gubun, mk) {
    if (gubun === '판매점') return mk === 'X' ? 'X' : 'O';
    return mk || '';
  }

  /* ============ 상태 ============ */
  var STATE = { all: [], allRaw: [], view: [], filter: { gubun: '', marker: '', web: '', dormant: '', inv: '', sym: '', con: '', q: '' } };
  var VIEW = 'base'; // base | invoice | contract | settle
  var SORT = { key: '', dir: 1 };   // 표 헤더 클릭 정렬
  var EDITING = null; // 수정 중인 원본 레코드 (출처 등 폼에 없는 필드 보존용)

  /* ============ API ============ */
  function apiList() {
    if (!LIVE) {
      return fetch('data/seed.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (d) { return d.companies || []; });
    }
    // 캐시 방지: 같은 URL 이면 브라우저가 이전 응답을 재사용해 시트 수정이 반영되지 않는다
    var url = CFG.API_URL + '?action=list&token=' + encodeURIComponent(TOKEN) + '&_=' + Date.now();
    return fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'list 실패');
        SERVER_VER = d.ver || '';   // 구버전 배포는 ver 자체를 안 보냄
        return d.companies || [];
      });
  }
  function apiPost(payload) {
    payload.token = TOKEN;
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || '요청 실패'); return d; });
  }

  /* ============ 인증 ============ */
  function authPost(action, payload) {
    payload = payload || {}; payload.action = action;
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }
  var AUTH_MODE = 'login';
  function showAuth(mode) {
    AUTH_MODE = mode;
    $('#authScreen').style.display = 'flex';
    $('#appWrap').style.display = 'none';
    $('#au_msg').textContent = ''; $('#au_msg').className = 'auth-msg';
    $('#au_nameField').style.display = mode === 'register' ? 'flex' : 'none';
    $('#authSub').textContent = mode === 'register' ? '처음 오셨네요 — 관리자 계정을 만드세요' : '로그인이 필요합니다';
    $('#au_submit').textContent = mode === 'register' ? '관리자 계정 만들기' : '로그인';
    $('#au_hint').innerHTML = mode === 'register' ? '이 아이디·비밀번호로 앞으로 로그인합니다.<br>꼭 기억해 두세요!' : '';
    $('#au_id').focus();
  }
  function enterApp() {
    $('#authScreen').style.display = 'none';
    $('#appWrap').style.display = '';
    $('#userName').textContent = USER ? ('● ' + USER + (isAdmin() ? ' (어드민)' : ' (스태프)')) : '';
    $('#userName').className = 'badge-mode live';
    $('#usersBtn').style.display = LIVE ? 'inline-block' : 'none';
    load();
  }

  /* ============ 계정 관리 ============ */
  function openUsers() {
    $('#usersOverlay').classList.add('open');
    $('#nu_msg').textContent = '';
    $('#mp_msg').textContent = '';
    $('#mp_old').value = ''; $('#mp_new').value = '';
    applyRoleUI();
    $('#usersTbody').innerHTML = '<tr><td colspan="5" class="empty"><span class="spin"></span></td></tr>';
    // 권한은 서버(시트) 값이 최종 기준 — 오래된 로그인 세션도 여기서 교정된다
    apiPost({ action: 'listUsers' }).then(function (d) {
      if (d.role) {
        ROLE = d.role;
        try { localStorage.setItem('partner_role', ROLE); } catch (e) {}
        $('#userName').textContent = USER ? ('● ' + USER + (isAdmin() ? ' (어드민)' : ' (스태프)')) : '';
        applyRoleUI();
      }
      if (isAdmin()) renderUsers(d.users || []);
    }).catch(function (e) { $('#usersTbody').innerHTML = '<tr><td colspan="5" class="empty">' + esc(e.message) + '</td></tr>'; });
  }

  // 어드민 전용 영역 표시/숨김
  function applyRoleUI() {
    var admin = isAdmin();
    $$('.admin-only').forEach(function (el) { el.style.display = admin ? '' : 'none'; });
    $('#staffNote').style.display = admin ? 'none' : '';
  }

  function changeMyPw() {
    var oldPw = $('#mp_old').value, newPw = $('#mp_new').value;
    if (!oldPw || !newPw) { $('#mp_msg').textContent = '현재 비밀번호와 새 비밀번호를 입력하세요'; return; }
    if (newPw.length < 4) { $('#mp_msg').textContent = '새 비밀번호는 4자 이상이어야 합니다'; return; }
    $('#mp_save').disabled = true; $('#mp_msg').className = 'auth-msg'; $('#mp_msg').textContent = '변경 중…';
    apiPost({ action: 'changeMyPw', oldPw: oldPw, newPw: newPw }).then(function () {
      $('#mp_save').disabled = false;
      $('#mp_old').value = ''; $('#mp_new').value = '';
      $('#mp_msg').className = 'auth-msg ok'; $('#mp_msg').textContent = '비밀번호가 변경되었습니다';
      toast('비밀번호가 변경되었어요', 'ok');
    }).catch(function (e) {
      $('#mp_save').disabled = false;
      $('#mp_msg').className = 'auth-msg'; $('#mp_msg').textContent = e.message;
    });
  }
  function renderUsers(list) {
    if (!list.length) { $('#usersTbody').innerHTML = '<tr><td colspan="5" class="empty">계정 없음</td></tr>'; return; }
    $('#usersTbody').innerHTML = list.map(function (u) {
      var me = u.아이디 === (localStorage.getItem('partner_user_id') || '');
      return '<tr><td><b>' + esc(u.아이디) + '</b>' + (me ? ' <span class="chip inc">나</span>' : '') +
        '</td><td>' + esc(u.이름 || '') + '</td><td>' + esc(u.권한 === 'admin' ? '어드민' : '스태프') +
        '</td><td>' + esc(u.상태 || '') + '</td><td style="white-space:nowrap">' +
        '<button class="btn sm ghost pw-user" data-id="' + esc(u.아이디) + '">비번초기화</button> ' +
        (list.length > 1 && !me ? '<button class="btn sm danger del-user" data-id="' + esc(u.아이디) + '">삭제</button>' : '') + '</td></tr>';
    }).join('');
    $$('#usersTbody .del-user').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        if (!confirm(id + ' 계정을 삭제할까요?')) return;
        apiPost({ action: 'deleteUser', id: id }).then(function () { toast('삭제됨', 'ok'); openUsers(); })
          .catch(function (e) { toast('삭제 실패: ' + e.message, 'err'); });
      };
    });
    $$('#usersTbody .pw-user').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        var pw = prompt(id + ' 계정의 새 비밀번호를 입력하세요 (4자 이상)');
        if (!pw) return;
        apiPost({ action: 'resetPw', id: id, pw: pw }).then(function () { toast(id + ' 비밀번호가 변경되었어요', 'ok'); })
          .catch(function (e) { toast('변경 실패: ' + e.message, 'err'); });
      };
    });
  }
  function addUser() {
    var id = $('#nu_id').value.trim(), pw = $('#nu_pw').value, name = $('#nu_name').value.trim();
    if (!id || !pw) { $('#nu_msg').textContent = '아이디와 비밀번호를 입력하세요'; return; }
    $('#nu_add').disabled = true; $('#nu_msg').textContent = '추가 중…';
    apiPost({ action: 'createUser', id: id, pw: pw, name: name }).then(function () {
      $('#nu_add').disabled = false; $('#nu_msg').textContent = '';
      $('#nu_id').value = ''; $('#nu_pw').value = ''; $('#nu_name').value = '';
      toast('계정이 추가됐어요', 'ok'); openUsers();
    }).catch(function (e) { $('#nu_add').disabled = false; $('#nu_msg').textContent = e.message; });
  }
  function forceLogin(msg) {
    TOKEN = ''; USER = ''; ROLE = '';
    try { localStorage.removeItem('partner_token'); localStorage.removeItem('partner_user'); localStorage.removeItem('partner_role'); } catch (e) {}
    showAuth('login');
    if (msg) $('#au_msg').textContent = msg;
  }
  function startAuthGate() {
    if (!LIVE) { enterApp(); return; }          // 데모 모드: 인증 없음
    if (TOKEN) { enterApp(); return; }           // 토큰 있으면 시도(무효면 load에서 처리)
    showAuth('login');                           // 항상 로그인 화면(초기 관리자는 서버가 자동 생성)
  }
  function doAuth() {
    var id = $('#au_id').value.trim(), pw = $('#au_pw').value, name = $('#au_name').value.trim();
    if (!id || !pw) { $('#au_msg').textContent = '아이디와 비밀번호를 입력하세요'; return; }
    $('#au_submit').disabled = true; $('#au_msg').className = 'auth-msg'; $('#au_msg').textContent = '처리 중…';
    var action = AUTH_MODE === 'register' ? 'registerFirstAdmin' : 'login';
    authPost(action, { id: id, pw: pw, name: name }).then(function (d) {
      $('#au_submit').disabled = false;
      if (!d || !d.ok) {
        var em = (d && d.error) || '실패했습니다';
        if (/unknown action/i.test(em)) em = '서버(Apps Script) 배포가 최신 코드가 아니에요. 새 코드로 다시 배포해 주세요.';
        $('#au_msg').textContent = em; return;
      }
      TOKEN = d.token; USER = d.name || id; ROLE = d.role || 'staff';
      try {
        localStorage.setItem('partner_token', TOKEN);
        localStorage.setItem('partner_user', USER);
        localStorage.setItem('partner_user_id', id);
        localStorage.setItem('partner_role', ROLE);
      } catch (e) {}
      enterApp();
    }).catch(function (e) { $('#au_submit').disabled = false; $('#au_msg').textContent = '연결 실패: ' + e.message; });
  }

  /* ============ 렌더 ============ */
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  // Y/N 은 글자 그대로 표시한다 (예전엔 N 을 가운뎃점으로 흐리게 그려 '값 없음'과 헷갈렸음)
  function yn(v) {
    if (v === 'Y') return '<span class="yn y">Y</span>';
    if (v === 'N') return '<span class="yn n">N</span>';
    return '<span class="yn blank">–</span>';
  }

  // 이번 주(월요일 00:00) 시작 시각
  function weekStart() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var dow = (d.getDay() + 6) % 7;          // 월=0 … 일=6
    return new Date(d.getTime() - dow * 86400000);
  }
  function asDate(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // 이번 주에 개통 실적이 있는가 (개통리스트 업로드 시 기록됨)
  function openedThisWeek(c) {
    var d = asDate(c.최근개통일);
    return !!d && d >= weekStart();
  }
  // 최근 7일 내 등록된 신규 업체인가
  function isNewCompany(c) {
    var d = asDate(c.등록일);
    return !!d && (Date.now() - d.getTime()) < 7 * 86400000;
  }

  // 계약 상태 판정: 제외 > 완료 > 확인필요 > 만료 > 진행중 > 미진행 > 정보없음
  function conState(c) {
    if (c.계약제외 === 'Y') return '제외';
    if (c.위탁판매 === 'Y' && c.개인정보 === 'Y') return '완료';
    if (c.위탁판매 === 'Y' || c.개인정보 === 'Y') return '진행중';
    // 계약이 안 된 업체(미진행·만료·정보없음)인데 이번 주 개통 실적이 있으면 → 확인필요
    var base = !c.위탁판매 ? '정보없음'
      : ((c.계약비고 || '').indexOf('만료') >= 0 ? '만료' : '미진행');
    return openedThisWeek(c) ? '확인필요' : base;
  }

  // 계약상태는 저장되는 값이 아니라 아래 항목들로 자동 판정됩니다.
  var CON_RULE = '계약제외 Y → <b>제외</b> · 위탁판매 빈칸 → <b>정보없음</b> · 위탁판매 Y +\u200b 개인정보 Y → <b>완료</b>'
    + ' · 계약비고에 "만료" 포함 → <b>만료</b> · 둘 중 하나만 Y → <b>진행중</b> · 그 외 → <b>미진행</b>'
    + '<br><span style="color:var(--muted)">※ 보증보험은 일부 업체만 진행하므로 계약상태에 영향을 주지 않습니다.</span>';
  function renderConState() {
    var box = document.getElementById('conStateBox');
    if (!box) return;
    var cur = {
      위탁판매: $('#f_wt').value, 개인정보: $('#f_pi').value,
      계약제외: $('#f_cexc').value, 계약비고: $('#f_connote').value
    };
    var st = conState(cur);
    box.innerHTML = '현재 계약상태 <span class="chip ' + (CON_CHIP[st] || '') + '" style="font-size:12px">' + st + '</span>'
      + ' <span style="color:var(--muted)">— 아래 항목을 바꾸면 자동으로 다시 판정됩니다</span><br>' + CON_RULE;
  }

  // 현재 탭에서 "대상이 되는" 업체 집합 (계산서·계약 탭은 휴면 제외)
  function baseRows() {
    if (VIEW === 'invoice' || VIEW === 'contract') {
      return STATE.all.filter(function (c) { return c.상태 !== '휴면'; });
    }
    return STATE.all;
  }

  function computeStats() {
    var rows = baseRows();
    var s = { total: rows.length, 판매점: 0, 협력점: 0, 휴면: 0, 정발행: 0, 역발행: 0, 원천세: 0, 계약완료: 0 };
    rows.forEach(function (c) {
      if (c.상태 === '휴면') { s.휴면++; }
      else if (s[c.업체구분] !== undefined) s[c.업체구분]++;   // 판매점·협력점 수는 휴면 제외
      if (s[c.계산서형태] !== undefined) s[c.계산서형태]++;
      if (c.위탁판매 === 'Y' && c.개인정보 === 'Y') s.계약완료++;
    });
    return s;
  }
  function renderStats() {
    var s = computeStats();
    var cards = [
      statCard('', 'total', s.total, '전체 업체'),
      statCard('sales', '판매점', s.판매점, '판매점 (거래중)'),
      statCard('partner', '협력점', s.협력점, '협력점 (거래중)'),
      statCard('hold', 'dormant', s.휴면, '휴면(미거래)')
    ];
    if (VIEW === 'invoice') {
      var noInv = baseRows().filter(function (c) {
        return ['정발행', '역발행', '원천세'].indexOf(c.계산서형태) < 0;
      }).length;
      cards = [
        statCard('', 'total', s.total, '전체 업체'),
        statCard('inv1', 'inv:정발행', s.정발행, '정발행'),
        statCard('inv2', 'inv:역발행', s.역발행, '역발행'),
        statCard('inv3', 'inv:원천세', s.원천세, '원천세'),
        statCard('hold', 'inv:__none', noInv, '계산서정보 없음/기타')
      ];
    } else if (VIEW === 'contract') {
      var cs = { 완료: 0, 진행중: 0, 미진행: 0, 만료: 0, 제외: 0, 정보없음: 0, 확인필요: 0 };
      baseRows().forEach(function (c) { cs[conState(c)]++; });
      cards = [
        statCard('', 'total', s.total, '전체 업체'),
        statCard('warn', 'con:확인필요', cs.확인필요, '⚠️ 확인필요(이번주 개통)'),
        statCard('partner', 'con:완료', cs.완료, '계약완료'),
        statCard('own', 'con:진행중', cs.진행중, '진행중'),
        statCard('sales', 'con:미진행', cs.미진행, '미진행'),
        statCard('hold', 'con:만료', cs.만료, '만료'),
        statCard('hold', 'con:제외', cs.제외, '제외'),
        statCard('', 'con:정보없음', cs.정보없음, '계약정보 없음')
      ];
    }
    $('#stats').innerHTML = cards.join('');
    $$('#stats .stat').forEach(function (el) {
      el.onclick = function () {
        var key = el.getAttribute('data-key');
        var was = STATE.filter;
        var q = was.q;
        // 카드를 누르면 나머지 필터는 모두 초기화한다 — 카드 숫자와 목록 개수가 어긋나지 않도록
        var f = { gubun: '', marker: '', web: '', dormant: '', inv: '', sym: '', con: '', q: q };
        if (key === 'total') { /* 전체 */ }
        else if (key === 'dormant') { if (was.dormant !== 'only') f.dormant = 'only'; }
        else if (key.indexOf('inv:') === 0) { var v = key.slice(4); if (was.inv !== v) f.inv = v; }
        else if (key.indexOf('con:') === 0) { var cv = key.slice(4); if (was.con !== cv) f.con = cv; }
        else { if (was.gubun !== key) { f.gubun = key; f.dormant = 'exclude'; } }  // 판매점·협력점 카드는 '거래중'만
        STATE.filter = f;
        syncControls(); applyFilter();
      };
    });
  }
  function statCard(cls, key, n, label) {
    var active = (key === STATE.filter.gubun)
      || (key === 'dormant' && STATE.filter.dormant === 'only')
      || (key.indexOf('inv:') === 0 && STATE.filter.inv === key.slice(4))
      || (key.indexOf('con:') === 0 && STATE.filter.con === key.slice(4))
      || (key === 'total' && !STATE.filter.gubun && !STATE.filter.inv && !STATE.filter.con && !STATE.filter.dormant);
    return '<div class="stat ' + cls + (active ? ' active' : '') + '" data-key="' + key + '">' +
      '<div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function applyFilter() {
    var f = STATE.filter, q = f.q.trim().toLowerCase();
    STATE.view = STATE.all.filter(function (c) {
      if ((VIEW === 'invoice' || VIEW === 'contract') && c.상태 === '휴면') return false; // 휴면(미거래)은 계산서·계약 화면에서 제외
      if (f.dormant === 'only' && c.상태 !== '휴면') return false;
      if (f.dormant === 'exclude' && c.상태 === '휴면') return false;
      if (f.gubun && c.업체구분 !== f.gubun) return false;
      if (f.marker && (c.전달마커 || '') !== f.marker) return false;
      if (f.web && (c.웹접수 || '') !== f.web) return false;
      if (f.inv) {
        var iv = c.계산서형태 || '';
        if (f.inv === '__none' ? iv !== '' : iv !== f.inv) return false;
      }
      if (f.sym && String(c.기호 || '') !== f.sym) return false;
      if (f.con && conState(c) !== f.con) return false;
      if (q) {
        var hay = (c.업체명 + ' ' + c.소속원문 + ' ' + (c.연락처 || '') + ' ' + (c.대표자 || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    renderStats();
    renderTable();
  }

  // 표 컬럼 정의 — label: 표시명 / k: 정렬 키(없으면 정렬 불가)
  var COLUMNS = {
    base: [
      { k: '업체명', label: '업체 / 소속(원문)' }, { k: '업체구분', label: '구분' },
      { k: '대표자', label: '대표자' }, { k: '연락처', label: '연락처' },
      { k: '전달마커', label: '마커' }, { k: '웹접수', label: '웹접수' }, { k: '웹회신', label: '웹회신' },
      { k: '소통채널', label: '소통채널' }, { k: '상태', label: '상태' }, { k: '비고', label: '비고' },
      { k: '', label: '' }
    ],
    invoice: [
      { k: '기호', label: '기호' }, { k: '업체명', label: '업체 / 소속(원문)' }, { k: '업체구분', label: '구분' },
      { k: '법인', label: '법인' }, { k: '계산서형태', label: '계산서형태' }, { k: '수신방법', label: '수신방법' },
      { k: '사업자등록증', label: '사업자' }, { k: '계산서비고', label: '계산서 비고' }, { k: '', label: '' }
    ],
    contract: [
      { k: '업체명', label: '업체 / 소속(원문)' }, { k: '업체구분', label: '구분' },
      { k: '계약상태', label: '계약상태' }, { k: '대표자', label: '대표자' }, { k: '연락처', label: '연락처' },
      { k: '위탁판매', label: '위탁판매' }, { k: '개인정보', label: '개인정보' }, { k: '보증보험', label: '보증보험' },
      { k: '계약비고', label: '계약 비고' }, { k: '', label: '' }
    ]
  };
  var VIEW_COLS = { base: 11, invoice: 9, contract: 10 };

  function buildThead() {
    return '<tr>' + COLUMNS[VIEW].map(function (col) {
      if (!col.k) return '<th></th>';
      var arrow = SORT.key === col.k ? (SORT.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th class="sortable" data-sort="' + esc(col.k) + '">' + esc(col.label) + arrow + '</th>';
    }).join('') + '</tr>';
  }
  function sortValue(c, key) {
    if (key === '계약상태') return conState(c);
    var v = c[key];
    return v === undefined || v === null ? '' : String(v);
  }

  var CON_CHIP = { 확인필요: 'warn', 완료: 'status-활성', 진행중: 'g-자점', 미진행: 'g-판매점', 만료: 'status-보류', 제외: 'm-X', 정보없음: 'i-기타' };

  function nameCell(c) {
    return '<td class="name-cell">' + esc(c.업체명) +
      (isNewCompany(c) ? ' <span class="chip new">NEW</span>' : '') +
      (c.인센티브 === 'Y' ? ' <span class="chip inc">인센</span>' : '') +
      '<span class="raw">' + esc(c.소속원문) + '</span></td>' +
      '<td><span class="chip g-' + esc(c.업체구분) + '">' + esc(c.업체구분) + '</span></td>';
  }
  function invChip(v) {
    return v ? '<span class="chip i-' + esc(v) + '">' + esc(v) + '</span>' : '<span class="yn blank">–</span>';
  }
  function rowBase(c) {
    var mk = c.전달마커 || '';
    return nameCell(c) +
      '<td>' + esc(c.대표자 || '') + '</td>' +
      '<td>' + esc(c.연락처 || '') + '</td>' +
      '<td>' + (mk ? '<span class="chip m-' + esc(mk) + '">' + esc(mk) + '</span>' : '<span class="yn blank">–</span>') + '</td>' +
      '<td style="text-align:center">' + yn(c.웹접수) + '</td>' +
      '<td style="text-align:center">' + yn(c.웹회신) + '</td>' +
      '<td>' + esc(c.소통채널 || '') + '</td>' +
      '<td><span class="chip status-' + esc(c.상태) + '">' + esc(c.상태 === '휴면' ? '휴면(미거래)' : c.상태) + '</span></td>' +
      '<td class="note-cell" title="' + esc(c.비고 || '') + '">' + esc(c.비고 || '') + '</td>';
  }
  function rowInvoice(c) {
    return '<td style="font-weight:700">' + esc(c.기호 || '') + '</td>' +
      nameCell(c) +
      '<td>' + esc(c.법인 || '') + '</td>' +
      '<td>' + invChip(c.계산서형태) + '</td>' +
      '<td>' + esc(c.수신방법 || '') + '</td>' +
      '<td style="text-align:center">' + yn(c.사업자등록증) + '</td>' +
      '<td class="note-cell" title="' + esc(c.계산서비고 || '') + '">' + esc(c.계산서비고 || '') + '</td>';
  }
  function rowContract(c) {
    var st = conState(c);
    return nameCell(c) +
      '<td><span class="chip ' + (CON_CHIP[st] || '') + '">' + st + '</span></td>' +
      '<td>' + esc(c.대표자 || '') + '</td>' +
      '<td>' + esc(c.연락처 || '') + '</td>' +
      '<td style="text-align:center">' + yn(c.위탁판매) + '</td>' +
      '<td style="text-align:center">' + yn(c.개인정보) + '</td>' +
      '<td style="text-align:center">' + yn(c.보증보험) + '</td>' +
      '<td class="note-cell" title="' + esc(c.계약비고 || '') + '">' + esc(c.계약비고 || '') + '</td>';
  }

  function renderTable() {
    var rows = STATE.view.slice();
    if (SORT.key) {
      rows.sort(function (a, b) {
        var r = sortValue(a, SORT.key).localeCompare(sortValue(b, SORT.key), 'ko', { numeric: true });
        return r * SORT.dir;
      });
    } else if (VIEW === 'invoice') {   // 기본 정렬: 기호별로 묶기
      rows.sort(function (a, b) {
        var r = String(a.기호 || '').localeCompare(String(b.기호 || ''), 'ko');
        return r !== 0 ? r : String(a.업체명 || '').localeCompare(String(b.업체명 || ''), 'ko');
      });
    }
    // 신규 업체는 항상 맨 위로 (일주일 지나면 자동으로 사라짐)
    rows.sort(function (a, b) { return (isNewCompany(b) ? 1 : 0) - (isNewCompany(a) ? 1 : 0); });

    $('#thead').innerHTML = buildThead();
    $$('#thead .sortable').forEach(function (th) {
      th.onclick = function () {
        var k = th.getAttribute('data-sort');
        if (SORT.key === k) SORT.dir = -SORT.dir; else { SORT.key = k; SORT.dir = 1; }
        renderTable();
      };
    });
    $('#count').textContent = rows.length + ' / ' + STATE.all.length + ' 업체';
    if (!rows.length) { $('#tbody').innerHTML = '<tr><td colspan="' + VIEW_COLS[VIEW] + '" class="empty">조건에 맞는 업체가 없습니다.</td></tr>'; return; }
    var renderRow = VIEW === 'invoice' ? rowInvoice : (VIEW === 'contract' ? rowContract : rowBase);
    $('#tbody').innerHTML = rows.map(function (c) {
      return '<tr data-id="' + esc(c.id) + '">' + renderRow(c) +
        '<td><button class="btn sm ghost edit">수정</button></td></tr>';
    }).join('');
    $$('#tbody .edit').forEach(function (b) {
      b.onclick = function () { openModal(b.closest('tr').getAttribute('data-id')); };
    });
  }

  /* ============ 모달 ============ */
  function blankCompany() {
    return { id: '', 소속원문: '', 업체명: '', 기호: '', 업체구분: '', 인센티브: 'N', 전달마커: '', 소통채널: '', 웹접수: '', 웹회신: '', 계정수: '', 연락처: '', 상태: '활성', 비고: '',
      법인: '', 대표자: '', 계산서형태: '', 수신방법: '', 계산서비고: '', 위탁판매: '', 개인정보: '', 보증보험: '', 사업자등록증: '', 계약제외: '', 계약비고: '', 출처: '' };
  }
  var SECTION_TITLES = { base: '기본 정보 수정', invoice: '계산서 수정', contract: '계약서·보증보험 수정' };
  function openModal(id) {
    var c = id ? JSON.parse(JSON.stringify(STATE.all.filter(function (x) { return String(x.id) === String(id); })[0])) : blankCompany();
    EDITING = c;
    // 현재 탭에 해당하는 섹션만 표시
    var sec = VIEW === 'invoice' ? 'invoice' : (VIEW === 'contract' ? 'contract' : 'base');
    $('#secBase').style.display = sec === 'base' ? '' : 'none';
    $('#secInvoice').style.display = sec === 'invoice' ? '' : 'none';
    $('#secContract').style.display = sec === 'contract' ? '' : 'none';
    $('#modalTitle').textContent = (SECTION_TITLES[sec] || '업체 수정') + ' · ' + (c.업체명 || '신규');
    $('#f_id').value = c.id || '';
    $('#f_soan').value = c.소속원문 || '';
    $('#f_name').value = c.업체명 || '';
    $('#f_gubun').value = c.업체구분 || '';
    $('#f_marker').value = c.전달마커 || '';
    $('#f_channel').value = c.소통채널 || '';
    $('#f_wreq').value = c.웹접수 || '';
    $('#f_wrep').value = c.웹회신 || '';
    $('#f_tel').value = c.연락처 || '';
    $('#f_rep').value = c.대표자 || '';
    $('#f_status').value = c.상태 || '활성';
    $('#f_note').value = c.비고 || '';
    $('#f_inv').value = c.계산서형태 || '';
    $('#f_corp').value = c.법인 || '';
    $('#f_invhow').value = c.수신방법 || '';
    $('#f_bizdoc').value = c.사업자등록증 || '';
    $('#f_invnote').value = c.계산서비고 || '';
    $('#f_wt').value = c.위탁판매 || '';
    $('#f_pi').value = c.개인정보 || '';
    $('#f_ins').value = c.보증보험 || '';
    $('#f_cexc').value = c.계약제외 || '';
    $('#f_connote').value = c.계약비고 || '';
    $('#deleteBtn').style.display = id ? 'inline-block' : 'none';
    if (sec === 'base') updatePreview();
    if (sec === 'contract') renderConState();
    $('#overlay').classList.add('open');
  }
  function closeModal() { $('#overlay').classList.remove('open'); }

  function autofillFromSoan() {
    var soan = $('#f_soan').value.trim();
    if (!soan) return;
    var g = classify(soan);
    $('#f_name').value = companyName(soan);
    $('#f_gubun').value = (g === '미분류' || g === '자점') ? '' : g;
    var mk = markerFromName(soan) || $('#f_marker').value || '';
    $('#f_marker').value = mk;
    var d = derive(g, mk);
    $('#f_channel').value = d.소통채널;
    $('#f_wreq').value = d.웹접수;
    $('#f_wrep').value = d.웹회신;
    updatePreview();
  }
  function reapplyDefaults() {
    var g = $('#f_gubun').value, mk = $('#f_marker').value;
    var d = derive(g, mk);
    $('#f_channel').value = d.소통채널;
    $('#f_wreq').value = d.웹접수;
    $('#f_wrep').value = d.웹회신;
    updatePreview();
  }
  function updatePreview() {
    var soan = $('#f_soan').value.trim();
    var g = $('#f_gubun').value || classify(soan);
    var sym = leadSymbol(soan);
    var inc = isIncentive(soan);
    $('#preview').innerHTML = '자동판정 → 기호 <b>' + (esc(sym) || '없음') + '</b> · 구분 <b>' + esc(g || '미분류') +
      '</b>' + (inc ? ' · <b>인센티브</b>' : '') + ' · 마커 X=웹접수·웹회신 <b>Y</b>, O=둘 다 <b>N</b>';
  }
  function collectForm() {
    // 수정 시 원본에서 시작해 폼에 없는 필드(출처 등)를 보존
    var c = EDITING ? JSON.parse(JSON.stringify(EDITING)) : blankCompany();
    c.id = $('#f_id').value || '';
    c.소속원문 = $('#f_soan').value.trim();
    c.업체명 = $('#f_name').value.trim() || companyName(c.소속원문);
    c.업체구분 = $('#f_gubun').value;
    c.기호 = leadSymbol(c.소속원문);
    c.인센티브 = isIncentive(c.소속원문) ? 'Y' : 'N';
    c.전달마커 = $('#f_marker').value;
    c.소통채널 = $('#f_channel').value;
    c.웹접수 = $('#f_wreq').value;
    c.웹회신 = $('#f_wrep').value;
    c.연락처 = $('#f_tel').value.trim();
    c.상태 = $('#f_status').value;
    c.비고 = $('#f_note').value.trim();
    c.대표자 = $('#f_rep').value.trim();
    c.법인 = $('#f_corp').value;
    c.계산서형태 = $('#f_inv').value;
    c.수신방법 = $('#f_invhow').value.trim();
    c.계산서비고 = $('#f_invnote').value.trim();
    c.위탁판매 = $('#f_wt').value;
    c.개인정보 = $('#f_pi').value;
    c.보증보험 = $('#f_ins').value;
    c.사업자등록증 = $('#f_bizdoc').value;
    c.계약제외 = $('#f_cexc').value;
    c.계약비고 = $('#f_connote').value.trim();
    return c;
  }

  function saveCompany() {
    var c = collectForm();
    if (!c.소속원문) { toast('소속(원문)을 입력하세요', 'err'); return; }
    if (!c.업체구분) { toast('업체구분을 선택하세요', 'err'); return; }
    if (!LIVE) { toast('데모 모드입니다. 저장하려면 config.js 에 API_URL 을 설정하세요', 'err'); return; }
    setBusy(true);
    apiPost({ action: 'upsert', company: c }).then(function (res) {
      var saved = res.company;
      if (res.mode === 'insert') STATE.all.push(saved);
      else STATE.all = STATE.all.map(function (x) { return String(x.id) === String(saved.id) ? saved : x; });
      closeModal(); applyFilter(); toast(res.mode === 'insert' ? '추가되었습니다' : '수정되었습니다', 'ok');
    }).catch(function (e) { toast('저장 실패: ' + e.message, 'err'); }).then(function () { setBusy(false); });
  }
  function deleteCompany() {
    var id = $('#f_id').value;
    if (!id) return;
    if (!LIVE) { toast('데모 모드에서는 삭제할 수 없습니다', 'err'); return; }
    if (!confirm('정말 삭제할까요? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    apiPost({ action: 'delete', id: id }).then(function () {
      STATE.all = STATE.all.filter(function (x) { return String(x.id) !== String(id); });
      closeModal(); applyFilter(); toast('삭제되었습니다', 'ok');
    }).catch(function (e) { toast('삭제 실패: ' + e.message, 'err'); }).then(function () { setBusy(false); });
  }

  /* ============ 변경로그 (이번 주만) ============ */
  var LOGS = [];
  function loadLogs() {
    if (!LIVE) { $('#logTbody').innerHTML = '<tr><td colspan="5" class="empty">데모 모드에서는 로그를 볼 수 없습니다</td></tr>'; return; }
    $('#logTbody').innerHTML = '<tr><td colspan="5" class="empty"><span class="spin"></span> 불러오는 중…</td></tr>';
    apiPost({ action: 'logs' }).then(function (d) {
      LOGS = d.logs || [];
      renderLogs();
    }).catch(function (e) {
      var m = /unknown action/i.test(e.message)
        ? 'Apps Script 배포가 구버전입니다. 새 Code.gs로 다시 배포해 주세요.'
        : e.message;
      $('#logTbody').innerHTML = '<tr><td colspan="5" class="empty">' + esc(m) + '</td></tr>';
    });
  }
  function renderLogs() {
    var q = $('#logSearch').value.trim().toLowerCase();
    var rows = LOGS.filter(function (l) {
      if (!q) return true;
      return (l.이름 + ' ' + l.아이디 + ' ' + l.작업 + ' ' + l.대상 + ' ' + l.상세).toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      $('#logTbody').innerHTML = '<tr><td colspan="5" class="empty">' + (LOGS.length ? '검색 결과가 없습니다' : '이번 주 변경 기록이 없습니다') + '</td></tr>';
      return;
    }
    $('#logTbody').innerHTML = rows.map(function (l) {
      return '<tr><td style="white-space:nowrap">' + esc(l.일시) + '</td>' +
        '<td>' + esc(l.이름 || l.아이디) + '</td>' +
        '<td><span class="chip">' + esc(l.작업) + '</span></td>' +
        '<td>' + esc(l.대상) + '</td>' +
        '<td class="log-detail" title="' + esc(l.상세) + '">' + esc(l.상세) + '</td></tr>';
    }).join('');
  }

  /* ============ 개통리스트 업로드 → 신규 등록 + 기호/소속 현행화 ============ */
  var UP = { grid: [], headerRow: -1, colIdx: -1, markerCol: -1, isOpeningList: false, candidates: [], changes: [], touched: [] };

  // 중복 비교용 키: 숫자접두/기호/마커괄호/공백 제거 + 소문자
  function normKey(s) {
    return String(s || '')
      .replace(/^\d+\./, '')
      .replace(/[\(（]\s*[oOxX○×?？]\s*[\)）]/g, '')
      .replace(/[■□★☆◆◇○●◎]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  // 같은 업체가 시트/파일에서 다르게 적힌 경우를 흡수한다.
  //  예) 시트 "기가몬스터(에이블정보통신)" ↔ 파일 "기가몬스터"
  //      시트 "폰찍좌 4호점(이티이브이)"   ↔ 파일 "폰찍좌4호점"
  function nameVariants(s) {
    var base = normKey(s);
    if (!base) return [];
    var out = [base];
    var noParen = base.replace(/[\(（][^)）]*[\)）]/g, '');      // 괄호 부분 제거
    if (noParen && out.indexOf(noParen) < 0) out.push(noParen);
    var head = base.split(/[\(（]/)[0];                          // 괄호 앞부분만
    if (head && out.indexOf(head) < 0) out.push(head);
    return out;
  }

  function openUpload() {
    UP = { grid: [], headerRow: -1, colIdx: -1, markerCol: -1, isOpeningList: false, candidates: [], changes: [], touched: [] };
    $('#upFile').value = '';
    $('#upColWrap').style.display = 'none';
    $('#upSummary').style.display = 'none';
    $('#upNewWrap').style.display = 'none';
    $('#upChgWrap').style.display = 'none';
    $('#upSave').disabled = true;
    $('#uploadOverlay').classList.add('open');
  }

  // 한글 인코딩 자동 판별 (UTF-8 → 깨지면 EUC-KR)
  function decodeKo(buf) {
    try {
      var t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (t.indexOf('\uFFFD') < 0) return t;
    } catch (e) {}
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e) {}
    try { return new TextDecoder('utf-8').decode(buf); } catch (e) {}
    return '';
  }

  // HTML 표(확장자만 xls 인 웹 다운로드본)는 브라우저 파서로 직접 읽는다.
  // 엑셀 라이브러리는 CSS가 길면 HTML 인지 못 알아채고 엉뚱하게 파싱하는 경우가 있음.
  function gridFromHtml(text) {
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    if (!tables.length) return null;
    tables.sort(function (a, b) { return b.rows.length - a.rows.length; });  // 행이 가장 많은 표 = 데이터
    var tb = tables[0], out = [];
    for (var i = 0; i < tb.rows.length; i++) {
      var cells = tb.rows[i].cells, arr = [];
      for (var j = 0; j < cells.length; j++) {
        arr.push(String(cells[j].textContent || '').replace(/\u00a0/g, ' ').trim());
      }
      out.push(arr);
    }
    return out;
  }

  function handleUploadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var buf = e.target.result;
        var bytes = new Uint8Array(buf);
        var head = '';
        for (var i = 0; i < Math.min(bytes.length, 4000); i++) head += String.fromCharCode(bytes[i]);
        var grid = null;

        if (/<\s*(table|html|meta|body|style)/i.test(head)) {
          grid = gridFromHtml(decodeKo(buf));      // HTML 표
        }
        if (!grid || !grid.length) {
          if (typeof XLSX === 'undefined') { toast('엑셀 라이브러리 로드 실패 — 인터넷 연결을 확인하세요', 'err'); return; }
          var wb = XLSX.read(bytes, { type: 'array', codepage: 949 });   // 진짜 엑셀 (한글 코드페이지)
          var ws = wb.Sheets[wb.SheetNames[0]];
          grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        }
        if (!grid || !grid.length) { toast('파일에서 데이터를 찾지 못했습니다', 'err'); return; }
        UP.grid = grid;
        detectColumn();
      } catch (err) { toast('파일을 읽지 못했습니다: ' + err.message, 'err'); }
    };
    reader.readAsArrayBuffer(file);
  }

  var NAME_HEADERS = ['협력점', '소속', '소속점', '업체', '업체명', '거래처', '판매점', '대리점', '매장', '상호', '상호명'];
  var MARKER_HEADERS = ['유치자', '사원명', '담당자', '담당', '영업사원', '사원'];

  function cellAt(r, c) { return String((UP.grid[r] || [])[c] || '').trim(); }

  // 개통리스트인지(= 이번주 개통 실적으로 볼지) 판별.
  // 전체사원관리(소속 원장)는 개통 실적이 아니므로 개통일을 기록하지 않는다.
  function detectKind() {
    var hdr = (UP.grid[UP.headerRow] || []).map(function (x) { return String(x || '').replace(/\s+/g, ''); });
    UP.isOpeningList = hdr.indexOf('개통일') >= 0 || hdr.indexOf('개통상태') >= 0 || hdr.indexOf('협력점') >= 0;
  }

  // 값이 "업체 소속"처럼 생겼는지 점수화 (헤더 이름이 깨졌을 때의 대비책)
  function colScore(colIdx, startRow, existing) {
    var score = 0, seen = 0;
    for (var r = startRow; r < Math.min(UP.grid.length, startRow + 300); r++) {
      var v = cellAt(r, colIdx);
      if (!v) continue;
      seen++;
      if (/^[■□★☆◆◇]/.test(v)) score += 3;          // 기호로 시작 = 업체 소속
      else if (existing[normKey(v)]) score += 3;       // 기존 업체명과 일치
    }
    return seen ? score : -1;
  }

  // 업체(소속) 열 자동 탐지 — ① 헤더 이름 정확 매칭 → ② 값의 생김새
  function detectColumn() {
    var existing = {};
    STATE.all.forEach(function (x) {
      existing[normKey(x.업체명)] = 1;
      existing[normKey(x.소속원문)] = 1;
    });
    var maxCols = 0;
    UP.grid.forEach(function (r) { if (r && r.length > maxCols) maxCols = r.length; });

    UP.headerRow = 0; UP.colIdx = -1; UP.markerCol = -1;

    // ① 헤더 이름이 정확히 일치하는 칸 찾기 (데이터 값에 "협력점★"처럼 섞여 있어도 오인하지 않음)
    for (var hr = 0; hr < Math.min(UP.grid.length, 10) && UP.colIdx < 0; hr++) {
      for (var c = 0; c < maxCols; c++) {
        var h = cellAt(hr, c).replace(/\s+/g, '');
        if (NAME_HEADERS.indexOf(h) >= 0) {
          UP.headerRow = hr; UP.colIdx = c;
          for (var mc = 0; mc < maxCols; mc++) {
            if (MARKER_HEADERS.indexOf(cellAt(hr, mc).replace(/\s+/g, '')) >= 0) { UP.markerCol = mc; break; }
          }
          break;
        }
      }
    }

    // ② 못 찾으면 값의 생김새로 판단
    if (UP.colIdx < 0) {
      var best = { score: 0, row: 0, col: -1 };
      for (var hr2 = 0; hr2 < Math.min(UP.grid.length, 7); hr2++) {
        for (var c2 = 0; c2 < maxCols; c2++) {
          var sc = colScore(c2, hr2 + 1, existing);
          if (sc > best.score) best = { score: sc, row: hr2, col: c2 };
        }
      }
      if (best.col >= 0 && best.score >= 15) { UP.headerRow = best.row; UP.colIdx = best.col; }
    }

    detectKind();

    // 이 화면은 개통리스트 전용 — 소속 원장 등 다른 파일은 받지 않는다
    if (UP.colIdx >= 0 && !UP.isOpeningList) {
      $('#upColWrap').style.display = 'none';
      $('#upNewWrap').style.display = 'none';
      $('#upChgWrap').style.display = 'none';
      $('#upSave').disabled = true;
      $('#upSummary').style.display = '';
      $('#upSummary').innerHTML = '⛔ <b>개통리스트가 아닙니다.</b> 이 화면은 <b>개통리스트</b>(개통일·개통상태·협력점 열이 있는 파일)만 처리합니다.<br>' +
        '<span style="color:var(--muted)">전체사원관리(소속 원장) 같은 파일로 기호·마커를 일괄 변경하려면 시트에서 <b>일괄현행화</b> 절차를 이용하세요. ' +
        '여기서 올리면 실제 개통이 없는 업체가 신규로 등록되거나 휴면이 풀릴 수 있어 막아두었습니다.</span>';
      return;
    }

    // 선택 UI — 헤더가 깨져도 "실제 값 미리보기"로 고를 수 있게
    var opts = [];
    for (var c3 = 0; c3 < maxCols; c3++) {
      var samples = [];
      for (var r3 = UP.headerRow + 1; r3 < UP.grid.length && samples.length < 3; r3++) {
        var v3 = cellAt(r3, c3);
        if (v3) samples.push(v3.length > 14 ? v3.slice(0, 14) + '…' : v3);
      }
      var hn = cellAt(UP.headerRow, c3);
      var label = (c3 + 1) + '열' + (hn ? ' (' + hn + ')' : '') + ' — ' + (samples.join(', ') || '비어있음');
      opts.push('<option value="' + c3 + '"' + (c3 === UP.colIdx ? ' selected' : '') + '>' + esc(label) + '</option>');
    }
    $('#upCol').innerHTML = opts.join('');
    $('#upColWrap').style.display = '';
    $('#upCol').onchange = function () { UP.colIdx = Number(this.value); buildCandidates(); };

    // 자동 인식에 성공하면 목록(수십 개 열)은 접어두고 결과만 한 줄로 보여준다
    var info = $('#upColInfo');
    if (UP.colIdx >= 0) {
      var hName = cellAt(UP.headerRow, UP.colIdx);
      var mName = UP.markerCol >= 0 ? cellAt(UP.headerRow, UP.markerCol) : '';
      info.innerHTML = '✅ <b>' + (UP.colIdx + 1) + '열' + (hName ? ' (' + esc(hName) + ')' : '') + '</b> 자동 인식'
        + (mName ? ' · 마커는 <b>' + (UP.markerCol + 1) + '열 (' + esc(mName) + ')</b>에서 읽음' : '')
        + ' <a href="#" id="upColToggle" style="margin-left:6px">다른 열 선택</a>';
      $('#upCol').style.display = 'none';
      $('#upColToggle').onclick = function (e) {
        e.preventDefault();
        var sel = $('#upCol');
        var open = sel.style.display === 'none';
        sel.style.display = open ? '' : 'none';
        this.textContent = open ? '접기' : '다른 열 선택';
      };
    } else {
      info.innerHTML = '';
      $('#upCol').style.display = '';
    }

    if (UP.colIdx < 0) {
      $('#upSummary').style.display = '';
      $('#upSummary').innerHTML = '업체명이 들어있는 열을 자동으로 찾지 못했어요. 위에서 <b>실제 값을 보고</b> 직접 골라주세요.';
      $('#upNewWrap').style.display = 'none';
      $('#upChgWrap').style.display = 'none';
      $('#upSave').disabled = true;
      return;
    }
    buildCandidates();
  }

  function buildCandidates() {
    if (UP.colIdx < 0) return;
    var byKey = {};
    (STATE.allRaw.length ? STATE.allRaw : STATE.all).forEach(function (x) {
      nameVariants(x.업체명).concat(nameVariants(x.소속원문)).forEach(function (k) {
        if (k && !byKey[k]) byKey[k] = x;
      });
    });
    function findExisting(raw) {
      var vs = nameVariants(raw);
      for (var i = 0; i < vs.length; i++) if (byKey[vs[i]]) return byKey[vs[i]];
      return null;
    }
    // 1차 스캔: 같은 소속이 여러 줄(사원 여러 명)일 수 있으므로 마커를 모아둔다
    var order = [], rawByKey = {}, mkByKey = {}, total = 0;
    for (var r0 = UP.headerRow + 1; r0 < UP.grid.length; r0++) {
      var raw0 = String((UP.grid[r0] || [])[UP.colIdx] || '').trim();
      if (!raw0) continue;
      total++;
      var k0 = normKey(raw0);
      if (!k0) continue;
      if (!rawByKey[k0]) { rawByKey[k0] = raw0; order.push(k0); }
      if (!mkByKey[k0]) {
        var m0 = UP.markerCol >= 0 ? markerFromName(cellAt(r0, UP.markerCol)) : '';
        if (!m0) m0 = markerFromName(raw0);
        if (m0) mkByKey[k0] = m0;
      }
    }

    var cands = [], changes = [], same = 0, own = 0;
    var touched = [];   // 이번 리스트에 등장한 기존 업체 (개통일 기록용)
    for (var oi = 0; oi < order.length; oi++) {
      var key = order[oi];
      var raw = rawByKey[key];
      if (classify(raw) === '자점') { own++; continue; } // 자점은 등록/현행화 대상 아님
      // 마커: 표기가 없으면 판매점은 (O) 로 간주 (■□ 판매점은 대부분 표기 없음)
      var mk = defaultMarker(classify(raw), mkByKey[key] || '');
      var ex = findExisting(raw);
      if (ex) {
        touched.push(ex.id);
        // 기호/소속이 달라졌거나, 휴면 업체에 개통건 발생(→활성 전환) → 현행화 후보
        var soanChanged = String(ex.소속원문 || '').trim() !== raw;
        if (ex.업체구분 === '자점') soanChanged = true;   // 자점→판매/협력점 재분류도 '변경'
        var wake = UP.isOpeningList && ex.상태 === '휴면';   // 개통 실적이 있을 때만 되살린다
        var mkChanged = !!mk && String(ex.전달마커 || '').trim() !== mk;
        if (soanChanged || wake || mkChanged) {
          var g2 = classify(raw);
          changes.push({
            id: ex.id, 업체명: ex.업체명,
            old소속: ex.소속원문 || '', raw: raw,
            old기호: ex.기호 || '', new기호: leadSymbol(raw),
            old구분: ex.업체구분 || '', new구분: g2 === '미분류' ? (ex.업체구분 || '') : g2,
            oldInc: ex.인센티브 || 'N', newInc: isIncentive(raw) ? 'Y' : 'N',
            old구분2: ex.업체구분 || '',
            마커: mk, oldMk: String(ex.전달마커 || ''), mkChanged: mkChanged,
            soanChanged: soanChanged, wake: wake,
            checked: true
          });
        } else same++;
        continue;
      }
      var g = classify(raw);
      cands.push({ 소속원문: raw, 업체명: companyName(raw), 구분: g === '미분류' ? '' : g, 마커: mk, checked: true });
    }
    UP.candidates = cands;
    UP.changes = changes;
    UP.touched = touched;
    $('#upSummary').style.display = '';
    $('#upSummary').innerHTML = '리스트 <b>' + total + '건</b> → 🆕 신규 <b>' + cands.length + '개</b> · 🔄 변경 <b>' + changes.length + '개</b> · 기존과 동일 <b>' + same + '건</b>'
      + (own ? ' · 자점 제외 <b>' + own + '건</b>' : '')
      + '<br><span style="color:var(--muted)">📅 적용하면 등장한 <b>' + touched.length + '개</b> 업체에 <b>이번주 개통</b> 기록이 남고, 계약 미완료 업체는 계약 탭 <b>⚠️ 확인필요</b>로 모입니다.</span>';
    renderUploadTable();
    renderChangeTable();
  }

  function renderUploadTable() {
    var cands = UP.candidates;
    if (!cands.length) {
      $('#upNewWrap').style.display = 'none';
      updateUpSave();
      return;
    }
    $('#upNewWrap').style.display = '';
    $('#upTbody').innerHTML = cands.map(function (c, i) {
      return '<tr><td><input type="checkbox" class="up-chk" data-i="' + i + '"' + (c.checked ? ' checked' : '') + '></td>' +
        '<td>' + esc(c.소속원문) + '</td><td>' + esc(c.업체명) + '</td>' +
        '<td>' + (c.구분 ? '<span class="chip g-' + esc(c.구분) + '">' + esc(c.구분) + '</span>' : '<span class="yn blank">미분류</span>') +
        (c.마커 ? ' <span class="chip m-' + esc(c.마커) + '">' + esc(c.마커) + '</span>' : '') + '</td></tr>';
    }).join('');
    $$('#upTbody .up-chk').forEach(function (chk) {
      chk.onchange = function () { UP.candidates[Number(chk.getAttribute('data-i'))].checked = chk.checked; updateUpSave(); };
    });
    $('#upAll').checked = true;
    $('#upAll').onchange = function () {
      var on = this.checked;
      UP.candidates.forEach(function (c) { c.checked = on; });
      renderUploadTable(); updateUpSave();
    };
    updateUpSave();
  }

  function renderChangeTable() {
    var chgs = UP.changes;
    if (!chgs.length) { $('#upChgWrap').style.display = 'none'; updateUpSave(); return; }
    $('#upChgWrap').style.display = '';
    $('#upChgTbody').innerHTML = chgs.map(function (c, i) {
      var diffs = [];
      if (c.wake) diffs.push('💤 휴면→활성 (개통 발생)');
      if (c.mkChanged) diffs.push('마커 ' + (c.oldMk || '없음') + '→' + c.마커 + ' (웹접수·웹회신 자동 재설정)');
      if (c.soanChanged) {
        if (c.old기호 !== c.new기호) diffs.push('기호 ' + (c.old기호 || '없음') + '→' + (c.new기호 || '없음'));
        if (c.old구분 !== c.new구분) diffs.push('구분 ' + (c.old구분 || '?') + '→' + (c.new구분 || '?'));
        if (c.oldInc !== c.newInc) diffs.push('인센티브 ' + c.oldInc + '→' + c.newInc);
        if (!diffs.length) diffs.push('표기 변경');
      }
      return '<tr><td><input type="checkbox" class="up-chg-chk" data-i="' + i + '"' + (c.checked ? ' checked' : '') + '></td>' +
        '<td>' + esc(c.업체명) + '</td><td>' + esc(c.old소속) + '</td><td><b>' + esc(c.raw) + '</b></td>' +
        '<td>' + esc(diffs.join(' · ')) + '</td></tr>';
    }).join('');
    $$('#upChgTbody .up-chg-chk').forEach(function (chk) {
      chk.onchange = function () { UP.changes[Number(chk.getAttribute('data-i'))].checked = chk.checked; updateUpSave(); };
    });
    $('#upChgAll').checked = true;
    $('#upChgAll').onchange = function () {
      var on = this.checked;
      UP.changes.forEach(function (c) { c.checked = on; });
      renderChangeTable(); updateUpSave();
    };
    updateUpSave();
  }

  function updateUpSave() {
    var n = UP.candidates.filter(function (c) { return c.checked; }).length;
    var m = UP.changes.filter(function (c) { return c.checked; }).length;
    var t = UP.touched.length;
    $('#upSave').disabled = (n + m + (UP.isOpeningList ? t : 0)) === 0;
    var parts = [];
    if (n) parts.push('신규 ' + n + '개');
    if (m) parts.push('변경 ' + m + '개');
    if (t && UP.isOpeningList) parts.push('개통기록 ' + t + '개');
    $('#upSave').textContent = parts.length ? parts.join(' · ') + ' 적용' : '선택 항목 적용';
  }

  function saveUpload() {
    var picked = UP.candidates.filter(function (c) { return c.checked; });
    var pickedChg = UP.changes.filter(function (c) { return c.checked; });
    if (!picked.length && !pickedChg.length && !UP.touched.length) return;
    var today = new Date().toISOString().slice(0, 10);
    if (!LIVE) { toast('데모 모드에서는 등록할 수 없습니다', 'err'); return; }

    var companies = picked.map(function (p) {
      var soan = p.소속원문;
      var g = p.구분 || classify(soan);
      if (g === '미분류') g = '';
      var mk = defaultMarker(g, p.마커 || markerFromName(soan));
      var d = derive(g, mk);
      return {
        소속원문: soan, 업체명: p.업체명, 기호: leadSymbol(soan), 업체구분: g,
        인센티브: isIncentive(soan) ? 'Y' : 'N', 전달마커: mk,
        소통채널: d.소통채널, 웹접수: d.웹접수, 웹회신: d.웹회신,
        상태: '활성', 출처: UP.isOpeningList ? '개통리스트' : '소속원장',
        최근개통일: UP.isOpeningList ? today : ''
      };
    });
    // 현행화: 소속/기호/구분/인센티브/마커만 갱신 (계산서·계약 값은 유지)
    // 휴면 업체에 개통건이 있으면 상태를 활성으로 자동 전환
    var updates = pickedChg.map(function (c) {
      var u = { id: c.id };
      if (c.soanChanged) {
        u.소속원문 = c.raw; u.기호 = c.new기호; u.업체구분 = c.new구분;
        u.인센티브 = c.newInc;
      }
      if (c.mkChanged || c.soanChanged) {
        var gb = c.new구분 || c.old구분;
        var nmk = defaultMarker(gb, c.마커 || markerFromName(c.raw));
        u.전달마커 = nmk;
        if (c.mkChanged) {   // 마커가 바뀌면 웹접수·웹회신도 규칙대로 다시 세팅
          var d2 = derive(gb, nmk);
          u.웹접수 = d2.웹접수; u.웹회신 = d2.웹회신;
        }
      }
      if (c.wake) u.상태 = '활성';
      if (UP.isOpeningList) u.최근개통일 = today;
      return u;
    });
    // 개통리스트일 때만: 변경이 없는 업체도 "이번주 개통" 사실을 기록 (확인필요 판정 근거)
    if (UP.isOpeningList) {
      var chgIds = {};
      updates.forEach(function (u) { chgIds[String(u.id)] = 1; });
      UP.touched.forEach(function (id) {
        if (!chgIds[String(id)]) updates.push({ id: id, 최근개통일: today });
      });
    }

    $('#upSave').disabled = true;
    var jobs = [];
    if (companies.length) jobs.push(apiPost({ action: 'bulkImport', companies: companies, replace: false }));
    if (updates.length) jobs.push(apiPost({ action: 'bulkUpsert', companies: updates }));
    Promise.all(jobs).then(function () {
      var msgs = [];
      if (companies.length) msgs.push('신규 ' + companies.length + '개 등록');
      if (updates.length) msgs.push('변경 ' + updates.length + '개 적용');
      toast(msgs.join(' · ') + ' 완료', 'ok');
      $('#uploadOverlay').classList.remove('open');
      if (companies.length) {
        setTimeout(function () {
          alert('신규 ' + companies.length + '개 업체가 등록되었습니다.\n\n' +
            '기본 정보(기호·구분·마커·웹접수/웹회신)는 자동으로 채워졌습니다.\n' +
            '계산서·계약 정보는 개통리스트에 없는 값이라 비어 있어요.\n\n' +
            '▸ 🧾 계산서 탭 → 필터 "계산서정보 없음" 으로 미입력 업체만 모아 채우기\n' +
            '▸ 📝 계약서·보증보험 탭 → 필터 "계약정보 없음" 으로 모아 채우기');
        }, 400);
      }
      return load();
    }).catch(function (e) {
      if (/unknown action/i.test(e.message)) toast('Apps Script 배포가 구버전입니다. 새 Code.gs로 다시 배포해 주세요.', 'err');
      else toast('적용 실패: ' + e.message, 'err');
      $('#upSave').disabled = false;
    });
  }

  /* ============ 유틸 ============ */
  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ''; }, 2600);
  }
  function setBusy(b) { $('#saveBtn').disabled = b; $('#deleteBtn').disabled = b; }
  function syncControls() {
    $('#fltMarker').value = STATE.filter.marker;
    $('#fltWeb').value = STATE.filter.web;
    $('#fltInv').value = STATE.filter.inv;
    $('#fltSym').value = STATE.filter.sym;
    $('#fltCon').value = STATE.filter.con;
  }

  function populateSymFilter() {
    var syms = {};
    STATE.all.forEach(function (c) {
      var s = String(c.기호 || '');
      if (!s) return;
      if (/^\d/.test(s) || s === '●') return; // 자점(숫자·●) 기호는 계산서 필터에서 제외
      syms[s] = 1;
    });
    var keys = Object.keys(syms).sort();
    $('#fltSym').innerHTML = '<option value="">기호(전체)</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
    $('#fltSym').value = STATE.filter.sym || '';
  }

  function setView(v) {
    VIEW = v;
    SORT = { key: '', dir: 1 };
    $$('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === v); });

    // 특수 탭(정산변환·변경로그)은 목록 화면을 감춤
    var settle = v === 'settle', isLog = v === 'log';
    var special = settle || isLog;
    $('#stats').style.display = special ? 'none' : '';
    document.querySelector('.toolbar').style.display = special ? 'none' : '';
    $('#mainTableWrap').style.display = special ? 'none' : '';
    $('#settleWrap').style.display = settle ? '' : 'none';
    $('#logWrap').style.display = isLog ? '' : 'none';
    if (settle) {
      var f = $('#settleFrame');
      if (!f.getAttribute('src')) f.setAttribute('src', 'settle.html?v=20260815g');
      return;
    }
    if (isLog) { loadLogs(); return; }

    // 탭별 필터 노출: 기본=마커/웹활용 · 계산서=기호/계산서형태 · 계약=계약상태
    $('#fltMarker').style.display = v === 'base' ? '' : 'none';
    $('#fltWeb').style.display = v === 'base' ? '' : 'none';
    $('#fltInv').style.display = v === 'invoice' ? '' : 'none';
    $('#fltSym').style.display = v === 'invoice' ? '' : 'none';
    $('#fltCon').style.display = v === 'contract' ? '' : 'none';
    // 탭을 바꾸면 필터를 모두 초기화한다 (이전 탭 필터가 남아 목록이 줄어드는 것 방지)
    STATE.filter = { gubun: '', marker: '', web: '', dormant: '', inv: '', sym: '', con: '', q: STATE.filter.q };
    syncControls();
    applyFilter();
  }

  function load() {
    $('#tbody').innerHTML = '<tr><td colspan="' + VIEW_COLS[VIEW] + '" class="empty"><span class="spin"></span> 불러오는 중…</td></tr>';
    return apiList().then(function (list) {
      STATE.allRaw = list.slice();   // 자점 포함 — 업로드 매칭은 이 전체를 기준으로 한다
      STATE.all = list.filter(function (c) {
        return c.업체구분 !== '자점'; // 자점은 화면에서 다루지 않음
      }).map(function (c) {
        c.계정수 = c.계정수 === '' ? '' : (Number(c.계정수) || c.계정수);
        // 구버전 서버(컬럼명 변경 전) 호환: 옛 이름으로 온 값을 새 이름으로 이어받음
        if (c.위탁판매 === undefined && c.계약서1 !== undefined) c.위탁판매 = c.계약서1;
        if (c.개인정보 === undefined && c.계약서2 !== undefined) c.개인정보 = c.계약서2;
        if (c.보증보험 === undefined) c.보증보험 = '';
        // 웹접수/웹회신 값이 아직 없으면 마커·웹활용 기준으로 표시값 유도 (저장 시 확정)
        if (!c.웹접수 || !c.웹회신) {
          var d = derive(c.업체구분, c.전달마커 || '', c.웹활용 || '');
          if (!c.웹접수) c.웹접수 = d.웹접수;
          if (!c.웹회신) c.웹회신 = d.웹회신;
        }
        return c;
      });
      checkServerVersion();
      populateSymFilter();
      applyFilter();
      showDataStamp();
    }).catch(function (e) {
      if (/unauthorized/i.test(e.message)) { forceLogin('세션이 만료됐어요. 다시 로그인해 주세요.'); return; }
      $('#tbody').innerHTML = '<tr><td colspan="' + VIEW_COLS[VIEW] + '" class="empty">불러오기 실패: ' + esc(e.message) + '</td></tr>';
      toast('데이터 불러오기 실패', 'err');
    });
  }

  /* ============ 초기화 ============ */
  document.addEventListener('DOMContentLoaded', function () {
    // 모드 배지
    var badge = $('#modeBadge');
    if (LIVE) { badge.textContent = '● 라이브(구글시트 연동)'; badge.className = 'badge-mode live'; }
    else { badge.textContent = '● 데모(읽기전용 · seed.json)'; badge.className = 'badge-mode demo'; }
    $('#uploadBtn').style.display = LIVE ? 'inline-block' : 'none';

    // 툴바 이벤트
    $('#search').addEventListener('input', function () { STATE.filter.q = this.value; applyFilter(); });
    $('#fltMarker').addEventListener('change', function () { STATE.filter.marker = this.value; applyFilter(); });
    $('#fltWeb').addEventListener('change', function () { STATE.filter.web = this.value; applyFilter(); });
    $('#fltInv').addEventListener('change', function () { STATE.filter.inv = this.value; applyFilter(); });
    $('#fltSym').addEventListener('change', function () { STATE.filter.sym = this.value; applyFilter(); });
    $('#fltCon').addEventListener('change', function () { STATE.filter.con = this.value; applyFilter(); });
    $('#resetBtn').addEventListener('click', function () {
      STATE.filter = { gubun: '', marker: '', web: '', dormant: '', inv: '', sym: '', con: '', q: '' };
      $('#search').value = ''; syncControls(); applyFilter();
    });
    $$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    $('#uploadBtn').addEventListener('click', openUpload);
    $('#reloadBtn').addEventListener('click', load);

    // 개통리스트 업로드 모달
    $('#upFile').addEventListener('change', function () { handleUploadFile(this.files[0]); });
    $('#upSave').addEventListener('click', saveUpload);
    $('#closeUpload').addEventListener('click', function () { $('#uploadOverlay').classList.remove('open'); });
    $('#upCancel').addEventListener('click', function () { $('#uploadOverlay').classList.remove('open'); });
    $('#uploadOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });

    // 모달 이벤트
    $('#overlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('#closeModal').addEventListener('click', closeModal);
    $('#cancelBtn').addEventListener('click', closeModal);
    $('#saveBtn').addEventListener('click', saveCompany);
    $('#deleteBtn').addEventListener('click', deleteCompany);
    $('#f_soan').addEventListener('blur', autofillFromSoan);
    $('#autofillBtn').addEventListener('click', autofillFromSoan);
    ['#f_wt', '#f_pi', '#f_cexc'].forEach(function (sel) {
      $(sel).addEventListener('change', renderConState);
    });
    $('#f_connote').addEventListener('input', renderConState);
    $('#f_gubun').addEventListener('change', reapplyDefaults);
    $('#f_marker').addEventListener('change', reapplyDefaults);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    // 인증 이벤트
    $('#au_submit').addEventListener('click', doAuth);
    $('#au_pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });
    $('#au_id').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#au_pw').focus(); });
    $('#logoutBtn').addEventListener('click', function () { forceLogin(); });

    // 계정 관리
    $('#usersBtn').addEventListener('click', openUsers);
    $('#closeUsers').addEventListener('click', function () { $('#usersOverlay').classList.remove('open'); });
    $('#closeUsers2').addEventListener('click', function () { $('#usersOverlay').classList.remove('open'); });
    $('#usersOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });
    $('#nu_add').addEventListener('click', addUser);
    $('#mp_save').addEventListener('click', changeMyPw);

    // 변경로그
    $('#logSearch').addEventListener('input', renderLogs);
    $('#logReload').addEventListener('click', loadLogs);

    startAuthGate();
  });
})();
