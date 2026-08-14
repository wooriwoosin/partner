/**
 * 협력점 관리앱 - Google Sheets 데이터 API (Apps Script)
 * ------------------------------------------------------------
 * GitHub Pages 정적 HTML(프론트엔드)이 호출하는 JSON API + 로그인 인증.
 * 데이터: SPREADSHEET_ID 의 '업체관리' 탭, 사용자: '사용자' 탭.
 *
 * 로그인:
 *   - 앱을 처음 열면(사용자 0명) '관리자 계정 만들기' 화면에서 아이디/비번 등록
 *   - 이후 로그인해야 목록/수정 가능 (토큰 방식)
 *   - 비밀번호는 해시로 저장(평문 저장 안 함)
 */

var SPREADSHEET_ID = '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc';
var SHEET_NAME = '업체관리';
var USER_SHEET = '사용자';

// 서명/해시용 비밀키. 그냥 두셔도 되고, 바꾸면 기존 토큰·비번해시가 무효화됩니다.
var SECRET = 'wnet-2026-8f3a9c1e-partner-secret';

// 초기 관리자 (비밀번호는 해시로만 보관 · 사용자 0명일 때 자동 생성)
var BOOTSTRAP_ADMIN = { 아이디: 'kmj', 해시: 'uEHJRXREBKPZumiEQLC2XVoaAJBR0F_beTg8hG5ElhE=', 이름: '김민정', 권한: 'admin' };

var HEADERS = [
  'id', '소속원문', '업체명', '기호', '업체구분', '인센티브', '전달마커',
  '소통채널', '웹활용', '직접접수', '접수대행', '유선접수전달', '유선개통전달',
  '무선개통전달', '회신전달', '계정수', '대표아이디', '연락처', '상태', '비고', '수정일시',
  // ▼ 통합 확장 필드 (②계산서방식 · ③전자계약서에서 병합 — 기존 열 "뒤"에 추가되므로 기존 데이터와 정렬 유지)
  '법인', '대표자', '계산서형태', '수신방법', '계산서비고',
  '계약서1', '계약서2', '사업자등록증', '계약제외', '계약비고', '출처'
];
var USER_HEADERS = ['아이디', '비번해시', '이름', '권한', '상태', '등록일'];

/* ------------------------- 공통 ------------------------- */
function ss_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function dataSheet_() {
  var sh = sheet_(SHEET_NAME, HEADERS);
  // 구버전 시트(21열)면 확장 컬럼 헤더를 뒤에 추가 (기존 데이터는 그대로)
  if (sh.getLastColumn() < HEADERS.length) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}
function userSheet_() { return sheet_(USER_SHEET, USER_HEADERS); }

function json_(obj, callback) {
  var out = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + out + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------- 인증 ------------------------- */
function hashPw_(id, pw) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SECRET + '|' + id + '|' + pw);
  return Utilities.base64EncodeWebSafe(raw);
}
function hmac_(msg) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, SECRET));
}
function makeToken_(id, role) {
  var payload = Utilities.base64EncodeWebSafe(id + '|' + role);
  return payload + '.' + hmac_(payload);
}
function verifyToken_(token) {
  if (!token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (hmac_(parts[0]) !== parts[1]) return null;
  var dec = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  var f = dec.split('|');
  return { id: f[0], role: f[1] };
}

function readUsers_() {
  var sh = userSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, USER_HEADERS.length).getValues();
  return v.filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    return { 아이디: String(r[0]).trim(), 비번해시: String(r[1]), 이름: r[2], 권한: r[3], 상태: r[4] };
  });
}
function findUser_(id) {
  id = String(id || '').trim();
  var us = readUsers_();
  for (var i = 0; i < us.length; i++) if (us[i].아이디 === id) return us[i];
  return null;
}
function addUser_(id, pw, name, role) {
  var sh = userSheet_();
  sh.appendRow([String(id).trim(), hashPw_(String(id).trim(), pw), name || '', role || 'admin', '활성', new Date()]);
}
function addUserHash_(id, hash, name, role) {
  userSheet_().appendRow([String(id).trim(), hash, name || '', role || 'admin', '활성', new Date()]);
}
function ensureAdmin_() {
  var sh = userSheet_();
  if (sh.getLastRow() < 2 && BOOTSTRAP_ADMIN && BOOTSTRAP_ADMIN.해시) {
    addUserHash_(BOOTSTRAP_ADMIN.아이디, BOOTSTRAP_ADMIN.해시, BOOTSTRAP_ADMIN.이름, BOOTSTRAP_ADMIN.권한);
  }
}
function usersPublic_() {
  return readUsers_().map(function (u) { return { 아이디: u.아이디, 이름: u.이름, 권한: u.권한, 상태: u.상태 }; });
}
function createUser_(id, pw, name, role) {
  id = String(id || '').trim();
  if (id.length < 3) return { ok: false, error: '아이디는 3자 이상이어야 합니다.' };
  if (String(pw || '').length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  if (findUser_(id)) return { ok: false, error: '이미 있는 아이디입니다.' };
  addUser_(id, pw, name || id, role || 'staff');
  return { ok: true };
}
function deleteUser_(id) {
  id = String(id || '').trim();
  var sh = userSheet_(); var last = sh.getLastRow();
  if (last < 3) return { ok: false, error: '마지막 계정은 삭제할 수 없습니다.' };
  var v = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() === id) { sh.deleteRow(i + 2); return { ok: true, deleted: id }; }
  }
  return { ok: false, error: '없는 아이디입니다.' };
}

function login_(id, pw) {
  var u = findUser_(id);
  if (!u) return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  if (String(u.상태) === '정지') return { ok: false, error: '정지된 계정입니다.' };
  if (u.비번해시 !== hashPw_(String(id).trim(), pw)) return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  return { ok: true, token: makeToken_(u.아이디, u.권한 || 'admin'), name: u.이름 || u.아이디, role: u.권한 || 'admin' };
}
function registerFirstAdmin_(id, pw, name) {
  if (readUsers_().length > 0) return { ok: false, error: '이미 관리자 계정이 있습니다. 로그인하세요.' };
  id = String(id || '').trim();
  if (id.length < 3) return { ok: false, error: '아이디는 3자 이상.' };
  if (String(pw || '').length < 4) return { ok: false, error: '비밀번호는 4자 이상.' };
  addUser_(id, pw, name || id, 'admin');
  return { ok: true, token: makeToken_(id, 'admin'), name: name || id, role: 'admin' };
}
function requireAuth_(token) {
  var u = verifyToken_(token);
  if (!u) throw new Error('unauthorized');
  return u;
}

/* ------------------------- 데이터 ------------------------- */
function readAll_() {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    var o = {}; HEADERS.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
}
function rowFromObj_(o) {
  return HEADERS.map(function (h) {
    if (h === '수정일시') return o[h] || new Date();
    return (o[h] === undefined || o[h] === null) ? '' : o[h];
  });
}
function nextId_(rows) {
  var max = 0; rows.forEach(function (r) { var n = Number(r.id) || 0; if (n > max) max = n; }); return max + 1;
}

/* ------------------------- HTTP ------------------------- */
function doGet(e) {
  e = e || {}; var p = e.parameter || {}; var cb = p.callback;
  try {
    ensureAdmin_();
    var action = p.action || 'ping';
    if (action === 'ping') return json_({ ok: true, sheet: SHEET_NAME, hasUsers: readUsers_().length > 0 }, cb);
    if (action === 'hasUsers') return json_({ ok: true, hasUsers: readUsers_().length > 0 }, cb);
    if (action === 'list') { requireAuth_(p.token); return json_({ ok: true, count: readAll_().length, companies: readAll_() }, cb); }
    return json_({ ok: false, error: 'unknown action: ' + action }, cb);
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }, cb); }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }
  var action = body.action || '';
  try {
    ensureAdmin_();
    if (action === 'hasUsers') return json_({ ok: true, hasUsers: readUsers_().length > 0 });
    if (action === 'login') return json_(login_(body.id, body.pw));
    if (action === 'registerFirstAdmin') return json_(registerFirstAdmin_(body.id, body.pw, body.name));

    // 이하 로그인 필요
    if (action === 'list') { requireAuth_(body.token); return json_({ ok: true, companies: readAll_() }); }
    if (action === 'upsert') { requireAuth_(body.token); return json_(upsert_(body.company)); }
    if (action === 'delete') { requireAuth_(body.token); return json_(remove_(body.id)); }
    if (action === 'bulkImport') { requireAuth_(body.token); return json_(bulkImport_(body.companies, body.replace)); }
    if (action === 'merge') { requireAuth_(body.token); return json_({ ok: true, summary: 병합실행() }); }
    if (action === 'bulkUpsert') { requireAuth_(body.token); return json_(bulkUpsert_(body.companies)); }
    if (action === 'listUsers') { requireAuth_(body.token); return json_({ ok: true, users: usersPublic_() }); }
    if (action === 'createUser') { requireAuth_(body.token); return json_(createUser_(body.id, body.pw, body.name, body.role)); }
    if (action === 'deleteUser') { requireAuth_(body.token); return json_(deleteUser_(body.id)); }
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

/* ------------------------- 액션 ------------------------- */
function upsert_(company) {
  if (!company) return { ok: false, error: 'no company' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = dataSheet_(); var rows = readAll_(); company['수정일시'] = new Date();
    if (company.id) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].id) === String(company.id)) {
          var merged = rows[i]; for (var k in company) merged[k] = company[k];
          sh.getRange(i + 2, 1, 1, HEADERS.length).setValues([rowFromObj_(merged)]);
          return { ok: true, mode: 'update', company: merged };
        }
      }
    }
    company.id = nextId_(rows); sh.appendRow(rowFromObj_(company));
    return { ok: true, mode: 'insert', company: company };
  } finally { lock.releaseLock(); }
}
// 여러 업체를 id 기준으로 한 번에 부분 갱신 (개통리스트 현행화용)
function bulkUpsert_(companies) {
  if (!companies || !companies.length) return { ok: false, error: 'no companies' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dataSheet_();
    var rows = readAll_();
    var byId = {};
    rows.forEach(function (r, i) { byId[String(r.id)] = i; });
    var now = new Date(); var updated = 0;
    companies.forEach(function (c) {
      if (!c || c.id === undefined || c.id === '') return;
      var i = byId[String(c.id)];
      if (i === undefined) return;
      for (var k in c) { if (k !== 'id') rows[i][k] = c[k]; }
      rows[i]['수정일시'] = now;
      updated++;
    });
    var out = rows.map(rowFromObj_);
    if (out.length) sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);
    return { ok: true, updated: updated };
  } finally { lock.releaseLock(); }
}

function remove_(id) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = dataSheet_(); var rows = readAll_();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) { sh.deleteRow(i + 2); return { ok: true, deleted: id }; }
    }
    return { ok: false, error: 'not found: ' + id };
  } finally { lock.releaseLock(); }
}
function bulkImport_(companies, replace) {
  if (!companies || !companies.length) return { ok: false, error: 'no companies' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dataSheet_();
    if (replace) { var last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent(); }
    var start = replace ? 1 : nextId_(readAll_()); var now = new Date();
    var out = companies.map(function (c, idx) { if (!c.id) c.id = start + idx; c['수정일시'] = now; return rowFromObj_(c); });
    sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.length).setValues(out);
    return { ok: true, imported: out.length };
  } finally { lock.releaseLock(); }
}

/* ------------------------- 유지보수용(편집기에서 실행) ------------------------- */
// 비밀번호 초기화/추가 계정이 필요할 때 편집기에서 값 바꿔 실행.
function 계정추가_직접(id, pw, name, role) {
  if (findUser_(id)) { Logger.log('이미 있는 아이디'); return; }
  addUser_(id, pw, name, role || 'admin');
  Logger.log('추가됨: ' + id);
}

function setup() { dataSheet_(); userSheet_(); return 'ok'; }

/* ============================================================
 * ②③ 통합 병합 — Apps Script 편집기에서 [병합실행] 1회 실행
 * ------------------------------------------------------------
 * ② 업체별 계산서방식 / ③ 전자계약서 시트를 읽어
 * 메인 DB('업체관리' 탭)에 계산서·계약 정보를 채워 넣습니다.
 *  - 매칭: 업체명 정규화(기호 ■★☆◆□ / 마커 ○●◎ / 공백 제거)
 *  - 메인 DB에 없는 업체는 새 행으로 추가 (지점도 개별 업체로)
 *  - 결과는 '병합리포트' 탭에 정리 (신규추가/중복의심/연락처상이)
 *  - ②③ 원본 시트는 읽기만 하고 수정하지 않음
 * ============================================================ */
var SRC_INVOICE  = '1Ts6tRFJyeQln3z5Rt6Gr9OMpk6TL8gMTUseRyMlBx80'; // ② 업체별 계산서방식
var SRC_CONTRACT = '1L7S98jOys3DS0KtP068Bmyfbif6kseuUE1prdq-Gutw'; // ③ 전자계약서
var REPORT_SHEET = '병합리포트';

function normName_(s) {
  if (!s) return '';
  s = String(s).replace(/[■□★☆◆◇○●◎]/g, '').replace(/\s+/g, '').trim().toLowerCase();
  var alias = { 'show예산': '쇼예산', '천안모바일': '누네띠네중고폰' };
  return alias[s] || s;
}
function symbolOf_(s) {
  var m = String(s || '').trim().match(/^([■□★☆◆◇]+)/);
  return m ? m[1] : '';
}
function groupOfSymbol_(sym) {
  if (/^[■□]/.test(sym)) return '판매점';
  if (/^[★☆◆◇]/.test(sym)) return '협력점';
  return '';
}
function toYN_(v) {
  if (v === true || v === 'TRUE' || v === 'true' || v === 'Y' || v === 'y') return 'Y';
  if (v === false || v === 'FALSE' || v === 'false' || v === 'N' || v === 'n') return 'N';
  return v ? String(v) : '';
}
// 소스 스프레드시트의 "모든 탭"을 뒤져서, 필수 헤더가 들어있는 행을 찾아 데이터를 읽는다.
// (데이터가 첫 탭이 아니거나 헤더가 1행이 아니어도 동작)
function readSrc_(fileId, requiredHeaders) {
  var sheets = SpreadsheetApp.openById(fileId).getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var values = sheets[s].getDataRange().getValues();
    var scan = Math.min(values.length, 10);
    for (var h = 0; h < scan; h++) {
      var header = values[h].map(function (x) { return String(x).trim(); });
      var hit = requiredHeaders.every(function (rq) { return header.indexOf(rq) >= 0; });
      if (!hit) continue;
      var out = [];
      for (var i = h + 1; i < values.length; i++) {
        if (values[i].every(function (c) { return c === '' || c === null; })) continue;
        var o = {};
        header.forEach(function (hd, j) { if (hd) o[hd] = values[i][j]; });
        out.push(o);
      }
      return { rows: out, sheet: sheets[s].getName(), headerRow: h + 1 };
    }
  }
  return { rows: [], sheet: '(헤더 못찾음: ' + requiredHeaders.join(',') + ')', headerRow: 0 };
}

function 병합실행() {
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    var rows = readAll_();               // 메인 DB 현재 데이터
    var inv = readSrc_(SRC_INVOICE, ['협력점명', '계산서형태']);   // ②
    var con = readSrc_(SRC_CONTRACT, ['name', 'c1']);              // ③
    var invoice = inv.rows;
    var contract = con.rows;
    var issues = [];
    if (!invoice.length) issues.push(['소스오류', '② 계산서방식', '데이터를 못 읽음 — ' + inv.sheet]);
    if (!contract.length) issues.push(['소스오류', '③ 전자계약서', '데이터를 못 읽음 — ' + con.sheet]);
    var byKey = {};
    var added2 = 0, added3 = 0, filled2 = 0, filled3 = 0;

    rows.forEach(function (r) {
      if (!r['출처']) r['출처'] = '①';
      var k = normName_(r['업체명']);
      if (byKey[k]) issues.push(['중복의심', r['업체명'], '메인DB에 같은 이름이 2개 이상 — id ' + byKey[k].id + ' / ' + r.id]);
      else byKey[k] = r;
    });

    // ── ② 계산서방식 병합
    invoice.forEach(function (r) {
      var name = String(r['협력점명'] || '').trim();
      if (!name) return;
      var e = byKey[normName_(name)];
      if (!e) {
        var sym = String(r['법인기호'] || '').trim();
        e = blankRow_();
        e['소속원문'] = sym + name;
        e['업체명'] = name;
        e['기호'] = sym;
        e['업체구분'] = groupOfSymbol_(sym);
        e['상태'] = '활성';
        e['출처'] = '②';
        byKey[normName_(name)] = e;
        rows.push(e);
        added2++;
        issues.push(['신규추가(②)', name, '메인DB에 없어 새로 추가 — 업체구분 확인 필요']);
      } else if (e['계산서형태']) {
        issues.push(['중복의심', name, '②에 같은 이름 2회 이상 — 첫 값 유지']);
        return;
      } else {
        filled2++;
      }
      e['계산서형태'] = String(r['계산서형태'] || '');
      e['수신방법'] = String(r['수신방법'] || '');
      e['계산서비고'] = String(r['비고'] || '');
      if (!e['법인']) e['법인'] = String(r['법인'] || '');
      if (String(e['출처']).indexOf('②') < 0) e['출처'] += '②';
    });

    // ── ③ 전자계약서 병합
    contract.forEach(function (r) {
      var raw = String(r['name'] || '').trim();
      if (!raw) return;
      var e = byKey[normName_(raw)];
      if (!e) {
        var sym = symbolOf_(raw);
        e = blankRow_();
        e['소속원문'] = raw;
        e['업체명'] = raw.replace(/[○●◎]/g, '').replace(/^[■□★☆◆◇]+/, '').trim();
        e['기호'] = sym;
        e['업체구분'] = groupOfSymbol_(sym);
        e['상태'] = '활성';
        e['출처'] = '③';
        byKey[normName_(raw)] = e;
        rows.push(e);
        added3++;
        issues.push(['신규추가(③)', e['업체명'], '메인DB에 없어 새로 추가 — 업체구분 확인 필요']);
      } else if (e['계약서1'] !== '' && e['계약서1'] !== undefined) {
        issues.push(['중복의심', raw, '③에 같은 이름 2회 이상(예: 김용균) — 첫 값 유지']);
        return;
      } else {
        filled3++;
      }
      if (!e['대표자']) e['대표자'] = String(r['rep'] || '');
      var phone = String(r['phone'] || '').trim();
      if (phone) {
        var cur = String(e['연락처'] || '').trim();
        if (!cur) e['연락처'] = phone;
        else if (cur.replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
          issues.push(['연락처상이', e['업체명'], '메인DB: ' + cur + ' / ③: ' + phone + ' — 최신 확인 필요']);
        }
      }
      e['계약서1'] = toYN_(r['c1']) || 'N';
      e['계약서2'] = toYN_(r['c2']) || 'N';
      e['사업자등록증'] = toYN_(r['bizDoc']) || 'N';
      e['계약제외'] = toYN_(r['excluded']) || 'N';
      e['계약비고'] = String(r['note'] || '');
      if (String(e['출처']).indexOf('③') < 0) e['출처'] += '③';
    });

    // ── id 부여(신규만) + 전체 다시 쓰기
    var maxId = 0;
    rows.forEach(function (r) { var n = Number(r.id) || 0; if (n > maxId) maxId = n; });
    rows.forEach(function (r) { if (!r.id) r.id = ++maxId; });

    var sh = dataSheet_();
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
    var out = rows.map(rowFromObj_);
    sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);

    writeMergeReport_(rows, issues);

    var msg = '병합 완료: 총 ' + rows.length + '개 업체'
      + ' | ②(' + inv.sheet + '탭 ' + invoice.length + '행) 매칭 ' + filled2 + ' · 신규 ' + added2
      + ' | ③(' + con.sheet + '탭 ' + contract.length + '행) 매칭 ' + filled3 + ' · 신규 ' + added3
      + ' | 확인필요 ' + issues.length + '건 → "' + REPORT_SHEET + '" 탭 확인';
    Logger.log(msg);
    return msg;
  } finally { lock.releaseLock(); }
}

function blankRow_() {
  var o = {};
  HEADERS.forEach(function (h) { o[h] = ''; });
  o.id = '';
  return o;
}

function writeMergeReport_(rows, issues) {
  var ss = ss_();
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) sh = ss.insertSheet(REPORT_SHEET);
  sh.clearContents();

  var c1 = 0, c2 = 0, c3 = 0, all3 = 0;
  rows.forEach(function (r) {
    var s = String(r['출처'] || '');
    if (s.indexOf('①') >= 0) c1++;
    if (s.indexOf('②') >= 0) c2++;
    if (s.indexOf('③') >= 0) c3++;
    if (s.indexOf('①') >= 0 && s.indexOf('②') >= 0 && s.indexOf('③') >= 0) all3++;
  });

  var out = [];
  out.push(['■ 병합 요약 (' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ')', '', '']);
  out.push(['총 업체 수', rows.length, '']);
  out.push(['① 협력점관리 출신', c1, '']);
  out.push(['② 계산서 정보 보유', c2, '']);
  out.push(['③ 계약 정보 보유', c3, '']);
  out.push(['①②③ 모두 매칭', all3, '']);
  out.push(['', '', '']);
  out.push(['■ 확인 필요 항목 (' + issues.length + '건)', '', '']);
  out.push(['유형', '업체명', '상세']);
  issues.forEach(function (r) { out.push(r); });
  out.push(['', '', '']);
  out.push(['■ 업체별 현황', '', '']);
  out.push(['업체명', '출처', '계산서 / 계약']);
  rows.forEach(function (r) {
    out.push([r['업체명'], r['출처'],
      (r['계산서형태'] ? '계산서:' + r['계산서형태'] : '계산서없음') + ' / ' +
      (r['계약서1'] === 'Y' ? '계약O' : (r['계약서1'] ? '계약X' : '계약정보없음'))]);
  });
  sh.getRange(1, 1, out.length, 3).setValues(out);
  sh.setFrozenRows(1);
}
