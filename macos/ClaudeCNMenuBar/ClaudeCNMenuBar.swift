import AppKit
import Foundation

struct ClaudeCNState {
    var status: String = "检测中"
    var version: String = "-"
    var isLocalized: Bool = false
    var isRunning: Bool = false
}

final class RoundedPanelView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.72, alpha: 0.96).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 22, yRadius: 22).fill()
    }
}

final class SeparatorView: NSView {
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: 1) }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.55, alpha: 0.55).setFill()
        dirtyRect.fill()
    }
}

final class DotView: NSView {
    var color = NSColor.systemGreen {
        didSet { needsDisplay = true }
    }

    override var intrinsicContentSize: NSSize { NSSize(width: 9, height: 9) }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)).fill()
    }
}

final class PanelViewController: NSViewController {
    var onRepatch: (() -> Void)?
    var onRestore: (() -> Void)?
    var onRefresh: (() -> Void)?
    var onQuit: (() -> Void)?

    private let versionLabel = NSTextField(labelWithString: "v0.0.3")
    private let statusValueLabel = NSTextField(labelWithString: "检测中")
    private let claudeVersionLabel = NSTextField(labelWithString: "-")
    private let dotView = DotView()
    private let repatchButton = NSButton(title: "重新汉化", target: nil, action: nil)
    private let restoreButton = NSButton(title: "恢复原版", target: nil, action: nil)
    private let refreshButton = NSButton(title: "刷新状态", target: nil, action: nil)
    private let quitButton = NSButton(title: "退出", target: nil, action: nil)

    override func loadView() {
        view = RoundedPanelView(frame: NSRect(x: 0, y: 0, width: 280, height: 340))
        view.translatesAutoresizingMaskIntoConstraints = false
        buildUI()
    }

    func update(_ state: ClaudeCNState) {
        statusValueLabel.stringValue = state.isRunning ? "处理中" : state.status
        claudeVersionLabel.stringValue = state.version
        dotView.color = state.isRunning ? .systemOrange : (state.isLocalized ? .systemGreen : .systemRed)
        repatchButton.isEnabled = !state.isRunning
        restoreButton.isEnabled = !state.isRunning
        refreshButton.isEnabled = !state.isRunning
    }

    private func buildUI() {
        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 0
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        root.addArrangedSubview(headerView())
        root.addArrangedSubview(SeparatorView())
        root.addArrangedSubview(statusView())
        root.addArrangedSubview(SeparatorView())
        root.addArrangedSubview(actionView())
        root.addArrangedSubview(SeparatorView())
        root.addArrangedSubview(authorView())
        root.addArrangedSubview(SeparatorView())
        root.addArrangedSubview(footerView())
    }

    private func headerView() -> NSView {
        let container = paddedContainer(top: 16, left: 16, bottom: 14, right: 16)
        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        pin(stack, to: container, top: 16, left: 16, bottom: 14, right: 16)

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: "globe.asia.australia.fill", accessibilityDescription: "ClaudeCN") ?? NSImage(systemSymbolName: "globe", accessibilityDescription: "ClaudeCN")
        icon.contentTintColor = .systemBlue
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 26),
            icon.heightAnchor.constraint(equalToConstant: 26)
        ])

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.spacing = 3

        let title = NSTextField(labelWithString: "Claude 汉化助手")
        title.font = .boldSystemFont(ofSize: 15)
        title.textColor = NSColor(calibratedWhite: 0.18, alpha: 1)

        versionLabel.font = .systemFont(ofSize: 11, weight: .medium)
        versionLabel.textColor = NSColor(calibratedWhite: 0.22, alpha: 1)

        textStack.addArrangedSubview(title)
        textStack.addArrangedSubview(versionLabel)

        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(textStack)
        return container
    }

    private func statusView() -> NSView {
        let container = paddedContainer(top: 16, left: 16, bottom: 16, right: 16)
        let grid = NSGridView()
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.rowSpacing = 10
        grid.columnSpacing = 10
        container.addSubview(grid)
        pin(grid, to: container, top: 16, left: 16, bottom: 16, right: 16)

        let statusTitle = rowTitle("状态")
        let versionTitle = rowTitle("版本")
        let statusStack = NSStackView()
        statusStack.orientation = .horizontal
        statusStack.alignment = .centerY
        statusStack.spacing = 6
        statusValueLabel.font = .systemFont(ofSize: 13, weight: .medium)
        statusValueLabel.alignment = .right
        statusStack.addArrangedSubview(dotView)
        statusStack.addArrangedSubview(statusValueLabel)

        claudeVersionLabel.font = .systemFont(ofSize: 13, weight: .medium)
        claudeVersionLabel.alignment = .right

        grid.addRow(with: [statusTitle, statusStack])
        grid.addRow(with: [versionTitle, claudeVersionLabel])
        grid.column(at: 0).xPlacement = .leading
        grid.column(at: 1).xPlacement = .trailing
        return container
    }

    private func actionView() -> NSView {
        let container = paddedContainer(top: 14, left: 16, bottom: 14, right: 16)
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        pin(stack, to: container, top: 14, left: 16, bottom: 14, right: 16)

        configurePrimaryButton(repatchButton, symbol: "arrow.clockwise.circle.fill", action: #selector(repatch))
        configurePrimaryButton(restoreButton, symbol: "arrow.uturn.backward.circle", action: #selector(restore))

        stack.addArrangedSubview(repatchButton)
        stack.addArrangedSubview(restoreButton)
        return container
    }

    private func authorView() -> NSView {
        let container = paddedContainer(top: 13, left: 16, bottom: 13, right: 16)
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 5
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        pin(stack, to: container, top: 13, left: 16, bottom: 13, right: 16)

        let author = smallCentered("作者：OneBigMoon")
        let thanks = smallCentered("致谢：Winhao学AI / Win-Hao/ClaudeCN")
        let free = smallCentered("本软件完全免费，不可商业化")
        free.textColor = .systemOrange
        let warn = smallCentered("付费获取即被骗，请举报")
        warn.textColor = .systemRed

        stack.addArrangedSubview(author)
        stack.addArrangedSubview(thanks)
        stack.addArrangedSubview(free)
        stack.addArrangedSubview(warn)
        return container
    }

    private func footerView() -> NSView {
        let container = paddedContainer(top: 12, left: 16, bottom: 12, right: 16)
        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.distribution = .equalSpacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        pin(stack, to: container, top: 12, left: 16, bottom: 12, right: 16)

        configureFooterButton(refreshButton, action: #selector(refresh))
        configureFooterButton(quitButton, action: #selector(quit))

        stack.addArrangedSubview(refreshButton)
        stack.addArrangedSubview(quitButton)
        return container
    }

    private func paddedContainer(top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat) -> NSView {
        let view = NSView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }

    private func pin(_ child: NSView, to parent: NSView, top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat) {
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: parent.topAnchor, constant: top),
            child.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: left),
            child.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -right),
            child.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -bottom)
        ])
    }

    private func rowTitle(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .boldSystemFont(ofSize: 14)
        label.textColor = NSColor(calibratedWhite: 0.18, alpha: 1)
        return label
    }

    private func smallCentered(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.alignment = .center
        label.textColor = NSColor(calibratedWhite: 0.22, alpha: 1)
        return label
    }

    private func configurePrimaryButton(_ button: NSButton, symbol: String, action: Selector) {
        button.target = self
        button.action = action
        button.font = .systemFont(ofSize: 14, weight: .bold)
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: button.title)
        button.imagePosition = .imageLeading
        button.contentTintColor = NSColor(calibratedWhite: 0.18, alpha: 1)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(equalToConstant: 38).isActive = true
    }

    private func configureFooterButton(_ button: NSButton, action: Selector) {
        button.target = self
        button.action = action
        button.font = .systemFont(ofSize: 12, weight: .bold)
        button.bezelStyle = .rounded
        button.controlSize = .regular
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 76).isActive = true
        button.heightAnchor.constraint(equalToConstant: 28).isActive = true
    }

    @objc private func repatch() { onRepatch?() }
    @objc private func restore() { onRestore?() }
    @objc private func refresh() { onRefresh?() }
    @objc private func quit() { onQuit?() }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private let panel = PanelViewController()
    private var state = ClaudeCNState()
    private let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ClaudeCN.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "ClaudeCN"
        statusItem.button?.image = NSImage(systemSymbolName: "globe.asia.australia.fill", accessibilityDescription: "ClaudeCN")
        statusItem.button?.imagePosition = .imageLeading
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePopover)
        statusItem.button?.toolTip = "Claude 汉化助手"

        panel.onRepatch = { [weak self] in self?.runApply() }
        panel.onRestore = { [weak self] in self?.runRestore() }
        panel.onRefresh = { [weak self] in self?.refreshStatus(showAlert: false) }
        panel.onQuit = { NSApp.terminate(nil) }

        popover.contentSize = NSSize(width: 280, height: 340)
        popover.behavior = .transient
        popover.delegate = self
        popover.contentViewController = panel

        refreshStatus(showAlert: false)
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            panel.update(state)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            refreshStatus(showAlert: false)
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
                self.panel.update(self.state)
                if showAlert { self.showAlert(title: "ClaudeCN 状态", message: output) }
            case .failure(let error):
                self.appendLog(error.localizedDescription)
                self.state.status = "检查失败"
                self.state.isLocalized = false
                self.state.isRunning = false
                self.panel.update(self.state)
                if showAlert { self.showAlert(title: "检查失败", message: error.localizedDescription) }
            }
        }
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
                self.panel.update(self.state)
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
                self.panel.update(self.state)
                self.showAlert(title: "恢复失败", message: error.localizedDescription)
            }
        }
    }

    private func setBusy(_ busy: Bool) {
        DispatchQueue.main.async {
            self.state.isRunning = busy
            self.panel.update(self.state)
            self.statusItem.button?.title = busy ? "ClaudeCN…" : "ClaudeCN"
        }
    }

    private func parseStatus(_ output: String) -> ClaudeCNState {
        var next = ClaudeCNState()
        for line in output.split(separator: "\n").map(String.init) {
            if line.contains("状态:") {
                next.status = line.components(separatedBy: "状态:").last?.trimmingCharacters(in: .whitespaces) ?? next.status
            }
            if line.contains("Claude 版本:") {
                next.version = line.components(separatedBy: "Claude 版本:").last?.trimmingCharacters(in: .whitespaces) ?? next.version
            }
        }
        next.isLocalized = next.status.contains("已汉化")
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

                let output: String
                if requiresAdmin {
                    output = try self.runWithAdmin(root: root, arguments: arguments)
                } else {
                    output = try self.runWithoutAdmin(root: root, arguments: arguments)
                }

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
        let node = bundledNodeURL().map { shellQuote($0.path) } ?? "/usr/bin/env node"
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
            alert.runModal()
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
            let detail = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if detail.isEmpty {
                return "命令执行失败，退出码：\(status)。"
            }
            return "命令执行失败，退出码：\(status)。\n\n\(detail)"
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
