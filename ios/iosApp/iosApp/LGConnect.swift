import SwiftUI
import AVFoundation
import Security
import Combine

@MainActor
enum LGArtwork {
    static func dataURL(_ image: UIImage) -> String? {
        guard image.size.width.isFinite, image.size.height.isFinite,
              image.size.width > 0, image.size.height > 0 else { return nil }
        // Renderer defaults follow the phone's screen scale. A 500-point image on a
        // 3x iPhone was 1500px and could silently exceed the receiver's size limit.
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        for side in [500.0, 400.0, 320.0, 240.0] {
            let size = CGSize(width: side, height: side)
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.black.setFill(); context.fill(CGRect(origin: .zero, size: size))
                let scale = min(size.width / image.size.width, size.height / image.size.height)
                let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2,
                                      width: drawn.width, height: drawn.height))
            }
            for quality in [0.8, 0.6, 0.4] {
                if let jpeg = rendered.jpegData(compressionQuality: quality), jpeg.count <= 150_000 {
                    return "data:image/jpeg;base64," + jpeg.base64EncodedString()
                }
            }
        }
        return nil
    }
}

struct LGPreparedQueue: Decodable {
    struct Track: Decodable {
        let id: String; let url: String; let title: String; let artist: String
        let artworkUrl: String?; let duration: Double
        var payload: [String: Any] {
            ["id": id, "url": url, "title": title, "artist": artist,
             "artworkUrl": artworkUrl ?? "", "duration": TVPlaybackModel.validTime(duration)]
        }
    }
    let sourceId: String
    let tracks: [Track]
    let index: Int
    let skipped: Int
    let truncated: Bool
}

// Foundation notifications keep the native test host independent of Compose.
// Kotlin resolves the real queue with the signed-in account, without starting a
// second player or exporting API credentials to the television.
@MainActor
private final class LGQueueRequest {
    private var continuation: CheckedContinuation<LGPreparedQueue, Error>?
    private var observer: NSObjectProtocol?
    private var timeout: Task<Void, Never>?
    private let id = UUID().uuidString
    init(_ continuation: CheckedContinuation<LGPreparedQueue, Error>) { self.continuation = continuation }
    static func prepare(sourceID: String, streamURL: String) async throws -> LGPreparedQueue {
        try await withCheckedThrowingContinuation { continuation in
            LGQueueRequest(continuation).start(sourceID: sourceID, streamURL: streamURL)
        }
    }
    private func start(sourceID: String, streamURL: String) {
        observer = NotificationCenter.default.addObserver(forName: Notification.Name("ResonaTVQueueReply"), object: nil, queue: .main) { [self] note in
            let requestID = note.userInfo?["requestId"] as? String
            let error = note.userInfo?["error"] as? String
            let json = note.userInfo?["json"] as? String
            Task { @MainActor in
                guard requestID == id else { return }
                if let error { finish(.failure(LGConnectError.message(error))); return }
                do {
                    guard let json else { throw LGConnectError.message("The queue could not be prepared.") }
                    finish(.success(try JSONDecoder().decode(LGPreparedQueue.self, from: Data(json.utf8))))
                } catch { finish(.failure(error)) }
            }
        }
        timeout = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
            self?.finish(.failure(LGConnectError.message("Preparing the queue took too long. Keep Resona open and try again.")))
        }
        NotificationCenter.default.post(name: Notification.Name("ResonaTVQueueRequest"), object: nil,
                                        userInfo: ["requestId": id, "sourceId": sourceID, "streamUrl": streamURL])
    }
    private func finish(_ result: Result<LGPreparedQueue, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }; observer = nil
        timeout?.cancel(); timeout = nil
        continuation.resume(with: result)
    }
}

struct LGPlaybackSnapshot: Decodable {
    struct Track: Decodable { let id: String; let title: String; let artist: String }
    struct Preferences: Decodable { let layout: String; let dim: Double; let progress: Bool }
    let generation: Int
    let receiverOnline: Bool
    let state: String
    let track: Track?
    let position: Double
    let duration: Double
    let error: String
    let preferences: Preferences
    let index: Int?
    let queue: [Track]?
}

enum LGConnectError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

@MainActor
final class LGConnectClient: ObservableObject {
    static let shared = LGConnectClient()
    @Published var address = UserDefaults.standard.string(forKey: "tv.lgAddress") ?? ""
    @Published var code = ""
    @Published private(set) var paired = false
    @Published private(set) var busy = false
    @Published private(set) var message = "Open Resona TV on your LG, then enter its address and pairing code."
    @Published private(set) var snapshot: LGPlaybackSnapshot?
    private let session: URLSession
    private var baseURL: URL?
    private var token = ""
    private var timer: Timer?
    private var refreshing = false
    private var isCasting = false
    private weak var castPlayer: AVPlayer?
    private weak var castItem: AVPlayerItem?
    private var rateObservation: NSKeyValueObservation?
    private var artworkObservation: AnyCancellable?
    private var artworkTask: Task<Void, Never>?
    private var artworkRevision = 0
    private var sentArtwork: UIImage?
    private let prepareQueue: (String, String) async throws -> LGPreparedQueue

    init(session: URLSession = .shared, prepareQueue: ((String, String) async throws -> LGPreparedQueue)? = nil) {
        self.session = session
        self.prepareQueue = prepareQueue ?? { try await LGQueueRequest.prepare(sourceID: $0, streamURL: $1) }
    }
    deinit { timer?.invalidate() }

    static func receiverURL(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: value.contains("://") ? value : "http://" + value),
              components.scheme == "http", components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              ["", "/", "/remote"].contains(components.path), let host = components.host else {
            throw LGConnectError.message("Enter the TV's local IPv4 address, such as 192.168.1.50.")
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        let numbers = parts.compactMap { Int($0) }
        guard parts.count == 4, numbers.count == 4, numbers.allSatisfy({ (0...255).contains($0) }),
              zip(parts, numbers).allSatisfy({ String($0.1) == String($0.0) }),
              numbers[0] == 10 || (numbers[0] == 192 && numbers[1] == 168) || (numbers[0] == 172 && (16...31).contains(numbers[1])) else {
            throw LGConnectError.message("Use a private home-network IPv4 address for your LG TV.")
        }
        let port = components.port ?? 42700
        guard (1...65535).contains(port), let url = URL(string: "http://\(host):\(port)") else {
            throw LGConnectError.message("The TV address contains an invalid port.")
        }
        return url
    }

    func start() {
        guard timer == nil else { return }
        if let url = try? Self.receiverURL(address) {
            baseURL = url; token = storedToken(url)
            paired = !token.isEmpty
        }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    private func request<T: Decodable>(_ route: String, body: [String: Any]? = nil, method: String? = nil, authenticated: Bool = true) async throws -> T {
        guard let baseURL, let url = URL(string: route, relativeTo: baseURL) else { throw LGConnectError.message("Enter the TV address first.") }
        var request = URLRequest(url: url, timeoutInterval: 6)
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw LGConnectError.message("The TV did not return a valid response.") }
        guard (200...299).contains(response.statusCode) else {
            if authenticated && response.statusCode == 401 { paired = false; token = ""; removeToken(baseURL) }
            let failure = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw LGConnectError.message(failure?["error"] as? String ?? "The TV could not complete the request.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private struct PairReply: Decodable { let token: String; let `protocol`: Int }
    private struct CommandReply: Decodable { let accepted: Bool; let generation: Int }
    private struct AcceptedReply: Decodable { let accepted: Bool }

    func pair() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            baseURL = try Self.receiverURL(address)
            let pin = code.replacingOccurrences(of: " ", with: "")
            guard pin.count == 6, pin.allSatisfy({ "0123456789".contains($0) }) else { throw LGConnectError.message("Enter the six-digit code shown on your TV.") }
            let reply: PairReply = try await request("/api/pair", body: ["code": pin, "name": "Resona iPhone"], authenticated: false)
            guard reply.`protocol` == 1, reply.token.count == 64 else { throw LGConnectError.message("The TV receiver uses an unsupported protocol.") }
            token = reply.token; paired = true; code = ""
            UserDefaults.standard.set(address, forKey: "tv.lgAddress")
            if let baseURL { storeToken(token, baseURL) }
            message = "Connected to your LG TV."
            let remote: LGPlaybackSnapshot = try await request("/api/state"); snapshot = remote
        } catch { message = error.localizedDescription }
    }

    func refresh() async {
        guard paired, !busy, !refreshing else { return }; refreshing = true; defer { refreshing = false }
        let expectedToken = token
        do {
            let remote: LGPlaybackSnapshot = try await request("/api/state")
            guard expectedToken == token else { return }
            snapshot = remote
            if isCasting, let player = castPlayer, player.rate > 0 {
                isCasting = false
                let _: CommandReply = try await request("/api/command", body: ["type": "pause"])
                message = "Playback returned to your iPhone."
            } else if !remote.receiverOnline { message = "Open Resona TV on the television." }
            else if !remote.error.isEmpty { message = remote.error }
        } catch { message = error.localizedDescription }
    }

    func command(_ type: String, position: Double? = nil, layout: String? = nil) async {
        guard paired, !busy else { return }
        do {
            var body: [String: Any] = ["type": type]
            if let position { body["position"] = max(0, position.isFinite ? position : 0) }
            if let layout { body["preferences"] = ["layout": layout] }
            let _: CommandReply = try await request("/api/command", body: body)
            await refresh()
        } catch { message = error.localizedDescription }
    }

    private func waitFor(_ generation: Int, playing: Bool) async throws {
        for _ in 0..<35 {
            let remote: LGPlaybackSnapshot = try await request("/api/state")
            snapshot = remote
            guard remote.generation == generation else { throw LGConnectError.message("The selected TV track changed. Send the track again.") }
            if remote.state == "error" { throw LGConnectError.message(remote.error.isEmpty ? "The TV cannot play this stream." : remote.error) }
            if playing ? remote.state == "playing" : ["ready", "paused", "playing"].contains(remote.state) { return }
            try await Task.sleep(nanoseconds: 400_000_000)
        }
        throw LGConnectError.message("The TV is not ready. If prompted, press OK on the TV remote and try again.")
    }

    func sendCurrentTrack(_ model: TVPlaybackModel) async {
        guard paired, !busy else { return }
        guard model.hasTrack, let player = model.player, let item = player.currentItem,
              let asset = item.asset as? AVURLAsset, let scheme = asset.url.scheme,
              ["https", "http"].contains(scheme) else {
            message = "Choose an online track. Files stored only on the iPhone cannot be sent directly to the TV."; return
        }
        busy = true; message = "Preparing your queue for LG. Keep Resona open…"
        var pausedHere = false, wasPlaying = false
        defer { busy = false }
        do {
            let sourceID = model.trackID
            let queue = try await prepareQueue(sourceID, asset.url.absoluteString)
            guard player.currentItem === item, model.trackID == sourceID,
                  queue.sourceId == sourceID, !queue.tracks.isEmpty, queue.tracks.count <= 100,
                  queue.tracks.indices.contains(queue.index) else {
                throw LGConnectError.message("The iPhone queue changed. Send it again.")
            }
            var tracks = queue.tracks.map(\.payload)
            let trackID = queue.tracks[queue.index].id
            let art = model.artwork
            let encoded = art.flatMap(LGArtwork.dataURL)
            if let encoded { tracks[queue.index]["artworkUrl"] = encoded }
            else if !model.artworkURL.isEmpty { tracks[queue.index]["artworkUrl"] = model.artworkURL }
            message = "Preparing \(tracks.count) track(s) on your LG…"
            let loaded: CommandReply = try await request("/api/command", body: ["type": "load", "tracks": tracks, "index": queue.index, "autoplay": false])
            try await waitFor(loaded.generation, playing: false)
            guard player.currentItem === item else { throw LGConnectError.message("The iPhone track changed. Send the new track again.") }
            wasPlaying = player.rate > 0
            let position = TVPlaybackModel.validTime(player.currentTime().seconds)
            player.pause(); pausedHere = true
            let _: CommandReply = try await request("/api/command", body: ["type": "seek", "position": position])
            let _: CommandReply = try await request("/api/command", body: ["type": "play"])
            try await waitFor(loaded.generation, playing: true)
            guard player.currentItem === item && player.rate == 0 else { throw LGConnectError.message("Playback changed on your iPhone. Send the track again.") }
            castPlayer = player; castItem = item; isCasting = true
            artworkObservation?.cancel(); artworkTask?.cancel(); artworkRevision = 0
            sentArtwork = encoded == nil ? nil : art
            artworkObservation = model.$artwork.sink { [weak self, weak model, weak item] image in
                guard let self, let model, let item, self.isCasting,
                      self.castItem === item, self.castPlayer?.currentItem === item,
                      model.player?.currentItem === item else { return }
                self.updateArtwork(image, generation: loaded.generation, trackID: trackID)
            }
            rateObservation = player.observe(\.rate, options: [.new]) { [weak self] player, _ in
                guard player.rate > 0 else { return }
                Task { @MainActor in await self?.refresh() }
            }
            message = "Playing on your LG. \(tracks.count) track(s) in the TV queue."
            if queue.skipped > 0 { message += " \(queue.skipped) unavailable track(s) skipped." }
            if queue.truncated { message += " The TV queue contains up to 100 tracks around the selected track." }
        } catch {
            if pausedHere {
                let _: CommandReply? = try? await request("/api/command", body: ["type": "pause"])
                if wasPlaying && player.currentItem === item && player.rate == 0 { player.play() }
            }
            isCasting = false; message = error.localizedDescription
        }
    }

    private func updateArtwork(_ image: UIImage?, generation: Int, trackID: String) {
        // A nil image is usually an in-flight download; keep the HTTP cover until
        // the real image arrives. Explicit cover clearing is handled on load.
        guard let image, image !== sentArtwork, let encoded = LGArtwork.dataURL(image) else { return }
        artworkTask?.cancel(); artworkRevision += 1
        let revision = artworkRevision
        artworkTask = Task { [weak self] in
            guard let self else { return }
            do {
                let _: CommandReply = try await request("/api/command", body: ["type": "artwork", "generation": generation,
                    "trackId": trackID, "artworkRevision": revision, "artworkUrl": encoded])
                if !Task.isCancelled { sentArtwork = image }
            } catch { /* The remote URL remains available; audio must keep playing. */ }
        }
    }

    func disconnect() async {
        guard !busy else { return }
        let _: AcceptedReply? = try? await request("/api/session", method: "DELETE")
        if let baseURL { removeToken(baseURL) }
        token = ""; paired = false; snapshot = nil; isCasting = false; rateObservation = nil
        artworkObservation?.cancel(); artworkObservation = nil; artworkTask?.cancel(); artworkTask = nil; sentArtwork = nil
        message = "Disconnected. Music already playing on the TV continues there."
    }
    private func keychainQuery(_ url: URL) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.themaxynator.resona.lgconnect", kSecAttrAccount as String: url.absoluteString]
    }
    private func storedToken(_ url: URL) -> String {
        var query = keychainQuery(url); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    private func storeToken(_ token: String, _ url: URL) {
        removeToken(url); var query = keychainQuery(url)
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }
    private func removeToken(_ url: URL) { SecItemDelete(keychainQuery(url) as CFDictionary) }
}

@MainActor
struct LGConnectSettings: View {
    @ObservedObject var model: TVPlaybackModel
    @StateObject private var client = LGConnectClient.shared
    @State private var position = 0.0
    @State private var seeking = false
    var body: some View {
        Section("LG TV Connect") {
            TextField("TV address, e.g. 192.168.1.50", text: $client.address)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.numbersAndPunctuation)
                .disabled(client.paired || client.busy)
            if !client.paired {
                TextField("Six-digit TV pairing code", text: $client.code).keyboardType(.numberPad)
                Button("Connect to LG") { Task { await client.pair() } }.disabled(client.busy)
            } else {
                if let track = client.snapshot?.track { LabeledContent("Playing on LG", value: track.title) }
                Button("Send queue to LG") { Task { await client.sendCurrentTrack(model) } }
                    .disabled(client.busy || !model.hasTrack)
                HStack {
                    Button("Previous") { Task { await client.command("previous") } }
                    Spacer()
                    Button(client.snapshot?.state == "playing" ? "Pause" : "Play") {
                        Task { await client.command(client.snapshot?.state == "playing" ? "pause" : "play") }
                    }
                    Spacer()
                    Button("Next") { Task { await client.command("next") } }
                        .disabled((client.snapshot?.index ?? 0) + 1 >= (client.snapshot?.queue?.count ?? 0))
                }.buttonStyle(.borderless).disabled(client.busy || client.snapshot?.track == nil)
                if let remote = client.snapshot, let index = remote.index, let count = remote.queue?.count, count > 0 {
                    LabeledContent("TV queue", value: "\(index + 1) / \(count)")
                }
                if let remote = client.snapshot, remote.duration > 0 {
                    Slider(value: $position, in: 0...max(1, remote.duration), onEditingChanged: { editing in
                        seeking = editing
                        if !editing { Task { await client.command("seek", position: position) } }
                    }).accessibilityLabel("LG playback position")
                    HStack { Text(TVPlaybackModel.timeLabel(position)); Spacer(); Text(TVPlaybackModel.timeLabel(remote.duration)) }
                        .font(.footnote).foregroundColor(.secondary).monospacedDigit()
                    Picker("LG layout", selection: Binding(get: { remote.preferences.layout }, set: { layout in
                        Task { await client.command("preferences", layout: layout) }
                    })) { ForEach(TVLayout.allCases) { Text($0.title).tag($0.rawValue) } }
                }
                Button("Disconnect iPhone") { Task { await client.disconnect() } }.disabled(client.busy)
            }
            if client.busy { ProgressView() }
            Text(client.message).font(.footnote).foregroundColor(.secondary)
            Text("Sends a snapshot of your Resona queue, up to 100 online tracks. Next, Previous and automatic advancement work on the TV. Send again after changing the iPhone queue. Keep Resona open while preparing it.")
                .font(.footnote).foregroundColor(.secondary)
        }
        .onAppear { client.start() }
        .onReceive(client.$snapshot) { remote in if !seeking { position = remote?.position ?? 0 } }
    }
}
