# 项目约定

## Obsidian 保存目录交互

- 首次点击“添加到 Obsidian”时，只允许打开一次系统目录选择器；用户应直接选择最终写入目录，确认后必须继续完成当前笔记写入。
- 不得要求用户先选 Vault 根目录、再选子目录，也不得改用手工路径输入。
- File System Access API 无法从子目录句柄反查父级目录；缺少 Vault 根目录信息时，只影响 Obsidian URI 自动跳转，不得阻止 Markdown 文件写入。
- 修改目录交互后，测试必须断言 `popup.js` 只有一次 `showDirectoryPicker` 调用，且弹窗中不存在独立的 Vault 根目录选择按钮。
- 解析 B 站视频身份时必须使用 `URL.pathname` 和 `URLSearchParams` 读取路径段或参数值，不得用整条 URL 正则扫描 BV 号，以免把 `bvid` 参数名当成视频编号。
- 新增 B 站特殊播放页面支持时，必须同时覆盖“URL 规范化”和“页面存在其他视频旧状态”的回归测试。
- 每次扩展行为变更都同步更新 `manifest.json`、`package.json` 和 `CHANGELOG.md` 的版本信息。
