import XCTest
import SwiftUI
import AVFoundation
@testable import Resona

@MainActor
final class TVDisplayTests: XCTestCase {
    func testInvalidPlaybackTimesNeverBecomeInvalidProgress() {
        for invalid in [Double.nan, Double.infinity, -Double.infinity, -1] {
            XCTAssertEqual(TVPlaybackModel.validTime(invalid), 0)
            XCTAssertEqual(TVPlaybackModel.timeLabel(invalid), "0:00")
        }
        XCTAssertEqual(TVPlaybackModel.timeLabel(3661), "1:01:01")
        XCTAssertEqual(TVPlaybackModel.timeLabel(91), "1:31")
    }

    func testArtworkAndArtistMetadataFollowTheCurrentItem() throws {
        let model = TVPlaybackModel.shared
        let player = AVPlayer(playerItem: AVPlayerItem(url: URL(fileURLWithPath: "/nonexistent-test-audio.mp3")))
        let cover = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        snapshot(player, title: "Same title", artist: "Artist A", cover: cover)
        XCTAssertTrue(model.artwork === cover)
        XCTAssertTrue(player.currentItem!.externalMetadata.contains { $0.identifier == .commonIdentifierArtwork })
        snapshot(player, title: "Same title", artist: "Artist B", cover: cover)
        XCTAssertEqual(player.currentItem!.externalMetadata.first { $0.identifier == .commonIdentifierArtist }?.stringValue, "Artist B")
        snapshot(player, title: "Without cover", artist: "Artist B", cover: nil)
        XCTAssertNil(model.artwork)
        XCTAssertFalse(player.currentItem!.externalMetadata.contains { $0.identifier == .commonIdentifierArtwork })
        XCTAssertEqual(model.duration, 240)
        NotificationCenter.default.post(name: Notification.Name("ResonaPlaybackSnapshot"), object: nil,
                                        userInfo: ["player": player, "hasTrack": false])
        XCTAssertFalse(model.hasTrack)
        XCTAssertEqual(model.position, 0)
        XCTAssertNil(model.artwork)
    }

    func testDisplayLifecycleRestoresPlayerAndIdleTimer() {
        let model = TVPlaybackModel.shared
        let oldMode = model.outputMode
        model.outputMode = .display
        defer { model.outputMode = oldMode }
        let player = AVPlayer()
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        snapshot(player, title: "Lifecycle", artist: "Test", cover: nil)
        let idleTimer = UIApplication.shared.isIdleTimerDisabled
        model.displayConnected("test-display")
        model.displayConnected("test-display")
        XCTAssertEqual(model.connectedDisplays, 1)
        XCTAssertFalse(player.usesExternalPlaybackWhileExternalScreenIsActive)
        XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        model.outputMode = .audio
        XCTAssertTrue(player.usesExternalPlaybackWhileExternalScreenIsActive)
        XCTAssertEqual(UIApplication.shared.isIdleTimerDisabled, idleTimer)
        model.outputMode = .display
        XCTAssertFalse(player.usesExternalPlaybackWhileExternalScreenIsActive)
        model.displayDisconnected("test-display")
        XCTAssertEqual(model.connectedDisplays, 0)
        XCTAssertTrue(player.usesExternalPlaybackWhileExternalScreenIsActive)
        XCTAssertEqual(UIApplication.shared.isIdleTimerDisabled, idleTimer)
    }

    func testAllFourLayoutsRenderAtTVAspectRatio() throws {
        let model = TVPlaybackModel.shared
        model.loadPreview()
        defer { UserDefaults.standard.removeObject(forKey: "tv.layout") }
        for layout in TVLayout.allCases {
            UserDefaults.standard.set(layout.rawValue, forKey: "tv.layout")
            let renderer = ImageRenderer(content: TVNowPlayingView(model: model).frame(width: 1280, height: 720))
            let image = try XCTUnwrap(renderer.uiImage)
            XCTAssertEqual(image.size, CGSize(width: 1280, height: 720))
            XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 20000)
            let attachment = XCTAttachment(image: image)
            attachment.name = "TV-\(layout.rawValue)"
            attachment.lifetime = .keepAlways
            add(attachment)
            if let folder = ProcessInfo.processInfo.environment["TV_SCREENSHOT_DIR"] {
                let destination = URL(fileURLWithPath: folder, isDirectory: true)
                try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                try image.pngData()?.write(to: destination.appendingPathComponent("\(layout.rawValue).png"))
            }
        }
    }

    private func snapshot(_ player: AVPlayer, title: String, artist: String, cover: UIImage?) {
        var data: [String: Any] = ["player": player, "title": title, "artist": artist, "hasTrack": true, "duration": 240]
        if let cover { data["artwork"] = cover }
        NotificationCenter.default.post(name: Notification.Name("ResonaPlaybackSnapshot"), object: nil, userInfo: data)
    }
}
