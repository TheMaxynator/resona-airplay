# AirPlay artwork: research and device testing

Research date: 14 November 2026. Source baseline: savo-o/resona tag v2.0, `0adbfd121e049c9cf9fbed08d3a32f51d73edf4d`.

## What the original player does

The original Kotlin/Native `IosAudioPlayer` already supplies title, artist, playback time and an asynchronously fetched `MPMediaItemArtwork` to `MPNowPlayingInfoCenter`. It does not supply `AVPlayerItem.externalMetadata`, an external display scene or its own television layout. Its artwork loader does not handle absolute offline artwork paths and usually receives SoundCloud's small `-large` artwork URL.

The reported black LG screen is consistent with an audio receiver's empty video surface and disappearing transport controls, but the exact reason is not confirmed without the LG model/webOS version and a physical test. It would be incorrect to promise that adding metadata forces an LG TV to display a persistent cover.

## What other apps and receivers establish

| Example | Confirmed behavior | Implication for this fork |
| --- | --- | --- |
| Apple / system Now Playing | Apple's APIs publish title and album artwork to AirPlay destinations. Apple TV offers a full-screen Now Playing audio overlay after inactivity. | Publish correct artwork and track metadata; the receiver owns the audio-mode layout. |
| Spotify | Offers both AirPlay listening and a separate native TV app. Its TV app has Now Playing, queue controls and a dimmed dark mode. | Its native TV interface is design inspiration, not proof of a custom iPhone-to-LG AirPlay layout API. |
| SoundCloud | Documents iOS audio casting to TVs and speakers through the audio destination picker. | Keep ordinary audio AirPlay available independently of the custom display. |
| UxPlay | Its receiver can explicitly render Apple Music covers during audio-only AirPlay. | Audio-only AirPlay can carry artwork without a video stream, but displaying it depends on the receiver. |
| Shairport metadata displays | Receive cover, title, artist and progress, then render their own display. | The receiver can build its own layout from metadata; Resona cannot install such a renderer inside LG's stock AirPlay receiver. |

Apple Music, Spotify and Plexamp are proprietary; their current internal AirPlay sender code is not public. This implementation follows Apple's documented platform APIs, not an assertion about their private implementation.

## Implemented paths

1. **Audio only:** the existing AVPlayer supplies system Now Playing information plus player-item metadata. Audio mode disables the custom external display and leaves the standard audio AirPlay route available. A cover and track information are metadata, not a video frame. An iPhone may be locked while ordinary background audio continues. No claim of a persistent custom LG background is made.
2. **TV display:** use Screen Mirroring to expose a noninteractive external display scene. A SwiftUI view draws the sharp cover, blurred/dimmed background and track details. The phone remains the playback controller. Keep the app foregrounded and phone unlocked. The TV remote's transport overlay can hide independently of our artwork window. Physical behavior is still to be verified.
3. **Possible later video mode:** generate an actual artwork video/HLS presentation with audio in the same playback pipeline. This could provide controlled pixels with direct video AirPlay, but would add encoding, local serving, buffering, resource and background-lifecycle work. A silent looping video alongside the existing player is not a reliable synchronized implementation and is not included.

On iOS 27, external display content must be registered through `UISceneAccessory`; the fork registers it from the phone view controller. The documented Objective-C entry points are resolved at runtime so existing Xcode toolchains with pre-iOS-27 SDKs can build the application. iOS 16–26 use the scene-manifest path. The registration is disabled in audio-only mode. This runtime path still requires testing on a real iOS 27 device.

On older iOS releases, stopping the custom view can return to ordinary screen mirroring. Apps cannot silently select an AirPlay receiver or turn the user's Screen Mirroring off; the settings explain the required Control Center step. An open LiveContainer report, [issue #1694](https://github.com/LiveContainer/LiveContainer/issues/1694), describes unavailable external scenes and black AirPlay output on iOS 27. This is a community reproduction, not a confirmed diagnosis on the user's iOS 27.0.1/LG setup. Test the same IPA directly through SideStore before attributing a black screen to Resona.

## Artwork handling

The loader requests SoundCloud's `-t500x500` variant and falls back to the original URL if unavailable. It supports offline file paths, rejects bad HTTP responses, cancels old requests and uses a generation check so late downloads cannot replace a newer track's cover. Stop clears both the cover and Now Playing state. The Swift bridge applies title/artist/artwork to the current player item and updates the independent TV model. It creates no additional audio player.

## Possible next step: an LG webOS receiver app

A separate, installable **Resona TV** webOS app could own both audio playback and the complete television interface. The proposed phone app would send a track, cover, queue and playback commands to the receiver; the TV would fetch a compatible audio stream directly. This is an architectural proposal, not a feature in the current IPA. LG documents HTML/CSS/JavaScript apps and native audio-element playback. It would allow the same four layouts without keeping the phone's screen mirrored.

Connect SDK documents launching TV apps and two-way iOS/web-app messaging. Its hosted web-app registration flow and the capabilities of an installed app need to be checked separately on the target TV; the older documentation is not proof that every current model supports the same flow. A first prototype can be opened manually from the TV launcher. The first hardware milestone should be one real Resona/SoundCloud stream and its artwork playing directly on the TV, followed by pairing and phone control. This would use a dedicated cast action inside the fork, rather than adding a custom destination to Apple's standard AirPlay picker.

Autonomous playback needs more than passing a URL: test codec/HLS compatibility, expiring stream URLs, authentication, queue advancement, reconnection and the TV's screensaver behavior. Phone locking should not stop a directly fetched current track, but uninterrupted queue playback while the phone is suspended needs receiver-owned queue/link renewal and must be verified. For development, LG's Developer Mode installs an app without a store release; its session must be extended before expiry. Record the exact LG model and webOS version before selecting the connection strategy.

Sources: [LG web app platform](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), [LG audio playback](https://webostv.developer.lge.com/develop/guides/multi-sound-playback), [LG Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [Connect SDK iOS app sessions](https://connectsdk.com/en/latest/apis-ios/ios-webappsession.html), [Connect SDK iOS launcher](https://connectsdk.com/en/latest/apis-ios/ios-webapplauncher.html), and [Connect SDK web-app IDs](https://connectsdk.com/en/latest/guide-web/webapp-overview.html).

## Verification checklist

Automated build and simulator results are recorded by the AirPlay iOS workflow. Native code typechecking and all four native simulator tests passed in [run #2](https://github.com/TheMaxynator/resona-airplay/actions/runs/43535713886), source `83ad80e`: iPhone 16 Pro simulator, iOS 18.5, Xcode 16.4. The full Kotlin/Compose device build was still running when these notes were updated. The simulator tests use the exact production TV source in an isolated native host; they do not claim to exercise the Kotlin notification sender or iOS 27 scene registration on physical hardware. No physical LG TV result is recorded yet.

For the hardware test, record the iPhone installation method (direct sideload or LiveContainer), LG model and webOS version. Use the same Wi-Fi network.

| Test | Procedure | Check |
| --- | --- | --- |
| Audio-only metadata | Stop Screen Mirroring; choose Audio only and select LG in the audio picker | Music works; note whether the receiver displays cover/title and whether they remain after 30 seconds |
| Background audio | Lock iPhone for 2 minutes in audio-only mode | Playback and pause/resume controls continue; no forced-awake phone behavior |
| Custom TV display | Unlock/open Resona; select TV display, then LG under Screen Mirroring | Separate 16:9 artwork composition, not a portrait copy of the phone controls |
| Inactivity | Leave remote untouched for 1 minute | Artwork remains when the TV's own transport overlay disappears |
| Controls | Pause, resume, seek, next and previous from iPhone and TV remote | Correct audio and metadata, no second audio stream or echo |
| Fast skips | Skip several tracks while covers load | The newest track keeps its own cover; earlier covers never replace it |
| Missing/offline covers | Play an offline track and one without artwork | Local artwork works; a missing cover shows the placeholder, not the previous album |
| Designs | Select Cinema, Gallery, Ambient and Night; change dimming/progress | TV updates and settings persist after relaunch |
| Disconnect/reconnect | Disconnect TV and reconnect | iPhone controls remain usable, ordinary idle behavior is restored, no orphaned display |
| Lock during custom mode | Manually lock while in TV display mode | Record the actual limitation; sustained custom visuals while locked are not guaranteed |

## Primary sources

- Apple: [Enriching the AirPlay Experience](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/AirPlayGuide/EnrichYourAppforAirPlay/EnrichYourAppforAirPlay.html)
- Apple: [Explore media metadata publishing and playback interactions](https://developer.apple.com/videos/play/wwdc2022/110338/)
- Apple: [Presenting content on a connected display](https://developer.apple.com/documentation/uikit/presenting-content-on-a-connected-display)
- Apple: [iOS 27 external scene accessory factory](https://developer.apple.com/documentation/uikit/uisceneaccessory/externalnoninteractive(sceneconfiguration:))
- Apple: [AirPlay audio and Screen Mirroring](https://support.apple.com/guide/iphone/stream-video-and-audio-from-your-iphone-iphd668e80e6/ios)
- Spotify: [Spotify on TV](https://support.spotify.com/mw/article/spotify-on-tv/)
- Spotify: [Redesigned TV experience and dark mode](https://newsroom.spotify.com/2023-11-09/find-your-favorite-audio-more-easily-with-the-redesigned-spotify-on-tv-experience/)
- SoundCloud: [Cast to devices](https://help.soundcloud.com/hc/en-us/articles/360049227333-Cast-to-devices)
- [UxPlay receiver](https://github.com/FDH2/UxPlay)
- [Shairport metadata display](https://github.com/AlainGourves/shairport-metadata-display)

- LiveContainer: [external display/AirPlay report #1694](https://github.com/LiveContainer/LiveContainer/issues/1694) (user report, not a maintainer-confirmed fix)
