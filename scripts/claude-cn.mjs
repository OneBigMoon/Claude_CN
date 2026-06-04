#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const patchScript = path.join(repoRoot, "scripts", "patch-claude-cn.mjs");
const defaultApp = "/Applications/Claude.app";
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "apply";

function log(message) {
  console.log(`[Claude_CN] ${message}`);
}

function die(message, code = 1) {
  console.error(`[Claude_CN] ${message}`);
  process.exit(code);
}

function argValue(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const match = args.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function resolveClaudeApp() {
  const explicit = argValue("--app") || process.env.CLAUDE_APP;
  if (explicit) return explicit;
  if (fs.existsSync(defaultApp)) return defaultApp;
  try {
    const found = execFileSync("mdfind", ["kMDItemCFBundleIdentifier == 'com.anthropic.claudefordesktop'"], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return found;
  } catch {}
  return defaultApp;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readPlistValue(file, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, file], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function status() {
  const app = resolveClaudeApp();
  const resources = path.join(app, "Contents", "Resources");
  const zhResource = path.join(resources, "ion-dist", "i18n", "zh-CN.json");
  const desktopZhResource = path.join(resources, "zh-CN.json");
  const infoPlist = path.join(app, "Contents", "Info.plist");
  const appVersion = fs.existsSync(infoPlist)
    ? readPlistValue(infoPlist, "CFBundleShortVersionString") || readPlistValue(infoPlist, "CFBundleVersion")
    : "";
  const configs = ["Claude", "Claude-3p"].map((name) => {
    const file = path.join(os.homedir(), "Library", "Application Support", name, "config.json");
    const data = readJson(file);
    return { name, file, locale: data?.locale || "未设置" };
  });
  const localized = fs.existsSync(zhResource)
    && fs.existsSync(desktopZhResource)
    && configs.some((config) => String(config.locale).toLowerCase().startsWith("zh"));
  log(`Claude.app: ${fs.existsSync(app) ? app : `${app}（未找到）`}`);
  log(`状态: ${localized ? "已汉化" : "未汉化"}`);
  log(`Claude 版本: ${appVersion || "未知"}`);
  log(`中文 i18n: ${fs.existsSync(zhResource) ? "已安装" : "未安装"}`);
  log(`桌面中文资源: ${fs.existsSync(desktopZhResource) ? "已安装" : "未安装"}`);
  for (const config of configs) log(`${config.name} locale: ${config.locale}`);
}

function activateClaude(app) {
  try {
    execFileSync("open", ["-a", app], { stdio: "ignore" });
  } catch {
    try { execFileSync("open", [app], { stdio: "ignore" }); } catch {}
  }
  try {
    execFileSync("osascript", ["-e", "tell application \"Claude\" to activate"], { stdio: "ignore" });
  } catch {}
}

function waitForClaude() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = spawnSync("pgrep", ["-x", "Claude"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return false;
}

function quitClaude() {
  try {
    execFileSync("osascript", ["-e", "tell application \"Claude\" to quit"], { stdio: "ignore" });
  } catch {}
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = spawnSync("pgrep", ["-x", "Claude"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  try {
    execFileSync("killall", ["Claude"], { stdio: "ignore" });
  } catch {}
}

function apply() {
  const app = resolveClaudeApp();
  if (!fs.existsSync(app)) die(`找不到 Claude.app：${app}\n可使用 --app /path/to/Claude.app 指定路径。`);
  log(`开始一键汉化：${app}`);
  log("将自动备份、注入 zh-CN、重打包、重签名、重启 Claude。英文模式保持原版英文。");
  const passthrough = args.filter((item, index) => {
    if (item === "--app") return false;
    if (args[index - 1] === "--app") return false;
    if (item.startsWith("--app=")) return false;
    return true;
  });
  const result = spawnSync(process.execPath, [patchScript, "--restart", "--app", app, ...passthrough], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  activateClaude(app);
  const running = waitForClaude();
  log(running ? "Claude 已重启并置于前台，可以直接查看汉化效果。" : "补丁完成，但未检测到 Claude 进程；请手动打开 Claude 查看效果。");
}

function backupsRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "Claude_CN", "backups");
}

function latestBackup() {
  const root = backupsRoot();
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((file) => fs.statSync(file).isDirectory())
    .sort()
    .at(-1) || "";
}

function backupTargetForFile(app, backupFile) {
  const name = path.basename(backupFile);
  const restored = name.split("__").join(path.sep);
  if (restored.startsWith(`Contents${path.sep}`)) return path.join(app, restored);
  if (restored.startsWith(`Users${path.sep}`)) return path.join(path.sep, restored);
  if (restored.startsWith(`Applications${path.sep}`)) return path.join(path.sep, restored);
  return path.join(app, restored);
}

function restore() {
  const app = resolveClaudeApp();
  const backup = argValue("--backup") || latestBackup();
  if (!backup || !fs.existsSync(backup)) die("没有找到可恢复的备份。请先成功执行过一次汉化。");
  if (!fs.existsSync(app)) die(`找不到 Claude.app：${app}\n可使用 --app /path/to/Claude.app 指定路径。`);

  log(`准备恢复原版：${app}`);
  log(`使用备份目录：${backup}`);
  quitClaude();

  let restoredCount = 0;
  for (const entry of fs.readdirSync(backup)) {
    const source = path.join(backup, entry);
    if (!fs.statSync(source).isFile()) continue;
    const target = backupTargetForFile(app, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    restoredCount += 1;
  }

  try {
    spawnSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  } catch {}
  try {
    spawnSync("xattr", ["-dr", "com.apple.quarantine", app], { stdio: "ignore" });
  } catch {}

  log(`已恢复 ${restoredCount} 个文件。`);
  activateClaude(app);
  log("已恢复并打开 Claude。");
}

function help() {
  console.log(`Claude_CN 一键工具\n\n用法：\n  npm run cn                 一键汉化并自动重启 Claude\n  npm run cn -- apply        同上\n  npm run cn -- status       查看安装/语言状态\n  npm run cn -- restore      从最近一次备份恢复原版\n  npm run cn -- open         打开并置顶 Claude\n\n选项：\n  --app /Applications/Claude.app    指定 Claude.app 路径\n  --backup /path/to/backup          指定恢复备份目录\n  --cleanup-static-cn               清理旧版静态汉化残留\n  --static-cn                       强制静态中文（不推荐，会影响英文模式）\n`);
}

switch (command) {
  case "apply":
  case "patch":
  case "install":
  case "cn":
    apply();
    break;
  case "status":
    status();
    break;
  case "restore":
  case "revert":
    restore();
    break;
  case "open":
  case "show":
    activateClaude(resolveClaudeApp());
    log("已打开 Claude。");
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    die(`未知命令：${command}\n运行 npm run cn -- help 查看用法。`);
}
