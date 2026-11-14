import SwiftUI
import AVFoundation
import AVKit
import Combine
import MediaPlayer
import CoreMedia

enum TVOutputMode: String, CaseIterable, Identifiable {
    case audio, display
    var id: String { rawValue }
    var title: String { self == .audio ? "Audio only" : "TV display" }
}

enum TVLayout: String, CaseIterable, Identifiable {
    case cinema, gallery, ambient, night
    var id: String { rawValue }
    var title: String {
        switch self {
        case .cinema: return "Cinema"
        case .gallery: return "Gallery"
        case .ambient: return "Ambient"
        case .night: return "Night"
        }
    }
    var detail: String {
        switch self {
        case .cinema: return "Large cover beside the track details"
        case .gallery: return "Centered cover with the title underneath"
        case .ambient: return "Immersive background with a compact cover"
        case .night: return "Dimmed artwork for a quiet room"
        }
    }
}

// The Kotlin player is the sole playback owner. This model only publishes its existing state.
final class TVPlaybackModel: ObservableObject {
    static let shared = TVPlaybackModel()
    @Published var outputMode = TVOutputMode(rawValue: UserDefaults.standard.string(forKey: "tv.outputMode") ?? "") ?? .display {
        didSet {
            UserDefaults.standard.set(outputMode.rawValue, forKey: "tv.outputMode")
            configurePlayerForDisplay()
            updateIdleTimer()
            NotificationCenter.default.post(name: Notification.Name("ResonaTVOutputModeChanged"), object: nil)
        }
    }
    @Published private(set) var title = "Resona"
    @Published private(set) var artist = "Choose a track on your iPhone"
    @Published private(set) var artwork: UIImage?
    @Published private(set) var hasTrack = false
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var connectedDisplays = 0
    @Published private(set) var routeName = "iPhone"
    @Published private(set) var accessoryStatus = "Waiting for a display"
    weak var player: AVPlayer?
    private var observer: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private var timer: AnyCancellable?
    private var sceneIDs = Set<String>()
    private var previousIdleTimerState: Bool?
    private var previousExternalPlaybackSetting: Bool?
    private var publishedArtwork: UIImage?
    private var publishedTitle: String?
    private var publishedArtist: String?
    private weak var publishedItem: AVPlayerItem?

    private init() {
        observer = NotificationCenter.default.addObserver(
            forName: Notification.Name("ResonaPlaybackSnapshot"), object: nil, queue: .main
        ) { [weak self] note in self?.receive(note) }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.updateRoute() }
        timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            self?.refreshProgress()
        }
        updateRoute()
    }

    private func receive(_ note: Notification) {
        guard let data = note.userInfo else { return }
        player = data["player"] as? AVPlayer
        hasTrack = (data["hasTrack"] as? NSNumber)?.boolValue ?? false
        title = hasTrack ? (data["title"] as? String ?? "Unknown track") : "Resona"
        artist = hasTrack ? (data["artist"] as? String ?? "") : "Choose a track on your iPhone"
        let nextArtwork = data["artwork"] as? UIImage
        if artwork !== nextArtwork { artwork = nextArtwork }
        duration = Self.validTime((data["duration"] as? NSNumber)?.doubleValue ?? 0)
        if hasTrack, var nowPlaying = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            nowPlaying[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlaying
        }
        // The receiver may prefer AVPlayerItem metadata over the lock-screen dictionary.
        publishExternalMetadata()
        configurePlayerForDisplay()
        refreshProgress()
    }

    private func publishExternalMetadata() {
        guard let item = player?.currentItem else { return }
        // Reuse the encoded image when only duration or playback rate changes.
        guard publishedItem !== item || publishedTitle != title || publishedArtist != artist || publishedArtwork !== artwork else { return }
        publishedItem = item
        publishedTitle = title
        publishedArtist = artist
        publishedArtwork = artwork
        func text(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
            let result = AVMutableMetadataItem()
            result.identifier = identifier
            result.value = value as NSString
            result.extendedLanguageTag = "und"
            return result
        }
        var metadata = [text(.commonIdentifierTitle, title), text(.commonIdentifierArtist, artist),
                        text(.iTunesMetadataTrackSubTitle, artist)]
        if let jpeg = artwork?.jpegData(compressionQuality: 0.9) {
            let image = AVMutableMetadataItem()
            image.identifier = .commonIdentifierArtwork
            image.value = jpeg as NSData
            image.dataType = kCMMetadataBaseDataType_JPEG as String
            metadata.append(image)
        }
        item.externalMetadata = metadata
    }

    private func refreshProgress() {
        guard hasTrack, let player else {
            position = 0
            isPlaying = false
            return
        }
        position = Self.validTime(player.currentTime().seconds)
        isPlaying = player.timeControlStatus == .playing
        let measured = Self.validTime(player.currentItem?.duration.seconds ?? 0)
        if measured > 0 { duration = measured }
    }

    private func updateRoute() {
        routeName = AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portName).joined(separator: ", ")
    }

    func displayConnected(_ id: String) {
        sceneIDs.insert(id)
        connectedDisplays = sceneIDs.count
        updateIdleTimer()
        configurePlayerForDisplay()
    }

    func displayDisconnected(_ id: String) {
        sceneIDs.remove(id)
        connectedDisplays = sceneIDs.count
        updateIdleTimer()
        configurePlayerForDisplay()
    }

    private func updateIdleTimer() {
        if !sceneIDs.isEmpty && outputMode == .display {
            if previousIdleTimerState == nil { previousIdleTimerState = UIApplication.shared.isIdleTimerDisabled }
            UIApplication.shared.isIdleTimerDisabled = true
        } else {
            if let previousIdleTimerState { UIApplication.shared.isIdleTimerDisabled = previousIdleTimerState }
            previousIdleTimerState = nil
        }
    }

    private func configurePlayerForDisplay() {
        guard let player else { return }
        if connectedDisplays > 0 && outputMode == .display {
            if previousExternalPlaybackSetting == nil {
                previousExternalPlaybackSetting = player.usesExternalPlaybackWhileExternalScreenIsActive
            }
            // Keep the audio player from replacing our artwork window with its empty video surface.
            player.usesExternalPlaybackWhileExternalScreenIsActive = false
        } else if let previousExternalPlaybackSetting {
            player.usesExternalPlaybackWhileExternalScreenIsActive = previousExternalPlaybackSetting
            self.previousExternalPlaybackSetting = nil
        }
    }

    func setAccessoryStatus(_ message: String) { accessoryStatus = message }

    static func validTime(_ time: Double) -> Double { time.isFinite && time > 0 ? time : 0 }
    static func timeLabel(_ time: Double) -> String {
        let seconds = Int(min(validTime(time), 359999))
        if seconds >= 3600 { return String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    // Used only by the simulator smoke-test launch argument; never touches the audio player.
    func loadPreview() {
        title = "Night Bloom"
        artist = "Resona · Display preview"
        hasTrack = true
        duration = 248
        position = 91
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 800))
        artwork = renderer.image { context in
            let colors = [UIColor(red: 0.18, green: 0.08, blue: 0.35, alpha: 1).cgColor,
                          UIColor(red: 0.94, green: 0.45, blue: 0.5, alpha: 1).cgColor,
                          UIColor(red: 0.98, green: 0.76, blue: 0.48, alpha: 1).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.6, 1]) {
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 800, y: 800), options: [])
            }
            UIColor.white.withAlphaComponent(0.35).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 145, y: 100, width: 510, height: 510))
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            ("NIGHT\nBLOOM" as NSString).draw(in: CGRect(x: 50, y: 545, width: 700, height: 220), withAttributes: [
                .font: UIFont.systemFont(ofSize: 78, weight: .light), .foregroundColor: UIColor.white, .paragraphStyle: paragraph
            ])
        }
    }
}

final class TVSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var outputObserver: NSObjectProtocol?
    private weak var windowScene: UIWindowScene?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        self.windowScene = windowScene
        outputObserver = NotificationCenter.default.addObserver(
            forName: Notification.Name("ResonaTVOutputModeChanged"), object: nil, queue: .main
        ) { [weak self] _ in self?.updatePresentation() }
        updatePresentation()
    }
    private func updatePresentation() {
        guard let windowScene else { return }
        let id = windowScene.session.persistentIdentifier
        guard TVPlaybackModel.shared.outputMode == .display else {
            window?.isHidden = true
            window = nil
            TVPlaybackModel.shared.displayDisconnected(id)
            return
        }
        guard window == nil else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = .black
        window.rootViewController = UIHostingController(rootView: TVNowPlayingView(model: .shared))
        self.window = window
        // Do not take key-window status away from the Compose phone interface.
        window.isHidden = false
        TVPlaybackModel.shared.displayConnected(id)
    }
    func sceneDidDisconnect(_ scene: UIScene) {
        TVPlaybackModel.shared.displayDisconnected(scene.session.persistentIdentifier)
        window = nil
        windowScene = nil
        if let outputObserver { NotificationCenter.default.removeObserver(outputObserver) }
        outputObserver = nil
    }
}

final class ResonaAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        // iOS 16–26 automatic external scenes. iOS 27 uses the registered accessory below.
        if session.role == .windowExternalDisplayNonInteractive { configuration.delegateClass = TVSceneDelegate.self }
        return configuration
    }
}

final class TVContainerController: UIViewController {
    private var displayRegistration: NSObject?
    private var outputObserver: NSObjectProtocol?
    private var embedded: UIViewController?
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        registerTVAccessoryIfAvailable()
        outputObserver = NotificationCenter.default.addObserver(
            forName: Notification.Name("ResonaTVOutputModeChanged"), object: nil, queue: .main
        ) { [weak self] _ in self?.updateAccessoryMode() }
    }
    func embed(_ controller: UIViewController) {
        guard embedded == nil else { return }
        embedded = controller
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        controller.didMove(toParent: self)
    }
    private func registerTVAccessoryIfAvailable() {
        // These are documented public iOS 27 Objective-C selectors. Late binding keeps the fork
        // buildable on upstream's Xcode 26 runner while adopting iOS 27's required accessory API.
        guard #available(iOS 27.0, *) else {
            TVPlaybackModel.shared.setAccessoryStatus("Automatic external display (iOS 16–26)")
            return
        }
        let factory = NSSelectorFromString("externalNonInteractiveSceneAccessoryWithConfiguration:")
        let register = NSSelectorFromString("registerSceneAccessory:")
        guard let accessoryClass = NSClassFromString("UISceneAccessory") as? NSObject.Type,
              accessoryClass.responds(to: factory), responds(to: register) else {
            TVPlaybackModel.shared.setAccessoryStatus("External display registration unavailable")
            return
        }
        let configuration = UISceneConfiguration(name: "Resona TV", sessionRole: .windowExternalDisplayNonInteractive)
        configuration.delegateClass = TVSceneDelegate.self
        guard let accessory = accessoryClass.perform(factory, with: configuration)?.takeUnretainedValue(),
              let registration = perform(register, with: accessory)?.takeUnretainedValue() as? NSObject else {
            TVPlaybackModel.shared.setAccessoryStatus("External display registration failed")
            return
        }
        displayRegistration = registration
        updateAccessoryMode()
        TVPlaybackModel.shared.setAccessoryStatus("External display registered (iOS 27)")
    }
    private func updateAccessoryMode() {
        // UISceneAccessoryRegistration.isEnabled is a documented iOS 27 property.
        displayRegistration?.setValue(TVPlaybackModel.shared.outputMode == .display, forKey: "enabled")
    }
    deinit {
        if let outputObserver { NotificationCenter.default.removeObserver(outputObserver) }
    }
}

struct TVNowPlayingView: View {
    @ObservedObject var model: TVPlaybackModel
    @AppStorage("tv.layout") private var layoutRaw = TVLayout.cinema.rawValue
    @AppStorage("tv.dim") private var dim = 0.45
    @AppStorage("tv.progress") private var showProgress = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var layout: TVLayout { TVLayout(rawValue: layoutRaw) ?? .cinema }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let unit = min(size.width / 16, size.height / 9)
            ZStack {
                Color.black
                if let artwork = model.artwork {
                    Image(uiImage: artwork).resizable().scaledToFill()
                        .frame(width: size.width, height: size.height).clipped()
                        .blur(radius: unit * 0.65).scaleEffect(1.14)
                        .opacity(layout == .night ? 0.16 : 1 - min(max(dim, 0.15), 0.85))
                        .id(ObjectIdentifier(artwork)).transition(.opacity)
                } else {
                    LinearGradient(colors: [Color(red: 0.17, green: 0.12, blue: 0.28), .black],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                }
                LinearGradient(colors: [.clear, .black.opacity(0.48)], startPoint: .top, endPoint: .bottom)
                Group {
                    switch layout {
                    case .cinema:
                        HStack(spacing: unit * 0.9) {
                            cover(side: unit * 5.5)
                            details(unit: unit, centered: false)
                                .frame(width: unit * 6.7, alignment: .leading)
                        }
                    case .gallery:
                        VStack(spacing: unit * 0.28) {
                            cover(side: unit * 5.15)
                            details(unit: unit * 0.75, centered: true).frame(width: unit * 11)
                        }
                    case .ambient:
                        VStack {
                            Spacer()
                            HStack(spacing: unit * 0.5) {
                                cover(side: unit * 2.25)
                                details(unit: unit * 0.8, centered: false).frame(width: unit * 8)
                                Spacer(minLength: 0)
                            }
                        }.padding(unit * 0.95)
                    case .night:
                        VStack(spacing: unit * 0.3) {
                            cover(side: unit * 4.2).opacity(0.55)
                            details(unit: unit * 0.7, centered: true).opacity(0.65).frame(width: unit * 10)
                        }
                    }
                }
            }
            .frame(width: size.width, height: size.height).clipped()
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.6), value: model.artwork)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: layout)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    private func cover(side: CGFloat) -> some View {
        ZStack {
            Color.white.opacity(0.06)
            if let artwork = model.artwork {
                Image(uiImage: artwork).resizable().scaledToFit()
                    .id(ObjectIdentifier(artwork)).transition(.opacity)
            } else {
                Image(systemName: "music.note").font(.system(size: side * 0.24)).foregroundColor(.white.opacity(0.45))
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: side * 0.018))
        .shadow(color: .black.opacity(0.4), radius: side * 0.08, y: side * 0.035)
        .accessibilityLabel(model.hasTrack ? "Cover artwork for \(model.title)" : "No track selected")
    }

    private func details(unit: CGFloat, centered: Bool) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: unit * 0.18) {
            Text("RESONA").font(.system(size: unit * 0.17, weight: .semibold)).tracking(unit * 0.045)
                .foregroundColor(.white.opacity(0.6))
            Text(model.title).font(.system(size: unit * 0.55, weight: .semibold))
                .lineLimit(2).minimumScaleFactor(0.65)
            Text(model.artist).font(.system(size: unit * 0.3)).foregroundColor(.white.opacity(0.72))
                .lineLimit(2).minimumScaleFactor(0.8)
            if showProgress && model.hasTrack {
                VStack(spacing: unit * 0.12) {
                    if model.duration > 0 {
                        ProgressView(value: min(max(model.position / model.duration, 0), 1))
                            .tint(.white.opacity(0.8)).accessibilityLabel("Track progress")
                        HStack {
                            Text(TVPlaybackModel.timeLabel(model.position))
                            Spacer()
                            Text(TVPlaybackModel.timeLabel(model.duration))
                        }.monospacedDigit().font(.system(size: unit * 0.18)).foregroundColor(.white.opacity(0.6))
                    } else {
                        Text("LIVE").font(.system(size: unit * 0.18)).foregroundColor(.white.opacity(0.6))
                    }
                }.padding(.top, unit * 0.2)
            }
        }
        .foregroundColor(.white)
        .multilineTextAlignment(centered ? .center : .leading)
    }
}

struct TVDisplayButton: View {
    @ObservedObject var model: TVPlaybackModel
    @State private var showingSettings = false
    var body: some View {
        Button { showingSettings = true } label: {
            Label("TV", systemImage: model.connectedDisplays > 0 ? "tv.fill" : "tv")
                .font(.system(size: 14, weight: .semibold)).padding(.horizontal, 12).padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .accessibilityLabel("TV display settings")
        .sheet(isPresented: $showingSettings) { TVSettingsView(model: model) }
    }
}

struct TVSettingsView: View {
    @ObservedObject var model: TVPlaybackModel
    @AppStorage("tv.layout") private var layout = TVLayout.cinema.rawValue
    @AppStorage("tv.dim") private var dim = 0.45
    @AppStorage("tv.progress") private var showProgress = true
    @Environment(\.dismiss) private var dismiss
    @State private var preview = false
    var body: some View {
        NavigationStack {
            Form {
                Section("AirPlay mode") {
                    Picker("Output", selection: $model.outputMode) {
                        ForEach(TVOutputMode.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented)
                    if model.outputMode == .audio {
                        Text("Stream music with cover and track information. Your TV controls its own audio screen. You can lock your iPhone while listening.")
                        Text("If Screen Mirroring is active, stop it in Control Center, then choose your TV using the audio AirPlay button below.")
                            .font(.footnote).foregroundColor(.secondary)
                    }
                    AirPlayPicker(videoDevices: model.outputMode == .display).frame(height: 44)
                        .accessibilityLabel("Choose AirPlay output")
                }
                if model.outputMode == .display {
                    Section("TV appearance") {
                    TVNowPlayingView(model: model).aspectRatio(16 / 9, contentMode: .fit).listRowInsets(EdgeInsets())
                    Picker("Layout", selection: $layout) {
                        ForEach(TVLayout.allCases) { Text($0.title).tag($0.rawValue) }
                    }
                    Text((TVLayout(rawValue: layout) ?? .cinema).detail).font(.footnote).foregroundColor(.secondary)
                    HStack {
                        Text("Background dimming")
                        Spacer()
                        Text("\(Int(dim * 100))%").monospacedDigit().foregroundColor(.secondary)
                    }
                    Slider(value: $dim, in: 0.15...0.85).accessibilityLabel("Background dimming")
                    Toggle("Show track progress", isOn: $showProgress)
                    Button("Open full-screen preview") { preview = true }
                    }
                Section("Connect your TV") {
                    Text("For the custom display, open Control Center → Screen Mirroring and select your TV. Keep Resona open and your iPhone unlocked.")
                    Text("Audio AirPlay sends the cover and track details, but your TV decides whether and how to show them. Select Screen Mirroring if the screen stays black.")
                        .font(.footnote).foregroundColor(.secondary)
                }
                }
                Section("Connection") {
                    LabeledContent("Audio output", value: model.routeName)
                    LabeledContent("TV display", value: model.connectedDisplays > 0 ? "Connected" : "Not connected")
                    Text(model.accessoryStatus).font(.footnote).foregroundColor(.secondary)
                }
            }
            .navigationTitle("TV display")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .fullScreenCover(isPresented: $preview) {
                TVNowPlayingView(model: model).overlay(alignment: .topTrailing) {
                    Button { preview = false } label: {
                        Image(systemName: "xmark.circle.fill").font(.title).padding()
                    }.accessibilityLabel("Close preview")
                }
            }
        }
    }
}

private struct AirPlayPicker: UIViewRepresentable {
    let videoDevices: Bool
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = videoDevices
        return picker
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {
        uiView.prioritizesVideoDevices = videoDevices
    }
}
