# Resona TV / AirPlay fork

An experimental iOS and rooted-LG-webOS fork of [savo-o/resona](https://github.com/savo-o/resona), based on Resona **v2.0**, source `0adbfd1`. See the [original README](https://github.com/savo-o/resona/blob/v2.0/README.md) for upstream features.

## Three television modes

| Mode | Playback and picture | Phone usage |
| --- | --- | --- |
| **Audio only** | Ordinary audio AirPlay; the receiver decides how to display artwork | Background audio and phone locking |
| **TV display** | Sharp square cover over a blurred/dimmed cover background through Screen Mirroring | Keep Resona open and the phone unlocked |
| **LG app** | The separate Resona TV webOS app fetches the stream and renders its own interface | The phone can disconnect after transfer; TV playback is independent |

The four designs are **Cinema**, **Gallery**, **Ambient** and **Night**. **Gallery** follows the supplied TV reference: a centered cover, compact title and artist, cover-derived color gradients and a small playback indicator. It hides branding and supports either a constant or automatically fading progress bar. Each layout remembers this independently. Gallery uses a subtle 90%-width bar at the bottom. An optional precomputed track waveform follows playback without another audio decoder. Open the iPhone app's **TV** button to choose an output mode. LG app mode uses the local receiver rather than Apple's AirPlay picker.

## Install the LG app using Homebrew Channel

Add this repository under **Settings → Add repository**:

```text
https://raw.githubusercontent.com/TheMaxynator/resona-airplay/main/repo.json
```

It publishes the current app version, icon, GitHub release download and exact SHA-256 checksum. TV releases are published only after protocol tests, a Node 12 compatibility check and a real-MP3 browser test pass. Refresh Homebrew Channel to discover subsequent versions. Existing IPKs are immutable; a new app version requires incrementing `webos/app/appinfo.json` and keeping the receiver and bootstrap version checks in sync. The catalog is updated from the actual published bytes.

The **0.1.3** LG package is an early hardware-test candidate for a rooted webOS 23 TV with Homebrew Channel working as root. Open **Resona TV** on the television, scan its QR code or open the displayed address on your phone, then enter the six-digit code. The phone remote includes a bundled quiet test tone and controls for playback, position, layout and dimming. Installation and hardware checks are detailed in [webos/README.md](webos/README.md).

## Companion iPhone build

The **2.0.4, build 21** iPhone candidate adds **LG app → LG TV Connect**. Install its unsigned IPA with your usual signing method, enter the TV's private IPv4 address and pairing code, and select **Send queue to LG**. Stop AirPlay/Screen Mirroring for this mode. The TV prepares the stream before the iPhone pauses; failed transfers can restore the original local track. Starting local playback while connected pauses the receiver. Pairing credentials are kept in Keychain; local HTTP exceptions are limited to private LAN ranges.

The native sender now transfers a **snapshot of the Resona queue, up to 100 online tracks**, preserving order and duplicate entries. It includes up to ten preceding entries, starts at the selected track and reports skipped unavailable tracks. Next, Previous and automatic advancement run on the TV. Editing the phone queue requires sending it again. The floating TV button now sits at the lower right above the actual player/dock inset, leaving Settings unobstructed. Covers use a true 500-pixel JPEG with a bounded payload, a remote-URL fallback, and guarded updates if artwork finishes loading after handoff. Offline/cache-only files cannot be fetched directly from the phone, and the receiver does not renew expiring SoundCloud links. The Safari remote can import a resolved queue of up to 100 tracks which advances on the TV independently. Use LG TV Connect, the TV remote or Safari for receiver controls.

The iPhone bundle ID remains `com.themaxynator.resona.airplay`, so this updates the earlier Resona TV test app. It installs alongside upstream Resona and uses separate app data from upstream.

## Artist and waveform update

The 2.0.4 sender uses the published artist when SoundCloud provides one, forwards its public waveform URL and keeps the uploader as a fallback. The 0.1.3 TV normalizes stylized Unicode text and provides independent progress visibility per layout. Optional waveforms are precomputed peaks, not live spectrum analysis. [Technical findings and performance limits](webos/WAVEFORM_RESEARCH.md) explain the native webOS audio limitation, bounded renderer and the distinction between CI measurements and real G3 frame rate.

## Verified and pending

- The previous 2.0.3 iPhone build passed native typechecking, eight simulator tests and a full device build in [the LG Connect workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43590334733). The [2.0.4 build](https://github.com/TheMaxynator/resona-airplay/actions/runs/43608375382) has passed native typechecking and is still running the simulator/device pipeline; its IPA has not yet been delivered.
- All **17** receiver tests, the actual Node 12 compatibility check, browser playback/layout tests and package publication passed for 0.1.3 in [the release workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43608375378). This includes Unicode metadata, independent persisted progress modes, compact artwork polling and waveform bounds.
- Browser coverage includes real MP3 playback, PIN pairing, pause/seek, four layouts, phone widths 320/390/768, safe text rendering, late artwork and queue advancement after the phone closes. The new checks passed for both progress modes and one waveform fetch/bitmap draw. During a 150-frame CI sample, median and p95 intervals were 16.7 ms (about 60 FPS), with no intervals above 33.4 ms. These are Chromium runner measurements, not LG G3 hardware measurements. Gallery line/waveform and phone-remote screenshots were visually inspected.
- The user confirmed pairing, playback, seeking, pause/resume and layout selection on an LG G3/webOS 23; the latest photo also confirms Gallery artwork and colors. Artist metadata, progress settings and waveform performance need a new hardware test. No direct connection to the user's TV was made. CI measurements cannot establish a physical G3 frame rate.
- The public Homebrew 0.1.3 index, release manifest and 204,100-byte IPK agree; SHA-256 is `4c7346f7d7b6c6c402cd49cbad93e1c83e808350e0bd20f80475b7fc33215646`.
- LG's gallery screensaver policy can dim and take over the image after 30 minutes; indefinite artwork display is not promised. Physical checks must cover bootstrap, SoundCloud/HLS compatibility, phone locking and remote keys.

The [AirPlay research and hardware checklist](AIRPLAY.md) records platform limits. LiveContainer has an [open iOS 27 external-display report](https://github.com/LiveContainer/LiveContainer/issues/1694); a directly signed installation is the reference setup for testing the iPhone's Screen Mirroring mode.

## License

GPL-3.0, as upstream. Vendored webOS and QR assets retain their original notices. This is an independent fork, not an official Resona release.
