'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeReceiver } = require('../app/receiver-server');
const { peaks, allowed } = require('../app/waveform');

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
test('late artwork updates the current track without reloading or seeking audio', async t => {
  const f = await fixture(t), token = await f.pair();
  const load = await f.request('/api/command', { type: 'load', tracks, autoplay: false, position: 19 }, token);
  const generation = load.data.generation;
  const cover = 'data:image/jpeg;base64,/9j/2Q==';
  const before = await f.display();
  const update = await f.request('/api/command', { type: 'artwork', generation, trackId: 'first', artworkRevision: 2, artworkUrl: cover }, token);
  assert.equal(update.status, 200);
  const after = await f.display();
  assert.equal(after.generation, generation); assert.equal(after.position, 19);
  assert.equal(after.desiredPlaying, false); assert.equal(after.track.artworkUrl, cover);
  assert.deepEqual(after.queue, before.queue);
  assert.equal(after.commands.at(-1).type, 'artwork');
  assert.equal((await f.request('/api/command', { type: 'artwork', generation, trackId: 'first', artworkRevision: 1, artworkUrl: 'https://example.org/stale.jpg' }, token)).data.ignored, true);
  assert.equal((await f.display()).track.artworkUrl, cover);
  await f.request('/api/command', { type: 'next' }, token);
  assert.equal((await f.request('/api/command', { type: 'artwork', generation, trackId: 'first', artworkRevision: 3, artworkUrl: cover }, token)).data.ignored, true);
  assert.equal((await f.display()).track.id, 'second'); assert.equal((await f.display()).track.artworkUrl, '');
});
test('cover updates require pairing and reject unsafe URLs and oversized data', async t => {
  const f = await fixture(t), token = await f.pair();
  const load = await f.request('/api/command', { type: 'load', tracks }, token);
  const command = { type: 'artwork', generation: load.data.generation, trackId: 'first', artworkRevision: 1 };
  assert.equal((await f.request('/api/command', Object.assign({}, command, { artworkUrl: 'https://example.org/cover.jpg' }))).status, 401);
  for (const artworkUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + 'A'.repeat(220000)]) {
    assert.equal((await f.request('/api/command', Object.assign({}, command, { artworkUrl }), token)).status, 400);
    assert.equal((await f.display()).track.artworkUrl, '');
  }
});
test('a native queue starting at a middle entry supports next, previous and duplicate songs', async t => {
  const f = await fixture(t), token = await f.pair();
  const queue = [Object.assign({}, tracks[0], { id: 'slot-1' }), Object.assign({}, tracks[0], { id: 'slot-2' }), Object.assign({}, tracks[1], { id: 'slot-3' })];
  await f.request('/api/command', { type: 'load', tracks: queue, index: 1, autoplay: false }, token);
  assert.equal((await f.display()).index, 1);
  await f.request('/api/command', { type: 'next' }, token);
  assert.equal((await f.display()).track.id, 'slot-3');
  await f.request('/api/command', { type: 'previous' }, token);
  assert.equal((await f.display()).track.id, 'slot-2');
  await f.request('/api/command', { type: 'previous' }, token);
  assert.equal((await f.display()).track.id, 'slot-1');
});
test('persists display preferences separately from hashed trusted devices, without streams or raw tokens', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resona-test-')); t.after(() => fs.rmSync(dataDir, { force: true, recursive: true }));
  const f = await fixture(t, { dataDir }), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks }, token);
  assert.equal((await f.request('/api/command', { type: 'preferences', preferences: { layout: 'night', dim: 0.8, progress: false } }, token)).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json')));
  assert.deepEqual(saved, { layout: 'night', dim: 0.8, progress: false, waveform: false,
    progressModes: { cinema: 'always', gallery: 'always', ambient: 'always', night: 'always' } });
  assert.deepEqual(fs.readdirSync(dataDir), ['paired-devices.json', 'preferences.json']);
  const devices = fs.readFileSync(path.join(dataDir, 'paired-devices.json'), 'utf8');
  assert.ok(!devices.includes(token)); assert.ok(!devices.includes(tracks[0].url));
  assert.equal(fs.statSync(path.join(dataDir, 'paired-devices.json')).mode & 511, 384);
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
test('stops an inactive display receiver even when a phone keeps its HTTP connection alive', { timeout: 15000 }, async t => {
  let now = Date.now();
  const f = await fixture(t, { now: () => now, idleTimeout: 120000 });
  const token = await f.pair();
  const closed = new Promise(resolve => f.receiver.server.once('close', resolve));
  const polling = setInterval(() => f.request('/api/state', undefined, token).catch(() => {}), 200);
  t.after(() => clearInterval(polling));
  now += 121000;
  await closed;
  assert.equal(f.receiver.server.listening, false);
});
test('an app update replaces only its own helper on the requested port', { timeout: 15000 }, async t => {
  async function port() {
    const probe = require('node:net').createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const value = probe.address().port; await new Promise(r => probe.close(r)); return value;
  }
  async function start(number, replace) {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../app/receiver-server.js'), '--host', '127.0.0.1', '--port', String(number)].concat(replace ? ['--replace'] : []), { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve); child.once('error', reject);
      child.once('exit', code => reject(new Error('Receiver exited before startup: ' + code)));
    });
    return child;
  }
  const target = await port(), other = await port();
  const original = await start(target), unrelated = await start(other);
  const exited = new Promise(resolve => original.once('exit', resolve));
  await start(target, true); await exited;
  assert.equal((await (await fetch('http://127.0.0.1:' + target + '/health')).json()).version, '0.2.0');
  assert.equal((await fetch('http://127.0.0.1:' + other + '/health')).status, 200);
  assert.equal(unrelated.exitCode, null); assert.equal(unrelated.signalCode, null);
});
test('normalizes the actual stylized uploader name without stripping accents or other scripts', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks: [Object.assign({}, tracks[0], { artist: '𝙎𝙐𝘽𝘾𝙐𝙇𝙏𝙐𝙐𝙍' })] }, token);
  assert.equal((await f.display()).track.artist, 'SUBCULTUUR');
  await f.request('/api/command', { type: 'load', tracks: [Object.assign({}, tracks[0], { artist: 'Björk · Zoë · 東京 🎶' })] }, token);
  assert.equal((await f.display()).track.artist, 'Björk · Zoë · 東京 🎶');
});
test('saves separate progress modes, reloads them and rejects invalid patches atomically', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resona-modes-')); t.after(() => fs.rmSync(dataDir, { force: true, recursive: true }));
  const f = await fixture(t, { dataDir }), token = await f.pair();
  await f.request('/api/command', { type: 'preferences', preferences: { progressModes: { cinema: 'auto', gallery: 'always', ambient: 'auto', night: 'always' }, waveform: true } }, token);
  const saved = (await f.display()).preferences;
  for (const progressModes of [{ gallery: 'wrong' }, { missing: 'auto' }, [], null]) {
    assert.equal((await f.request('/api/command', { type: 'preferences', preferences: { layout: 'night', progressModes } }, token)).status, 400);
    assert.deepEqual((await f.display()).preferences, saved);
  }
  const restarted = await fixture(t, { dataDir }); assert.deepEqual((await restarted.display()).preferences, saved);
  await restarted.request('/api/command', { type: 'preferences', preferences: { progressModes: { gallery: 'auto' } } }, restarted.receiver.getDisplayToken());
  assert.equal((await restarted.display()).preferences.progressModes.cinema, 'auto');
  assert.equal((await f.display()).preferences.progressModes.gallery, 'always');
});
test('compact polling skips unchanged inline artwork but resynchronizes new covers and tracks', async t => {
  const f = await fixture(t), token = await f.pair(), cover = 'data:image/jpeg;base64,' + 'A'.repeat(80000);
  const load = await f.request('/api/command', { type: 'load', tracks: [Object.assign({}, tracks[0], { artworkUrl: cover }), tracks[1]] }, token);
  const full = await f.display();
  const compact = (await f.request('/api/display?after=' + load.data.sequence + '&known=' + full.trackVersion, undefined, f.receiver.getDisplayToken())).data;
  assert.equal(compact.track.artworkUrl, undefined); assert.equal(compact.track.url, undefined);
  assert.equal(compact.track.title, full.track.title); assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 20);
  await f.request('/api/command', { type: 'artwork', generation: full.generation, trackId: 'first', artworkRevision: 1, artworkUrl: cover }, token);
  const changed = (await f.request('/api/display?known=' + full.trackVersion, undefined, f.receiver.getDisplayToken())).data;
  assert.equal(changed.track.artworkUrl, cover);
  await f.request('/api/command', { type: 'next' }, token);
  const next = (await f.request('/api/display?known=' + changed.trackVersion, undefined, f.receiver.getDisplayToken())).data;
  assert.equal(next.track.url, tracks[1].url);
});
test('waveform data is bounded, peak-preserving, and restricted to the public SoundCloud waveform host', () => {
  const samples = new Array(1800).fill(0); samples[75] = 140;
  const result = peaks({ samples, height: 140 });
  assert.equal(result.length, 240); assert.equal(Math.max(...result), 1);
  for (const data of [{ samples: [], height: 140 }, { samples: [NaN], height: 1 }, { samples: [141], height: 140 }, { samples: [0], height: 0 }, { samples: new Array(20001).fill(0), height: 140 }]) assert.throws(() => peaks(data));
  assert.equal(allowed('https://wave.sndcdn.com/BD4HLDld5F83_m.json'), true);
  for (const value of ['http://wave.sndcdn.com/x.json', 'https://evil.example/x.json', 'https://wave.sndcdn.com.evil.example/x.json', 'file:///etc/passwd', 'https://user:pass@wave.sndcdn.com/x.json']) assert.equal(allowed(value), false);
});

test('shared queue edits preserve playing audio, identity and position across controllers', async t => {
  const f = await fixture(t), first = await f.pair(), second = await f.pair();
  const loaded = await f.request('/api/command', { type: 'load', tracks, position: 23 }, first);
  let before = (await f.display()), revision = before.queueRevision;
  let added = await f.request('/api/command', { type: 'queue-add', tracks: [Object.assign({}, tracks[0], { sourceId: '42' })], placement: 'next', queueRevision: revision }, second);
  assert.equal(added.status, 200);
  let state = (await f.request('/api/state', undefined, first)).data;
  assert.equal(state.queue.length, 3); assert.equal(new Set(state.queue.map(x => x.id)).size, 3);
  assert.equal(state.queue[1].sourceId, '42'); assert.equal(state.generation, loaded.data.generation);
  assert.equal(state.track.id, 'first'); assert.equal(state.position, 23); assert.equal(state.desiredPlaying, true);
  const ids = state.queue.map(x => x.id).reverse(); revision = state.queueRevision;
  assert.equal((await f.request('/api/command', { type: 'queue-reorder', ids, queueRevision: revision }, first)).status, 200);
  state = (await f.display()); assert.equal(state.track.id, 'first'); assert.equal(state.index, 2);
  assert.equal(state.generation, before.generation); assert.equal(state.position, 23);
  assert.equal((await f.request('/api/command', { type: 'queue-remove', trackId: ids[0], queueRevision: state.queueRevision }, second)).status, 200);
  state = (await f.display()); assert.equal(state.track.id, 'first'); assert.equal(state.index, 1);
  assert.equal(state.commands.filter(x => x.type === 'load').length, 1);
  assert.equal((await f.request('/api/command', { type: 'queue-play', trackId: state.queue[0].id, queueRevision: state.queueRevision }, first)).status, 200);
  state = (await f.display()); assert.notEqual(state.track.id, 'first'); assert.equal(state.position, 0);
});

test('stale and malformed shared queue mutations are atomic, including slow replacement loads', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks }, token);
  let initial = (await f.display());
  for (const change of [
    { type: 'queue-add', placement: 'next', tracks: [{ url: 'file:///etc/passwd' }] },
    { type: 'queue-reorder', ids: ['first', 'first'] },
    { type: 'queue-remove', trackId: 'missing' },
    { type: 'queue-play', trackId: 'missing' }
  ]) {
    const reply = await f.request('/api/command', Object.assign({ queueRevision: initial.queueRevision }, change), token);
    assert.ok(reply.status >= 400); assert.deepEqual((await f.display()).queue, initial.queue);
    assert.equal(f.receiver.snapshot().generation, initial.generation);
  }
  await f.request('/api/command', { type: 'next' }, token);
  for (const type of ['queue-add', 'queue-remove', 'queue-reorder', 'queue-play', 'load']) {
    assert.equal((await f.request('/api/command', { type, queueRevision: initial.queueRevision, tracks, placement: 'last', trackId: 'first', ids: ['second', 'first'] }, token)).status, 409);
  }
  assert.equal(f.receiver.snapshot().track.id, 'second');
  const full = Array.from({ length: 100 }, (_, i) => Object.assign({}, tracks[0], { id: 'slot-' + i }));
  await f.request('/api/command', { type: 'load', tracks: full }, token);
  assert.equal((await f.request('/api/command', { type: 'queue-add', tracks: [tracks[0]], placement: 'last', queueRevision: f.receiver.snapshot().queueRevision }, token)).status, 400);
  assert.equal(f.receiver.snapshot().queue.length, 100);
});

test('removing current and final tracks has defined playback behavior and ignores old end events', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks }, token);
  const previous = f.receiver.snapshot();
  await f.request('/api/command', { type: 'queue-remove', trackId: 'first', queueRevision: previous.queueRevision }, token);
  assert.equal(f.receiver.snapshot().track.id, 'second'); assert.equal(f.receiver.snapshot().desiredPlaying, true);
  assert.equal((await f.request('/api/display/report', { generation: previous.generation, trackId: 'first', state: 'ended' }, f.receiver.getDisplayToken())).data.ignored, true);
  await f.request('/api/command', { type: 'queue-remove', trackId: 'second', queueRevision: f.receiver.snapshot().queueRevision }, token);
  assert.equal(f.receiver.snapshot().track, null); assert.equal(f.receiver.snapshot().queue.length, 0);
  await f.request('/api/command', { type: 'load', tracks, index: 1 }, token);
  await f.request('/api/command', { type: 'queue-remove', trackId: 'second', queueRevision: f.receiver.snapshot().queueRevision }, token);
  assert.equal(f.receiver.snapshot().track.id, 'first'); assert.equal(f.receiver.snapshot().desiredPlaying, false);
});

test('trusted devices survive receiver restart and remain individually revocable without storing tokens', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resona-trust-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await fixture(t, { dataDir }), token = await first.pair();
  await new Promise(resolve => { first.receiver.server.closeAllConnections(); first.receiver.server.close(resolve); });
  const restarted = await fixture(t, { dataDir }); await restarted.display();
  assert.equal((await restarted.request('/api/state', undefined, token)).status, 200);
  assert.equal(restarted.receiver.snapshot().pairedDevices, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'paired-devices.json'), 'utf8'));
  assert.equal(saved.length, 1); assert.notEqual(saved[0].hash, token); assert.match(saved[0].hash, /^[a-f0-9]{64}$/);
  const response = await fetch(restarted.base + '/api/session', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status, 200);
  const afterRevoke = await fixture(t, { dataDir });
  assert.equal((await afterRevoke.request('/api/state', undefined, token)).status, 401);
});

test('compact native state retains source IDs and HTTP covers while omitting streams and inline cover payloads', async t => {
  const f = await fixture(t), token = await f.pair();
  await f.request('/api/command', { type: 'load', tracks: [Object.assign({}, tracks[0], { sourceId: '2095439361', artworkUrl: 'data:image/jpeg;base64,/9j/2Q==', artworkRemoteUrl: 'https://example.org/cover.jpg' })] }, token);
  const value = (await f.request('/api/state?compact=1', undefined, token)).data;
  assert.equal(value.track.sourceId, '2095439361'); assert.equal(value.track.artworkUrl, 'https://example.org/cover.jpg');
  assert.equal(value.queue[0].sourceId, '2095439361'); assert.ok(!JSON.stringify(value).includes('base64'));
  assert.ok(!JSON.stringify(value).includes(tracks[0].url)); assert.equal(value.capabilities.queueEditing, true);
});

test('refreshing a signed current stream preserves its queue slot and position while replacing only its URL', async t => {
  const f = await fixture(t), token = await f.pair();
  const original = Object.assign({}, tracks[0], { sourceId: '42' });
  await f.request('/api/command', { type: 'load', tracks: [original, tracks[1]], position: 31 }, token);
  const before = f.receiver.snapshot();
  const refresh = { type: 'queue-refresh', trackId: 'first', queueRevision: before.queueRevision, tracks: [Object.assign({}, original, { id: 'new-temporary-id', url: 'https://example.org/refreshed.mp3' })] };
  assert.equal((await f.request('/api/command', refresh, token)).status, 200);
  const display = await f.display(); assert.equal(display.track.id, 'first'); assert.equal(display.position, 31);
  assert.equal(display.track.url, 'https://example.org/refreshed.mp3'); assert.equal(display.queue[1].id, 'second');
  assert.equal(display.generation, before.generation + 1);
  assert.equal((await f.request('/api/command', refresh, token)).status, 409);
});
