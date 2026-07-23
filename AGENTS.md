# 项目约定

## Obsidian 保存目录交互

- 首次点击“添加到 Obsidian”时，只允许打开一次系统目录选择器；用户应直接选择最终写入目录，确认后必须继续完成当前笔记写入。
- 不得要求用户先选 Vault 根目录、再选子目录，也不得改用手工路径输入。
- File System Access API 无法从子目录句柄反查父级目录；缺少 Vault 根目录信息时，只影响 Obsidian URI 自动跳转，不得阻止 Markdown 文件写入。
- 修改目录交互后，测试必须断言 `popup.js` 只有一次 `showDirectoryPicker` 调用，且弹窗中不存在独立的 Vault 根目录选择按钮。
- 每次扩展行为变更都同步更新 `manifest.json`、`package.json` 和 `CHANGELOG.md` 的版本信息。
