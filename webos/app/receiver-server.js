'use strict';
// Node 12.22 compatible; no npm modules, shell execution, media proxy, or file API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { parseChapters, listeningHistory } = require('./session');

const VERSION = '0.3.0';
const LAYOUTS = ['cinema', 'gallery', 'ambient', 'night', 'studio'];
const DEFAULTS = { layout: 'gallery', dim: 0.48, progress: true, waveform: false, upNext: true };
const PRESETS = { gallery: { layout: 'gallery', dim: .35, waveform: false, mode: 'always' },
  studio: { layout: 'studio', dim: .55, waveform: true, mode: 'always' },
  night: { layout: 'night', dim: .82, waveform: false, mode: 'auto' } };
function progressModes() { return { cinema: 'always', gallery: 'always', ambient: 'always', night: 'always', studio: 'always' }; }
function modePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => LAYOUTS.indexOf(key) < 0 || ['auto', 'always'].indexOf(value[key]) < 0)) fail('Ongeldige balkinstelling.');
  return value;
}
function displayText(value, fallback) { return String(value || fallback || '').normalize('NFKC').slice(0, 300); }
function waveformLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'wave.sndcdn.com' &&
    !u.username && !u.password && !u.port && /\.json$/.test(u.pathname) ? u.href : ''; } catch (_) { return ''; }
}
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
    sourceId: /^[1-9]\d{0,17}$/.test(String(value.sourceId || '')) ? String(value.sourceId) : '',
    artworkRemoteUrl: value.artworkRemoteUrl ? url(value.artworkRemoteUrl, false) : '',
    title: displayText(value.title, 'Onbekend nummer'),
    artist: displayText(value.artist), waveformUrl: waveformLink(value.waveformUrl),
    chapters: parseChapters(value.chapterText, value.duration),
    url: url(value.url, false), artworkUrl: value.artworkUrl ? url(value.artworkUrl, true) : '',
    duration: finite(value.duration, 0, 604800) ? value.duration : 0
  };
}
function publicArtwork(item) { return item.artworkRemoteUrl || (/^https?:/.test(item.artworkUrl) ? item.artworkUrl : ''); }
function uniqueTracks(values, existing) {
  const used = new Set((existing || []).map(item => item.id));
  return values.map(track).map(item => {
    while (used.has(item.id)) item.id = item.id.slice(0, 100) + '-' + crypto.randomBytes(8).toString('hex');
    used.add(item.id); return item;
  });
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
  let revision = 0, generation = 0, queueRevision = 0, queue = [], index = -1, position = 0;
  let desiredPlaying = false, state = 'idle', duration = 0, error = '';
  let artworkRevision = 0;
  let preferences = Object.assign({}, DEFAULTS, { progressModes: progressModes() }), commands = [], sequence = 0;
  function appearance() { return Object.assign({}, preferences, { progressModes: Object.assign({}, preferences.progressModes) }); }
  const startedAt = clock();
  let lastDisplay = 0;
  const dataDir = options.dataDir;
  const history = listeningHistory(dataDir, clock);
  let resumePosition = 0, sleepTimer = null, sleepTimeout, sleepStoppedGeneration = -1;
  function clearSleep() { clearTimeout(sleepTimeout); sleepTimer = null; }
  function checkSleep() {
    if (sleepTimer && sleepTimer.mode === 'minutes' && clock() >= sleepTimer.deadline) {
      clearSleep(); desiredPlaying = false; sleepStoppedGeneration = generation; enqueue('pause');
    }
  }
  function seekTo(target) {
    position = duration > 0 ? Math.min(duration, target) : target;
    enqueue('seek', { position });
  }
  function applyPreferences(patch) {
    if (patch.layout !== undefined && LAYOUTS.indexOf(patch.layout) < 0) fail('Onbekend ontwerp.');
    if (patch.dim !== undefined && !finite(patch.dim, 0.15, 0.9)) fail('Ongeldige helderheid.');
    ['progress', 'waveform', 'upNext'].forEach(key => { if (patch[key] !== undefined && typeof patch[key] !== 'boolean') fail('Ongeldige weergave-instelling.'); });
    if (patch.progressModes !== undefined) modePatch(patch.progressModes);
    ['layout', 'dim', 'progress', 'waveform', 'upNext'].forEach(key => { if (patch[key] !== undefined) preferences[key] = patch[key]; });
    if (patch.progressModes) Object.assign(preferences.progressModes, patch.progressModes);
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 448 });
      fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify(preferences), { mode: 384 });
    }
    enqueue('preferences', { preferences: appearance() });
  }
  function sessionKey(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
  function saveSessions() {
    if (!dataDir) return;
    fs.mkdirSync(dataDir, { recursive: true, mode: 448 });
    const temporary = path.join(dataDir, 'paired-devices.json.tmp');
    fs.writeFileSync(temporary, JSON.stringify(Array.from(sessions, entry => ({ hash: entry[0], name: entry[1] }))), { mode: 384 });
    fs.renameSync(temporary, path.join(dataDir, 'paired-devices.json'));
  }
  if (dataDir) {
    try {
      const savedDevices = JSON.parse(fs.readFileSync(path.join(dataDir, 'paired-devices.json'), 'utf8'));
      if (Array.isArray(savedDevices)) savedDevices.slice(0, 8).forEach(device => {
        if (device && /^[a-f0-9]{64}$/.test(device.hash) && typeof device.name === 'string') sessions.set(device.hash, device.name.slice(0, 100));
      });
    } catch (_) {}
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf8'));
      if (LAYOUTS.indexOf(saved.layout) >= 0) preferences.layout = saved.layout;
      if (finite(saved.dim, 0.15, 0.9)) preferences.dim = saved.dim;
      if (typeof saved.progress === 'boolean') preferences.progress = saved.progress;
      if (typeof saved.waveform === 'boolean') preferences.waveform = saved.waveform;
      if (typeof saved.upNext === 'boolean') preferences.upNext = saved.upNext;
      if (saved.progressModes) Object.assign(preferences.progressModes, modePatch(saved.progressModes));
    } catch (_) {}
  }
  function newCode() { code = String(100000 + crypto.randomBytes(4).readUInt32BE(0) % 900000); codeExpires = clock() + 300000; }
  newCode();
  function online() { return lastDisplay > 0 && clock() - lastDisplay < 15000; }
  function current() { return queue[index] || null; }
  function snapshot(includeURLs) {
    checkSleep();
    const item = current();
    return { protocol: 1, version: VERSION, revision, generation, sequence, queueRevision, receiverOnline: online(),
      capabilities: { queueEditing: true, persistentPairing: true, sessionTools: true },
      session: { resumePosition, bookmarks: item && history.get(item) ? history.get(item).bookmarks : [], sleepTimer },
      trackVersion: generation + ':' + artworkRevision,
      track: item ? (includeURLs ? item : { id: item.id, sourceId: item.sourceId, title: item.title, artist: item.artist, artworkRemoteUrl: publicArtwork(item), artworkUrl: item.artworkUrl, waveformAvailable: !!item.waveformUrl, chapters: item.chapters, duration: item.duration }) : null,
      queue: queue.map((t, i) => includeURLs ? { id: t.id, title: t.title, artist: t.artist, current: i === index } :
        { id: t.id, sourceId: t.sourceId, title: t.title, artist: t.artist, artworkUrl: publicArtwork(t), waveformUrl: t.waveformUrl, duration: t.duration, current: i === index }),
      index, state, position, duration: duration || (item && item.duration) || 0, desiredPlaying,
      error, preferences: appearance(), pairedDevices: sessions.size };
  }
  function changed() { revision++; }
  function enqueue(type, extra) {
    sequence++;
    commands.push(Object.assign({ sequence, generation, type }, extra));
    if (commands.length > 40) commands.shift();
    changed();
  }
  function loadAt(next, start, play) {
    if (current() && position >= 5) history.remember(current(), position, duration, true);
    if (sleepTimer && sleepTimer.mode === 'end-track' && queue[next].id !== sleepTimer.trackId) clearSleep();
    index = next; generation++; queueRevision++; position = start || 0; duration = current().duration;
    sleepStoppedGeneration = -1;
    const saved = history.get(current());
    resumePosition = saved && saved.position >= 5 && (!duration || saved.position < duration - 5) ? saved.position : 0;
    state = 'loading'; error = ''; desiredPlaying = play; artworkRevision = 0;
    enqueue('load', { track: current(), position, autoplay: play });
  }
  function command(value) {
    checkSleep();
    if (!value || typeof value !== 'object') fail('Ongeldige opdracht.');
    if (value.type === 'load') {
      if (value.queueRevision !== undefined && value.queueRevision !== queueRevision) fail('De wachtrij is gewijzigd. Kies het nummer opnieuw.', 409);
      if (!Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > 100) fail('Kies 1 tot 100 nummers.');
      const nextQueue = uniqueTracks(value.tracks);
      const nextIndex = value.index === undefined ? 0 : value.index;
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= nextQueue.length) fail('Ongeldige wachtrijpositie.');
      const start = value.position === undefined ? 0 : value.position;
      if (!finite(start, 0, 604800)) fail('Ongeldige afspeelpositie.');
      if (current() && position >= 5) history.remember(current(), position, duration, true);
      queue = nextQueue; index = -1; loadAt(nextIndex, start, value.autoplay !== false);
    } else if (['queue-add', 'queue-reorder', 'queue-remove', 'queue-play', 'queue-refresh'].indexOf(value.type) >= 0) {
      if (!Number.isSafeInteger(value.queueRevision) || value.queueRevision !== queueRevision) fail('De wachtrij is gewijzigd. Bekijk de bijgewerkte lijst en probeer opnieuw.', 409);
      if (value.type === 'queue-refresh') {
        if (!current() || value.trackId !== current().id || !Array.isArray(value.tracks) || value.tracks.length !== 1) fail('Het huidige nummer is gewijzigd.', 409);
        const replacement = track(value.tracks[0], index);
        if (replacement.sourceId !== current().sourceId) fail('Het huidige nummer is gewijzigd.', 409);
        replacement.id = current().id;
        queue[index] = replacement; loadAt(index, position, true);
      } else if (value.type === 'queue-add') {
        if (!Array.isArray(value.tracks) || !value.tracks.length || queue.length + value.tracks.length > 100 ||
            ['next', 'last'].indexOf(value.placement) < 0) fail('Kies nummers en een plaats; maximaal 100 nummers.');
        const additions = uniqueTracks(value.tracks, queue);
        const at = value.placement === 'next' && current() ? index + 1 : queue.length;
        queue.splice.apply(queue, [at, 0].concat(additions));
        if (index < 0) loadAt(0, 0, true);
        else { queueRevision++; enqueue('queue'); }
      } else if (value.type === 'queue-reorder') {
        if (!Array.isArray(value.ids) || value.ids.length !== queue.length || new Set(value.ids).size !== queue.length ||
            value.ids.some(id => typeof id !== 'string' || !queue.some(item => item.id === id))) fail('Ongeldige wachtrijvolgorde.');
        const playingId = current() && current().id;
        queue = value.ids.map(id => queue.find(item => item.id === id));
        index = playingId ? queue.findIndex(item => item.id === playingId) : -1;
        queueRevision++; enqueue('queue');
      } else {
        const target = queue.findIndex(item => item.id === value.trackId);
        if (target < 0) fail('Dit nummer staat niet meer in de wachtrij.', 409);
        if (value.type === 'queue-play') loadAt(target, 0, true);
        else {
          const wasCurrent = target === index, shouldPlay = desiredPlaying;
          if (wasCurrent && position >= 5) history.remember(current(), position, duration, true);
          queue.splice(target, 1);
          if (!queue.length) {
            clearSleep(); resumePosition = 0;
            index = -1; position = 0; duration = 0; state = 'idle'; error = ''; desiredPlaying = false;
            generation++; queueRevision++; enqueue('stop');
          } else if (wasCurrent) {
            // Removing the final playing item prepares the preceding item paused.
            index = -1;
            loadAt(Math.min(target, queue.length - 1), 0, target < queue.length && shouldPlay);
          } else {
            if (target < index) index--;
            queueRevision++; enqueue('queue');
          }
        }
      }
    } else if (value.type === 'artwork') {
      if (!Number.isSafeInteger(value.generation) || typeof value.trackId !== 'string' ||
          !Number.isSafeInteger(value.artworkRevision) || value.artworkRevision < 1) fail('Ongeldige coverupdate.');
      if (!current() || value.generation !== generation || value.trackId !== current().id || value.artworkRevision <= artworkRevision) {
        return { accepted: true, ignored: true, generation, revision, sequence };
      }
      const artworkUrl = value.artworkUrl ? url(value.artworkUrl, true) : '';
      current().artworkUrl = artworkUrl; artworkRevision = value.artworkRevision;
      enqueue('artwork', { trackId: current().id, artworkUrl });
    } else if (value.type === 'preferences') {
      applyPreferences(value.preferences || {});
    } else if (value.type === 'preset') {
      const preset = PRESETS[value.name]; if (!Object.prototype.hasOwnProperty.call(PRESETS, value.name)) fail('Onbekende preset.');
      const modes = {}; modes[preset.layout] = preset.mode;
      applyPreferences({ layout: preset.layout, dim: preset.dim, progress: true, waveform: preset.waveform, progressModes: modes });
    } else if (value.type === 'sleep') {
      if (['off', 'minutes', 'end-track'].indexOf(value.mode) < 0) fail('Onbekende slaaptimer.');
      if (value.mode === 'minutes' && (!Number.isInteger(value.minutes) || !finite(value.minutes, 1, 180))) fail('Kies 1 tot 180 minuten.');
      if (value.mode !== 'off' && !current()) fail('Kies eerst een nummer.');
      clearSleep();
      if (value.mode === 'minutes') {
        sleepTimer = { mode: 'minutes', deadline: clock() + value.minutes * 60000 };
        sleepTimeout = setTimeout(checkSleep, value.minutes * 60000); sleepTimeout.unref();
      } else if (value.mode === 'end-track') sleepTimer = { mode: 'end-track', trackId: current().id };
      changed();
    } else {
      if (!current()) fail('Kies eerst een nummer.');
      if (['chapter', 'bookmark-add', 'bookmark-remove', 'bookmark-play', 'resume'].indexOf(value.type) >= 0) {
        if (value.generation !== generation || value.trackId !== current().id) fail('Het nummer is gewijzigd. Open de sessie opnieuw.', 409);
        if (value.type === 'chapter') {
          if (!Number.isInteger(value.index) || !current().chapters[value.index]) fail('Dit hoofdstuk is niet beschikbaar.');
          seekTo(current().chapters[value.index].position);
        } else if (value.type === 'resume') {
          if (!resumePosition) fail('Geen eerdere afspeelpositie voor dit nummer.');
          seekTo(resumePosition);
        } else if (value.type === 'bookmark-add') {
          if (!history.add(current(), position, value.label)) fail('Maximaal 20 bladwijzers per nummer.');
          changed();
        } else if (value.type === 'bookmark-remove') {
          if (!history.remove(current(), value.id)) fail('Deze bladwijzer is niet meer beschikbaar.', 409);
          changed();
        } else {
          const record = history.get(current()), bookmark = record && record.bookmarks.find(item => item.id === value.id);
          if (!bookmark) fail('Deze bladwijzer is niet meer beschikbaar.', 409);
          seekTo(bookmark.position);
        }
      } else
      if (value.type === 'play' || value.type === 'pause') {
        if (value.type === 'play') sleepStoppedGeneration = -1;
        desiredPlaying = value.type === 'play'; enqueue(value.type);
      } else if (value.type === 'retry') {
        loadAt(index, position, true);
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
        if (position >= 5) history.remember(current(), position, duration, true);
        clearSleep(); resumePosition = 0;
        desiredPlaying = false; state = 'idle'; queue = []; index = -1; position = 0; duration = 0;
        generation++; queueRevision++; enqueue('stop');
      } else fail('Onbekende opdracht.');
    }
    return { accepted: true, generation, revision, sequence, queueRevision };
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
  function remoteAuth(request) { const token = bearer(request); return token && sessions.has(sessionKey(token)); }
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
    '/waveform.js': ['waveform.js', 'application/javascript'],
    '/session-ui.js': ['session-ui.js', 'application/javascript'], '/session.css': ['session.css', 'text/css'],
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
        // Old clients still receive a full snapshot. The TV can avoid repeatedly
        // serializing/transferring the same inline cover and stream URL.
        if (state.track && parsed.searchParams.get('known') === state.trackVersion) {
          state.track = { id: state.track.id, title: state.track.title, artist: state.track.artist, duration: state.track.duration };
        }
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
          sessions.set(sessionKey(token), String(data.name || 'iPhone').slice(0, 100)); saveSessions();
          changed(); return respond(response, 200, { token, name: 'Resona TV', protocol: 1 });
        }
        if (route === '/api/display/report') {
          if (!displayAuth(request)) fail('Geen toegang.', 403);
          const data = await body(request); lastDisplay = clock(); checkSleep();
          if (data.generation !== generation || !current() || data.trackId !== current().id) return respond(response, 200, { ignored: true });
          if (['ready', 'playing', 'paused', 'buffering', 'error', 'ended'].indexOf(data.state) < 0) fail('Ongeldige afspeelstatus.');
          state = data.state;
          position = finite(data.position, 0, 604800) ? data.position : 0;
          duration = finite(data.duration, 0, 604800) ? data.duration : current().duration;
          error = String(data.error || '').slice(0, 240);
          if (data.state === 'ended') { resumePosition = 0; history.remember(current(), 0, duration, true); }
          else if (position >= 5 && (data.state === 'playing' || data.state === 'paused')) history.remember(current(), position, duration, data.state === 'paused');
          if (data.state === 'error' || data.state === 'ended') desiredPlaying = false;
          if (data.state === 'ended' && ((sleepTimer && sleepTimer.mode === 'end-track') || sleepStoppedGeneration === generation)) {
            clearSleep(); sleepStoppedGeneration = generation; enqueue('pause');
          }
          else if (data.state === 'ended' && index + 1 < queue.length) { position = 0; loadAt(index + 1, 0, true); }
          else changed();
          return respond(response, 200, { accepted: true });
        }
        if (route === '/api/pair/reset') {
          if (!displayAuth(request)) fail('Vernieuw de koppeling op de tv.', 403);
          sessions.clear(); saveSessions(); failures.clear(); newCode(); changed(); return respond(response, 200, { accepted: true });
        }
        if (route === '/api/command') {
          if (!displayAuth(request) && !remoteAuth(request)) fail('Koppel je iPhone eerst met de tv.', 401);
          if (!online()) fail('De tv-app is niet verbonden.', 409);
          return respond(response, 200, command(await body(request)));
        }
      }
      if (request.method === 'GET' && route === '/api/state') {
        if (!remoteAuth(request) && !displayAuth(request)) fail('Koppel je iPhone eerst met de tv.', 401);
        const value = snapshot(false);
        if (parsed.searchParams.get('compact') === '1' && value.track) value.track.artworkUrl = value.track.artworkRemoteUrl;
        return respond(response, 200, value);
      }
      if (request.method === 'DELETE' && route === '/api/session') {
        originCheck(request); if (!remoteAuth(request)) fail('Niet gekoppeld.', 401);
        sessions.delete(sessionKey(bearer(request))); saveSessions(); changed(); return respond(response, 200, { accepted: true });
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
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const idle = setInterval(() => {
    if (options.idleTimeout && clock() - Math.max(startedAt, lastDisplay) > options.idleTimeout) {
      server.close(); sockets.forEach(socket => socket.destroy());
    }
  }, 10000);
  idle.unref();
  server.on('close', () => { clearInterval(idle); clearSleep(); });
  return { server, command, snapshot, getCode: () => code, getDisplayToken: () => displayToken };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  function arg(name, fallback) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
  const port = Number(arg('--port', '42700'));
  const host = arg('--host', '0.0.0.0');
  let replaced = false;
  if (args.indexOf('--replace') >= 0) {
    // An IPK update replaces files, but an older helper may still own the port.
    // Replace only our exact Node script on this port, owned by the same UID.
    fs.readdirSync('/proc').filter(pid => /^\d+$/.test(pid) && Number(pid) !== process.pid).forEach(pid => {
      try {
        const command = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
        const flag = command.indexOf('--port');
        if (Number(pid) > 1 && fs.statSync('/proc/' + pid).uid === process.getuid() &&
            /^(node|nodejs)$/.test(path.basename(command[0])) && command[1] === __filename &&
            flag >= 0 && Number(command[flag + 1]) === port) {
          process.kill(Number(pid), 'SIGTERM'); replaced = true;
        }
      } catch (_) { /* Exited or inaccessible processes are unrelated. */ }
    });
  }
  const receiver = makeReceiver({ dataDir: arg('--data-dir', path.join(os.tmpdir(), 'resona-tv-' + process.getuid())), idleTimeout: 120000 });
  let retries = 0;
  receiver.server.on('error', e => {
    if (e.code === 'EADDRINUSE' && replaced && retries++ < 10) { setTimeout(() => receiver.server.listen(port, host), 200); return; }
    console.error(e.code === 'EADDRINUSE' ? 'Resona TV is already running on this port.' : 'Unable to start Resona TV: ' + e.code); process.exitCode = 1;
  });
  receiver.server.listen(port, host, () => console.log('Resona TV receiver listening on port ' + receiver.server.address().port));
}
module.exports = { makeReceiver, track, url, loopback, VERSION };
