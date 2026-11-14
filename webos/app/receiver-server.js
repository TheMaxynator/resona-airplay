'use strict';
// Node 12.22 compatible; no npm modules, shell execution, media proxy, or file API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VERSION = '0.1.0';
const LAYOUTS = ['cinema', 'gallery', 'ambient', 'night'];
const DEFAULTS = { layout: 'cinema', dim: 0.48, progress: true };
function fail(message, status) { const error = new Error(message); error.status = status || 400; throw error; }
function finite(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function url(value, artwork) {
  if (typeof value !== 'string') fail('Ongeldige streamlink.');
  if (artwork && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 220000) return value;
  if (value.length > 8192) fail('De link is te lang.');
  let parsed; try { parsed = new URL(value); } catch (_) { fail('Gebruik een volledige http(s)-link.'); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) fail('Gebruik een http(s)-link zonder gebruikersnaam of wachtwoord.');
  return parsed.href;
}
function track(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Ongeldig nummer.');
  return {
    id: String(value.id || ('track-' + index)).slice(0, 128),
    title: String(value.title || 'Onbekend nummer').slice(0, 300),
    artist: String(value.artist || '').slice(0, 300),
    url: url(value.url, false), artworkUrl: value.artworkUrl ? url(value.artworkUrl, true) : '',
    duration: finite(value.duration, 0, 604800) ? value.duration : 0
  };
}
function loopback(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}
function makeReceiver(options) {
  options = options || {};
  const clock = options.now || Date.now;
  const displayToken = crypto.randomBytes(32).toString('hex');
  let code, codeExpires, sessions = new Map(), failures = new Map();
  let revision = 0, generation = 0, queue = [], index = -1, position = 0;
  let desiredPlaying = false, state = 'idle', duration = 0, error = '';
  let preferences = Object.assign({}, DEFAULTS), commands = [], sequence = 0;
  let lastDisplay = 0;
  const dataDir = options.dataDir;
  if (dataDir) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf8'));
      if (LAYOUTS.indexOf(saved.layout) >= 0) preferences.layout = saved.layout;
      if (finite(saved.dim, 0.15, 0.9)) preferences.dim = saved.dim;
      if (typeof saved.progress === 'boolean') preferences.progress = saved.progress;
    } catch (_) {}
  }
  function newCode() { code = String(100000 + crypto.randomBytes(4).readUInt32BE(0) % 900000); codeExpires = clock() + 300000; }
  newCode();
  function online() { return lastDisplay > 0 && clock() - lastDisplay < 15000; }
  function current() { return queue[index] || null; }
  function snapshot(includeURLs) {
    const item = current();
    return { protocol: 1, version: VERSION, revision, generation, sequence, receiverOnline: online(),
      track: item ? (includeURLs ? item : { id: item.id, title: item.title, artist: item.artist, artworkUrl: item.artworkUrl, duration: item.duration }) : null,
      queue: queue.map((t, i) => ({ id: t.id, title: t.title, artist: t.artist, current: i === index })),
      index, state, position, duration: duration || (item && item.duration) || 0, desiredPlaying,
      error, preferences: Object.assign({}, preferences), pairedDevices: sessions.size };
  }
  function changed() { revision++; }
  function enqueue(type, extra) {
    sequence++;
    commands.push(Object.assign({ sequence, generation, type }, extra));
    if (commands.length > 40) commands.shift();
    changed();
  }
  function loadAt(next, start, play) {
    index = next; generation++; position = start || 0; duration = current().duration;
    state = 'loading'; error = ''; desiredPlaying = play;
    enqueue('load', { track: current(), position, autoplay: play });
  }
  function command(value) {
    if (!value || typeof value !== 'object') fail('Ongeldige opdracht.');
    if (value.type === 'load') {
      if (!Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > 100) fail('Kies 1 tot 100 nummers.');
      const nextQueue = value.tracks.map(track);
      const nextIndex = value.index === undefined ? 0 : value.index;
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= nextQueue.length) fail('Ongeldige wachtrijpositie.');
      const start = value.position === undefined ? 0 : value.position;
      if (!finite(start, 0, 604800)) fail('Ongeldige afspeelpositie.');
      queue = nextQueue; loadAt(nextIndex, start, value.autoplay !== false);
    } else if (value.type === 'preferences') {
      const patch = value.preferences || {};
      if (patch.layout !== undefined && LAYOUTS.indexOf(patch.layout) < 0) fail('Onbekend ontwerp.');
      if (patch.dim !== undefined && !finite(patch.dim, 0.15, 0.9)) fail('Ongeldige helderheid.');
      if (patch.progress !== undefined && typeof patch.progress !== 'boolean') fail('Ongeldige voortgangsinstelling.');
      ['layout', 'dim', 'progress'].forEach(k => { if (patch[k] !== undefined) preferences[k] = patch[k]; });
      if (dataDir) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 448 });
        fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify(preferences), { mode: 384 });
      }
      enqueue('preferences', { preferences });
    } else {
      if (!current()) fail('Kies eerst een nummer.');
      if (value.type === 'play' || value.type === 'pause') {
        desiredPlaying = value.type === 'play'; enqueue(value.type);
      } else if (value.type === 'seek') {
        if (!finite(value.position, 0, 604800)) fail('Ongeldige afspeelpositie.');
        position = duration > 0 ? Math.min(duration, value.position) : value.position;
        enqueue('seek', { position });
      } else if (value.type === 'next' || value.type === 'previous') {
        const next = index + (value.type === 'next' ? 1 : -1);
        if (next >= 0 && next < queue.length) loadAt(next, 0, true);
        else if (value.type === 'previous') { position = 0; enqueue('seek', { position: 0 }); }
        else { desiredPlaying = false; enqueue('pause'); }
      } else if (value.type === 'stop') {
        desiredPlaying = false; state = 'idle'; queue = []; index = -1; position = 0; duration = 0;
        generation++; enqueue('stop');
      } else fail('Onbekende opdracht.');
    }
    return { accepted: true, generation, revision, sequence };
  }
  function addresses() {
    if (options.addresses) return options.addresses;
    const found = [];
    let interfaces; try { interfaces = os.networkInterfaces(); } catch (_) { return found; }
    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(item => { if ((item.family === 'IPv4' || item.family === 4) && !item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) found.push(item.address); });
    });
    return found;
  }
  function body(request) {
    return new Promise((resolve, reject) => {
      let size = 0, chunks = [];
      request.on('data', chunk => {
        size += chunk.length;
        if (size > 524288) { chunks = []; reject(Object.assign(new Error('De opdracht is te groot.'), { status: 413 })); }
        else chunks.push(chunk);
      });
      request.on('end', () => { if (size > 524288) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(Object.assign(new Error('Ongeldige JSON.'), { status: 400 })); } });
      request.on('error', reject);
    });
  }
  function bearer(request) { const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization || ''); return match && match[1]; }
  function displayAuth(request) { return loopback(request.socket.remoteAddress) && equal(bearer(request), displayToken); }
  function remoteAuth(request) { const token = bearer(request); return token && sessions.has(token); }
  function originCheck(request) {
    const origin = request.headers.origin;
    if (!origin) return; // Native sender has no browser Origin header.
    if (origin !== 'http://' + request.headers.host) fail('Deze website mag de tv niet bedienen.', 403);
  }
  function respond(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  }
  const staticFiles = {
    '/': ['remote.html', 'text/html'], '/remote': ['remote.html', 'text/html'],
    '/remote.js': ['remote.js', 'application/javascript'], '/remote.css': ['remote.css', 'text/css'],
    '/tv.js': ['tv.js', 'application/javascript'], '/tv.css': ['tv.css', 'text/css'],
    '/vendor/qrcode.js': ['vendor/qrcode.js', 'application/javascript'],
    '/vendor/webOSTV.js': ['vendor/webOSTV.js', 'application/javascript'],
    '/demo-cover.svg': ['demo-cover.svg', 'image/svg+xml'], '/demo.mp3': ['demo.mp3', 'audio/mpeg']
  };
  const server = http.createServer(async (request, response) => {
    try {
      // Reject alternate hostnames to limit DNS rebinding. Only numeric local addresses are used.
      const host = (request.headers.host || '').split(':')[0];
      if (!/^(127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) fail('Gebruik het lokale IP-adres van de tv.', 403);
      const parsed = new URL(request.url, 'http://127.0.0.1');
      const route = parsed.pathname;
      if (request.method === 'GET' && route === '/health') { response.setHeader('Access-Control-Allow-Origin', '*'); return respond(response, 200, { name: 'Resona TV', version: VERSION, protocol: 1, receiverOnline: online() }); }
      if (request.method === 'GET' && route === '/tv') {
        if (!loopback(request.socket.remoteAddress)) fail('Open de tv-app op de tv zelf.', 403);
        lastDisplay = clock();
        const html = fs.readFileSync(path.join(__dirname, 'tv.html'), 'utf8').replace('RESONA_DISPLAY_TOKEN', displayToken);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(html); return;
      }
      if (request.method === 'GET' && route === '/api/display') {
        if (!displayAuth(request)) fail('Geen toegang tot het tv-scherm.', 403);
        lastDisplay = clock(); if (clock() > codeExpires) newCode();
        const after = Number(parsed.searchParams.get('after') || 0);
        const state = snapshot(true);
        return respond(response, 200, Object.assign(state, { code, codeExpires, urls: addresses().map(ip => 'http://' + ip + ':' + server.address().port), commands: commands.filter(c => c.sequence > after) }));
      }
      if (request.method === 'POST') {
        originCheck(request);
        if ((request.headers['content-type'] || '').split(';')[0] !== 'application/json') fail('Gebruik application/json.', 415);
        if (route === '/api/pair') {
          const ip = request.socket.remoteAddress;
          let attempts = failures.get(ip);
          if (!attempts || clock() - attempts.start > 60000) { attempts = { start: clock(), count: 0 }; failures.set(ip, attempts); }
          if (++attempts.count > 6) fail('Wacht een minuut en probeer opnieuw.', 429);
          const data = await body(request);
          if (clock() > codeExpires || !equal(String(data.code || ''), code)) fail('De koppelcode is niet juist of verlopen.', 403);
          if (!online()) fail('Open eerst Resona TV op de televisie.', 409);
          if (sessions.size >= 8) fail('Er zijn al acht apparaten gekoppeld. Vernieuw de koppeling op de tv.', 409);
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, String(data.name || 'iPhone').slice(0, 100));
          changed(); return respond(response, 200, { token, name: 'Resona TV', protocol: 1 });
        }
        if (route === '/api/display/report') {
          if (!displayAuth(request)) fail('Geen toegang.', 403);
          const data = await body(request); lastDisplay = clock();
          if (data.generation !== generation || !current() || data.trackId !== current().id) return respond(response, 200, { ignored: true });
          if (['ready', 'playing', 'paused', 'buffering', 'error', 'ended'].indexOf(data.state) < 0) fail('Ongeldige afspeelstatus.');
          state = data.state;
          position = finite(data.position, 0, 604800) ? data.position : 0;
          duration = finite(data.duration, 0, 604800) ? data.duration : current().duration;
          error = String(data.error || '').slice(0, 240);
          if (data.state === 'error' || data.state === 'ended') desiredPlaying = false;
          if (data.state === 'ended' && index + 1 < queue.length) loadAt(index + 1, 0, true);
          else changed();
          return respond(response, 200, { accepted: true });
        }
        if (route === '/api/pair/reset') {
          if (!displayAuth(request)) fail('Vernieuw de koppeling op de tv.', 403);
          sessions.clear(); failures.clear(); newCode(); changed(); return respond(response, 200, { accepted: true });
        }
        if (route === '/api/command') {
          if (!displayAuth(request) && !remoteAuth(request)) fail('Koppel je iPhone eerst met de tv.', 401);
          if (!online()) fail('De tv-app is niet verbonden.', 409);
          return respond(response, 200, command(await body(request)));
        }
      }
      if (request.method === 'GET' && route === '/api/state') {
        if (!remoteAuth(request) && !displayAuth(request)) fail('Koppel je iPhone eerst met de tv.', 401);
        return respond(response, 200, snapshot(false));
      }
      if (request.method === 'DELETE' && route === '/api/session') {
        originCheck(request); if (!remoteAuth(request)) fail('Niet gekoppeld.', 401);
        sessions.delete(bearer(request)); changed(); return respond(response, 200, { accepted: true });
      }
      if (request.method === 'GET' && staticFiles[route]) {
        const entry = staticFiles[route], bytes = fs.readFileSync(path.join(__dirname, entry[0]));
        const headers = { 'Content-Type': entry[1], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', 'Content-Length': bytes.length,
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src https: http:; connect-src 'self'; frame-ancestors 'none'" };
        if (entry[1] === 'audio/mpeg') {
          headers['Accept-Ranges'] = 'bytes';
          if (request.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
            let start = range && range[1] ? Number(range[1]) : 0;
            let end = range && range[2] ? Number(range[2]) : bytes.length - 1;
            if (range && !range[1] && range[2]) { start = Math.max(0, bytes.length - Number(range[2])); end = bytes.length - 1; }
            if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes.length || end < start) {
              response.writeHead(416, { 'Content-Range': 'bytes */' + bytes.length, 'Content-Length': 0 }); response.end(); return;
            }
            end = Math.min(end, bytes.length - 1);
            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + bytes.length;
            headers['Content-Length'] = end - start + 1;
            response.writeHead(206, headers); response.end(bytes.slice(start, end + 1)); return;
          }
        }
        response.writeHead(200, headers); response.end(bytes); return;
      }
      fail('Niet gevonden.', 404);
    } catch (caught) { if (!response.headersSent) respond(response, caught.status || 500, { error: caught.status ? caught.message : 'De tv kon de opdracht niet verwerken.' }); else response.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const idle = setInterval(() => { if (options.idleTimeout && clock() - lastDisplay > options.idleTimeout) server.close(); }, 10000);
  idle.unref();
  server.on('close', () => clearInterval(idle));
  return { server, command, snapshot, getCode: () => code, getDisplayToken: () => displayToken };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  function arg(name, fallback) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
  const port = Number(arg('--port', '42700'));
  const host = arg('--host', '0.0.0.0');
  const receiver = makeReceiver({ dataDir: arg('--data-dir', path.join(os.tmpdir(), 'resona-tv-' + process.getuid())), idleTimeout: 120000 });
  receiver.server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Resona TV is already running on this port.' : 'Unable to start Resona TV: ' + e.code); process.exitCode = 1; });
  receiver.server.listen(port, host, () => console.log('Resona TV receiver listening on port ' + receiver.server.address().port));
}
module.exports = { makeReceiver, track, url, loopback, VERSION };
