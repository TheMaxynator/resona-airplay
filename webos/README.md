# Resona TV for rooted LG webOS

Version **0.3.0**, a hardware-test candidate for webOS 23. The television plays audio directly and draws the square cover over a blurred, dimmed version of the same image. It provides Cinema, Gallery, Ambient, Night and Studio layouts, progress, TV remote controls and a PIN-paired phone remote. A resolved queue of up to 100 tracks can advance on the TV without keeping the phone awake.

## Gallery appearance

Choose **Gallery** in LG TV Connect, the Safari remote or the TV layout button. Its proportions follow the supplied TV photographs: a cover about half the screen height, two compact text lines below, a restrained playback indicator and a bright full-screen color wash sampled from the artwork. The toolbar hides after five seconds. Each layout separately remembers whether its progress bar remains visible or fades with the toolbar. Gallery has a subtle progress line across 90% of the screen near the bottom edge. If an external image does not permit canvas access, its blurred cover remains the background. Other layouts retain their previous appearance.

## Install and try

For installation and future updates through **Homebrew Channel**, add this repository under Settings → Add repository:

```text
https://raw.githubusercontent.com/TheMaxynator/resona-airplay/main/repo.json
```

It lists Resona TV with its version, root requirement, icon, release download and SHA-256 checksum. New versions are published only after the receiver, Node 12 and browser checks pass. Refresh Homebrew Channel's app list to discover updates. Published IPKs are kept immutable: increment `app/appinfo.json` for a new application version. The publisher updates the index using the already-published bytes on retries. The first release is labelled as a test/pre-release on GitHub.

1. Use your existing rooted-TV connection in [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) to install `com.themaxynator.resonatv_0.3.0_all.ipk`.
2. Ensure Homebrew Channel is installed and working as root. Launch **Resona TV** on the television. The app starts its bundled receiver through Homebrew Channel's documented `exec` method. No boot hook or firewall changes are installed.
3. The TV shows a six-digit code and an address/QR code. Keep the TV app open. Your iPhone and TV need the same reachable home network. If no IP can be detected, look up the TV's IPv4 address in its network settings; use `http://TV-IP:42700/remote`.
4. For an initial hardware check, open that address in Safari, enter the code, expand **Testgeluid of eigen audiolink** and select **Testgeluid afspelen**. This plays a bundled, quiet 20-second test tone and example cover.
5. Install **Resona TV 2.2.0 build 23** on the iPhone using your usual signing method. Open its **TV** button, select **LG app**, enter the TV IPv4 address and code, then select **Send iPhone queue to LG** while an online track is loaded. Allow local-network access if iOS asks. Stop AirPlay/Screen Mirroring for this mode.

Covers now have a remote-URL fallback and a correctly scaled, size-bounded JPEG. Artwork arriving after handoff is sent separately, without restarting audio. Generation, queue-slot and revision guards prevent old artwork from replacing the next track. The TV button sits at the lower right above the actual player/dock height.

The sender prepares the stream paused on the TV, pauses the iPhone only after the receiver reports ready, seeks to the current position, starts the TV and checks playback. Failed transfers after pausing restore local playback when the same iPhone track is still selected. Starting local playback while connected pauses the TV. The iPhone pairing token is kept in Keychain.

The native handoff sends a **snapshot of the actual Resona queue, up to 100 online tracks**, keeping the current position, order and duplicate entries. It starts on the selected track and includes up to ten previous entries when available. Unavailable tracks are skipped and counted. Keep Resona open while the links are prepared; the TV then owns playback and can advance independently. Next and Previous operate on this transferred queue. While LG is selected, the iPhone player, lock-screen transport commands and queue control that TV session. Use the foreground app for fresh stream resolution. The TV remote and Safari remote also control the receiver. A queue imported in the Safari remote can advance independently. Files that exist only on the iPhone cannot be fetched by the TV, and expiring SoundCloud links are not renewed by the receiver. Send such a track again to obtain a fresh link.

## Progress, artist names and waveforms

Use the **Balk** button on the TV toolbar to switch the active layout between **altijd** and **auto**. The Safari remote has **Voortgangsbalk voor dit ontwerp** with the same choices. Changes persist per layout, so Gallery may stay visible while Night fades. The existing global progress toggle still hides the entire progress area.

The sender in iPhone **2.0.4 (21)** prefers `publisher_metadata.artist`, then `metadata_artist`, then the uploader name. It refreshes the selected track's metadata during handoff so older cached entries can obtain the artist field. The TV applies Unicode compatibility normalization without removing accents or other scripts. For the reported track, the artist is **Eva Vrijdag** and the stylized uploader is **SUBCULTUUR**.

Turn on **Trackwaveform** in the phone web remote or **Golfvorm** on the TV. The sender supplies the track's public SoundCloud waveform URL. The TV fetches this small metadata file only while the option is enabled; it never downloads/decodes another audio copy. Two small 960×44 canvases are painted once, with a maximum of 240 peak bars. Progress uses counter-translated compositor layers. Missing/invalid waveform metadata falls back to the line. This is a precomputed, position-synchronized waveform, **not live PCM/FFT analysis**. See [waveform and performance research](WAVEFORM_RESEARCH.md).

Version 2.0.3 remains compatible with progress settings and readable uploader names; publisher artists and automatic waveform metadata need the updated iPhone sender. No continuous frame loop, expensive live audio analyser, new root daemon or media proxy is introduced. Unchanged inline artwork is omitted from repeated TV polls. Text is changed only when its displayed value changes and progress uses transforms rather than animated width. Gallery stops rendering the blurred backdrop when its color palette is ready.

## Verification

The automated `webOS receiver` workflow runs protocol/security tests and a Chromium browser test with real MP3 decoding. The browser test pairs a phone, starts audio, pauses, seeks, selects and captures all four layouts, checks widths 320/390/768, closes the phone and verifies that the TV advances to the next queued track. It also checks that track text cannot inject HTML. Native Swift typechecking, simulator tests and a complete device IPA build run separately in `AirPlay iOS`.

Passing browser tests establishes the implementation's behavior, not LG hardware compatibility. Still required on the actual TV: Homebrew bootstrap/Node availability, local port reachability, SoundCloud HLS/audio decoding, TV-remote key mapping, app suspension/relaunch and the OLED screensaver.

LG's documented Type 3 gallery policy is requested: it gradually dims and extends the screensaver timeout to **30 minutes** on supported OLEDs. It may change picture settings to Gallery mode. This does not guarantee indefinite artwork display. The app adds a small periodic composition shift; it does not disable the TV's OLED protection. Record actual behavior during the device test.

## Local receiver

The bundled Node 12-compatible helper listens on TCP **42700**, without a computer or cloud relay. The display endpoint is restricted to loopback. Phone commands require a token obtained with the on-screen code; PIN attempts are limited. No endpoint accepts shell commands, file paths or arbitrary headers. Media is fetched directly by the TV's audio element, not proxied through a root file API.

The prototype uses HTTP on the private home network; it does not provide TLS encryption. Do not expose its port to the Internet. Stream URLs remain memory-only. Appearance preferences, bounded bookmarks/listening checkpoints, hashes of paired-device tokens and a minimal receiver log are stored under `/var/lib/resona-tv`. The process exits approximately two minutes after its last display heartbeat and restarts when the TV app opens again. Close the TV app before replacing or removing its package. After updating, reopen it: the launcher checks the installed version and replaces only the same-owner Node process running its exact receiver script on the same port. After upgrading from 0.1.x, pair once. In 0.2.0, trusted devices survive helper restarts; disconnect removes that phone, and the TV pairing screen can forget all phones.

If startup fails, read `/var/lib/resona-tv/receiver.log` through your existing TV-management connection. The fixed bootstrap command is:

```sh
sh /media/developer/apps/usr/palm/applications/com.themaxynator.resonatv/start-receiver.sh
```

The user confirmed pairing, real audio playback, seek, pause/resume and layout switching on an LG G3/webOS 23, and subsequently confirmed Gallery artwork through a photo. The 0.1.3 artist, progress and waveform changes need a physical hardware test. Native queue advancement is covered by the browser regression. No direct connection to the user's TV was made from the development environment.

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

## Shared session in 0.2.0 / iPhone 2.1.0

The iPhone mini player and full player control the selected TV, and the ordinary queue sheet mirrors its live queue. Add next/last, reorder, remove and jump to a slot without resending everything. The web remote offers equivalent queue buttons. Queue revisions prevent lost concurrent edits. New track resolution requires the foreground iPhone and uses the account already there, without sending its credentials to the television. Initial handoff still prepares up to 100 online tracks for independent TV playback.

The receiver remembers only hashes of paired-device tokens in `paired-devices.json` (mode 0600), never raw tokens, queue URLs or account credentials. The TV pairing screen has a Forget paired phones action; each phone can also disconnect itself. The iPhone retains the selected TV during a network interruption, uses backoff and refreshes on foreground. Listen on iPhone pauses the receiver before returning the current track and position. Retry stream refreshes the current SoundCloud link through the foreground iPhone, preserving its queue slot and position. It does not provide unattended background refresh.

The standalone Kotlin bridge check is `./ios/gradlew -p tests/tv-bridge run`. CI also typechecks the Swift adapter, runs ten native tests, compiles the complete IPA, checks Node 12 and exercises two browser controllers editing one playing queue. Physical iPhone and G3 verification remains required.

## Studio and DJ-set tools in 0.3.0

Choose **Studio** for a wide waveform timeline, static chapter markers and the current chapter. Gallery remains the quiet/default layout for new installations; existing choices are preserved. Each of the five layouts keeps its own always/auto progress choice. Select Gallery/DJ-set/Night under **Session → Sfeer** for a preset; other layouts' progress modes remain unchanged.

Press **Up** from the idle screen or select **Sessie** on the toolbar. Arrow keys move between visible actions, OK activates them and Back closes the drawer. It also closes after 30 seconds without interaction. The drawer contains a chapter list, current/upcoming queue (six slots; the phone has the complete editor), bookmarks, Resume, presets and a sleep timer. The phone web remote has the same tools, and the native iPhone adds **LG TV Connect → Session & DJ sets**.

The iPhone 2.2.0 sender reads timestamp-bearing lines from the public track description. At least two labelled timestamps are required; beginning/end-of-line `MM:SS` or `H:MM:SS` formats, brackets and common separators are supported. Chapters are bounded to 100 per track, sorted and deduplicated. Times outside a known duration are discarded. A manual JSON track may contain `chapterText`, for example `"00:00 Intro\n05:30 Main set"`. Nothing is invented when a caption has no valid tracklist.

Bookmarks and last positions follow the original SoundCloud ID, including fresh queue slots on a later day. **Hervatten** seeks the already loaded stream to its prior position. It does not automatically restart a stored queue or retain expiring stream URLs. Up to 100 records and 20 bookmarks per track are saved under `listening-history.json`; only stable keys, times and optional bookmark labels are stored. An interrupted process can lose up to 15 seconds of progress. Completed tracks reset their resume checkpoint. A missing/corrupt/unwritable history does not prevent playback.

The timer pauses audio after 15/30/60/90 minutes or the end of the current track. Repeatedly select its button to cycle the options, or use **Timer uitzetten**; the native iPhone uses a menu. It never powers off the television, and is not restored after restarting the helper. End-of-track sleep blocks the next queue entry and cancels on a manual track change. An optional **Hierna-melding** near the end can be disabled from the phone appearance controls. It is hidden when end-of-track sleep is active.

The waveform remains a precomputed, position-synchronized bitmap with at most 240 bars; Studio only changes its displayed dimensions. Closed TV drawers skip their list rendering. Queue/chapter/bookmark lists are rebuilt only when their metadata changes. Both TV and phone use bounded fetch timeouts; the phone now requests compact cover metadata. Regression artifacts contain separate Gallery, Studio and open-Session frame samples. These characterize CI Chromium, not actual LG G3 FPS. OLED protection remains enabled.
