/**
 * navergg 개통 엑셀(a_custom_goods_excel.asp) 파서.
 * 이 "엑셀"은 실제로는 EUC-KR HTML <table> 이다(.xls 확장자). 그래서 HTML로 파싱.
 *
 * 반환: [{ 소속, 고객명, 개통일, 유치자 }]
 *   - 소속  = 표의 '협력점' 컬럼 값 (예: "★아진정보통신●", "■■보라네트워크(영웅)○", "2.천안영업팀")
 */
'use strict';
const fs = require('fs');

const HEADER_MAP = {
  소속: ['협력점'],
  고객명: ['고객명'],
  개통일: ['개통일'],
  유치자: ['유치자'],
};

function decode(buf) {
  // EUC-KR 디코드 (Node full-icu). 실패 시 latin1 폴백.
  try { return new TextDecoder('euc-kr').decode(buf); }
  catch (e) { return buf.toString('latin1'); }
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function rowsFromHtml(html) {
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return trs.map(function (tr) {
    const cells = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    return cells.map(function (c) { return stripTags(c.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')); });
  });
}

function findIdx(header, keys) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').replace(/\s+/g, '');
    for (const k of keys) if (h === String(k).replace(/\s+/g, '')) return i;
  }
  // 부분일치 폴백
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').replace(/\s+/g, '');
    for (const k of keys) if (h.indexOf(String(k).replace(/\s+/g, '')) >= 0) return i;
  }
  return -1;
}

function parseBuffer(buf, overrides = {}) {
  const html = decode(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const rows = rowsFromHtml(html);
  if (!rows.length) return [];
  const cols = Object.assign({}, HEADER_MAP, overrides);

  // 헤더 행 = '협력점' 이 있는 첫 행
  let headerRow = -1, idx = null;
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const cand = {};
    for (const key in cols) cand[key] = findIdx(rows[r], cols[key]);
    if (cand.소속 >= 0) { headerRow = r; idx = cand; break; }
  }
  if (!idx) throw new Error("개통 엑셀에서 '협력점' 컬럼을 찾지 못했습니다.");

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const soan = idx.소속 >= 0 ? String(row[idx.소속] || '').trim() : '';
    if (!soan) continue;
    out.push({
      소속: soan,
      고객명: idx.고객명 >= 0 ? String(row[idx.고객명] || '').trim() : '',
      개통일: idx.개통일 >= 0 ? String(row[idx.개통일] || '').trim() : '',
      유치자: idx.유치자 >= 0 ? String(row[idx.유치자] || '').trim() : '',
    });
  }
  return out;
}

function parseFile(filePath, overrides = {}) {
  return parseBuffer(fs.readFileSync(filePath), overrides);
}

module.exports = { parseBuffer, parseFile, HEADER_MAP };
