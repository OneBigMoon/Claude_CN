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

function cleanBundleRootJunk() {
  for (const name of ["var", "tmp", ".DS_Store"]) {
    const target = path.join(appPath, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    log(`已清理 bundle 临时项: ${target}`);
  }
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

function patchAssetsSilently(replacements, groupName, shouldPatchFile = () => true) {
  let total = 0;
  for (const file of jsFiles(assetsDir)) {
    let source = fs.readFileSync(file, "utf8");
    if (!shouldPatchFile(file, source)) continue;
    if (!replacements.some(([from, to]) => source.includes(from) || source.includes(to))) continue;
    backup(file);
    let changed = 0;
    for (const [from, to] of replacements) {
      const count = source.split(from).length - 1;
      if (count > 0) {
        source = source.split(from).join(to);
        changed += count;
      }
    }
    if (changed > 0) {
      fs.writeFileSync(file, source);
      total += changed;
    }
  }
  log(`${groupName}: 共替换 ${total} 处`);
}

function decodeJsStringContent(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function escapeUnicodeForJs(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function stringVariants(value) {
  const variants = new Set([value]);
  variants.add(decodeJsStringContent(value));
  variants.add(value.replaceAll("\\u2019", "’").replaceAll("\\u2014", "—").replaceAll("\\u2026", "…"));
  variants.add(value.replaceAll("’", "\\u2019").replaceAll("—", "\\u2014").replaceAll("…", "\\u2026"));
  return [...variants].filter(Boolean);
}

function literalVariants(value) {
  const literals = new Set();
  for (const variant of stringVariants(value)) {
    literals.add(JSON.stringify(variant));
    literals.add(escapeUnicodeForJs(variant));
  }
  return [...literals];
}

function translationForMessage(message, dictionary = currentVersionTranslations) {
  for (const variant of stringVariants(message)) {
    if (Object.prototype.hasOwnProperty.call(dictionary, variant)) return dictionary[variant];
  }
  return undefined;
}

function currentVersionDictionary() {
  return {
    ...currentVersionTranslations,
    ...currentVersionLiteralTranslations
  };
}

function mergeTranslations(base, overlay) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return overlay;
  const merged = { ...base };
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return merged;
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeTranslations(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function writeJson(file, value) {
  backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function maybeWriteZstdJson(jsonFile) {
  try {
    execFileSync("zstd", ["-q", "-f", jsonFile, "-o", `${jsonFile}.zst`], { stdio: "ignore" });
    log(`已生成 ${jsonFile}.zst`);
  } catch {}
}

const currentVersionTranslations = {
  "About Claude": "关于 Claude",
  "About these usage estimates": "关于这些用量估算",
  "Account": "账号",
  "Account menu": "账号菜单",
  "Add or change seats": "添加或更改席位",
  "All": "全部",
  "All Projects": "全部项目",
  "Appearance": "外观",
  "Accept edits": "接受编辑",
  "Active days": "活跃天数",
  "Add another folder": "添加另一个文件夹",
  "Ask about pricing, security, or what plan fits": "询问价格、安全性或适合的方案",
  "Attach file": "附加文件",
  "Available": "可用",
  "Billing address": "账单地址",
  "Billing period": "账单周期",
  "Cancel": "取消",
  "Chat": "聊天",
  "Claude Code": "Claude Code",
  "Code": "代码",
  "Code notifications": "代码通知",
  "Code permission requests": "代码权限请求",
  "Collaborate with your team with shared projects and centralized billing.": "通过共享项目和集中账单与你的团队协作。",
  "Confirm & purchase": "确认并购买",
  "Connectors": "连接器",
  "Continue to Team checkout": "继续到团队结账",
  "Cowork": "协作",
  "Create": "创建",
  "Created": "已创建",
  "Current streak": "当前连续天数",
  "Customize": "自定义",
  "Current seats": "当前席位",
  "Date created": "创建日期",
  "Delete": "删除",
  "Delete project": "删除项目",
  "Delete project?": "删除项目？",
  "Delete routine": "删除例程",
  "Delete scheduled task": "删除计划任务",
  "Delete secret": "删除密钥",
  "Delete {name}? This can't be undone.": "删除 {name}？此操作无法撤销。",
  "Direct terminal integration with your dev tools": "与你的开发工具直接进行终端集成",
  "Describe a task or ask a question": "描述一个任务或提出问题",
  "Download is unavailable while the project loads.": "项目加载期间无法下载。",
  "Due today": "今日应付",
  "Edit": "编辑",
  "Edit routine": "编辑例程",
  "Edit row": "编辑行",
  "Edit skill instructions": "编辑技能说明",
  "Edited": "已编辑",
  "Exit": "退出",
  "Email provider settings": "邮件提供商设置",
  "Enter verification code": "输入验证码",
  "About...": "关于...",
  "Actual Size": "实际大小",
  "App Features": "应用功能",
  "Back": "后退",
  "Clear Cache and Restart": "清除缓存并重启",
  "Close Window": "关闭窗口",
  "Claude Help": "Claude 帮助",
  "Copy": "复制",
  "Copy URL": "复制 URL",
  "Cut": "剪切",
  "Debug": "调试",
  "Developer": "开发者",
  "Failed to create scheduled task. You can try again.": "创建计划任务失败。你可以重试。",
  "Failed to delete scheduled task. You can try again.": "删除计划任务失败。你可以重试。",
  "Failed to delete session. You can try again.": "删除会话失败。你可以重试。",
  "Failed to load scheduled tasks.": "加载计划任务失败。",
  "Failed to load session.": "加载会话失败。",
  "Failed to save scheduled task. You can try again.": "保存计划任务失败。你可以重试。",
  "Failed to start scheduled task. You can try again.": "启动计划任务失败。你可以重试。",
  "Failed to update scheduled task. You can try again.": "更新计划任务失败。你可以重试。",
  "Favorite model": "常用模型",
  "File": "文件",
  "File upload failed. You can try again.": "文件上传失败。你可以重试。",
  "File upload failed. You can re-attach in the chat.": "文件上传失败。你可以在聊天中重新附加。",
  "Find": "查找",
  "Forward": "前进",
  "General": "通用",
  "Gateway": "网关",
  "Get Support": "获取支持",
  "Help": "帮助",
  "Home": "主页",
  "Home in {countdown}s": "{countdown} 秒后返回主页",
  "Include completed": "包含已完成",
  "Instructions can't be changed because of your organization's data protection settings. Contact your admin to learn more.": "由于你组织的数据保护设置，无法更改说明。请联系管理员了解更多信息。",
  "Last edited": "上次编辑",
  "Language": "语言",
  "Learn more": "了解更多",
  "Longest streak": "最长连续天数",
  "Loading preview": "正在加载预览",
  "Loading routines": "正在加载例程",
  "Loading scheduled tasks": "正在加载计划任务",
  "Local": "本地",
  "Local routines only run while your computer is awake.": "本地例程只会在电脑唤醒时运行。",
  "Local tasks only run while your computer is awake.": "本地任务只会在电脑唤醒时运行。",
  "Manual": "手动",
  "Members": "成员",
  "Messages": "消息",
  "Model": "模型",
  "Models": "模型",
  "New": "新建",
  "New Conversation": "新建对话",
  "New local routine": "新建本地例程",
  "New local task": "新建本地任务",
  "New message": "新消息",
  "New project": "新项目",
  "New remote routine": "新建远程例程",
  "New remote task": "新建远程任务",
  "New routine": "新例程",
  "New task": "新任务",
  "No projects match your filters.": "没有符合筛选条件的项目。",
  "No routines yet.": "还没有例程。",
  "No scheduled tasks yet.": "还没有计划任务。",
  "No tables yet. Tables you create will appear here.": "还没有表。你创建的表会显示在这里。",
  "No users created": "尚未创建用户",
  "Notifications": "通知",
  "One-time": "一次性",
  "Overview": "概览",
  "Open billing settings": "打开账单设置",
  "Open Documentation": "打开文档",
  "Open File...": "打开文件...",
  "Open File…": "打开文件...",
  "Open MCP Log File": "打开 MCP 日志文件",
  "Open MCP Log File...": "打开 MCP 日志文件...",
  "Paused": "已暂停",
  "Paste": "粘贴",
  "Paste and Match Style": "粘贴并匹配样式",
  "Phone provider settings": "电话提供商设置",
  "Preview address": "预览地址",
  "Preview failed to load. The app may still be starting.": "预览加载失败。应用可能仍在启动。",
  "Preview not responding. The app may have failed to start.": "预览无响应。应用可能启动失败。",
  "Privacy Policy": "隐私政策",
  "Profile": "个人资料",
  "Peak hour": "高峰时段",
  "Prototypes": "原型",
  "Project Settings": "项目设置",
  "Project actions": "项目操作",
  "Project settings": "项目设置",
  "Projects": "项目",
  "Projects you create will show up here.": "你创建的项目会显示在这里。",
  "Ready to write, research, code, and think things through together?": "准备好一起写作、研究、写代码并梳理想法了吗？",
  "Recents": "最近使用",
  "Redo": "重做",
  "Refresh preview": "刷新预览",
  "Reload": "重新加载",
  "Reload This Page": "重新加载此页面",
  "Remote": "远程",
  "Remote Control is offline. You can start it by running claude remote-control.": "远程控制已离线。你可以运行 claude remote-control 来启动它。",
  "Rename project": "重命名项目",
  "Review your details": "检查你的详细信息",
  "Reset App Data…": "重置应用数据...",
  "Run": "运行",
  "Running\\u2026": "正在运行...",
  "Routines": "例程",
  "Schedule downgrade": "安排降级",
  "Scheduled task creation isn't available. Restart the desktop app to enable this feature.": "计划任务创建不可用。请重启桌面应用以启用此功能。",
  "Scheduled task editing isn't available. Restart the desktop app to enable this feature.": "计划任务编辑不可用。请重启桌面应用以启用此功能。",
  "Scheduled tasks": "计划任务",
  "Search...": "搜索...",
  "Search for a tool": "搜索工具",
  "Search for a tool...": "搜索工具...",
  "Search projects": "搜索项目",
  "Seat usage breakdown": "席位用量明细",
  "Select All": "全选",
  "Session deleted": "会话已删除",
  "Session exported": "会话已导出",
  "Session is busy \\u2014 try again once Claude finishes responding.": "会话正忙，请等 Claude 回复完成后再试。",
  "Session is still running. Wait a moment and try again.": "会话仍在运行。请稍等片刻后重试。",
  "Settings": "设置",
  "Settings...": "设置...",
  "Sessions": "会话",
  "Show Main Window": "显示主窗口",
  "Sign out": "退出登录",
  "Side chat is local-only \\u2014 not available for remote sessions.": "侧边聊天仅限本地，远程会话不可用。",
  "Sort projects": "项目排序",
  "Source code downloaded.": "源代码已下载。",
  "Subtotal": "小计",
  "Task progress": "任务进度",
  "Tasks": "任务",
  "Tax": "税费",
  "Team": "团队",
  "Team and Enterprise": "团队版和企业版",
  "Team plan": "团队方案",
  "Teams account detected": "检测到团队账号",
  "Tools": "工具",
  "Total": "总计",
  "Total due today": "今日应付总额",
  "Total on next invoice": "下张发票总额",
  "Total tokens": "总 token 数",
  "Unlimited": "无限",
  "Update": "更新",
  "Update failed": "更新失败",
  "Updated": "已更新",
  "Undo": "撤销",
  "Usage credits": "用量额度",
  "User settings": "用户设置",
  "View all": "查看全部",
  "View changelog": "查看更新日志",
  "View latest": "查看最新",
  "View": "视图",
  "Via API": "通过 API",
  "Window": "窗口",
  "Zoom In": "放大",
  "Zoom Out": "缩小",
  "What was satisfying about this response?": "这次回复有哪些令人满意的地方？",
  "What was unsatisfying about this response?": "这次回复有哪些不满意的地方？",
  "What\\u2019s up next?": "下一步做什么？",
  "What’s up next?": "下一步做什么？",
  "You've used ~{multiplier}× more tokens than {book}.": "你使用的 token 约为{book}的 {multiplier} 倍。",
  "Your Projects": "你的项目",
  "Your account could not be prepared. Refresh the page to try again.": "无法准备你的账号。请刷新页面后重试。",
  "Your organization": "你的组织",
  "Your projects": "你的项目",
  "Your previous session was reset. Starting a new conversation.": "之前的会话已重置。正在开始新对话。",
  "project": "项目",
  "projects": "项目",
  "worktree": "工作树",
  "{count, plural, one {# file} other {# files}}": "{count} 个文件",
  "{count, plural, one {# new message} other {# new messages}}": "{count} 条新消息",
  "{count, plural, one {# new user} other {# new users}}": "{count} 位新用户"
};

const currentVersionLiteralTranslations = {
  "Check for Updates…": "检查更新…",
  "Check for Updates...": "检查更新…",
  "Reload This Page": "重新加载此页面",
  "Configure Third-Party Inference…": "配置第三方推理…",
  "Configure Third-Party Inference...": "配置第三方推理…",
  "Extensions": "扩展",
  "Install Extension…": "安装扩展…",
  "Install Extension...": "安装扩展…",
  "Install Unpacked Extension…": "安装未打包扩展…",
  "Install Unpacked Extension...": "安装未打包扩展…",
  "Open Extensions Folder…": "打开扩展文件夹…",
  "Open Extensions Folder...": "打开扩展文件夹…",
  "Open Extension Settings Folder…": "打开扩展设置文件夹…",
  "Open Extension Settings Folder...": "打开扩展设置文件夹…",
  "Show All Dev Tools": "显示所有开发者工具",
  "Troubleshooting": "故障排除",
  "Show Logs in Finder": "在 Finder 中显示日志",
  "Show Cowork Session Data in Finder": "在 Finder 中显示 Cowork 会话数据",
  "Copy Installation ID": "复制安装 ID",
  "Generate Diagnostic Report": "生成诊断报告",
  "Record Net Log (30s)": "记录网络日志（30 秒）",
  "Disable Hardware Acceleration": "停用硬件加速",
  "Enable Cowork VM Debug Logging": "启用 Cowork VM 调试日志",
  "Enable Cowork SDK Debugging": "启用 Cowork SDK 调试",
  "Delete Cowork VM Bundle and Restart…": "删除 Cowork VM 包并重启…",
  "Delete Cowork VM Bundle and Restart...": "删除 Cowork VM 包并重启…",
  "Delete Cowork VM Sessions and Restart…": "删除 Cowork VM 会话并重启…",
  "Delete Cowork VM Sessions and Restart...": "删除 Cowork VM 会话并重启…",
  "Accept edits": "接受编辑",
  "Add files, connectors, and more": "添加文件、连接器等",
  "Add another folder": "添加另一个文件夹",
  "Active days": "活跃天数",
  "All": "全部",
  "Current streak": "当前连续天数",
  "Describe a task or ask a question": "描述一个任务或提出问题",
  "Code": "代码",
  "Cowork": "协作",
  "Customize": "自定义",
  "Customize with plugins": "用插件自定义",
  "Daily activity heatmap": "每日活动热力图",
  "Favorite model": "常用模型",
  "Find insights in files": "从文件中发现洞察",
  "Gateway": "网关",
  "Hide suggestions": "隐藏建议",
  "How can I help you today?": "今天我能帮你什么？",
  "Hi, I\\u2019m Claude. How can I help you today?": "你好，我是 Claude。今天我能帮你什么？",
  "Inference configuration": "推理配置",
  "Language": "语言",
  "Learn how to use Cowork safely.": "了解如何安全使用协作。",
  "Learn more": "了解更多",
  "Let's knock something off your list": "把清单上的事处理掉",
  "Local": "本地",
  "Longest streak": "最长连续天数",
  "Messages": "消息",
  "Models": "模型",
  "New session": "新会话",
  "New task": "新任务",
  "Optimize my week": "优化我的一周",
  "Organize my screenshots": "整理我的截图",
  "Overview": "概览",
  "Peak hour": "高峰时段",
  "Pick a task, any task": "选个任务开始",
  "Recents": "最近使用",
  "Search": "搜索",
  "Settings": "设置",
  "Sessions": "会话",
  "Sign out": "退出登录",
  "Start task": "开始任务",
  "Total tokens": "总 token 数",
  "Usage": "用量",
  "View changelog": "查看更新日志",
  "What’s up next?": "下一步做什么？",
  "Work in a project": "在项目中工作",
  "worktree": "工作树",
  "to start a task and keep going": "开始任务并继续",

  // Claude 1.10628.x settings and nested menu details
  "Filter": "筛选",
  "Status": "状态",
  "Project": "项目",
  "Environment": "环境",
  "Last activity": "最近活动",
  "Group by": "分组方式",
  "Sort by": "排序方式",
  "Active": "活跃",
  "None": "无",
  "Recency": "最近",
  "Sidebar": "侧边栏",
  "Skip to content": "跳至内容",
  "Resize sidebar": "调整侧边栏大小",
  "Collapse sidebar": "折叠侧边栏",
  "Primary pane": "主窗格",
  "Notifications (F8)": "通知 (F8)",
  "Can't reach 127.0.0.1:15721": "无法连接到 127.0.0.1:15721",
  "The provider didn't respond. Check your network or VPN, then try again.": "提供商未响应。请检查网络或 VPN，然后重试。",
  "Details": "详情",
  "Open Setup": "打开设置",
  "Check again": "再次检查",
  "Dismiss": "关闭",
  "Learn how to use Cowork safely": "了解如何安全使用 Cowork",
  "Write your prompt to Claude": "将你的提示写给 Claude",
  "Model: mimo-v2.5-pro": "模型：mimo-v2.5-pro",
  "Privacy": "隐私",
  "Capabilities": "能力",
  "Desktop app": "桌面应用",
  "Extensions": "扩展",
  "Avatar": "头像",
  "Randomize avatar": "随机头像",
  "Full name": "全名",
  "What should Claude call you?": "Claude 应该怎么称呼你？",
  "Display name": "显示名称",
  "What best describes your work?": "哪项最符合你的工作？",
  "Select": "选择",
  "Instructions for Claude": "给 Claude 的说明",
  "Claude will keep these in mind across chats and Cowork within Anthropic's guidelines.": "Claude 会在聊天和 Cowork 中记住这些内容，并遵守 Anthropic 的准则。",
  "Anthropic's guidelines": "Anthropic 的准则",
  "e.g. keep explanations brief and to the point": "例如：解释保持简短并直奔重点",
  "e.g. ask clarifying questions before giving detailed answers": "例如：在给出详细答案前先提出澄清问题",
  "e.g. when learning new concepts, I find analogies particularly helpful": "例如：学习新概念时，我觉得类比特别有帮助",
  "Preferences": "偏好设置",
  "Chat font": "聊天字体",
  "System": "跟随系统",
  "Light": "浅色",
  "Dark": "深色",
  "Response completions": "回复完成通知",
  "Get notified when Claude has finished a response. Useful for long-running tasks.": "Claude 完成回复时通知你。适合耗时较长的任务。",
  "Product management": "产品管理",
  "Engineering": "工程",
  "Human resources": "人力资源",
  "Finance": "财务",
  "Marketing": "市场营销",
  "Sales": "销售",
  "Operations": "运营",
  "Data science": "数据科学",
  "Design": "设计",
  "Legal": "法务",
  "Other": "其他",
  "You’re running Claude through your organization’s own inference provider (127.0.0.1:15721). Your conversations are sent there, not to Anthropic, and are governed by your organization’s agreement with that provider.": "你正在通过组织自己的推理提供商 (127.0.0.1:15721) 运行 Claude。你的对话会发送到该提供商，而不是 Anthropic，并受你的组织与该提供商之间协议的约束。",
  "What Anthropic doesn’t see": "Anthropic 看不到的内容",
  "Your prompts, Claude’s responses, or any conversation content": "你的提示、Claude 的回复或任何对话内容",
  "Your files, code, or workspace contents": "你的文件、代码或工作区内容",
  "Your identity or account details": "你的身份或账号详情",
  "What Anthropic may receive (configured by your organization)": "Anthropic 可能收到的内容（由你的组织配置）",
  "Crash reports and error diagnostics, so we can fix bugs": "崩溃报告和错误诊断，帮助我们修复问题",
  "Anonymous usage metrics including usage counts (not conversation content)": "匿名使用指标，包括使用次数（不包含对话内容）",
  "Update-check requests, so the app can stay current": "更新检查请求，用于保持应用为最新版本",
  "A diagnostic report, only if you explicitly choose “Send to Anthropic”": "诊断报告，仅在你明确选择“发送给 Anthropic”时发送",
  "Visuals": "视觉",
  "Artifacts": "Artifacts",
  "Generate code, documents, and designs in a dedicated window alongside your conversation.": "在对话旁边的独立窗口中生成代码、文档和设计。",
  "Skills": "技能",
  "Skills have moved to": "技能已移至",
  "Skills have moved to 自定义.": "技能已移至自定义。",
  "Connectors have moved to": "连接器已移至",
  "Head there to browse, connect, and manage them.": "前往那里浏览、连接和管理它们。",
  "Connectors have moved to 自定义. Head there to browse, connect, and manage them.": "连接器已移至自定义。前往那里浏览、连接和管理它们。",
  "Code appearance": "代码外观",
  "Light code theme": "浅色代码主题",
  "Dark code theme": "深色代码主题",
  "Code font": "代码字体",
  "Code font family": "代码字体系列",
  "Set a custom monospace font for code and terminal.": "为代码和终端设置自定义等宽字体。",
  "e.g. JetBrains Mono": "例如：JetBrains Mono",
  "High-contrast dark theme": "高对比度深色主题",
  "Use a darker, near-black background when dark mode is on.": "启用深色模式时使用更暗、接近黑色的背景。",
  "Interface font": "界面字体",
  "Font for the Claude Code interface — menus, sidebar, and chat.": "Claude Code 界面的字体，包括菜单、侧边栏和聊天。",
  "Transcript text size": "对话记录文字大小",
  "Size of the conversation transcript text.": "对话记录文本的大小。",
  "Small": "小",
  "Medium": "中",
  "Large": "大",
  "Local sessions": "本地会话",
  "Allow bypass permissions mode": "允许绕过权限模式",
  "Bypass all permission checks and let Claude work uninterrupted. This works well for workflows like fixing lint errors or generating boilerplate code. Letting Claude run arbitrary commands is risky and can result in data loss, system corruption, or data exfiltration (e.g., via prompt injection attacks).": "绕过所有权限检查，让 Claude 不受打断地工作。这适合修复 lint 错误或生成样板代码等流程。允许 Claude 运行任意命令存在风险，可能导致数据丢失、系统损坏或数据外泄（例如通过提示注入攻击）。",
  "See best practices for safe usage": "查看安全使用最佳实践",
  "Enable remote control by default": "默认启用远程控制",
  "Automatically connect new local sessions to Remote Control so you can continue them from the CLI or claude.ai/code.": "自动将新的本地会话连接到远程控制，以便你从 CLI 或 claude.ai/code 继续使用。",
  "Dynamic workflows": "动态工作流",
  "Let Claude run multiple agents in parallel for complex tasks. Workflows can use a lot of your usage limit quickly.": "让 Claude 为复杂任务并行运行多个代理。工作流可能会快速消耗大量使用额度。",
  "Draw attention on notifications": "通知时吸引注意",
  "Bounce the dock icon or flash the taskbar when Claude needs your attention and the app is not focused.": "当 Claude 需要你注意且应用未聚焦时，弹跳 Dock 图标或闪烁任务栏。",
  "Worktree location": "工作树位置",
  "Where to store git worktrees for isolated coding sessions": "为隔离的编码会话存储 git 工作树的位置",
  "Inside project (.claude/worktrees)": "项目内 (.claude/worktrees)",
  "Inside project (.claude/worktrees": "项目内 (.claude/worktrees",
  "Branch prefix": "分支前缀",
  "Prefix added to the beginning of every worktree branch name": "添加到每个工作树分支名称开头的前缀",
  "Preview": "预览",
  "Claude can start dev servers, open a live preview, and verify code changes with screenshots, snapshots, and DOM inspection.": "Claude 可以启动开发服务器、打开实时预览，并通过截图、快照和 DOM 检查验证代码更改。",
  "Persist Preview sessions": "保留预览会话",
  "Save cookies, local storage, and login sessions for dev server previews. Data is stored per workspace and persists across app restarts. Turning this off clears all saved session data.": "保存开发服务器预览的 Cookie、本地存储和登录会话。数据按工作区保存，并会在应用重启后保留。关闭后会清除所有已保存的会话数据。",
  "Pull requests": "拉取请求",
  "Create pull requests automatically": "自动创建拉取请求",
  "When Claude pushes changes to a branch, it automatically opens a pull request without asking first. Applies to remote sessions only.": "当 Claude 将更改推送到分支时，会自动打开拉取请求，无需先询问。仅适用于远程会话。",
  "Cowork files": "Cowork 文件",
  "Your artifacts and scheduled tasks are stored at": "你的 Artifacts 和计划任务存储在",
  "Your artifacts and scheduled tasks are stored at ": "你的 Artifacts 和计划任务存储在 ",
  "Change": "更改",
  "Global instructions": "全局说明",
  "Instructions here apply to all Cowork sessions. Use this for preferences, conventions, or context that Claude should always know.": "这里的说明会应用到所有 Cowork 会话。可用于填写偏好、约定或 Claude 应始终了解的上下文。",
  "Add instructions for Claude to follow in all Cowork sessions...": "添加 Claude 在所有 Cowork 会话中都要遵循的说明...",
  "Save": "保存",
  "Memory": "记忆",
  "Use memory in sessions": "在会话中使用记忆",
  "Claude will read and update these memories during Cowork sessions.": "Claude 会在 Cowork 会话期间读取并更新这些记忆。",
  "Claude saves what it learns about you and your work during Cowork sessions. These files are stored on this device.": "Claude 会保存它在 Cowork 会话中了解的关于你和你的工作的内容。这些文件存储在此设备上。",
  "No memories yet. Claude will add entries here as you work together.": "还没有记忆。随着你们一起工作，Claude 会在这里添加条目。",
  "General desktop settings": "桌面通用设置",
  "Run on startup": "开机时运行",
  "Automatically start Claude when you log in to your computer": "登录电脑时自动启动 Claude",
  "Quick access shortcut": "快速访问快捷键",
  "Message Claude from anywhere on your desktop": "在桌面任意位置给 Claude 发消息",
  "Voice shortcut": "语音快捷键",
  "Speak to Claude from anywhere on your desktop": "在桌面任意位置对 Claude 说话",
  "Menu bar": "菜单栏",
  "Show Claude in the menu bar": "在菜单栏中显示 Claude",
  "Keep computer awake": "保持电脑唤醒",
  "Keep awake": "保持唤醒",
  "Prevent your computer from idle-sleeping while Claude is open so scheduled tasks can run. Your display can still turn off. Closing the laptop lid will still put it to sleep.": "Claude 打开时防止电脑因闲置进入睡眠，以便计划任务可以运行。显示器仍可关闭。合上笔记本盖子仍会进入睡眠。",
  "No shortcut": "无快捷键",
  "Tap Option twice": "双击 Option",
  "Option+Space": "Option+空格",
  "Custom...": "自定义...",
  "Custom…": "自定义...",
  "Caps Lock": "大写锁定",
  "Allow Claude to directly interact with apps, data, and tools on your computer.": "允许 Claude 直接与你电脑上的应用、数据和工具交互。",
  "Browse extensions": "浏览扩展",
  "Advanced settings": "高级设置",
  "All extensions": "所有扩展",
  "Extension Settings": "扩展设置",
  "Enable auto-updates for extensions": "启用扩展自动更新",
  "Automatically update extensions when new versions are available. If disabled, you’ll need to manually update extensions.": "有新版本可用时自动更新扩展。若关闭，你需要手动更新扩展。",
  "Use Built-in Node.js for MCP": "MCP 使用内置 Node.js",
  "If enabled, Claude will never use the system Node.js for extension MCP servers. This happens automatically when system’s Node.js is missing or outdated.": "启用后，Claude 将不会为扩展 MCP 服务器使用系统 Node.js。当系统 Node.js 缺失或过旧时也会自动这样做。",
  "Detected tools": "检测到的工具",
  "Extension Developer": "扩展开发者",
  "Developer Tools Warning": "开发者工具警告",
  "These tools are intended for extension developers only. Using them incorrectly may cause extensions to malfunction or compromise your system security.": "这些工具仅供扩展开发者使用。错误使用可能导致扩展异常或危及系统安全。",
  "Install Extension": "安装扩展",
  "Install Unpacked Extension": "安装未打包扩展",
  "Open Extensions Folder": "打开扩展文件夹",
  "Open Extension Settings Folder": "打开扩展设置文件夹",
  "Local MCP servers": "本地 MCP 服务器",
  "Add and manage MCP servers that you’re working on.": "添加并管理你正在开发的 MCP 服务器。",
  "No servers added": "尚未添加服务器",
  "Edit Config": "编辑配置",
  "Developer docs": "开发者文档",

  // Third-party inference configuration window
  "Configure third-party inference": "配置第三方推理",
  "Search settings": "搜索设置",
  "Connection": "连接",
  "Choose where Claude Desktop sends inference requests.": "选择 Claude Desktop 发送推理请求的位置。",
  "Workspace restrictions": "工作区限制",
  "Connectors & extensions": "连接器和扩展",
  "Telemetry & updates": "遥测与更新",
  "Usage limits": "使用限制",
  "Plugins & skills": "插件和技能",
  "Egress Requirements": "出站访问要求",
  "Source": "来源",
  "GATEWAY CREDENTIALS": "网关凭据",
  "Gateway credentials": "网关凭据",
  "Credential kind": "凭据类型",
  "Credential type": "凭据类型",
  "Selects the credential source. When set, only that source is used (no fallback).": "选择凭据来源。设置后只使用该来源（不回退）。",
  "Static API key": "静态 API 密钥",
  "Gateway base URL": "网关基础 URL",
  "Full URL of the inference gateway endpoint.": "推理网关端点的完整 URL。",
  "Gateway API key": "网关 API 密钥",
  "Gateway auth scheme": "网关认证方案",
  "How the gateway credential is sent on the wire (Authorization: Bearer vs x-api-key header).": "网关凭据在请求中如何发送（Authorization: Bearer 或 x-api-key 请求头）。",
  "Custom inference headers": "自定义推理请求头",
  "Extra HTTP headers sent on every inference request to the configured provider. For tenant routing, org IDs, Bedrock Guardrails, etc.": "随每次推理请求发送给已配置提供商的额外 HTTP 请求头，可用于租户路由、组织 ID、Bedrock Guardrails 等。",
  "Add header": "添加请求头",
  "Header name": "请求头名称",
  "Custom header name": "自定义请求头名称",
  "Custom header…": "自定义请求头…",
  "Search header names": "搜索请求头名称",
  "Value": "值",
  "Required": "必填",
  "Remove header": "移除请求头",
  "Apply Changes": "应用更改",
  "Test connection": "测试连接",
  "Test this connection": "测试此连接",
  "Checking connection...": "正在检查连接...",
  "Connection test failed. Check your configuration and try again.": "连接测试失败。请检查配置后重试。",
  "Could not test connection. Check your configuration and try again.": "无法测试连接。请检查配置后重试。",
  "Connection test passed.": "连接测试通过。",
  "Enter {field} to test the connection": "输入 {field} 后测试连接",
  "Export": "导出",
  "your organization's inference gateway": "你组织的推理网关",
  "a custom inference gateway": "自定义推理网关",
  "Connect to your own gateway": "连接到你自己的网关",
  "Gateway sign-in (OIDC)": "网关登录 (OIDC)",
  "Gateway SSO IdP (OIDC)": "网关 SSO 身份提供商 (OIDC)",
  "Which token to send as the gateway bearer. Use access token for gateways that validate as an OAuth resource server.": "选择作为网关 Bearer 凭据发送的令牌。对于按 OAuth 资源服务器校验的网关，请使用访问令牌。",
  "External IdP for gateway sign-in. The user authenticates against this issuer; the resulting token (ID token by default) is sent to the gateway as the Bearer credential. Leave unset only if the gateway is its own OAuth authorization server.": "用于网关登录的外部身份提供商。用户会向该签发方认证，生成的令牌（默认 ID token）会作为 Bearer 凭据发送到网关。只有当网关本身就是 OAuth 授权服务器时才留空。",
  "Required for access-token mode — set the gateway's API scope (e.g. api://gateway/.default). offline_access is appended automatically for silent refresh.": "访问令牌模式必填，请设置网关的 API scope（例如 api://gateway/.default）。offline_access 会自动追加，用于静默刷新。",
  "Leave blank to fetch a key via browser sign-in, or to supply the key via a credential helper.": "留空则通过浏览器登录获取密钥，或由凭据助手提供密钥。",
  "Endpoint is plain HTTP; auth credentials travel in cleartext.": "端点使用普通 HTTP，认证凭据会以明文传输。",
  "The provider rejected your credentials. Re-enter them in Setup.": "提供商拒绝了你的凭据。请在设置中重新输入。",
  "Your gateway couldn't serve {model}. This model may not be configured on your gateway, or access may be restricted.": "你的网关无法提供 {model}。该模型可能未在网关中配置，或访问受限。",
  "The provider rejected the credentials IT configured. This usually means an expired key or wrong region.": "提供商拒绝了 IT 配置的凭据。通常是密钥过期或区域设置错误。",

  // Workspace restrictions and egress requirements
  "General restrictions": "通用限制",
  "These apply regardless of which surfaces are enabled.": "无论启用了哪些界面，这些限制都会生效。",
  "Allowed egress hosts": "允许的出站主机",
  "Hostnames the agent's tools may reach from the Cowork and Code tabs. Also surfaced under Egress Requirements.": "代理工具可从 Cowork 和 Code 标签页访问的主机名，也会显示在“出站访问要求”中。",
  "Allowed workspace folders": "允许的工作区文件夹",
  "Folders users may attach as a workspace. Leave unset for unrestricted access.": "用户可作为工作区附加的文件夹。留空表示不限制访问。",
  "Disabled built-in tools": "禁用的内置工具",
  "Built-in tools removed from Cowork.": "从 Cowork 中移除的内置工具。",
  "Choose…": "选择…",
  "Choose...": "选择...",
  "Built-in tool policy": "内置工具策略",
  "Per-tool approval policy. \"ask\" requires user approval before each call; \"allow\" is the default. Use Disabled built-in tools to remove a tool entirely.": "按工具设置审批策略。“ask” 表示每次调用前都需要用户批准；“allow” 是默认值。若要完全移除某个工具，请使用“禁用的内置工具”。",
  "Allow Auto mode": "允许自动模式",
  "Offer Auto mode in the Cowork and Code permission selectors. Claude decides which actions need approval.": "在 Cowork 和 Code 权限选择器中提供自动模式。Claude 会判断哪些操作需要审批。",
  "Auto mode": "自动模式",
  "Enable auto mode": "启用自动模式",
  "Enable auto mode?": "启用自动模式？",
  "Show details": "显示详情",
  "Hide details": "隐藏详情",
  "Read in docs": "阅读文档",
  "Act without asking": "无需询问直接执行",
  "Act without asking?": "无需询问直接执行？",
  "Act without asking in Chrome": "在 Chrome 中无需询问直接执行",
  "Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.": "自动模式允许 Claude 自动处理权限提示。执行前，Claude 会检查每次工具调用是否存在高风险操作或提示注入，运行其判断为较低风险的调用，并阻止其余调用。",
  "When enabled, users can select Auto mode (Code tab) / Act without asking (Cowork tab). Claude runs a safety classifier on each action and only prompts for approval on actions it judges risky.": "启用后，用户可以选择自动模式（Code 标签页）/ 无需询问直接执行（Cowork 标签页）。Claude 会对每个操作运行安全分类器，仅在判断操作有风险时请求批准。",
  "Requires a model that supports the classifier (Claude 4.6+). Older models show the option greyed out.": "需要支持分类器的 model（Claude 4.6+）。较旧 model 会将该选项显示为灰色不可用。",
  "This is the permissive opposite of the per-tool ask policy above; both may be set.": "这与上方按工具设置的询问策略相反，更偏宽松；两者可以同时设置。",
  "Auto mode isn't available for this session. Asking for permissions instead.": "此会话无法使用自动模式，将改为请求权限。",
  "Auto mode is now Claude Code's default permission mode": "自动模式现在是 Claude Code 的默认权限模式",
  "Auto mode is now available on the Pro plan — Sonnet 4.6 is now supported, alongside Opus 4.7": "自动模式现已面向 Pro 计划开放，除 Opus 4.7 外也支持 Sonnet 4.6。",
  "Make auto mode your default permission mode?": "将自动模式设为默认权限模式？",
  "Accept and auto mode": "接受并使用自动模式",
  "<bold>Act without asking is on.</bold> Claude works, uses connectors, and controls apps on your computer without pausing for approval. You can turn off individual connectors in the Add menu. <link>See safe use tips</link>": "<bold>无需询问直接执行已开启。</bold> Claude 会工作、使用连接器并控制你电脑上的应用，无需暂停等待批准。你可以在添加菜单中关闭单个连接器。<link>查看安全使用提示</link>",
  "<bold>Act without asking is on.</bold> Claude works, uses connectors, and browses the web without pausing for approval. You can turn off individual connectors in the Add menu. <link>See safe use tips</link>": "<bold>无需询问直接执行已开启。</bold> Claude 会工作、使用连接器并浏览网页，无需暂停等待批准。你可以在添加菜单中关闭单个连接器。<link>查看安全使用提示</link>",
  "<bold>Act without asking is on.</bold> Claude works and uses connectors without pausing for approval. You can turn off individual connectors in the Add menu. <link>See safe use tips</link>": "<bold>无需询问直接执行已开启。</bold> Claude 会工作并使用连接器，无需暂停等待批准。你可以在添加菜单中关闭单个连接器。<link>查看安全使用提示</link>",
  "<bold>Act without asking is on.</bold> Claude works, uses connectors, browses the web, and controls apps on your computer without pausing for approval. You can turn off individual connectors in the Add menu. <link>See safe use tips</link>": "<bold>无需询问直接执行已开启。</bold> Claude 会工作、使用连接器、浏览网页并控制你电脑上的应用，无需暂停等待批准。你可以在添加菜单中关闭单个连接器。<link>查看安全使用提示</link>",
  "Tool policy": "工具策略",
  "Tool policy for {name}": "{name} 的工具策略",
  "Bypass permissions mode and auto mode controls for Claude Code Desktop are moving to Managed settings on June 5, 2026, alongside the CLI and IDE.": "Claude Code Desktop 的绕过权限模式和自动模式控制将于 2026 年 6 月 5 日与 CLI 和 IDE 一起迁移到托管设置。",
  "Disable Claude.ai sign-in": "禁用 Claude.ai 登录",
  "Users see only this provider at the login screen. The option to sign in to Claude.ai is hidden.": "用户在登录界面只会看到此提供商，Claude.ai 登录选项会被隐藏。",
  "Disable claude:// deep-link handling": "禁用 claude:// 深层链接处理",
  "Stop external apps and websites from opening Cowork via claude:// links.": "阻止外部应用和网站通过 claude:// 链接打开 Cowork。",
  "MCP servers": "MCP 服务器",
  "Managed MCP servers": "托管的 MCP 服务器",
  "Org-pushed MCP servers: remote (HTTP/SSE) or local (stdio command). May embed bearer tokens.": "组织下发的 MCP 服务器：远程（HTTP/SSE）或本地（stdio 命令）。可能包含 bearer token。",
  "Allow user-added MCP servers": "允许用户添加 MCP 服务器",
  "Local stdio servers added via the Developer settings. Remote servers come from the managed list above, or plugins mounted to a user's computer by an organization admin.": "通过开发者设置添加的本地 stdio 服务器。远程服务器来自上方托管列表，或由组织管理员挂载到用户电脑上的插件提供。",
  "Local command (stdio)": "本地命令 (stdio)",
  "Local MCP servers": "本地 MCP 服务器",
  "Your MCP servers": "你的 MCP 服务器",
  "Known MCP servers": "已知 MCP 服务器",
  "Add an MCP server": "添加 MCP 服务器",
  "Remote MCP server URL": "远程 MCP 服务器 URL",
  "Allow desktop extensions": "允许桌面扩展",
  ".dxt and .mcpb installs.": ".dxt 和 .mcpb 安装。",
  "Require signed extensions": "要求扩展签名",
  "Reject desktop extensions that are not signed by a trusted publisher.": "拒绝未由可信发布者签名的桌面扩展。",
  "Desktop extension allowlist": "桌面扩展允许列表",
  "Desktop extensions (Python runtime)": "桌面扩展（Python 运行时）",
  "User-added MCP (Python runtime)": "用户添加的 MCP（Python 运行时）",
  "Limit the desktop extensions that your team can install on their desktop.": "限制团队成员可在桌面端安装的桌面扩展。",
  "When enabled, users can only install desktop extensions that have been added to the list above.": "启用后，用户只能安装已添加到上方列表中的桌面扩展。",
  "Organization plugins": "组织插件",
  "Organization plugin settings": "组织插件设置",
  "No organization plugins found": "未找到组织插件",
  "Mount plugin bundles to this folder using your device-management tool and Cowork will load them at launch. The folder is read-only; tool policies you set below are saved in this configuration.": "使用你的设备管理工具将插件包挂载到此文件夹，Cowork 会在启动时加载它们。该文件夹为只读；你在下方设置的工具策略会保存在此配置中。",
  "Failed to load organization plugins.": "加载组织插件失败。",
  "Failed to load organization plugins. This desktop build is missing plugin support — try reinstalling the application.": "加载组织插件失败。此桌面版本缺少插件支持，请尝试重新安装应用。",
  "Admin policy applied to plugin-delivered MCP servers.": "应用于插件提供的 MCP 服务器的管理员策略。",
  "Applies once a plugin ships an MCP server with this name.": "当某个插件提供同名 MCP 服务器时生效。",

  // Export menu in third-party inference configuration
  "This configuration contains sensitive values. They will be written to the exported file in plain text.": "此配置包含敏感值。它们会以明文写入导出的文件。",
  "macOS configuration profile": "macOS 配置描述文件",
  "Windows registry file": "Windows 注册表文件",
  "Plain JSON": "普通 JSON",
  "Firewall allowlist (.txt)": "防火墙允许列表 (.txt)",
  "Copy to clipboard (redacted)": "复制到剪贴板（已脱敏）",
  "Templates": "模板",
  "Group Policy template (ADMX)": "组策略模板 (ADMX)",
  "Schema only — defines available policies for Intune / Group Policy. Values are configured in your management console.": "仅包含架构，用于定义 Intune / 组策略中可用的策略。具体值请在你的管理控制台中配置。",
  "Profile Manifest (.plist)": "配置清单 (.plist)",
  "Defines available settings for Jamf / ProfileCreator and similar macOS tools.": "定义 Jamf / ProfileCreator 及类似 macOS 工具可用的设置。",

  // Telemetry and updates managed settings
  "Allowed surfaces": "允许的界面",
  "Prompts, completions, and your data are never sent to Anthropic. Telemetry covers crash and usage signals only.": "提示、补全和你的数据绝不会发送给 Anthropic。遥测仅涵盖崩溃和使用信号。",
  "Anthropic telemetry": "Anthropic 遥测",
  "Organization UUID": "组织 UUID",
  "Tags telemetry events with your organization's UUID so Anthropic support can find them. Not used for auth.": "用你组织的 UUID 标记遥测事件，方便 Anthropic 支持团队定位。不用于身份验证。",
  "Essential telemetry": "必要遥测",
  "Nonessential telemetry": "非必要遥测",
  "Block essential telemetry": "阻止必要遥测",
  "Crash and performance reports to Anthropic.": "发送给 Anthropic 的崩溃和性能报告。",
  "Block nonessential telemetry": "阻止非必要遥测",
  "Product-usage analytics and diagnostic-report uploads. No message content.": "产品使用分析和诊断报告上传。不包含消息内容。",
  "Block nonessential services": "阻止非必要服务",
  "Favicon fetch and the artifact-preview iframe origin. Artifacts will not render.": "Favicon 获取和 artifact-preview iframe 源。Artifacts 将无法渲染。",
  "Desktop telemetry export level": "桌面遥测导出级别",
  "Usage analytics help us prioritize improvements for third-party inference. Diagnostic-report uploads will also be blocked. No message content is included in either.": "使用分析有助于我们优先改进第三方推理。诊断报告上传也会被阻止。两者都不包含消息内容。",
  "OpenTelemetry": "OpenTelemetry",
  "OpenTelemetry collector endpoint": "OpenTelemetry 采集器端点",
  "Where Cowork sends OpenTelemetry logs and metrics. Leave blank to disable.": "Cowork 发送 OpenTelemetry 日志和指标的位置。留空表示禁用。",
  "OpenTelemetry resource attributes": "OpenTelemetry 资源属性",
  "OpenTelemetry exporter headers": "OpenTelemetry 导出器请求头",
  "OpenTelemetry exporter protocol": "OpenTelemetry 导出器协议",
  "Cowork supports OpenTelemetry (OTel) events for monitoring and observability. Cowork reuses <docsLink>Claude Code's OTel events schema</docsLink> via the Claude Agent SDK. <learnMoreLink>Learn more</learnMoreLink>": "Cowork 支持用于监控和可观测性的 OpenTelemetry (OTel) 事件。Cowork 通过 Claude Agent SDK 复用 <docsLink>Claude Code 的 OTel 事件架构</docsLink>。<learnMoreLink>了解更多</learnMoreLink>",
  "The saved endpoint and headers will be removed and telemetry export will stop.": "已保存的端点和请求头将被移除，遥测导出将停止。",
  "The saved endpoint, headers, and resource attributes will be removed and telemetry export will stop.": "已保存的端点、请求头和资源属性将被移除，遥测导出将停止。",
  "Clear telemetry export settings?": "清除遥测导出设置？",
  "Sending is disabled because your administrator has blocked nonessential telemetry. Use Export to file instead.": "发送已被禁用，因为你的管理员阻止了非必要遥测。请改用导出到文件。",
  "Updates": "更新",
  "Auto-updates": "自动更新",
  "Block auto-updates": "阻止自动更新",
  "Stop Cowork from fetching updates. You'll need to push new versions yourself.": "阻止 Cowork 获取更新。你需要自行推送新版本。",
  "Auto-update enforcement window": "自动更新强制安装窗口",
  "Hours before a downloaded update force-installs. Blank = 72-hour default.": "已下载更新在强制安装前等待的小时数。留空表示默认 72 小时。",
  "hours": "小时",
  "Checking for updates...": "正在检查更新...",
  "Checking for updates": "正在检查更新",
  "Check for updates": "检查更新",
  "Failed to save auto-update setting": "保存自动更新设置失败",
  "Failed to check for extension updates": "检查扩展更新失败",

  // Usage limits, organization banner, firewall allowlist, and bootstrap source
  "Max tokens per window": "每个窗口最大 token 数",
  "Per-user soft cap, counted client-side over the duration below. Not a server-enforced quota.": "每用户软上限，由客户端在下面设置的时长内统计。不是服务器强制配额。",
  "Token cap window": "token 上限窗口",
  "Tumbling window length for the token cap. Max 720 hours (30 days).": "token 上限的滚动窗口时长。最长 720 小时（30 天）。",
  "Token limit reached ({used, number} of {cap, number} in this {windowHours}-hour window). Contact your IT administrator.": "已达到 token 限制（此 {windowHours} 小时窗口内已使用 {used, number}/{cap, number}）。请联系你的 IT 管理员。",
  "Tokens": "tokens",
  "tokens": "tokens",
  "{count} tokens": "{count} tokens",
  "~{count} tokens": "~{count} tokens",
  "{tokens} tokens": "{tokens} tokens",
  "Total tokens": "总 token 数",
  "Daily tokens by model": "按 model 统计的每日 token",
  "Compacted conversation · saved {tokens} tokens": "已压缩对话 · 节省 {tokens} tokens",
  "Compacted conversation · from {tokens} tokens": "已压缩对话 · 原 {tokens} tokens",
  "You've used about as many tokens as {book}.": "你使用的 token 数大约与 {book} 相当。",
  "You've used ~{times}× more tokens than {book}.": "你使用的 token 数约为 {book} 的 {times} 倍。",
  "You've used ~{multiplier}× more tokens than {book}.": "你使用的 token 数约为 {book} 的 {multiplier} 倍。",
  "Max effort can use excessive tokens resulting in hitting limits. Consider using a lower effort setting.": "Max effort 可能使用过多 token，导致触及限制。建议使用较低 effort 设置。",
  "May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.": "可能使用过多 token，导致响应时间变长并触及 token 限制。请仅在最困难的任务中谨慎使用。",
  "Model": "Model",
  "Models": "Models",
  "Favorite model": "常用 model",
  "Model: mimo-v2.5-pro": "Model: mimo-v2.5-pro",
  "Add MCP servers, set a model allowlist, or change providers any time in the Inference configuration menu.": "添加 MCP 服务器、设置 model 允许列表，或随时在推理配置菜单中更改提供商。",
  "Your gateway couldn't serve {model}. This model may not be configured on your gateway, or access may be restricted.": "你的网关无法提供 {model}。该 model 可能未在网关中配置，或访问受限。",
  "Your connection works, but the provider rejected a test request. This is often a model-access or quota issue your admin can resolve.": "连接可用，但提供商拒绝了测试请求。这通常是 model 访问权限或配额问题，管理员可处理。",
  "Your connection works, but the provider rejected a test request. Often a model-access or quota issue.": "连接可用，但提供商拒绝了测试请求。通常是 model 访问权限或配额问题。",
  "Model discovery": "model 发现",
  "Auto-populate the model picker from {url} at launch.": "启动时从 {url} 自动填充 model picker。",
  "Test model discovery": "测试 model 发现",
  "Shown in the model picker. Leave blank to auto-format from the ID.": "显示在 model picker 中。留空则根据 ID 自动格式化。",
  "Choose the starting model for new conversations in Chat and Cowork. Members can change their model anytime using the model picker, and Claude remembers their last selection for next time.": "选择 Chat 和 Cowork 新对话的起始 model。成员可随时通过 model picker 更改 model，Claude 会记住上次选择供下次使用。",
  "Choose the starting model for new conversations in Chat and Cowork. Members can change their model anytime using the model picker.": "选择 Chat 和 Cowork 新对话的起始 model。成员可随时通过 model picker 更改 model。",
  "Organization banner": "组织横幅",
  "A persistent banner across the top of the app window after sign-in.": "登录后显示在应用窗口顶部的常驻横幅。",
  "Show banner": "显示横幅",
  "Customize the classification banner displayed at the top of the page for all users in your organization. When not set, the default banner from your environment configuration is used.": "自定义显示在组织所有用户页面顶部的分类横幅。未设置时，将使用环境配置中的默认横幅。",
  "Optional HTTPS URL. The banner text becomes a link when set.": "可选 HTTPS URL。设置后，横幅文本会变成链接。",
  "Banner settings saved.": "横幅设置已保存。",
  "Why this banner is shown": "为什么显示此横幅",
  "Before you proceed, you must acknowledge the usage conditions presented here. The notification message or banner will remain on your screen until you take explicit action to further access the system.": "继续之前，你必须确认此处显示的使用条件。通知消息或横幅会一直保留在屏幕上，直到你明确操作后继续访问系统。",
  "Firewall allowlist": "防火墙允许列表",
  "Core (VM bundle + Claude CLI binary)": "核心（VM 包 + Claude CLI 二进制文件）",
  "Tool egress (Cowork tasks and Code sessions)": "工具出站（Cowork 任务和 Code 会话）",
  "VM tool egress is unrestricted — tools may reach any host your firewall allows. Common hosts (not exhaustive):": "VM 工具出站不受限制，工具可以访问防火墙允许的任何主机。常见主机如下（并非完整列表）：",
  "Hosts your network firewall must allow, derived from your current settings. This list is read-only and updates as you make changes. Traffic is HTTPS on port 443 unless a custom port is specified (OTLP, gateway, or MCP server URLs).": "你的网络防火墙必须允许的主机，基于当前设置生成。此列表为只读，并会随设置变更自动更新。除非指定了自定义端口（OTLP、网关或 MCP 服务器 URL），流量均为 443 端口 HTTPS。",
  "Point this configuration at a bootstrap URL to have your organization manage these settings remotely.": "将此配置指向 bootstrap URL，以便你的组织远程管理这些设置。",
  "Bootstrap config URL": "Bootstrap 配置 URL",
  "HTTPS endpoint that returns a per-user JSON config overlay. Values from the response override local settings and become read-only.": "返回每用户 JSON 配置覆盖的 HTTPS 端点。响应中的值会覆盖本地设置并变为只读。",
  "Bootstrap config server": "Bootstrap 配置服务器",
  "This configuration is fetched from a bootstrap URL at launch. Fields it provides are locked below.": "此配置会在启动时从 bootstrap URL 获取。其提供的字段会在下方锁定。",
  "Settings covered by the URL are read-only below.": "该 URL 覆盖的设置在下方为只读。",
  "Set by bootstrap URL · <h>{host}</h>": "由 bootstrap URL 设置 · <h>{host}</h>",
  "Typically supplied by your bootstrap server. Ignored when bootstrap is disabled.": "通常由你的 bootstrap 服务器提供。禁用 bootstrap 时会忽略。",

  // Short buttons, menus, dropdown values, and status labels
  "Accept": "接受",
  "Ask": "询问",
  "Bypass": "绕过",
  "Bypass permissions mode": "绕过权限模式",
  "Auto-accept permissions mode": "自动接受权限模式",
  "All settings": "所有设置",
  "Also changes:": "同时更改：",
  "Browse all": "浏览全部",
  "Built-in servers": "内置服务器",
  "Built-in server, bundled with the Claude desktop app.": "内置服务器，随 Claude Desktop 应用打包。",
  "Choose a specific model": "选择特定 model",
  "Always start with the default model": "始终使用默认 model 开始",
  "Change anytime before you check out.": "结账前可随时更改。",
  "Collapse {title}": "折叠 {title}",
  "Expand {title}": "展开 {title}",
  "Connectors & tools": "连接器和工具",
  "Connector domain restriction": "连接器域名限制",
  "Connector enabled": "连接器已启用",
  "Container": "容器",
  "Container ID": "容器 ID",
  "Continue to Enterprise checkout": "继续企业版结账",
  "Conversation feedback": "对话反馈",
  "Copy project ID": "复制项目 ID",
  "Create a new Admin API key": "创建新的管理员 API key",
  "Cron expression (UTC)": "Cron 表达式 (UTC)",
  "Customize → {section}": "自定义 → {section}",
  "Data sharing with Anthropic": "与 Anthropic 共享数据",
  "Delete task": "删除任务",
  "Design (opens in a new window)": "设计（在新窗口中打开）",
  "Developer partner program": "开发者合作伙伴计划",
  "Disables this task": "停用此任务",
  "Downloaded {filename}": "已下载 {filename}",
  "Editing {fileName}…": "正在编辑 {fileName}…",
  "Editing file…": "正在编辑文件…",
  "Editing memory…": "正在编辑记忆…",
  "Enable a Custom Connector": "启用自定义连接器",
  "Enables this task": "启用此任务",
  "Everywhere": "所有位置",
  "Faster": "更快",
  "Fetching page…": "正在获取页面…",
  "Finding files": "正在查找文件",
  "Finding matches…": "正在查找匹配项…",
  "From \"{name}\"": "来自“{name}”",
  "Got it": "知道了",
  "Group limit": "群组限制",
  "Header prefix": "请求头前缀",
  "Header prefix (opt.)": "请求头前缀（可选）",
  "Header secret": "请求头密钥",
  "Hide users": "隐藏用户",
  "Install plugin": "安装插件",
  "Internal preview": "内部预览",
  "Loading {slug}…": "正在加载 {slug}…",
  "Loading members": "正在加载成员",
  "Managed configuration has changed": "托管配置已变更",
  "Manually created": "手动创建",
  "Mark as completed": "标记为已完成",
  "Message the Anthropic team": "联系 Anthropic 团队",
  "Migrate accounts": "迁移账号",
  "Model defaults saved.": "Model 默认设置已保存。",
  "Model overloaded": "Model 负载过高",
  "Model selection isn't available until the container is connected.": "容器连接后才能选择 model。",
  "More agents may appear": "可能会出现更多 agent",
  "Name is too long.": "名称过长。",
  "New name: {name}": "新名称：{name}",
  "no limit": "无限制",
  "No matches": "无匹配项",
  "None selected": "未选择",
  "Now using extra usage": "正在使用额外用量",
  "Now using usage credits": "正在使用用量额度",
  "Open browser activity": "打开浏览器活动",
  "Open Claude settings": "打开 Claude 设置",
  "Open effort selector": "打开 effort 选择器",
  "Open in desktop app": "在桌面应用中打开",
  "Organization skill sharing": "组织技能共享",
  "Permission mode change failed. Try again.": "权限模式更改失败。请重试。",
  "Please select fewer images.": "请选择更少图片。",
  "Project (local)": "项目（本地）",
  "Project ID": "项目 ID",
  "Rate limited": "已限流",
  "Reading {file}": "正在读取 {file}",
  "Reading {fileName}…": "正在读取 {fileName}…",
  "Reading a file": "正在读取文件",
  "Reading file…": "正在读取文件…",
  "Reading memory…": "正在读取记忆…",
  "Refresh connectors": "刷新连接器",
  "Refreshing your payment method…": "正在刷新你的付款方式…",
  "Relaunch anyway": "仍然重新启动",
  "Relaunch Claude Desktop": "重新启动 Claude Desktop",
  "Remote Control turned off.": "远程控制已关闭。",
  "Remote Control turned on.": "远程控制已开启。",
  "Remote templates": "远程模板",
  "Request failed": "请求失败",
  "Request ID: {requestId}": "请求 ID：{requestId}",
  "Requires these settings:": "需要这些设置：",
  "Resets at {time}": "{time} 重置",
  "Restart Conway": "重启 Conway",
  "retrying ({attempt}/{maxRetries})": "正在重试（{attempt}/{maxRetries}）",
  "Run task now": "立即运行任务",
  "Run tasks on a schedule or whenever you need them.": "按计划或在需要时运行任务。",
  "Run tasks on a schedule or whenever you need them. Type <code>/schedule</code> in any existing task to set one up.": "按计划或在需要时运行任务。在任何现有任务中输入 <code>/schedule</code> 即可设置。",
  "Run tasks on a schedule or whenever you need them. Type /schedule in any session to set one up.": "按计划或在需要时运行任务。在任何会话中输入 /schedule 即可设置。",
  "Claude can also run tasks on a schedule or whenever you need them.": "Claude 也可以按计划或在你需要时运行任务。",
  "Schedule a recurring task": "安排重复任务",
  "Schedule a task": "安排任务",
  "Schedule task": "安排任务",
  "All scheduled tasks": "全部计划任务",
  "View scheduled task": "查看计划任务",
  "View scheduled tasks": "查看计划任务",
  "Created scheduled task: {taskName}": "已创建计划任务：{taskName}",
  "Ran scheduled task": "已运行计划任务",
  "Scheduled · {taskName}": "已计划 · {taskName}",
  "{count} completed": "{count} 个已完成",
  "{count} failed": "{count} 个失败",
  "{count} running": "{count} 个运行中",
  "{count} stopped": "{count} 个已停止",

  // Add-* actions and terminology fixes
  "Add a group": "添加组",
  "Add group": "添加组",
  "Add groups": "添加组",
  "Add model": "添加 model",
  "Add credits": "添加额度",
  "Add usage credits": "添加用量额度",
  "Add webhook": "添加 webhook",
  "Add Webhook": "添加 webhook",
  "Add writing example": "添加写作示例",
  "Add Content": "添加内容",
  "Add Domain": "添加域名",
  "Add domain": "添加域名",
  "Add sites to block": "添加要阻止的站点",
  "Add seats anytime. Remove seats at your annual renewal.": "可随时添加席位；可在年度续订时移除席位。",
  "Add seats anytime. Remove seats at your annual renewal. {editLink}": "可随时添加席位；可在年度续订时移除席位。{editLink}",

  // Sidebar and selector values observed after restart
  "Mode": "模式",
  "Projects": "项目",
  "Scheduled tasks": "计划任务",

  // Code mode sidebar empty states
  "Sessions you start will show up here": "你启动的会话会显示在这里",
  "Open sidebar": "打开侧边栏",

  // Mixed localized stats details
  "你使用的 token 数大约与 Moby-Dick 相当。": "你使用的 token 数大约与《白鲸》相当。",
};

function applyCurrentVersionTranslations(parsed) {
  const pairsByMessage = collectCurrentVersionMessages();
  let added = 0;
  for (const [message, translation] of Object.entries(currentVersionTranslations)) {
    for (const variant of stringVariants(message)) {
      const ids = pairsByMessage.get(variant);
      if (!ids) continue;
      for (const id of ids) {
        if (parsed[id] !== translation) {
          parsed[id] = translation;
          added++;
        }
      }
    }
  }
  log(`新版 Intl 资源：合并 ${added} 条`);
}

function applyKnownTranslationsFromEnglishResource(parsed, english) {
  const dictionary = currentVersionDictionary();
  let added = 0;
  for (const [id, value] of Object.entries(english)) {
    if (typeof value !== "string") continue;
    const translation = translationForMessage(value, dictionary);
    if (!translation) continue;
    if (parsed[id] !== translation) {
      parsed[id] = translation;
      added++;
    }
  }
  log(`新版英文资源对照：合并 ${added} 条`);
}

function applyTechnicalTermPolicy(parsed, english) {
  const exact = {
    "rhSI1/3g21": "Model",
    "rnGeAhDEEE": "Model",
    "blWvagsLt7": "Models",
    "HcKBhf6Q5g": "常用 model"
  };
  let changed = 0;
  for (const [id, value] of Object.entries(english)) {
    if (typeof value !== "string" || typeof parsed[id] !== "string") continue;
    let next = parsed[id];
    if (/\btokens?\b/i.test(value)) {
      next = next
        .replaceAll("代币", "token")
        .replaceAll("令牌", "token")
        .replaceAll("Token", "token");
    }
    if (/\bmodels?\b/i.test(value)) {
      next = next.replaceAll("模型", "model");
    }
    if (Object.prototype.hasOwnProperty.call(exact, id)) next = exact[id];
    if (next !== parsed[id]) {
      parsed[id] = next;
      changed++;
    }
  }
  for (const [id, value] of Object.entries(exact)) {
    if (parsed[id] !== value) {
      parsed[id] = value;
      changed++;
    }
  }
  log(`技术术语统一：修正 ${changed} 条`);
}

function collectCurrentVersionMessages() {
  const pairs = new Map();
  if (!fs.existsSync(assetsDir)) return pairs;
  const patterns = [
    /defaultMessage:"((?:\\.|[^"\\])*)",id:"((?:\\.|[^"\\])*)"/g,
    /id:"((?:\\.|[^"\\])*)",defaultMessage:"((?:\\.|[^"\\])*)"/g
  ];
  for (const file of jsFiles(assetsDir)) {
    const source = fs.readFileSync(file, "utf8");
    for (const [index, re] of patterns.entries()) {
      for (const match of source.matchAll(re)) {
        const message = index === 0 ? match[1] : match[2];
        const id = index === 0 ? match[2] : match[1];
        for (const variant of stringVariants(message)) {
          if (!pairs.has(variant)) pairs.set(variant, new Set());
          pairs.get(variant).add(id);
        }
      }
    }
  }
  return pairs;
}

function patchIntlDefaultMessages() {
  let total = 0;
  const re = /defaultMessage:"((?:\\.|[^"\\])*)"/g;
  for (const file of jsFiles(assetsDir)) {
    const source = fs.readFileSync(file, "utf8");
    let changed = 0;
    const next = source.replace(re, (match, message) => {
      const translation = translationForMessage(message);
      if (!translation) return match;
      if (stringVariants(message).includes(translation)) return match;
      changed++;
      return `defaultMessage:${JSON.stringify(translation)}`;
    });
    if (changed > 0) {
      backup(file);
      fs.writeFileSync(file, next);
      total += changed;
    }
  }
  log(`新版 Intl 默认文案: 共替换 ${total} 处`);
}

function restoreIntlDefaultMessagesForLanguageToggle() {
  const replacements = Object.entries(currentVersionTranslations).flatMap(([from, to]) => (
    literalVariants(to).map((literal) => [
      `defaultMessage:${literal}`,
      `defaultMessage:${JSON.stringify(decodeJsStringContent(from))}`
    ])
  ));
  patchAssetsSilently(replacements, "恢复 Intl 默认文案");
}

function patchCurrentVersionStringLiterals() {
  const replacements = Object.entries(currentVersionLiteralTranslations).flatMap(([from, to]) => {
    const pairs = [];
    for (const literal of literalVariants(from)) pairs.push([literal, JSON.stringify(to)]);
    for (const variant of stringVariants(from)) pairs.push([`>${variant}<`, `>${to}<`]);
    return pairs;
  });
  const uiAnchors = [
    "Epitaxy",
    "Stats view",
    "Daily activity heatmap",
    "What\\u2019s up next?",
    "What’s up next?",
    "General coding session",
    "Gateway",
    "Hi, I\\u2019m Claude",
    "How can I help you today?",
    "New session"
  ];
  patchAssetsSilently(
    replacements,
    "新版普通字符串",
    (_file, source) => uiAnchors.some((anchor) => source.includes(anchor))
  );
}

function restoreStringLiteralsForLanguageToggle() {
  const dictionaries = [currentVersionTranslations, currentVersionLiteralTranslations];
  const replacements = dictionaries.flatMap((dictionary) => Object.entries(dictionary).flatMap(([from, to]) => {
    const english = JSON.stringify(decodeJsStringContent(from));
    return literalVariants(to).map((literal) => [literal, english]);
  }));
  patchAssetsSilently(replacements, "恢复普通字符串");
}

function patchBootstrapLocaleBehavior() {
  patchAssetsSilently([
    [
      "const c=await l.json();try{c.locale=\"zh-CN\",delete c.gated_messages}catch{}return",
      "const c=await l.json();try{globalThis.__CLAUDE_CN_LOCALE=c.locale,delete c.gated_messages}catch{}return"
    ],
    [
      "const c=await l.json();try{c.locale=\"zh-CN\"}catch{}return",
      "const c=await l.json();try{globalThis.__CLAUDE_CN_LOCALE=c.locale}catch{}return"
    ],
    [
      "const c=await l.json();return",
      "const c=await l.json();try{globalThis.__CLAUDE_CN_LOCALE=c.locale}catch{}return"
    ]
  ], "语言选择逻辑");
}

function installRuntimeDomTranslator() {
  const dictionary = Object.fromEntries(
    Object.entries(currentVersionDictionary())
      .filter(([from, to]) => typeof from === "string" && typeof to === "string")
      .map(([from, to]) => [decodeJsStringContent(from), to])
  );
  const script = `;(()=>{const k="__CLAUDE_CN_DOM_TRANSLATOR_V5__";if(globalThis[k])return;globalThis[k]=true;const M=${JSON.stringify(dictionary)};const W=Object.fromEntries(Object.entries(M).map(([e,c])=>[e.replace(/\\s+/g," "),c]));const S=new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","CODE","PRE"]);function z(){try{const a=[globalThis.__CLAUDE_CN_LOCALE,document.documentElement.lang,navigator.language,localStorage.getItem("locale"),localStorage.getItem("claude_locale")].filter(Boolean).join("|").toLowerCase();return a.includes("zh-cn")||a.includes("zh_hans")||a.includes("zh-hans")}catch{return false}}function p(v){if(!v)return v;const t=v.trim();if(!t)return v;if(!z())return v;const m=M[t]||W[t.replace(/\\s+/g," ")];return m?v.replace(t,m):v}function n(o){const e=o.parentElement;if(!e||S.has(e.tagName)||e.closest?.("[contenteditable=true],[contenteditable=''],[role=textbox]"))return;const v=p(o.nodeValue);if(v!==o.nodeValue)o.nodeValue=v}function a(e){for(const r of ["aria-label","aria-description","aria-valuetext","placeholder","title"]){const v=e.getAttribute?.(r);if(v){const m=p(v);m!==v&&e.setAttribute(r,m)}}}function w(root=document.body){try{const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let o;o=tw.nextNode();)n(o);root.querySelectorAll?.("[aria-label],[aria-description],[aria-valuetext],[placeholder],[title]").forEach(a)}catch{}}new MutationObserver(ms=>{for(const m of ms){m.type==="characterData"&&n(m.target);m.type==="attributes"&&a(m.target);m.addedNodes&&m.addedNodes.forEach(o=>{o.nodeType===3?n(o):o.nodeType===1&&w(o)})}}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-label","aria-description","aria-valuetext","placeholder","title"]});document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>w()):w();setInterval(w,1500)})();`;
  let total = 0;
  for (const file of jsFiles(assetsDir)) {
    if (!path.basename(file).startsWith("index-")) continue;
    const source = fs.readFileSync(file, "utf8");
    const cleaned = source.replace(
      /^;\(\(\)=>\{const k="__CLAUDE_CN_DOM_TRANSLATOR(?:_V\d+)?__";[^\n]*\}\)\(\);\n/gm,
      ""
    );
    if (cleaned.includes("__CLAUDE_CN_DOM_TRANSLATOR_V5__")) continue;
    backup(file);
    fs.writeFileSync(file, script + "\n" + cleaned);
    total++;
  }
  log(`运行时语言细节修正: 注入 ${total} 处`);
}

function installZhCnJson() {
  const source = path.join(repoRoot, "data", "zh-CN.json");
  const english = path.join(i18nDir, "en-US.json");
  const target = path.join(i18nDir, "zh-CN.json");
  ensureFile(source);
  ensureFile(english);
  const base = JSON.parse(fs.readFileSync(english, "utf8"));
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
  const overlay = JSON.parse(fs.readFileSync(source, "utf8"));
  const parsed = mergeTranslations(mergeTranslations(base, previous), overlay);
  applyKnownTranslationsFromEnglishResource(parsed, base);
  applyCurrentVersionTranslations(parsed);
  applyTechnicalTermPolicy(parsed, base);
  writeJson(target, parsed);
  maybeWriteZstdJson(target);
  log(`已更新 ${target}`);
}

function installStatsigLocale() {
  const statsigDir = path.join(i18nDir, "statsig");
  const english = path.join(statsigDir, "en-US.json");
  const target = path.join(statsigDir, "zh-CN.json");
  if (!fs.existsSync(english)) return;
  const parsed = JSON.parse(fs.readFileSync(english, "utf8"));
  writeJson(target, parsed);
  maybeWriteZstdJson(target);
  log(`已安装 statsig 中文 locale: ${target}`);
}

function installLocaleOverrides() {
  const target = path.join(i18nDir, "zh-CN.overrides.json");
  writeJson(target, {});
  maybeWriteZstdJson(target);
  log(`已安装中文 overrides: ${target}`);
}

function installDesktopLocaleFiles() {
  const source = path.join(i18nDir, "zh-CN.json");
  const target = path.join(resourcesDir, "zh-CN.json");
  ensureFile(source);
  backup(target);
  fs.copyFileSync(source, target);
  log(`已安装桌面中文资源: ${target}`);
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
  patchBootstrapLocaleBehavior();
  patchLanguageWhitelist();
  if (args.has("--cleanup-static-cn")) {
    restoreIntlDefaultMessagesForLanguageToggle();
    restoreStringLiteralsForLanguageToggle();
  }
  installRuntimeDomTranslator();

  if (args.has("--static-cn")) {
    patchIntlDefaultMessages();
    patchCurrentVersionStringLiterals();

    patchAssets([
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
}

function patchLanguageWhitelist() {
  const localeArrayPattern = /\[(?=[^\]]*"en-US")(?=[^\]]*"[a-z]{2}(?:-[A-Z0-9]{2,3})?")(?:\s*"[^"]+"\s*,?)+\]/g;
  let changed = 0;
  for (const file of jsFiles(assetsDir)) {
    let source = fs.readFileSync(file, "utf8");
    let next = source.replace(localeArrayPattern, (arrayText) => {
      if (arrayText.includes("\"zh-CN\"")) return arrayText;
      if (!arrayText.includes("\"en-US\"")) return arrayText;
      const localeCount = [...arrayText.matchAll(/"[a-z]{2}(?:-[A-Z0-9]{2,3})?"/g)].length;
      if (localeCount < 4) return arrayText;
      changed++;
      return arrayText.replace("\"en-US\"", "\"zh-CN\",\"en-US\"");
    });
    if (next !== source) {
      backup(file);
      fs.writeFileSync(file, next);
    }
  }
  log(`语言白名单: 注入 ${changed} 处`);
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
  {
    const source = fs.readFileSync(mainFile, "utf8");
    const cleaned = source
      .replace(/const __CLAUDE_CN_NATIVE_MENU_V\d+__=e=>\{.*?\};async function orA\(\)\{const e=Yr\?await WWr\(\):await zWr\(\);return aA\.Menu\.buildFromTemplate\(__CLAUDE_CN_NATIVE_MENU_V\d+__\(e\)\)\}/s, "async function orA(){const e=Yr?await WWr():await zWr();return aA.Menu.buildFromTemplate(e)}")
      .replace(/const __CLAUDE_CN_NATIVE_MENU_V\d+__=e=>\{.*?\};/s, "");
    if (cleaned !== source) fs.writeFileSync(mainFile, cleaned);
  }
  patchFile(mainFile, [
    ["label:\"启用主进程调试器\"", "label:\"Enable Main Process Debugger\""],
    ["label:\"记录性能跟踪\"", "label:\"Record Performance Trace\""],
    ["label:\"写入主进程堆快照\"", "label:\"Write Main Process Heap Snapshot\""],
    ["label:\"记录内存跟踪（自动停止）\"", "label:\"Record Memory Trace (auto-stop)\""],
    ["{role:\"minimize\",label:\"最小化\"}", "{role:\"minimize\"}"],
    ["{role:\"front\",label:\"全部置于前台\"}", "{role:\"front\"}"],
    ["{role:\"services\",label:\"服务\"}", "{role:\"services\"}"],
    ["{role:\"hide\",label:\"隐藏 Claude\"}", "{role:\"hide\"}"],
    ["{role:\"hideOthers\",label:\"隐藏其他\"}", "{role:\"hideOthers\"}"],
    ["{role:\"unhide\",label:\"显示全部\"}", "{role:\"unhide\"}"]
  ]);
  const nativeMenuTranslations = {
    "Check for Updates…": "检查更新…",
    "Check for Updates...": "检查更新…",
    "Reload This Page": "重新加载此页面",
    "Configure Third-Party Inference…": "配置第三方推理…",
    "Configure Third-Party Inference...": "配置第三方推理…",
    "Extensions": "扩展",
    "Install Extension…": "安装扩展…",
    "Install Extension...": "安装扩展…",
    "Install Unpacked Extension…": "安装未打包扩展…",
    "Install Unpacked Extension...": "安装未打包扩展…",
    "Open Extensions Folder…": "打开扩展文件夹…",
    "Open Extensions Folder...": "打开扩展文件夹…",
    "Open Extension Settings Folder…": "打开扩展设置文件夹…",
    "Open Extension Settings Folder...": "打开扩展设置文件夹…",
    "Show All Dev Tools": "显示所有开发者工具",
    "Troubleshooting": "故障排除",
    "Show Logs in Finder": "在 Finder 中显示日志",
    "Show Cowork Session Data in Finder": "在 Finder 中显示 Cowork 会话数据",
    "Copy Installation ID": "复制安装 ID",
    "Generate Diagnostic Report": "生成诊断报告",
    "Record Net Log (30s)": "记录网络日志（30 秒）",
    "Disable Hardware Acceleration": "停用硬件加速",
    "Enable Cowork VM Debug Logging": "启用 Cowork VM 调试日志",
    "Enable Cowork SDK Debugging": "启用 Cowork SDK 调试",
    "Delete Cowork VM Bundle and Restart…": "删除 Cowork VM 包并重启…",
    "Delete Cowork VM Bundle and Restart...": "删除 Cowork VM 包并重启…",
    "Delete Cowork VM Sessions and Restart…": "删除 Cowork VM 会话并重启…",
    "Delete Cowork VM Sessions and Restart...": "删除 Cowork VM 会话并重启…",
    "File": "文件",
    "Edit": "编辑",
    "View": "视图",
    "Developer": "开发者",
    "Window": "窗口",
    "Help": "帮助",
    "New Conversation": "新建对话",
    "New Chat": "新聊天",
    "New Task": "新任务",
    "New Session": "新会话",
    "Settings": "设置",
    "Settings...": "设置...",
    "Settings…": "设置...",
    "Close Window": "关闭窗口",
    "Exit": "退出",
    "Quit": "退出",
    "Undo": "撤销",
    "Redo": "重做",
    "Cut": "剪切",
    "Copy": "复制",
    "Paste": "粘贴",
    "Select All": "全选",
    "Find": "查找",
    "Reload": "重新加载",
    "Force Reload": "强制重新加载",
    "Back": "后退",
    "Forward": "前进",
    "Actual Size": "实际大小",
    "Zoom In": "放大",
    "Zoom Out": "缩小",
    "Toggle Full Screen": "切换全屏",
    "Copy URL": "复制 URL",
    "Show Main Window": "显示主窗口",
    "Show App": "显示应用",
    "Claude Help": "Claude 帮助",
    "Get Support": "获取支持",
    "About Claude": "关于 Claude",
    "About...": "关于...",
    "About…": "关于...",
    "Open Documentation": "打开文档",
    "Clear Cache and Restart": "清除缓存并重启",
    "Reset App Data...": "重置应用数据...",
    "Reset App Data…": "重置应用数据...",
    "App Features": "应用功能",
    "Load Remote Claude.ai": "加载远程 Claude.ai",
    "Load Local Claude.ai": "加载本地 Claude.ai",
    "Open MCP Log File": "打开 MCP 日志文件",
    "Open MCP Log File...": "打开 MCP 日志文件...",
    "Open MCP Log File…": "打开 MCP 日志文件...",
    "Reload MCP Configuration": "重新加载 MCP 配置",
    "View Process Logs": "查看进程日志",
    "Show Dev Tools": "显示开发者工具",
    "Enable Main Process Debugger": "启用主进程调试器",
    "Record Performance Trace": "记录性能跟踪",
    "Write Main Process Heap Snapshot": "写入主进程堆快照",
    "Record Memory Trace (auto-stop)": "记录内存跟踪（自动停止）",
    "Open App Config File...": "打开应用配置文件...",
    "Open App Config File…": "打开应用配置文件...",
    "Open Developer Config File...": "打开开发者配置文件...",
    "Open Developer Config File…": "打开开发者配置文件...",
    "Quit Claude": "退出 Claude"
  };
  const nativeRoleTranslations = {
    "about": "关于 Claude",
    "services": "服务",
    "hide": "隐藏 Claude",
    "hideOthers": "隐藏其他",
    "unhide": "显示全部",
    "quit": "退出 Claude",
    "close": "关闭",
    "minimize": "最小化",
    "zoom": "缩放",
    "front": "全部置于前台",
    "window": "窗口",
    "undo": "撤销",
    "redo": "重做",
    "cut": "剪切",
    "copy": "复制",
    "paste": "粘贴",
    "selectAll": "全选",
    "reload": "重新加载",
    "forceReload": "强制重新加载",
    "toggleDevTools": "切换开发者工具",
    "togglefullscreen": "切换全屏",
    "resetZoom": "实际大小",
    "zoomIn": "放大",
    "zoomOut": "缩小"
  };
  const nativeMenuPatch = `const __CLAUDE_CN_NATIVE_MENU_V3__=e=>{const M=${JSON.stringify(nativeMenuTranslations)};const R=${JSON.stringify(nativeRoleTranslations)};function z(){try{const c=typeof qs=="function"?qs():{};const a=[];try{a.push(aA?.app?.getLocale?.())}catch{}try{a.push(aA?.app?.getPreferredSystemLanguages?.()?.join("|"))}catch{}try{a.push(c&&c.locale)}catch{}const l=a.filter(Boolean).join("|").toLowerCase();return l.includes("zh-cn")||l.includes("zh_hans")||l.includes("zh-hans")}catch{return false}}function d(v){if(typeof v!="string")return v;let s=v;s=s.replace(/\\bOpenAI Official\\b/g,"OpenAI 官方");s=s.replace(/\\bOfficial\\b/g,"官方");s=s.replace(/\\bh\\s*(\\d+)%/g,"小时$1%");s=s.replace(/\\bw\\s*(\\d+)%/g,"周$1%");return s}function p(v){if(typeof v!="string")return v;const t=v.trim();const m=M[t];if(m)return v.replace(t,m);const parts=v.split(" · ");if(parts.length>1)return parts.map(x=>{const y=x.trim();return M[y]||d(x)}).join(" · ");return d(v)}function w(o){if(Array.isArray(o)){for(const i of o)w(i);return o}if(o&&typeof o=="object"){if(o.label)o.label=p(o.label);else if(o.role&&R[o.role])o.label=R[o.role];if(o.sublabel)o.sublabel=p(o.sublabel);if(o.submenu)w(o.submenu)}return o}return z()?w(e):e};`;
  const nativeOriginal = "async function orA(){const e=Yr?await WWr():await zWr();return aA.Menu.buildFromTemplate(e)}";
  const nativeReplacement = `${nativeMenuPatch}async function orA(){const e=Yr?await WWr():await zWr();return aA.Menu.buildFromTemplate(__CLAUDE_CN_NATIVE_MENU_V3__(e))}`;
  backup(mainFile);
  let mainSource = fs.readFileSync(mainFile, "utf8");
  let nativeMenuChanged = 0;
  if (mainSource.includes(nativeOriginal)) {
    mainSource = mainSource.replace(nativeOriginal, nativeReplacement);
    nativeMenuChanged = 1;
  } else {
    const patchedNativeMenu = /const __CLAUDE_CN_NATIVE_MENU_V\d+__=e=>\{[\s\S]*?\};async function orA\(\)\{const e=Yr\?await WWr\(\):await zWr\(\);return aA\.Menu\.buildFromTemplate\(__CLAUDE_CN_NATIVE_MENU_V\d+__\(e\)\)\}/;
    if (patchedNativeMenu.test(mainSource)) {
      mainSource = mainSource.replace(patchedNativeMenu, nativeReplacement);
      nativeMenuChanged = 1;
    }
  }
  if (nativeMenuChanged > 0) {
    fs.writeFileSync(mainFile, mainSource);
    log("index.js: 菜单汉化补丁已更新");
  } else if (!mainSource.includes("__CLAUDE_CN_NATIVE_MENU_V3__")) {
    log("index.js: 未命中菜单汉化入口");
  }
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

function signPatchedApp() {
  const entitlements = path.join(repoRoot, "scripts", "claude-entitlements.plist");
  cleanBundleRootJunk();
  execFileSync("codesign", ["--force", "--deep", "--options", "runtime", "--entitlements", entitlements, "--sign", "-", appPath], { stdio: "ignore" });
  log("已完成本地签名");
}

function writeLocaleConfigs() {
  for (const appSupportName of ["Claude", "Claude-3p"]) {
    const dir = path.join(os.homedir(), "Library", "Application Support", appSupportName);
    const file = path.join(dir, "config.json");
    let config = {};
    if (fs.existsSync(file)) {
      try {
        config = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
    }
    config.locale = "zh-CN";
    delete config.language;
    delete config.gated_messages;
    writeJson(file, config);
    log(`已写入 locale 配置: ${file}`);
  }
  try {
    const languages = ["zh-CN", "zh-Hans", "en-US"];
    for (const domain of ["com.anthropic.claudefordesktop", "com.anthropic.Claude"]) {
      execFileSync("defaults", ["write", domain, "AppleLanguages", "-array", ...languages], { stdio: "ignore" });
    }
    log(`已写入 macOS Claude AppleLanguages: ${languages.join(", ")}`);
  } catch {}
}

function clearQuarantine() {
  try {
    execFileSync("xattr", ["-dr", "com.apple.quarantine", appPath], { stdio: "ignore" });
    log("已清除 quarantine 标记");
  } catch {}
}

function refreshLaunchServices() {
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (!fs.existsSync(lsregister)) return;
  try {
    execFileSync(lsregister, ["-f", appPath], { stdio: "ignore" });
    log("已刷新 LaunchServices 注册");
  } catch {}
}

function clearRendererCaches() {
  const cacheNames = new Set(["Cache", "Code Cache", "GPUCache", "CacheStorage"]);
  function removeCachesUnder(dir, depth = 0) {
    if (!fs.existsSync(dir) || depth > 6) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (cacheNames.has(entry.name)) {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      removeCachesUnder(full, depth + 1);
    }
  }
  for (const base of ["Claude-3p", "Claude"]) {
    const dir = path.join(os.homedir(), "Library", "Application Support", base);
    for (const rel of ["Cache", "Code Cache", "GPUCache", path.join("Service Worker", "CacheStorage")]) {
      fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    }
    removeCachesUnder(dir);
  }
}

function restartClaude() {
  try {
    execFileSync("osascript", ["-e", "tell application \"Claude\" to quit"], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("pkill", ["-x", "Claude"], { stdio: "ignore" });
  } catch {}
  clearRendererCaches();
  clearQuarantine();
  refreshLaunchServices();
  execFileSync("open", [appPath]);
  log("已重启 Claude");
}

async function main() {
  ensureDir(appPath);
  ensureDir(resourcesDir);
  ensureDir(assetsDir);
  ensureDir(i18nDir);
  installZhCnJson();
  installLocaleOverrides();
  installStatsigLocale();
  installDesktopLocaleFiles();
  writeLocaleConfigs();
  installInfoPlistStrings();
  patchRendererAssets();
  await patchAsarMainProcess();
  signPatchedApp();
  clearQuarantine();
  refreshLaunchServices();
  log(`备份目录：${backupDir}`);
  if (restartAfterPatch) restartClaude();
  else log("补丁完成。请重启 Claude 让修改生效。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
