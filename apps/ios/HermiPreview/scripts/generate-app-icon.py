#!/usr/bin/env python3
"""Render the actual native crab artwork into the iOS Home Screen icon."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
source = (root / 'Sources/HermiDesign/HermitBrand.swift').read_text()
mark = source[source.index('struct HermitBrandMark:'):source.index('\nstruct CrabIntroFrame:')]
output = root / 'iOS/Assets.xcassets/AppIcon.appiconset/AppIcon.png'
output.parent.mkdir(parents=True, exist_ok=True)
work = root / '.build/icon-renderer'
work.mkdir(parents=True, exist_ok=True)
swift = '''import SwiftUI
import AppKit

enum HermiPalette {
  static func color(_ value: UInt32) -> Color {
    Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
  }
}
''' + mark + '''
@main struct ExportIcon {
  @MainActor static func main() throws {
    let content = ZStack {
      HermiPalette.color(0xFAF7F0)
      HermitBrandMark().frame(width: 768, height: 864)
    }.frame(width: 1024, height: 1024)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 1
    renderer.isOpaque = true
    guard let image = renderer.cgImage,
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
      fatalError("Could not render app icon")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
  }
}
'''
(work / 'main.swift').write_text(swift)
env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
subprocess.run(['xcrun', 'swiftc', '-parse-as-library', str(work / 'main.swift'), '-o', str(work / 'render')], check=True, env=env)
subprocess.run([str(work / 'render'), str(output)], check=True, env=env)
print(output)
