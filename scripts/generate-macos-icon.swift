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

func drawText(_ text: String, in rect: NSRect, size: CGFloat, color: NSColor) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byClipping
    let font = NSFont.systemFont(ofSize: size, weight: .black)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph,
        .kern: -size * 0.08
    ]
    let measured = NSString(string: text).size(withAttributes: attrs)
    let textRect = NSRect(
        x: rect.minX,
        y: rect.midY - measured.height * 0.48,
        width: rect.width,
        height: measured.height
    )
    NSString(string: text).draw(in: textRect, withAttributes: attrs)
}

func strokeLine(from start: NSPoint, to end: NSPoint, width: CGFloat, color: NSColor) {
    let path = NSBezierPath()
    path.move(to: start)
    path.line(to: end)
    path.lineWidth = width
    path.lineCapStyle = .round
    color.setStroke()
    path.stroke()
}

func drawClaudeCNIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    defer { image.unlockFocus() }

    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()
    NSGraphicsContext.current?.imageInterpolation = .high

    let card = NSRect(x: size * 0.074, y: size * 0.102, width: size * 0.852, height: size * 0.797)
    let cardPath = NSBezierPath(roundedRect: card, xRadius: size * 0.223, yRadius: size * 0.223)
    let paper = NSGradient(colors: [color(0xFFF7EF), color(0xEDE4D7)])!
    paper.draw(in: cardPath, angle: -42)

    let tile = NSRect(x: size * 0.113, y: size * 0.271, width: size * 0.414, height: size * 0.414)
    let tilePath = NSBezierPath(roundedRect: tile, xRadius: size * 0.102, yRadius: size * 0.102)
    let orange = NSGradient(colors: [color(0xFF9168), color(0xE65A35)])!
    orange.draw(in: tilePath, angle: -45)

    let moon = NSBezierPath()
    moon.appendOval(in: NSRect(x: size * 0.172, y: size * 0.354, width: size * 0.33, height: size * 0.33))
    moon.appendOval(in: NSRect(x: size * 0.236, y: size * 0.356, width: size * 0.305, height: size * 0.305))
    moon.windingRule = .evenOdd
    color(0xFFF7EF, alpha: 0.96).setFill()
    moon.fill()

    let ivory = color(0xFFF7EF)
    roundedRect(NSRect(x: size * 0.311, y: size * 0.346, width: size * 0.045, height: size * 0.268), radius: size * 0.023, fill: ivory)
    roundedRect(NSRect(x: size * 0.232, y: size * 0.410, width: size * 0.201, height: size * 0.047), radius: size * 0.023, fill: ivory)
    roundedRect(NSRect(x: size * 0.232, y: size * 0.523, width: size * 0.201, height: size * 0.047), radius: size * 0.023, fill: ivory)
    roundedRect(NSRect(x: size * 0.232, y: size * 0.410, width: size * 0.047, height: size * 0.160), radius: size * 0.023, fill: ivory)
    roundedRect(NSRect(x: size * 0.387, y: size * 0.410, width: size * 0.047, height: size * 0.160), radius: size * 0.023, fill: ivory)

    let cnRect = NSRect(x: size * 0.570, y: size * 0.324, width: size * 0.326, height: size * 0.309)
    roundedRect(cnRect, radius: size * 0.092, fill: color(0x171C25))
    drawText("CN", in: cnRect.insetBy(dx: size * 0.018, dy: 0), size: size * 0.168, color: color(0xFFF7EF))
    roundedRect(
        NSRect(x: size * 0.635, y: size * 0.578, width: size * 0.199, height: size * 0.018),
        radius: size * 0.009,
        fill: color(0xFF7A45)
    )

    return image
}

func writePNG(image: NSImage, filename: String) throws {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ClaudeCNIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法生成 \(filename)"])
    }
    try data.write(to: outputURL.appendingPathComponent(filename))
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
    try writePNG(image: image, filename: icon.filename)
}
