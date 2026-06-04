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

function status() {
  const app = resolveClaudeApp();
  const resources = path.join(app, "Contents", "Resources");
  const zhResource = path.join(resources, "ion-dist", "i18n", "zh-CN.json");
  const desktopZhResource = path.join(resources, "zh-CN.json");
  const configs = ["Claude", "Claude-3p"].map((name) => {
    const file = path.join(os.homedir(), "Library", "Application Support", name, "config.json");
    const data = readJson(file);
    return { name, file, locale: data?.locale || "未设置" };
  });
  log(`Claude.app: ${fs.existsSync(app) ? app : `${app}（未找到）`}`);
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

function help() {
  console.log(`Claude_CN 一键工具\n\n用法：\n  npm run cn                 一键汉化并自动重启 Claude\n  npm run cn -- apply        同上\n  npm run cn -- status       查看安装/语言状态\n  npm run cn -- open         打开并置顶 Claude\n\n选项：\n  --app /Applications/Claude.app    指定 Claude.app 路径\n  --cleanup-static-cn               清理旧版静态汉化残留\n  --static-cn                       强制静态中文（不推荐，会影响英文模式）\n`);
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
