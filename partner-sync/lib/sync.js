/**
 * navergg.kr(고객관리시스템, Entersoft ASP) 지난주 개통 신규 협력점 동기화.
 *
 * 흐름
 *  1) 로그인(확정): m_id/m_passwd 입력 → fnc_sms_chk('frm_login')  ("아이디 인증")
 *       sms_chk == 'N' : SMS 불필요 → 바로 로그인
 *       sms_chk == 'Y' : s_tel2/s_tel3 입력 → fnc_sms_send ("인증받기") → last_sms 4자리 → 로그인
 *       sms_chk == 'X' : 없는 아이디/인증 미완료
 *     → fnc_login_regist('frm_login')  (action=/include/asp/login_ok.asp)
 *  2) 개통 엑셀 직접 다운로드(확정): GET
 *       /customer/a_custom_goods_excel.asp?s_search_key=g_date_gaetong&s_date_start=YYYY-MM-DD&s_date_end=YYYY-MM-DD&...
 *     ('엑셀저장' 버튼과 동일한 stateless GET. 로그인 쿠키만 있으면 됨)
 *     ※ 반환은 EUC-KR HTML <table>(.xls) → parseActivations 로 파싱
 *  3) 기존 업체(시트)와 대조 → 신규 자동분류 추가 / 구분변경 표시
 */
'use strict';
const { chromium } = require('playwright');
const { parseBuffer } = require('./parseActivations');
const { detect } = require('./diff');
const { listCompanies, upsertCompany } = require('./sheet');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 지난주(월~일) 범위를 YYYY-MM-DD 로. (오늘 기준) */
function lastWeekRange(now) {
  now = now || new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dowMon = (d.getDay() + 6) % 7;               // 월=0
  const thisMon = new Date(d); thisMon.setDate(d.getDate() - dowMon);
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
  const f = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  return { start: f(lastMon), end: f(lastSun) };
}

function excelUrl(base, range) {
  const p = new URLSearchParams({
    search_key: '', search_txt: '', s_gaetong_code: '',
    s_dealer_code: '', s_dealer_code1: '',
    s_search_key: 'g_date_gaetong',                  // 날짜항목 = 개통일
    s_date_start: range.start, s_date_end: range.end,
    s_article_idx1: '0', s_article_idx2: '0', s_option_idx: '0', s_g_set: '0',
    s_receipt_chk: '', s_sp_give_type: '', list_cnt: '70',
    s_yuchi_m_id: '', s_code_jupjum: '', s_code_course_idx: '',
    s_code_imging_idx: '', s_code_addr_idx: '', s_code_dist: '',
    s_code_area: '0', s_sp_price: '', s_code_sale: '0', s_code_promise: '0',
    search_key1: '', search_txt1: '',
  });
  return base.replace(/\/+$/, '') + '/customer/a_custom_goods_excel.asp?' + p.toString();
}

async function runSync({ config, creds, onLog = () => {}, dryRun = false }) {
  const log = (m) => onLog(m);
  const result = { ok: false, range: null, news: [], changes: [], added: 0, activations: 0 };

  log('브라우저 실행…');
  const browser = await chromium.launch({
    headless: config.headless === true,
    executablePath: config.chromePath || undefined,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', async (d) => { log('[알림] ' + d.message().replace(/\s+/g, ' ').trim()); await d.accept().catch(() => {}); });

  try {
    log('로그인 페이지 이동: ' + config.LOGIN_URL);
    await page.goto(config.LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await login(page, creds, log);

    const base = config.BASE_URL || new URL(config.LOGIN_URL).origin;
    const range = (creds.dateStart && creds.dateEnd)
      ? { start: creds.dateStart, end: creds.dateEnd }
      : lastWeekRange();
    result.range = range;
    log(`개통일 기준 지난주: ${range.start} ~ ${range.end}`);

    const url = excelUrl(base, range);
    log('개통 엑셀 요청(GET): ' + url);
    const resp = await context.request.get(url, { timeout: 60000 });
    if (!resp.ok()) throw new Error('엑셀 요청 실패 HTTP ' + resp.status());
    const buf = await resp.body();

    const activations = parseBuffer(buf, config.excelColumns || {});
    result.activations = activations.length;
    log(`개통 ${activations.length}건 파싱`);
    if (!activations.length) log('⚠️ 개통 0건 — 로그인/기간/권한 확인 필요');

    log('시트에서 기존 업체 목록 로드');
    const existing = await listCompanies(config);
    log(`기존 업체 ${existing.length}개`);

    const { news, changes } = detect(activations, existing);
    result.news = news;
    result.changes = changes;
    log(`신규 업체 ${news.length}개, 구분변경 감지 ${changes.length}개`);

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

/* ---------------- 로그인 (login 페이지 소스 기준 확정) ---------------- */
async function login(page, creds, log) {
  await page.locator('input[name="m_id"]').fill(creds.id);
  await page.locator('input[name="m_passwd"]').fill(creds.pw);

  log('아이디 인증 요청');
  await page.evaluate(() => window.fnc_sms_chk('frm_login'));

  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('sms_chk');
      return el && (el.value === 'N' || el.value === 'Y');
    }, { timeout: 15000 });
  } catch (e) { /* 아래에서 값 재확인 */ }
  const sms = await page.evaluate(() => (document.getElementById('sms_chk') || {}).value || 'X');
  log('아이디 인증 결과: sms_chk=' + sms);
  if (sms === 'X') throw new Error('아이디 인증 실패 — 없는 아이디이거나 인증이 완료되지 않았습니다.');

  if (sms === 'Y') {
    if (creds.phoneMid && creds.phoneLast) {
      log('휴대폰 입력 후 인증문자 발송(인증받기)');
      await page.locator('input[name="s_tel2"]').fill(creds.phoneMid);
      await page.locator('input[name="s_tel3"]').fill(creds.phoneLast);
      await page.evaluate(() => window.fnc_sms_send('frm_login'));
    }
    if (creds.otp && String(creds.otp).length === 4) {
      await page.locator('input[name="last_sms"]').fill(String(creds.otp));
    }
    log('휴대폰 인증번호(4자리)를 열린 브라우저 창의 [인증번호] 칸에 입력해 주세요. (최대 3분 대기)');
    await page.waitForFunction(() => {
      const el = document.getElementsByName('last_sms')[0];
      return el && String(el.value).length === 4;
    }, { timeout: 180000 });
  } else {
    log('OTP 불필요 계정 — 바로 로그인');
  }

  log('로그인');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.evaluate(() => window.fnc_login_regist('frm_login')),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  const stillLogin = await page.locator('input[name="m_passwd"]').count().catch(() => 0);
  if (stillLogin) throw new Error('로그인 실패 — 비밀번호/인증을 확인하세요.');
  log('로그인 완료: ' + page.url());
}

module.exports = { runSync, lastWeekRange, excelUrl };
