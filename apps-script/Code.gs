/**
 * 협력점 관리앱 - Google Sheets 데이터 API (Apps Script)
 * ------------------------------------------------------------
 * 역할: GitHub Pages 에 올라간 정적 HTML(프론트엔드)이 호출하는 얇은 JSON API.
 *       실제 데이터는 아래 SPREADSHEET_ID 의 구글시트(업체관리 탭)에 저장된다.
 *
 * 배포:
 *   1) 이 스크립트를 대상 구글시트에 바인딩하거나(확장프로그램>Apps Script) 독립 스크립트로 붙여넣기
 *   2) 시트 메뉴 [협력점관리]>[초기 세팅] 실행 (또는 setup() 직접 실행) -> 업체관리 탭 생성
 *   3) 배포 > 새 배포 > 유형: 웹 앱
 *        - 실행: 나(소유자)
 *        - 액세스: 모든 사용자(익명 포함)  ← GitHub 정적페이지에서 호출하려면 필요
 *   4) 나온 웹앱 URL 을 프론트엔드 assets/config.js 의 API_URL 에 붙여넣기
 *
 * 보안: WRITE_TOKEN 을 비워두지 않으면 쓰기(upsert/delete/bulkImport) 시 토큰 검사.
 *       config.js 의 WRITE_TOKEN 과 동일하게 맞춘다. (공개 배포시 최소한의 보호)
 */

var SPREADSHEET_ID = '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc';
var SHEET_NAME = '업체관리';
var WRITE_TOKEN = ''; // 예: 'w-network-2026' 로 설정하고 config.js 와 동일하게

var HEADERS = [
  'id', '소속원문', '업체명', '기호', '업체구분', '인센티브', '전달마커',
  '소통채널', '웹활용', '직접접수', '접수대행', '유선접수전달', '유선개통전달',
  '무선개통전달', '회신전달', '계정수', '대표아이디', '연락처', '상태', '비고', '수정일시'
];

/* ------------------------- 공통 ------------------------- */

function ss_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj, callback) {
  var out = JSON.stringify(obj);
  if (callback) { // JSONP (읽기 크로스오리진 대비)
    return ContentService.createTextOutput(callback + '(' + out + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(out)
    .setMimeType(ContentService.MimeType.JSON);
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      var o = {};
      HEADERS.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function rowFromObj_(o) {
  return HEADERS.map(function (h) {
    if (h === '수정일시') return o[h] || new Date();
    return (o[h] === undefined || o[h] === null) ? '' : o[h];
  });
}

function nextId_(rows) {
  var max = 0;
  rows.forEach(function (r) { var n = Number(r.id) || 0; if (n > max) max = n; });
  return max + 1;
}

function checkToken_(token) {
  if (!WRITE_TOKEN) return true;
  return String(token || '') === WRITE_TOKEN;
}

/* ------------------------- HTTP ------------------------- */

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};
  var cb = p.callback;
  try {
    var action = p.action || 'list';
    if (action === 'list') {
      return json_({ ok: true, count: readAll_().length, companies: readAll_() }, cb);
    }
    if (action === 'ping') {
      return json_({ ok: true, sheet: SHEET_NAME, headers: HEADERS }, cb);
    }
    return json_({ ok: false, error: 'unknown action: ' + action }, cb);
  } catch (err) {
    return json_({ ok: false, error: String(err) }, cb);
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  var action = body.action || '';
  try {
    if (['upsert', 'delete', 'bulkImport'].indexOf(action) >= 0 && !checkToken_(body.token)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (action === 'list') return json_({ ok: true, companies: readAll_() });
    if (action === 'upsert') return json_(upsert_(body.company));
    if (action === 'delete') return json_(remove_(body.id));
    if (action === 'bulkImport') return json_(bulkImport_(body.companies, body.replace));
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------- 액션 ------------------------- */

function upsert_(company) {
  if (!company) return { ok: false, error: 'no company' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_();
    var rows = readAll_();
    company['수정일시'] = new Date();
    if (company.id) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].id) === String(company.id)) {
          var merged = rows[i];
          for (var k in company) merged[k] = company[k];
          sh.getRange(i + 2, 1, 1, HEADERS.length).setValues([rowFromObj_(merged)]);
          return { ok: true, mode: 'update', company: merged };
        }
      }
    }
    company.id = nextId_(rows);
    sh.appendRow(rowFromObj_(company));
    return { ok: true, mode: 'insert', company: company };
  } finally {
    lock.releaseLock();
  }
}

function remove_(id) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_();
    var rows = readAll_();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) {
        sh.deleteRow(i + 2);
        return { ok: true, deleted: id };
      }
    }
    return { ok: false, error: 'not found: ' + id };
  } finally {
    lock.releaseLock();
  }
}

function bulkImport_(companies, replace) {
  if (!companies || !companies.length) return { ok: false, error: 'no companies' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = sheet_();
    if (replace) {
      var last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
    }
    var start = replace ? 1 : nextId_(readAll_());
    var now = new Date();
    var out = companies.map(function (c, idx) {
      if (!c.id) c.id = start + idx;
      c['수정일시'] = now;
      return rowFromObj_(c);
    });
    sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.length).setValues(out);
    return { ok: true, imported: out.length };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------- 세팅/메뉴 ------------------------- */

function setup() {
  var sh = sheet_();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, HEADERS.length);
  return 'ok: ' + SHEET_NAME + ' 준비 완료';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('협력점관리')
    .addItem('초기 세팅(업체관리 탭 생성)', 'setup')
    .addToUi();
}
