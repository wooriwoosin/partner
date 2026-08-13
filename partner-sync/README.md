# 협력점 동기화 도구 (로컬 실행)

navergg.kr 어드민에 로그인 → **고객관리 › 전체고객관리**의 **개통일 · 지난주** 개통건을 받아,
**아직 등록 안 된 신규 협력점**을 자동 분류해 구글시트(`업체관리`)에 추가하는 도구입니다.
사장님 PC에서 실행되며, **아이디·비밀번호·인증번호는 이 PC 밖으로 나가지 않습니다.**

```
[로컬 폼(ui.html)] → [Playwright 로그인] → [개통 엑셀 GET 다운로드] → [기존 대조·자동분류] → [구글시트]
```

> 실제 로그인/전체고객관리 페이지 소스와 개통 엑셀 샘플로 **좌표를 모두 확정**했습니다.
> 로그인 흐름·엑셀 경로·컬럼 매핑까지 실동작 기준으로 구현/검증됨. (남은 건 사장님 자격증명뿐)

## 확정된 동작
- **로그인**(Entersoft ASP): `m_id`/`m_passwd` 입력 → `아이디 인증`(`fnc_sms_chk`) →
  - SMS 불필요 계정: 바로 `로그인`(`fnc_login_regist`)
  - SMS 필요 계정: 휴대폰(`s_tel2`/`s_tel3`) → `인증받기`(`fnc_sms_send`) → 4자리(`last_sms`) → `로그인`
- **개통 엑셀**: `GET /customer/a_custom_goods_excel.asp?s_search_key=g_date_gaetong&s_date_start=…&s_date_end=…`
  ('엑셀저장' 버튼과 동일한 GET. 반환은 EUC-KR HTML 테이블 → 자체 파싱, 별도 라이브러리 불필요)
- **지난주**: 오늘 기준 지난주 월~일 자동 계산 (예: 8/13 실행 → 8/3~8/9)
- **협력점 컬럼**으로 업체 판정, 기존 업체(시트)와 대조

## 설치 (최초 1회)
필요: **Node.js 18+** (https://nodejs.org)

```bash
cd partner-sync
npm install            # playwright + 크로미움
cp config.example.json config.json
```
`config.json` 에서 `API_URL`(Apps Script 웹앱 URL)만 채우면 됩니다. `BASE_URL`/`LOGIN_URL` 은 navergg 기본값.

## 실행
```bash
npm start        # → http://localhost:4180
```
1. 아이디 / 비밀번호 입력
2. **휴대폰 SMS 인증 필요** 체크박스 — OTP 없이 로그인되는 계정(사장님)은 **해제**
   - 체크 시: 휴대폰 중간·끝자리 입력 → 실행하면 문자 발송 → **열린 브라우저 창의 [인증번호]에 4자리 입력**하면 자동 진행
3. **미리보기(반영 안 함)** 로 먼저 확인 → 이상 없으면 **동기화 실행**

## 하는 일
- 새 협력점이 **지난주 첫 개통** → 자동 감지·분류·추가 (판매점/협력점/자점, 무선개통 항상 Y 등 규칙 적용)
- 기존 업체의 **구분 기호가 바뀜(★→■ 등)** → **구분변경 감지**로 표시(자동 덮어쓰지 않음, 확인용)

## 검증 완료
- 실제 지난주 개통 엑셀(2,470건, 고유 103업체) 파싱 → 기존 마스터 대비 **신규 0(오탐 없음)**
- 임의로 마스터에서 2곳 제거 시 정확히 신규 2건 감지, ★→■ 변경도 정확히 감지
- 로그인 흐름은 페이지 소스의 실제 함수/필드로 구현(자격증명 필요로 최종 로그인만 사장님 PC에서 확인)

## 보안
- 자격증명은 폼 입력 → 로컬 서버(localhost)로만 전송, **디스크 저장 안 함**
- `config.json` 은 `.gitignore` 처리(저장소 미포함)
- 비밀번호를 채팅/코드에 넣지 마세요. (이미 노출된 비번은 교체 권장)

## 파일
```
server.js                 로컬 서버(폼 서빙 + /sync)
ui.html                   입력 폼 + 실행로그 + 결과표
lib/sync.js               로그인 + 개통 엑셀 다운로드 + 동기화
lib/parseActivations.js   EUC-KR HTML(.xls) 개통표 파서
lib/diff.js               신규/구분변경 감지
lib/classify.js           분류 엔진(프론트·seed 와 동일 규칙)
lib/sheet.js              Apps Script API 읽기/쓰기
config.example.json       설정 템플릿
```
