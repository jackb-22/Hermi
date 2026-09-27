# Test Hermi Preview on your iPhone

The native SwiftUI app runs directly on your iPhone. A simulator build cannot be installed on a physical phone; Xcode builds and signs the device version.

## One-time setup

1. Connect your iPhone to the Mac with a data-capable cable, unlock it, and accept **Trust This Computer** if prompted.
2. Open `apps/ios/HermiPreview/HermiPreview.xcodeproj`. Use this standalone preview, not the older Cairn project.
3. In **Xcode → Settings → Accounts**, add your Apple Account if needed. Complete sign-in yourself in Xcode; do not paste credentials into chat.
4. Select the blue **HermiPreview** project, then the **HermiPreview** app target. In **Signing & Capabilities**, leave **Automatically manage signing** on and select your **Personal Team** (or your existing development team).
5. Select your iPhone in the run destination selector beside the Run button. Press **⌘R**.
6. If requested, enable **Settings → Privacy & Security → Developer Mode** on your iPhone, restart and confirm. If iOS presents an untrusted-developer message, follow its instructions under **Settings → General → VPN & Device Management**, then run again.

If Xcode says the bundle identifier is unavailable, use an identifier unique to your Personal Team for this local preview. Do not change backend app identifiers or entitlements. If the phone is not listed, check **Window → Devices and Simulators** for pairing or OS-support errors and try another data cable.

## Each review

Keep the phone selected in Xcode and press **⌘R** to install the latest changes. Test using [test.md](../test.md), including quick taps, stationary holds, hold-and-slide, off-pill cancellation and pan/pinch. Share screenshots for layout or screen recordings for gestures.

The preview uses sample account/content data and public map tiles. Camera/outing tracking/invitations are not connected yet; installing on a phone does not enable them. No camera or location permission is needed for this visual checkpoint.

## Current setup status — 2026-09-27

The iPhone is now detected over USB and successfully paired. The user selected a Personal Team in Xcode. A device-targeted build reports **Developer Mode disabled** as the current blocker. Enable it under Settings → Privacy & Security, restart the phone, and confirm. No app has been installed yet. The earlier generic unsigned iPhone compilation passed; a signed device build remains pending Developer Mode readiness. The current error does not establish that a laptop OS update is required.

Sources: [Apple: run an app on a device](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html), [Apple: Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device), [Apple: signing workflow and Personal Team](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html).
