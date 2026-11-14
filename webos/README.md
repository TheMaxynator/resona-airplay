# Resona TV for rooted LG webOS

Version **0.1.1**, a hardware-test candidate for webOS 23. The television plays audio directly and draws the square cover over a blurred, dimmed version of the same image. It provides Cinema, Gallery, Ambient and Night layouts, progress, TV remote controls and a PIN-paired phone remote. A resolved queue of up to 100 tracks can advance on the TV without keeping the phone awake.

## Install and try

For installation and future updates through **Homebrew Channel**, add this repository under Settings → Add repository:

```text
https://raw.githubusercontent.com/TheMaxynator/resona-airplay/main/repo.json
```

It lists Resona TV with its version, root requirement, icon, release download and SHA-256 checksum. New versions are published only after the receiver, Node 12 and browser checks pass. Refresh Homebrew Channel's app list to discover updates. Published IPKs are kept immutable: increment `app/appinfo.json` for a new application version. The publisher updates the index using the already-published bytes on retries. The first release is labelled as a test/pre-release on GitHub.

1. Use your existing rooted-TV connection in [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) to install `com.themaxynator.resonatv_0.1.1_all.ipk`.
2. Ensure Homebrew Channel is installed and working as root. Launch **Resona TV** on the television. The app starts its bundled receiver through Homebrew Channel's documented `exec` method. No boot hook or firewall changes are installed.
3. The TV shows a six-digit code and an address/QR code. Keep the TV app open. Your iPhone and TV need the same reachable home network. If no IP can be detected, look up the TV's IPv4 address in its network settings; use `http://TV-IP:42700/remote`.
4. For an initial hardware check, open that address in Safari, enter the code, expand **Testgeluid of eigen audiolink** and select **Testgeluid afspelen**. This plays a bundled, quiet 20-second test tone and example cover.
5. Install **Resona TV 2.0.3 build 20** on the iPhone using your usual signing method. Open its **TV** button, select **LG app**, enter the TV IPv4 address and code, then select **Send queue to LG** while an online track is loaded. Allow local-network access if iOS asks. Stop AirPlay/Screen Mirroring for this mode.

Covers now have a remote-URL fallback and a correctly scaled, size-bounded JPEG. Artwork arriving after handoff is sent separately, without restarting audio. Generation, queue-slot and revision guards prevent old artwork from replacing the next track. The TV button sits at the lower right above the actual player/dock height.

The sender prepares the stream paused on the TV, pauses the iPhone only after the receiver reports ready, seeks to the current position, starts the TV and checks playback. Failed transfers after pausing restore local playback when the same iPhone track is still selected. Starting local playback while connected pauses the TV. The iPhone pairing token is kept in Keychain.

The native handoff sends a **snapshot of the actual Resona queue, up to 100 online tracks**, keeping the current position, order and duplicate entries. It starts on the selected track and includes up to ten previous entries when available. Unavailable tracks are skipped and counted. Keep Resona open while the links are prepared; the TV then owns playback and can advance independently. Next and Previous operate on this transferred queue. Send again after editing the iPhone queue. The iPhone lock-screen controls still operate the local player. Use **LG TV Connect**, the TV remote or the Safari remote to control the receiver. A queue imported in the Safari remote can advance independently. Files that exist only on the iPhone cannot be fetched by the TV, and expiring SoundCloud links are not renewed by the receiver. Send such a track again to obtain a fresh link.

## Verification

The automated `webOS receiver` workflow runs protocol/security tests and a Chromium browser test with real MP3 decoding. The browser test pairs a phone, starts audio, pauses, seeks, selects and captures all four layouts, checks widths 320/390/768, closes the phone and verifies that the TV advances to the next queued track. It also checks that track text cannot inject HTML. Native Swift typechecking, simulator tests and a complete device IPA build run separately in `AirPlay iOS`.

Passing browser tests establishes the implementation's behavior, not LG hardware compatibility. Still required on the actual TV: Homebrew bootstrap/Node availability, local port reachability, SoundCloud HLS/audio decoding, TV-remote key mapping, app suspension/relaunch and the OLED screensaver.

LG's documented Type 3 gallery policy is requested: it gradually dims and extends the screensaver timeout to **30 minutes** on supported OLEDs. It may change picture settings to Gallery mode. This does not guarantee indefinite artwork display. The app adds a small periodic composition shift; it does not disable the TV's OLED protection. Record actual behavior during the device test.

## Local receiver

The bundled Node 12-compatible helper listens on TCP **42700**, without a computer or cloud relay. The display endpoint is restricted to loopback. Phone commands require a token obtained with the on-screen code; PIN attempts are limited. No endpoint accepts shell commands, file paths or arbitrary headers. Media is fetched directly by the TV's audio element, not proxied through a root file API.

The prototype uses HTTP on the private home network; it does not provide TLS encryption. Do not expose its port to the Internet. Pairing sessions and stream URLs are memory-only. Only appearance preferences and a minimal receiver log are stored under `/var/lib/resona-tv`. The process exits approximately two minutes after its last display heartbeat and restarts when the TV app opens again. Close the TV app before replacing or removing its package. After updating, reopen it: the launcher checks the installed version and replaces only the same-owner Node process running its exact receiver script on the same port. You may need to enter the new pairing code.

If startup fails, read `/var/lib/resona-tv/receiver.log` through your existing TV-management connection. The fixed bootstrap command is:

```sh
sh /media/developer/apps/usr/palm/applications/com.themaxynator.resonatv/start-receiver.sh
```

The user confirmed pairing, real audio playback, seek, pause/resume and layout switching on an LG G3/webOS 23 in 0.1.0/2.0.2. Artwork and native queue operation failed in that build. Version 0.1.1 with iPhone 2.0.3 fixes those paths and still needs a hardware retest. No direct connection to the user's TV was made from the development environment.

## Build

```sh
cd webos
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

`dist/` contains the `.ipk` and checksum. Generated binary fixtures are stored as base64 source so packaging is reproducible through the available repository editor. The Node runtime requires no npm modules; QR generation and LG's webOSTV.js are bundled browser assets with their original licenses. The rest inherits the repository's GPL-3.0 license.

## Platform references

- [LG web app metadata](https://webostv.developer.lge.com/develop/references/appinfo-json)
- [LG JavaScript runtime versions](https://webostv.developer.lge.com/develop/guides/js-service-basics)
- [LG native audio playback](https://webostv.developer.lge.com/develop/guides/multi-sound-playback)
- [LG screensaver policy](https://webostv.developer.lge.com/develop/guides/screensaver)
- [Homebrew Channel's root execution interface](https://github.com/webosbrew/webos-homebrew-channel#lunaorgwebosbrewhbchannelserviceexec)
