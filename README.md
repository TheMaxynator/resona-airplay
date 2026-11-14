# Resona TV / AirPlay fork

An experimental iOS fork of [savo-o/resona](https://github.com/savo-o/resona), focused on album artwork over AirPlay and a dedicated television Now Playing display. Based on Resona **v2.0**, commit `0adbfd1`. See the [original README](https://github.com/savo-o/resona/blob/v2.0/README.md) for the upstream app and Android features.

## Two output modes

| Mode | What it sends | iPhone usage | TV presentation |
| --- | --- | --- | --- |
| **Audio only** | Music, track information and cover metadata | Background playback and screen locking | Controlled by the AirPlay receiver; artwork visibility varies by TV |
| **TV display** | Music and a separate artwork window through Screen Mirroring | Keep Resona open and the phone unlocked | Four custom layouts with a square cover and faded cover background |

Open the **TV** button in the top-right corner to choose the mode. Selecting a mode does not select a system route: for audio-only playback stop Screen Mirroring, then use the audio AirPlay picker; for the custom display select the TV under Control Center → Screen Mirroring.

## Layouts

- **Cinema:** large cover on the left, track details on the right.
- **Gallery:** centered cover with track details underneath.
- **Ambient:** immersive faded background with a compact cover and title in the lower corner.
- **Night:** dimmed artwork and minimal information.

Background dimming and progress visibility are adjustable and remembered. Artwork changes crossfade, missing covers receive a neutral placeholder, and non-square covers keep their aspect ratio. This fork reuses the existing audio player and does not add a second audio stream.

## Build and testing

The **AirPlay iOS** workflow typechecks the native display and runs iOS Simulator tests for metadata changes, mode transitions, display lifecycle, invalid progress values and four layout renders. These tests use a disposable native host containing the exact production TV source and tests. It then compiles the complete Kotlin/Compose application into an unsigned debug `Resona-TV-2.0.1.ipa` for device testing. Download the IPA from a successful workflow run's artifacts and sign it using your usual sideloading method. Debug configuration keeps the first hardware test build practical; it is not an optimized release build.

The test app has a separate bundle identifier (`com.themaxynator.resona.airplay`) and display name **Resona TV**. It installs alongside upstream and starts with its own app data. Its build number is 18; upstream v2.0 is build 17.

The complete physical-device IPA build succeeded and all four native tests passed with zero failures on an iPhone 16 Pro simulator running iOS 18.5 ([run #2](https://github.com/TheMaxynator/resona-airplay/actions/runs/43535713886), source `83ad80e`). The unsigned debug IPA is 34,177,151 bytes; its bundle ID, version, arm64 device architecture, archive integrity and external-display manifest were checked after download. The four native layout images were also inspected. A simulator build cannot verify a physical LG AirPlay receiver or iOS 27 accessory registration. The [research, limitations and device test checklist](AIRPLAY.md) distinguish implementation from verified hardware behavior. LiveContainer has an [open iOS 27 external-display report](https://github.com/LiveContainer/LiveContainer/issues/1694). This fork has not been physically tested there; a directly sideloaded installation is the reference configuration.

## License

GPL-3.0, as upstream. This is an independent fork, not an official Resona release.
