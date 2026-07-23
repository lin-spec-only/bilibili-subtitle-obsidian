# B站字幕提取器（Edge）

一个 Edge Manifest V3 扩展：优先读取当前 B站视频的官方或 AI 字幕；没有字幕时可调用本机 Whisper 识别音频，并一键添加为 Obsidian Markdown 笔记。

## 快速使用

1. 在 Edge 打开 `edge://extensions/`，开启“开发人员模式”，选择“加载解压缩的扩展”，并选中本仓库目录。
2. 打开任意已加载完成的 B 站视频页，点击工具栏中的“B站字幕提取器”。插件会自动读取当前分 P 的官方或 AI 字幕。
3. 如有多个分 P 或字幕轨，在弹窗中切换后重新提取；可复制笔记、复制纯文本，或下载 `.md` / `.srt`。
4. 视频没有字幕时，先启动本地 ASR 服务，再点击“开始本地转写”。
5. 点击“添加到 Obsidian”，直接选择 `Sources` 等最终保存文件夹并确认；插件会立即写入并记住该目录。

生成的笔记使用视频标题命名，包含可播放的 B 站嵌入视频、来源链接、视频信息和带时间轴的原始字幕。Properties 使用 `title`、`source`、`author`、`published`、`created`、`description` 和 `clippings` 标签。

## 0.4.8 本版本新增

- 更新扩展封面图标，统一使用字幕气泡、播放符号和 Obsidian 晶体视觉元素。

### 0.4.7

- 支持直接从 B 站“稍后再看”播放页提取当前视频字幕，插件会读取 URL 中真实的 `bvid` 并转换为对应的视频地址。
- 修复稍后再看链接中的参数名被误认成 BV 号，进而显示上一次视频链接或读取不到当前字幕的问题。

### 0.4.6

- 字幕提取按当前视频的 `aid + cid` 请求播放器接口；当前接口明确返回空字幕时直接判定为无字幕，不再混入其他视频、其他分 P 或旧页面残留字幕。
- 视频没有官方或 AI 字幕时，可启动本机 faster-whisper 服务进行转写，支持进度显示、取消、恢复和字幕缓存。
- 添加到 Obsidian 时直接选择最终保存文件夹；首次确认后立即写入并记住目录，不再要求先选择 Vault 根目录或手工填写子目录。

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
- 无字幕时使用本地 faster-whisper 转写，支持进度、取消、恢复和字幕缓存。

## 无字幕视频：本地 AI 转写

项目和所有大体积数据均放在 D 盘：

```text
D:\Projects\bilibili-subtitle-edge    项目源码
D:\Tech_learn_envs\bilibili-asr       Python 环境
D:\AI_Models\faster-whisper           Whisper 模型
D:\BilibiliASR\cache                  转写字幕缓存
D:\BilibiliASR\tmp                    自动清理的临时音频
```

首次安装环境，在 PowerShell 运行：

```powershell
cd D:\Projects\bilibili-subtitle-edge
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-asr.ps1
```

每次需要转写前启动服务，并保持窗口打开：

```powershell
cd D:\Projects\bilibili-subtitle-edge
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-asr.ps1
```

也可以直接双击项目目录中的 `start-asr.cmd`。若服务已经运行，脚本会直接提示，不会重复占用端口。

看到 `Uvicorn running on http://127.0.0.1:8766` 后即可打开扩展。首次真正转写会下载 Whisper `small` 模型到 D 盘，耗时取决于网络；后续复用本地模型和字幕缓存。端口 8765 已被本机其他服务使用，因此本项目固定使用 8766。

默认采用 CPU `int8`，兼容当前电脑的驱动环境。以后升级 NVIDIA 驱动并安装匹配的 CUDA 运行库后，可在启动前设置：

```powershell
$env:BILIBILI_ASR_DEVICE = "cuda"
$env:BILIBILI_ASR_COMPUTE_TYPE = "float16"
.\start-asr.ps1
```

不要在 CUDA 未配置完成时启用此选项。

## 安装到 Edge

1. 在 Edge 地址栏打开 `edge://extensions/`。
2. 打开左侧的“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择 D 盘仓库根目录（其中必须包含 `manifest.json`）：

   ```text
   D:\Projects\bilibili-subtitle-edge
   ```

4. 将“B站字幕提取器”固定到工具栏。

如果 Edge 仍加载旧的 C 盘版本，请先在扩展卡片中点击“移除”，再加载上述 D 盘目录。确认 D 盘版本 `0.4.8` 可用前，保留 `C:\Users\Lin\Desktop\bilibili-subtitle-edge` 作为回退副本。

当前提供的是“加载解压缩的扩展”安装方式：不需要扩展商店审核，也不会将代码或字幕数据上传到扩展商店。

## 首次添加到 Obsidian

1. 打开任意 B站视频，点击插件图标，字幕会自动提取。
2. 点击“添加到 Obsidian”，在系统选择器中直接选择最终保存文件夹，例如：

   ```text
   <你的 Vault>\Sources
   ```

3. 点击“选择文件夹”确认，笔记会立即写入该目录。保存位置会被记住，以后点击“添加到 Obsidian”即可直接保存。

需要换目录时点击“更改保存文件夹”，选择新的最终目标目录。

插件只保存用户明确选择的目标文件夹句柄，不需要授权整个 Vault，也不遍历目录或读取已有笔记。

### 保存到 Vault 子文件夹

直接选择 `Sources`、`Inbox` 或更深的目标子目录即可。浏览器不会向扩展暴露所选目录的完整本地路径或父目录，因此仅选择子目录时，插件负责写入文件但不会自动定位并打开刚保存的 Obsidian 笔记；直接选择 Vault 根目录或保留有旧版 Vault 信息时，仍可自动打开。

### 首次 Obsidian 跳转授权

当插件能够确定 Vault 名称和笔记相对路径时，首次成功写入后会显示“打开 Obsidian”。点击该按钮，并在 Edge 的外部应用提示中允许打开；完成一次后，后续保存会自动跳转。只选择 Vault 子目录时不影响文件保存，但不会显示此跳转。

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

- 插件优先提取 B站已经提供的官方或 AI 字幕。视频本身没有字幕时，可由用户主动启动本机语音转写；不会自动上传或后台转写。
- 会员、课程、地区限制或已失效视频仍受 B站原有访问权限约束。
- 若提示字幕为空，先在同一 Edge 配置文件中正常打开该视频，确认播放器的 CC 字幕确实存在，然后重试。
- 插件会区分“视频确实无字幕”和“字幕需要登录态”。后者表示扩展没有从当前 Edge 配置文件获得可用会话，不会自动弹出登录页或复制 Cookie。
- 若 Obsidian 保存提示需要授权，点击保存区域的“更改”重新选择或授权同一目录；下载 `.md` 始终可作为兜底。
- 插件不会绕过验证码、风控、登录限制或视频权限。
- 本地转写服务必须保持运行；若提示无法连接，请运行 `start-asr.ps1`。转写速度取决于视频时长和 CPU 性能。

## 本地验证

在此目录运行：

```powershell
npm test
D:\Tech_learn_envs\bilibili-asr\Scripts\python.exe -m unittest discover -s asr_service\tests -v
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
asr_service/        本机音频下载、Whisper 转写、任务和缓存服务
setup-asr.ps1       在 D 盘安装独立 Python 环境
start-asr.ps1       启动仅监听 127.0.0.1 的本地服务
start-asr.cmd       可双击的启动入口
tests/              Node.js 单元测试
```

## 设计参考

笔记流参考 Obsidian Web Clipper 的模板、Properties、Vault/文件夹和本地 Markdown 保存模型：

- <https://obsidian.md/help/web-clipper/capture>
- <https://obsidian.md/help/web-clipper/templates>
- <https://obsidian.md/help/web-clipper/variables>
