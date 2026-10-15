/**
 * 협력점 관리앱 설정
 * ------------------------------------------------------------
 * 1) API_URL = 수파베이스 Edge Function 주소
 *    https://<프로젝트ref>.supabase.co/functions/v1/api
 *    ※ <프로젝트ref> 는 대시보드 주소 .../dashboard/project/여기 에 있는 문자열입니다.
 * 2) API_URL 이 비어있으면 data/seed.json 을 읽는 "데모(읽기전용) 모드" 로 동작합니다.
 * 3) API_KEY 는 Edge Function 의 "키 검사(Verify JWT)" 를 끄지 못했을 때만 채웁니다.
 *    공개 키(publishable/anon)만 넣을 것 — secret/service_role 키는 절대 금지.
 */
window.APP_CONFIG = {
  // ▼ 현재 운영 중 (앱스크립트). 수파베이스 ping 확인되면 아래 줄과 맞바꾼다.
  API_URL: 'https://script.google.com/macros/s/AKfycbxPoVd7ZZaOj35mxKyZpNixlG6pcRMybJh63t1vOt6CT-PfS8r4pMtG14h0HXhKdx7c5A/exec',
  // API_URL: 'https://iwfiilgjiqkdsuybqwwk.supabase.co/functions/v1/api',   // ← 전환 예정
  // 수파베이스 Edge Function 이 "키 검사" 켜진 채로 배포됐을 때만 채운다.
  // 공개해도 되는 키(publishable/anon)만 넣을 것. secret/service_role 키는 절대 금지.
  API_KEY: '',
  WRITE_TOKEN: '',      // <-- Code.gs 의 WRITE_TOKEN 과 동일하게 (안 쓰면 빈칸)
  SHEET_ID: '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc',
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc/edit',
};
