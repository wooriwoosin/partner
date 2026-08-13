/**
 * 지난주 개통 목록 vs 기존 업체(시트) 대조.
 *
 *  - 신규 업체 : 업체명(기호 제거)이 기존에 없는 개통건 → 자동분류해서 추가 후보
 *  - 구분 변경 : 업체명은 있는데 앞기호 구분이 달라짐(예: ★협력점 → ■판매점) → 확인 후보
 *
 * 입력
 *  activations : [{ 소속, 고객명?, 개통일?, 유치자? }]
 *  existing    : [{ 소속원문, 업체명, 기호, 업체구분, ... }]
 */
'use strict';
const { companyName, classify, leadSymbol, buildCompany } = require('./classify');

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function baseKey(soan) { return companyName(soan); }

function detect(activations, existing) {
  const byBase = new Map();
  const bySoan = new Set();
  (existing || []).forEach(function (c) {
    bySoan.add(norm(c.소속원문));
    const b = baseKey(c.업체명 || c.소속원문);
    if (b) byBase.set(b, c);
  });

  const seen = new Set();
  const news = [];
  const changes = [];

  (activations || []).forEach(function (row) {
    const soan = norm(row.소속);
    if (!soan) return;
    const base = baseKey(soan);
    if (!base) return;
    if (seen.has(base)) return;        // 이번 목록 내 업체 중복 제거
    seen.add(base);

    if (bySoan.has(soan)) return;      // 소속 원문 완전 일치 = 변화 없음

    if (byBase.has(base)) {
      const prev = byBase.get(base);
      const newGubun = classify(soan);
      if (newGubun !== '미분류' && prev.업체구분 && newGubun !== prev.업체구분) {
        changes.push({
          업체명: base,
          이전소속: prev.소속원문, 이전구분: prev.업체구분, 이전기호: prev.기호 || leadSymbol(prev.소속원문),
          새소속: soan, 새구분: newGubun, 새기호: leadSymbol(soan),
          기존id: prev.id,
        });
      }
      return; // 이름 일치(표기 차이만) → 무시
    }

    // 완전 신규
    const company = buildCompany(soan, { 비고: '자동추가(지난주 개통)' });
    company.대표고객 = row.고객명 || '';
    company.첫개통일 = row.개통일 || '';
    company.계정수 = 1;
    news.push(company);
  });

  return { news, changes };
}

module.exports = { detect, norm };
