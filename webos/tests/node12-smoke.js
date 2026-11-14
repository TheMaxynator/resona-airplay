'use strict';
// Runs using the same Node major version as webOS 23, without node:test/fetch.
const http = require('http');
const assert = require('assert');
const receiver = require('../app/receiver-server').makeReceiver({ addresses: ['192.168.1.50'] });
function request(route, data, token, extra) {
  return new Promise((resolve, reject) => {
    const encoded = data === undefined ? null : Buffer.from(JSON.stringify(data));
    const headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, extra);
    if (encoded) headers['Content-Length'] = encoded.length;
    const req = http.request({ hostname: '127.0.0.1', port: receiver.server.address().port, path: route, method: encoded ? 'POST' : 'GET', headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); if (encoded) req.write(encoded); req.end();
  });
}
receiver.server.listen(0, '127.0.0.1', async () => {
  try {
    assert.strictEqual((await request('/health')).status, 200);
    await request('/api/display', undefined, receiver.getDisplayToken());
    const pair = await request('/api/pair', { code: receiver.getCode() });
    const token = JSON.parse(pair.body).token; assert.strictEqual(token.length, 64);
    assert.strictEqual((await request('/api/command', { type: 'load', tracks: [{ url: 'https://example.org/test.mp3', title: 'Node 12 check' }] }, token)).status, 200);
    const display = JSON.parse((await request('/api/display', undefined, receiver.getDisplayToken())).body);
    assert.strictEqual(display.track.title, 'Node 12 check');
    assert.strictEqual((await request('/demo.mp3', undefined, undefined, { Range: 'bytes=0-31' })).body.length, 32);
    console.log('PASS: Node ' + process.versions.node + ' receiver startup, pairing, queue and audio range requests.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { receiver.server.close(); }
});
