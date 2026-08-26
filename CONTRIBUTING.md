# 贡献指南

感谢你愿意为 **MermaidEditor** 贡献代码！这是一个完全离线的 Visio 风格 Mermaid 桌面编辑器，基于 Electron + Vue 3 + Naive UI 构建。

在参与贡献之前，请先阅读 [行为准则](./CODE_OF_CONDUCT.md)。

## 如何贡献

### 报告 Bug

1. 先搜索 [Issues](https://github.com/Esdrin/MermaidEditer/issues)，确认是否已有人报告过相同问题
2. 创建 Issue 时请尽量包含：
   - 操作系统与版本（Windows / Linux / macOS）
   - 复现步骤（越具体越好）
   - 期望行为与实际行为
   - 相关截图或 Mermaid 源码片段
   - 控制台报错信息（如有）

### 提出功能建议

- 在 Issues 中新建「Feature request」类型的 Issue
- 说明使用场景与期望效果，方便讨论实现方案

### 提交代码（Pull Request）

1. **Fork** 本仓库，从 `master` 分支创建你的功能分支（例如 `feature/xxx`、`fix/xxx`）
2. 本地开发调试（见下方「本地开发」）
3. 提交前请自查：
   - 代码风格与现有代码保持一致
   - 新增功能有相应的说明（README 或注释）
   - 不破坏已有功能（自由画布 / 双向同步 / 实时渲染等）
4. 发起 Pull Request，描述改动内容、动机与测试情况
5. 等待 review，按反馈修改

## 本地开发

环境要求：**Node.js 18+**

```bash
# 克隆仓库
git clone https://github.com/Esdrin/MermaidEditer.git
cd MermaidEditer

# 安装依赖
npm install

# 启动应用
npm start
```

> `node_modules/` 不随仓库保存，克隆后需先 `npm install` 重建依赖。

## 代码结构速览

- `main.js` — Electron 主进程（窗口、文件对话框、导出写盘）
- `preload.js` — 上下文隔离桥（window.api）
- `renderer/js/canvas.js` — 自由画布引擎（draw.io 式直接操作 + 源码双向同步）
- `renderer/js/render.js` — mermaid 渲染、点击映射、缩放、画布布局坐标
- `renderer/js/editor.js` — 代码编辑器（行号 + 撤销历史）
- `renderer/js/app.js` — 主控制器（功能区、拖放、文件、快捷键、草稿）

完整结构见 [README](README.md#项目结构)。

## 风格约定

- 中文注释，变量命名使用英文
- 渲染 / 画布相关的核心改动请先在本地充分测试
- 提交信息建议使用简洁的祈使句（如 `fix: 修复缩放锚点偏移`）

## 提问与讨论

- 使用 [Discussions](https://github.com/Esdrin/MermaidEditer/discussions) 或 Issues 进行讨论
- 遇到不确定的改动，先开 Issue 讨论再动手，避免白做

再次感谢你的贡献！
