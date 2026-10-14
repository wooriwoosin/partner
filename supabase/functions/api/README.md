# Edge Function 배포 안내

## 무엇인가

Apps Script(`Code.gs`)가 하던 API 를 그대로 옮긴 것입니다.
요청·응답 모양이 같아서 프론트엔드는 `assets/config.js` 의 주소만 바꾸면 됩니다.

## 설정할 비밀값 — 없습니다

| 값 | 어디서 오나 |
|---|---|
| DB 접속 | 수파베이스가 `SUPABASE_DB_URL` 로 자동 주입 |
| 토큰 서명키 | 코드가 **처음 실행될 때 스스로 난수를 만들어** `partner.설정` 에 저장 |

서명키는 사람도 채팅도 깃허브도 보지 않습니다.

## 방법 A — 대시보드에서 (권장)

1. 수파베이스 → 왼쪽 **Edge Functions** → **Deploy a new function** → **Via Editor**
2. 함수 이름: **`api`** (반드시 이 이름 — 주소가 `/functions/v1/api` 가 됩니다)
3. `index.ts` 내용을 전부 붙여넣기
4. **Verify JWT** 옵션을 **끕니다(off)**
   - 켜두면 브라우저가 anon 키를 헤더로 보내야 하고, 그러면 preflight 때문에 호출이 막힙니다
   - 이 앱은 자체 아이디·비밀번호로 인증하므로 꺼도 안전합니다
5. **Deploy**

## 방법 B — CLI

```bash
supabase link --project-ref <프로젝트 ref>
supabase functions deploy api --no-verify-jwt
```

## 배포 확인

```
https://<프로젝트ref>.supabase.co/functions/v1/api?action=ping
```

브라우저에서 열었을 때 이렇게 나오면 성공입니다.

```json
{"ok":true,"ver":"2026-10-14a"}
```

## 지원하는 동작 (Apps Script 와 동일)

| 분류 | action |
|---|---|
| 공개 | `ping` `hasUsers` `login` `registerFirstAdmin` |
| 로그인 필요 | `list` `upsert` `delete` `bulkImport` `bulkUpsert` `logs` `listUsers` `changeMyPw` |
| 어드민 전용 | `createUser` `deleteUser` `resetPw` |

## 비밀번호

기존 비밀번호를 그대로 쓰십니다. 옛 앱스크립트 해시(두 가지 형식 모두)를 로그인 때 알아보고,
맞으면 **PBKDF2(15만 회)로 자동 승급**해 저장합니다. 직원분들이 하실 일은 없습니다.
