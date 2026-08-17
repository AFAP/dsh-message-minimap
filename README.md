# 用户消息导航条 · Message Minimap

<div align="center">
  <b>中文</b> · <a href="README.en.md">English</a>
</div>

> **在 DeepSeek Harness Web GUI 会话聊天窗的左边缘显示一条迷你导航条：每一条你发送的消息都是刻度，悬停看摘要，点击即跳转，拖动可快速扫读长会话。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 1. 它解决了什么问题

长会话里想回看"我之前是怎么说的"时，只能一路滚轮硬翻。AI 的回复往往又长又密，自己发过的消息被埋在中间很难找。

本插件在聊天窗**左边缘**加一条细导航条（类似 VS Code 的 minimap）：

```
聊天滚动窗 (overflow-y: auto)
  │  每条用户消息 = 一个刻度（data-chat-flow-kind="user"）
  │  半透明滑块 = 当前可视区域
  │
  ▼  悬停刻度 → 预览卡片（第几条 / 共几条 + 消息摘要）
  ▼  点击刻度 → 平滑滚动到该消息
  ▼  点击/拖动轨道 → 按比例跳转
```

**纯前端、只读**：插件不新增任何 HTTP 路由，不读写文件，只读取浏览器中已渲染的会话 DOM（聊天节点带有稳定的 `data-chat-flow-kind` / `data-chat-flow-key` 锚点），滚动的是既有的聊天滚动容器。宿主半部是空实现，仅为让 client 模块系统发现 `dsh.client` 声明。

## 2. 功能特性

- ✅ 聊天窗左侧固定一条 16px 宽的导航条，位置/高度与滚动窗严格对齐。
- ✅ **每条用户消息一个刻度**，按内容比例定位（上旧下新）。
- ✅ **可视区域滑块**随滚动实时移动。
- ✅ **悬停刻度**弹出预览卡片：`我的消息 · 3 / 12` + 消息文本摘要（最多 140 字符、7 行）。
- ✅ **点击刻度**平滑滚动到该消息（停靠在视口上方约 18% 处）。
- ✅ **点击/按住拖动轨道背景**按比例跳转，像滚动条一样快速扫读。
- ✅ 流式输出、加载历史、切换会话、窗口缩放时自动跟随（MutationObserver + scroll/resize + 轮询兜底）。
- ✅ 内容未溢出、无用户消息、或在新会话引导页时自动隐藏，不干扰布局。
- ✅ 中英双语界面文案，跟随界面语言。
- ✅ 键盘可达：刻度是原生 `<button>`，可 Tab 聚焦后回车跳转。

**MVP 暂不支持**：不标注 AI 消息/错误/分支；不做按文本搜索刻度；不做持久化开关（始终自动显示/隐藏）。

## 3. 目录结构

```
dsh-message-minimap/   # 仓库根 = npm 包根
├── package.json            # dsh.bundle.patch + dsh.client（浏览器端声明）+ exports["./client"]
├── cordis.patch.yml        # 组合行：仅插入一行插件记录（无路由、无配置）
├── LICENSE                 # MIT
└── lib/
    ├── index.js            # 宿主半部：刻意的空实现（零依赖），只为让 Loader 发现本包
    └── client.js           # 浏览器 bundle：导航条（conversation.session.header.utilities 挂载）
```

## 4. 快速开始

一键安装（GitHub）：

```powershell
dsh plugin --profile web add github:AFAP/dsh-message-minimap
```

然后**重启 `dsh web`** 生效。

> 安装后插件位于 `$DSH_HOME\profiles\web\node_modules\dsh-message-minimap`（pnpm 从 GitHub 克隆），与源码仓库位置无关。

升级：

```powershell
dsh plugin --profile web update dsh-message-minimap
```

卸载：

```powershell
dsh plugin --profile web remove dsh-message-minimap
```

### 从源码目录手动安装（等价验证用）

```powershell
dsh plugin --profile web add "D:\path\to\dsh-message-minimap"
```

### 验证是否加载成功

打开一个**有多条往返消息、内容已溢出可滚动**的会话 → 聊天窗左边缘出现一条带刻度的细条，悬停刻度能看到消息摘要即可。

## 5. 使用

1. 打开任意历史会话（或聊到内容超过一屏）。
2. 看左边缘导航条：灰色半透明块是**当前可视区域**，小刻度是**你发过的每条消息**。
3. **悬停刻度**：右侧弹出预览卡，显示"我的消息 · n / 总数"与消息开头内容。
4. **点击刻度**：平滑滚动到那条消息。
5. **点击或按住拖动刻度以外的轨道**：按比例跳转（等价于滚动条拖拽）。
6. 会话太短（不足一屏）、没有用户消息、或在空白新会话页时，导航条自动隐藏。

## 6. 实现要点

| 关注点 | 做法 |
|---|---|
| 锚点来源 | 会话包给每个聊天节点渲染 `data-chat-flow-kind` / `data-chat-flow-key` 的稳定包裹层；用户消息 kind 为 `"user"`。 |
| 滚动容器 | 从第一个可见 flow item 向上找最近的 `overflow-y: auto/scroll` 祖先；导出布局（`data-conversation-scroll`，不滚动）下自动隐藏。 |
| 几何映射 | `刻度 y = 消息内容偏移 / scrollHeight × 轨道高`；滑块同理（最小高度 16px）。 |
| 数据同步 | `MutationObserver`（childList/subtree/characterData，覆盖流式输出）+ 容器 `scroll` + `ResizeObserver` + 1s 轮询兜底（应对迟挂载/会话切换），rAF 节流 + 浅比较避免渲染抖动。 |
| 挂载点 | `conversation.session.header.utilities` 槽位（活动会话常驻），组件本身只渲染 `position: fixed` 的轨道，无内联占位。 |
| 样式 | 与官方包一致地注入 `<style data-plugin-css>`，全部使用 DSW 主题变量，自动适配明暗主题。 |

## 7. 日志与排错

| 现象 | 排查方向 |
|---|---|
| 看不到导航条 | 确认已重启 `dsh web`；会话需已有用户消息且内容可滚动；F12 Console 搜 `dsh-message-minimap`。 |
| 刻度位置偏移 | 偶发的图片/附件异步加载会改变高度——MutationObserver 会自动校正；若持续异常，滚动一下或缩放窗口触发重算。 |
| 点击不跳转 | 检查是否在导出/打印式布局（`data-conversation-scroll`）下——该布局无内部滚动容器，插件自动隐藏。 |
| 样式异常 | 确认主题变量（`--dsw-*`）存在；本插件不自带配色，全部跟随 DSW 主题。 |

## 8. 安全与合规

- **只读**：不修改 DOM 业务结构、不拦截事件（除自身轨道）、不发起网络请求。
- **零宿主能力**：宿主半部为空实现，不开路由、不读文件、无配置项。
- **无持久化**：不写 localStorage / cookie；卸载即无痕。

## 9. 开发与构建

纯 JS 无构建步骤。`lib/client.js` 是经典脚本（`window.__ModuleLoader__.load`），由 client 模块系统按 `/plugins/dsh-message-minimap/client.js` 直接服务。

## 10. License

MIT © AFAP
