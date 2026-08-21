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
chat scroll pane (overflow-y: auto, long sessions are paged)
  │  each user message = one tick (including not-yet-loaded history, from the session log)
  │  ticks of in-viewport messages = bold highlight
  │
  ▼  hover a tick → preview card (index / total + excerpt + time line)
  ▼  click a tick → smooth-scroll to that message (auto-pages up first if not rendered)
  ▼  click/drag the rail → proportional jump
```

**Read-only**: the client only reads the conversation DOM already rendered in the browser (chat nodes carry stable `data-chat-flow-kind` / `data-chat-flow-key` anchors) and scrolls the existing chat scroll container; the host half adds a single **read-only route** `GET /api/message-minimap-messages` that extracts **excerpts** of every user message (≤140 chars + timestamp) from the session log (`$DSH_HOME/sessions`) so the rail can cover history the "load older" paging hasn't rendered yet. It never modifies or deletes anything.

## 2. Features

- ✅ A **compact, vertically centered** rail on the chat pane's left edge (not full height) — zero layout interference.
- ✅ **One tick per user message**, evenly spaced on the rail (oldest at top, newest at bottom) — never scattered by message sizes.
- ✅ **Immune to history paging**: ticks cover ALL user messages (including history not yet rendered via "load older", sourced from the session log); clicking an unloaded tick **auto-pages up** and then smooth-scrolls to it (aligned exactly by message id — an intermediate page with no user messages no longer interrupts the jump, and API timing / steers / forked rows can never shift the target).
- ✅ **Ticks of the messages inside the viewport are auto-bolded**, following the scroll in real time.
- ✅ **Fisheye magnification while sweeping the rail**: the tick under the pointer grows longest, its neighbors grow by a cosine distance falloff (CSS-transitioned) — spot the target at a glance.
- ✅ **Hovering a tick** pops a preview card: `My message · 3 / 12` plus the message excerpt (up to 140 chars / 7 lines) on its own line, plus a dedicated time line.
- ✅ **Clicking a tick** smooth-scrolls to that message (parked ~18% below the pane top).
- ✅ **Clicking or dragging the rail background** jumps proportionally, like a scrollbar.
- ✅ Follows streaming output, history loading, session switches and window resizes automatically (MutationObserver + scroll/resize + polling fallback).
- ✅ Hides itself when the content doesn't overflow, when there are no user messages, or on the new-session hero screen — zero layout interference.
- ✅ Bilingual (zh/en) UI strings following the GUI language.
- ✅ Keyboard accessible: ticks are native `<button>`s — Tab to focus, Enter to jump.

**MVP limitations**: no ticks for assistant messages/errors/branches; no text search over ticks; no persisted on/off toggle (always auto show/hide).

## Preview

| Hover a tick: preview card (excerpt + dedicated time line) |
|:---:|
| ![Hover tick preview](screenshot/rail-hover.png) |

## 3. Directory layout

```
dsh-message-minimap/        # repo root = npm package root
├── package.json            # dsh.bundle.patch + dsh.client (browser declaration) + exports["./client"]
├── cordis.patch.yml        # composition row: a single plugin record (no route, no config)
├── LICENSE                 # MIT
├── screenshot/             # screenshots for the README "Preview" section
└── lib/
    ├── index.js            # host half: /api/message-minimap-messages (reads the session log → full user-message excerpts, zero deps)
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
4. **Click a tick**: smooth-scrolls to that message; if it hasn't been rendered by "load older" paging yet, the plugin pages up automatically first and then jumps.
5. **Click or drag the rail outside the ticks**: proportional jump (equivalent to scrollbar dragging).
6. The rail hides itself when the session is too short (under one screen), has no user messages, or shows the blank new-session hero.

## 6. API quick reference

```text
GET /api/message-minimap-messages?sessionId=<sessionId>
```

- Requires the browser-trust fence (loopback / `trustedHosts` + same-origin), otherwise `403`.
- Unknown `sessionId` → `404`; missing `sessionId` → `400`.
- Excerpts only: each message's `seq`, stable message `id`, epoch `time`, a whitespace-collapsed excerpt of at most 140 chars, and an `image` flag; never full content, never other record types.

Response example:

```json
{
  "total": 14,
  "messages": [
    { "seq": 7, "id": "msg_2xj9k…", "time": 1786975510788, "text": "I need you to …", "image": true }
  ]
}
```

## 7. Implementation notes

| Concern | Approach |
|---|---|
| Anchor source | The conversation package wraps every chat node with stable `data-chat-flow-kind` / `data-chat-flow-key` attributes; user messages have kind `"user"`; the paged column carries `data-chat-flow`. |
| Full-list data | The host half reads the session log (`session.jsonl` / `.zstd`, frame-walked with tolerance for a torn tail mid-write), keeping only `user/message` records with `source.kind === "user"`; each row also carries the log message `id` (`data.id`); payloads are cached by (size, mtime). |
| Paging alignment | API rows ↔ DOM nodes are matched **by message id**: a user bubble's flow key has the shape `<len>:input-message<id>`, and the client parses the id out of it, so whether a tick is loaded depends only on that id being present in the DOM — never on counts. Clicking an unloaded tick pulls older pages in a loop (preferring the session-scoped `conversation.loadOlder()` service, falling back to clicking the "load older" button); progress is the target key appearing — a 50-event page with zero user messages no longer reads as "no progress" — until the target lands (then smooth-scroll), the pager disappears, or a page cap is hit. Hosts without `id` automatically fall back to the positional alignment. |
| Degradation | When the host route is unreachable (403/404/network) the rail falls back to ticks for rendered messages only — the pure-DOM mode. |
| Scroll container | Nearest `overflow-y: auto/scroll` ancestor of the first visible flow item; auto-hides in the export layout (`data-conversation-scroll`, nothing scrolls). |
| Geometry mapping | The tick column is compact and centered (fixed 10px pitch; height ≈ min(10px × count + 28px, pane height × 0.55)); ticks are **evenly spaced by index**. Rail drags map proportionally to scroll position; content offsets are only used for jump targets and in-view detection. |
| Sync | `MutationObserver` (childList/subtree/characterData, covering streaming) + container `scroll` + `ResizeObserver` + 1s polling fallback (late mount / session switch), rAF-throttled with shallow equality; the full list is refetched on a light 5s cadence (host caches by mtime). |
| Mount point | The `conversation.session.header.utilities` slot (always mounted for the active session); the component renders only the `position: fixed` rail, no inline chrome. |
| Styling | Injected `<style data-plugin-css>` like the shipped bundles; everything uses DSW theme variables, auto light/dark. |

## 8. Troubleshooting

| Symptom | Where to look |
|---|---|
| Rail not visible | Confirm `dsh web` was restarted; the session needs user messages and scrollable overflow; search F12 Console for `dsh-message-minimap`. |
| Ticks cover only the recent slice | The host route isn't in effect: check `/api/message-minimap-messages` in Network (`403` = trust fence, `404` = session not found); while unreachable the plugin degrades to rendered-only ticks. |
| Clicking an early tick doesn't jump | Since 0.4.3 the jump is keyed by message id: the plugin pages up first (watch the "loading" pill at the chat top), crossing pages that contain no user messages, until the target appears; if the whole history is loaded and the message still doesn't exist (forked/deleted), it stops in place rather than jumping somewhere wrong. Older positional alignment (`domIndex = fullIndex − (total − rendered)`) could drift with API timing or interleaved messages — upgrade. |
| Tick positions drift | Async image/attachment loads change heights — the MutationObserver self-corrects; if it persists, scroll or resize once to force a recompute. |
| Clicks don't jump | Check whether you're in the export/print layout (`data-conversation-scroll`) — it has no internal scroll container and the plugin hides itself. |
| Styling looks off | Confirm the theme variables (`--dsw-*`) exist; the plugin ships no colors of its own and follows the DSW theme. |

## 9. Security & compliance

- **Read-only**: no business-DOM mutation, no event interception (outside its own rail), no file modification or deletion; the host only reads session logs.
- **Path red line**: the session log is located ONLY via the id-encoded segment under `$DSH_HOME/sessions` — client-supplied paths are never accepted; the id is single-segment escaped, ruling out traversal.
- **Browser-trust fence**: `/api/message-minimap-messages` only answers loopback or declared `trustedHosts` same-origin requests; `sec-fetch-site: cross-site` and foreign Origins are rejected.
- **Minimal disclosure**: only each user message's `seq`, `id`, time, ≤140-char excerpt and image flag are returned; never full content, never other record types.
- **No persistence**: nothing written to localStorage / cookies; uninstalling leaves no trace.

## 10. Development & build

Plain JS, no build step. `lib/index.js` (host half) has **zero external dependencies** (Node builtins only); `lib/client.js` is a classic script (`window.__ModuleLoader__.load`) served directly by the client module system at `/plugins/dsh-message-minimap/client.js`.

## 11. License

MIT © AFAP
