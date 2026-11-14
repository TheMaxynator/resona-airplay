(function () {
  'use strict';
  var token = localStorage.getItem('resona-tv-token') || '';
  var snapshot = null, interacting = false;
  var pairSection = document.getElementById('pair-section'), pairedSection = document.getElementById('paired-section');
  function text(id, value) { document.getElementById(id).textContent = value; }
  function message(value) { var node = document.getElementById('remote-message'); node.hidden = !value; node.textContent = value || ''; }
  function pairing() { pairSection.hidden = !!token; pairedSection.hidden = !token; text('connection', token ? 'Verbinden…' : 'Niet gekoppeld'); }
  async function api(route, data, method) {
    var response = await fetch(route, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: data === undefined ? undefined : JSON.stringify(data) });
    var result = await response.json();
    if (!response.ok) { if (response.status === 401) { token = ''; localStorage.removeItem('resona-tv-token'); pairing(); } throw new Error(result.error || 'De tv reageert niet.'); }
    return result;
  }
  async function command(value) { try { var result = await api('/api/command', value); message(''); await update(); return result; } catch (error) { message(error.message); } }
  function time(value) { value = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; return (value >= 3600 ? Math.floor(value / 3600) + ':' + String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0'); }
  async function update() {
    if (!token) return;
    try {
      snapshot = await api('/api/state');
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
      var list = document.getElementById('queue-list'); list.replaceChildren();
      snapshot.queue.forEach(function (item) { var row = document.createElement('li'), artist = document.createElement('small'); row.textContent = item.title; row.className = item.current ? 'current' : ''; artist.textContent = item.artist; row.appendChild(artist); list.appendChild(row); });
      document.getElementById('queue-empty').hidden = snapshot.queue.length > 0;
    } catch (error) { message(error.message); }
  }
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
  document.getElementById('disconnect').addEventListener('click', async function () { try { await api('/api/session', undefined, 'DELETE'); } catch (_) {} token = ''; localStorage.removeItem('resona-tv-token'); pairing(); message(''); });
  document.getElementById('demo').addEventListener('click', function () { command({ type: 'load', tracks: [{ id: 'resona-test', title: 'Sound & color', artist: 'Resona · testgeluid', url: location.origin + '/demo.mp3', artworkUrl: location.origin + '/demo-cover.svg', duration: 20 }] }); });
  document.getElementById('track-form').addEventListener('submit', function (event) { event.preventDefault(); command({ type: 'load', tracks: [{ id: 'manual-' + Date.now(), url: document.getElementById('stream-url').value, title: document.getElementById('track-title').value, artist: document.getElementById('track-artist').value, artworkUrl: document.getElementById('artwork-url').value }] }); });
  document.getElementById('queue-form').addEventListener('submit', function (event) { event.preventDefault(); try { command({ type: 'load', tracks: JSON.parse(document.getElementById('queue-json').value) }); } catch (_) { message('De wachtrij bevat geen geldige JSON.'); } });
  pairing(); update(); setInterval(update, 1200);
}());
