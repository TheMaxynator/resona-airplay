(function (root) {
  'use strict';
  function peaks(data, count) {
    if (!data || !Array.isArray(data.samples) || !data.samples.length || data.samples.length > 20000 ||
        !Number.isFinite(data.height) || data.height <= 0 || data.height > 65535 ||
        data.samples.some(function (n) { return !Number.isFinite(n) || n < 0 || n > data.height; })) throw new Error('Ongeldige golfvorm.');
    count = Math.min(count || 240, data.samples.length);
    var result = [];
    for (var i = 0; i < count; i++) {
      var maximum = 0, end = Math.ceil((i + 1) * data.samples.length / count);
      for (var j = Math.floor(i * data.samples.length / count); j < end; j++) maximum = Math.max(maximum, data.samples[j]);
      result.push(maximum / data.height);
    }
    return result;
  }
  function allowed(value) {
    try { var u = new URL(value); return u.protocol === 'https:' && u.hostname === 'wave.sndcdn.com' &&
      !u.port && !u.username && !u.password && /\.json$/.test(u.pathname); } catch (_) { return false; }
  }
  function Waveform(element) {
    var base = element.querySelector('.waveform-base'), played = element.querySelector('.waveform-played');
    var clip = element.querySelector('.waveform-clip'), parent = element.parentElement;
    var key = '', active = false, cached = null, abort = null, version = 0, failed = false, lastRatio = -1;
    function clear() { element.hidden = true; parent.classList.remove('has-waveform'); }
    function draw() {
      if (!active || !cached) return;
      [base, played].forEach(function (canvas, index) {
        canvas.width = 960; canvas.height = 44;
        var context = canvas.getContext('2d'); context.fillStyle = index ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.26)';
        var step = canvas.width / cached.length;
        cached.forEach(function (amplitude, i) {
          var height = Math.max(1, Math.round(amplitude * 40));
          context.fillRect(Math.round(i * step), Math.round((44 - height) / 2), Math.max(1, Math.floor(step) - 1), height);
        });
      });
      element.dataset.draws = String(Number(element.dataset.draws || 0) + 1);
      element.hidden = false; parent.classList.add('has-waveform'); lastRatio = -1;
    }
    this.configure = function (track, enabled) {
      var nextKey = track ? track.id + '|' + (track.waveformUrl || '') : '';
      if (key !== nextKey) { version++; if (abort) abort.abort(); abort = null; key = nextKey; cached = null; failed = false; clear(); }
      if (active !== !!enabled) { active = !!enabled; if (active) failed = false; }
      if (!active || document.hidden || !track || !allowed(track.waveformUrl)) { if (abort) abort.abort(); abort = null; clear(); return; }
      if (cached) { element.hidden = false; parent.classList.add('has-waveform'); lastRatio = -1; return; }
      if (abort || failed) return;
      var requestVersion = version, controller = new AbortController(); abort = controller;
      var timeout = setTimeout(function () { controller.abort(); }, 5000);
      fetch(track.waveformUrl, { credentials: 'omit', redirect: 'error', signal: controller.signal }).then(function (response) {
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 131072) throw new Error('Geen golfvorm.');
        return response.text();
      }).then(function (body) {
        if (body.length > 131072) throw new Error('Golfvorm is te groot.');
        if (version !== requestVersion || abort !== controller || !active) return;
        cached = peaks(JSON.parse(body), 240); draw();
      }).catch(function () { if (version === requestVersion && abort === controller) { failed = true; clear(); } })
        .then(function () { clearTimeout(timeout); if (abort === controller) abort = null; });
    };
    this.progress = function (ratio) {
      if (element.hidden || ratio === lastRatio) return; lastRatio = ratio;
      // Reveal a fixed bitmap with counter-translated clipping layers. No canvas
      // redraw, FFT, layout animation, or JavaScript loop is needed per frame.
      clip.style.transform = 'translateX(' + ((ratio - 1) * 100) + '%)';
      played.style.transform = 'translateX(' + ((1 - ratio) * 100) + '%)';
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { peaks: peaks, allowed: allowed };
  else root.ResonaWaveform = Waveform;
}(typeof window === 'object' ? window : this));
