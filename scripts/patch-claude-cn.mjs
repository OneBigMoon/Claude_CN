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
  const script = `;(()=>{const k="__CLAUDE_CN_DOM_TRANSLATOR_V3__";if(globalThis[k])return;globalThis[k]=true;const M=${JSON.stringify(dictionary)};const R=Object.fromEntries(Object.entries(M).map(([e,c])=>[c,e]));const S=new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","CODE","PRE"]);function z(){try{const a=[globalThis.__CLAUDE_CN_LOCALE,document.documentElement.lang,navigator.language,localStorage.getItem("locale"),localStorage.getItem("claude_locale")].filter(Boolean).join("|").toLowerCase();return a.includes("zh-cn")||a.includes("zh_hans")||a.includes("zh-hans")}catch{return false}}function p(v){if(!v)return v;const t=v.trim();if(!t)return v;if(!z())return v;const m=M[t];return m?v.replace(t,m):v}function n(o){const e=o.parentElement;if(!e||S.has(e.tagName)||e.closest?.("[contenteditable=true],[contenteditable=''],[role=textbox]"))return;const v=p(o.nodeValue);if(v!==o.nodeValue)o.nodeValue=v}function a(e){for(const r of ["aria-label","aria-description","aria-valuetext","placeholder","title"]){const v=e.getAttribute?.(r);if(v){const m=p(v);m!==v&&e.setAttribute(r,m)}}}function w(root=document.body){try{const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let o;o=tw.nextNode();)n(o);root.querySelectorAll?.("[aria-label],[aria-description],[aria-valuetext],[placeholder],[title]").forEach(a)}catch{}}new MutationObserver(ms=>{for(const m of ms){m.type==="characterData"&&n(m.target);m.type==="attributes"&&a(m.target);m.addedNodes&&m.addedNodes.forEach(o=>{o.nodeType===3?n(o):o.nodeType===1&&w(o)})}}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-label","aria-description","aria-valuetext","placeholder","title"]});document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>w()):w();setInterval(w,1500)})();`;
  let total = 0;
  for (const file of jsFiles(assetsDir)) {
    if (!path.basename(file).startsWith("index-")) continue;
    const source = fs.readFileSync(file, "utf8");
    const cleaned = source.replace(
      /^;\(\(\)=>\{const k="__CLAUDE_CN_DOM_TRANSLATOR(?:_V\d+)?__";[^\n]*\}\)\(\);\n/gm,
      ""
    );
    if (cleaned.includes("__CLAUDE_CN_DOM_TRANSLATOR_V3__")) continue;
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
  const nativeMenuPatch = `const __CLAUDE_CN_NATIVE_MENU_V2__=e=>{const M=${JSON.stringify(nativeMenuTranslations)};const R=${JSON.stringify(nativeRoleTranslations)};function z(){try{const c=typeof qs=="function"?qs():{};const a=[];try{a.push(aA?.app?.getLocale?.())}catch{}try{a.push(aA?.app?.getPreferredSystemLanguages?.()?.join("|"))}catch{}try{a.push(c&&c.locale)}catch{}const l=a.filter(Boolean).join("|").toLowerCase();return l.includes("zh-cn")||l.includes("zh_hans")||l.includes("zh-hans")}catch{return false}}function p(v){if(typeof v!="string")return v;const t=v.trim();const m=M[t];return m?v.replace(t,m):v}function w(o){if(Array.isArray(o)){for(const i of o)w(i);return o}if(o&&typeof o=="object"){if(o.label)o.label=p(o.label);else if(o.role&&R[o.role])o.label=R[o.role];if(o.sublabel)o.sublabel=p(o.sublabel);if(o.submenu)w(o.submenu)}return o}return z()?w(e):e};`;
  patchFile(mainFile, [[
    "async function orA(){const e=Yr?await WWr():await zWr();return aA.Menu.buildFromTemplate(e)}",
    `${nativeMenuPatch}async function orA(){const e=Yr?await WWr():await zWr();return aA.Menu.buildFromTemplate(__CLAUDE_CN_NATIVE_MENU_V2__(e))}`
  ]]);
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
