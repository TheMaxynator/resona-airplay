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
      await tv.waitForFunction(value => Math.abs(Number(getComputedStyle(document.getElementById('backdrop')).opacity) - (value === 'night' ? 0.52 * 0.28 : 0.52)) < 0.01, layout);
      await tv.screenshot({ path: path.join(output, layout + '.png') });
    }
    for (const width of [320, 390, 768]) {
      await phone.setViewportSize({ width, height: 844 });
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone overflows at ' + width);
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.screenshot({ path: path.join(output, 'phone.png'), fullPage: true });
    // The queue is resolved before handoff; the phone can disappear without stopping queue advancement.
    await phone.locator('#queue-form').locator('..').getByText('Wachtrij importeren', { exact: true }).click();
    await phone.getByLabel('Nummers als JSON').fill(JSON.stringify([
      { id: 'queue-first', title: 'First in queue', artist: 'Test', url: base + '/demo.mp3', duration: 20 },
      { id: 'queue-second', title: '<img src=x onerror=alert(1)>', artist: 'Next without phone', url: base + '/demo.mp3', duration: 20 }
    ]));
    await phone.getByRole('button', { name: 'Wachtrij naar tv', exact: true }).click();
    await tv.getByRole('heading', { name: 'First in queue', exact: true }).waitFor();
    await tv.waitForFunction(() => !document.getElementById('audio').paused);
    await phoneContext.close();
    await tv.locator('#audio').evaluate(audio => { audio.currentTime = 19.4; });
    await tv.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await tv.locator('#title img').count(), 0);
    assert.equal(await tv.locator('#cover').isVisible(), false);
    assert.equal(receiver.snapshot().index, 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ result: 'passed', layouts: 4, phoneWidths: [320, 390, 768], realAudio: 'MP3', controls: ['pair', 'play', 'pause', 'seek', 'layout'], autonomousQueue: true, errors }, null, 2));
    console.log('PASS: PIN pairing, real MP3 playback, pause/seek, four layouts, responsive controls, autonomous queue, and text injection handling.');
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
