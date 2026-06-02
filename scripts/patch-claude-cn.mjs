#!/usr/bin/env node

import * as asar from "@electron/asar";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));

function readArg(name, fallback) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
}

const appPath = readArg("--app", process.env.CLAUDE_APP_PATH || "/Applications/Claude.app");
const restartAfterPatch = args.has("--restart");
const resourcesDir = path.join(appPath, "Contents", "Resources");
const assetsDir = path.join(resourcesDir, "ion-dist", "assets", "v1");
const i18nDir = path.join(resourcesDir, "ion-dist", "i18n");
const appAsarPath = path.join(resourcesDir, "app.asar");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "");
const backupDir = path.join(os.homedir(), "Library", "Application Support", "Claude_CN", "backups", stamp);

function log(message) {
  console.log(`[Claude_CN] ${message}`);
}

function ensureFile(file) {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`目录不存在：${dir}`);
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const rel = path.relative(appPath, file);
  const safeName = (rel.startsWith("..") ? file : rel).replaceAll(path.sep, "__").replace(/^_+/, "");
  fs.copyFileSync(file, path.join(backupDir, safeName));
}

function replaceText(text, replacements, label) {
  let changed = 0;
  for (const [from, to] of replacements) {
    const count = text.split(from).length - 1;
    if (count > 0) {
      text = text.split(from).join(to);
      changed += count;
      log(`${label}: ${count} 处替换`);
    } else if (!text.includes(to)) {
      log(`${label}: 未命中 ${from.slice(0, 80)}`);
    }
  }
  return { text, changed };
}

function patchFile(file, replacements) {
  ensureFile(file);
  backup(file);
  const original = fs.readFileSync(file, "utf8");
  const { text, changed } = replaceText(original, replacements, path.basename(file));
  if (changed > 0) fs.writeFileSync(file, text);
  return changed;
}

function jsFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(dir, name));
}

function patchAssets(replacements, groupName) {
  let total = 0;
  for (const file of jsFiles(assetsDir)) {
    const source = fs.readFileSync(file, "utf8");
    if (!replacements.some(([from, to]) => source.includes(from) || source.includes(to))) continue;
    total += patchFile(file, replacements);
  }
  log(`${groupName}: 共替换 ${total} 处`);
}

function installZhCnJson() {
  const source = path.join(repoRoot, "data", "zh-CN.json");
  const target = path.join(i18nDir, "zh-CN.json");
  ensureFile(source);
  ensureFile(target);
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  backup(target);
  fs.writeFileSync(target, JSON.stringify(parsed, null, 2) + "\n");
  log(`已更新 ${target}`);
}

const infoPlistStrings = {
  "NSCameraUsageDescription": "Claude 需要访问摄像头。",
  "NSMicrophoneUsageDescription": "Claude 需要访问麦克风以进行语音听写。",
  "NSSpeechRecognitionUsageDescription": "Claude 需要访问语音识别以进行语音听写。",
  "NSAudioCaptureUsageDescription": "Claude 需要访问音频捕获功能。",
  "NSBluetoothAlwaysUsageDescription": "Claude 使用蓝牙连接硬件配件。",
  "NSBluetoothPeripheralUsageDescription": "Claude 需要访问蓝牙。",
  "NSDesktopFolderUsageDescription": "Claude 需要访问桌面文件夹以处理其中的文件。",
  "NSDocumentsFolderUsageDescription": "Claude 会在这里存储计划任务、实时 Artifact 和其他 Cowork 文件。",
  "NSDownloadsFolderUsageDescription": "Claude 需要访问下载文件夹以处理其中的文件。",
  "All Files": "所有文件",
  "Folder": "文件夹",
  "Skill File": "技能文件",
  "Desktop Extension": "桌面扩展"
};

function escapeStringsValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function installInfoPlistStrings() {
  const body = Object.entries(infoPlistStrings)
    .map(([key, value]) => `"${escapeStringsValue(key)}" = "${escapeStringsValue(value)}";`)
    .join("\n") + "\n";
  for (const locale of ["zh-CN.lproj", "zh_CN.lproj"]) {
    const dir = path.join(resourcesDir, locale);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "InfoPlist.strings");
    backup(file);
    fs.writeFileSync(file, body);
    execFileSync("plutil", ["-lint", file], { stdio: "ignore" });
    log(`已写入 ${file}`);
  }
}

function patchRendererAssets() {
  patchAssets([
    ["const c=await l.json();return", "const c=await l.json();try{c.locale=\"zh-CN\",delete c.gated_messages}catch{}return"],
    ["FNt={gateway:\"Gateway\",anthropic:\"Anthropic API\",bedrock:\"Bedrock\",vertex:\"Vertex AI\",foundry:\"Foundry\"}", "FNt={gateway:\"网关\",anthropic:\"Anthropic API\",bedrock:\"Bedrock\",vertex:\"Vertex AI\",foundry:\"Foundry\"}"],
    ["label:\"Chat\",ariaLabel:\"Chat\"", "label:\"聊天\",ariaLabel:\"聊天\""],
    ["label:\"Cowork\",ariaLabel:\"Cowork\"", "label:\"协作\",ariaLabel:\"协作\""],
    ["label:\"Code\",ariaLabel:\"Code\"", "label:\"代码\",ariaLabel:\"代码\""],
    ["$a={chat:{mode:\"chat\",icon:\"Chats\",label:\"Chat\"},cowork:{mode:\"cowork\",icon:\"Tasks\",label:\"Cowork\"},code:{mode:\"code\",icon:\"Code\",label:\"Code\"}}", "$a={chat:{mode:\"chat\",icon:\"Chats\",label:\"聊天\"},cowork:{mode:\"cowork\",icon:\"Tasks\",label:\"协作\"},code:{mode:\"code\",icon:\"Code\",label:\"代码\"}}"]
  ], "模式和网关");

  patchAssets([
    ["rp={chat:\"New chat\",cowork:\"New task\",code:\"New session\"}", "rp={chat:\"新聊天\",cowork:\"新任务\",code:\"新会话\"}"],
    ["ip=\"Untitled\"", "ip=\"未命名\""],
    ["lp=\"Recents\"", "lp=\"最近使用\""],
    ["const n=e?\"Release\":t?\"Drop here\":\"Drag to pin\"", "const n=e?\"松开\":t?\"放到这里\":\"拖动以固定\""],
    ["children:[\"View all\",Bo.jsx(Ht,{name:\"CaretRight\",size:\"xsmall\"})]", "children:[\"查看全部\",Bo.jsx(Ht,{name:\"CaretRight\",size:\"xsmall\"})]"],
    ["label:\"Projects\",modes:[\"chat\",\"cowork\"]", "label:\"项目\",modes:[\"chat\",\"cowork\"]"],
    ["label:\"Scheduled\",gate:\"scheduled\",modes:[\"cowork\",\"code\"]", "label:\"计划任务\",gate:\"scheduled\",modes:[\"cowork\",\"code\"]"],
    ["label:\"Live artifacts\",gate:\"cowork-artifacts\",modes:[\"cowork\"]", "label:\"实时内容\",gate:\"cowork-artifacts\",modes:[\"cowork\"]"],
    ["label:\"Board\",badge:\"lab\"", "label:\"看板\",badge:\"lab\""],
    ["label:\"Pull Requests\",badge:\"lab\"", "label:\"拉取请求\",badge:\"lab\""],
    ["label:\"Dispatch\",badge:\"beta\",gate:\"dispatch\",modes:[\"cowork\"]", "label:\"派发\",badge:\"beta\",gate:\"dispatch\",modes:[\"cowork\"]"],
    ["label:\"Dispatch\",badge:\"beta\",gate:\"dispatch-code\",modes:[\"code\"]", "label:\"派发\",badge:\"beta\",gate:\"dispatch-code\",modes:[\"code\"]"],
    ["label:\"Ideas\",gate:\"ant-only\"", "label:\"想法\",gate:\"ant-only\""],
    ["label:\"Artifacts\",gate:\"artifacts\"", "label:\"制品\",gate:\"artifacts\""],
    ["label:\"Ask your org\",gate:\"haystack\"", "label:\"询问组织\",gate:\"haystack\""],
    ["const zu=\"Scheduled\"", "const zu=\"计划任务\""],
    ["const Vp=\"__no_project__\",Qp=\"Other\",Gp=\"__no_homespace__\",Wp=\"No homespace\"", "const Vp=\"__no_project__\",Qp=\"其他\",Gp=\"__no_homespace__\",Wp=\"无工作空间\""],
    ["const Zp=[\"open\",\"draft\",\"merged\",\"closed\",\"none\"],Xp={open:\"Open\",draft:\"Draft\",queued:\"Open\",merged:\"Merged\",closed:\"Closed\",none:\"No PR\"}", "const Zp=[\"open\",\"draft\",\"merged\",\"closed\",\"none\"],Xp={open:\"打开\",draft:\"草稿\",queued:\"打开\",merged:\"已合并\",closed:\"已关闭\",none:\"无 PR\"}"],
    ["const nh=[\"local\",\"remote\",\"bridge\"],sh={local:\"Local\",remote:\"Cloud\",bridge:\"Remote Control\"}", "const nh=[\"local\",\"remote\",\"bridge\"],sh={local:\"本地\",remote:\"云端\",bridge:\"远程控制\"}"],
    ["label:\"Ungrouped\",sessions:l", "label:\"未分组\",sessions:l"],
    ["const s=0===c?\"Today\":1===c?\"Yesterday\":n.formatDate(o-c*bp,{month:\"short\",day:\"numeric\"});", "const s=0===c?\"今天\":1===c?\"昨天\":n.formatDate(o-c*bp,{month:\"short\",day:\"numeric\"});"],
    ["i.push({key:\"older\",label:\"Older\",sessions:a.slice(0,t)})", "i.push({key:\"older\",label:\"更早\",sessions:a.slice(0,t)})"],
    [",\"Home\"]}),O.map", ",\"主页\"]}),O.map"],
    ["\"aria-label\":`New session in ${a}`", "\"aria-label\":`在 ${a} 中新建会话`"]
  ], "侧栏和分组");

  patchAssets([
    ["SGt={nextRun:\"Next run\",name:\"Name\"}", "SGt={nextRun:\"下次运行\",name:\"名称\"}"],
    ["label:\"Daily brief\",prompt:\"Set up a scheduled task that gives me a morning brief each weekday: what's on my calendar, important unread emails, and anything that needs my attention today.\"", "label:\"每日简报\",prompt:\"设置一个计划任务，在每个工作日早晨为我生成简报：今天的日程、重要未读邮件，以及需要我注意的事项。\""],
    ["label:\"Email digest\",prompt:\"Set up a scheduled task that summarizes my new emails once a day and flags anything that needs a reply.\"", "label:\"邮件摘要\",prompt:\"设置一个计划任务，每天汇总我的新邮件，并标记需要回复的内容。\""],
    ["label:\"Meeting prep\",prompt:\"Set up a scheduled task that preps me for tomorrow's meetings each evening, with context on attendees and agenda items.\"", "label:\"会议准备\",prompt:\"设置一个计划任务，每天晚上为我准备明天会议的资料，包括参会者和议程背景。\""],
    ["label:\"Weekly review\",prompt:\"Set up a scheduled task that reviews what I worked on each week and drafts a short status update.\"", "label:\"每周回顾\",prompt:\"设置一个计划任务，每周回顾我的工作内容，并起草一份简短状态更新。\""],
    ["e?\"Completed\":\"Paused\"", "e?\"已完成\":\"已暂停\""],
    ["title:\"Scheduled tasks\"", "title:\"计划任务\""],
    ["children:\"Run tasks on a schedule or whenever you need them. Type /schedule in any existing task to set one up.\"", "children:\"按计划或在需要时运行任务。在任何现有任务中输入 /schedule 即可设置。\""],
    ["\"aria-label\":\"Sort by\"", "\"aria-label\":\"排序方式\""],
    ["placeholder:\"Filter scheduled tasks\"", "placeholder:\"筛选计划任务\""],
    ["label:\"New task\",items:[{label:\"Create with Claude\"", "label:\"新任务\",items:[{label:\"使用 Claude 创建\""],
    ["{label:\"Set up manually\",icon:\"Settings\"", "{label:\"手动设置\",icon:\"Settings\""],
    ["children:\"No scheduled tasks match your search.\"", "children:\"没有匹配的计划任务。\""],
    ["\"Create your first scheduled task\"", "\"创建你的第一个计划任务\""],
    ["children:[\"More ideas\",t.jsx(RGt,{source:\"scheduled_task_more_ideas\"})]", "children:[\"更多想法\",t.jsx(RGt,{source:\"scheduled_task_more_ideas\"})]"]
  ], "计划任务页");

  patchAssets([
    ["const Xe=\"New project\",Qe={yours:\"Your projects\",team:\"Team\",shared:\"Shared with you\"},Ve={yours:\"You don't have any projects yet.\",team:\"No team projects yet.\",shared:\"No projects have been shared with you.\"},Ze=", "const Xe=\"新项目\",Qe={yours:\"你的项目\",team:\"团队\",shared:\"与你共享\"},Ve={yours:\"你还没有任何项目。\",team:\"还没有团队项目。\",shared:\"还没有与你共享的项目。\"},Ze="],
    ["He={recent:\"Recent\",created:\"Created\",alphabetical:\"Alphabetical\"}", "He={recent:\"最近\",created:\"创建时间\",alphabetical:\"字母顺序\"}"],
    ["function Je(e){return e.name||\"Untitled\"}", "function Je(e){return e.name||\"未命名\"}"],
    ["function tt(e){return\"chatProject\"===e.kind?\"Chat project\":\"Space\"}", "function tt(e){return\"chatProject\"===e.kind?\"聊天项目\":\"空间\"}"],
    ["\"aria-label\":\"Project actions\"", "\"aria-label\":\"项目操作\""],
    ["children:\"No projects match your search.\"", "children:\"没有匹配的项目。\""],
    ["headline:\"Looking to start a project?\",description:M?\"Point Claude at a folder on your machine and work on it together.\":\"Upload materials, set custom instructions, and organize conversations in one space.\"", "headline:\"想开始一个项目吗？\",description:M?\"选择你机器上的一个文件夹，让 Claude 和你一起处理。\":\"上传资料、设置自定义说明，并在一个空间中整理对话。\""],
    ["title:\"Projects\"", "title:\"项目\""],
    ["placeholder:\"Search projects\"", "placeholder:\"搜索项目\""],
    ["children:\"Shared\"", "children:\"已共享\""]
  ], "项目页");

  patchAssets([
    ["The Little Prince", "《小王子》"],
    ["Animal Farm", "《动物农场》"],
    ["The Great Gatsby", "《了不起的盖茨比》"],
    ["Harry Potter and the Sorcerer's Stone", "《哈利·波特与魔法石》"],
    ["The Hobbit", "《霍比特人》"],
    ["Pride and Prejudice", "《傲慢与偏见》"],
    ["Dune", "《沙丘》"],
    ["Moby Dick", "《白鲸》"],
    ["The Lord of the Rings", "《指环王》"],
    ["War and Peace", "《战争与和平》"]
  ], "示例书名");
}

function updatePlistIntegrity(hash) {
  const plists = [
    path.join(appPath, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", "Claude Helper.app", "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", "Claude Helper (Renderer).app", "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", "Claude Helper (GPU).app", "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", "Claude Helper (Plugin).app", "Contents", "Info.plist")
  ];
  for (const plist of plists) {
    ensureFile(plist);
    backup(plist);
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`, plist]);
    execFileSync("plutil", ["-lint", plist], { stdio: "ignore" });
  }
  log(`已更新 ElectronAsarIntegrity: ${hash}`);
}

async function patchAsarMainProcess() {
  ensureFile(appAsarPath);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cn-asar-"));
  const extractDir = path.join(tmpRoot, "extract");
  const newAsar = path.join(tmpRoot, "app.asar");
  asar.extractAll(appAsarPath, extractDir);
  const mainFile = path.join(extractDir, ".vite", "build", "index.js");
  patchFile(mainFile, [
    ["label:\"Enable Main Process Debugger\"", "label:\"启用主进程调试器\""],
    ["label:\"Record Performance Trace\"", "label:\"记录性能跟踪\""],
    ["label:\"Write Main Process Heap Snapshot\"", "label:\"写入主进程堆快照\""],
    ["label:\"Record Memory Trace (auto-stop)\"", "label:\"记录内存跟踪（自动停止）\""],
    ["{role:\"minimize\"}", "{role:\"minimize\",label:\"最小化\"}"],
    ["{role:\"front\"}", "{role:\"front\",label:\"全部置于前台\"}"],
    ["{role:\"services\"}", "{role:\"services\",label:\"服务\"}"],
    ["{role:\"hide\"}", "{role:\"hide\",label:\"隐藏 Claude\"}"],
    ["{role:\"hideOthers\"}", "{role:\"hideOthers\",label:\"隐藏其他\"}"],
    ["{role:\"unhide\"}", "{role:\"unhide\",label:\"显示全部\"}"]
  ]);
  await asar.createPackageWithOptions(extractDir, newAsar, {
    unpack: "{**/*.node,**/spawn-helper}"
  });
  const { headerString } = asar.getRawHeader(newAsar);
  const hash = crypto.createHash("sha256").update(headerString).digest("hex");
  backup(appAsarPath);
  fs.copyFileSync(newAsar, appAsarPath);
  updatePlistIntegrity(hash);
  log("已重打包 app.asar");
}

function clearRendererCaches() {
  for (const base of ["Claude-3p", "Claude"]) {
    const dir = path.join(os.homedir(), "Library", "Application Support", base);
    for (const rel of ["Cache", "Code Cache", "GPUCache", path.join("Service Worker", "CacheStorage")]) {
      fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    }
  }
}

function restartClaude() {
  clearRendererCaches();
  try {
    execFileSync("osascript", ["-e", "tell application \"Claude\" to quit"], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("pkill", ["-x", "Claude"], { stdio: "ignore" });
  } catch {}
  execFileSync("open", [appPath]);
  log("已重启 Claude");
}

async function main() {
  ensureDir(appPath);
  ensureDir(resourcesDir);
  ensureDir(assetsDir);
  ensureDir(i18nDir);
  installZhCnJson();
  installInfoPlistStrings();
  patchRendererAssets();
  await patchAsarMainProcess();
  log(`备份目录：${backupDir}`);
  if (restartAfterPatch) restartClaude();
  else log("补丁完成。请重启 Claude 让修改生效。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
