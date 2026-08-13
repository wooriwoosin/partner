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
  '무선개통전달', '회신전달', '계정수', '대표아이디', '연락처', '상태', '비고', '수정일시'
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
function dataSheet_() { return sheet_(SHEET_NAME, HEADERS); }
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
