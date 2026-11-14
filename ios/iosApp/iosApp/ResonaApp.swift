import SwiftUI
import BackgroundTasks
import Shared

@main
struct ResonaApp: App {
    @UIApplicationDelegateAdaptor(ResonaAppDelegate.self) private var appDelegate
    @StateObject private var tvModel = TVPlaybackModel.shared
    @State private var showingTVSettings = false
    @Environment(\.scenePhase) private var scenePhase

    init() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: "com.savoo.resona.autoexport", using: nil) { task in
            task.expirationHandler = { task.setTaskCompleted(success: false) }
            MainViewControllerKt.runBackgroundExport { ok in
                task.setTaskCompleted(success: ok.boolValue)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
                Color.black
            } else if ProcessInfo.processInfo.arguments.contains("--tv-preview") {
                TVNowPlayingView(model: tvModel).onAppear { tvModel.loadPreview() }
            } else {
                ComposeView()
                    .ignoresSafeArea()
                    .onAppear { LGConnectClient.shared.start() }
                    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ResonaOpenTVSettings"))) { _ in showingTVSettings = true }
                    .sheet(isPresented: $showingTVSettings) { TVSettingsView(model: tvModel) }
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background {
                MainViewControllerKt.onAppBackground()
            }
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: UIViewControllerRepresentableContext<ComposeView>) -> UIViewController {
        let container = TVContainerController()
        container.embed(MainViewControllerKt.MainViewController())
        return container
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: UIViewControllerRepresentableContext<ComposeView>) {}
}
