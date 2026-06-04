#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const patchScript = path.join(repoRoot, "scripts", "patch-claude-cn.mjs");
const defaultApp = "/Applications/Claude.app";
const compatibleClaudeDesktopVersions = [
  { label: "1.10628.x", prefix: "1.10628." }
];
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

function claudeAppVersion(app) {
  const infoPlist = path.join(app, "Contents", "Info.plist");
  if (!fs.existsSync(infoPlist)) return "";
  return readPlistValue(infoPlist, "CFBundleShortVersionString") || readPlistValue(infoPlist, "CFBundleVersion");
}

function compatibleVersionText() {
  return compatibleClaudeDesktopVersions.map((item) => item.label).join(", ");
}

function compatibilityForVersion(version) {
  if (!version) return { supported: false, text: "未知版本" };
  const matched = compatibleClaudeDesktopVersions.find((item) => version.startsWith(item.prefix));
  return matched
    ? { supported: true, text: `已适配 ${matched.label}` }
    : { supported: false, text: `未适配 ${version}` };
}

function status() {
  const app = resolveClaudeApp();
  const resources = path.join(app, "Contents", "Resources");
  const zhResource = path.join(resources, "ion-dist", "i18n", "zh-CN.json");
  const desktopZhResource = path.join(resources, "zh-CN.json");
  const appVersion = claudeAppVersion(app);
  const compatibility = compatibilityForVersion(appVersion);
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
  log(`兼容版本: ${compatibleVersionText()}`);
  log(`兼容状态: ${compatibility.text}`);
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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function forceZhCnLocaleConfigs() {
  for (const name of ["Claude", "Claude-3p"]) {
    const file = path.join(os.homedir(), "Library", "Application Support", name, "config.json");
    const data = readJson(file) || {};
    data.locale = "zh-CN";
    delete data.language;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function apply() {
  const app = resolveClaudeApp();
  if (!fs.existsSync(app)) die(`找不到 Claude.app：${app}\n可使用 --app /path/to/Claude.app 指定路径。`);
  const appVersion = claudeAppVersion(app);
  const compatibility = compatibilityForVersion(appVersion);
  const force = args.includes("--force");
  if (!compatibility.supported && !force) {
    die(`当前 Claude Desktop 版本不在已适配范围内。\n当前版本：${appVersion || "未知"}\n已适配版本：${compatibleVersionText()}\n\n为避免 Claude 更新后结构变化导致汉化不完整或应用损坏，已停止执行。\n如果你确认要强制尝试，可添加 --force。`);
  }
  log(`开始一键汉化：${app}`);
  log(`Claude Desktop 版本：${appVersion || "未知"}（${compatibility.text}${force && !compatibility.supported ? "，已强制继续" : ""}）`);
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
  if (running) {
    sleep(1200);
    forceZhCnLocaleConfigs();
  }
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

function removeIfExists(file) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { recursive: true, force: true });
    log(`已移除：${file}`);
  }
}

function cleanBundleRootJunk(app) {
  for (const name of ["var", "tmp", ".DS_Store"]) {
    const target = path.join(app, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    log(`已清理 bundle 临时项：${target}`);
  }
}

function removePatchedLocaleFiles(app) {
  const resources = path.join(app, "Contents", "Resources");
  const files = [
    path.join(resources, "ion-dist", "i18n", "zh-CN.json"),
    path.join(resources, "ion-dist", "i18n", "zh-CN.json.zst"),
    path.join(resources, "ion-dist", "i18n", "zh-CN.overrides.json"),
    path.join(resources, "ion-dist", "i18n", "zh-CN.overrides.json.zst"),
    path.join(resources, "ion-dist", "i18n", "statsig", "zh-CN.json"),
    path.join(resources, "ion-dist", "i18n", "statsig", "zh-CN.json.zst"),
    path.join(resources, "zh-CN.json"),
    path.join(resources, "zh-CN.lproj"),
    path.join(resources, "zh_CN.lproj")
  ];
  for (const file of files) removeIfExists(file);
}

function resetLocaleConfigs() {
  for (const name of ["Claude", "Claude-3p"]) {
    const file = path.join(os.homedir(), "Library", "Application Support", name, "config.json");
    const data = readJson(file);
    if (!data) continue;
    if (data.locale || data.language) {
      data.locale = "en-US";
      delete data.language;
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      log(`已恢复语言配置：${file}`);
    }
  }
  let removedAppleLanguages = false;
  for (const domain of ["com.anthropic.claudefordesktop", "com.anthropic.Claude"]) {
    try {
      execFileSync("defaults", ["delete", domain, "AppleLanguages"], { stdio: "ignore" });
      removedAppleLanguages = true;
    } catch {}
  }
  if (removedAppleLanguages) log("已移除 macOS Claude AppleLanguages 覆盖。");
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

  removePatchedLocaleFiles(app);
  resetLocaleConfigs();
  cleanBundleRootJunk(app);

  try {
    spawnSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  } catch {}
  try {
    spawnSync("xattr", ["-dr", "com.apple.quarantine", app], { stdio: "ignore" });
  } catch {}

  log(`已恢复 ${restoredCount} 个备份文件，并清理中文资源/语言配置。`);
  activateClaude(app);
  log("已恢复并打开 Claude。");
}

function help() {
  console.log(`Claude_CN 一键工具\n\n已适配 Claude Desktop：${compatibleVersionText()}\n\n用法：\n  npm run cn                 一键汉化并自动重启 Claude\n  npm run cn -- apply        同上\n  npm run cn -- status       查看安装/语言状态\n  npm run cn -- restore      从最近一次备份恢复原版\n  npm run cn -- open         打开并置顶 Claude\n\n选项：\n  --app /Applications/Claude.app    指定 Claude.app 路径\n  --backup /path/to/backup          指定恢复备份目录\n  --force                           当前 Claude 版本未适配时仍强制尝试\n  --cleanup-static-cn               清理旧版静态汉化残留\n  --static-cn                       强制静态中文（不推荐，会影响英文模式）\n`);
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
