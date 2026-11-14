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
          {"id":"slot-1","sourceId":"41","url":"https://example.org/one.mp3","title":"Previous","artist":"A","artworkUrl":"https://example.org/one.jpg","duration":120},
          {"id":"slot-2","sourceId":"42","url":"https://example.org/two.mp3","title":"Current","artist":"Eva Vrijdag","artworkUrl":"https://example.org/two.jpg","waveformUrl":"https://wave.sndcdn.com/example.json","chapterText":"00:00 Intro\\n02:00 Main set","duration":240},
          {"id":"slot-3","sourceId":"43","url":"https://example.org/three.mp3","title":"Next","artist":"C","artworkUrl":"https://example.org/three.jpg","duration":180}]}
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
        XCTAssertEqual(tracks[1]["artist"] as? String, "Eva Vrijdag")
        XCTAssertEqual(tracks[1]["waveformUrl"] as? String, "https://wave.sndcdn.com/example.json")
        XCTAssertEqual(tracks[1]["chapterText"] as? String, "00:00 Intro\n02:00 Main set")
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
    func testLGRemoteBridgeKeepsTVIdentityDuringNetworkLossAndRoutesQueueCommands() async throws {
        let transport = LGTestTransport()
        LGTestURLProtocol.transport = transport
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LGTestURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); LGTestURLProtocol.transport = nil; UserDefaults.standard.removeObject(forKey: "tv.lgControlsTV") }
        let client = LGConnectClient(session: session)
        client.address = "192.168.254.253"; client.start(); client.code = "123456"
        await client.pair(); client.useTVInPlayer()
        var received: [String: Any] = [:]
        let observer = NotificationCenter.default.addObserver(forName: Notification.Name("ResonaTVRemoteState"), object: nil, queue: .main) { note in
            if let json = note.userInfo?["json"] as? String, let data = json.data(using: .utf8),
               let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { received = value }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        func send(_ body: [String: Any]) throws {
            let json = String(data: try JSONSerialization.data(withJSONObject: body), encoding: .utf8)!
            NotificationCenter.default.post(name: Notification.Name("ResonaTVRemoteCommand"), object: nil, userInfo: ["json": json])
        }
        try send(["type": "load", "tracks": [
            ["id": "one", "sourceId": "42", "url": "https://example.org/private-stream.mp3", "title": "First", "artist": "Eva Vrijdag", "duration": 120],
            ["id": "two", "sourceId": "43", "url": "https://example.org/next.mp3", "title": "Next", "artist": "Other", "duration": 180]
        ]])
        for _ in 0..<100 { if client.snapshot?.track?.id == "one" { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(client.snapshot?.track?.sourceId, "42")
        XCTAssertEqual(received["active"] as? Bool, true)
        XCTAssertFalse(String(describing: received).contains("private-stream.mp3"))
        try send(["type": "next"])
        for _ in 0..<100 { if client.snapshot?.track?.id == "two" { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(client.snapshot?.track?.title, "Next")
        try send(["type": "queue-remove", "trackId": "one", "queueRevision": client.snapshot?.queueRevision ?? -1])
        for _ in 0..<100 { if transport.recorded.contains(where: { $0["type"] as? String == "queue-remove" }) { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(transport.recorded.contains { $0["type"] as? String == "queue-remove" })
        transport.setOffline(true)
        for _ in 0..<20 { await client.refresh(force: true); if !client.reachable { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertFalse(client.reachable); XCTAssertTrue(client.controlsTV)
        XCTAssertEqual(client.snapshot?.track?.title, "Next")
        XCTAssertEqual(received["active"] as? Bool, true); XCTAssertEqual(received["online"] as? Bool, false)
        transport.setOffline(false)
        await client.refresh(force: true)
        XCTAssertTrue(client.reachable); XCTAssertTrue(client.controlsTV)
        await client.disconnect()
        XCTAssertEqual(received["active"] as? Bool, false)
    }

    func testLGReturnToPhoneWaitsUntilTVPauseSucceeds() async throws {
        let transport = LGTestTransport()
        LGTestURLProtocol.transport = transport
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [LGTestURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); LGTestURLProtocol.transport = nil }
        let client = LGConnectClient(session: session); client.address = "192.168.254.252"; client.code = "123456"
        await client.pair()
        transport.seed(["id":"current", "sourceId":"42", "title":"Current", "artist":"A", "url":"https://example.org/a.mp3"], position: 47)
        await client.refresh(force: true); client.useTVInPlayer()
        var returns = 0, source = "", position = 0.0
        let observer = NotificationCenter.default.addObserver(forName: Notification.Name("ResonaTVReturnLocal"), object: nil, queue: .main) { note in
            returns += 1; source = note.userInfo?["sourceId"] as? String ?? ""; position = note.userInfo?["position"] as? Double ?? 0
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        transport.setOffline(true); await client.returnToPhone()
        XCTAssertEqual(returns, 0); XCTAssertTrue(client.controlsTV)
        transport.setOffline(false); await client.returnToPhone()
        XCTAssertEqual(returns, 1); XCTAssertEqual(source, "42"); XCTAssertEqual(position, 47)
        XCTAssertFalse(client.controlsTV)
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
        XCTAssertNil(state.session)
    }

    func testLGSessionMetadataDecodesWithoutChangingQueueIdentity() throws {
        let data = Data("""
        {"generation":7,"receiverOnline":true,"state":"paused","track":{"id":"slot-2","sourceId":"42","title":"Set","artist":"Eva Vrijdag","chapters":[{"position":0,"title":"Intro"},{"position":120,"title":"Main set"}]},"position":120,"duration":5400,"error":"","preferences":{"layout":"studio","dim":0.55,"progress":true},"capabilities":{"sessionTools":true},"session":{"resumePosition":120,"bookmarks":[{"id":"0123456789abcdef","position":120,"label":"Transition"}],"sleepTimer":{"mode":"minutes","deadline":1800000000000}}}
        """.utf8)
        let state = try JSONDecoder().decode(LGPlaybackSnapshot.self, from: data)
        XCTAssertEqual(state.track?.id, "slot-2"); XCTAssertEqual(state.track?.sourceId, "42")
        XCTAssertEqual(state.track?.chapters?.last?.position, 120)
        XCTAssertEqual(state.session?.bookmarks.first?.label, "Transition")
        XCTAssertEqual(state.session?.resumePosition, 120)
        XCTAssertEqual(state.session?.sleepTimer?.mode, "minutes")
        XCTAssertEqual(state.capabilities?.sessionTools, true)
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
    private var queueRevision = 1
    private var position = 0.0
    private var state = "playing"
    private var offline = false
    func setOffline(_ value: Bool) { lock.lock(); defer { lock.unlock() }; offline = value }
    func seed(_ track: [String: Any], position: Double) { lock.lock(); defer { lock.unlock() }; tracks = [track]; index = 0; self.position = position }
    var recorded: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return commands }
    func reply(_ request: URLRequest) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        if offline { throw URLError(.notConnectedToInternet) }
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
            case "load": tracks = command["tracks"] as! [[String: Any]]; index = command["index"] as? Int ?? 0; queueRevision += 1; state = command["autoplay"] as? Bool == false ? "ready" : "playing"
            case "play": state = "playing"
            case "pause": state = "paused"
            case "seek": position = command["position"] as? Double ?? 0
            case "queue-remove": queueRevision += 1
            case "next": index = min(tracks.count - 1, index + 1); generation += 1
            case "previous": index = max(0, index - 1); generation += 1
            default: break
            }
            reply = ["accepted": true, "generation": generation]
        case "/api/session": reply = ["accepted": true]
        default:
            let track: Any = tracks.isEmpty ? NSNull() : tracks[index] as Any
            reply = ["generation": generation, "receiverOnline": true, "state": state, "track": track,
                     "position": position, "duration": 240, "error": "", "preferences": ["layout": "cinema", "dim": 0.48, "progress": true],
                     "index": index, "queue": tracks, "queueRevision": queueRevision, "capabilities": ["queueEditing": true, "persistentPairing": true]]
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
