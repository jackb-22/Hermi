import AppKit
import CairnKit
import SwiftUI

@main struct PreviewApp: App {
  var body: some Scene {
    WindowGroup("Cairn · Live design preview") {
      CairnRoot(preview: true).frame(
        minWidth: 390, idealWidth: 430, maxWidth: 620, minHeight: 760, idealHeight: 880
      )
      .onAppear {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
      }
    }.defaultSize(width: 430, height: 880).windowStyle(.hiddenTitleBar)
  }
}
