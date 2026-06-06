import AppKit
import Foundation
import UniformTypeIdentifiers

struct ClaudeCNState {
    var status: String = "检测中"
    var version: String = "-"
    var appPath: String = "/Applications/Claude.app"
    var compatibleVersion: String = "1.10628.x"
    var compatibility: String = "检测中"
    var updateStatus: String = "检查更新"
    var latestAppVersion: String = "-"
    var hasAppUpdate: Bool = false
    var isCompatible: Bool = true
    var isLocalized: Bool = false
    var isRunning: Bool = false
}

enum PanelAction {
    case repatch
    case restore
    case refresh
    case chooseApp
    case update
    case github
    case quit
}

final class ClaudeCNPanelWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class ClaudeCNPanelView: NSView {
    var state = ClaudeCNState() {
        didSet { needsDisplay = true }
    }
    var onAction: ((PanelAction) -> Void)?

    private let size = NSSize(width: 320, height: 574)
    private var hoverAction: PanelAction? {
        didSet { needsDisplay = true }
    }
    private var trackingAreaRef: NSTrackingArea?

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { size }

    private var repatchRect: NSRect { NSRect(x: 28, y: 256, width: 264, height: 44) }
    private var restoreRect: NSRect { NSRect(x: 28, y: 310, width: 264, height: 44) }
    private var authorRect: NSRect { NSRect(x: 30, y: 392, width: 260, height: 18) }
    private var updateRect: NSRect { NSRect(x: 28, y: 486, width: 264, height: 30) }
    private var refreshRect: NSRect { NSRect(x: 24, y: 530, width: 82, height: 32) }
    private var chooseAppRect: NSRect { NSRect(x: 119, y: 530, width: 82, height: 32) }
    private var quitRect: NSRect { NSRect(x: 214, y: 530, width: 82, height: 32) }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingAreaRef {
            removeTrackingArea(trackingAreaRef)
        }
        let tracking = NSTrackingArea(
            rect: bounds,
            options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(tracking)
        trackingAreaRef = tracking
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hoverAction = action(at: point)
    }

    override func mouseExited(with event: NSEvent) {
        hoverAction = nil
    }

    override func mouseDown(with event: NSEvent) {
        guard !state.isRunning else { return }
        let point = convert(event.locationInWindow, from: nil)
        guard let action = action(at: point) else { return }
        onAction?(action)
    }

    private func action(at point: NSPoint) -> PanelAction? {
        if state.isRunning { return nil }
        if repatchRect.contains(point) { return state.isCompatible ? .repatch : nil }
        if restoreRect.contains(point) { return .restore }
        if authorRect.contains(point) { return .github }
        if updateRect.contains(point) { return .update }
        if refreshRect.contains(point) { return .refresh }
        if chooseAppRect.contains(point) { return .chooseApp }
        if quitRect.contains(point) { return .quit }
        return nil
    }

    override func draw(_ dirtyRect: NSRect) {
        drawCard()
        drawHeader()
        drawSeparator(y: 112)
        drawStatusSection()
        drawSeparator(y: 236)
        drawActions()
        drawSeparator(y: 374)
        drawAuthor()
        drawSeparator(y: 482)
        drawUpdate()
        drawSeparator(y: 522)
        drawFooter()
    }

    private func drawCard() {
        let body = NSRect(x: 0, y: 16, width: bounds.width, height: bounds.height - 16)
        let path = NSBezierPath(roundedRect: body, xRadius: 24, yRadius: 24)
        let notch = NSBezierPath()
        let midX = bounds.midX
        notch.move(to: NSPoint(x: midX - 20, y: 18))
        notch.curve(
            to: NSPoint(x: midX, y: 0),
            controlPoint1: NSPoint(x: midX - 14, y: 12),
            controlPoint2: NSPoint(x: midX - 9, y: 0)
        )
        notch.curve(
            to: NSPoint(x: midX + 20, y: 18),
            controlPoint1: NSPoint(x: midX + 9, y: 0),
            controlPoint2: NSPoint(x: midX + 14, y: 12)
        )
        notch.close()

        NSColor(calibratedRed: 0.74, green: 0.74, blue: 0.73, alpha: 1).setFill()
        path.fill()
        notch.fill()
    }

    private func drawHeader() {
        let iconRect = NSRect(x: 26, y: 52, width: 30, height: 30)
        NSColor.systemBlue.setFill()
        NSBezierPath(ovalIn: iconRect).fill()

        if let image = NSImage(systemSymbolName: "globe.asia.australia.fill", accessibilityDescription: "ClaudeCN") {
            image.draw(in: iconRect.insetBy(dx: 5, dy: 5), from: .zero, operation: .sourceOver, fraction: 1)
        } else {
            drawText("中", in: iconRect, font: .boldSystemFont(ofSize: 14), color: .white, alignment: .center)
        }

        drawText(
            "Claude 汉化助手",
            in: NSRect(x: 68, y: 42, width: 210, height: 28),
            font: .boldSystemFont(ofSize: 19),
            color: ink(),
            alignment: .left
        )
        drawText(
            bundleVersionText(),
            in: NSRect(x: 68, y: 72, width: 210, height: 20),
            font: .systemFont(ofSize: 13, weight: .medium),
            color: ink(alpha: 0.9),
            alignment: .left
        )
    }

    private func drawStatusSection() {
        drawText("状态", in: NSRect(x: 28, y: 134, width: 80, height: 22), font: .boldSystemFont(ofSize: 17), color: ink(), alignment: .left)
        drawText("版本", in: NSRect(x: 28, y: 168, width: 80, height: 22), font: .boldSystemFont(ofSize: 17), color: ink(), alignment: .left)
        drawText("兼容", in: NSRect(x: 28, y: 202, width: 80, height: 22), font: .boldSystemFont(ofSize: 17), color: ink(), alignment: .left)

        let dotColor = state.isRunning ? NSColor.systemOrange : (state.isLocalized ? NSColor.systemGreen : NSColor.systemRed)
        dotColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: 232, y: 140, width: 10, height: 10)).fill()

        drawText(
            state.isRunning ? "处理中" : state.status,
            in: NSRect(x: 248, y: 132, width: 58, height: 22),
            font: .systemFont(ofSize: 15, weight: .medium),
            color: ink(),
            alignment: .left
        )
        drawText(
            state.version,
            in: NSRect(x: 198, y: 168, width: 104, height: 22),
            font: .systemFont(ofSize: 15, weight: .medium),
            color: ink(),
            alignment: .right
        )

        let compatColor = state.isCompatible ? NSColor.systemGreen : NSColor.systemOrange
        compatColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: 188, y: 208, width: 10, height: 10)).fill()
        drawText(
            state.isCompatible ? state.compatibleVersion : "需适配",
            in: NSRect(x: 204, y: 200, width: 98, height: 22),
            font: .systemFont(ofSize: 15, weight: .medium),
            color: ink(),
            alignment: .right
        )
    }

    private func drawActions() {
        drawButton(rect: repatchRect, title: state.isRunning ? "正在处理" : "重新汉化", symbol: "arrow.clockwise.circle.fill", action: .repatch, large: true)
        drawButton(rect: restoreRect, title: "恢复原版", symbol: "arrow.uturn.backward.circle", action: .restore, large: true)
    }

    private func drawAuthor() {
        drawText("作者：OneBigMoon", in: authorRect, font: .systemFont(ofSize: 13, weight: .bold), color: hoverAction == .github ? .systemBlue : ink(), alignment: .center)
        drawText("本软件完全免费，不可商业化", in: NSRect(x: 30, y: 422, width: 260, height: 18), font: .systemFont(ofSize: 12.5, weight: .bold), color: .systemOrange, alignment: .center)
        drawText("付费获取即被骗，请举报", in: NSRect(x: 30, y: 448, width: 260, height: 18), font: .systemFont(ofSize: 12.5, weight: .bold), color: .systemRed, alignment: .center)
    }

    private func drawUpdate() {
        let title = state.hasAppUpdate ? "发现 \(state.latestAppVersion)，点击下载" : state.updateStatus
        drawButton(rect: updateRect, title: title, symbol: state.hasAppUpdate ? "arrow.down.circle.fill" : "sparkle.magnifyingglass", action: .update, large: false)
    }

    private func drawFooter() {
        drawButton(rect: refreshRect, title: "刷新状态", symbol: nil, action: .refresh, large: false)
        drawButton(rect: chooseAppRect, title: "选择 Claude", symbol: nil, action: .chooseApp, large: false)
        drawButton(rect: quitRect, title: "退出", symbol: nil, action: .quit, large: false)
    }

    private func drawButton(rect: NSRect, title: String, symbol: String?, action: PanelAction, large: Bool) {
        let hovered = hoverAction == action
        let enabled = (!state.isRunning || action == .quit || action == .refresh)
            && (action != .repatch || state.isCompatible)
        let fill = enabled
            ? NSColor(calibratedRed: hovered ? 0.64 : 0.67, green: hovered ? 0.64 : 0.67, blue: hovered ? 0.63 : 0.66, alpha: 1)
            : NSColor(calibratedRed: 0.68, green: 0.68, blue: 0.67, alpha: 1)
        fill.setFill()
        NSBezierPath(roundedRect: rect, xRadius: large ? 18 : 9, yRadius: large ? 18 : 9).fill()

        let font = large ? NSFont.boldSystemFont(ofSize: 17) : NSFont.boldSystemFont(ofSize: action == .update ? 13 : 15)
        let color = enabled ? ink() : ink(alpha: 0.62)
        let symbolSize: CGFloat = symbol == nil ? 0 : (large ? 20 : 14)
        let titleSize = title.size(withAttributes: [.font: font])
        let contentWidth = titleSize.width + (symbol == nil ? 0 : symbolSize + 9)
        var x = rect.midX - contentWidth / 2

        if let symbol, let image = NSImage(systemSymbolName: symbol, accessibilityDescription: title) {
            let imageRect = NSRect(x: x, y: rect.midY - symbolSize / 2, width: symbolSize, height: symbolSize)
            image.draw(in: imageRect, from: .zero, operation: .sourceOver, fraction: enabled ? 1 : 0.65)
            x += symbolSize + 9
        }

        drawText(
            title,
            in: NSRect(x: x, y: rect.midY - 12, width: titleSize.width + 4, height: 24),
            font: font,
            color: color,
            alignment: .left
        )
    }

    private func drawSeparator(y: CGFloat) {
        NSColor(calibratedRed: 0.58, green: 0.58, blue: 0.57, alpha: 0.45).setFill()
        NSRect(x: 0, y: y, width: bounds.width, height: 1).fill()
    }

    private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor, alignment: NSTextAlignment) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph
        ]
        NSString(string: text).draw(in: rect, withAttributes: attrs)
    }

    private func ink(alpha: CGFloat = 1) -> NSColor {
        NSColor(calibratedRed: 0.18, green: 0.18, blue: 0.18, alpha: alpha)
    }

    private func bundleVersionText() -> String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return "v\(version ?? "0.0.3")"
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var panelWindow: ClaudeCNPanelWindow!
    private var panelView: ClaudeCNPanelView!
    private var outsideClickMonitor: Any?
    private var state = ClaudeCNState()
    private let selectedClaudeAppPathKey = "ClaudeCN.selectedClaudeAppPath"
    private let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ClaudeCN.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "ClaudeCN"
        statusItem.button?.image = NSImage(systemSymbolName: "globe.asia.australia.fill", accessibilityDescription: "ClaudeCN")
        statusItem.button?.imagePosition = .imageLeading
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
        statusItem.button?.toolTip = "Claude 汉化助手"

        panelView = ClaudeCNPanelView(frame: NSRect(x: 0, y: 0, width: 320, height: 574))
        panelView.onAction = { [weak self] action in
            switch action {
            case .repatch:
                self?.runApply()
            case .restore:
                self?.runRestore()
            case .refresh:
                self?.refreshStatus(showAlert: false)
                self?.checkForUpdates()
            case .chooseApp:
                self?.chooseClaudeApp()
            case .update:
                self?.openLatestRelease()
            case .github:
                self?.openGitHubHome()
            case .quit:
                NSApp.terminate(nil)
            }
        }

        panelWindow = ClaudeCNPanelWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 574),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panelWindow.contentView = panelView
        panelWindow.backgroundColor = .clear
        panelWindow.isOpaque = false
        panelWindow.alphaValue = 1
        panelWindow.hasShadow = true
        panelWindow.level = .popUpMenu
        panelWindow.hidesOnDeactivate = false
        panelWindow.collectionBehavior = [.canJoinAllSpaces, .transient]
        panelWindow.isReleasedWhenClosed = false

        refreshStatus(showAlert: false)
        checkForUpdates()
    }

    @objc private func togglePanel() {
        guard let button = statusItem.button else { return }
        if panelWindow.isVisible {
            hidePanel()
        } else {
            panelView.state = state
            showPanel(relativeTo: button)
        }
    }

    private func showPanel(relativeTo button: NSStatusBarButton) {
        let panelSize = panelWindow.frame.size
        var anchor = NSEvent.mouseLocation
        if let window = button.window {
            let buttonFrame = button.convert(button.bounds, to: nil)
            let screenFrame = window.convertToScreen(buttonFrame)
            if screenFrame.midX.isFinite && screenFrame.minY.isFinite {
                anchor = NSPoint(x: screenFrame.midX, y: screenFrame.minY)
            }
        }
        let screen = NSScreen.screens.first { NSMouseInRect(anchor, $0.frame, false) } ?? NSScreen.main
        let frame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = min(max(anchor.x - panelSize.width / 2, frame.minX + 8), frame.maxX - panelSize.width - 8)
        let proposedY = anchor.y - panelSize.height - 8
        let y = proposedY < frame.minY ? frame.maxY - panelSize.height - 8 : min(proposedY, frame.maxY - panelSize.height - 8)
        panelWindow.setFrameOrigin(NSPoint(x: x, y: y))
        panelWindow.makeKeyAndOrderFront(nil)
        panelWindow.orderFrontRegardless()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
                DispatchQueue.main.async { self?.hidePanel() }
            }
        }
    }

    private func hidePanel() {
        panelWindow.orderOut(nil)
        if let outsideClickMonitor {
            NSEvent.removeMonitor(outsideClickMonitor)
            self.outsideClickMonitor = nil
        }
    }

    private func refreshStatus(showAlert: Bool) {
        setBusy(true)
        runTool(arguments: ["status"], requiresAdmin: false) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let output):
                self.appendLog(output)
                self.state = self.parseStatus(output)
                self.state.isRunning = false
                self.panelView.state = self.state
                self.statusItem.button?.title = "ClaudeCN"
                if showAlert { self.showAlert(title: "ClaudeCN 状态", message: output) }
            case .failure(let error):
                self.appendLog(error.localizedDescription)
                self.state.status = "检查失败"
                self.state.isLocalized = false
                self.state.isRunning = false
                self.panelView.state = self.state
                self.statusItem.button?.title = "ClaudeCN"
                if showAlert { self.showAlert(title: "检查失败", message: error.localizedDescription) }
            }
        }
    }

    private func checkForUpdates() {
        state.updateStatus = "正在检查更新..."
        panelView.state = state
        guard let url = URL(string: "https://api.github.com/repos/OneBigMoon/Claude_CN/releases/latest") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.appendLog("检查更新失败：\(error.localizedDescription)")
                    self.state.updateStatus = "检查更新失败，点击打开 Release"
                    self.state.hasAppUpdate = false
                    self.panelView.state = self.state
                    return
                }
                guard let data,
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let tag = object["tag_name"] as? String else {
                    self.state.updateStatus = "无法读取更新信息，点击打开 Release"
                    self.state.hasAppUpdate = false
                    self.panelView.state = self.state
                    return
                }
                let latest = tag.trimmingCharacters(in: CharacterSet(charactersIn: "v"))
                let current = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
                self.state.latestAppVersion = "v\(latest)"
                self.state.hasAppUpdate = self.compareVersion(latest, current) == .orderedDescending
                self.state.updateStatus = self.state.hasAppUpdate ? "发现新版本 v\(latest)" : "已是最新版 v\(current)"
                self.panelView.state = self.state
            }
        }.resume()
    }

    private func openLatestRelease() {
        guard let url = URL(string: "https://github.com/OneBigMoon/Claude_CN/releases/latest") else { return }
        NSWorkspace.shared.open(url)
    }

    private func openGitHubHome() {
        guard let url = URL(string: "https://github.com/OneBigMoon/Claude_CN") else { return }
        NSWorkspace.shared.open(url)
    }

    private func chooseClaudeApp() {
        let panel = NSOpenPanel()
        panel.title = "选择 Claude.app"
        panel.message = "请选择 Claude Desktop 官方 App，通常位于 /Applications/Claude.app。"
        panel.prompt = "使用这个 Claude"
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.applicationBundle]

        let response = panel.runModal()
        guard response == .OK, let url = panel.url else { return }

        UserDefaults.standard.set(url.path, forKey: selectedClaudeAppPathKey)
        appendLog("已选择 Claude.app：\(url.path)")
        showAlert(title: "已选择 Claude.app", message: "后续汉化、恢复和状态检查都会使用：\n\(url.path)")
        refreshStatus(showAlert: false)
    }

    private func compareVersion(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(left.count, right.count)
        for index in 0..<count {
            let l = index < left.count ? left[index] : 0
            let r = index < right.count ? right[index] : 0
            if l > r { return .orderedDescending }
            if l < r { return .orderedAscending }
        }
        return .orderedSame
    }

    private func runApply() {
        setBusy(true)
        appendLog("开始重新汉化")
        runTool(arguments: ["apply"], requiresAdmin: true) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let output):
                self.appendLog(output)
                self.refreshStatus(showAlert: false)
            case .failure(let error):
                self.appendLog(error.localizedDescription)
                self.state.status = "汉化失败"
                self.state.isRunning = false
                self.panelView.state = self.state
                self.statusItem.button?.title = "ClaudeCN"
                self.showAlert(title: "汉化失败", message: error.localizedDescription)
            }
        }
    }

    private func runRestore() {
        setBusy(true)
        appendLog("开始恢复原版")
        runTool(arguments: ["restore"], requiresAdmin: true) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let output):
                self.appendLog(output)
                self.refreshStatus(showAlert: false)
            case .failure(let error):
                self.appendLog(error.localizedDescription)
                self.state.status = "恢复失败"
                self.state.isRunning = false
                self.panelView.state = self.state
                self.statusItem.button?.title = "ClaudeCN"
                self.showAlert(title: "恢复失败", message: error.localizedDescription)
            }
        }
    }

    private func setBusy(_ busy: Bool) {
        DispatchQueue.main.async {
            self.state.isRunning = busy
            self.panelView.state = self.state
            self.statusItem.button?.title = busy ? "ClaudeCN…" : "ClaudeCN"
        }
    }

    private func parseStatus(_ output: String) -> ClaudeCNState {
        var next = ClaudeCNState()
        for line in output.split(separator: "\n").map(String.init) {
            if line.contains("[Claude_CN] Claude.app:") {
                let raw = line.components(separatedBy: "Claude.app:").last?.trimmingCharacters(in: .whitespaces) ?? next.appPath
                next.appPath = raw.replacingOccurrences(of: "（未找到）", with: "")
            }
            if line.contains("[Claude_CN] 状态:") {
                next.status = line.components(separatedBy: "状态:").last?.trimmingCharacters(in: .whitespaces) ?? next.status
            }
            if line.contains("[Claude_CN] Claude 版本:") {
                next.version = line.components(separatedBy: "Claude 版本:").last?.trimmingCharacters(in: .whitespaces) ?? next.version
            }
            if line.contains("[Claude_CN] 兼容版本:") {
                next.compatibleVersion = line.components(separatedBy: "兼容版本:").last?.trimmingCharacters(in: .whitespaces) ?? next.compatibleVersion
            }
            if line.contains("[Claude_CN] 兼容状态:") {
                next.compatibility = line.components(separatedBy: "兼容状态:").last?.trimmingCharacters(in: .whitespaces) ?? next.compatibility
            }
        }
        next.isLocalized = next.status.contains("已汉化")
        next.isCompatible = next.compatibility.contains("已适配")
        return next
    }

    private func runTool(
        arguments: [String],
        requiresAdmin: Bool,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let root = self.toolRootURL() else {
                    throw RunnerError.missingToolRoot
                }
                let finalArguments = self.argumentsWithSelectedClaudeApp(arguments)
                let output = requiresAdmin
                    ? try self.runWithAdmin(root: root, arguments: finalArguments)
                    : try self.runWithoutAdmin(root: root, arguments: finalArguments)
                DispatchQueue.main.async { completion(.success(output)) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    private func runWithoutAdmin(root: URL, arguments: [String]) throws -> String {
        let process = Process()
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.currentDirectoryURL = root

        if let bundledNode = bundledNodeURL() {
            process.executableURL = bundledNode
            process.arguments = ["scripts/claude-cn.mjs"] + arguments
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", "scripts/claude-cn.mjs"] + arguments
        }

        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw RunnerError.processFailed(process.terminationStatus, output)
        }
        return output
    }

    private func runWithAdmin(root: URL, arguments: [String]) throws -> String {
        let node = bundledNodeURL().map { shellQuote($0.path) } ?? "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/env node"
        let args = arguments.map(shellQuote).joined(separator: " ")
        let command = "cd \(shellQuote(root.path)) && \(node) scripts/claude-cn.mjs \(args)"
        let appleScript = "do shell script \(appleScriptString(command)) with administrator privileges"

        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", appleScript]
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw RunnerError.processFailed(process.terminationStatus, output)
        }
        return output
    }

    private func argumentsWithSelectedClaudeApp(_ arguments: [String]) -> [String] {
        if arguments.contains("--app") || arguments.contains(where: { $0.hasPrefix("--app=") }) {
            return arguments
        }
        guard let path = UserDefaults.standard.string(forKey: selectedClaudeAppPathKey),
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return arguments
        }
        return arguments + ["--app", path]
    }

    private func toolRootURL() -> URL? {
        let fileManager = FileManager.default
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("Claude_CN"),
            URL(fileURLWithPath: fileManager.currentDirectoryPath)
        ].compactMap { $0 }

        return candidates.first {
            fileManager.fileExists(atPath: $0.appendingPathComponent("scripts/claude-cn.mjs").path)
        }
    }

    private func bundledNodeURL() -> URL? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node"),
              FileManager.default.isExecutableFile(atPath: url.path) else {
            return nil
        }
        return url
    }

    private func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private func appleScriptString(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }

    private func showAlert(title: String, message: String) {
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = message.isEmpty ? "没有额外输出。" : message
            alert.addButton(withTitle: "好")
            if FileManager.default.fileExists(atPath: self.logURL.path) {
                alert.addButton(withTitle: "打开日志")
            }
            let response = alert.runModal()
            if response == .alertSecondButtonReturn {
                NSWorkspace.shared.open(self.logURL)
            }
        }
    }

    private func ensureLogDirectory() {
        try? FileManager.default.createDirectory(
            at: logURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
    }

    private func appendLog(_ text: String) {
        ensureLogDirectory()
        let entry = "\n\n=== \(Date()) ===\n\(text)\n"
        guard let data = entry.data(using: .utf8) else { return }

        if FileManager.default.fileExists(atPath: logURL.path),
           let handle = try? FileHandle(forWritingTo: logURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: logURL)
        }
    }
}

enum RunnerError: LocalizedError {
    case missingToolRoot
    case processFailed(Int32, String)

    var errorDescription: String? {
        switch self {
        case .missingToolRoot:
            return "没有找到内置的 Claude_CN 工具资源。请重新构建或重新下载完整 App。"
        case .processFailed(let status, let output):
            return Self.friendlyProcessFailure(status: status, output: output)
        }
    }

    private static func friendlyProcessFailure(status: Int32, output: String) -> String {
        let detail = output.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = detail.lowercased()

        if status == -128 || lower.contains("user canceled") || lower.contains("(-128)") {
            return """
            你取消了管理员授权，ClaudeCN 没有修改 Claude。

            重新点击“重新汉化”或“恢复原版”，在 macOS 弹出的授权窗口中输入本机管理员密码即可。
            """
        }

        if lower.contains("authentication failed") || lower.contains("incorrect password") {
            return """
            管理员授权失败，可能是密码输入错误，或当前账号没有管理员权限。

            请使用本机管理员账号密码重试。
            """
        }

        if lower.contains("not authorized to send apple events") || lower.contains("erraeeventnotpermitted") {
            return """
            macOS 阻止 ClaudeCN 调用系统授权窗口。

            请到“系统设置 > 隐私与安全性 > 自动化”允许 ClaudeCN 控制系统事件，然后重新尝试。
            """
        }

        if lower.contains("permission denied") || lower.contains("operation not permitted") || lower.contains("eacces") || lower.contains("eperm") {
            return """
            权限不足，无法修改 Claude.app。

            请确认：
            1. Claude Desktop 位于 /Applications/Claude.app，或已通过“选择 Claude”选中了正确 App。
            2. 点击操作后，在 macOS 授权弹窗中输入管理员密码。
            3. 操作前先退出正在运行的 Claude。

            原始输出：
            \(detail.isEmpty ? "无" : detail)
            """
        }

        if detail.contains("找不到 Claude.app") || detail.contains("不是有效的 Claude.app") || detail.contains("选择的 App 不是 Claude Desktop") {
            return """
            Claude.app 路径不正确。

            请点击底部“选择 Claude”，手动选择 Claude Desktop 官方 App，通常是 /Applications/Claude.app。

            原始输出：
            \(detail)
            """
        }

        if detail.contains("当前 Claude Desktop 版本不在已适配范围内") {
            return """
            当前 Claude Desktop 版本还没有适配，已停止执行以避免损坏应用。

            请先查看 GitHub Releases 是否有新版本 ClaudeCN；确认要冒险尝试时，再使用命令行 --force。

            原始输出：
            \(detail)
            """
        }

        if detail.contains("没有找到可恢复的备份") {
            return """
            没有找到可恢复的备份。

            只有成功执行过一次“重新汉化”后，ClaudeCN 才能恢复到汉化前的备份。
            """
        }

        if lower.contains("cannot find module") || lower.contains("node_modules") {
            return """
            ClaudeCN.app 包不完整，缺少运行所需文件。

            请从 GitHub Releases 下载完整的 ClaudeCN-macos.zip 或 DMG，不要只复制单个可执行文件。

            原始输出：
            \(detail)
            """
        }

        if detail.isEmpty {
            return "命令执行失败，退出码：\(status)。请打开日志查看详情。"
        }
        return "命令执行失败，退出码：\(status)。\n\n\(detail)"
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
