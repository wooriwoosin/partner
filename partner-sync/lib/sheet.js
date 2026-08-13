/**
 * Apps Script 웹앱 API 를 통해 구글시트(업체관리) 읽기/쓰기.
 * (프론트엔드 assets/config.js 와 같은 API 사용)
 */
'use strict';

async function listCompanies(config) {
  if (!config.API_URL) throw new Error('config.API_URL 이 비어있습니다.');
  const res = await fetch(config.API_URL + '?action=list');
  const data = await res.json();
  if (!data.ok) throw new Error('list 실패: ' + (data.error || ''));
  return data.companies || [];
}

async function upsertCompany(config, company) {
  const res = await fetch(config.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'upsert', token: config.WRITE_TOKEN || '', company }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('upsert 실패: ' + (data.error || ''));
  return data;
}

module.exports = { listCompanies, upsertCompany };
