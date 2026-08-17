# 用户消息导航条 · Message Minimap

<div align="center">
  <a href="README.md">中文</a> · <b>English</b>
</div>

> **A slim minimap rail on the LEFT edge of the DeepSeek Harness Web GUI chat pane: every message you sent becomes a tick — hover for a preview, click to jump, drag to scan long sessions.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 1. The problem it solves

In a long session, going back to "what did I say earlier?" means endless wheel scrolling. The assistant's replies are long and dense, and your own messages get buried in between.

This plugin adds a thin navigation rail on the **left edge** of the chat pane (like the VS Code minimap):

```
chat scroll pane (overflow-y: auto)
  │  each user message = one tick (data-chat-flow-kind="user")
  │  ticks of in-viewport messages = bold highlight
  │
  ▼  hover a tick → preview card (index / total + message excerpt)
  ▼  click a tick → smooth-scroll to that message
  ▼  click/drag the rail → proportional jump
```

**Pure frontend, read-only**: the plugin adds no HTTP route and touches no files — it only reads the conversation DOM already rendered in the browser (chat nodes carry stable `data-chat-flow-kind` / `data-chat-flow-key` anchors) and scrolls the existing chat scroll container. The host half is a deliberate no-op that only exists so the client module system discovers the `dsh.client` declaration.

## 2. Features

- ✅ A **compact, vertically centered** rail on the chat pane's left edge (not full height) — zero layout interference.
- ✅ **One tick per user message**, evenly spaced on the rail (oldest at top, newest at bottom) — never scattered by message sizes.
- ✅ **Ticks of the messages inside the viewport are auto-bolded**, following the scroll in real time.
- ✅ **Hovering a tick** pops a preview card: `My message · 3 / 12` plus the message excerpt (up to 140 chars / 7 lines).
- ✅ **Clicking a tick** smooth-scrolls to that message (parked ~18% below the pane top).
- ✅ **Clicking or dragging the rail background** jumps proportionally, like a scrollbar.
- ✅ Follows streaming output, history loading, session switches and window resizes automatically (MutationObserver + scroll/resize + polling fallback).
- ✅ Hides itself when the content doesn't overflow, when there are no user messages, or on the new-session hero screen — zero layout interference.
- ✅ Bilingual (zh/en) UI strings following the GUI language.
- ✅ Keyboard accessible: ticks are native `<button>`s — Tab to focus, Enter to jump.

**MVP limitations**: no ticks for assistant messages/errors/branches; no text search over ticks; no persisted on/off toggle (always auto show/hide).

## 3. Directory layout

```
dsh-message-minimap/        # repo root = npm package root
├── package.json            # dsh.bundle.patch + dsh.client (browser declaration) + exports["./client"]
├── cordis.patch.yml        # composition row: a single plugin record (no route, no config)
├── LICENSE                 # MIT
└── lib/
    ├── index.js            # host half: deliberate no-op (zero deps), only so the Loader sees this package
    └── client.js           # browser bundle: the rail (mounted via conversation.session.header.utilities)
```

## 4. Quick start

One-line install (GitHub):

```powershell
dsh plugin --profile web add github:AFAP/dsh-message-minimap
```

Then **restart `dsh web`** to take effect.

> After installation the plugin lives at `$DSH_HOME\profiles\web\node_modules\dsh-message-minimap` (cloned by pnpm from GitHub), independent of the source checkout location.

Upgrade:

```powershell
dsh plugin --profile web update dsh-message-minimap
```

Uninstall:

```powershell
dsh plugin --profile web remove dsh-message-minimap
```

### Manual install from a source directory (for equivalent verification)

```powershell
dsh plugin --profile web add "D:\path\to\dsh-message-minimap"
```

### Verify it loaded

Open a session **with several exchanges whose content overflows and scrolls** → a ticked rail appears at the chat pane's left edge; hovering a tick shows the message excerpt.

## 5. Usage

1. Open any long historical session (or chat past one screenful).
2. Look at the centered rail on the chat pane's left edge: each small tick is **one message you sent**; the ticks of **messages currently inside the viewport** are bolded.
3. **Hover a tick**: a preview card pops to the right with "My message · n / total" and the message opening.
4. **Click a tick**: smooth-scrolls to that message.
5. **Click or drag the rail outside the ticks**: proportional jump (equivalent to scrollbar dragging).
6. The rail hides itself when the session is too short (under one screen), has no user messages, or shows the blank new-session hero.

## 6. Implementation notes

| Concern | Approach |
|---|---|
| Anchor source | The conversation package wraps every chat node with stable `data-chat-flow-kind` / `data-chat-flow-key` attributes; user messages have kind `"user"`. |
| Scroll container | Nearest `overflow-y: auto/scroll` ancestor of the first visible flow item; auto-hides in the export layout (`data-conversation-scroll`, nothing scrolls). |
| Geometry mapping | The tick column is compact and centered (height ≈ min(tick pitch × count, pane height × 0.55), 120px minimum); ticks are **evenly spaced by index**. Rail drags map proportionally to scroll position; content offsets are only used for jump targets and in-view detection. |
| Sync | `MutationObserver` (childList/subtree/characterData, covering streaming) + container `scroll` + `ResizeObserver` + 1s polling fallback (late mount / session switch), rAF-throttled with shallow equality to avoid render churn. |
| Mount point | The `conversation.session.header.utilities` slot (always mounted for the active session); the component renders only the `position: fixed` rail, no inline chrome. |
| Styling | Injected `<style data-plugin-css>` like the shipped bundles; everything uses DSW theme variables, auto light/dark. |

## 7. Troubleshooting

| Symptom | Where to look |
|---|---|
| Rail not visible | Confirm `dsh web` was restarted; the session needs user messages and scrollable overflow; search F12 Console for `dsh-message-minimap`. |
| Tick positions drift | Async image/attachment loads change heights — the MutationObserver self-corrects; if it persists, scroll or resize once to force a recompute. |
| Clicks don't jump | Check whether you're in the export/print layout (`data-conversation-scroll`) — it has no internal scroll container and the plugin hides itself. |
| Styling looks off | Confirm the theme variables (`--dsw-*`) exist; the plugin ships no colors of its own and follows the DSW theme. |

## 8. Security & compliance

- **Read-only**: no business-DOM mutation, no event interception (outside its own rail), no network requests.
- **Zero host capability**: the host half is a no-op — no routes, no file access, no config keys.
- **No persistence**: nothing written to localStorage / cookies; uninstalling leaves no trace.

## 9. Development & build

Plain JS, no build step. `lib/client.js` is a classic script (`window.__ModuleLoader__.load`) served directly by the client module system at `/plugins/dsh-message-minimap/client.js`.

## 10. License

MIT © AFAP
