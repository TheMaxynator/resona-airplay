import SwiftUI
import BackgroundTasks
import Shared

@main
struct ResonaApp: App {
    @UIApplicationDelegateAdaptor(ResonaAppDelegate.self) private var appDelegate
    @StateObject private var tvModel = TVPlaybackModel.shared
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
                    .overlay(alignment: .topTrailing) {
                        TVDisplayButton(model: tvModel).padding(.trailing, 12).padding(.top, 4)
                    }
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
