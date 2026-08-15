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

// 배포된 코드 버전 — 프론트가 이 값으로 "구버전 배포"를 감지해 경고를 띄웁니다.
var CODE_VERSION = '2026-08-15c';

var SPREADSHEET_ID = '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc';
var SHEET_NAME = '업체관리';
var USER_SHEET = '사용자';
var LOG_SHEET = '변경로그';
var LOG_TZ = 'Asia/Seoul';

// 서명/해시용 비밀키. 그냥 두셔도 되고, 바꾸면 기존 토큰·비번해시가 무효화됩니다.
var SECRET = 'wnet-2026-8f3a9c1e-partner-secret';

// 초기 관리자 (비밀번호는 해시로만 보관 · 사용자 0명일 때 자동 생성)
var BOOTSTRAP_ADMIN = { 아이디: 'kmj', 해시: 'uEHJRXREBKPZumiEQLC2XVoaAJBR0F_beTg8hG5ElhE=', 이름: '김민정', 권한: 'admin' };

// 시트 컬럼 정의 — 화면에서 실제로 쓰는 항목만, 업무 순서대로 정리
// ※ 데이터는 "컬럼 이름"으로 읽고 씁니다. 시트에서 열 순서를 바꿔도 안전합니다.
var HEADERS = [
  // [식별]
  'id', '업체명', '소속원문', '기호', '업체구분', '인센티브', '전달마커', '상태',
  // [기본 정보] — 앱: 기본 정보 탭
  '소통채널', '웹접수', '웹회신', '대표자', '연락처', '계정수', '비고',
  // [계산서] — 앱: 🧾 계산서 탭
  '법인', '계산서형태', '수신방법', '사업자등록증', '계산서비고',
  // [계약] — 앱: 📝 계약서·보증보험 탭
  '위탁판매', '개인정보', '보증보험', '계약제외', '계약비고',
  // [관리]
  '출처', '등록일', '최근개통일', '수정일시'
];

// 이름이 바뀐 컬럼 (새 이름 → 옛 이름). 시트정리 시 옛 이름 값을 새 이름으로 이어받는다.
var RENAMED_COLS = { '위탁판매': '계약서1', '개인정보': '계약서2' };

// 더 이상 쓰지 않는 옛 컬럼 (시트정리() 실행 시 제거)
var LEGACY_COLS = [
  '웹활용', '직접접수', '접수대행', '유선접수전달', '유선개통전달',
  '무선개통전달', '회신전달', '대표아이디'
];

var USER_HEADERS = ['아이디', '비번해시', '이름', '권한', '상태', '등록일'];
var LOG_HEADERS = ['일시', '아이디', '이름', '작업', '대상', '상세'];

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
function logSheet_() { return sheet_(LOG_SHEET, LOG_HEADERS); }
function dataSheet_() {
  var sh = sheet_(SHEET_NAME, HEADERS);
  var hdr = sheetHeader_(sh);

  // 헤더가 새 구조가 아니면(구버전 배포가 덮어썼을 때) 자동 복구 시도
  if (hdr[1] !== '업체명' || hdr[7] !== '상태') {
    if (autoRepairHeader_(sh)) hdr = sheetHeader_(sh);
  }

  // 시트에 없는 컬럼만 "뒤에" 추가 — 기존 열 순서·데이터는 절대 건드리지 않음
  var missing = HEADERS.filter(function (h) { return hdr.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

// 데이터가 새 순서인지 확인한 뒤에만 헤더 이름을 되돌린다.
// (구버전 배포가 헤더를 옛 이름으로 덮어쓰는 사고를 스스로 회복하기 위함)
function autoRepairHeader_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  // 새 순서라면 8번째 열은 '상태'(활성/휴면), 옛 순서라면 '소통채널'(카카오톡…/어드민)
  var probe = sh.getRange(2, 8, Math.min(30, last - 1), 1).getValues();
  var newHits = 0, oldHits = 0;
  probe.forEach(function (r) {
    var v = String(r[0] || '').trim();
    if (v === '활성' || v === '휴면' || v === '보류') newHits++;
    else if (v.indexOf('카카오') >= 0 || v === '어드민') oldHits++;
  });
  if (newHits === 0 || oldHits > newHits) return false;  // 애매하면 손대지 않음

  var lastCol = sh.getLastColumn();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (lastCol > HEADERS.length) {
    sh.getRange(1, HEADERS.length + 1, 1, lastCol - HEADERS.length).clearContent();
  }
  sh.setFrozenRows(1);
  return true;
}

// 시트 1행(헤더) 배열
function sheetHeader_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
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
  var rec = findUser_(u.id);
  u.name = rec ? (rec.이름 || u.id) : u.id;
  if (rec && rec.권한) u.role = rec.권한;   // 시트의 최신 권한을 신뢰 (토큰 발급 후 변경 대비)
  return u;
}
// 어드민 전용 작업 (계정 추가·삭제·타인 비밀번호 초기화)
function requireAdmin_(token) {
  var u = requireAuth_(token);
  if (String(u.role) !== 'admin') throw new Error('관리자 권한이 필요합니다. (스태프 계정은 본인 비밀번호만 변경할 수 있습니다)');
  return u;
}

/* ------------------------- 변경로그 ------------------------- */
// 로그 기록은 본 작업을 방해하면 안 되므로 실패해도 조용히 무시
function log_(user, action, target, detail) {
  try {
    logSheet_().appendRow([
      new Date(),
      (user && user.id) || '',
      (user && user.name) || '',
      action || '',
      target || '',
      detail || ''
    ]);
  } catch (e) {}
}

// 이번 주(월요일 00:00 ~ 현재) 시작 시각
function weekStart_() {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, LOG_TZ, 'u'));      // 1=월 … 7=일
  var ymd = Utilities.formatDate(now, LOG_TZ, 'yyyy/MM/dd');
  var midnight = new Date(ymd + ' 00:00:00');
  return new Date(midnight.getTime() - (dow - 1) * 86400000);
}

// 이번 주 로그만 최신순으로 반환 (전체 스캔 방지 위해 최근 3000행만 확인)
function readLogs_() {
  var sh = logSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - 2999);
  var v = sh.getRange(from, 1, last - from + 1, LOG_HEADERS.length).getValues();
  var since = weekStart_();
  var out = [];
  for (var i = v.length - 1; i >= 0; i--) {
    var t = (v[i][0] instanceof Date) ? v[i][0] : new Date(v[i][0]);
    if (isNaN(t.getTime())) continue;
    if (t < since) break;   // 시간순 정렬이므로 이번 주 이전을 만나면 종료
    out.push({
      일시: Utilities.formatDate(t, LOG_TZ, 'MM/dd(E) HH:mm'),
      아이디: String(v[i][1] || ''),
      이름: String(v[i][2] || ''),
      작업: String(v[i][3] || ''),
      대상: String(v[i][4] || ''),
      상세: String(v[i][5] || '')
    });
  }
  return out;
}

/* ------------------------- 비밀번호 ------------------------- */
// 본인 비밀번호 변경 (스태프·어드민 모두 가능)
function changeMyPw_(user, oldPw, newPw) {
  var u = findUser_(user.id);
  if (!u) return { ok: false, error: '계정을 찾을 수 없습니다.' };
  if (u.비번해시 !== hashPw_(user.id, oldPw)) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
  if (String(newPw || '').length < 4) return { ok: false, error: '새 비밀번호는 4자 이상이어야 합니다.' };
  var sh = userSheet_(); var last = sh.getLastRow();
  var v = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() === user.id) {
      sh.getRange(i + 2, 2).setValue(hashPw_(user.id, newPw));
      log_(user, '비밀번호변경', user.id, '본인 비밀번호 변경');
      return { ok: true };
    }
  }
  return { ok: false, error: '계정을 찾을 수 없습니다.' };
}

// 타인 비밀번호 초기화 (어드민 전용)
function resetPw_(admin, targetId, newPw) {
  targetId = String(targetId || '').trim();
  if (!findUser_(targetId)) return { ok: false, error: '없는 아이디입니다.' };
  if (String(newPw || '').length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  var sh = userSheet_(); var last = sh.getLastRow();
  var v = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() === targetId) {
      sh.getRange(i + 2, 2).setValue(hashPw_(targetId, newPw));
      log_(admin, '비밀번호초기화', targetId, '관리자가 비밀번호 재설정');
      return { ok: true };
    }
  }
  return { ok: false, error: '없는 아이디입니다.' };
}

/* ------------------------- 데이터 ------------------------- */
function readAll_() {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var hdr = sheetHeader_(sh);
  var values = sh.getRange(2, 1, last - 1, hdr.length).getValues();
  var idIdx = hdr.indexOf('id');
  return values.filter(function (r) {
    return String(idIdx >= 0 ? r[idIdx] : r[0]).trim() !== '';
  }).map(function (r) {
    var o = {}; hdr.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o;
  });
}
// 시트 헤더 순서에 맞춰 한 행을 만든다 (컬럼 이름 기준이므로 순서가 바뀌어도 안전)
function rowFromObj_(o, hdr) {
  return hdr.map(function (h) {
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
    if (action === 'ping') return json_({ ok: true, ver: CODE_VERSION, sheet: SHEET_NAME, hasUsers: readUsers_().length > 0 }, cb);
    if (action === 'hasUsers') return json_({ ok: true, hasUsers: readUsers_().length > 0 }, cb);
    if (action === 'list') { requireAuth_(p.token); var lst = readAll_(); return json_({ ok: true, ver: CODE_VERSION, count: lst.length, companies: lst }, cb); }
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
    if (action === 'list') { requireAuth_(body.token); return json_({ ok: true, ver: CODE_VERSION, companies: readAll_() }); }
    if (action === 'upsert') { var uU = requireAuth_(body.token); return json_(upsert_(body.company, uU)); }
    if (action === 'delete') { var uD = requireAuth_(body.token); return json_(remove_(body.id, uD)); }
    if (action === 'bulkImport') { var uB = requireAuth_(body.token); return json_(bulkImport_(body.companies, body.replace, uB)); }
    if (action === 'merge') { var uM = requireAuth_(body.token); var sm = 병합실행(); log_(uM, '②③병합', '전체', sm); return json_({ ok: true, summary: sm }); }
    if (action === 'bulkUpsert') { var uBU = requireAuth_(body.token); return json_(bulkUpsert_(body.companies, uBU)); }
    if (action === 'logs') { requireAuth_(body.token); return json_({ ok: true, logs: readLogs_() }); }
    if (action === 'listUsers') { var uL = requireAuth_(body.token); return json_({ ok: true, users: usersPublic_(), me: uL.id, role: uL.role }); }
    if (action === 'changeMyPw') { var uP = requireAuth_(body.token); return json_(changeMyPw_(uP, body.oldPw, body.newPw)); }
    // 어드민 전용
    if (action === 'createUser') { var uC = requireAdmin_(body.token); var rc = createUser_(body.id, body.pw, body.name, body.role); if (rc.ok) log_(uC, '계정추가', body.id, '권한: ' + (body.role || 'staff')); return json_(rc); }
    if (action === 'deleteUser') { var uX = requireAdmin_(body.token); var rd = deleteUser_(body.id); if (rd.ok) log_(uX, '계정삭제', body.id, ''); return json_(rd); }
    if (action === 'resetPw') { var uR = requireAdmin_(body.token); return json_(resetPw_(uR, body.id, body.pw)); }
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

/* ------------------------- 액션 ------------------------- */
function upsert_(company, user) {
  if (!company) return { ok: false, error: 'no company' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = dataSheet_(); var rows = readAll_(); company['수정일시'] = new Date();
    if (company.id) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].id) === String(company.id)) {
          var before = rows[i];
          var diffs = [];
          for (var f in company) {
            if (f === 'id' || f === '수정일시') continue;
            var ov = before[f] === undefined || before[f] === null ? '' : String(before[f]);
            var nv = company[f] === undefined || company[f] === null ? '' : String(company[f]);
            if (ov !== nv) diffs.push(f + ': ' + (ov || '(없음)') + ' → ' + (nv || '(없음)'));
          }
          var merged = before; for (var k in company) merged[k] = company[k];
          var hdrU = sheetHeader_(sh);
          sh.getRange(i + 2, 1, 1, hdrU.length).setValues([rowFromObj_(merged, hdrU)]);
          if (diffs.length) log_(user, '수정', merged['업체명'] || ('id ' + merged.id), diffs.join(' | '));
          return { ok: true, mode: 'update', company: merged };
        }
      }
    }
    company.id = nextId_(rows);
    if (!company['등록일']) company['등록일'] = new Date();
    sh.appendRow(rowFromObj_(company, sheetHeader_(sh)));
    log_(user, '신규등록', company['업체명'] || ('id ' + company.id), '소속: ' + (company['소속원문'] || '') + ' · 구분: ' + (company['업체구분'] || ''));
    return { ok: true, mode: 'insert', company: company };
  } finally { lock.releaseLock(); }
}
// 여러 업체를 id 기준으로 한 번에 부분 갱신 (개통리스트 현행화용)
function bulkUpsert_(companies, user) {
  if (!companies || !companies.length) return { ok: false, error: 'no companies' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dataSheet_();
    var rows = readAll_();
    var byId = {};
    rows.forEach(function (r, i) { byId[String(r.id)] = i; });
    var now = new Date(); var updated = 0; var names = [];
    companies.forEach(function (c) {
      if (!c || c.id === undefined || c.id === '') return;
      var i = byId[String(c.id)];
      if (i === undefined) return;
      var note = rows[i]['업체명'] || ('id ' + c.id);
      if (c['상태'] === '활성' && rows[i]['상태'] === '휴면') note += '(휴면→활성)';
      else if (c['기호'] !== undefined && String(c['기호']) !== String(rows[i]['기호'] || '')) note += '(' + (rows[i]['기호'] || '없음') + '→' + c['기호'] + ')';
      names.push(note);
      for (var k in c) { if (k !== 'id') rows[i][k] = c[k]; }
      rows[i]['수정일시'] = now;
      updated++;
    });
    var hdrB = sheetHeader_(sh);
    var out = rows.map(function (r) { return rowFromObj_(r, hdrB); });
    if (out.length) sh.getRange(2, 1, out.length, hdrB.length).setValues(out);
    if (updated) log_(user, '개통리스트 현행화', updated + '개 업체', names.slice(0, 40).join(', ') + (names.length > 40 ? ' 외 ' + (names.length - 40) + '개' : ''));
    return { ok: true, updated: updated };
  } finally { lock.releaseLock(); }
}

function remove_(id, user) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = dataSheet_(); var rows = readAll_();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) {
        var nm = rows[i]['업체명'] || ('id ' + id);
        sh.deleteRow(i + 2);
        log_(user, '삭제', nm, '소속: ' + (rows[i]['소속원문'] || ''));
        return { ok: true, deleted: id };
      }
    }
    return { ok: false, error: 'not found: ' + id };
  } finally { lock.releaseLock(); }
}
function bulkImport_(companies, replace, user) {
  if (!companies || !companies.length) return { ok: false, error: 'no companies' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dataSheet_();
    var hdrI = sheetHeader_(sh);
    if (replace) { var last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, hdrI.length).clearContent(); }
    var start = replace ? 1 : nextId_(readAll_()); var now = new Date();
    var out = companies.map(function (c, idx) {
      if (!c.id) c.id = start + idx;
      if (!c['등록일']) c['등록일'] = now;
      c['수정일시'] = now;
      return rowFromObj_(c, hdrI);
    });
    sh.getRange(sh.getLastRow() + 1, 1, out.length, hdrI.length).setValues(out);
    var nms = companies.map(function (c) { return c['업체명'] || ''; }).filter(String);
    log_(user, '개통리스트 신규등록', out.length + '개 업체', nms.slice(0, 40).join(', ') + (nms.length > 40 ? ' 외 ' + (nms.length - 40) + '개' : ''));
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
 * 일괄현행화 — 소속 원장(전체사원관리)으로 기호·마커를 한 번에 맞추기
 * ------------------------------------------------------------
 * 준비: 시트에 '현행화' 탭을 만들고 두 열을 붙여넣기
 *        A열 = 소 속 (예: ★정석네트웍스○)
 *        B열 = 사원명 (예: (X)정석네트웍스)   ← 마커용, 없으면 비워도 됨
 *
 *   1) 일괄현행화_미리보기()  → '현행화리포트' 탭에 바뀔 내용만 정리 (시트 변경 없음)
 *   2) 확인 후 일괄현행화_적용()
 *
 * 안전장치
 *   - 새 업체를 만들지 않는다 (매칭 안 되면 리포트에만 남김)
 *   - 상태(활성/휴면)를 절대 건드리지 않는다
 *   - 계산서·계약 정보를 건드리지 않는다
 *   - 바꾸는 값: 소속원문 · 기호 · 업체구분 · 인센티브 · 전달마커 · 웹접수 · 웹회신
 * ============================================================ */
var SYNC_SHEET = '현행화';
var SYNC_REPORT = '현행화리포트';

function 일괄현행화_미리보기() { return 일괄현행화_(false); }
function 일괄현행화_적용()   { return 일괄현행화_(true); }

// 이름 변형 (괄호 부가설명 차이 흡수)
function nameVariants_(s) {
  var base = normName_(s);
  if (!base) return [];
  var out = [base];
  var noParen = base.replace(/[\(（][^)）]*[\)）]/g, '');
  if (noParen && out.indexOf(noParen) < 0) out.push(noParen);
  var head = base.split(/[\(（]/)[0];
  if (head && out.indexOf(head) < 0) out.push(head);
  return out;
}
function markerOf_(s) {
  var m = String(s || '').match(/[\(（]\s*([oO○ＯxX×？?])\s*[\)）]/);
  if (!m) return '';
  var map = { o: 'O', O: 'O', '○': 'O', 'Ｏ': 'O', x: 'X', X: 'X', '×': 'X', '?': '?', '？': '?' };
  return map[m[1]] || '';
}
function classifyOf_(s) {
  s = String(s || '');
  if (s.charAt(0) === '●' || /^\d+\./.test(s)) return '자점';
  if (/^[■□]/.test(s)) return '판매점';
  if (/^[★☆◆◇]/.test(s)) return '협력점';
  return '';
}

function 일괄현행화_(apply) {
  var ss = ss_();
  var src = ss.getSheetByName(SYNC_SHEET);
  if (!src) throw new Error("'" + SYNC_SHEET + "' 탭이 없습니다. A열=소속, B열=사원명 을 붙여넣고 다시 실행하세요.");
  var last = src.getLastRow();
  if (last < 1) throw new Error("'" + SYNC_SHEET + "' 탭이 비어 있습니다.");
  var vals = src.getRange(1, 1, last, 2).getValues();

  // 같은 소속이 여러 줄(사원 여러 명)일 수 있으므로 마커를 모은다
  var order = [], rawBy = {}, mkBy = {};
  vals.forEach(function (r) {
    var raw = String(r[0] || '').trim();
    if (!raw) return;
    if (/^소\s*속$/.test(raw)) return;                 // 머리글 줄 건너뜀
    var k = normName_(raw);
    if (!k) return;
    if (!rawBy[k]) { rawBy[k] = raw; order.push(k); }
    if (!mkBy[k]) { var m = markerOf_(r[1]); if (m) mkBy[k] = m; }
  });

  var rows = readAll_();
  var byKey = {};
  rows.forEach(function (r) {
    nameVariants_(r['업체명']).concat(nameVariants_(r['소속원문'])).forEach(function (k) {
      if (k && !byKey[k]) byKey[k] = r;
    });
  });

  var report = [['유형', '시트 업체명', '기존 소속', '새 소속', '바뀌는 내용']];
  var changed = 0, same = 0, notFound = 0, own = 0;

  order.forEach(function (k) {
    var raw = rawBy[k];
    var g = classifyOf_(raw);
    if (g === '자점') { own++; return; }               // 자점 줄은 건드리지 않음

    var ex = null, vs = nameVariants_(raw);
    for (var i = 0; i < vs.length && !ex; i++) ex = byKey[vs[i]] || null;
    if (!ex) { notFound++; report.push(['매칭없음', '', '', raw, '시트에 없는 업체 — 아무 것도 하지 않음']); return; }

    // 판매점은 (X) 표기가 있을 때만 X, 그 외(O·?·표기없음)는 모두 O
    var mk = (g === '판매점') ? (mkBy[k] === 'X' ? 'X' : 'O') : (mkBy[k] || '');
    var sym = (String(raw).match(/^([■□★☆◆◇]+)/) || ['', ''])[1];
    var inc = /^[◆◇]/.test(raw) ? 'Y' : 'N';
    var web = (mk === 'X') ? 'Y' : 'N';                // X=직접 웹처리 Y/Y · 그 외 N/N

    var diffs = [];
    if (String(ex['소속원문'] || '').trim() !== raw) diffs.push('소속 ' + (ex['소속원문'] || '(없음)') + '→' + raw);
    if (String(ex['기호'] || '') !== sym) diffs.push('기호 ' + (ex['기호'] || '없음') + '→' + (sym || '없음'));
    if (String(ex['업체구분'] || '') !== g) diffs.push('구분 ' + (ex['업체구분'] || '?') + '→' + g);
    if (String(ex['인센티브'] || '') !== inc) diffs.push('인센티브 ' + (ex['인센티브'] || '') + '→' + inc);
    if (String(ex['전달마커'] || '') !== mk) diffs.push('마커 ' + (ex['전달마커'] || '없음') + '→' + (mk || '없음'));
    if (String(ex['웹접수'] || '') !== web) diffs.push('웹접수 ' + (ex['웹접수'] || '') + '→' + web);
    if (String(ex['웹회신'] || '') !== web) diffs.push('웹회신 ' + (ex['웹회신'] || '') + '→' + web);

    if (!diffs.length) { same++; return; }
    changed++;
    report.push(['변경', ex['업체명'], ex['소속원문'], raw, diffs.join(' | ')]);

    if (apply) {
      ex['소속원문'] = raw; ex['기호'] = sym; ex['업체구분'] = g;
      ex['인센티브'] = inc; ex['전달마커'] = mk;
      ex['웹접수'] = web; ex['웹회신'] = web;
      ex['수정일시'] = new Date();
      // 상태·계산서·계약은 건드리지 않음
    }
  });

  if (apply && changed) {
    var sh = dataSheet_();
    var hdr = sheetHeader_(sh);
    var out = rows.map(function (r) { return rowFromObj_(r, hdr); });
    sh.getRange(2, 1, out.length, hdr.length).setValues(out);
    log_({ id: 'system', name: '일괄현행화' }, '일괄현행화', changed + '개 업체', '소속·기호·구분·마커·웹접수/웹회신 갱신');
  }

  var rep = ss.getSheetByName(SYNC_REPORT) || ss.insertSheet(SYNC_REPORT);
  rep.clearContents();
  var head = [[(apply ? '■ 적용 완료' : '■ 미리보기 (시트 변경 없음)') + ' · ' +
    Utilities.formatDate(new Date(), LOG_TZ, 'yyyy-MM-dd HH:mm'), '', '', '', '']];
  rep.getRange(1, 1, 1, 5).setValues(head);
  rep.getRange(2, 1, report.length, 5).setValues(report);
  rep.setFrozenRows(2);

  var msg = (apply ? '적용 완료' : '미리보기 완료(변경 없음)') +
    ' · 변경 대상 ' + changed + '개 · 이미 동일 ' + same + '개 · 시트에 없음 ' + notFound + '개 · 자점 건너뜀 ' + own + '개\n' +
    "'" + SYNC_REPORT + "' 탭에서 상세 내역을 확인하세요." +
    (apply ? '' : '\n확인 후 [일괄현행화_적용] 을 실행하면 반영됩니다.');
  Logger.log(msg);
  return msg;
}

/* ============================================================
 * 계약복구() — 위탁판매/개인정보 값 되살리기
 * ------------------------------------------------------------
 * 시트정리() 실행 시점에 헤더가 아직 옛 이름(계약서1/계약서2)이면
 * 새 이름(위탁판매/개인정보)으로 값을 찾지 못해 빈칸이 됩니다.
 * ① 업체관리_백업_* 탭에서 id로 정확히 복구하고,
 * ② 그래도 빈 곳은 ③전자계약서 원본에서 업체명으로 채웁니다.
 * 이미 값이 있는 칸은 건드리지 않습니다.
 * ============================================================ */
function 계약복구() {
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    var sh = dataSheet_();
    var rows = readAll_();
    var fromBackup = 0, fromSource = 0, bkName = '(없음)';

    // 1) 백업 탭에서 id 기준 복구
    var backups = ss_().getSheets().filter(function (s) {
      return s.getName().indexOf(SHEET_NAME + '_백업_') === 0;
    });
    if (backups.length) {
      backups.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; }); // 최신 백업 우선
      var bk = backups[0];
      bkName = bk.getName();
      var bhdr = sheetHeader_(bk);
      var blast = bk.getLastRow();
      if (blast > 1) {
        var bvals = bk.getRange(2, 1, blast - 1, bhdr.length).getValues();
        var byId = {};
        bvals.forEach(function (r) {
          var o = {}; bhdr.forEach(function (h, i) { if (h) o[h] = r[i]; });
          if (o.id !== undefined && String(o.id).trim() !== '') byId[String(o.id)] = o;
        });
        rows.forEach(function (r) {
          var b = byId[String(r.id)];
          if (!b) return;
          var wt = pick_(b['위탁판매'], b['계약서1']);
          var pi = pick_(b['개인정보'], b['계약서2']);
          var did = false;
          if (String(r['위탁판매'] || '') === '' && wt !== '') { r['위탁판매'] = wt; did = true; }
          if (String(r['개인정보'] || '') === '' && pi !== '') { r['개인정보'] = pi; did = true; }
          if (did) fromBackup++;
        });
      }
    }

    // 2) 아직 빈 곳은 ③ 전자계약서 원본에서 업체명으로 복구
    var con = readSrc_(SRC_CONTRACT, ['name', 'c1']);
    if (con.rows.length) {
      var byName = {};
      con.rows.forEach(function (r) {
        var k = normName_(r['name']);
        if (k && !byName[k]) byName[k] = r;
      });
      rows.forEach(function (r) {
        if (String(r['위탁판매'] || '') !== '') return;
        var src = byName[normName_(r['업체명'])] || byName[normName_(r['소속원문'])];
        if (!src) return;
        r['위탁판매'] = toYN_(src['c1']) || 'N';
        r['개인정보'] = toYN_(src['c2']) || 'N';
        if (String(r['사업자등록증'] || '') === '') r['사업자등록증'] = toYN_(src['bizDoc']) || 'N';
        if (String(r['계약제외'] || '') === '') r['계약제외'] = toYN_(src['excluded']) || 'N';
        if (String(r['계약비고'] || '') === '') r['계약비고'] = String(src['note'] || '');
        fromSource++;
      });
    }

    var hdr = sheetHeader_(sh);
    var out = rows.map(function (r) { return rowFromObj_(r, hdr); });
    if (out.length) sh.getRange(2, 1, out.length, hdr.length).setValues(out);

    var msg = '계약 정보 복구 완료\n'
      + ' · 백업 탭(' + bkName + ')에서 복구: ' + fromBackup + '개\n'
      + ' · ③전자계약서 원본에서 복구: ' + fromSource + '개\n'
      + ' · 총 업체: ' + rows.length + '개';
    Logger.log(msg);
    return msg;
  } finally { lock.releaseLock(); }
}
function pick_(a, b) {
  if (a !== undefined && String(a).trim() !== '') return String(a).trim();
  if (b !== undefined && String(b).trim() !== '') return String(b).trim();
  return '';
}

/* ============================================================
 * 헤더복구() — 구버전 배포가 헤더 행을 옛 이름으로 덮어썼을 때 복구
 * ------------------------------------------------------------
 * 데이터 행은 그대로 두고 1행(헤더)만 올바른 이름으로 되돌립니다.
 * 먼저 데이터가 어떤 순서인지 진단한 뒤, 새 순서일 때만 복구합니다.
 * ============================================================ */
function 헤더복구() {
  var sh = ss_().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error(SHEET_NAME + ' 탭이 없습니다.');
  var last = sh.getLastRow();
  if (last < 2) throw new Error('데이터가 없습니다.');

  // 8번째 열 값으로 데이터 순서 판별
  //  · 새 순서(정리 후) → 8번째는 '상태'   : 활성 / 휴면
  //  · 옛 순서          → 8번째는 '소통채널': 카카오톡… / 어드민
  var probe = sh.getRange(2, 8, Math.min(30, last - 1), 1).getValues();
  var newHits = 0, oldHits = 0;
  probe.forEach(function (r) {
    var v = String(r[0] || '').trim();
    if (v === '활성' || v === '휴면' || v === '보류') newHits++;
    else if (v.indexOf('카카오') >= 0 || v === '어드민') oldHits++;
  });

  if (oldHits > newHits) {
    var m1 = '데이터가 아직 "옛 순서"입니다. 헤더복구 대신 [시트정리]를 실행하세요.\n'
      + '(8번째 열 진단: 옛 순서 ' + oldHits + '건 / 새 순서 ' + newHits + '건)';
    Logger.log(m1); return m1;
  }
  if (newHits === 0) {
    var m2 = '데이터 순서를 판별하지 못했습니다. 시트를 직접 확인해 주세요.\n'
      + '8번째 열이 상태(활성/휴면)여야 정상입니다.';
    Logger.log(m2); return m2;
  }

  // 1행을 올바른 헤더로 되돌리고, 남아 있는 옛 헤더 잔여 칸은 비움
  var lastCol = sh.getLastColumn();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (lastCol > HEADERS.length) {
    sh.getRange(1, HEADERS.length + 1, 1, lastCol - HEADERS.length).clearContent();
  }
  sh.setFrozenRows(1);

  var msg = '헤더 복구 완료 · 컬럼 ' + HEADERS.length + '개 (데이터 ' + (last - 1) + '행은 그대로)\n'
    + '이제 반드시 [배포 → 배포 관리 → 새 버전]으로 최신 코드를 배포하세요. '
    + '구버전이 배포된 상태면 헤더가 다시 망가집니다.';
  Logger.log(msg);
  return msg;
}

/* ============================================================
 * 시트정리() — 편집기에서 1회 실행
 * ------------------------------------------------------------
 * '업체관리' 탭을 앱이 실제로 쓰는 컬럼만 남겨 업무 순서대로 재정렬합니다.
 *  1. 실행 전 원본을 '업체관리_백업_날짜시각' 탭으로 복사 (되돌리기용)
 *  2. 옛 컬럼(웹활용·접수대행·유선/무선개통전달·회신전달·대표아이디 등) 제거
 *     — 단, 웹접수/웹회신이 비어 있으면 옛 값에서 만들어 채운 뒤 제거하므로 정보 손실 없음
 *  3. 남은 컬럼을 HEADERS 순서로 재배치
 * 실행 후 시트에서 직접 일괄 수정하셔도 앱이 컬럼 "이름"으로 읽기 때문에 안전합니다.
 * ============================================================ */
function 시트정리() {
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    var ss = ss_();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) throw new Error(SHEET_NAME + ' 탭이 없습니다.');

    var hdr = sheetHeader_(sh);
    var last = sh.getLastRow();
    var values = last > 1 ? sh.getRange(2, 1, last - 1, hdr.length).getValues() : [];

    // 1) 백업
    var stamp = Utilities.formatDate(new Date(), LOG_TZ, 'yyyyMMdd_HHmm');
    var backupName = SHEET_NAME + '_백업_' + stamp;
    sh.copyTo(ss).setName(backupName);

    // 2) 행 → 객체 (이름 기준) + 옛 이름으로 저장된 값 이어받기
    var idIdx = hdr.indexOf('id');
    var rows = [];
    values.forEach(function (r) {
      if (String(idIdx >= 0 ? r[idIdx] : r[0]).trim() === '') return;
      var o = {};
      hdr.forEach(function (h, i) { if (h) o[h] = r[i]; });
      // 컬럼 이름이 바뀐 항목은 옛 이름 값을 새 이름으로 옮긴다 (값 유실 방지)
      for (var nw in RENAMED_COLS) {
        if (String(o[nw] || '') === '' && String(o[RENAMED_COLS[nw]] || '') !== '') {
          o[nw] = o[RENAMED_COLS[nw]];
        }
      }
      rows.push(o);
    });

    // 3) 옛 값 → 새 항목으로 이전 (웹접수/웹회신)
    var filled = 0;
    rows.forEach(function (o) {
      if (String(o['웹접수'] || '') !== '' && String(o['웹회신'] || '') !== '') return;
      var mk = String(o['전달마커'] || '').trim();
      var web = String(o['웹활용'] || '').trim();
      var v;
      if (mk === 'X') v = 'Y';              // 마커 X = 업체가 직접 웹 처리
      else if (mk === 'O') v = 'N';         // 마커 O = 대신 전달
      else v = (web === 'Y') ? 'Y' : 'N';   // 마커 없으면 옛 웹활용 값 기준
      if (String(o['웹접수'] || '') === '') o['웹접수'] = v;
      if (String(o['웹회신'] || '') === '') o['웹회신'] = v;
      filled++;
    });

    // 4) 새 헤더로 다시 쓰기 (열 전체 초기화 후 재작성)
    sh.clear();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    if (rows.length) {
      var out = rows.map(function (o) { return rowFromObj_(o, HEADERS); });
      sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);
    }
    sh.setFrozenRows(1);

    var removed = hdr.filter(function (h) { return h && HEADERS.indexOf(h) < 0; });
    var msg = '시트 정리 완료 · 업체 ' + rows.length + '개 · 컬럼 ' + HEADERS.length + '개\n'
      + '제거된 옛 컬럼(' + removed.length + '): ' + (removed.join(', ') || '없음') + '\n'
      + '웹접수/웹회신 자동 채움: ' + filled + '건\n'
      + '백업 탭: ' + backupName;
    Logger.log(msg);
    return msg;
  } finally { lock.releaseLock(); }
}

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
      } else if (e['위탁판매'] !== '' && e['위탁판매'] !== undefined) {
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
      e['위탁판매'] = toYN_(r['c1']) || 'N';
      e['개인정보'] = toYN_(r['c2']) || 'N';
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
    var hdrM = sheetHeader_(sh);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, hdrM.length).clearContent();
    var out = rows.map(function (r) { return rowFromObj_(r, hdrM); });
    sh.getRange(2, 1, out.length, hdrM.length).setValues(out);

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
      (r['위탁판매'] === 'Y' ? '계약O' : (r['위탁판매'] ? '계약X' : '계약정보없음'))]);
  });
  sh.getRange(1, 1, out.length, 3).setValues(out);
  sh.setFrozenRows(1);
}
