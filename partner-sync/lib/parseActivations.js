/**
 * 다운받은 "지난주 개통" 엑셀 -> [{소속, 사원명, 아이디, 연락처, 개통일}] 파싱.
 *
 * 실제 개통 엑셀의 컬럼명을 몰라서, 헤더 이름에 특정 단어가 포함되면 매칭하는 방식.
 * 샘플 엑셀 받으면 COLS 기본값을 실제 컬럼명으로 확정한다.
 * config.excelColumns 로 덮어쓸 수 있음.
 */
'use strict';
const XLSX = require('xlsx');

const COLS = {
  소속: ['소속', '소 속', '협력점', '업체'],
  사원명: ['사원명', '고객명', '가입자', '성명', '이름'],
  아이디: ['아이디', 'ID', '사원 아이디'],
  연락처: ['연락처', '휴대폰', '전화'],
  개통일: ['개통일', '개통일자', '개통날짜'],
};

function findIdx(header, keys) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').replace(/\s+/g, '');
    for (const k of keys) if (h.indexOf(String(k).replace(/\s+/g, '')) >= 0) return i;
  }
  return -1;
}

function parseFile(filePath, overrides = {}) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];

  // 헤더 행 탐색(소속으로 보이는 컬럼이 있는 첫 행)
  const cols = Object.assign({}, COLS, overrides);
  let headerRow = 0, idx = null;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cand = {};
    for (const key in cols) cand[key] = findIdx(rows[r], cols[key]);
    if (cand.소속 >= 0) { headerRow = r; idx = cand; break; }
  }
  if (!idx) throw new Error('개통 엑셀에서 소속 컬럼을 찾지 못했습니다. config.excelColumns 로 컬럼명을 지정하세요.');

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const soan = String(row[idx.소속] || '').trim();
    if (!soan) continue;
    out.push({
      소속: soan,
      사원명: idx.사원명 >= 0 ? String(row[idx.사원명] || '').trim() : '',
      아이디: idx.아이디 >= 0 ? String(row[idx.아이디] || '').trim() : '',
      연락처: idx.연락처 >= 0 ? String(row[idx.연락처] || '').trim() : '',
      개통일: idx.개통일 >= 0 ? String(row[idx.개통일] || '').trim() : '',
    });
  }
  return out;
}

module.exports = { parseFile, COLS };
