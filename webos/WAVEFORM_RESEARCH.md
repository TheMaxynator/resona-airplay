# Waveforms and rendering performance

Research and direct checks: 2026-11-14. Target: rooted LG OLED55G33LA, webOS 23.

## What the platform allows

LG explicitly states that `createMediaElementSource()` is not supported on webOS TV. Its audio element uses the hardware decoder; LG recommends one audio element for background music. An LG staff reply also confirms that the audio buffer cannot be read from the audio tag. Therefore a normal browser `AnalyserNode` attached to this app's existing player is not a supported live waveform/FFT route on this television. Desktop Chromium support must not be mistaken for webOS hardware support.

- [LG multi-sound and Web Audio guidance](https://webostv.developer.lge.com/develop/guides/multi-sound-playback)
- [LG response about media/audio buffers](https://forum.webostv.developer.lge.com/t/mediaelementaudiosourcenode/2426)

Root may allow a separate native audio/capture implementation, but it does not change the web engine's supported media APIs. No working G3 PCM capture source has been established here. Such a backend would need its own hardware investigation, buffering, synchronization and CPU/power measurements. It is not included or promised in this release.

## Verified SoundCloud metadata

The provided [Eva Vrijdag track](https://soundcloud.com/subcultuur/eva-vrijdag-subcultuur-festival-2025), track ID 2095439361, was checked through its public hydrated track data and oEmbed response. `publisher_metadata.artist` is `Eva Vrijdag`; the uploader is `𝙎𝙐𝘽𝘾𝙐𝙇𝙏𝙐𝙐𝙍`, whose Unicode NFKC form is `SUBCULTUUR`. The existing sender discarded publisher metadata and used the uploader. Its stylized characters also exceeded the TV font's glyph coverage in the user's photograph.

The track's `waveform_url` is `https://wave.sndcdn.com/BD4HLDld5F83_m.json`. A direct GET returned 6,860 bytes, 1,800 amplitude samples, height 140, and `Access-Control-Allow-Origin: *`. This is a verified sample, not a guarantee that every track has accessible waveform data. SoundCloud documents the waveform field in its [track object](https://developers.soundcloud.com/blog/soundclouds-new-api-track-object/). Its [older waveform article](https://developers.soundcloud.com/blog/waveforms-let-s-talk-about-them/) describes an earlier PNG representation; current JSON behavior above was checked directly instead of inferred from that article.

## Shipped approach

The optional **Trackwaveform** is a precomputed track overview synchronized to the HTML audio element's current position. It is not live microphone capture, a live oscilloscope, or a frequency spectrum. The native iPhone sender forwards metadata; playback remains owned by the TV.

- Disabled by default; no waveform request is made until enabled.
- Only HTTPS JSON on `wave.sndcdn.com`, without credentials or redirects.
- Five-second timeout, 128 KiB response limit and bounded finite sample validation. The byte check bounds accepted metadata after download; it is not a streaming network-byte cutoff.
- At most 240 peak-preserving bins, regardless of track duration. Never allocate an audio-duration-sized PCM buffer.
- Two 960×44 canvases, painted on data arrival and reused during playback. A pair of counter-translated clipping layers reveals the played part without changing layout or painting canvas frames.
- Missing data/network/CORS failure falls back to the simple progress line. Audio is never routed through Web Audio and no additional audio element/decoder is started.
- Track changes and app hiding cancel stale requests. Old waveform data cannot overwrite a new track.

This approach is preferable for the requested performance target: it adds small static textures and transforms instead of decoding a second stream or running FFT work. [Chrome's rendering guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/motion) recommends compositor-friendly transforms and opacity; its [clipping article](https://developer.chrome.com/blog/performant-expand-and-collapse/) explains counter-transformed layers.

## Other performance changes and verification

The normal line uses `scaleX`, not animated width. Repeated unchanged text/preferences are not assigned again. Once Gallery's palette is ready, its expensive full-screen blurred backdrop is not rendered. Compact authenticated TV polling omits unchanged inline covers/stream URLs while preserving full resynchronization after a track/cover change. These changes do not introduce extra per-frame JavaScript into production.

Automated checks cover all four layouts with both visibility modes, wide Gallery placement, Unicode normalization, preference persistence, malformed waveform data, no metadata request while disabled, one request/bitmap draw per active track, normal playback/seek/queue controls and a short frame-cadence sample. Test waveform amplitudes are synthetic fixtures; the SoundCloud URL/shape above was independently checked through a real public response.

`performance.json` records Chromium requestAnimationFrame median/p95 intervals and estimated cadence while the test audio plays. It is a CI measurement on the runner, **not a measured LG G3 FPS guarantee**. Confirm smoothness and frame pacing on the actual G3 with always-visible line/waveform, across transitions and long playback. LG's OLED screensaver policies remain in force.
