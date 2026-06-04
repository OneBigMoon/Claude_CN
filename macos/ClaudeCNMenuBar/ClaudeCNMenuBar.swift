import AppKit
import Foundation
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var isRunning = false
    private var statusText = "待命"
    private let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ClaudeCNMenuBar.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "ClaudeCN"
        statusItem.button?.toolTip = "Claude Desktop 中文化菜单栏工具"

        rebuildMenu()
        refreshStatus(showAlert: false)
    }

    private func rebuildMenu() {
        let menu = NSMenu()

        let title = NSMenuItem(title: "ClaudeCN 菜单栏工具", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)

        let status = NSMenuItem(title: "状态：\(statusText)", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        menu.addItem(makeItem("一键汉化并重启 Claude", #selector(applyDefault), enabled: !isRunning))
        menu.addItem(makeItem("选择 Claude.app 后汉化…", #selector(chooseAndApply), enabled: !isRunning))
        menu.addItem(makeItem("检查汉化状态", #selector(checkStatus), enabled: !isRunning))
        menu.addItem(.separator())

        menu.addItem(makeItem("打开 Claude", #selector(openClaude), enabled: true))
        menu.addItem(makeItem("打开运行日志", #selector(openLog), enabled: true))
        menu.addItem(makeItem("打开项目主页", #selector(openProjectPage), enabled: true))
        menu.addItem(.separator())

        menu.addItem(makeItem("退出 ClaudeCN", #selector(quit), enabled: true))

        statusItem.menu = menu
        statusItem.button?.title = isRunning ? "ClaudeCN…" : "ClaudeCN"
    }

    private func makeItem(_ title: String, _ action: Selector?, enabled: Bool) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        item.isEnabled = enabled
        return item
    }

    @objc private func applyDefault() {
        runApply(appPath: nil)
    }

    @objc private func chooseAndApply() {
        let panel = NSOpenPanel()
        panel.title = "选择 Claude.app"
        panel.prompt = "选择"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.applicationBundle]

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        runApply(appPath: url.path)
    }

    @objc private func checkStatus() {
        refreshStatus(showAlert: true)
    }

    @objc private func openClaude() {
        NSWorkspace.shared.openApplication(
            at: URL(fileURLWithPath: "/Applications/Claude.app"),
            configuration: NSWorkspace.OpenConfiguration(),
            completionHandler: nil
        )
    }

    @objc private func openLog() {
        ensureLogDirectory()
        if !FileManager.default.fileExists(atPath: logURL.path) {
            appendLog("ClaudeCN 菜单栏工具日志已创建。")
        }
        NSWorkspace.shared.open(logURL)
    }

    @objc private func openProjectPage() {
        if let url = URL(string: "https://github.com/OneBigMoon/claude-desktop-cn") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func refreshStatus(showAlert: Bool) {
        setBusy(true, "检查中")
        runTool(arguments: ["status"], requiresAdmin: false) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let output):
                let summary = self.compactOutput(output)
                self.statusText = summary.contains("zh-CN") ? "中文已配置" : "已检测"
                self.appendLog(output)
                self.setBusy(false, self.statusText)
                if showAlert {
                    self.showAlert(title: "ClaudeCN 状态", message: summary)
                }
            case .failure(let error):
                self.statusText = "检查失败"
                self.appendLog(error.localizedDescription)
                self.setBusy(false, self.statusText)
                if showAlert {
                    self.showAlert(title: "检查失败", message: error.localizedDescription)
                }
            }
        }
    }

    private func runApply(appPath: String?) {
        let target = appPath ?? "/Applications/Claude.app"
        setBusy(true, "汉化中")

        var args = ["apply"]
        if let appPath {
            args.append(contentsOf: ["--app", appPath])
        }

        appendLog("开始汉化：\(target)")
        runTool(arguments: args, requiresAdmin: true) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let output):
                self.appendLog(output)
                self.statusText = "汉化完成"
                self.setBusy(false, self.statusText)
                self.showAlert(
                    title: "汉化完成",
                    message: "Claude 已重新打补丁、重签名并重启。\n\n\(self.compactOutput(output))"
                )
            case .failure(let error):
                self.appendLog(error.localizedDescription)
                self.statusText = "汉化失败"
                self.setBusy(false, self.statusText)
                self.showAlert(title: "汉化失败", message: error.localizedDescription)
            }
        }
    }

    private func setBusy(_ busy: Bool, _ status: String) {
        DispatchQueue.main.async {
            self.isRunning = busy
            self.statusText = status
            self.rebuildMenu()
        }
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

                DispatchQueue.main.async {
                    completion(.success(output))
                }
            } catch {
                DispatchQueue.main.async {
                    completion(.failure(error))
                }
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

    private func compactOutput(_ output: String) -> String {
        let lines = output
            .split(separator: "\n", omittingEmptySubsequences: true)
            .map(String.init)
        return lines.suffix(10).joined(separator: "\n")
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
