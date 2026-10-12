import AppKit
import HermiDesign
import SwiftUI

@main struct HermiDesktopApp: App {
  private var compactReview: Bool {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("--hermi-review-compact")
    #else
    false
    #endif
  }
  var body: some Scene {
    WindowGroup("Hermi · Map review 01b") {
      HermiMapPreview().frame(minWidth: compactReview ? 375 : 360,
                             idealWidth: compactReview ? 375 : 430,
                             maxWidth: compactReview ? 375 : 650,
                             minHeight: compactReview ? 667 : 650,
                             idealHeight: compactReview ? 667 : 900,
                             maxHeight: compactReview ? 667 : .infinity)
        .onAppear {
          NSApp.setActivationPolicy(.regular)
          NSApp.activate(ignoringOtherApps: true)
          #if DEBUG
          if ProcessInfo.processInfo.arguments.contains("--hermi-plan-review") {
            // Review launches must not inherit a maximized or offscreen window.
            DispatchQueue.main.async {
              if let window = NSApp.windows.first(where: { $0.contentView != nil && $0.canBecomeMain }) {
                window.setContentSize(NSSize(width: compactReview ? 375 : 430,
                                             height: compactReview ? 667 : 900))
                window.center()
              }
            }
          }
          #endif
        }
    }.defaultSize(width: 430, height: 900)
  }
}
