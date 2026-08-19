// dsh-message-minimap — browser half.
//
// Adds a "user message minimap" to the DeepSeek Harness web GUI: a slim
// vertical rail pinned to the LEFT edge of the chat scroll pane (like an
// editor minimap / screenshot navigation strip) that
//   - draws one tick per USER message, evenly spaced on a compact rail that
//     stays vertically centered in the pane (top = oldest, bottom = newest),
//   - lists EVERY user message of the session — including history the paged
//     chat view has not loaded yet (the full list comes from the host half's
//     /api/message-minimap-messages, which reads the session log),
//   - highlights the ticks whose messages are currently inside the viewport,
//   - magnifies ticks fisheye-style as the pointer sweeps the rail (the
//     nearest tick grows longest, its neighbors a little),
//   - previews the message text in a hover tooltip card,
//   - smooth-scrolls the chat to that message on click — pulling older
//     history pages first when the target is not rendered yet, and
//   - jumps proportionally when the rail background is clicked or dragged.
//
// Geometry stays DOM-driven: the conversation package wraps every chat node
// in a flow item carrying stable data attributes (`data-chat-flow-kind`,
// `data-chat-flow-key`), the paged column carries `data-chat-flow`, and the
// chat pane is the nearest ancestor with overflow-y auto/scroll. A
// MutationObserver + scroll/resize listeners keep the geometry in sync while
// streaming, loading history or switching sessions. When the host route is
// unreachable the rail degrades to DOM-only mode (ticks for loaded messages
// only), which is exactly the pre-API behavior.
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
      ".dmm_tick{position:absolute;left:2px;width:10px;height:2px;padding:0;border:0;border-radius:1px;" +
      "background:var(--dsw-alias-label-caption);opacity:.45;cursor:pointer;" +
      "transition:opacity .12s,background .12s,width .12s,left .12s,height .12s}" +
      ".dmm_tickInView{opacity:.9;background:var(--dsw-alias-label-secondary);width:14px}" +
      ".dmm_tick:hover,.dmm_tick:focus-visible,.dmm_tickActive{opacity:1;" +
      "background:var(--dsw-alias-state-business-primary);width:18px;height:3px;outline:none}" +
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
    /** Host route serving the full user-message list for one session. */
    var API_PATH = "/api/message-minimap-messages";
    /** Selector of the stable per-chat-node wrapper contributed by ui-conversation. */
    var FLOW_SELECTOR = "[data-chat-flow-kind]";
    /** Selector picking exactly the user-message flow items. */
    var USER_SELECTOR = '[data-chat-flow-kind="user"]';
    /** Selector of the paged chat column (parent of the flow items). */
    var COLUMN_SELECTOR = "[data-chat-flow]";
    /** The "load older" pager: a button in a column child that is not a flow item. */
    var OLDER_SELECTOR = COLUMN_SELECTOR + " > div:not([data-chat-flow-kind]) button";
    /** Re-poll for the chat scroll container while none is attached (ms). */
    var POLL_MS = 1000;
    /** Light refetch cadence for the full message list (host caches by mtime). */
    var REFETCH_MS = 5000;
    /** Max wait for one older page to land in the DOM during a jump (ms). */
    var LOAD_WAIT_MS = 4000;
    /** Minimum overflow before the rail appears (px). */
    var MIN_OVERFLOW = 64;
    /** Minimum pane height before the rail appears (px). */
    var MIN_PANE_HEIGHT = 200;
    /** Vertical pitch between evenly spaced ticks before the rail cap kicks in (px). */
    var TICK_PITCH = 10;
    /** Rail vertical padding above/below the tick column (px). */
    var RAIL_PAD = 14;
    /** Rail height bounds: at least one pitch plus padding, at most this ratio of the pane. */
    var RAIL_MIN = RAIL_PAD * 2 + TICK_PITCH;
    var RAIL_MAX_RATIO = 0.55;
    /** Preview characters kept per user message (DOM fallback mode). */
    var PREVIEW_CHARS = 140;
    /** When jumping to a message, park it this fraction below the pane top. */
    var JUMP_TOP_RATIO = 0.18;
    /** Proximity magnification: ticks within this vertical range of the pointer grow (px). */
    var PROX_RANGE = 46;
    /** Tick widths: rest width, and the longest width at the pointer center (px). */
    var TICK_BASE_W = 10;
    var TICK_MAX_W = 19;
    /** Fixed left edge of every tick inside the 20px rail (px); growth extends rightward. */
    var TICK_LEFT = 2;

    /** Cosine falloff from 1 (at the pointer) to 0 (at PROX_RANGE away). */
    function proxFactor(distance) {
      if (distance >= PROX_RANGE) return 0;
      return Math.cos((distance / PROX_RANGE) * (Math.PI / 2));
    }

    /**
     * Extract the message preview and its clock separately (DOM fallback
     * mode). The conversation chrome renders the timestamp inside a span
     * whose CSS-module class keeps the stable suffix `timeStart`/`timeEnd`
     * (hash prefix varies by build); the class-substring selector finds it
     * without depending on the hash. The clock text is stripped from the
     * message text so the tooltip can put the time on its own line.
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

    /** Format an epoch ms like the chat clock ("8月16日 22:04"; year when different). */
    function formatTime(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
      var d = new Date(ms);
      var now = new Date();
      var opts = { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };
      if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
      try {
        return new Intl.DateTimeFormat(undefined, opts).format(d);
      } catch (error) {
        return d.toLocaleString();
      }
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
     * Snapshot the rail geometry: pane rect, scroll metrics, and one DOM tick
     * per CURRENTLY RENDERED user message (the chat view pages long sessions,
     * so this is usually just the most recent slice — the full tick list is
     * merged in from the API at render time).
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

    /** Compare two API message lists well enough to skip redundant re-renders. */
    function sameMessages(a, b) {
      if (a === b) return true;
      if (a === null || b === null) return false;
      if (a.length !== b.length) return false;
      if (a.length === 0) return true;
      var la = a[a.length - 1];
      var lb = b[b.length - 1];
      return a[0].seq === b[0].seq && la.seq === lb.seq && la.time === lb.time && la.text === lb.text;
    }

    // ── bilingual dictionaries (source of truth: zh key set) ──────────────
    var zh = {
      "rail.aria": "用户消息导航条：刻度为每一条你发送的消息，点击跳转，拖动快速定位",
      "tick.aria": "第 {index} 条我的消息（共 {total} 条），点击跳转",
      "tip.title": "我的消息 · {index} / {total}",
      "tip.empty": "（无文本内容）",
      "tip.image": "[图片]"
    };
    var en = {
      "rail.aria": "User message navigator: one tick per message you sent — click to jump, drag to scan",
      "tick.aria": "My message {index} of {total} — click to jump",
      "tip.title": "My message · {index} / {total}",
      "tip.empty": "(no text content)",
      "tip.image": "[image]"
    };

    // ── the minimap rail ──────────────────────────────────────────────────
    /** Root services captured by apply() for the session-scoped loadOlder. */
    var services = { sessions: null };

    /**
     * Fixed-position rail aligned to the chat scroll pane's left edge.
     * Rendered from the session header utilities slot (always mounted for the
     * active session) but positioned over the chat pane; returns null whenever
     * the conversation is absent, too short, or fits without scrolling.
     *
     * Tick source: the full user-message list from the host API (covers
     * history the paged chat view has not loaded); when the API is
     * unreachable the rail degrades to the rendered slice only.
     */
    function UserMessageMinimap(props) {
      var t = props.t;
      var sessionId = props.sessionId;
      var geomPair = React.useState(null);
      var geom = geomPair[0];
      var setGeom = geomPair[1];
      var allPair = React.useState(null);
      var all = allPair[0];
      var setAll = allPair[1];
      var hoverPair = React.useState(null);
      var hover = hoverPair[0];
      var setHover = hoverPair[1];
      var proxPair = React.useState(null);
      var proxY = proxPair[0];
      var setProxY = proxPair[1];
      var proxRafRef = React.useRef(0);
      var containerRef = React.useRef(null);
      var railRef = React.useRef(null);
      var rafRef = React.useRef(0);
      var dragRef = React.useRef(false);
      var allRef = React.useRef(null);
      allRef.current = all;
      var jumpingRef = React.useRef(false);

      // Cancel any pending fisheye frame on unmount.
      React.useEffect(function () {
        return function () {
          if (proxRafRef.current !== 0) cancelAnimationFrame(proxRafRef.current);
        };
      }, []);

      // Fetch the FULL user-message list from the host route; refetch on a
      // light cadence (the host caches by log mtime, so an unchanged session
      // costs one stat) and whenever the session changes.
      React.useEffect(function () {
        if (typeof window === "undefined") return;
        if (typeof sessionId !== "string" || sessionId === "") return;
        var disposed = false;
        function fetchAll() {
          fetch(API_PATH + "?sessionId=" + encodeURIComponent(sessionId), { headers: { accept: "application/json" } })
            .then(function (res) {
              if (!res.ok) throw new Error("HTTP " + res.status);
              return res.json();
            })
            .then(function (payload) {
              if (disposed) return;
              if (payload && Array.isArray(payload.messages)) {
                setAll(function (prev) { return sameMessages(prev, payload.messages) ? prev : payload.messages; });
              }
            })
            .catch(function () {
              // API unreachable (route absent, fence, transient) → stay in
              // DOM-only mode; the next tick retries.
            });
        }
        fetchAll();
        var interval = setInterval(fetchAll, REFETCH_MS);
        return function () {
          disposed = true;
          clearInterval(interval);
        };
      }, [sessionId]);

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
      if (geom.height < MIN_PANE_HEIGHT) return null;
      if (geom.scrollHeight <= geom.clientHeight + MIN_OVERFLOW) return null;

      var scrollHeight = geom.scrollHeight;
      var domTicks = geom.ticks;

      // Merge: API mode covers the whole session (the chat pages history, so
      // the DOM usually holds only the most recent slice — the rendered slice
      // is the TAIL, hence domIndex = apiIndex - (total - rendered)). The
      // DOM-only fallback keeps the pre-API behavior when the route is gone.
      var useAll = all !== null && all.length > 0 && all.length >= domTicks.length;
      var ticks;
      if (useAll) {
        var offset = all.length - domTicks.length;
        ticks = all.map(function (m, i) {
          var di = i - offset;
          var loaded = di >= 0 && di < domTicks.length;
          return {
            key: "a" + i,
            index: i,
            text: m.text,
            time: formatTime(m.time),
            image: m.image === true,
            loaded: loaded,
            top: loaded ? domTicks[di].top : null
          };
        });
      } else {
        ticks = domTicks.map(function (d, i) {
          return { key: d.key, index: i, text: d.text, time: d.time, image: false, loaded: true, top: d.top };
        });
      }
      var tickCount = ticks.length;
      if (tickCount === 0) return null;

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
      // A tick counts as "in view" while its message sits inside the viewport
      // (only rendered messages can be in view).
      var viewFloor = geom.scrollTop - 8;
      var viewCeil = geom.scrollTop + geom.clientHeight;
      var inView = function (tick) { return tick.top !== null && tick.top >= viewFloor && tick.top <= viewCeil; };

      function scrollToOffset(offset, smooth) {
        var container = containerRef.current;
        if (container === null) return;
        var max = container.scrollHeight - container.clientHeight;
        var top = Math.max(0, Math.min(max, offset));
        container.scrollTo({ top: top, behavior: smooth ? "smooth" : "auto" });
      }

      /** Scroll to the domIndex-th RENDERED user message. */
      function scrollDomIndex(domIndex, smooth) {
        var container = containerRef.current;
        if (container === null) return;
        var nodes = container.querySelectorAll(USER_SELECTOR);
        if (domIndex < 0 || domIndex >= nodes.length) return;
        var node = nodes[domIndex];
        var rect = container.getBoundingClientRect();
        var top = node.getBoundingClientRect().top - rect.top + container.scrollTop;
        var max = container.scrollHeight - container.clientHeight;
        container.scrollTo({ top: Math.max(0, Math.min(max, top - container.clientHeight * JUMP_TOP_RATIO)), behavior: smooth ? "smooth" : "auto" });
      }

      /**
       * Pull one older history page: prefer the session-scoped conversation
       * service (no markup dependency); fall back to clicking the pager
       * button the chat view renders while hasMore is true.
       */
      function pullOlder() {
        try {
          if (services.sessions !== null && typeof sessionId === "string" && sessionId !== "") {
            var scoped = services.sessions.scope(sessionId);
            var conversation = scoped === void 0 || scoped === null ? void 0 : scoped.get("conversation");
            if (conversation !== void 0 && conversation !== null && typeof conversation.loadOlder === "function") {
              var pending = conversation.loadOlder();
              if (pending !== void 0 && pending !== null && typeof pending.catch === "function") pending.catch(function () {});
              return;
            }
          }
        } catch (error) {
          // Fall through to the pager button.
        }
        var container = containerRef.current;
        if (container === null) return;
        var button = container.querySelector(OLDER_SELECTOR);
        if (button !== null) button.click();
      }

      /**
       * Jump to the index-th message of the FULL list. When the chat view has
       * not rendered it yet (paged history), pull older pages until it lands
       * in the DOM, then smooth-scroll to it. Stops on the first page that
       * makes no progress (fully loaded / pager gone) so a mismatched index
       * can never loop forever. One jump at a time.
       */
      function jumpToMessage(index) {
        if (!useAll) {
          scrollDomIndex(index, true);
          return;
        }
        if (jumpingRef.current) return;
        jumpingRef.current = true;
        var step = function () {
          var container = containerRef.current;
          var allNow = allRef.current;
          if (container === null || !container.isConnected || allNow === null || allNow.length === 0) {
            jumpingRef.current = false;
            return;
          }
          var nodes = container.querySelectorAll(USER_SELECTOR);
          var domIndex = index - (allNow.length - nodes.length);
          if (domIndex >= 0 && domIndex < nodes.length) {
            jumpingRef.current = false;
            scrollDomIndex(domIndex, true);
            return;
          }
          if (allNow.length - nodes.length <= 0) {
            jumpingRef.current = false;
            return;
          }
          var before = nodes.length;
          pullOlder();
          var waited = 0;
          var poll = setInterval(function () {
            waited += 120;
            var now = container.isConnected ? container.querySelectorAll(USER_SELECTOR).length : before;
            if (now !== before || waited >= LOAD_WAIT_MS) {
              clearInterval(poll);
              if (now === before) {
                // No progress: history exhausted or pager missing — give up
                // quietly instead of looping.
                jumpingRef.current = false;
                return;
              }
              step();
            }
          }, 120);
        };
        step();
      }

      function jumpToTick(tick) {
        jumpToMessage(tick.index);
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
        if (dragRef.current) {
          jumpToClientY(e.clientY, false);
          return;
        }
        // Fisheye tracking: remember the pointer's rail-relative Y (rAF
        // throttled) so every tick can grow by its distance falloff.
        var rail = railRef.current;
        if (rail === null) return;
        var y = e.clientY - rail.getBoundingClientRect().top;
        if (proxRafRef.current !== 0) return;
        proxRafRef.current = requestAnimationFrame(function () {
          proxRafRef.current = 0;
          setProxY(y);
        });
      }

      function onRailPointerLeave() {
        if (proxRafRef.current !== 0) {
          cancelAnimationFrame(proxRafRef.current);
          proxRafRef.current = 0;
        }
        setProxY(null);
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
        var tipText = hoverTick.text !== "" ? hoverTick.text : hoverTick.image ? t("tip.image") : t("tip.empty");
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
              children: tipText
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
        onPointerLeave: onRailPointerLeave,
        children: [
          ticks.map(function (tick, index) {
            var y = tickY(index);
            var active = hover === tick.key;
            var visible = inView(tick);
            // Fisheye magnification: while the pointer is over the rail, each
            // tick grows by a cosine falloff of its distance to the pointer —
            // the hovered tick longest, its neighbors a little, the rest at
            // rest width. The LEFT edge stays fixed; growth extends rightward.
            // Inline styles override the class geometry; with no pointer the
            // classes (rest / in-view) apply.
            var tickStyle = { top: Math.max(0, y - 1) + "px" };
            if (proxY !== null) {
              var f = proxFactor(Math.abs(y - proxY));
              var width = TICK_BASE_W + (TICK_MAX_W - TICK_BASE_W) * f;
              tickStyle.width = Math.round(width * 10) / 10 + "px";
              tickStyle.left = TICK_LEFT + "px";
              tickStyle.opacity = Math.min(1, (visible ? 0.9 : 0.45) + 0.55 * f);
            }
            return jsx("button", {
              type: "button",
              className: styles.tick + (visible ? " " + styles.tickInView : "") + (active ? " " + styles.tickActive : ""),
              "aria-label": t("tick.aria", { index: index + 1, total: tickCount }),
              title: "",
              style: tickStyle,
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
    /** Required browser services: slots, locale, and sessions (scoped paging). */
    var inject = ["slots", "locale", "sessions"];

    /**
     * Client plugin body: register the dictionaries, then contribute the
     * minimap into the session header utilities row once ui-conversation
     * declares it (ctx.slots.inject waits for the declaration). The component
     * renders no inline chrome — only the fixed rail over the chat pane.
     * @param ctx - browser root context.
     */
    function apply(ctx) {
      services.sessions = ctx.get("sessions") ?? null;
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
