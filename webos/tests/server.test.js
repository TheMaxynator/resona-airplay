'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeReceiver } = require('../app/receiver-server');

async function fixture(t, extra) {
  const receiver = makeReceiver(extra);
  await new Promise(r => receiver.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { receiver.server.closeAllConnections(); receiver.server.close(r); }));
  const base = 'http://127.0.0.1:' + receiver.server.address().port;
  async function request(route, data, token, headers) {
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, headers), body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function display() { return (await request('/api/display', undefined, receiver.getDisplayToken())).data; }
  async function pair() { await display(); return (await request('/api/pair', { code: receiver.getCode() })).data.token; }
  return { receiver, base, request, display, pair };
}
const tracks = [{ id: 'first', url: 'https://example.org/first.mp3', title: '<b>First</b>', artist: 'A', duration: 60 }, { id: 'second', url: 'https://example.org/second.m3u8', title: 'Second', artist: 'B', duration: 120 }];

test('requires the on-screen code and blocks unpaired commands and cross-site requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/command', { type: 'load', tracks })).status, 401);
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/pair', { code: 'wrong' })).status, 403);
  const token = await f.pair(); assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await f.request('/api/command', { type: 'load', tracks }, token, { Origin: 'https://another-site.example' })).status, 403);
  assert.equal((await f.request('/api/command', { type: 'load', tracks }, token)).status, 200);
  assert.equal((await f.request('/api/state', undefined, token)).data.track.title, '<b>First</b>');
});
test('rate-limits PIN guesses, expires PINs, and revokes sessions from the TV', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/api/pair', { code: 'bad' })).status, 403);
  assert.equal((await f.request('/api/pair', { code: 'bad' })).status, 429);
  now += 61000; const token = await f.pair();
  now += 301000; assert.equal((await f.request('/api/pair', { code: f.receiver.getCode() })).status, 403);
  await f.request('/api/pair/reset', {}, f.receiver.getDisplayToken());
  assert.equal((await f.request('/api/state', undefined, token)).status, 401);
});
test('validates every queued URL atomically and rejects executable or local file URLs', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks }, token);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.org/audio.mp3']) {
    assert.equal((await f.request('/api/command', { type: 'load', tracks: [tracks[0], { url }] }, token)).status, 400);
    assert.equal((await f.request('/api/state', undefined, token)).data.queue.length, 2);
  }
  assert.equal((await f.request('/api/command', { type: 'seek', position: -1 }, token)).status, 400);
  assert.equal((await f.request('/api/command', { type: 'load', tracks: [] }, token)).status, 400);
});
test('the TV advances the queue without a sender; late end events never skip another track', async t => {
  const f = await fixture(t), token = await f.pair();
  const load = await f.request('/api/command', { type: 'load', tracks }, token);
  const generation = load.data.generation;
  const ended = { generation, trackId: 'first', state: 'ended', position: 60, duration: 60 };
  await f.request('/api/display/report', ended, f.receiver.getDisplayToken());
  let state = await f.display(); assert.equal(state.track.id, 'second'); assert.equal(state.desiredPlaying, true);
  assert.equal((await f.request('/api/display/report', ended, f.receiver.getDisplayToken())).data.ignored, true);
  state = await f.display(); assert.equal(state.track.id, 'second'); assert.equal(state.generation, generation + 1);
});
test('clears stale artwork and commands follow load, pause, seek, and stop', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks: [Object.assign({}, tracks[0], { artworkUrl: 'https://example.org/cover.jpg' }), tracks[1]] }, token);
  await f.request('/api/command', { type: 'next' }, token);
  assert.equal((await f.display()).track.artworkUrl, '');
  await f.request('/api/command', { type: 'pause' }, token);
  assert.equal((await f.display()).desiredPlaying, false);
  await f.request('/api/command', { type: 'seek', position: 999 }, token);
  assert.equal((await f.display()).position, 120);
  await f.request('/api/command', { type: 'stop' }, token);
  assert.equal((await f.display()).track, null);
});
test('persists only display preferences, without stream URLs or pairing credentials', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resona-test-')); t.after(() => fs.rmSync(dataDir, { force: true, recursive: true }));
  const f = await fixture(t, { dataDir }), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks }, token);
  assert.equal((await f.request('/api/command', { type: 'preferences', preferences: { layout: 'night', dim: 0.8, progress: false } }, token)).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json')));
  assert.deepEqual(saved, { layout: 'night', dim: 0.8, progress: false });
  assert.deepEqual(fs.readdirSync(dataDir), ['preferences.json']);
  assert.equal((await f.request('/api/command', { type: 'preferences', preferences: { dim: 5 } }, token)).status, 400);
});
test('health supports the packaged bootstrap while API responses do not permit cross-origin control', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).headers.get('access-control-allow-origin'), '*');
  assert.equal((await f.request('/api/state')).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(f.base + '/receiver-server.js')).status, 404);
  assert.equal((await fetch(f.base + '/%2e%2e/receiver-server.js')).status, 404);
  assert.equal((await fetch(f.base + '/api/command', { method: 'POST', body: 'oops' })).status, 415);
});
test('serves MP3 byte ranges so native media players can seek', async t => {
  const f = await fixture(t);
  const original = await fetch(f.base + '/demo.mp3'); const bytes = Buffer.from(await original.arrayBuffer());
  const result = await fetch(f.base + '/demo.mp3', { headers: { Range: 'bytes=100-299' } });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('content-range'), 'bytes 100-299/' + bytes.length);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes.subarray(100, 300));
  assert.equal((await fetch(f.base + '/demo.mp3', { headers: { Range: 'bytes=99999999-' } })).status, 416);
});
