import XCTest
import SwiftUI
import AVFoundation
@testable import Resona

@MainActor
final class TVDisplayTests: XCTestCase {
    func testLGArtworkFitsTheReceiverEvenForDetailedRetinaImages() throws {
        var state: UInt32 = 42
        var pixels = [UInt8](repeating: 255, count: 1024 * 1024 * 4)
        for index in pixels.indices where index % 4 != 3 {
            state = 1664525 &* state &+ 1013904223
            pixels[index] = UInt8(truncatingIfNeeded: state >> 24)
        }
        let provider = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        let cg = try XCTUnwrap(CGImage(width: 1024, height: 1024, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 4096,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                      provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent))
        let encoded = try XCTUnwrap(LGArtwork.dataURL(UIImage(cgImage: cg, scale: 3, orientation: .up)))
        XCTAssertTrue(encoded.hasPrefix("data:image/jpeg;base64,")); XCTAssertLessThan(encoded.count, 220000)
        let data = try XCTUnwrap(Data(base64Encoded: String(encoded.dropFirst("data:image/jpeg;base64,".count))))
        XCTAssertLessThanOrEqual(data.count, 150000)
        let decoded = try XCTUnwrap(UIImage(data: data)?.cgImage)
        XCTAssertLessThanOrEqual(decoded.width, 500); XCTAssertLessThanOrEqual(decoded.height, 500)
        XCTAssertNil(LGArtwork.dataURL(UIImage()))
    }

    func testLGTransfersTheRealQueueAndSendsLateArtworkWithoutReloading() async throws {
        let transport = LGTestTransport()
        LGTestURLProtocol.transport = transport
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LGTestURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); LGTestURLProtocol.transport = nil }
        let queue = """
        {"sourceId":"42","index":1,"skipped":0,"truncated":false,"tracks":[
          {"id":"slot-1","url":"https://example.org/one.mp3","title":"Previous","artist":"A","artworkUrl":"https://example.org/one.jpg","duration":120},
          {"id":"slot-2","url":"https://example.org/two.mp3","title":"Current","artist":"B","artworkUrl":"https://example.org/two.jpg","duration":240},
          {"id":"slot-3","url":"https://example.org/three.mp3","title":"Next","artist":"C","artworkUrl":"https://example.org/three.jpg","duration":180}]}
        """
        let observer = NotificationCenter.default.addObserver(forName: Notification.Name("ResonaTVQueueRequest"), object: nil, queue: .main) { note in
            XCTAssertEqual(note.userInfo?["sourceId"] as? String, "42")
            NotificationCenter.default.post(name: Notification.Name("ResonaTVQueueReply"), object: nil,
                userInfo: ["requestId": note.userInfo!["requestId"]!, "json": queue])
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        let client = LGConnectClient(session: session)
        client.address = "192.168.254.254"; client.code = "123456"
        await client.pair(); XCTAssertTrue(client.paired)
        let model = TVPlaybackModel.shared
        let player = AVPlayer(playerItem: AVPlayerItem(url: URL(string: "https://example.org/two.mp3")!))
        snapshot(player, title: "Current", artist: "B", cover: nil, artworkURL: "https://example.org/two.jpg")
        await client.sendCurrentTrack(model)
        let load = try XCTUnwrap(transport.recorded.first { $0["type"] as? String == "load" })
        let tracks = try XCTUnwrap(load["tracks"] as? [[String: Any]])
        XCTAssertEqual(tracks.count, 3); XCTAssertEqual(load["index"] as? Int, 1)
        XCTAssertEqual(tracks[1]["artworkUrl"] as? String, "https://example.org/two.jpg")
        let cover = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
            UIColor.magenta.setFill(); context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        snapshot(player, title: "Current", artist: "B", cover: cover)
        for _ in 0..<100 {
            if transport.recorded.contains(where: { $0["type"] as? String == "artwork" }) { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let artwork = try XCTUnwrap(transport.recorded.first { $0["type"] as? String == "artwork" })
        XCTAssertEqual(artwork["trackId"] as? String, "slot-2")
        XCTAssertEqual(artwork["generation"] as? Int, 17)
        XCTAssertTrue((artwork["artworkUrl"] as? String ?? "").hasPrefix("data:image/jpeg;base64,"))
        XCTAssertEqual(transport.recorded.filter { $0["type"] as? String == "load" }.count, 1)
        await client.command("next")
        XCTAssertEqual(client.snapshot?.track?.id, "slot-3")
        await client.command("previous")
        XCTAssertEqual(client.snapshot?.track?.id, "slot-2")
        let artworkCount = transport.recorded.filter { $0["type"] as? String == "artwork" }.count
        player.replaceCurrentItem(with: AVPlayerItem(url: URL(string: "https://example.org/different.mp3")!))
        snapshot(player, title: "Another track", artist: "Different", cover: cover, id: "99")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(transport.recorded.filter { $0["type"] as? String == "artwork" }.count, artworkCount)
        await client.disconnect()
    }
    func testLGAddressesStayInsideThePrivateHomeNetwork() throws {
        XCTAssertEqual(try LGConnectClient.receiverURL("192.168.1.50").absoluteString, "http://192.168.1.50:42700")
        XCTAssertEqual(try LGConnectClient.receiverURL("http://10.0.0.20:42700/remote").host, "10.0.0.20")
        XCTAssertEqual(try LGConnectClient.receiverURL("172.16.2.9").host, "172.16.2.9")
        for address in ["https://example.com", "8.8.8.8", "127.0.0.1", "169.254.1.2", "172.15.1.2", "192.168.1.999", "192.168.01.2", "http://user:pass@192.168.1.2", "http://192.168.1.2/api/command", "http://192.168.1.2?token=secret", "http://192.168.1.2:99999"] {
            XCTAssertThrowsError(try LGConnectClient.receiverURL(address), address)
        }
    }

    func testLGPlaybackSnapshotDecodesTheReceiverProtocol() throws {
        let data = Data("""
        {"generation":3,"receiverOnline":true,"state":"playing","track":{"id":"test","title":"Track","artist":"Artist"},"position":15,"duration":120,"error":"","preferences":{"layout":"cinema","dim":0.48,"progress":true}}
        """.utf8)
        let state = try JSONDecoder().decode(LGPlaybackSnapshot.self, from: data)
        XCTAssertTrue(state.receiverOnline)
        XCTAssertEqual(state.track?.title, "Track")
        XCTAssertEqual(state.position, 15)
        XCTAssertEqual(state.preferences.layout, "cinema")
    }

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
        model.outputMode = .lg
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

    private func snapshot(_ player: AVPlayer, title: String, artist: String, cover: UIImage?, id: String = "42", artworkURL: String = "") {
        var data: [String: Any] = ["player": player, "title": title, "artist": artist, "hasTrack": true, "duration": 240, "trackId": id, "artworkUrl": artworkURL]
        if let cover { data["artwork"] = cover }
        NotificationCenter.default.post(name: Notification.Name("ResonaPlaybackSnapshot"), object: nil, userInfo: data)
    }
}

private final class LGTestTransport {
    private let lock = NSLock()
    private var commands: [[String: Any]] = []
    private var tracks: [[String: Any]] = []
    private var index = 0
    private var generation = 17
    var recorded: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return commands }
    func reply(_ request: URLRequest) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        var reply: [String: Any]
        switch request.url!.path {
        case "/api/pair": reply = ["token": String(repeating: "a", count: 64), "protocol": 1]
        case "/api/command":
            var body = request.httpBody
            if body == nil, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }; var data = Data(), bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: 4096); if count <= 0 { break }; data.append(contentsOf: bytes.prefix(count)) }
                body = data
            }
            let command = try JSONSerialization.jsonObject(with: body!) as! [String: Any]
            commands.append(command)
            switch command["type"] as? String {
            case "load": tracks = command["tracks"] as! [[String: Any]]; index = command["index"] as? Int ?? 0
            case "next": index = min(tracks.count - 1, index + 1); generation += 1
            case "previous": index = max(0, index - 1); generation += 1
            default: break
            }
            reply = ["accepted": true, "generation": generation]
        case "/api/session": reply = ["accepted": true]
        default:
            let track: Any = tracks.isEmpty ? NSNull() : tracks[index] as Any
            reply = ["generation": generation, "receiverOnline": true, "state": "playing", "track": track,
                     "position": 0, "duration": 240, "error": "", "preferences": ["layout": "cinema", "dim": 0.48, "progress": true],
                     "index": index, "queue": tracks]
        }
        return try JSONSerialization.data(withJSONObject: reply)
    }
}

private final class LGTestURLProtocol: URLProtocol {
    static var transport: LGTestTransport?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let data = try Self.transport!.reply(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
