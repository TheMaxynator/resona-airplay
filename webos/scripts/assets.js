'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
for (const pair of [['icon.base64', 'icon.png'], ['large-icon.base64', 'large-icon.png'], ['demo-mp3.base64', 'demo.mp3']]) {
  fs.writeFileSync(path.join(root, 'app', pair[1]), Buffer.from(fs.readFileSync(path.join(__dirname, pair[0]), 'utf8').trim(), 'base64'));
}
const qr = path.dirname(require.resolve('qrcode-generator/package.json'));
fs.copyFileSync(path.join(qr, 'qrcode.js'), path.join(root, 'app/vendor/qrcode.js'));
fs.copyFileSync(path.join(__dirname, 'QR-LICENSE.txt'), path.join(root, 'app/vendor/QR-LICENSE.txt'));
console.log('Prepared local icons, QR library, and 20-second test audio.');
