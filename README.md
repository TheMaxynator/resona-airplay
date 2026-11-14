# Resona TV / AirPlay fork

An experimental iOS and rooted-LG-webOS fork of [savo-o/resona](https://github.com/savo-o/resona), based on Resona **v2.0**, source `0adbfd1`. See the [original README](https://github.com/savo-o/resona/blob/v2.0/README.md) for upstream features.

## Three television modes

| Mode | Playback and picture | Phone usage |
| --- | --- | --- |
| **Audio only** | Ordinary audio AirPlay; the receiver decides how to display artwork | Background audio and phone locking |
| **TV display** | Sharp square cover over a blurred/dimmed cover background through Screen Mirroring | Keep Resona open and the phone unlocked |
| **LG app** | The separate Resona TV webOS app fetches the stream and renders its own interface | The phone can disconnect after transfer; TV playback is independent |

The four designs are **Cinema**, **Gallery**, **Ambient** and **Night**. Open the iPhone app's **TV** button to choose an output mode. LG app mode uses the local receiver rather than Apple's AirPlay picker.

## Install the LG app using Homebrew Channel

Add this repository under **Settings → Add repository**:

```text
https://raw.githubusercontent.com/TheMaxynator/resona-airplay/main/repo.json
```

It publishes the current app version, icon, GitHub release download and exact SHA-256 checksum. TV releases are published only after protocol tests, a Node 12 compatibility check and a real-MP3 browser test pass. Refresh Homebrew Channel to discover subsequent versions. Existing IPKs are immutable; a new app version requires incrementing `webos/app/appinfo.json` and keeping the receiver version constant in sync. The catalog is updated from the actual published bytes.

The **0.1.0** LG package is an early hardware-test candidate for a rooted webOS 23 TV with Homebrew Channel working as root. Open **Resona TV** on the television, scan its QR code or open the displayed address on your phone, then enter the six-digit code. The phone remote includes a bundled quiet test tone and controls for playback, position, layout and dimming. Installation and hardware checks are detailed in [webos/README.md](webos/README.md).

## Companion iPhone build

The **2.0.2, build 19** iPhone candidate adds **LG app → LG TV Connect**. Install its unsigned IPA with your usual signing method, enter the TV's private IPv4 address and pairing code, and select **Send current track to LG**. Stop AirPlay/Screen Mirroring for this mode. The TV prepares the stream before the iPhone pauses; failed transfers can restore the original local track. Starting local playback while connected pauses the receiver. Pairing credentials are kept in Keychain; local HTTP exceptions are limited to private LAN ranges.

This first native handoff transfers **one currently loaded online track**, not Resona's entire queue. Offline/cache-only files cannot be fetched directly from the phone, and the receiver does not renew expiring SoundCloud links. The Safari remote can import a resolved queue of up to 100 tracks which advances on the TV independently. Use LG TV Connect, the TV remote or Safari for receiver controls.

The iPhone bundle ID remains `com.themaxynator.resona.airplay`, so this updates the earlier Resona TV test app. It installs alongside upstream Resona and uses separate app data from upstream.

## Verified and pending

- The complete iPhone device build, native typechecking and **six** native simulator tests passed in [the LG Connect build](https://github.com/TheMaxynator/resona-airplay/actions/runs/43584820502).
- The LG receiver's **nine** protocol/security/lifecycle tests, Node 12 compatibility and browser playback tests passed in [the release workflow](https://github.com/TheMaxynator/resona-airplay/actions/runs/43585668393).
- Browser checks cover real MP3 decoding, PIN pairing, pause/seek, all four layouts, widths 320/390/768, safe text rendering and queue advancement after the phone closes. Layout images were visually inspected.
- The IPA archive, version, arm64 executable, external scene declaration and local-network settings were checked after download. The public Homebrew JSON, release manifest and package checksum are verified separately.
- A physical LG/iOS 27 test is still required. LG's gallery screensaver policy can dim and take over the image after 30 minutes; indefinite artwork display is not promised. The first real device test must check bootstrap, SoundCloud/HLS compatibility, phone locking and remote keys.

The [AirPlay research and hardware checklist](AIRPLAY.md) records platform limits. LiveContainer has an [open iOS 27 external-display report](https://github.com/LiveContainer/LiveContainer/issues/1694); a directly signed installation is the reference setup for testing the iPhone's Screen Mirroring mode.

## License

GPL-3.0, as upstream. Vendored webOS and QR assets retain their original notices. This is an independent fork, not an official Resona release.
