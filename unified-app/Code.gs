/**
 * 업체 통합 마스터 — Code.gs
 *
 * ① 협력점 관리  ② 업체별 계산서방식  ③ 전자계약서
 * 세 구글시트를 자동 병합해 "마스터" 시트를 만들고,
 * 웹앱(HtmlService)으로 조회/검색/수정하는 통합 관리 도구.
 *
 * 사용법 (스프레드시트에 바인딩):
 *  1. 새 구글 스프레드시트 생성 → 확장 프로그램 → Apps Script
 *  2. 이 파일(Code.gs)과 Index.html 붙여넣기 → 저장
 *  3. 시트로 돌아가 새로고침 → 상단 메뉴 [통합관리] → [1. 소스 3개 병합 실행]
 *  4. 배포 → 웹 앱 배포 (액세스: 조직/링크 소유 계정)
 */

// ───────────────────────── 소스 시트 ID ─────────────────────────
var SRC = {
  BASE:     '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc', // ① 협력점 관리
  INVOICE:  '1Ts6tRFJyeQln3z5Rt6Gr9OMpk6TL8gMTUseRyMlBx80', // ② 업체별 계산서방식
  CONTRACT: '1L7S98jOys3DS0KtP068Bmyfbif6kseuUE1prdq-Gutw'  // ③ 전자계약서
};

var MASTER_SHEET = '마스터';
var REPORT_SHEET = '병합리포트';
var TZ = 'Asia/Seoul';

// 마스터 시트 컬럼 정의 (순서 = 시트 열 순서)
var COLS = [
  'id', '기호', '업체명', '업체구분', '법인', '상태',
  '대표자', '연락처', '소통채널', '대표아이디', '계정수',
  '웹활용', '직접접수', '접수대행', '유선접수전달', '유선개통전달', '무선개통전달', '회신전달',
  '인센티브', '전달마커',
  '계산서형태', '수신방법', '계산서비고',
  '계약서1', '계약서2', '사업자등록증', '계약제외', '계약비고',
  '비고', '출처', '수정일시'
];

// ───────────────────────── 메뉴 ─────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('통합관리')
    .addItem('1. 소스 3개 병합 실행 (마스터 재생성)', 'runMerge')
    .addItem('2. 병합리포트 시트 열기 안내', 'showReportHint')
    .addToUi();
}

function showReportHint() {
  SpreadsheetApp.getUi().alert('하단 탭에서 "' + REPORT_SHEET + '" 시트를 확인하세요.\n어떤 업체가 ①②③ 중 어디에 있는지, 신규/중복 의심 항목이 정리되어 있습니다.');
}

// ───────────────────────── 유틸 ─────────────────────────
function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

// 이름 정규화: 기호/마커/공백 제거 + 알려진 옛이름 치환
function normName_(s) {
  if (!s) return '';
  s = String(s).replace(/[■□★☆◆◇○●◎]/g, '').replace(/\s+/g, '').trim().toLowerCase();
  var alias = {
    'show예산': '쇼예산',
    '천안모바일': '누네띠네중고폰'
  };
  return alias[s] || s;
}

// 이름 앞의 기호 추출 (■, ■■, ★★ 등)
function symbolOf_(s) {
  if (!s) return '';
  var m = String(s).trim().match(/^([■□★☆◆◇]+)/);
  return m ? m[1] : '';
}

// 기호 → 업체구분 추정
function groupOfSymbol_(sym) {
  if (/^■/.test(sym)) return '판매점';
  if (/^★/.test(sym)) return '협력점';
  if (/^[☆◆◇□]/.test(sym)) return '기타';
  return '';
}

function toYN_(v) {
  if (v === true || v === 'TRUE' || v === 'true' || v === 'Y' || v === 'y') return 'Y';
  if (v === false || v === 'FALSE' || v === 'false' || v === 'N' || v === 'n') return 'N';
  return v ? String(v) : '';
}

// 소스 시트 읽기 → [{헤더:값}] 배열
function readSource_(fileId) {
  var sh = SpreadsheetApp.openById(fileId).getSheets()[0];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var isEmpty = row.every(function (c) { return c === '' || c === null; });
    if (isEmpty) continue;
    var obj = {};
    header.forEach(function (h, j) { if (h) obj[h] = row[j]; });
    rows.push(obj);
  }
  return rows;
}

// ───────────────────────── 병합 엔진 ─────────────────────────
function runMerge() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var master = ss.getSheetByName(MASTER_SHEET);
  if (master && master.getLastRow() > 1) {
    var res = ui.alert('경고',
      '마스터 시트에 이미 데이터가 있습니다.\n병합을 다시 실행하면 마스터가 초기화되고 수기 수정 내용이 사라집니다.\n계속할까요?',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  }

  var base = readSource_(SRC.BASE);       // ①
  var invoice = readSource_(SRC.INVOICE); // ②
  var contract = readSource_(SRC.CONTRACT); // ③

  var entries = [];      // 마스터 행 (객체)
  var byKey = {};        // normName → entry
  var report = [];       // [유형, 업체명, 상세]

  // 1) ① 협력점 관리 → 기본 골격
  base.forEach(function (r) {
    var name = String(r['업체명'] || '').trim();
    if (!name) return;
    var e = emptyEntry_();
    e['기호'] = String(r['기호'] || '');
    e['업체명'] = name;
    e['업체구분'] = String(r['업체구분'] || '');
    e['상태'] = String(r['상태'] || '활성');
    e['연락처'] = String(r['연락처'] || '');
    e['소통채널'] = String(r['소통채널'] || '');
    e['대표아이디'] = String(r['대표아이디'] || '');
    e['계정수'] = r['계정수'] || '';
    ['웹활용','직접접수','접수대행','유선접수전달','유선개통전달','무선개통전달','회신전달'].forEach(function (k) {
      e[k] = toYN_(r[k]);
    });
    e['인센티브'] = toYN_(r['인센티브']);
    e['전달마커'] = String(r['전달마커'] || '');
    e['비고'] = String(r['비고'] || '');
    e['출처'] = '①';
    var key = normName_(name);
    if (byKey[key]) {
      report.push(['중복의심', name, '①에 같은 이름이 2회 이상 등장 — 첫 행만 유지, 이 행은 건너뜀']);
      return;
    }
    byKey[key] = e;
    entries.push(e);
  });

  // 2) ② 계산서방식 병합
  invoice.forEach(function (r) {
    var name = String(r['협력점명'] || '').trim();
    if (!name) return;
    var key = normName_(name);
    var e = byKey[key];
    if (!e) {
      // ①에 없는 업체 → 신규 행 생성 (지점별 개별 업체 포함)
      e = emptyEntry_();
      var sym = String(r['법인기호'] || '').trim();
      e['기호'] = sym;
      e['업체명'] = name;
      e['업체구분'] = groupOfSymbol_(sym);
      e['상태'] = '활성';
      e['출처'] = '②';
      byKey[key] = e;
      entries.push(e);
      report.push(['신규추가(②)', name, '①협력점관리에 없어 새로 추가됨 — 구분 확인 필요']);
    } else if (e['계산서형태']) {
      report.push(['중복의심', name, '②에 같은 이름이 2회 이상 등장 — 첫 행 값 유지']);
      return;
    }
    e['계산서형태'] = String(r['계산서형태'] || '');
    e['수신방법'] = String(r['수신방법'] || '');
    e['계산서비고'] = String(r['비고'] || '');
    if (!e['법인']) e['법인'] = String(r['법인'] || '');
    if (e['출처'].indexOf('②') < 0) e['출처'] += '②';
  });

  // 3) ③ 전자계약서 병합
  contract.forEach(function (r) {
    var raw = String(r['name'] || '').trim();
    if (!raw) return;
    var key = normName_(raw);
    var e = byKey[key];
    if (!e) {
      e = emptyEntry_();
      var sym = symbolOf_(raw);
      e['기호'] = sym;
      e['업체명'] = raw.replace(/[○●◎]/g, '').replace(/^[■□★☆◆◇]+/, '').trim();
      e['업체구분'] = groupOfSymbol_(sym);
      e['상태'] = '활성';
      e['출처'] = '③';
      byKey[key] = e;
      entries.push(e);
      report.push(['신규추가(③)', e['업체명'], '①협력점관리에 없어 새로 추가됨 — 구분 확인 필요']);
    } else if (e['계약서1'] !== '') {
      report.push(['중복의심', raw, '③에 같은 이름이 2회 이상 등장(예: 김용균) — 첫 행 값 유지']);
      return;
    }
    if (!e['대표자']) e['대표자'] = String(r['rep'] || '');
    var phone = String(r['phone'] || '').trim();
    if (phone) {
      if (!e['연락처']) {
        e['연락처'] = phone;
      } else if (e['연락처'].replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
        report.push(['연락처상이', e['업체명'], '①: ' + e['연락처'] + ' / ③: ' + phone + ' — 어느 쪽이 최신인지 확인']);
      }
    }
    e['계약서1'] = toYN_(r['c1']) || 'N';
    e['계약서2'] = toYN_(r['c2']) || 'N';
    e['사업자등록증'] = toYN_(r['bizDoc']) || 'N';
    e['계약제외'] = toYN_(r['excluded']) || 'N';
    e['계약비고'] = String(r['note'] || '');
    if (e['출처'].indexOf('③') < 0) e['출처'] += '③';
  });

  // 4) id 부여 + 시트 기록
  var ts = now_();
  entries.forEach(function (e, i) { e['id'] = i + 1; e['수정일시'] = ts; });

  if (!master) master = ss.insertSheet(MASTER_SHEET);
  master.clearContents();
  var out = [COLS];
  entries.forEach(function (e) {
    out.push(COLS.map(function (c) { return e[c] !== undefined ? e[c] : ''; }));
  });
  master.getRange(1, 1, out.length, COLS.length).setValues(out);
  master.setFrozenRows(1);

  // 5) 리포트 시트
  writeReport_(ss, entries, report);

  ui.alert('병합 완료',
    '총 ' + entries.length + '개 업체가 마스터에 생성되었습니다.\n' +
    '"' + REPORT_SHEET + '" 시트에서 소스별 매칭 현황과 확인 필요 항목을 검토하세요.',
    ui.ButtonSet.OK);
}

function emptyEntry_() {
  var e = {};
  COLS.forEach(function (c) { e[c] = ''; });
  return e;
}

function writeReport_(ss, entries, issues) {
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) sh = ss.insertSheet(REPORT_SHEET);
  sh.clearContents();

  var c1 = 0, c2 = 0, c3 = 0, all3 = 0;
  entries.forEach(function (e) {
    var s = e['출처'];
    if (s.indexOf('①') >= 0) c1++;
    if (s.indexOf('②') >= 0) c2++;
    if (s.indexOf('③') >= 0) c3++;
    if (s.indexOf('①') >= 0 && s.indexOf('②') >= 0 && s.indexOf('③') >= 0) all3++;
  });

  var rows = [];
  rows.push(['■ 병합 요약', '', '']);
  rows.push(['총 업체 수', entries.length, '']);
  rows.push(['① 협력점관리 포함', c1, '']);
  rows.push(['② 계산서방식 포함', c2, '']);
  rows.push(['③ 전자계약서 포함', c3, '']);
  rows.push(['①②③ 모두 매칭', all3, '']);
  rows.push(['', '', '']);
  rows.push(['■ 확인 필요 항목', '', '']);
  rows.push(['유형', '업체명', '상세']);
  issues.forEach(function (r) { rows.push(r); });
  rows.push(['', '', '']);
  rows.push(['■ 업체별 소스 현황', '', '']);
  rows.push(['업체명', '출처', '계산서형태/계약 여부']);
  entries.forEach(function (e) {
    rows.push([e['업체명'], e['출처'],
      (e['계산서형태'] ? '계산서:' + e['계산서형태'] : '계산서없음') + ' / ' +
      (e['계약서1'] === 'Y' ? '계약O' : (e['계약서1'] === '' ? '계약정보없음' : '계약X'))]);
  });
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
}

// ───────────────────────── 웹앱 (HtmlService) ─────────────────────────
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('업체 통합 마스터')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getMaster_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(MASTER_SHEET);
  if (!sh) throw new Error('마스터 시트가 없습니다. 먼저 [통합관리 > 병합 실행]을 해주세요.');
  return sh;
}

// 전체 목록
function apiList() {
  var sh = getMaster_();
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = {};
    header.forEach(function (h, j) { o[h] = values[i][j]; });
    if (o['업체명']) rows.push(o);
  }
  return { columns: COLS, rows: rows };
}

// 저장 (id 있으면 수정, 없으면 신규)
function apiSave(rec) {
  if (!rec || !rec['업체명']) throw new Error('업체명은 필수입니다.');
  var sh = getMaster_();
  var values = sh.getDataRange().getValues();
  rec['수정일시'] = now_();

  if (rec['id']) {
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(rec['id'])) {
        var row = COLS.map(function (c) {
          return rec[c] !== undefined ? rec[c] : values[i][COLS.indexOf(c)];
        });
        sh.getRange(i + 1, 1, 1, COLS.length).setValues([row]);
        return { ok: true, id: rec['id'] };
      }
    }
    throw new Error('id ' + rec['id'] + ' 행을 찾지 못했습니다.');
  }

  var maxId = 0;
  for (var k = 1; k < values.length; k++) {
    var n = Number(values[k][0]);
    if (n > maxId) maxId = n;
  }
  rec['id'] = maxId + 1;
  if (!rec['상태']) rec['상태'] = '활성';
  if (!rec['출처']) rec['출처'] = '수기';
  sh.appendRow(COLS.map(function (c) { return rec[c] !== undefined ? rec[c] : ''; }));
  return { ok: true, id: rec['id'] };
}

// 삭제(소프트): 상태 → 삭제
function apiDelete(id) {
  var sh = getMaster_();
  var values = sh.getDataRange().getValues();
  var stateCol = COLS.indexOf('상태') + 1;
  var tsCol = COLS.indexOf('수정일시') + 1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sh.getRange(i + 1, stateCol).setValue('삭제');
      sh.getRange(i + 1, tsCol).setValue(now_());
      return { ok: true };
    }
  }
  throw new Error('id ' + id + ' 행을 찾지 못했습니다.');
}
