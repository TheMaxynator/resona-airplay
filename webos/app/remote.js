(function () {
  'use strict';
  var token = localStorage.getItem('resona-tv-token') || '';
  var snapshot = null, interacting = false, updating = false, retryAt = 0, failures = 0, queueKey = '';
  var pairSection = document.getElementById('pair-section'), pairedSection = document.getElementById('paired-section');
  function text(id, value) { var element = document.getElementById(id); if (element.textContent !== value) element.textContent = value; }
  function message(value) { var node = document.getElementById('remote-message'); node.hidden = !value; node.textContent = value || ''; }
  function pairing() { pairSection.hidden = !!token; pairedSection.hidden = !token; text('connection', token ? 'Verbinden…' : 'Niet gekoppeld'); }
  async function api(route, data, method) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 6000);
    var response, result;
    try {
      response = await fetch(route, { method: method || (data === undefined ? 'GET' : 'POST'), signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: data === undefined ? undefined : JSON.stringify(data) });
      result = await response.json();
    } finally { clearTimeout(timeout); }
    if (!response.ok) { if (response.status === 401) { token = ''; localStorage.removeItem('resona-tv-token'); pairing(); } throw new Error(result.error || 'De tv reageert niet.'); }
    return result;
  }
  async function command(value) { try { var result = await api('/api/command', value); message(''); await update(true); return result; } catch (error) { await update(true); message(error.message); } }
  function time(value) { value = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; return (value >= 3600 ? Math.floor(value / 3600) + ':' + String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0'); }
  function renderQueue() {
    var key = JSON.stringify(snapshot.queue) + '|' + snapshot.queueRevision + '|' + snapshot.receiverOnline;
    if (key === queueKey) return; queueKey = key;
    var list = document.getElementById('queue-list'), focused = document.activeElement;
    var focusKey = focused && focused.dataset.queueId, focusAction = focused && focused.dataset.action;
    list.replaceChildren();
    snapshot.queue.forEach(function (item, index) {
      var row = document.createElement('li'), play = document.createElement('button'), artist = document.createElement('small');
      row.className = item.current ? 'current' : '';
      play.className = 'queue-title'; play.textContent = item.title; artist.textContent = item.artist; play.appendChild(artist);
      play.setAttribute('aria-label', 'Speel ' + item.title); play.dataset.queueId = item.id; play.dataset.action = 'play';
      play.addEventListener('click', function () { editQueue('queue-play', item.id); }); row.appendChild(play);
      var actions = document.createElement('div'); actions.className = 'queue-actions';
      [['up', '↑', 'Verplaats omhoog', index === 0], ['down', '↓', 'Verplaats omlaag', index + 1 === snapshot.queue.length], ['remove', '×', 'Verwijder', false]].forEach(function (spec) {
        var button = document.createElement('button'); button.className = 'secondary'; button.textContent = spec[1];
        button.setAttribute('aria-label', spec[2] + ': ' + item.title); button.dataset.queueId = item.id; button.dataset.action = spec[0];
        button.disabled = spec[3] || !snapshot.receiverOnline; button.dataset.unavailable = spec[3] ? '1' : '';
        button.addEventListener('click', function () { editQueue(spec[0] === 'remove' ? 'queue-remove' : 'queue-reorder', item.id, index + (spec[0] === 'up' ? -1 : 1)); });
        actions.appendChild(button);
      });
      row.appendChild(actions); list.appendChild(row);
    });
    if (focusKey) Array.from(list.querySelectorAll('button')).some(function (button) {
      if (button.dataset.queueId === focusKey && button.dataset.action === focusAction) { button.focus(); return true; } return false;
    });
  }
  function editQueue(type, id, destination) {
    if (!snapshot || !Number.isSafeInteger(snapshot.queueRevision)) return;
    var body = { type: type, queueRevision: snapshot.queueRevision, trackId: id };
    if (type === 'queue-reorder') {
      var ids = snapshot.queue.map(function (item) { return item.id; }), from = ids.indexOf(id);
      if (from < 0 || destination < 0 || destination >= ids.length) return;
      ids.splice(destination, 0, ids.splice(from, 1)[0]); body.ids = ids;
    }
    command(body);
  }
  async function update(force) {
    if (!token || updating || (!force && Date.now() < retryAt)) return;
    updating = true;
    try {
      snapshot = await api('/api/state'); failures = 0; retryAt = 0;
      var track = snapshot.track, cover = document.getElementById('remote-cover');
      text('connection', snapshot.receiverOnline ? 'Verbonden met LG' : 'Tv-app gesloten'); document.getElementById('connection').classList.toggle('online', snapshot.receiverOnline);
      text('remote-title', track ? track.title : 'Kies je muziek.'); text('remote-artist', track ? track.artist : 'Stuur een nummer vanuit Resona of begin met de test hieronder.');
      cover.hidden = !track || !track.artworkUrl; document.getElementById('remote-placeholder').hidden = !cover.hidden;
      if (track && track.artworkUrl && cover.getAttribute('src') !== track.artworkUrl) cover.src = track.artworkUrl;
      text('remote-toggle', snapshot.state === 'playing' ? 'Pauzeren' : 'Afspelen');
      document.querySelectorAll('.transport button').forEach(function (button) { button.disabled = !track || !snapshot.receiverOnline; });
      document.getElementById('remote-next').disabled = !track || !snapshot.receiverOnline || snapshot.index + 1 >= snapshot.queue.length;
      var seek = document.getElementById('seek'); seek.disabled = !track || snapshot.duration <= 0;
      if (!interacting) { seek.max = Math.max(1, snapshot.duration); seek.value = snapshot.position; }
      text('remote-elapsed', time(snapshot.position)); text('remote-duration', time(snapshot.duration));
      text('playback-status', snapshot.error || ({ loading: 'Nummer laden…', buffering: 'Even bufferen…', ready: 'Klaar om af te spelen', ended: 'Einde van de wachtrij' }[snapshot.state] || ''));
      if (document.activeElement !== document.getElementById('dimming')) document.getElementById('dimming').value = Math.round(snapshot.preferences.dim * 100);
      text('dim-label', Math.round(snapshot.preferences.dim * 100) + '%');
      document.getElementById('remote-layout').value = snapshot.preferences.layout; document.getElementById('show-progress').checked = snapshot.preferences.progress;
      document.getElementById('remote-progress-mode').value = snapshot.preferences.progressModes[snapshot.preferences.layout];
      document.getElementById('show-waveform').checked = snapshot.preferences.waveform;
      text('waveform-hint', track && track.waveformAvailable ? 'Vooraf berekende golfvorm die de afspeelpositie volgt.' : 'Geen golfvormgegevens voor dit nummer; de voortgangslijn blijft beschikbaar.');
      renderQueue();
      document.querySelectorAll('#queue-list button').forEach(function (button) { button.disabled = !snapshot.receiverOnline || button.dataset.unavailable === '1'; });
      if (document.getElementById('remote-message').dataset.network === '1') { message(''); document.getElementById('remote-message').dataset.network = ''; }
      document.getElementById('queue-empty').hidden = snapshot.queue.length > 0;
    } catch (error) {
      failures++; retryAt = Date.now() + Math.min(15000, Math.pow(2, Math.min(failures, 4)) * 1000);
      text('connection', token ? 'Opnieuw verbinden…' : 'Niet gekoppeld'); document.getElementById('connection').classList.remove('online');
      document.querySelectorAll('.transport button, #queue-list button').forEach(function (button) { button.disabled = true; });
      message(token ? 'De tv is tijdelijk niet bereikbaar. Controleer de verbinding en open Resona TV op de televisie.' : error.message);
      document.getElementById('remote-message').dataset.network = '1';
    } finally { updating = false; }
  }
  document.getElementById('retry').addEventListener('click', function () { update(true); });
  document.getElementById('pair-form').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = event.submitter || document.querySelector('#pair-form button'); button.disabled = true;
    try { var result = await api('/api/pair', { code: document.getElementById('code').value.replace(/\s/g, ''), name: 'iPhone webbediening' }); token = result.token; localStorage.setItem('resona-tv-token', token); pairing(); message(''); await update(); }
    catch (error) { message(error.message); } finally { button.disabled = false; }
  });
  document.getElementById('remote-toggle').addEventListener('click', function () { command({ type: snapshot && snapshot.state === 'playing' ? 'pause' : 'play' }); });
  document.getElementById('remote-previous').addEventListener('click', function () { command({ type: 'previous' }); });
  document.getElementById('remote-next').addEventListener('click', function () { command({ type: 'next' }); });
  document.getElementById('seek').addEventListener('input', function (event) { interacting = true; text('remote-elapsed', time(Number(event.target.value))); });
  document.getElementById('seek').addEventListener('change', function (event) { interacting = false; command({ type: 'seek', position: Number(event.target.value) }); });
  document.getElementById('remote-layout').addEventListener('change', function (event) { command({ type: 'preferences', preferences: { layout: event.target.value } }); });
  document.getElementById('dimming').addEventListener('input', function (event) { text('dim-label', event.target.value + '%'); });
  document.getElementById('dimming').addEventListener('change', function (event) { command({ type: 'preferences', preferences: { dim: Number(event.target.value) / 100 } }); });
  document.getElementById('show-progress').addEventListener('change', function (event) { command({ type: 'preferences', preferences: { progress: event.target.checked } }); });
  document.getElementById('remote-progress-mode').addEventListener('change', function (event) {
    if (!snapshot) return; var modes = {}; modes[document.getElementById('remote-layout').value] = event.target.value;
    command({ type: 'preferences', preferences: { progress: true, progressModes: modes } });
  });
  document.getElementById('show-waveform').addEventListener('change', function (event) { command({ type: 'preferences', preferences: { waveform: event.target.checked } }); });
  document.getElementById('disconnect').addEventListener('click', async function () { try { await api('/api/session', undefined, 'DELETE'); } catch (_) {} token = ''; localStorage.removeItem('resona-tv-token'); pairing(); message(''); });
  document.getElementById('demo').addEventListener('click', function () { command({ type: 'load', tracks: [{ id: 'resona-test', title: 'Sound & color', artist: 'Resona · testgeluid', url: location.origin + '/demo.mp3', artworkUrl: location.origin + '/demo-cover.svg', duration: 20 }] }); });
  document.getElementById('track-form').addEventListener('submit', function (event) { event.preventDefault(); command({ type: 'load', tracks: [{ id: 'manual-' + Date.now(), url: document.getElementById('stream-url').value, title: document.getElementById('track-title').value, artist: document.getElementById('track-artist').value, artworkUrl: document.getElementById('artwork-url').value }] }); });
  document.getElementById('queue-form').addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      var placement = event.submitter && event.submitter.value;
      var body = { type: placement === 'next' || placement === 'last' ? 'queue-add' : 'load', tracks: JSON.parse(document.getElementById('queue-json').value) };
      if (body.type === 'queue-add') { body.placement = placement; body.queueRevision = snapshot.queueRevision; }
      command(body);
    } catch (_) { message('De wachtrij bevat geen geldige JSON.'); }
  });
  pairing(); update(); setInterval(update, 1200);
}());
