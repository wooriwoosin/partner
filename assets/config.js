/**
 * 협력점 관리앱 설정
 * ------------------------------------------------------------
 * 1) Apps Script 웹앱을 배포하고 나온 URL 을 API_URL 에 붙여넣으세요.
 *    (예: https://script.google.com/macros/s/AKfycbwpPoh6roZkZ0Xp_UJQAUqE7cylo7U68ZShSpDxnmP81psgPngz_Y2WaMor_Zy-igsCvw/exec)
 * 2) API_URL 이 비어있으면 data/seed.json 을 읽는 "데모(읽기전용) 모드" 로 동작합니다.
 * 3) Apps Script Code.gs 의 WRITE_TOKEN 을 설정했다면 아래 WRITE_TOKEN 도 동일하게 맞추세요.
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwpPoh6roZkZ0Xp_UJQAUqE7cylo7U68ZShSpDxnmP81psgPngz_Y2WaMor_Zy-igsCvw/exec',
  WRITE_TOKEN: '',      // <-- Code.gs 의 WRITE_TOKEN 과 동일하게 (안 쓰면 빈칸)
  SHEET_ID: '1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc',
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1shhA5RdXP7DiaMIyR33bTG2jFj4SFqumYflY0lF0pwc/edit',
};
