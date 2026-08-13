/* 협력점 관리앱 - 프론트엔드 (vanilla JS) */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!CFG.API_URL;

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
  // 구분 + 마커 -> 전달 기본값
  function derive(gubun, marker) {
    var d = { 웹활용: '', 소통채널: '', 접수대행: '', 유선접수전달: '', 유선개통전달: '', 무선개통전달: '', 회신전달: '', 직접접수: '', 상태: '활성' };
    if (gubun === '판매점') {
      d.웹활용 = 'N'; d.소통채널 = '카카오톡채널'; d.접수대행 = 'Y'; d.유선접수전달 = 'Y';
      d.유선개통전달 = 'Y'; d.무선개통전달 = 'Y'; d.회신전달 = 'Y'; d.직접접수 = 'N';
      if (marker === 'O') d.웹활용 = 'Y';
    } else if (gubun === '협력점') {
      d.소통채널 = '카카오톡단체방'; d.무선개통전달 = 'Y';
      if (marker === 'O') { d.웹활용 = 'N'; d.접수대행 = 'Y'; d.유선접수전달 = 'Y'; d.유선개통전달 = 'Y'; d.회신전달 = 'Y'; }
      else if (marker === 'X') { d.웹활용 = 'Y'; d.접수대행 = 'N'; d.유선접수전달 = 'N'; d.유선개통전달 = 'N'; d.회신전달 = 'N'; }
      else { d.상태 = '보류'; }
    } else if (gubun === '자점') {
      d.웹활용 = 'Y'; d.소통채널 = '어드민'; d.접수대행 = 'N'; d.유선접수전달 = 'N';
      d.유선개통전달 = 'N'; d.무선개통전달 = 'N'; d.회신전달 = 'N'; d.직접접수 = 'N';
    }
    return d;
  }

  /* ============ 상태 ============ */
  var STATE = { all: [], view: [], filter: { gubun: '', marker: '', web: '', status: '', q: '' } };
  var DELIV_FIELDS = ['접수대행', '유선접수전달', '유선개통전달', '무선개통전달', '회신전달'];

  /* ============ API ============ */
  function apiList() {
    if (!LIVE) {
      return fetch('data/seed.json').then(function (r) { return r.json(); })
        .then(function (d) { return d.companies || []; });
    }
    return fetch(CFG.API_URL + '?action=list', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || 'list 실패'); return d.companies || []; });
  }
  function apiPost(payload) {
    payload.token = CFG.WRITE_TOKEN || '';
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || '요청 실패'); return d; });
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

  function computeStats() {
    var s = { total: STATE.all.length, 판매점: 0, 협력점: 0, 자점: 0, hold: 0 };
    STATE.all.forEach(function (c) {
      if (s[c.업체구분] !== undefined) s[c.업체구분]++;
      if (c.상태 === '보류') s.hold++;
    });
    return s;
  }
  function renderStats() {
    var s = computeStats();
    $('#stats').innerHTML = [
      statCard('', 'total', s.total, '전체 업체'),
      statCard('sales', '판매점', s.판매점, '판매점'),
      statCard('partner', '협력점', s.협력점, '협력점'),
      statCard('own', '자점', s.자점, '자점'),
      statCard('hold', '__hold', s.hold, '보류(정리대상)')
    ].join('');
    $$('#stats .stat').forEach(function (el) {
      el.onclick = function () {
        var key = el.getAttribute('data-key');
        if (key === '__hold') { STATE.filter.status = STATE.filter.status === '보류' ? '' : '보류'; STATE.filter.gubun = ''; }
        else if (key === 'total') { STATE.filter.gubun = ''; STATE.filter.status = ''; }
        else { STATE.filter.gubun = STATE.filter.gubun === key ? '' : key; STATE.filter.status = ''; }
        syncControls(); applyFilter();
      };
    });
  }
  function statCard(cls, key, n, label) {
    var active = (key === STATE.filter.gubun) || (key === '__hold' && STATE.filter.status === '보류')
      || (key === 'total' && !STATE.filter.gubun && !STATE.filter.status);
    return '<div class="stat ' + cls + (active ? ' active' : '') + '" data-key="' + key + '">' +
      '<div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function applyFilter() {
    var f = STATE.filter, q = f.q.trim().toLowerCase();
    STATE.view = STATE.all.filter(function (c) {
      if (f.gubun && c.업체구분 !== f.gubun) return false;
      if (f.marker && (c.전달마커 || '') !== f.marker) return false;
      if (f.web && (c.웹활용 || '') !== f.web) return false;
      if (f.status && c.상태 !== f.status) return false;
      if (q) {
        var hay = (c.업체명 + ' ' + c.소속원문 + ' ' + (c.대표아이디 || '') + ' ' + (c.연락처 || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    renderStats();
    renderTable();
  }

  function renderTable() {
    var rows = STATE.view;
    $('#count').textContent = rows.length + ' / ' + STATE.all.length + ' 업체';
    if (!rows.length) { $('#tbody').innerHTML = '<tr><td colspan="14" class="empty">조건에 맞는 업체가 없습니다.</td></tr>'; return; }
    $('#tbody').innerHTML = rows.map(function (c) {
      var mk = c.전달마커 || '';
      return '<tr data-id="' + esc(c.id) + '">' +
        '<td class="name-cell">' + esc(c.업체명) + (c.인센티브 === 'Y' ? ' <span class="chip inc">인센</span>' : '') +
        '<span class="raw">' + esc(c.소속원문) + '</span></td>' +
        '<td><span class="chip g-' + esc(c.업체구분) + '">' + esc(c.업체구분) + '</span></td>' +
        '<td>' + (mk ? '<span class="chip m-' + esc(mk) + '">' + esc(mk) + '</span>' : '<span class="yn blank">–</span>') + '</td>' +
        '<td>' + esc(c.소통채널 || '') + '</td>' +
        '<td style="text-align:center">' + yn(c.웹활용) + '</td>' +
        '<td style="text-align:center">' + yn(c.접수대행) + '</td>' +
        '<td style="text-align:center">' + yn(c.유선접수전달) + '</td>' +
        '<td style="text-align:center">' + yn(c.유선개통전달) + '</td>' +
        '<td style="text-align:center">' + yn(c.무선개통전달) + '</td>' +
        '<td style="text-align:center">' + yn(c.회신전달) + '</td>' +
        '<td style="text-align:center">' + esc(c.계정수 || '') + '</td>' +
        '<td><span class="chip status-' + esc(c.상태) + '">' + esc(c.상태) + '</span></td>' +
        '<td>' + esc(c.비고 || '') + '</td>' +
        '<td><button class="btn sm ghost edit">수정</button></td>' +
        '</tr>';
    }).join('');
    $$('#tbody .edit').forEach(function (b) {
      b.onclick = function () { openModal(b.closest('tr').getAttribute('data-id')); };
    });
  }

  /* ============ 모달 ============ */
  function blankCompany() {
    return { id: '', 소속원문: '', 업체명: '', 기호: '', 업체구분: '', 인센티브: 'N', 전달마커: '', 소통채널: '', 웹활용: '', 직접접수: '', 접수대행: '', 유선접수전달: '', 유선개통전달: '', 무선개통전달: '', 회신전달: '', 계정수: '', 대표아이디: '', 연락처: '', 상태: '활성', 비고: '' };
  }
  function openModal(id) {
    var c = id ? JSON.parse(JSON.stringify(STATE.all.filter(function (x) { return String(x.id) === String(id); })[0])) : blankCompany();
    $('#modalTitle').textContent = id ? ('업체 수정 · ' + c.업체명) : '신규 업체 추가';
    $('#f_id').value = c.id || '';
    $('#f_soan').value = c.소속원문 || '';
    $('#f_name').value = c.업체명 || '';
    $('#f_gubun').value = c.업체구분 || '';
    $('#f_marker').value = c.전달마커 || '';
    $('#f_channel').value = c.소통채널 || '';
    $('#f_uid').value = c.대표아이디 || '';
    $('#f_tel').value = c.연락처 || '';
    $('#f_status').value = c.상태 || '활성';
    $('#f_note').value = c.비고 || '';
    $('#f_web').value = c.웹활용 || '';
    DELIV_FIELDS.forEach(function (k) { $('#f_' + k).value = c[k] || ''; });
    $('#deleteBtn').style.display = id ? 'inline-block' : 'none';
    updatePreview();
    $('#overlay').classList.add('open');
  }
  function closeModal() { $('#overlay').classList.remove('open'); }

  function autofillFromSoan() {
    var soan = $('#f_soan').value.trim();
    if (!soan) return;
    var g = classify(soan);
    $('#f_name').value = companyName(soan);
    $('#f_gubun').value = g === '미분류' ? '' : g;
    var d = derive(g, $('#f_marker').value || '');
    $('#f_channel').value = d.소통채널;
    $('#f_web').value = d.웹활용;
    $('#f_status').value = d.상태;
    DELIV_FIELDS.forEach(function (k) { $('#f_' + k).value = d[k]; });
    updatePreview();
  }
  function reapplyDefaults() {
    var g = $('#f_gubun').value, mk = $('#f_marker').value;
    var d = derive(g, mk);
    $('#f_channel').value = d.소통채널;
    $('#f_web').value = d.웹활용;
    if (d.상태) $('#f_status').value = d.상태;
    DELIV_FIELDS.forEach(function (k) { $('#f_' + k).value = d[k]; });
    updatePreview();
  }
  function updatePreview() {
    var soan = $('#f_soan').value.trim();
    var g = $('#f_gubun').value || classify(soan);
    var sym = leadSymbol(soan);
    var inc = isIncentive(soan);
    $('#preview').innerHTML = '자동판정 → 기호 <b>' + (esc(sym) || '없음') + '</b> · 구분 <b>' + esc(g || '미분류') +
      '</b>' + (inc ? ' · <b>인센티브</b>' : '') + ' · 무선개통전달은 판매점/협력점 항상 <b>Y</b>';
  }
  function collectForm() {
    var c = blankCompany();
    c.id = $('#f_id').value || '';
    c.소속원문 = $('#f_soan').value.trim();
    c.업체명 = $('#f_name').value.trim() || companyName(c.소속원문);
    c.업체구분 = $('#f_gubun').value;
    c.기호 = leadSymbol(c.소속원문);
    c.인센티브 = isIncentive(c.소속원문) ? 'Y' : 'N';
    c.전달마커 = $('#f_marker').value;
    c.소통채널 = $('#f_channel').value;
    c.웹활용 = $('#f_web').value;
    c.대표아이디 = $('#f_uid').value.trim();
    c.연락처 = $('#f_tel').value.trim();
    c.상태 = $('#f_status').value;
    c.비고 = $('#f_note').value.trim();
    DELIV_FIELDS.forEach(function (k) { c[k] = $('#f_' + k).value; });
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

  /* ============ 초기데이터 밀어넣기 ============ */
  function importSeed() {
    if (!LIVE) { toast('먼저 config.js 에 API_URL 을 설정하세요', 'err'); return; }
    if (!confirm('현재 시트 데이터를 비우고, 자동분류된 482개 업체를 새로 넣습니다. 진행할까요?')) return;
    setBusy(true);
    fetch('data/seed.json').then(function (r) { return r.json(); }).then(function (d) {
      return apiPost({ action: 'bulkImport', companies: d.companies, replace: true });
    }).then(function (res) {
      toast(res.imported + '개 업체를 시트에 넣었습니다', 'ok');
      return load();
    }).catch(function (e) { toast('초기화 실패: ' + e.message, 'err'); }).then(function () { setBusy(false); });
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
    $('#fltStatus').value = STATE.filter.status;
  }

  function load() {
    $('#tbody').innerHTML = '<tr><td colspan="14" class="empty"><span class="spin"></span> 불러오는 중…</td></tr>';
    return apiList().then(function (list) {
      STATE.all = list.map(function (c) { // 숫자화
        c.계정수 = c.계정수 === '' ? '' : (Number(c.계정수) || c.계정수);
        return c;
      });
      applyFilter();
    }).catch(function (e) {
      $('#tbody').innerHTML = '<tr><td colspan="14" class="empty">불러오기 실패: ' + esc(e.message) + '</td></tr>';
      toast('데이터 불러오기 실패', 'err');
    });
  }

  /* ============ 초기화 ============ */
  document.addEventListener('DOMContentLoaded', function () {
    // 모드 배지
    var badge = $('#modeBadge');
    if (LIVE) { badge.textContent = '● 라이브(구글시트 연동)'; badge.className = 'badge-mode live'; }
    else { badge.textContent = '● 데모(읽기전용 · seed.json)'; badge.className = 'badge-mode demo'; }
    $('#importBtn').style.display = LIVE ? 'inline-block' : 'none';
    $('#sheetLink').href = CFG.SHEET_URL || '#';

    // 툴바 이벤트
    $('#search').addEventListener('input', function () { STATE.filter.q = this.value; applyFilter(); });
    $('#fltMarker').addEventListener('change', function () { STATE.filter.marker = this.value; applyFilter(); });
    $('#fltWeb').addEventListener('change', function () { STATE.filter.web = this.value; applyFilter(); });
    $('#fltStatus').addEventListener('change', function () { STATE.filter.status = this.value; applyFilter(); });
    $('#resetBtn').addEventListener('click', function () {
      STATE.filter = { gubun: '', marker: '', web: '', status: '', q: '' };
      $('#search').value = ''; syncControls(); applyFilter();
    });
    $('#addBtn').addEventListener('click', function () { openModal(null); });
    $('#importBtn').addEventListener('click', importSeed);
    $('#reloadBtn').addEventListener('click', load);

    // 모달 이벤트
    $('#overlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('#closeModal').addEventListener('click', closeModal);
    $('#cancelBtn').addEventListener('click', closeModal);
    $('#saveBtn').addEventListener('click', saveCompany);
    $('#deleteBtn').addEventListener('click', deleteCompany);
    $('#f_soan').addEventListener('blur', autofillFromSoan);
    $('#autofillBtn').addEventListener('click', autofillFromSoan);
    $('#f_gubun').addEventListener('change', reapplyDefaults);
    $('#f_marker').addEventListener('change', reapplyDefaults);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    load();
  });
})();
