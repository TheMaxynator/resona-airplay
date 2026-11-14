'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { makeReceiver } = require('../app/receiver-server');

(async () => {
  const receiver = makeReceiver({ addresses: ['127.0.0.1'] });
  await new Promise(r => receiver.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + receiver.server.address().port;
  const options = fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {};
  let browser;
  try { browser = await chromium.launch(options); }
  catch (error) { receiver.server.close(); throw error; }
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage();
  [tv, phone].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const output = path.resolve(__dirname, '../test-results'); fs.mkdirSync(output, { recursive: true });
  try {
    await tv.goto(base + '/tv');
    await tv.getByText('Open dit adres op je telefoon', { exact: true }).waitFor();
    await tv.locator('#pair-code').filter({ hasText: /^\d{3} \d{3}$/ }).waitFor();
    assert.equal(await tv.locator('#qr svg').count(), 1);
    await tv.screenshot({ path: path.join(output, 'pairing.png') });
    // A genuine receiver-side click permits audio in desktop Chromium; LG's policy is tested on hardware.
    await tv.locator('body').click({ position: { x: 10, y: 10 } });
    await phone.goto(base + '/remote');
    await phone.getByLabel('Koppelcode').fill(receiver.getCode());
    await phone.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await phone.getByText('Verbonden met LG', { exact: true }).waitFor();
    const token = await phone.evaluate(() => localStorage.getItem('resona-tv-token'));
    async function command(body) {
      const response = await fetch(base + '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      assert.equal(response.status, 200); return response.json();
    }
    await phone.getByText('Testgeluid of eigen audiolink', { exact: true }).click();
    await phone.getByRole('button', { name: 'Testgeluid afspelen', exact: true }).click();
    await tv.getByRole('heading', { name: 'Sound & color', exact: true }).waitFor();
    await tv.waitForFunction(() => !document.getElementById('audio').paused && document.getElementById('audio').currentTime > 0.25, { timeout: 15000 });
    await phone.getByRole('button', { name: 'Pauzeren', exact: true }).click();
    await tv.waitForFunction(() => document.getElementById('audio').paused);
    await phone.locator('#seek').evaluate(element => { element.value = '7'; element.dispatchEvent(new Event('change', { bubbles: true })); });
    await tv.waitForFunction(() => Math.abs(document.getElementById('audio').currentTime - 7) < 0.5);
    await tv.waitForFunction(() => getComputedStyle(document.getElementById('toolbar')).opacity === '0');
    for (const layout of ['cinema', 'gallery', 'ambient', 'night']) {
      await phone.getByLabel('Ontwerp', { exact: true }).selectOption(layout);
      await tv.waitForFunction(value => document.body.dataset.layout === value, layout);
      await tv.waitForFunction(value => Math.abs(Number(getComputedStyle(document.getElementById('backdrop')).opacity) - (value === 'night' ? 0.52 * 0.28 : value === 'gallery' ? 1 - .48 * .35 : 0.52)) < 0.01, layout);
      await tv.waitForFunction(value => Math.abs(Number(getComputedStyle(document.getElementById('color-wash')).opacity) - (value === 'gallery' ? 1 - .48 * .38 : 0)) < .01, layout);
      await phone.getByLabel('Voortgangsbalk voor dit ontwerp', { exact: true }).selectOption('auto');
      await tv.waitForFunction(() => document.body.dataset.progressMode === 'auto' && getComputedStyle(document.getElementById('progress-area')).opacity === '0');
      if (layout === 'gallery') {
        await tv.waitForFunction(() => document.body.classList.contains('palette-ready'));
        const gallery = await tv.evaluate(() => {
          const cover = document.querySelector('.cover-wrap').getBoundingClientRect();
          const bar = document.getElementById('progress-area').getBoundingClientRect();
          return { x: cover.x + cover.width / 2, width: cover.width, title: Number.parseFloat(getComputedStyle(document.getElementById('title')).fontSize),
            brand: getComputedStyle(document.querySelector('.brand')).display, progress: getComputedStyle(document.getElementById('progress-area')).opacity, bar: { width: bar.width, y: bar.y } };
        });
        assert.ok(Math.abs(gallery.x - 960) < 1); assert.ok(gallery.width > 500 && gallery.width < 540);
        assert.ok(gallery.title < 30); assert.equal(gallery.brand, 'none'); assert.equal(gallery.progress, '0');
        assert.ok(gallery.bar.width >= 1920 * .89); assert.ok(gallery.bar.y > 1080 * .85);
        // Remote focus must not keep the toolbar/progress visible indefinitely.
        await tv.locator('body').press('ArrowDown');
        await tv.waitForFunction(() => getComputedStyle(document.getElementById('progress-area')).opacity === '1');
        await tv.waitForFunction(() => getComputedStyle(document.getElementById('toolbar')).opacity === '0', undefined, { timeout: 10000 });
        await tv.waitForFunction(() => getComputedStyle(document.getElementById('progress-area')).opacity === '0');
      }
      await phone.getByLabel('Voortgangsbalk voor dit ontwerp', { exact: true }).selectOption('always');
      await tv.waitForFunction(() => document.body.dataset.progressMode === 'always' && getComputedStyle(document.getElementById('progress-area')).opacity === '1');
      await tv.screenshot({ path: path.join(output, layout + '.png') });
    }
    for (const width of [320, 390, 768]) {
      await phone.setViewportSize({ width, height: 844 });
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone overflows at ' + width);
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.screenshot({ path: path.join(output, 'phone.png'), fullPage: true });
    let waveformRequests = 0;
    await tv.route('https://wave.sndcdn.com/resona-test.json', async route => {
      waveformRequests++;
      await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ height: 140, samples: Array.from({ length: 1800 }, (_, i) => Math.round(12 + Math.abs(Math.sin(i / 39)) * 100)) }) });
    });
    const fixtureTrack = { id: 'resona-test', title: 'Eva Vrijdag | Live at Subcultuur Festival 2025', artist: '𝙎𝙐𝘽𝘾𝙐𝙇𝙏𝙐𝙐𝙍',
      url: base + '/demo.mp3', artworkUrl: base + '/demo-cover.svg', waveformUrl: 'https://wave.sndcdn.com/resona-test.json', duration: 20 };
    await command({ type: 'load', tracks: [fixtureTrack], autoplay: false, position: 7 });
    await tv.getByText('SUBCULTUUR', { exact: true }).waitFor();
    fixtureTrack.artist = 'Eva Vrijdag';
    await command({ type: 'load', tracks: [fixtureTrack], autoplay: false, position: 7 });
    await tv.getByText('Eva Vrijdag', { exact: true }).waitFor();
    await tv.waitForFunction(() => document.getElementById('audio').readyState >= 3);
    assert.equal(waveformRequests, 0, 'disabled waveforms must not fetch metadata');
    await phone.getByLabel('Ontwerp', { exact: true }).selectOption('gallery');
    await phone.getByLabel('Trackwaveform', { exact: true }).check();
    await tv.waitForFunction(() => document.getElementById('waveform-track').dataset.draws === '1' && !document.getElementById('waveform-track').hidden);
    await phone.getByRole('button', { name: 'Afspelen', exact: true }).click();
    await tv.waitForFunction(() => !document.getElementById('audio').paused);
    const performanceResult = await tv.evaluate(() => new Promise((resolve, reject) => {
      const intervals = [], start = performance.now(); let previous = start;
      const timeout = setTimeout(() => reject(new Error('Frame sampling timed out')), 7000);
      function frame(now) {
        intervals.push(now - previous); previous = now;
        if (now - start < 2500) { requestAnimationFrame(frame); return; }
        clearTimeout(timeout); intervals.shift(); intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        resolve({ environment: 'CI Chromium; not an LG hardware FPS measurement', estimatedFPS: 1000 / median,
          medianFrameMs: median, p95FrameMs: intervals[Math.floor(intervals.length * .95)], framesOver33ms: intervals.filter(x => x > 33.4).length,
          sampledFrames: intervals.length, waveformDraws: document.getElementById('waveform-track').dataset.draws });
      }
      requestAnimationFrame(frame);
    }));
    assert.equal(performanceResult.waveformDraws, '1', 'waveform must not redraw while playing');
    assert.equal(waveformRequests, 1, 'waveform metadata is fetched once per track');
    fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(performanceResult, null, 2));
    await tv.screenshot({ path: path.join(output, 'gallery-waveform.png') });
    await phone.getByRole('button', { name: 'Pauzeren', exact: true }).click();
    await phone.locator('#seek').evaluate(element => { element.value = '7'; element.dispatchEvent(new Event('change', { bubbles: true })); });
    await tv.waitForFunction(() => document.getElementById('audio').paused && Math.abs(document.getElementById('audio').currentTime - 7) < .5);
    const generation = receiver.snapshot().generation;
    const audioSource = await tv.locator('#audio').getAttribute('src');
    await command({ type: 'artwork', generation, trackId: 'resona-test', artworkRevision: 1, artworkUrl: base + '/missing-cover.jpg' });
    await tv.waitForFunction(() => document.getElementById('cover').hidden);
    const inlineCover = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../app/icon.png')).toString('base64');
    await command({ type: 'artwork', generation, trackId: 'resona-test', artworkRevision: 2, artworkUrl: inlineCover });
    await tv.waitForFunction(() => !document.getElementById('cover').hidden && document.getElementById('cover').naturalWidth > 0 && document.getElementById('backdrop').style.backgroundImage !== '');
    assert.equal(await tv.locator('#audio').getAttribute('src'), audioSource);
    assert.equal(await tv.locator('#audio').evaluate(audio => audio.paused && Math.abs(audio.currentTime - 7) < 0.5), true);
    assert.equal(receiver.snapshot().generation, generation);
    await phone.getByLabel('Ontwerp', { exact: true }).selectOption('cinema');
    await tv.waitForFunction(() => document.body.dataset.layout === 'cinema');
    await tv.screenshot({ path: path.join(output, 'late-artwork.png') });
    // The queue is resolved before handoff; the phone can disappear without stopping queue advancement.
    await phone.locator('#queue-form').locator('..').getByText('Wachtrij importeren', { exact: true }).click();
    await phone.getByLabel('Nummers als JSON').fill(JSON.stringify([
      { id: 'queue-first', title: 'First in queue', artist: 'Test', url: base + '/demo.mp3', duration: 20 },
      { id: 'queue-second', title: '<img src=x onerror=alert(1)>', artist: 'Next without phone', url: base + '/demo.mp3', duration: 20 }
    ]));
    await phone.getByRole('button', { name: 'Wachtrij naar tv', exact: true }).click();
    await tv.getByRole('heading', { name: 'First in queue', exact: true }).waitFor();
    await tv.waitForFunction(() => !document.getElementById('audio').paused);
    await phone.locator('#remote-next').click();
    await tv.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor();
    await phone.locator('#remote-previous').click();
    await tv.getByRole('heading', { name: 'First in queue', exact: true }).waitFor();
    await tv.waitForFunction(() => !document.getElementById('audio').paused);
    await phoneContext.close();
    await tv.locator('#audio').evaluate(audio => { audio.currentTime = 19.4; });
    await tv.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await tv.locator('#title img').count(), 0);
    assert.equal(await tv.locator('#cover').isVisible(), false);
    assert.equal(receiver.snapshot().index, 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ result: 'passed', layouts: 4, progressModesPerLayout: ['auto', 'always'], waveform: 'static bitmaps with compositor-only progress', normalizedArtist: true, phoneWidths: [320, 390, 768], realAudio: 'MP3', controls: ['pair', 'play', 'pause', 'seek', 'layout', 'next', 'previous'], lateArtworkWithoutReload: true, autonomousQueue: true, errors }, null, 2));
    console.log('PASS: pairing, real MP3 playback, pause/seek, layouts, late artwork without audio reload, next/previous, autonomous queue and safe text.');
  } catch (error) {
    if (!tv.isClosed()) {
      await tv.screenshot({ path: path.join(output, 'failure-tv.png') }).catch(() => {});
      const detail = await tv.evaluate(() => { const a = document.getElementById('audio'); return { time: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : null, paused: a.paused, readyState: a.readyState, seekable: Array.from({ length: a.seekable.length }, (_, i) => [a.seekable.start(i), a.seekable.end(i)]), message: document.getElementById('message').textContent }; }).catch(() => ({}));
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ receiver: receiver.snapshot(), media: detail, errors }, null, 2));
    }
    throw error;
  } finally {
    await browser.close(); receiver.server.closeAllConnections(); await new Promise(r => receiver.server.close(r));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
