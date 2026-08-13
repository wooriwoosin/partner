/**
 * navergg.kr 로그인 → 고객관리>전체고객관리 → 개통일/지난주 → 엑셀 다운로드 → 파싱 → 대조 → 시트반영.
 *
 * ⚠️ 아래 SELECTORS 는 실제 페이지 소스를 받은 뒤 확정해야 하는 "임시 선택자"입니다.
 *    버튼 텍스트(아이디인증/로그인)는 getByText 로 잡도록 시도하지만, 입력창 등은 실제 name/id 로 교체 필요.
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');
const { parseFile } = require('./parseActivations');
const { detect } = require('./diff');
const { listCompanies, upsertCompany } = require('./sheet');

// ---- 실제 페이지 받으면 확정할 선택자 (config.selectors 로 덮어쓰기 가능) ----
const DEFAULT_SELECTORS = {
  idInput: '#userId, input[name="userId"], input[name="id"]',          // TODO: 실제 확정
  pwInput: '#userPw, input[name="userPw"], input[type="password"]',    // TODO
  idVerifyButton: '아이디인증',                                          // 텍스트 매칭
  otpInput: '#otp, input[name="otp"], input[name="certNo"]',           // TODO
  loginButton: '로그인',                                                // 텍스트 매칭
  // 전체고객관리 화면
  dateTypeSelect: 'select[name="dateType"]',                           // TODO: 날짜항목 셀렉트
  dateTypeValue: '개통일',                                              // 옵션 라벨
  periodLastWeek: '지난주',                                             // 버튼/라디오 텍스트
  searchButton: '조회',                                                 // 검색 버튼 텍스트
  excelButton: '엑셀',                                                  // 엑셀 다운로드 버튼 텍스트
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSync({ config, creds, onLog = () => {}, dryRun = false }) {
  const S = Object.assign({}, DEFAULT_SELECTORS, config.selectors || {});
  const log = (m) => { onLog(m); };
  const result = { ok: false, news: [], changes: [], added: 0, activations: 0 };

  log('브라우저 실행…');
  const browser = await chromium.launch({
    headless: config.headless === true,   // 기본 false(화면 보임: 캡차/OTP 대응)
    executablePath: config.chromePath || undefined,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // 1) 로그인 페이지
    log('로그인 페이지 이동: ' + config.LOGIN_URL);
    await page.goto(config.LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // 2) 아이디/비번 입력
    log('아이디/비밀번호 입력');
    await page.locator(S.idInput).first().fill(creds.id);
    await page.locator(S.pwInput).first().fill(creds.pw);

    // 3) "아이디인증" 클릭
    log('아이디인증 클릭');
    await clickByTextOrSelector(page, S.idVerifyButton);
    await sleep(1500); // 인증 처리 대기 (실제 확인문구로 교체 예정)

    // 4) OTP (선택)
    if (creds.useOtp) {
      log('휴대폰 인증번호 입력');
      await page.locator(S.otpInput).first().fill(creds.otp || '');
    } else {
      log('OTP 미사용(아이디인증만으로 진행)');
    }

    // 5) 로그인
    log('로그인 클릭');
    await clickByTextOrSelector(page, S.loginButton);
    await page.waitForLoadState('networkidle').catch(() => {});
    log('로그인 완료(추정). 현재 URL: ' + page.url());

    // 6) 고객관리 > 전체고객관리
    log('전체고객관리 이동');
    await gotoCustomerList(page, S, config, log);

    // 7) 날짜항목=개통일, 기간=지난주
    log('날짜항목=개통일, 기간=지난주 설정');
    await setFilters(page, S, log);

    // 8) 조회 + 엑셀 다운로드
    log('조회 후 엑셀 다운로드');
    await clickByTextOrSelector(page, S.searchButton).catch(() => log('조회 버튼 스킵'));
    await page.waitForLoadState('networkidle').catch(() => {});
    const downloadPath = await downloadExcel(page, S, log);

    // 9) 파싱
    const activations = parseFile(downloadPath, config.excelColumns || {});
    result.activations = activations.length;
    log(`개통건 ${activations.length}건 파싱`);

    // 10) 기존 업체 대조
    log('시트에서 기존 업체 목록 로드');
    const existing = await listCompanies(config);
    log(`기존 업체 ${existing.length}개`);
    const { news, changes } = detect(activations, existing);
    result.news = news;
    result.changes = changes;
    log(`신규 업체 ${news.length}개, 기호 변경 감지 ${changes.length}개`);

    // 11) 반영
    if (!dryRun) {
      for (const c of news) {
        await upsertCompany(config, c);
        result.added++;
        log(`+ 추가: ${c.업체구분} · ${c.소속원문}`);
      }
    } else {
      log('미리보기(dryRun) — 시트에 반영하지 않음');
    }

    result.ok = true;
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function clickByTextOrSelector(page, textOrSel) {
  // CSS 선택자로 보이면 그걸로, 아니면 텍스트/역할로 클릭
  if (/[#.\[]/.test(textOrSel)) {
    await page.locator(textOrSel).first().click();
    return;
  }
  const byRole = page.getByRole('button', { name: textOrSel });
  if (await byRole.count()) { await byRole.first().click(); return; }
  await page.getByText(textOrSel, { exact: false }).first().click();
}

async function gotoCustomerList(page, S, config, log) {
  if (config.CUSTOMER_LIST_URL) {
    await page.goto(config.CUSTOMER_LIST_URL, { waitUntil: 'domcontentloaded' });
    return;
  }
  // 메뉴 클릭 (텍스트 기반) — 실제 구조 받으면 확정
  try { await page.getByText('고객관리', { exact: false }).first().click(); await sleep(500); } catch (e) { log('고객관리 메뉴 클릭 실패(선택자 확정 필요)'); }
  try { await page.getByText('전체고객관리', { exact: false }).first().click(); await sleep(800); } catch (e) { log('전체고객관리 메뉴 클릭 실패(선택자 확정 필요)'); }
}

async function setFilters(page, S, log) {
  // 날짜항목 셀렉트 → 개통일
  try {
    await page.locator(S.dateTypeSelect).first().selectOption({ label: S.dateTypeValue });
  } catch (e) {
    log('날짜항목 셀렉트 실패(선택자 확정 필요): ' + e.message);
  }
  // 기간: 지난주
  try {
    await clickByTextOrSelector(page, S.periodLastWeek);
  } catch (e) {
    log('지난주 버튼 클릭 실패(선택자 확정 필요): ' + e.message);
  }
}

async function downloadExcel(page, S, log) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    clickByTextOrSelector(page, S.excelButton),
  ]);
  const dest = path.join(os.tmpdir(), 'navergg_activations_' + Date.now() + '.xlsx');
  await download.saveAs(dest);
  log('엑셀 저장: ' + dest);
  return dest;
}

module.exports = { runSync, DEFAULT_SELECTORS };
