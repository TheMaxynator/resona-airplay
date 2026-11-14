(function () {
  'use strict';
  var preview = new URLSearchParams(location.search).get('preview') === '1';
  var token = document.querySelector('meta[name=resona-display-token]').content;
  var audio = document.getElementById('audio');
  var generation = -1, sequence = 0, current = null, latest = null, loading = false, ready = false;
  var requestedPosition = 0, wantPlay = false, reporting = false, lastState = 'idle';
  var messages = document.getElementById('message'), pairing = document.getElementById('pairing');
  var toolbarTimer, pairRequested = false, errorTimer;
  var layouts = ['cinema', 'gallery', 'ambient', 'night'];
  function text(id, value) { document.getElementById(id).textContent = value; }
  function time(value) { value = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; return (value >= 3600 ? Math.floor(value / 3600) + ':' + String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0'); }
  async function api(route, data) {
    var response = await fetch(route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    var result = await response.json(); if (!response.ok) throw new Error(result.error || 'Verbinding met de ontvanger verbroken.'); return result;
  }
  function message(value) { clearTimeout(errorTimer); messages.hidden = !value; messages.textContent = value || ''; }
  function controls() { document.body.classList.add('controls-visible'); clearTimeout(toolbarTimer); toolbarTimer = setTimeout(function () { if (!document.getElementById('toolbar').contains(document.activeElement)) document.body.classList.remove('controls-visible'); }, 5000); }
  function paint(item) {
    var image = document.getElementById('cover');
    document.body.classList.toggle('no-track', !item);
    text('title', item ? item.title : 'Je muziek. Op groot scherm.');
    text('artist', item ? item.artist : 'Koppel je iPhone om een nummer te kiezen.');
    var source = item && item.artworkUrl || '';
    if (image.dataset.source === source) return;
    image.dataset.source = source;
    image.hidden = true; document.getElementById('placeholder').hidden = false;
    document.getElementById('backdrop').style.backgroundImage = '';
    image.onload = function () {
      if (image.dataset.source !== source || !image.naturalWidth) return;
      image.hidden = false; document.getElementById('placeholder').hidden = true;
      document.getElementById('backdrop').style.backgroundImage = 'url(' + JSON.stringify(source) + ')';
    };
    image.onerror = function () {
      if (image.dataset.source !== source) return;
      image.hidden = true; document.getElementById('placeholder').hidden = false;
      document.getElementById('backdrop').style.backgroundImage = '';
    };
    if (source) { image.alt = 'Albumhoes van ' + item.title; image.src = source; }
    else image.removeAttribute('src');
  }
  function preferences(value) {
    document.body.dataset.layout = value.layout;
    document.body.style.setProperty('--dim', value.dim);
    document.getElementById('progress-area').hidden = !value.progress || !current;
    text('layout', value.layout.charAt(0).toUpperCase() + value.layout.slice(1));
  }
  function progress() {
    var duration = Number.isFinite(audio.duration) ? audio.duration : (current && current.duration) || 0;
    var elapsed = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    text('elapsed', time(elapsed)); text('duration', duration > 0 ? time(duration) : 'LIVE');
    document.getElementById('progress-fill').style.width = (duration > 0 ? Math.min(100, Math.max(0, elapsed / duration * 100)) : 0) + '%';
  }
  async function report(state, error) {
    if (preview || !current || reporting) return;
    reporting = true; lastState = state;
    try { await api('/api/display/report', { generation: generation, trackId: current.id, state: state, position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : current.duration, error: error || '' }); }
    catch (_) {} finally { reporting = false; }
  }
  async function play() {
    if (!current) return;
    wantPlay = true;
    try { await audio.play(); message(''); }
    catch (error) { wantPlay = false; var hint = error.name === 'NotAllowedError' ? 'Druk op OK of Afspelen om audio te activeren.' : 'Dit nummer kan niet worden afgespeeld. Stuur een nieuwe streamlink.'; message(hint); report('error', hint); controls(); }
  }
  function load(command) {
    audio.pause(); ready = false; loading = true;
    generation = command.generation; current = command.track;
    requestedPosition = command.position || 0; wantPlay = command.autoplay;
    paint(current); message(''); audio.src = current.url; audio.load();
    text('toggle', 'Afspelen');
  }
  function execute(command) {
    if (command.type === 'load') { load(command); return; }
    if (command.type === 'preferences') { preferences(command.preferences); return; }
    if (command.generation !== generation) return;
    if (command.type === 'artwork' && current && command.trackId === current.id) { current.artworkUrl = command.artworkUrl; paint(current); return; }
    if (command.type === 'play') play();
    if (command.type === 'pause') { wantPlay = false; audio.pause(); report('paused'); }
    if (command.type === 'seek' && current) { requestedPosition = command.position; if (ready) { audio.currentTime = command.position; progress(); report(audio.paused ? 'paused' : 'playing'); } }
    if (command.type === 'stop') { wantPlay = false; audio.pause(); audio.removeAttribute('src'); audio.load(); current = null; paint(null); progress(); document.getElementById('progress-area').hidden = true; }
  }
  function showPairing(snapshot) {
    pairing.hidden = !(pairRequested || !snapshot.track || snapshot.pairedDevices === 0);
    text('pair-code', snapshot.code.slice(0, 3) + ' ' + snapshot.code.slice(3));
    var url = snapshot.urls[0];
    text('remote-url', url || 'http://TV-IP:42700/remote');
    text('pair-caption', snapshot.pairedDevices > 0 ? snapshot.pairedDevices + ' apparaat/apparaten gekoppeld · code blijft 5 minuten geldig' : 'De code vernieuwt automatisch.');
    var qr = document.getElementById('qr');
    if (url && qr.dataset.url !== url && window.qrcode) { var code = window.qrcode(0, 'M'); code.addData(url + '/remote'); code.make(); qr.innerHTML = code.createSvgTag({ scalable: true, margin: 0 }); qr.dataset.url = url; }
  }
  async function poll() {
    try {
      var snapshot = await api('/api/display?after=' + sequence); latest = snapshot;
      showPairing(snapshot);
      if (snapshot.generation !== generation) {
        if (snapshot.track) load({ generation: snapshot.generation, track: snapshot.track, position: snapshot.position, autoplay: snapshot.desiredPlaying });
        else { generation = snapshot.generation; audio.pause(); current = null; paint(null); }
        sequence = snapshot.sequence;
      } else {
        snapshot.commands.forEach(function (command) { if (command.sequence > sequence) { execute(command); sequence = command.sequence; } });
        // State is authoritative if the bounded command history was overtaken.
        if (current && snapshot.track && current.id === snapshot.track.id && current.artworkUrl !== snapshot.track.artworkUrl) {
          current.artworkUrl = snapshot.track.artworkUrl; paint(current);
        }
      }
      preferences(snapshot.preferences);
    } catch (_) { message('De ontvanger is niet bereikbaar. Open Resona TV opnieuw.'); }
    setTimeout(poll, 550);
  }
  audio.addEventListener('canplay', function () {
    if (!current) return; ready = true; loading = false;
    if (requestedPosition > 0) { try { audio.currentTime = requestedPosition; } catch (_) {} requestedPosition = 0; }
    report('ready'); if (wantPlay) play();
  });
  audio.addEventListener('playing', function () { loading = false; text('toggle', 'Pauzeren'); report('playing'); });
  audio.addEventListener('pause', function () { text('toggle', 'Afspelen'); if (current && ready && !loading && !audio.ended) report('paused'); });
  audio.addEventListener('waiting', function () { if (current) report('buffering'); });
  audio.addEventListener('ended', function () { if (current && audio.ended) { wantPlay = false; report('ended'); } });
  audio.addEventListener('error', function () { if (current && audio.error) { loading = false; wantPlay = false; message('De stream is niet beschikbaar of dit audioformaat wordt niet ondersteund. Stuur het nummer opnieuw.'); report('error', 'Stream niet beschikbaar of audioformaat niet ondersteund.'); } });
  audio.addEventListener('timeupdate', progress);
  async function command(value) { if (preview) return; try { await api('/api/command', value); } catch (error) { message(error.message); } }
  document.getElementById('toggle').addEventListener('click', function () { if (audio.paused) { play(); command({ type: 'play' }); } else command({ type: 'pause' }); });
  document.getElementById('previous').addEventListener('click', function () { command({ type: 'previous' }); });
  document.getElementById('next').addEventListener('click', function () { command({ type: 'next' }); });
  document.getElementById('layout').addEventListener('click', function () { var next = layouts[(layouts.indexOf(document.body.dataset.layout) + 1) % layouts.length]; if (preview) preferences({ layout: next, dim: .48, progress: true }); else command({ type: 'preferences', preferences: { layout: next } }); });
  document.getElementById('pair').addEventListener('click', function () { pairRequested = !pairRequested; if (latest) showPairing(latest); });
  document.addEventListener('mousemove', controls);
  document.addEventListener('keydown', function (event) {
    controls();
    if (event.key === 'Escape' || event.keyCode === 461) { if (!pairing.hidden) { pairRequested = false; pairing.hidden = true; event.preventDefault(); } else if (window.webOS) window.webOS.platformBack(); }
    var buttons = Array.from(document.querySelectorAll('#toolbar button'));
    var active = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[1].focus(); }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && active >= 0) { event.preventDefault(); buttons[(active + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus(); }
    else if (event.key === 'ArrowRight' && current) { event.preventDefault(); command({ type: 'seek', position: Math.min(Number.isFinite(audio.duration) ? audio.duration : 604800, audio.currentTime + 15) }); }
    else if (event.key === 'ArrowLeft' && current) { event.preventDefault(); command({ type: 'seek', position: Math.max(0, audio.currentTime - 15) }); }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === document.body) { event.preventDefault(); document.getElementById('toggle').click(); }
    if (event.keyCode === 415) command({ type: 'play' }); if (event.keyCode === 19) command({ type: 'pause' });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && current) { wantPlay = false; audio.pause(); command({ type: 'pause' }); report('paused'); } });
  setInterval(function () { if (preview) return; if (current && ready) report(audio.ended ? 'ended' : audio.paused ? 'paused' : 'playing'); progress(); }, 1000);
  setInterval(function () { var shift = Math.round(Math.random() * 10) - 5; document.getElementById('composition').style.transform = 'translate(' + shift + 'px,' + (-shift) + 'px)'; }, 60000);
  paint(null);
  if (preview) { generation = 0; current = { id: 'preview', title: 'Night Bloom', artist: 'Resona · ontwerpvoorbeeld', artworkUrl: 'demo-cover.svg', duration: 248 }; paint(current); pairing.hidden = true; preferences({ layout: 'cinema', dim: .48, progress: true }); text('elapsed', '1:31'); text('duration', '4:08'); document.getElementById('progress-fill').style.width = '36.7%'; controls(); }
  else poll();
}());
