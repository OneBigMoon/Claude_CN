#!/usr/bin/env swift

import AppKit
import Foundation

let outputPath = CommandLine.arguments.dropFirst().first ?? "dist/ClaudeCN.iconset"
let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    let red = CGFloat((hex >> 16) & 0xff) / 255
    let green = CGFloat((hex >> 8) & 0xff) / 255
    let blue = CGFloat(hex & 0xff) / 255
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

func roundedRect(_ rect: NSRect, radius: CGFloat, fill: NSColor) {
    fill.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func drawClaudeCNIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    defer { image.unlockFocus() }

    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()
    NSGraphicsContext.current?.imageInterpolation = .high

    let inset = size * 0.094
    let card = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let cardPath = NSBezierPath(roundedRect: card, xRadius: size * 0.226, yRadius: size * 0.226)
    let gradient = NSGradient(colors: [
        color(0x121826),
        color(0x1F3A4A),
        color(0xF2A541)
    ])!
    gradient.draw(in: cardPath, angle: -38)

    let orbit = NSBezierPath()
    orbit.move(to: NSPoint(x: size * 0.18, y: size * 0.674))
    orbit.curve(
        to: NSPoint(x: size * 0.818, y: size * 0.252),
        controlPoint1: NSPoint(x: size * 0.325, y: size * 0.525),
        controlPoint2: NSPoint(x: size * 0.506, y: size * 0.375)
    )
    orbit.lineWidth = max(2, size * 0.027)
    orbit.lineCapStyle = .round
    color(0xffffff, alpha: 0.17).setStroke()
    orbit.stroke()

    let crescent = NSBezierPath()
    crescent.appendOval(in: NSRect(x: size * 0.18, y: size * 0.246, width: size * 0.54, height: size * 0.54))
    crescent.appendOval(in: NSRect(x: size * 0.297, y: size * 0.226, width: size * 0.51, height: size * 0.51))
    crescent.windingRule = .evenOdd
    color(0xFFF7E6).setFill()
    crescent.fill()

    color(0xFF7A45).setFill()
    NSBezierPath(ovalIn: NSRect(x: size * 0.66, y: size * 0.232, width: size * 0.106, height: size * 0.106)).fill()

    let ivory = color(0xFFF7E6)
    let gold = color(0xFFB000, alpha: 0.82)
    roundedRect(NSRect(x: size * 0.574, y: size * 0.297, width: size * 0.07, height: size * 0.398), radius: size * 0.035, fill: ivory)
    roundedRect(NSRect(x: size * 0.475, y: size * 0.383, width: size * 0.27, height: size * 0.07), radius: size * 0.035, fill: ivory)
    roundedRect(NSRect(x: size * 0.475, y: size * 0.551, width: size * 0.27, height: size * 0.07), radius: size * 0.035, fill: ivory)
    roundedRect(NSRect(x: size * 0.475, y: size * 0.383, width: size * 0.07, height: size * 0.238), radius: size * 0.035, fill: ivory)
    roundedRect(NSRect(x: size * 0.674, y: size * 0.383, width: size * 0.07, height: size * 0.238), radius: size * 0.035, fill: ivory)
    roundedRect(NSRect(x: size * 0.576, y: size * 0.299, width: size * 0.066, height: size * 0.394), radius: size * 0.033, fill: gold)

    return image
}

func writePNG(image: NSImage, pixels: Int, filename: String) throws {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ClaudeCNIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法生成 \(filename)"])
    }
    let url = outputURL.appendingPathComponent(filename)
    try data.write(to: url)
    _ = pixels
}

let icons: [(points: Int, scale: Int, filename: String)] = [
    (16, 1, "icon_16x16.png"),
    (16, 2, "icon_16x16@2x.png"),
    (32, 1, "icon_32x32.png"),
    (32, 2, "icon_32x32@2x.png"),
    (128, 1, "icon_128x128.png"),
    (128, 2, "icon_128x128@2x.png"),
    (256, 1, "icon_256x256.png"),
    (256, 2, "icon_256x256@2x.png"),
    (512, 1, "icon_512x512.png"),
    (512, 2, "icon_512x512@2x.png")
]

for icon in icons {
    let pixels = icon.points * icon.scale
    let image = drawClaudeCNIcon(size: CGFloat(pixels))
    try writePNG(image: image, pixels: pixels, filename: icon.filename)
}
