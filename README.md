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

The **0.2.0** LG package is an early hardware-test candidate for a rooted webOS 23 TV with Homebrew Channel working as root. Open **Resona TV** on the television, scan its QR code or open the displayed address on your phone, then enter the six-digit code. The phone remote includes a bundled quiet test tone and controls for playback, position, layout and dimming. Installation and hardware checks are detailed in [webos/README.md](webos/README.md).

## Companion iPhone build

The **2.1.0, build 22** iPhone candidate adds **LG app → LG TV Connect**. Install its unsigned IPA with your usual signing method, enter the TV's private IPv4 address and pairing code, and select **Send iPhone queue to LG**. Stop AirPlay/Screen Mirroring for this mode. The TV prepares the stream before the iPhone pauses; failed transfers can restore the original local track. Starting local playback while connected pauses the receiver. Pairing credentials are kept in Keychain; local HTTP exceptions are limited to private LAN ranges.

The first handoff transfers a resolved queue of up to 100 online tracks, preserving order and duplicate slots. While LG is active, the existing iPhone mini player, full player and queue follow the receiver. Play, pause, seek, next and previous control the TV. New selections, Play Next and Add to Queue are resolved through the signed-in iPhone account and sent to the receiver; credentials stay on the phone. Queue edits from multiple controllers use a revision check, so a slow operation cannot overwrite someone else's newer queue.

Reordering or removing upcoming items keeps the current audio decoder and position. Removing the current item advances to its successor; removing a final current item prepares the preceding one paused. The web remote provides accessible move/remove/play buttons and append-next/last import actions. The native queue supports drag-to-reorder with one command at drop.

The floating TV button remains at the lower right above the player/dock. In the TV player, **Listen on iPhone** first pauses the TV, then returns the current online track and position to local playback. A failed connection keeps the controls attached to the TV session and uses bounded retry backoff. Previously paired phones reconnect after the receiver restarts. Forget a phone individually or revoke every pairing from the TV pairing screen.

Initial transfer and resolving new selections need Resona open. The TV can continue its resolved queue when the phone locks or disconnects. **Retry stream** asks the foreground iPhone to resolve a fresh link for the current SoundCloud track; continuous background URL renewal is not promised. Offline/cache-only phone files cannot be handed directly to the receiver. The queue is still bounded to 100 entries. Metadata includes the original SoundCloud ID independently of the unique queue-slot ID. Covers keep a bounded JPEG and an HTTP source for the phone; repeated TV display polling does not resend unchanged inline artwork.

The iPhone bundle ID remains `com.themaxynator.resona.airplay`, so this updates the earlier Resona TV test app. It installs alongside upstream Resona and uses separate app data from upstream.

## Artist and waveform update

The 2.0.4 sender uses the published artist when SoundCloud provides one, forwards its public waveform URL and keeps the uploader as a fallback. The 0.1.3 TV normalizes stylized Unicode text and provides independent progress visibility per layout. Optional waveforms are precomputed peaks, not live spectrum analysis. [Technical findings and performance limits](webos/WAVEFORM_RESEARCH.md) explain the native webOS audio limitation, bounded renderer and the distinction between CI measurements and real G3 frame rate.

## Verified and pending

- The complete [0.2.0 webOS workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43616509470) passed: **23 receiver tests**, actual Node 12 startup/protocol compatibility, real-MP3 browser playback and package publication.
- The two-controller browser regression passed append, reorder, remove and selection. Upcoming queue edits preserved the active audio source, generation and paused position. Gallery/progress/waveform checks, late covers and autonomous queue advancement also passed. The phone web-remote screenshot was visually inspected.
- The public 0.2.0 Homebrew index, release manifest and 206,920-byte package agree. SHA-256: `32b9ef08f11eb4cbf31bf9a288b91a705ec8c134f8aef219d18c1ce422dd0118`.
- In the short 150-frame Chromium sample, median/p95 intervals were 16.7/16.8 ms (about 60 FPS), with no intervals above 33.4 ms. This is a runner measurement, not a physical G3 FPS measurement.
- The [2.1.0 iPhone workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43616509402) passed the production Kotlin bridge contract and native Swift typecheck. Its ten simulator tests and complete device IPA build are recorded in that workflow; the IPA has not yet been delivered. The contract compiles the actual state/command and JSON source with boundary data types; the full app build compiles the real models and UI.
- The previous [2.0.4 iPhone build](https://github.com/TheMaxynator/resona-airplay/actions/runs/43608375382) passed and its IPA was delivered. The user confirmed basic playback and Gallery artwork on an LG G3/webOS 23. The new iPhone TV player, queue editing, remembered connections and recovery still need a physical test.
- Automatic mDNS discovery, server-assisted visuals, DJ-set bookmarks/chapters and new design variants are future phases. LG's OLED screensaver policy remains in force.

The [AirPlay research and hardware checklist](AIRPLAY.md) records platform limits. LiveContainer has an [open iOS 27 external-display report](https://github.com/LiveContainer/LiveContainer/issues/1694); a directly signed installation is the reference setup for testing the iPhone's Screen Mirroring mode.

## License

GPL-3.0, as upstream. Vendored webOS and QR assets retain their original notices. This is an independent fork, not an official Resona release.
