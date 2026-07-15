# B站字幕提取器（Edge）

一个 Edge Manifest V3 扩展：直接读取当前 B站视频的官方或 AI 字幕，并一键添加为 Obsidian Markdown 笔记。

## 快速使用

1. 在 Edge 打开 `edge://extensions/`，开启“开发人员模式”，选择“加载解压缩的扩展”，并选中本仓库目录。
2. 打开任意已加载完成的 B 站视频页，点击工具栏中的“B站字幕提取器”。插件会自动读取当前分 P 的官方或 AI 字幕。
3. 如有多个分 P 或字幕轨，在弹窗中切换后重新提取；可复制笔记、复制纯文本，或下载 `.md` / `.srt`。
4. 点击“添加到 Obsidian”。首次可选择 Vault 根目录，或直接选择如 `Sources`、`Inbox` 的子文件夹；选择子文件夹时，再选择它所属的 Vault 根目录。
5. 第一次跳转时点击“打开 Obsidian”，并在 Edge 提示中允许打开。之后保存会自动打开新建笔记。

生成的笔记使用视频标题命名，包含可播放的 B 站嵌入视频、来源链接、视频信息和带时间轴的原始字幕。Properties 使用 `title`、`source`、`author`、`published`、`created`、`description` 和 `clippings` 标签。

## 隐私

详见 [PRIVACY.md](PRIVACY.md)。扩展不上传字幕或笔记，不读取、导出或保存 Cookie、token、密码和账号资料。

## 已实现

- 在当前打开的 `bilibili.com` 视频标签页中一键提取；短链接会由 B 站页面重定向后再提取。
- 自动识别多分P，切换分P后重新提取。
- 提取 B站提供的官方/AI 多语言字幕轨。
- 预览带时间轴字幕，复制纯文本或完整 Obsidian 笔记。
- 下载 `.md`、`.srt`。
- 首次选择 Obsidian 目录后，一键新建 Markdown 笔记。
- 使用 YAML Properties 保存来源、UP主、发布日期、BV号、分P、字幕语言、时长、提取时间和标签。
- 同名文件自动添加 `-2`、`-3`，不会覆盖已有笔记。

## 安装到 Edge

1. 在 Edge 地址栏打开 `edge://extensions/`。
2. 打开左侧的“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择下载或克隆后的仓库根目录（其中必须包含 `manifest.json`）：

   ```text
   bilibili-subtitle-edge/
   ```

4. 将“B站字幕提取器”固定到工具栏。

当前提供的是“加载解压缩的扩展”安装方式：不需要扩展商店审核，也不会将代码或字幕数据上传到扩展商店。

## 首次添加到 Obsidian

1. 打开任意 B站视频，点击插件图标，字幕会自动提取。
2. 点击“添加到 Obsidian”。首次点击会直接弹出目录选择器，请选择 **Obsidian Vault 根目录**：

   ```text
   <你的 Vault>
   ```

   不要选择 Vault 内的 `Sources`、`Inbox` 等子文件夹；插件会检查其中是否存在 `.obsidian`，以避免跳转到不存在的 Vault。

3. 目录会成为默认保存位置；以后点击“添加到 Obsidian”会直接新建笔记，并打开这篇笔记，无需再设置。

选择 Vault 根目录会授予更大的写入范围，但能让插件通过 Obsidian URI 准确打开刚保存的笔记。目录句柄保存在扩展自己的 IndexedDB；代码不遍历目录，也不读取已有笔记。

### 保存到 Vault 子文件夹

保存位置可以是 Vault 根目录，也可以是 `Sources`、`Inbox` 等任意子文件夹。首次选择子文件夹后，插件会补充要求选择该文件夹所属的 Vault 根目录，并用目录句柄计算相对路径；不会遍历或读取既有笔记内容。

### 首次 Obsidian 跳转授权

首次成功写入笔记后，插件会停留在当前弹窗并显示“打开 Obsidian”。点击该按钮，并在 Edge 的外部应用提示中允许打开；这是浏览器对外部应用调用的首次确认，不能被插件代替。首次点击后弹窗仍会保留，方便完成授权；完成一次后，后续保存会自动跳转到刚创建的笔记并关闭弹窗。

## 使用方式

1. 确保你在**同一个 Edge 配置文件**中登录过 B站。插件不会另开登录窗口。
2. 点击插件图标，自动提取当前视频。
3. 如有多个分P或字幕轨，在下拉框中选择。
4. 点击“添加到 Obsidian”；也可复制笔记、复制纯文本或下载 `.md` / `.srt`。

插件直接读取当前 B站视频页，并由扩展后台下载 B站字幕 CDN 的文件。它不会申请 Cookie 权限，也不会读取 Cookie、localStorage 或账号资料。

## 笔记结构

```markdown
---
title: "视频标题"
source: "https://www.bilibili.com/video/BV..."
author: "UP主"
published: "2026-07-01T00:00:00.000Z"
bvid: "BV..."
part: "分P标题"
subtitle_language: "中文（自动生成）"
duration_seconds: 600
created: "2026-07-14T12:00:00.000Z"
tags:
  - bilibili
  - 视频笔记
summary: ""
---

# 视频标题

> [!abstract] 摘要
> 待总结。

## 我的笔记

- 

## 原始字幕

- [00:00:00] 字幕内容
```

## 边界与故障排查

- 插件只能提取 B站已经提供的官方或 AI 字幕。视频本身没有字幕时，需要额外做音频下载与语音识别；当前版本不会伪造空字幕。
- 会员、课程、地区限制或已失效视频仍受 B站原有访问权限约束。
- 若提示字幕为空，先在同一 Edge 配置文件中正常打开该视频，确认播放器的 CC 字幕确实存在，然后重试。
- 插件会区分“视频确实无字幕”和“字幕需要登录态”。后者表示扩展没有从当前 Edge 配置文件获得可用会话，不会自动弹出登录页或复制 Cookie。
- 若 Obsidian 保存提示需要授权，点击保存区域的“更改”重新选择或授权同一目录；下载 `.md` 始终可作为兜底。
- 插件不会绕过验证码、风控、登录限制或视频权限。

## 本地验证

在此目录运行：

```powershell
npm test
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest.json OK')"
node --check background.js
node --check popup.js
node --check lib/core.js
node --check lib/vault.js
```

测试覆盖链接校验、字幕清洗、时间轴、SRT、Obsidian Properties、文件名安全、目录权限和同名文件防覆盖。

## 发布到 GitHub 前

1. 运行 `npm test`，确认所有测试通过。
2. 确认 `manifest.json` 与 `package.json` 的版本号一致。
3. 选择并添加开源许可证，再创建 GitHub 仓库并推送代码。

仓库已包含 `.gitignore`，不会提交依赖目录、系统缓存或本地打包文件。

## 许可证

本项目采用 [MIT License](LICENSE)，允许使用、修改、分发及商业使用，但不提供担保。

## 项目结构

```text
manifest.json       Edge Manifest V3 配置
background.js       当前 B站页面读取、字幕下载与本地状态
popup.html/js/css   字幕提取、预览、复制和保存界面
lib/core.js         链接、字幕和导出格式的纯函数
lib/vault.js        目录句柄和安全写入
tests/              Node.js 单元测试
```

## 设计参考

笔记流参考 Obsidian Web Clipper 的模板、Properties、Vault/文件夹和本地 Markdown 保存模型：

- <https://obsidian.md/help/web-clipper/capture>
- <https://obsidian.md/help/web-clipper/templates>
- <https://obsidian.md/help/web-clipper/variables>
