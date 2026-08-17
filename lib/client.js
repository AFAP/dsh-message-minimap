// dsh-message-minimap — browser half.
//
// Adds a "user message minimap" to the DeepSeek Harness web GUI: a slim
// vertical rail pinned to the LEFT edge of the chat scroll pane (like an
// editor minimap / screenshot navigation strip) that
//   - draws one tick per USER message at its proportional position in the
//     conversation (top = oldest, bottom = newest),
//   - shows a soft viewport block marking the currently visible region,
//   - previews the message text in a hover tooltip card,
//   - smooth-scrolls the chat to that message on click, and
//   - jumps proportionally when the rail background is clicked or dragged.
//
// The rail is pure DOM-driven: the conversation package wraps every chat node
// in a flow item carrying stable data attributes (`data-chat-flow-kind`,
// `data-chat-flow-key`), and the chat pane is the nearest ancestor with
// overflow-y auto/scroll. A MutationObserver + scroll/resize listeners keep
// the geometry in sync while streaming, loading history or switching
// sessions. No host route, no projection, no persistence.
//
// This file is served as a classic script at
// /plugins/dsh-message-minimap/client.js and registers its factory
// through window.__ModuleLoader__.load(). The factory may only require the
// platform seed words (react, react/jsx-runtime, ...) plus whatever the
// `dsh.client.inject` edges have registered — here we only need react.
window.__ModuleLoader__.load({
  id: "dsh-message-minimap",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var jsx = jsxRuntime.jsx;
    var jsxs = jsxRuntime.jsxs;

    // ── styles (injected like the shipped bundles, themed via DSW vars) ────
    var css =
      ".dmm_rail{position:fixed;z-index:30;box-sizing:border-box;width:16px;padding:0;margin:0;" +
      "border:0;background:transparent;cursor:pointer;touch-action:none;border-radius:8px}" +
      ".dmm_rail:hover .dmm_view{background:var(--dsw-alias-fill-l1)}" +
      ".dmm_view{position:absolute;left:4px;width:8px;box-sizing:border-box;border-radius:4px;" +
      "background:var(--dsw-alias-fill-l2);border:1px solid var(--dsw-alias-border-l2);pointer-events:none;" +
      "transition:background .12s}" +
      ".dmm_tick{position:absolute;left:2px;width:12px;height:2px;padding:0;border:0;border-radius:1px;" +
      "background:var(--dsw-alias-label-caption);opacity:.5;cursor:pointer;" +
      "transition:opacity .12s,background .12s,transform .12s}" +
      ".dmm_tick:hover,.dmm_tick:focus-visible,.dmm_tickActive{opacity:1;" +
      "background:var(--dsw-alias-state-business-primary);transform:scaleY(2);outline:none}" +
      ".dmm_tip{position:fixed;z-index:120;box-sizing:border-box;width:min(300px,calc(100vw - 48px));" +
      "max-height:200px;overflow:hidden;display:flex;flex-direction:column;gap:6px;" +
      "background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;" +
      "box-shadow:var(--dsw-shadow-lv3);padding:10px 12px;pointer-events:none}" +
      ".dmm_tipTitle{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-tertiary);" +
      "font-family:var(--dsw-font-family);font-size:11px;line-height:16px;letter-spacing:.04em}" +
      ".dmm_tipText{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);" +
      "font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;" +
      "display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}" +
      ".dmm_tipEmpty{color:var(--dsw-alias-label-dimmed);font-style:italic}";
    var tagId = "dsh-message-minimap/message-minimap.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-message-minimap";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    var styles = {
      rail: "dmm_rail",
      view: "dmm_view",
      tick: "dmm_tick",
      tickActive: "dmm_tickActive",
      tip: "dmm_tip",
      tipTitle: "dmm_tipTitle",
      tipText: "dmm_tipText",
      tipEmpty: "dmm_tipEmpty"
    };

    // ── constants & helpers ───────────────────────────────────────────────
    /** Plugin-owned locale namespace. */
    var NS = "message-minimap";
    /** Selector of the stable per-chat-node wrapper contributed by ui-conversation. */
    var FLOW_SELECTOR = "[data-chat-flow-kind]";
    /** Selector picking exactly the user-message flow items. */
    var USER_SELECTOR = '[data-chat-flow-kind="user"]';
    /** Re-poll for the chat scroll container while none is attached (ms). */
    var POLL_MS = 1000;
    /** Minimum overflow before the rail appears (px). */
    var MIN_OVERFLOW = 64;
    /** Minimum pane height before the rail appears (px). */
    var MIN_PANE_HEIGHT = 200;
    /** Minimum viewport block height on the rail (px). */
    var MIN_VIEW = 16;
    /** Preview characters kept per user message. */
    var PREVIEW_CHARS = 140;
    /** When jumping to a message, park it this fraction below the pane top. */
    var JUMP_TOP_RATIO = 0.18;

    /** Collapse whitespace and truncate a node's visible text for the tooltip. */
    function previewText(node) {
      var text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > PREVIEW_CHARS) text = text.slice(0, PREVIEW_CHARS) + "…";
      return text;
    }

    /**
     * Locate the chat scroll container: the nearest overflow-y auto/scroll
     * ancestor of the first visible chat flow item. Returns null while no
     * chat is mounted (hero screen, other tabs) or in the
     * `[data-conversation-scroll]` export layout where nothing scrolls.
     */
    function findChatScroll() {
      if (typeof document === "undefined") return null;
      var flow = document.querySelectorAll(FLOW_SELECTOR);
      for (var i = 0; i < flow.length; i++) {
        var node = flow[i];
        if (!node.isConnected) continue;
        if (node.getClientRects().length === 0) continue;
        var el = node.parentElement;
        while (el !== null && el !== document.body) {
          var style = getComputedStyle(el);
          if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
          el = el.parentElement;
        }
      }
      return null;
    }

    /**
     * Snapshot the rail geometry: pane rect, scroll metrics, and one tick per
     * user message with its content offset and preview text.
     */
    function readGeometry(container) {
      var rect = container.getBoundingClientRect();
      var scrollHeight = container.scrollHeight;
      var clientHeight = container.clientHeight;
      var scrollTop = container.scrollTop;
      var nodes = container.querySelectorAll(USER_SELECTOR);
      var ticks = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var top = node.getBoundingClientRect().top - rect.top + scrollTop;
        ticks.push({
          key: node.getAttribute("data-chat-flow-key") || "u" + i,
          top: Math.round(top),
          text: previewText(node)
        });
      }
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        scrollHeight: scrollHeight,
        clientHeight: clientHeight,
        scrollTop: Math.round(scrollTop),
        ticks: ticks
      };
    }

    /** Shallow-enough geometry equality to keep render churn at bay. */
    function geomEqual(a, b) {
      if (a === b) return true;
      if (a === null || b === null) return false;
      if (a.left !== b.left || a.top !== b.top || a.height !== b.height) return false;
      if (a.scrollHeight !== b.scrollHeight || a.clientHeight !== b.clientHeight || a.scrollTop !== b.scrollTop) return false;
      if (a.ticks.length !== b.ticks.length) return false;
      for (var i = 0; i < a.ticks.length; i++) {
        if (a.ticks[i].key !== b.ticks[i].key || a.ticks[i].top !== b.ticks[i].top || a.ticks[i].text !== b.ticks[i].text) return false;
      }
      return true;
    }

    // ── bilingual dictionaries (source of truth: zh key set) ──────────────
    var zh = {
      "rail.aria": "用户消息导航条：刻度为每一条你发送的消息，点击跳转，拖动快速定位",
      "tick.aria": "第 {index} 条我的消息（共 {total} 条），点击跳转",
      "tip.title": "我的消息 · {index} / {total}",
      "tip.empty": "（无文本内容）"
    };
    var en = {
      "rail.aria": "User message navigator: one tick per message you sent — click to jump, drag to scan",
      "tick.aria": "My message {index} of {total} — click to jump",
      "tip.title": "My message · {index} / {total}",
      "tip.empty": "(no text content)"
    };

    // ── the minimap rail ──────────────────────────────────────────────────
    /**
     * Fixed-position rail aligned to the chat scroll pane's left edge.
     * Rendered from the session header utilities slot (always mounted for the
     * active session) but positioned over the chat pane; returns null whenever
     * the conversation is absent, too short, or fits without scrolling.
     */
    function UserMessageMinimap(props) {
      var t = props.t;
      var geomPair = React.useState(null);
      var geom = geomPair[0];
      var setGeom = geomPair[1];
      var hoverPair = React.useState(null);
      var hover = hoverPair[0];
      var setHover = hoverPair[1];
      var containerRef = React.useRef(null);
      var railRef = React.useRef(null);
      var rafRef = React.useRef(0);
      var dragRef = React.useRef(false);

      // Attach to the chat scroll container and keep `geom` in sync with
      // scrolling, streaming mutations, resizes and session switches.
      React.useEffect(function () {
        if (typeof document === "undefined") return;
        var disposed = false;
        var mutationObs = null;
        var resizeObs = null;

        function schedule() {
          if (rafRef.current !== 0) return;
          rafRef.current = requestAnimationFrame(function () {
            rafRef.current = 0;
            sync();
          });
        }

        function sync() {
          if (disposed) return;
          var container = containerRef.current;
          if (container !== null && !container.isConnected) {
            detach();
            container = null;
          }
          if (container === null) {
            container = findChatScroll();
            if (container !== null) attach(container);
          }
          if (container === null) {
            setGeom(function (prev) { return prev === null ? prev : null; });
            return;
          }
          var next = readGeometry(container);
          setGeom(function (prev) { return geomEqual(prev, next) ? prev : next; });
        }

        function attach(container) {
          containerRef.current = container;
          container.addEventListener("scroll", schedule, { passive: true });
          mutationObs = new MutationObserver(schedule);
          mutationObs.observe(container, { childList: true, subtree: true, characterData: true });
          if (typeof ResizeObserver !== "undefined") {
            resizeObs = new ResizeObserver(schedule);
            resizeObs.observe(container);
          }
        }

        function detach() {
          if (mutationObs !== null) { mutationObs.disconnect(); mutationObs = null; }
          if (resizeObs !== null) { resizeObs.disconnect(); resizeObs = null; }
          if (containerRef.current !== null) {
            containerRef.current.removeEventListener("scroll", schedule);
            containerRef.current = null;
          }
        }

        var poll = setInterval(sync, POLL_MS);
        window.addEventListener("resize", schedule);
        sync();
        return function () {
          disposed = true;
          clearInterval(poll);
          window.removeEventListener("resize", schedule);
          if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
          detach();
        };
      }, []);

      if (geom === null) return null;
      if (geom.ticks.length === 0) return null;
      if (geom.height < MIN_PANE_HEIGHT) return null;
      if (geom.scrollHeight <= geom.clientHeight + MIN_OVERFLOW) return null;

      var scrollHeight = geom.scrollHeight;
      var toRail = function (contentOffset) { return (contentOffset / scrollHeight) * geom.height; };
      var viewTop = toRail(geom.scrollTop);
      var viewHeight = Math.max(MIN_VIEW, toRail(geom.clientHeight));

      function scrollToOffset(offset, smooth) {
        var container = containerRef.current;
        if (container === null) return;
        var max = container.scrollHeight - container.clientHeight;
        var top = Math.max(0, Math.min(max, offset));
        container.scrollTo({ top: top, behavior: smooth ? "smooth" : "auto" });
      }

      function jumpToTick(tick) {
        scrollToOffset(tick.top - geom.clientHeight * JUMP_TOP_RATIO, true);
      }

      function jumpToClientY(clientY, smooth) {
        var ratio = (clientY - geom.top) / geom.height;
        var clamped = Math.max(0, Math.min(1, ratio));
        scrollToOffset(clamped * scrollHeight - geom.clientHeight / 2, smooth);
      }

      function onRailPointerDown(e) {
        if (e.target instanceof Element && e.target.closest("." + styles.tick) !== null) return;
        e.preventDefault();
        dragRef.current = true;
        if (railRef.current !== null && railRef.current.setPointerCapture) {
          try { railRef.current.setPointerCapture(e.pointerId); } catch (error) { /* pointer already gone */ }
        }
        jumpToClientY(e.clientY, false);
      }

      function onRailPointerMove(e) {
        if (!dragRef.current) return;
        jumpToClientY(e.clientY, false);
      }

      function onRailPointerUp() {
        dragRef.current = false;
      }

      var hoverTick = null;
      var hoverIndex = -1;
      if (hover !== null) {
        for (var i = 0; i < geom.ticks.length; i++) {
          if (geom.ticks[i].key === hover) { hoverTick = geom.ticks[i]; hoverIndex = i; break; }
        }
      }

      var tip = null;
      if (hoverTick !== null) {
        var tickY = geom.top + toRail(hoverTick.top);
        var tipTop = Math.max(8, Math.min(tickY - 40, window.innerHeight - 208));
        tip = jsxs("div", {
          className: styles.tip,
          role: "tooltip",
          style: { left: geom.left + 24 + "px", top: tipTop + "px" },
          children: [
            jsx("div", {
              className: styles.tipTitle,
              children: t("tip.title", { index: hoverIndex + 1, total: geom.ticks.length })
            }),
            jsx("div", {
              className: styles.tipText + (hoverTick.text === "" ? " " + styles.tipEmpty : ""),
              children: hoverTick.text === "" ? t("tip.empty") : hoverTick.text
            })
          ]
        });
      }

      return jsxs("div", {
        ref: railRef,
        className: styles.rail,
        role: "navigation",
        "aria-label": t("rail.aria"),
        style: { left: geom.left + 2 + "px", top: geom.top + "px", height: geom.height + "px" },
        onPointerDown: onRailPointerDown,
        onPointerMove: onRailPointerMove,
        onPointerUp: onRailPointerUp,
        onPointerCancel: onRailPointerUp,
        children: [
          jsx("div", {
            className: styles.view,
            style: { top: viewTop + "px", height: viewHeight + "px" }
          }),
          geom.ticks.map(function (tick, index) {
            var y = toRail(tick.top);
            var active = hover === tick.key;
            return jsx("button", {
              type: "button",
              className: styles.tick + (active ? " " + styles.tickActive : ""),
              "aria-label": t("tick.aria", { index: index + 1, total: geom.ticks.length }),
              title: "",
              style: { top: Math.max(0, y - 1) + "px" },
              onPointerDown: function (e) { e.stopPropagation(); },
              onClick: function (e) {
                e.stopPropagation();
                jumpToTick(tick);
              },
              onMouseEnter: function () { setHover(tick.key); },
              onMouseLeave: function () { setHover(function (current) { return current === tick.key ? null : current; }); },
              onFocus: function () { setHover(tick.key); },
              onBlur: function () { setHover(function (current) { return current === tick.key ? null : current; }); }
            }, tick.key);
          }),
          tip
        ]
      });
    }

    // ── plugin body ───────────────────────────────────────────────────────
    /** Required browser services: the slot registry and the locale face. */
    var inject = ["slots", "locale"];

    /**
     * Client plugin body: register the dictionaries, then contribute the
     * minimap into the session header utilities row once ui-conversation
     * declares it (ctx.slots.inject waits for the declaration). The component
     * renders no inline chrome — only the fixed rail over the chat pane.
     * @param ctx - browser root context.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-message-minimap: dictionaries");
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "message-minimap",
          order: 30,
          locale: NS
        }, UserMessageMinimap);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});

//# sourceMappingURL=client.js.map
