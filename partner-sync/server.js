/**
 * 로컬 동기화 서버 — 사장님 PC에서 실행.
 *   node server.js  →  http://localhost:4180 접속
 * 폼에서 아이디/비번/(선택)OTP 입력 → 로그인·수집·시트반영. 자격증명은 이 PC 밖으로 안 나감.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runSync } = require('./lib/sync');

const PORT = process.env.PORT || 4180;
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json 이 없습니다. config.example.json 을 복사해 만드세요.');
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'POST' && req.url === '/sync') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (obj) => res.write(JSON.stringify(obj) + '\n');
      try {
        const config = loadConfig();
        const creds = { id: payload.id, pw: payload.pw, useOtp: !!payload.useOtp, otp: payload.otp };
        if (!creds.id || !creds.pw) throw new Error('아이디/비밀번호를 입력하세요.');
        const result = await runSync({
          config, creds, dryRun: !!payload.dryRun,
          onLog: (m) => send({ type: 'log', msg: m }),
        });
        send({ type: 'result', data: result });
      } catch (err) {
        send({ type: 'error', msg: String(err && err.message || err) });
      }
      res.end();
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log('협력점 동기화 도구: http://localhost:' + PORT);
});
