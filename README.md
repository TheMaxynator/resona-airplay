# Resona TV / AirPlay fork

An experimental iOS and rooted-LG-webOS fork of [savo-o/resona](https://github.com/savo-o/resona), based on Resona **v2.0**, source `0adbfd1`. See the [original README](https://github.com/savo-o/resona/blob/v2.0/README.md) for upstream features.

## Three television modes

| Mode | Playback and picture | Phone usage |
| --- | --- | --- |
| **Audio only** | Ordinary audio AirPlay; the receiver decides how to display artwork | Background audio and phone locking |
| **TV display** | Sharp square cover over a blurred/dimmed cover background through Screen Mirroring | Keep Resona open and the phone unlocked |
| **LG app** | The separate Resona TV webOS app fetches the stream and renders its own interface | The phone can disconnect after transfer; TV playback is independent |

The LG app has five designs: **Cinema**, **Gallery**, **Ambient**, **Night** and **Studio**. Screen Mirroring retains its original four designs. **Gallery** follows the supplied TV reference: a centered cover, compact title and artist, cover-derived color gradients and a small playback indicator. It hides branding and supports either a constant or automatically fading progress bar. Each layout remembers this independently. Gallery uses a subtle 90%-width bar at the bottom. An optional precomputed track waveform follows playback without another audio decoder. Open the iPhone app's **TV** button to choose an output mode. LG app mode uses the local receiver rather than Apple's AirPlay picker.

## Install the LG app using Homebrew Channel

Add this repository under **Settings → Add repository**:

```text
https://raw.githubusercontent.com/TheMaxynator/resona-airplay/main/repo.json
```

It publishes the current app version, icon, GitHub release download and exact SHA-256 checksum. TV releases are published only after protocol tests, a Node 12 compatibility check and a real-MP3 browser test pass. Refresh Homebrew Channel to discover subsequent versions. Existing IPKs are immutable; a new app version requires incrementing `webos/app/appinfo.json` and keeping the receiver and bootstrap version checks in sync. The catalog is updated from the actual published bytes.

The **0.3.0** LG package is an early hardware-test candidate for a rooted webOS 23 TV with Homebrew Channel working as root. Open **Resona TV** on the television, scan its QR code or open the displayed address on your phone, then enter the six-digit code. The phone remote includes a bundled quiet test tone and controls for playback, position, layout and dimming. Installation and hardware checks are detailed in [webos/README.md](webos/README.md).

## Companion iPhone build

The **2.2.0, build 23** iPhone candidate adds **LG app → LG TV Connect**. Install its unsigned IPA with your usual signing method, enter the TV's private IPv4 address and pairing code, and select **Send iPhone queue to LG**. Stop AirPlay/Screen Mirroring for this mode. The TV prepares the stream before the iPhone pauses; failed transfers can restore the original local track. Starting local playback while connected pauses the receiver. Pairing credentials are kept in Keychain; local HTTP exceptions are limited to private LAN ranges.

The first handoff transfers a resolved queue of up to 100 online tracks, preserving order and duplicate slots. While LG is active, the existing iPhone mini player, full player and queue follow the receiver. Play, pause, seek, next and previous control the TV. New selections, Play Next and Add to Queue are resolved through the signed-in iPhone account and sent to the receiver; credentials stay on the phone. Queue edits from multiple controllers use a revision check, so a slow operation cannot overwrite someone else's newer queue.

Reordering or removing upcoming items keeps the current audio decoder and position. Removing the current item advances to its successor; removing a final current item prepares the preceding one paused. The web remote provides accessible move/remove/play buttons and append-next/last import actions. The native queue supports drag-to-reorder with one command at drop.

The floating TV button remains at the lower right above the player/dock. In the TV player, **Listen on iPhone** first pauses the TV, then returns the current online track and position to local playback. A failed connection keeps the controls attached to the TV session and uses bounded retry backoff. Previously paired phones reconnect after the receiver restarts. Forget a phone individually or revoke every pairing from the TV pairing screen.

Initial transfer and resolving new selections need Resona open. The TV can continue its resolved queue when the phone locks or disconnects. **Retry stream** asks the foreground iPhone to resolve a fresh link for the current SoundCloud track; continuous background URL renewal is not promised. Offline/cache-only phone files cannot be handed directly to the receiver. The queue is still bounded to 100 entries. Metadata includes the original SoundCloud ID independently of the unique queue-slot ID. Covers keep a bounded JPEG and an HTTP source for the phone; repeated TV display polling does not resend unchanged inline artwork.

The iPhone bundle ID remains `com.themaxynator.resona.airplay`, so this updates the earlier Resona TV test app. It installs alongside upstream Resona and uses separate app data from upstream.

## Artist and waveform update

The 2.0.4 sender uses the published artist when SoundCloud provides one, forwards its public waveform URL and keeps the uploader as a fallback. The 0.1.3 TV normalizes stylized Unicode text and provides independent progress visibility per layout. Optional waveforms are precomputed peaks, not live spectrum analysis. [Technical findings and performance limits](webos/WAVEFORM_RESEARCH.md) explain the native webOS audio limitation, bounded renderer and the distinction between CI measurements and real G3 frame rate.

## Studio and session tools in 0.3.0 / iPhone 2.2.0

**Gallery** is the default for a fresh installation; existing layout preferences are kept. **Studio** places the cover beside the track details and adds a wide, position-synchronized waveform with chapter markers and the current chapter. Its progress can stay visible or fade independently, just like the other four layouts. It uses the same two small waveform bitmaps, never a second decoder or continuous JavaScript drawing loop.

Open **Session** in the TV toolbar or press Up from the idle screen. This temporary drawer contains chapters, bookmarks, the current/upcoming queue, Gallery/DJ-set/Night presets, recovery actions and a sleep timer. Back closes it and returns focus to the toolbar; it closes after 30 seconds without interaction. Equivalent controls are in the phone web remote and **LG TV Connect → Session & DJ sets**. The optional **Up next** card appears near the end of a track, except when end-of-track sleep is active.

The updated iPhone forwards only timestamp-bearing lines from SoundCloud descriptions, with a total chapter-text budget of 24,000 characters per queue and up to 12,000 for the selected track. The receiver accepts at most 100 distinct, valid labelled timestamps per track, sorts them, ignores invalid/out-of-range values and requires at least two. Manual queue imports may include `chapterText`. It does not infer missing tracklists, identify music or claim live FFT analysis.

Bookmarks and last positions are stored locally on the TV for up to 100 tracks and 20 bookmarks per track. Original SoundCloud IDs keep them attached to a set after transferring a fresh queue. **Resume** explicitly seeks the currently loaded stream; it does not persist URLs or restore playback/queues automatically. Playback checkpoints are throttled to 15 seconds, forced on meaningful pause/track changes and skipped when unchanged. Timer state is session-only. A sleep timer pauses audio after the selected duration or at the end of the current track, without powering off the TV; end-of-track sleep cancels when choosing a different track.

## Verified and pending

- The [0.3.0 webOS workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43629047579) passed **31 receiver tests**, actual Node 12 compatibility, the real-MP3 browser regression, package creation and Homebrew publication. The browser checked all five LG layouts with both progress modes, two-controller queue edits, chapters, bookmarks, resume, presets, sleep, Up next, TV focus/Back, late artwork and autonomous queue advancement. No page errors were reported. Studio and Session screenshots were visually inspected.
- In the separate short Gallery / Studio / open-Session samples, the median frame interval was **16.7 ms** (about 60 FPS); p95 was **16.8 / 16.8 / 16.7 ms**. Frames above 33.4 ms were **0 / 1 / 0** across **150 / 147 / 150** samples. Each waveform bitmap was drawn once. These are CI Chromium measurements, not physical LG G3 FPS measurements.
- The public **0.3.0** Homebrew index, release manifest and **216,138-byte** IPK agree. SHA-256: `ef3872372eca977092a101234b60286f5ecb5e9179d041f1db846dc0f6d435ef`.
- The [2.2.0 iPhone workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43629047666) passed the production Kotlin bridge contract, Swift typecheck, **11 native simulator tests** and the complete device build. The unsigned **2.2.0, build 23** IPA is arm64, passed ZIP/CRC checks and was prepared for delivery. Its SHA-256 is `e7b9c22cf49611664cbfc9d21a1843558837e2f8f8783e2fd6d39d63376bd264`. The previous 2.1.0 IPA was also delivered.
- The user confirmed basic playback and Gallery artwork on the LG G3/webOS 23. The new Studio/session controls and physical G3/iPhone performance still require a hardware test. The existing OLED screensaver policy remains in force.
- Automatic mDNS discovery, server-assisted live visuals and Music Assistant/Sendspin integration remain future work.

The [AirPlay research and hardware checklist](AIRPLAY.md) records platform limits. LiveContainer has an [open iOS 27 external-display report](https://github.com/LiveContainer/LiveContainer/issues/1694); a directly signed installation is the reference setup for testing the iPhone's Screen Mirroring mode.

## License

GPL-3.0, as upstream. Vendored webOS and QR assets retain their original notices. This is an independent fork, not an official Resona release.
