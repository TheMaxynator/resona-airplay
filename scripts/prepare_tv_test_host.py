#!/usr/bin/env python3
"""Create a disposable native test host using the exact production TV source/tests.

The display listens to Foundation notifications and an AVPlayer, so its tests do not
need to recompile the unrelated Kotlin/Compose interface for a second architecture.
The complete Kotlin application is compiled separately for the device test IPA.
"""
import argparse
import re
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = root / "ios" / "iosApp"
destination = args.destination.resolve()
if destination.exists():
    raise SystemExit("Test-host destination must be new")
shutil.copytree(source, destination, ignore=shutil.ignore_patterns("build", "xcuserdata"))

project = destination / "iosApp.xcodeproj" / "project.pbxproj"
content = project.read_text()
# Keep all native sources, assets, test target and shared scheme unchanged.
content = content.replace("A1000000000000000000000E /* Compile Kotlin Framework */,", "")
content = re.sub(r'\s*OTHER_LDFLAGS = \(.*?\);', '', content, flags=re.S)
content = re.sub(r'\s*FRAMEWORK_SEARCH_PATHS = .*?;', '', content)
project.write_text(content)
(destination / "iosApp" / "ResonaApp.swift").write_text('''import SwiftUI

@main
struct NativeTVTestHost: App {
    @StateObject private var model = TVPlaybackModel.shared
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("--tv-preview") {
                TVNowPlayingView(model: model).onAppear { model.loadPreview() }
            } else {
                Color.black
            }
        }
    }
}
''')
print(destination)
