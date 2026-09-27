import AppKit
import HermiDesign
import SwiftUI

@main struct HermiDesktopApp: App {
  var body: some Scene {
    WindowGroup("Hermi · Design review 01") {
      HermiGallery().frame(minWidth: 360, idealWidth: 430, maxWidth: 650, minHeight: 650, idealHeight: 900)
        .onAppear {
          NSApp.setActivationPolicy(.regular)
          NSApp.activate(ignoringOtherApps: true)
        }
    }.defaultSize(width: 430, height: 900)
  }
}
