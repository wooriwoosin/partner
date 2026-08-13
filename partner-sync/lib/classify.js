/**
 * 분류 엔진 (공유 모듈) — tools/build_seed.py, assets/app.js 와 동일 규칙.
 * 세 곳의 규칙은 항상 같이 유지할 것.
 *
 *  소속 앞기호:  ■□ = 판매점 · ★☆ = 협력점 · ◆◇ = 인센티브협력점 · 숫자/앞● = 자점
 *  사원명 마커: (O/○/o)=전달 · (X/x)=미전달(직접웹) · (?)=보류
 */
'use strict';

const SALES_SYMS = ['■■', '□□', '■', '□'];
const PARTNER_SYMS = ['★★', '☆☆', '◆◆', '◇◇', '★', '☆', '◆', '◇'];
const INCENTIVE_SYMS = ['◆◆', '◇◇', '◆', '◇'];
const ALL_SYMS = '■□★☆◆◇●';

function leadSymbol(soan) {
  const s = soan || '';
  if (s.charAt(0) === '●') return '●';
  const m = s.match(/^(\d+)\./);
  if (m) return m[0];
  for (const sym of SALES_SYMS.concat(PARTNER_SYMS)) if (s.indexOf(sym) === 0) return sym;
  return '';
}

function classify(soan) {
  const s = soan || '';
  if (s.charAt(0) === '●') return '자점';
  if (/^\d+\./.test(s)) return '자점';
  for (const sym of SALES_SYMS) if (s.indexOf(sym) === 0) return '판매점';
  for (const sym of PARTNER_SYMS) if (s.indexOf(sym) === 0) return '협력점';
  return '미분류';
}

function isIncentive(soan) {
  const s = soan || '';
  return INCENTIVE_SYMS.some((sym) => s.indexOf(sym) === 0);
}

function companyName(soan) {
  let s = (soan || '').replace(/^\d+\./, '');
  s = s.replace(new RegExp('^[' + ALL_SYMS + ']+'), '');
  s = s.replace(new RegExp('[' + ALL_SYMS + ']+$'), '');
  return s.trim();
}

const MARKER_MAP = { o: 'O', O: 'O', '○': 'O', 'Ｏ': 'O', x: 'X', X: 'X', '×': 'X', '?': '?', '？': '?' };
function markerFromName(name) {
  const m = (name || '').match(/[\(（]\s*([oO○ＯxX×？?])\s*[\)）]/);
  return m ? (MARKER_MAP[m[1]] || '') : '';
}

/** 구분 + 마커 -> 전달 기본값 (build_seed.derive 와 동일) */
function derive(gubun, marker) {
  const d = { 웹활용: '', 소통채널: '', 접수대행: '', 유선접수전달: '', 유선개통전달: '', 무선개통전달: '', 회신전달: '', 직접접수: '', 상태: '활성' };
  if (gubun === '판매점') {
    Object.assign(d, { 웹활용: 'N', 소통채널: '카카오톡채널', 접수대행: 'Y', 유선접수전달: 'Y', 유선개통전달: 'Y', 무선개통전달: 'Y', 회신전달: 'Y', 직접접수: 'N' });
    if (marker === 'O') d.웹활용 = 'Y';
  } else if (gubun === '협력점') {
    d.소통채널 = '카카오톡단체방';
    d.무선개통전달 = 'Y'; // 항상 전달
    if (marker === 'O') Object.assign(d, { 웹활용: 'N', 접수대행: 'Y', 유선접수전달: 'Y', 유선개통전달: 'Y', 회신전달: 'Y' });
    else if (marker === 'X') Object.assign(d, { 웹활용: 'Y', 접수대행: 'N', 유선접수전달: 'N', 유선개통전달: 'N', 회신전달: 'N' });
    else d.상태 = '보류';
  } else if (gubun === '자점') {
    Object.assign(d, { 웹활용: 'Y', 소통채널: '어드민', 접수대행: 'N', 유선접수전달: 'N', 유선개통전달: 'N', 무선개통전달: 'N', 회신전달: 'N', 직접접수: 'N' });
  }
  return d;
}

/** 소속 원문 하나로 업체 레코드(기본값) 생성 */
function buildCompany(soan, opts = {}) {
  const gubun = classify(soan);
  const marker = opts.marker || '';
  const d = derive(gubun, marker);
  return {
    소속원문: soan,
    업체명: companyName(soan),
    기호: leadSymbol(soan),
    업체구분: gubun,
    인센티브: isIncentive(soan) ? 'Y' : 'N',
    전달마커: marker,
    소통채널: d.소통채널,
    웹활용: d.웹활용,
    직접접수: d.직접접수,
    접수대행: d.접수대행,
    유선접수전달: d.유선접수전달,
    유선개통전달: d.유선개통전달,
    무선개통전달: d.무선개통전달,
    회신전달: d.회신전달,
    상태: d.상태,
    비고: opts.비고 || '',
  };
}

module.exports = { leadSymbol, classify, isIncentive, companyName, markerFromName, derive, buildCompany, SALES_SYMS, PARTNER_SYMS };
