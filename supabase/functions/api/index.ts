// ============================================================
// 협력점 관리앱 — API (Supabase Edge Function)
// ------------------------------------------------------------
// Apps Script(Code.gs)가 하던 일을 그대로 옮긴 것입니다.
// 요청/응답 모양을 바꾸지 않았으므로 프론트엔드(app.js)는 주소만 바꾸면 됩니다.
//
// 설정할 비밀값: 없음.
//   · DB 접속은 수파베이스가 넣어주는 SUPABASE_DB_URL 을 씁니다.
//   · 서명키·해시키는 이 코드가 처음 실행될 때 스스로 난수를 만들어
//     partner."설정" 테이블에 넣습니다 (사람도 채팅도 저장소도 그 값을 보지 않음).
// ============================================================

import postgres from 'npm:postgres@3.4.9';

const VERSION = '2026-10-14a';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  prepare: false, // 트랜잭션 풀러(Supavisor) 호환
  types: {
    // date 를 Date 객체로 바꾸지 않고 'YYYY-MM-DD' 문자열 그대로 넘긴다.
    // Date 로 바뀌면 '2026-10-07T00:00:00.000Z' 가 되어 시간대 해석 여지가 생긴다.
    날짜: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    // bigint(id)를 문자열이 아니라 숫자로 (시트 시절과 같은 모양)
    정수: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
  },
});

/* ------------------------- 공통 ------------------------- */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 타이밍 공격을 피하려고 길이·내용을 한 번에 비교하지 않는다 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------- 비밀값 ------------------------- */
// partner."설정" 에 보관. 없으면 난수를 만들어 넣는다.

const 비밀값캐시 = new Map<string, string>();

async function 비밀값(키: string): Promise<string> {
  const 캐시 = 비밀값캐시.get(키);
  if (캐시) return 캐시;

  const 있나 = await sql`select "값" from partner."설정" where "키" = ${키}`;
  if (있나.length) {
    비밀값캐시.set(키, 있나[0].값);
    return 있나[0].값;
  }
  const 새값 = crypto.randomUUID() + '|' + crypto.randomUUID();
  await sql`
    insert into partner."설정" ("키", "값") values (${키}, ${새값})
    on conflict ("키") do nothing
  `;
  // 동시에 여러 요청이 들어와도 먼저 들어간 값을 따른다
  const 확정 = await sql`select "값" from partner."설정" where "키" = ${키}`;
  비밀값캐시.set(키, 확정[0].값);
  return 확정[0].값;
}

/* ------------------------- 토큰 ------------------------- */

async function hmac(msg: string): Promise<string> {
  const secret = await 비밀값('TOKEN_SECRET');
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}

async function makeToken(id: string, role: string): Promise<string> {
  const payload = b64url(enc.encode(id + '|' + role));
  return payload + '.' + (await hmac(payload));
}

async function readToken(token: string): Promise<{ id: string; role: string } | null> {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (!safeEqual(await hmac(parts[0]), parts[1])) return null;
  try {
    const [id, role] = new TextDecoder().decode(b64urlDecode(parts[0])).split('|');
    if (!id) return null;
    return { id, role: role || 'staff' };
  } catch {
    return null;
  }
}

/* ------------------------- 비밀번호 ------------------------- */
// 저장 형식: pbkdf2$<반복수>$<소금>$<해시>
// 옛 형식(앱스크립트)도 로그인 때만 받아주고, 맞으면 바로 새 형식으로 바꿔 저장한다.

const 옛_SECRET = 'wnet-2026-8f3a9c1e-partner-secret'; // 공개 저장소에 노출됐던 값. 호환용으로만 쓴다.
const PBKDF2_반복 = 150000;

async function sha256b64(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** 앱스크립트가 문자셋을 지정하지 않았을 때 한글이 '?' 로 뭉개지던 것을 재현 */
function 한글뭉개기(s: string): string {
  return s.replace(/[^\x00-\x7F]/g, '?');
}

async function 새해시(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_반복, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_반복}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

async function 해시맞나(저장값: string, 아이디: string, pw: string): Promise<boolean> {
  if (저장값.startsWith('pbkdf2$')) {
    const [, 반복, 소금, 해시] = 저장값.split('$');
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64urlDecode(소금), iterations: Number(반복), hash: 'SHA-256' },
      key,
      256,
    );
    return safeEqual(b64url(new Uint8Array(bits)), 해시);
  }
  // 옛 앱스크립트 형식 두 가지
  const 평문 = 옛_SECRET + '|' + 아이디 + '|' + pw;
  if (safeEqual(await sha256b64(평문), 저장값)) return true;
  return safeEqual(await sha256b64(한글뭉개기(평문)), 저장값);
}

/* ------------------------- 사용자 ------------------------- */

type 사용자 = { 아이디: string; 비번해시: string; 이름: string; 권한: string; 상태: string };

async function 사용자찾기(아이디: string): Promise<사용자 | null> {
  const r = await sql<사용자[]>`
    select "아이디", "비번해시", "이름", "권한", "상태"
    from partner."사용자" where "아이디" = ${String(아이디).trim()}
  `;
  return r.length ? r[0] : null;
}

type 로그인정보 = { id: string; name: string; role: string };

async function 인증(token: string): Promise<로그인정보> {
  const t = await readToken(token);
  if (!t) throw new HttpError('unauthorized', 401);
  const u = await 사용자찾기(t.id);
  if (!u) throw new HttpError('unauthorized', 401);
  if (u.상태 === '정지') throw new HttpError('정지된 계정입니다.', 403);
  // 권한은 토큰이 아니라 "지금 DB 값"을 믿는다 (토큰 발급 후 바뀌었을 수 있으므로)
  return { id: u.아이디, name: u.이름 || u.아이디, role: u.권한 || 'staff' };
}

async function 어드민인증(token: string): Promise<로그인정보> {
  const u = await 인증(token);
  if (u.role !== 'admin') {
    throw new HttpError('관리자 권한이 필요합니다. (스태프 계정은 본인 비밀번호만 변경할 수 있습니다)', 403);
  }
  return u;
}

class HttpError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

/* ------------------------- 업체 ------------------------- */

// 저장 가능한 컬럼. 여기 없는 키는 조용히 무시한다 (id·수정일시는 따로 처리).
const 업체컬럼 = [
  '업체명', '소속원문', '기호', '업체구분', '인센티브', '전달마커', '상태',
  '소통채널', '웹접수', '웹회신', '대표자', '연락처', '계정수', '비고',
  '법인', '계산서형태', '수신방법', '사업자등록증', '계산서비고',
  '위탁판매', '개인정보', '보증보험', '계약제외', '계약비고', '계약서발송',
  '출처', '등록일', '최근개통일',
] as const;

const 숫자컬럼 = new Set(['계정수']);
const 날짜컬럼 = new Set(['등록일', '최근개통일']);

/** 프론트가 보낸 객체에서 저장할 값만 추려 정리한다 */
function 정리(c: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of 업체컬럼) {
    if (!(k in c)) continue;
    let v = c[k];
    if (v === '' || v === undefined || v === null) {
      o[k] = null;
      continue;
    }
    if (숫자컬럼.has(k)) {
      const n = Number(v);
      o[k] = Number.isFinite(n) ? Math.trunc(n) : null;
      continue;
    }
    if (날짜컬럼.has(k)) {
      // '2026-10-07' 또는 '2026-10-07T15:00:00.000Z' → 한국시간 기준 날짜
      const s = String(v);
      o[k] = s.includes('T')
        ? new Date(new Date(s).getTime() + 9 * 3600000).toISOString().slice(0, 10)
        : s.slice(0, 10);
      continue;
    }
    o[k] = typeof v === 'string' ? v.trim() : v;
  }
  return o;
}

/** 변경로그 트리거가 "누가 했는지" 알 수 있도록 트랜잭션 변수를 심고 실행 */
// deno-lint-ignore no-explicit-any
async function 작업자로(u: 로그인정보, fn: (tx: any) => Promise<unknown>) {
  return await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${u.id}, true)`;
    await tx`select set_config('app.user_name', ${u.name}, true)`;
    return await fn(tx);
  });
}

async function 업체저장(c: Record<string, unknown>, u: 로그인정보) {
  if (!c) throw new HttpError('no company');
  const 값 = 정리(c);
  const id = c.id ? Number(c.id) : 0;

  return await 작업자로(u, async (tx) => {
    if (id) {
      if (!Object.keys(값).length) return { ok: true, mode: 'update', company: null };
      const r = await tx`update partner."업체" set ${tx(값)} where "id" = ${id} returning *`;
      if (!r.length) throw new HttpError(`없는 업체입니다 (id ${id}). 새로고침 후 다시 시도하세요.`, 404);
      return { ok: true, mode: 'update', company: r[0] };
    }
    const r = await tx`insert into partner."업체" ${tx(값)} returning *`;
    return { ok: true, mode: 'insert', company: r[0] };
  });
}

async function 업체삭제(id: unknown, u: 로그인정보) {
  return await 작업자로(u, async (tx) => {
    const r = await tx`delete from partner."업체" where "id" = ${Number(id)} returning "id"`;
    if (!r.length) throw new HttpError(`없는 업체입니다 (id ${id}).`, 404);
    return { ok: true, deleted: r[0].id };
  });
}

/** 개통리스트에서 나온 신규 업체 묶음 등록 */
async function 업체묶음등록(list: Record<string, unknown>[], u: 로그인정보) {
  if (!list?.length) throw new HttpError('no companies');
  return await 작업자로(u, async (tx) => {
    let 등록 = 0;
    const 건너뜀: string[] = [];
    for (const c of list) {
      const 값 = 정리(c);
      if (!값['소속원문'] || !값['업체구분']) {
        건너뜀.push(String(c['소속원문'] ?? '(이름없음)'));
        continue;
      }
      // 이미 있는 소속원문은 새로 만들지 않는다 (중복 등록 사고 방지)
      const r = await tx`
        insert into partner."업체" ${tx(값)}
        on conflict ("소속원문") do nothing
        returning "id"
      `;
      if (r.length) 등록++;
      else 건너뜀.push(String(값['소속원문']));
    }
    return { ok: true, inserted: 등록, skipped: 건너뜀 };
  });
}

/** 개통리스트 현행화 — id 로 찾아 보내준 항목만 부분 갱신 */
async function 업체묶음갱신(list: Record<string, unknown>[], u: 로그인정보) {
  if (!list?.length) throw new HttpError('no companies');
  return await 작업자로(u, async (tx) => {
    let 갱신 = 0;
    for (const c of list) {
      const id = Number(c.id);
      if (!id) continue;
      const 값 = 정리(c);
      if (!Object.keys(값).length) continue;
      const r = await tx`update partner."업체" set ${tx(값)} where "id" = ${id} returning "id"`;
      if (r.length) 갱신++;
    }
    return { ok: true, updated: 갱신 };
  });
}

/* ------------------------- 변경로그 ------------------------- */

const 요일 = ['일', '월', '화', '수', '목', '금', '토'];

/** 이번 주(월요일 00:00 한국시간 ~ 현재) 기록만 */
async function 로그읽기() {
  const rows = await sql`
    select "일시", "아이디", "이름", "작업", "대상", "상세"
    from partner."변경로그"
    where "일시" >= (date_trunc('week', (now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul')
    order by "일시" desc
    limit 3000
  `;
  return rows.map((r: Record<string, unknown>) => {
    const d = new Date(r.일시 as string);
    const kst = new Date(d.getTime() + 9 * 3600000);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      일시: `${p(kst.getUTCMonth() + 1)}/${p(kst.getUTCDate())}(${요일[kst.getUTCDay()]}) ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`,
      아이디: r.아이디 ?? '',
      이름: r.이름 ?? '',
      작업: r.작업 ?? '',
      대상: r.대상 ?? '',
      상세: r.상세 ?? '',
    };
  });
}

/* ------------------------- 계정 ------------------------- */

async function 로그인(id: string, pw: string) {
  const u = await 사용자찾기(id);
  if (!u) return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  if (u.상태 === '정지') return { ok: false, error: '정지된 계정입니다.' };
  if (!(await 해시맞나(u.비번해시, u.아이디, pw))) {
    return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }
  // 옛 형식이면 조용히 새 형식으로 바꿔 저장한다 (사용자는 아무것도 안 해도 됨)
  if (!u.비번해시.startsWith('pbkdf2$')) {
    try {
      await sql`update partner."사용자" set "비번해시" = ${await 새해시(pw)} where "아이디" = ${u.아이디}`;
    } catch { /* 실패해도 로그인은 막지 않는다 */ }
  }
  return {
    ok: true,
    token: await makeToken(u.아이디, u.권한 || 'staff'),
    name: u.이름 || u.아이디,
    role: u.권한 || 'staff',
  };
}

async function 계정목록() {
  return await sql`
    select "아이디", "이름", "권한", "상태"
    from partner."사용자" order by "권한", "아이디"
  `;
}

async function 계정추가(id: string, pw: string, name: string, role: string) {
  id = String(id || '').trim();
  if (id.length < 3) return { ok: false, error: '아이디는 3자 이상이어야 합니다.' };
  if (String(pw || '').length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  if (await 사용자찾기(id)) return { ok: false, error: '이미 있는 아이디입니다.' };
  await sql`
    insert into partner."사용자" ("아이디", "비번해시", "이름", "권한")
    values (${id}, ${await 새해시(pw)}, ${name || id}, ${role === 'admin' ? 'admin' : 'staff'})
  `;
  return { ok: true };
}

async function 계정삭제(id: string) {
  const n = await sql`select count(*)::int as c from partner."사용자"`;
  if (n[0].c <= 1) return { ok: false, error: '마지막 계정은 삭제할 수 없습니다.' };
  const r = await sql`delete from partner."사용자" where "아이디" = ${String(id).trim()} returning "아이디"`;
  return r.length ? { ok: true, deleted: id } : { ok: false, error: '없는 아이디입니다.' };
}

async function 비번초기화(대상: string, 새비번: string) {
  if (String(새비번 || '').length < 4) return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  const r = await sql`
    update partner."사용자" set "비번해시" = ${await 새해시(새비번)}
    where "아이디" = ${String(대상).trim()} returning "아이디"
  `;
  return r.length ? { ok: true } : { ok: false, error: '없는 아이디입니다.' };
}

async function 내비번변경(u: 로그인정보, 옛비번: string, 새비번: string) {
  const rec = await 사용자찾기(u.id);
  if (!rec) return { ok: false, error: '계정을 찾을 수 없습니다.' };
  if (!(await 해시맞나(rec.비번해시, rec.아이디, 옛비번))) {
    return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
  }
  if (String(새비번 || '').length < 4) return { ok: false, error: '새 비밀번호는 4자 이상이어야 합니다.' };
  await sql`update partner."사용자" set "비번해시" = ${await 새해시(새비번)} where "아이디" = ${rec.아이디}`;
  return { ok: true };
}

/* ------------------------- 라우팅 ------------------------- */

async function 업체목록() {
  return await sql`select * from partner."업체" order by "id"`;
}

async function 처리(action: string, p: Record<string, unknown>): Promise<unknown> {
  const token = String(p.token ?? '');

  switch (action) {
    case 'ping':
      return { ok: true, ver: VERSION };

    case 'hasUsers': {
      const r = await sql`select count(*)::int as c from partner."사용자"`;
      return { ok: true, hasUsers: r[0].c > 0 };
    }

    case 'login':
      return await 로그인(String(p.id ?? ''), String(p.pw ?? ''));

    case 'registerFirstAdmin': {
      const r = await sql`select count(*)::int as c from partner."사용자"`;
      if (r[0].c > 0) return { ok: false, error: '이미 관리자 계정이 있습니다. 로그인하세요.' };
      const 만들기 = await 계정추가(String(p.id ?? ''), String(p.pw ?? ''), String(p.name ?? ''), 'admin');
      if (!만들기.ok) return 만들기;
      return {
        ok: true,
        token: await makeToken(String(p.id).trim(), 'admin'),
        name: String(p.name || p.id),
        role: 'admin',
      };
    }

    case 'list': {
      await 인증(token);
      const rows = await 업체목록();
      return { ok: true, ver: VERSION, count: rows.length, companies: rows };
    }

    case 'upsert':
      return await 업체저장(p.company as Record<string, unknown>, await 인증(token));

    case 'delete':
      return await 업체삭제(p.id, await 인증(token));

    case 'bulkImport':
      return await 업체묶음등록(p.companies as Record<string, unknown>[], await 인증(token));

    case 'bulkUpsert':
      return await 업체묶음갱신(p.companies as Record<string, unknown>[], await 인증(token));

    case 'logs':
      await 인증(token);
      return { ok: true, logs: await 로그읽기() };

    case 'listUsers': {
      const u = await 인증(token);
      return { ok: true, users: await 계정목록(), me: u.id, role: u.role };
    }

    case 'createUser': {
      await 어드민인증(token);
      return await 계정추가(String(p.id ?? ''), String(p.pw ?? ''), String(p.name ?? ''), String(p.role ?? 'staff'));
    }

    case 'deleteUser':
      await 어드민인증(token);
      return await 계정삭제(String(p.id ?? ''));

    case 'resetPw':
      await 어드민인증(token);
      return await 비번초기화(String(p.id ?? ''), String(p.pw ?? ''));

    case 'changeMyPw':
      return await 내비번변경(await 인증(token), String(p.oldPw ?? ''), String(p.newPw ?? ''));

    default:
      return { ok: false, error: 'unknown action: ' + action };
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    let p: Record<string, unknown> = {};
    let action = 'ping';

    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      q.forEach((v, k) => (p[k] = v));
      action = String(p.action ?? 'ping');
    } else {
      // 프론트는 preflight 를 피하려고 text/plain 으로 JSON 본문을 보낸다
      const raw = await req.text();
      try {
        p = raw ? JSON.parse(raw) : {};
      } catch {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      action = String(p.action ?? '');
    }

    return json(await 처리(action, p));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, status);
  }
}

// 수파베이스 Edge 런타임의 현재 방식(기본 내보내기).
// 예전 방식인 Deno.serve(handler) 와 같은 동작입니다.
export default { fetch: handler };
