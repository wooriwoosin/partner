/**
 * 지난주 개통 목록 vs 기존 업체(시트) 대조 엔진.
 *
 *  - 신규 업체  : 소속(원문)도, 업체명(기호 제거)도 기존에 없는 개통건
 *  - 기호 변경  : 업체명은 기존에 있는데 앞기호가 달라진 경우 (예: ★기가몬스터 → ■기가몬스터)
 *
 * 입력
 *  activations : [{ 소속, 사원명?, 개통일? }]   (다운받은 엑셀에서 파싱)
 *  existing    : [{ 소속원문, 업체명, 기호, ... }] (시트 list 결과)
 */
'use strict';
const { companyName, leadSymbol, markerFromName, buildCompany } = require('./classify');

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

function detect(activations, existing) {
  const bySoan = new Map();
  const byBase = new Map();
  (existing || []).forEach((c) => {
    bySoan.set(norm(c.소속원문), c);
    const base = norm(c.업체명 || companyName(c.소속원문));
    if (base) byBase.set(base, c);
  });

  const seenSoan = new Set();
  const news = [];
  const changes = [];

  (activations || []).forEach((row) => {
    const soan = norm(row.소속);
    if (!soan) return;
    if (seenSoan.has(soan)) return; // 이번 개통목록 내 중복 제거
    seenSoan.add(soan);

    if (bySoan.has(soan)) return; // 이미 등록된 소속 = 변화 없음

    const base = companyName(soan);
    if (base && byBase.has(base)) {
      // 이름은 같은데 소속(기호)이 다름 → 기호 변경 감지
      const prev = byBase.get(base);
      changes.push({
        업체명: base,
        이전소속: prev.소속원문,
        이전기호: prev.기호 || leadSymbol(prev.소속원문),
        새소속: soan,
        새기호: leadSymbol(soan),
        기존id: prev.id,
      });
    } else {
      // 완전 신규
      const marker = markerFromName(row.사원명 || '');
      const company = buildCompany(soan, { marker, 비고: '자동추가(지난주 개통)' });
      company.대표아이디 = row.아이디 || '';
      company.연락처 = row.연락처 || '';
      company.계정수 = 1;
      news.push(company);
    }
  });

  return { news, changes };
}

module.exports = { detect, norm };
