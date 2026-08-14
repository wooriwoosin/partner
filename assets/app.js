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
  // 구분 + 마커 -> 웹접수/웹회신 기본값
  //  · 마커 X = 업체가 직접 웹 처리 → 웹접수 Y · 웹회신 Y
  //  · 마커 O = 대신 전달 → 웹접수 N · 웹회신 N
  //  · 마커 없음(판매점 기본 등) = 웹활용 여부 따라, 기본 N
  function derive(gubun, marker, webY) {
    var d = { 소통채널: '', 웹접수: 'N', 웹회신: 'N', 상태: '활성' };
    if (gubun === '판매점') d.소통채널 = '카카오톡채널';
    else if (gubun === '협력점') d.소통채널 = '카카오톡단체방';
    if (marker === 'X') { d.웹접수 = 'Y'; d.웹회신 = 'Y'; }
    else if (marker === 'O') { d.웹접수 = 'N'; d.웹회신 = 'N'; }
    else if (webY === 'Y') { d.웹접수 = 'Y'; d.웹회신 = 'Y'; }
    return d;
  }

  /* ============ 상태 ============ */
  var STATE = { all: [], view: [], filter: { gubun: '', marker: '', web: '', dormant: false, inv: '', sym: '', con: '', q: '' } };
  var VIEW = 'base'; // base | invoice | contract | settle
  var EDITING = null; // 수정 중인 원본 레코드 (출처 등 폼에 없는 필드 보존용)

  /* ============ API ============ */
  function apiList() {
    if (!LIVE) {
      return fetch('data/seed.json').then(function (r) { return r.json(); })
        .then(function (d) { return d.companies || []; });
    }
    return fetch(CFG.API_URL + '?action=list&token=' + encodeURIComponent(TOKEN), { method: 'GET' })
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
  function yn(v) {
    if (v === 'Y') return '<span class="yn y">Y</span>';
    if (v === 'N') return '<span class="yn n">·</span>';
    return '<span class="yn blank">–</span>';
  }

  // 계약 상태 판정: 제외 > 완료 > 만료 > 진행중 > 미진행 > 정보없음
  function conState(c) {
    if (c.계약제외 === 'Y') return '제외';
    if (!c.위탁판매) return '정보없음';
    if (c.위탁판매 === 'Y' && c.개인정보 === 'Y') return '완료';
    if ((c.계약비고 || '').indexOf('만료') >= 0) return '만료';
    if (c.위탁판매 === 'Y' || c.개인정보 === 'Y') return '진행중';
    return '미진행';
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

  function computeStats() {
    var s = { total: STATE.all.length, 판매점: 0, 협력점: 0, 휴면: 0, 정발행: 0, 역발행: 0, 원천세: 0, 계약완료: 0 };
    STATE.all.forEach(function (c) {
      if (s[c.업체구분] !== undefined) s[c.업체구분]++;
      if (c.상태 === '휴면') s.휴면++;
      if (s[c.계산서형태] !== undefined) s[c.계산서형태]++;
      if (c.위탁판매 === 'Y' && c.개인정보 === 'Y') s.계약완료++;
    });
    return s;
  }
  function renderStats() {
    var s = computeStats();
    var cards = [
      statCard('', 'total', s.total, '전체 업체'),
      statCard('sales', '판매점', s.판매점, '판매점'),
      statCard('partner', '협력점', s.협력점, '협력점'),
      statCard('hold', 'dormant', s.휴면, '휴면(미거래)')
    ];
    if (VIEW === 'invoice') {
      cards = [
        statCard('', 'total', s.total, '전체 업체'),
        statCard('inv1', 'inv:정발행', s.정발행, '정발행'),
        statCard('inv2', 'inv:역발행', s.역발행, '역발행'),
        statCard('inv3', 'inv:원천세', s.원천세, '원천세'),
        statCard('hold', 'inv:__none', s.total - s.정발행 - s.역발행 - s.원천세, '계산서정보 없음/기타')
      ];
    } else if (VIEW === 'contract') {
      var cs = { 완료: 0, 진행중: 0, 미진행: 0, 만료: 0, 제외: 0, 정보없음: 0 };
      STATE.all.forEach(function (c) { cs[conState(c)]++; });
      cards = [
        statCard('', 'total', s.total, '전체 업체'),
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
        if (key === 'total') { STATE.filter.gubun = ''; STATE.filter.inv = ''; STATE.filter.con = ''; STATE.filter.dormant = false; }
        else if (key === 'dormant') { STATE.filter.dormant = !STATE.filter.dormant; }
        else if (key.indexOf('inv:') === 0) {
          var v = key.slice(4);
          STATE.filter.inv = STATE.filter.inv === v ? '' : v;
        }
        else if (key.indexOf('con:') === 0) {
          var cv = key.slice(4);
          STATE.filter.con = STATE.filter.con === cv ? '' : cv;
        }
        else { STATE.filter.gubun = STATE.filter.gubun === key ? '' : key; }
        syncControls(); applyFilter();
      };
    });
  }
  function statCard(cls, key, n, label) {
    var active = (key === STATE.filter.gubun)
      || (key === 'dormant' && STATE.filter.dormant)
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
      if (f.dormant && c.상태 !== '휴면') return false;
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

  var THEADS = {
    base: '<tr><th>업체 / 소속(원문)</th><th>구분</th><th>대표자</th><th>연락처</th><th>마커</th>' +
      '<th>웹접수</th><th>웹회신</th><th>소통채널</th><th>상태</th><th>비고</th><th></th></tr>',
    invoice: '<tr><th>기호</th><th>업체 / 소속(원문)</th><th>구분</th><th>법인</th><th>계산서형태</th><th>수신방법</th><th>사업자</th><th>계산서 비고</th><th></th></tr>',
    contract: '<tr><th>업체 / 소속(원문)</th><th>구분</th><th>계약상태</th><th>대표자</th><th>연락처</th><th>위탁판매</th><th>개인정보</th><th>보증보험</th><th>계약 비고</th><th></th></tr>'
  };
  var VIEW_COLS = { base: 11, invoice: 9, contract: 10 };
  var CON_CHIP = { 완료: 'status-활성', 진행중: 'g-자점', 미진행: 'g-판매점', 만료: 'status-보류', 제외: 'm-X', 정보없음: 'i-기타' };

  function nameCell(c) {
    return '<td class="name-cell">' + esc(c.업체명) + (c.인센티브 === 'Y' ? ' <span class="chip inc">인센</span>' : '') +
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
    var rows = STATE.view;
    if (VIEW === 'invoice') { // 기호별로 묶어서 표시
      rows = rows.slice().sort(function (a, b) {
        var s = String(a.기호 || '').localeCompare(String(b.기호 || ''), 'ko');
        return s !== 0 ? s : String(a.업체명 || '').localeCompare(String(b.업체명 || ''), 'ko');
      });
    }
    $('#thead').innerHTML = THEADS[VIEW];
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
  var UP = { grid: [], headerRow: -1, colIdx: -1, candidates: [], changes: [] };

  // 중복 비교용 키: 숫자접두/기호/마커괄호/공백 제거 + 소문자
  function normKey(s) {
    return String(s || '')
      .replace(/^\d+\./, '')
      .replace(/[\(（]\s*[oOxX○×?？]\s*[\)）]/g, '')
      .replace(/[■□★☆◆◇○●◎]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function openUpload() {
    UP = { grid: [], headerRow: -1, colIdx: -1, candidates: [], changes: [] };
    $('#upFile').value = '';
    $('#upColWrap').style.display = 'none';
    $('#upSummary').style.display = 'none';
    $('#upNewWrap').style.display = 'none';
    $('#upChgWrap').style.display = 'none';
    $('#upSave').disabled = true;
    $('#uploadOverlay').classList.add('open');
  }

  function handleUploadFile(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') { toast('엑셀 라이브러리 로드 실패 — 인터넷 연결을 확인하세요', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        UP.grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        detectColumn();
      } catch (err) { toast('파일을 읽지 못했습니다: ' + err.message, 'err'); }
    };
    reader.readAsArrayBuffer(file);
  }

  // '소속' 열 자동 탐지 (상위 10행에서 헤더 검색)
  function detectColumn() {
    var re = /소속|업체|거래처|판매점|협력/;
    for (var r = 0; r < Math.min(UP.grid.length, 10); r++) {
      for (var c = 0; c < UP.grid[r].length; c++) {
        if (re.test(String(UP.grid[r][c]))) { UP.headerRow = r; UP.colIdx = c; buildCandidates(); return; }
      }
    }
    // 자동 탐지 실패 → 첫 행을 헤더로 보고 직접 선택
    UP.headerRow = 0;
    var opts = (UP.grid[0] || []).map(function (h, i) {
      return '<option value="' + i + '">' + esc(String(h) || ('열 ' + (i + 1))) + '</option>';
    }).join('');
    $('#upCol').innerHTML = opts;
    $('#upColWrap').style.display = '';
    $('#upSummary').style.display = '';
    $('#upSummary').textContent = "'소속' 열을 자동으로 찾지 못했어요. 업체명(기호 포함)이 들어있는 열을 선택해 주세요.";
    $('#upCol').onchange = function () { UP.colIdx = Number(this.value); buildCandidates(); };
  }

  function buildCandidates() {
    if (UP.colIdx < 0) return;
    var byKey = {};
    STATE.all.forEach(function (x) {
      var k1 = normKey(x.업체명), k2 = normKey(x.소속원문);
      if (k1 && !byKey[k1]) byKey[k1] = x;
      if (k2 && !byKey[k2]) byKey[k2] = x;
    });
    var seen = {}, cands = [], changes = [], same = 0, total = 0, own = 0;
    for (var r = UP.headerRow + 1; r < UP.grid.length; r++) {
      var raw = String((UP.grid[r] || [])[UP.colIdx] || '').trim();
      if (!raw) continue;
      total++;
      var key = normKey(raw);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      if (classify(raw) === '자점') { own++; continue; } // 자점은 등록/현행화 대상 아님
      var ex = byKey[key];
      if (ex) {
        // 기호/소속이 달라졌거나, 휴면 업체에 개통건 발생(→활성 전환) → 현행화 후보
        var soanChanged = String(ex.소속원문 || '').trim() !== raw;
        var wake = ex.상태 === '휴면';
        if (soanChanged || wake) {
          var g2 = classify(raw);
          changes.push({
            id: ex.id, 업체명: ex.업체명,
            old소속: ex.소속원문 || '', raw: raw,
            old기호: ex.기호 || '', new기호: leadSymbol(raw),
            old구분: ex.업체구분 || '', new구분: g2 === '미분류' ? (ex.업체구분 || '') : g2,
            oldInc: ex.인센티브 || 'N', newInc: isIncentive(raw) ? 'Y' : 'N',
            soanChanged: soanChanged, wake: wake,
            checked: true
          });
        } else same++;
        continue;
      }
      var g = classify(raw);
      cands.push({ 소속원문: raw, 업체명: companyName(raw), 구분: g === '미분류' ? '' : g, checked: true });
    }
    UP.candidates = cands;
    UP.changes = changes;
    $('#upSummary').style.display = '';
    $('#upSummary').innerHTML = '리스트 <b>' + total + '건</b> → 🆕 신규 <b>' + cands.length + '개</b> · 🔄 기호/소속 변경 <b>' + changes.length + '개</b> · 기존과 동일 <b>' + same + '건</b>' + (own ? ' · 자점 제외 <b>' + own + '건</b>' : '');
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
        '<td>' + (c.구분 ? '<span class="chip g-' + esc(c.구분) + '">' + esc(c.구분) + '</span>' : '<span class="yn blank">미분류</span>') + '</td></tr>';
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
      if (c.soanChanged) {
        if (c.old기호 !== c.new기호) diffs.push('기호 ' + (c.old기호 || '없음') + '→' + (c.new기호 || '없음'));
        if (c.old구분 !== c.new구분) diffs.push('구분 ' + (c.old구분 || '?') + '→' + (c.new구분 || '?'));
        if (c.oldInc !== c.newInc) diffs.push('인센티브 ' + c.oldInc + '→' + c.newInc);
        if (diffs.length === (c.wake ? 1 : 0)) diffs.push('표기 변경');
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
    $('#upSave').disabled = (n + m) === 0;
    var parts = [];
    if (n) parts.push('신규 ' + n + '개 등록');
    if (m) parts.push('변경 ' + m + '개 적용');
    $('#upSave').textContent = parts.length ? parts.join(' · ') : '선택 항목 적용';
  }

  function saveUpload() {
    var picked = UP.candidates.filter(function (c) { return c.checked; });
    var pickedChg = UP.changes.filter(function (c) { return c.checked; });
    if (!picked.length && !pickedChg.length) return;
    if (!LIVE) { toast('데모 모드에서는 등록할 수 없습니다', 'err'); return; }

    var companies = picked.map(function (p) {
      var soan = p.소속원문;
      var g = p.구분 || classify(soan);
      if (g === '미분류') g = '';
      var mk = markerFromName(soan);
      var d = derive(g, mk);
      return {
        소속원문: soan, 업체명: p.업체명, 기호: leadSymbol(soan), 업체구분: g,
        인센티브: isIncentive(soan) ? 'Y' : 'N', 전달마커: mk,
        소통채널: d.소통채널, 웹접수: d.웹접수, 웹회신: d.웹회신,
        상태: '활성', 출처: '개통리스트'
      };
    });
    // 현행화: 소속/기호/구분/인센티브/마커만 갱신 (계산서·계약 값은 유지)
    // 휴면 업체에 개통건이 있으면 상태를 활성으로 자동 전환
    var updates = pickedChg.map(function (c) {
      var u = { id: c.id };
      if (c.soanChanged) {
        u.소속원문 = c.raw; u.기호 = c.new기호; u.업체구분 = c.new구분;
        u.인센티브 = c.newInc; u.전달마커 = markerFromName(c.raw);
      }
      if (c.wake) u.상태 = '활성';
      return u;
    });

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
      if (!f.getAttribute('src')) f.setAttribute('src', 'settle.html');
      return;
    }
    if (isLog) { loadLogs(); return; }

    // 탭별 필터 노출: 기본=마커/웹활용 · 계산서=기호/계산서형태 · 계약=계약상태
    $('#fltMarker').style.display = v === 'base' ? '' : 'none';
    $('#fltWeb').style.display = v === 'base' ? '' : 'none';
    $('#fltInv').style.display = v === 'invoice' ? '' : 'none';
    $('#fltSym').style.display = v === 'invoice' ? '' : 'none';
    $('#fltCon').style.display = v === 'contract' ? '' : 'none';
    // 다른 탭의 전용 필터는 초기화 (숨겨진 필터가 몰래 거르는 것 방지)
    if (v !== 'base') { STATE.filter.marker = ''; STATE.filter.web = ''; }
    if (v !== 'invoice') { STATE.filter.inv = ''; STATE.filter.sym = ''; }
    if (v !== 'contract') { STATE.filter.con = ''; }
    syncControls();
    applyFilter();
  }

  function load() {
    $('#tbody').innerHTML = '<tr><td colspan="' + VIEW_COLS[VIEW] + '" class="empty"><span class="spin"></span> 불러오는 중…</td></tr>';
    return apiList().then(function (list) {
      STATE.all = list.filter(function (c) {
        return c.업체구분 !== '자점'; // 자점은 앱에서 다루지 않음
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
      STATE.filter = { gubun: '', marker: '', web: '', inv: '', sym: '', con: '', q: '' };
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
