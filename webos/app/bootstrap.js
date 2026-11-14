(function () {
  'use strict';
  var base = 'http://127.0.0.1:42700';
  var status = document.getElementById('startup-status');
  var busy = false;
  async function health() {
    var abort = new AbortController(); var timer = setTimeout(function () { abort.abort(); }, 1200);
    try { var result = await fetch(base + '/health', { signal: abort.signal }); var data = await result.json(); return result.ok && data.name === 'Resona TV' && data.protocol === 1 && data.version === '0.1.2'; }
    catch (_) { return false; } finally { clearTimeout(timer); }
  }
  function startService() {
    return new Promise(function (resolve, reject) {
      if (!window.webOS || !window.PalmServiceBridge) { reject(new Error('Open deze app op je LG-tv met Homebrew Channel.')); return; }
      // App path is fixed, never derived from a network request or launch parameters.
      window.webOS.service.request('luna://org.webosbrew.hbchannel.service', {
        method: 'exec', parameters: { command: '/bin/sh /media/developer/apps/usr/palm/applications/com.themaxynator.resonatv/start-receiver.sh' },
        onSuccess: function (result) { if (result.error || result.stderrString) reject(new Error('De ontvanger start niet. Controleer Homebrew Channel en root.')); else resolve(); },
        onFailure: function () { reject(new Error('Homebrew Channel is niet bereikbaar. Open Homebrew Channel en controleer de rootstatus.')); }
      });
    });
  }
  async function connect() {
    if (busy) return; busy = true;
    status.textContent = 'Verbinden met Resona TV…';
    try {
      if (!await health()) { await startService(); }
      for (var attempt = 0; attempt < 15; attempt++) {
        if (await health()) { window.location.replace(base + '/tv'); return; }
        await new Promise(function (resolve) { setTimeout(resolve, 400); });
      }
      throw new Error('De ontvanger reageert niet. Gebruik de startinstructies bij deze testversie.');
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; }
  }
  document.getElementById('retry').addEventListener('click', connect);
  document.getElementById('preview').addEventListener('click', function () { window.location.href = 'tv.html?preview=1'; });
  connect();
}());
