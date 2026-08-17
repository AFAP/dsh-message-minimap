// dsh-message-minimap — browser half.
//
// Adds a "user message minimap" to the DeepSeek Harness web GUI: a slim
// vertical rail pinned to the LEFT edge of the chat scroll pane (like an
// editor minimap / screenshot navigation strip) that
//   - draws one tick per USER message, evenly spaced on a compact rail that
//     stays vertically centered in the pane (top = oldest, bottom = newest),
//   - highlights the ticks whose messages are currently inside the viewport,
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
      ".dmm_rail{position:fixed;z-index:30;box-sizing:border-box;width:20px;padding:0;margin:0;" +
      "border:0;background:transparent;cursor:pointer;touch-action:none;border-radius:8px}" +
      ".dmm_tick{position:absolute;left:5px;width:10px;height:2px;padding:0;border:0;border-radius:1px;" +
      "background:var(--dsw-alias-label-caption);opacity:.45;cursor:pointer;" +
      "transition:opacity .12s,background .12s,width .12s,left .12s,height .12s}" +
      ".dmm_tickInView{opacity:.9;background:var(--dsw-alias-label-secondary);left:3px;width:14px}" +
      ".dmm_tick:hover,.dmm_tick:focus-visible,.dmm_tickActive{opacity:1;" +
      "background:var(--dsw-alias-state-business-primary);left:1px;width:18px;height:3px;outline:none}" +
      ".dmm_tip{position:fixed;z-index:120;box-sizing:border-box;width:min(300px,calc(100vw - 48px));" +
      "max-height:200px;overflow:hidden;display:flex;flex-direction:column;gap:6px;" +
      "background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;" +
      "box-shadow:var(--dsw-shadow-lv3);padding:10px 12px;pointer-events:none}" +
      ".dmm_tipTitle{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-tertiary);" +
      "font-family:var(--dsw-font-family);font-size:11px;line-height:16px;letter-spacing:.04em}" +
      ".dmm_tipText{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);" +
      "font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;" +
      "display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}" +
      ".dmm_tipTime{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family);" +
      "font-size:11px;line-height:16px;white-space:nowrap}" +
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
      tick: "dmm_tick",
      tickInView: "dmm_tickInView",
      tickActive: "dmm_tickActive",
      tip: "dmm_tip",
      tipTitle: "dmm_tipTitle",
      tipText: "dmm_tipText",
      tipTime: "dmm_tipTime",
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
    /** Vertical pitch between evenly spaced ticks before the rail cap kicks in (px). */
    var TICK_PITCH = 10;
    /** Rail vertical padding above/below the tick column (px). */
    var RAIL_PAD = 14;
    /** Rail height bounds: at least RAIL_MIN, at most this ratio of the pane. */
    var RAIL_MIN = 120;
    var RAIL_MAX_RATIO = 0.55;
    /** Preview characters kept per user message. */
    var PREVIEW_CHARS = 140;
    /** When jumping to a message, park it this fraction below the pane top. */
    var JUMP_TOP_RATIO = 0.18;

    /**
     * Extract the message preview and its clock separately. The conversation
     * chrome renders the timestamp inside a span whose CSS-module class keeps
     * the stable suffix `timeStart`/`timeEnd` (hash prefix varies by build);
     * the class-substring selector finds it without depending on the hash.
     * The clock text is stripped from the message text so the tooltip can put
     * the time on its own line instead of trailing the excerpt.
     * @returns {{ text: string, time: string }}
     */
    function previewOf(node) {
      var timeEl = node.querySelector('[class*="timeStart"],[class*="timeEnd"]');
      var time = timeEl === null ? "" : (timeEl.textContent || "").replace(/\s+/g, " ").trim();
      var text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (time !== "" && text.slice(-time.length) === time) text = text.slice(0, text.length - time.length).trim();
      if (text.length > PREVIEW_CHARS) text = text.slice(0, PREVIEW_CHARS) + "…";
      return { text: text, time: time };
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
        var preview = previewOf(node);
        ticks.push({
          key: node.getAttribute("data-chat-flow-key") || "u" + i,
          top: Math.round(top),
          text: preview.text,
          time: preview.time
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
        if (a.ticks[i].key !== b.ticks[i].key || a.ticks[i].top !== b.ticks[i].top || a.ticks[i].text !== b.ticks[i].text || a.ticks[i].time !== b.ticks[i].time) return false;
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
      var ticks = geom.ticks;
      var tickCount = ticks.length;

      // Compact rail, vertically centered in the pane: ticks are evenly
      // spaced (index-based, NOT proportional to content height), so the
      // column stays a tight centered strip no matter how irregular the
      // message sizes are.
      var railHeight = Math.min(
        Math.max(RAIL_MIN, (tickCount - 1) * TICK_PITCH + RAIL_PAD * 2),
        Math.floor(geom.height * RAIL_MAX_RATIO)
      );
      var span = railHeight - RAIL_PAD * 2;
      var pitch = tickCount <= 1 ? 0 : span / (tickCount - 1);
      var railTop = geom.top + Math.round((geom.height - railHeight) / 2);
      var tickY = function (index) {
        return tickCount <= 1 ? RAIL_PAD + span / 2 : RAIL_PAD + index * pitch;
      };
      // A tick counts as "in view" while its message sits inside the viewport.
      var viewFloor = geom.scrollTop - 8;
      var viewCeil = geom.scrollTop + geom.clientHeight;
      var inView = function (tick) { return tick.top >= viewFloor && tick.top <= viewCeil; };

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
        var ratio = (clientY - railTop) / railHeight;
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
        for (var i = 0; i < tickCount; i++) {
          if (ticks[i].key === hover) { hoverTick = ticks[i]; hoverIndex = i; break; }
        }
      }

      var tip = null;
      if (hoverTick !== null) {
        var anchorY = railTop + tickY(hoverIndex);
        var tipTop = Math.max(8, Math.min(anchorY - 40, window.innerHeight - 208));
        tip = jsxs("div", {
          className: styles.tip,
          role: "tooltip",
          style: { left: geom.left + 28 + "px", top: tipTop + "px" },
          children: [
            jsx("div", {
              className: styles.tipTitle,
              children: t("tip.title", { index: hoverIndex + 1, total: tickCount })
            }),
            jsx("div", {
              className: styles.tipText + (hoverTick.text === "" ? " " + styles.tipEmpty : ""),
              children: hoverTick.text === "" ? t("tip.empty") : hoverTick.text
            }),
            hoverTick.time === "" ? null : jsx("div", {
              className: styles.tipTime,
              children: hoverTick.time
            })
          ]
        });
      }

      return jsxs("div", {
        ref: railRef,
        className: styles.rail,
        role: "navigation",
        "aria-label": t("rail.aria"),
        style: { left: geom.left + 2 + "px", top: railTop + "px", height: railHeight + "px" },
        onPointerDown: onRailPointerDown,
        onPointerMove: onRailPointerMove,
        onPointerUp: onRailPointerUp,
        onPointerCancel: onRailPointerUp,
        children: [
          ticks.map(function (tick, index) {
            var y = tickY(index);
            var active = hover === tick.key;
            var visible = inView(tick);
            return jsx("button", {
              type: "button",
              className: styles.tick + (visible ? " " + styles.tickInView : "") + (active ? " " + styles.tickActive : ""),
              "aria-label": t("tick.aria", { index: index + 1, total: tickCount }),
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
