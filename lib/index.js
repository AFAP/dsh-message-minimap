// dsh-message-minimap — host half (Node).
//
// Serves the chat minimap's FULL user-message list for the Web GUI:
//   GET /api/message-minimap-messages?sessionId=…
//     → { total, messages: [{ seq, id, time, text, image }] }
//
// Why this route exists: the web GUI pages long sessions ("load older"), so
// the DOM only ever holds the most recent slice of a conversation. The
// minimap rail nevertheless shows one tick per user message — loaded or not —
// sourced from the session log, and the client pulls older pages on demand
// when a not-yet-rendered tick is clicked.
//
// The log is read from $DSH_HOME/sessions (the same layout and segment
// escaping as @deepseek-ai/dsh-session-persistence-jsonl): the session-owned
// directory is located by id-encoded segment, then session.jsonl /
// session.jsonl.zstd is parsed record by record. Only `user/message` records
// whose `source.kind` is "user" count — plugin-injected context snapshots
// (source.kind "plugin") render as context rows, never as user bubbles.
//
// READ-ONLY and excerpt-only: at most 140 collapsed characters per message
// plus its epoch time are returned — never full content, never any other
// record type. Payloads are cached by (path, size, mtime) so the client's
// light polling costs one stat(2) when nothing changed.
//
// DELIBERATELY DEPENDENCY-FREE: only Node builtins (fs/promises, os, path,
// zlib), so the plugin loads from any install method (git, registry, file:,
// link:) without a single @deepseek-ai/* import. The route is an EXACT
// webserver match and applies its own browser-trust fence (loopback /
// trustedHosts + same-origin), mirroring @deepseek-ai/dsh-client-connection
// (fence and session-resolution helpers adapted from dsh-input-file-ref).
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

/** Stable Cordis plugin name. */
const name = "message-minimap";
/** Services required before the route can be claimed. */
const inject = ["webServer"];

/** Session-path segment escaping; the injection-safe inverse decoder is not needed (read only). */
const SAFE_UNIT = /^[A-Za-z0-9._-]$/;
/** Preview characters kept per message. */
const EXCERPT_CHARS = 140;

/**
 * Injective single-segment encoding of a session id before any filesystem use
 * (same algorithm as @deepseek-ai/dsh-session-persistence-jsonl). Neutralizes
 * "..", absolute paths, NUL, and separators — a client-supplied id can never
 * escape the sessions root.
 */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && SAFE_UNIT.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

/** Resolve the harness sessions root: $DSH_HOME/sessions, else ~/.dsh/sessions. */
function sessionsRoot() {
  const env = process.env.DSH_HOME;
  const home = typeof env === "string" && env.trim() !== "" ? env.trim() : join(homedir(), ".dsh");
  return join(home, "sessions");
}

/** Read the validated `trustedHosts` list from the row config (never throws). */
function trustedHostsOf(config) {
  const value = config && config.trustedHosts;
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

// ── browser-trust fence (mirrors @deepseek-ai/dsh-client-connection) ──────

/** Whether a WHATWG hostname names the loopback authority. */
function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Whether the request's Host authority is loopback or a declared trusted host. */
function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    let entryUrl;
    try {
      entryUrl = new URL(`http://${entry}`);
    } catch {
      return false;
    }
    return entryUrl.port === "" ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
  });
}

/** Decide whether one request may reach /api/message-minimap-messages. */
function isTrustedRequest(req, trustedHosts) {
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// ── session log location ──────────────────────────────────────────────────

/**
 * Locate the app log file for one session id under the sessions root. Scans
 * the project/session directory tree for the session-owned directory named by
 * the id-encoded segment; returns the log path, or null when unknown.
 */
async function resolveSessionLog(root, rawId) {
  const encoded = encodeSegment(rawId);
  let outerEntries;
  try {
    outerEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const outer of outerEntries) {
    if (!outer.isDirectory()) continue;
    const sessionDir = join(root, outer.name, encoded);
    let innerEntries;
    try {
      innerEntries = await readdir(sessionDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const inner of innerEntries) {
      if (inner.name === "session.jsonl" || inner.name === "session.jsonl.zstd") {
        return join(sessionDir, inner.name);
      }
    }
  }
  return null;
}

// ── zstd frame walk (structural; tolerates a torn tail mid-write) ─────────

/** Zstandard frame magic, little-endian 0xFD2FB528. */
const ZSTD_MAGIC = 4247762216;

/**
 * Locate complete zstd frames without decompressing their blocks (structural
 * walk: magic + descriptor + block iterator + optional checksum). A trailing
 * partial frame (the writer is appending right now) is simply not returned.
 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

// ── log parsing ───────────────────────────────────────────────────────────

/**
 * Extract one minimap row from a `user/message` record: chronological seq,
 * epoch time, a whitespace-collapsed excerpt of the text parts, and an image
 * flag (so the tooltip can say "[image]" when there is no text).
 */
function rowOf(record) {
  const data = record.data;
  const parts = Array.isArray(data.content) ? data.content : [];
  const texts = [];
  let image = false;
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
    else if (part.type === "image") image = true;
  }
  let text = texts.join("\n").replace(/\s+/g, " ").trim();
  if (text.length > EXCERPT_CHARS) text = text.slice(0, EXCERPT_CHARS) + "…";
  return {
    seq: typeof record.seq === "number" ? record.seq : 0,
    id: typeof data.id === "string" && data.id !== "" ? data.id : null,
    time: typeof record.time === "number" ? record.time : 0,
    text,
    image
  };
}

/** Payload cache keyed by log path, revalidated by (size, mtime). */
const cache = new Map();

/**
 * Read every real user message of the session log in chronological order.
 * Plaintext logs are split into lines; zstd logs are walked frame by frame
 * (a torn tail mid-write is skipped, partial final lines fail JSON.parse and
 * are skipped). Records are cheap-filtered on the '"user/message"' substring
 * before parsing. Only `surfaceOp` absent/"append" rows with
 * `data.source.kind === "user"` are kept — plugin context snapshots, inbox
 * splices and steering internals never render as user bubbles.
 */
async function readAllMessages(logPath) {
  const info = await stat(logPath);
  const stamp = { size: info.size, mtimeMs: Math.floor(info.mtimeMs) };
  const cached = cache.get(logPath);
  if (cached !== void 0 && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs) return cached.payload;
  const buffer = await readFile(logPath);
  let text;
  if (logPath.endsWith(".zstd")) {
    const { frames } = scanZstdFrames(buffer);
    const parts = [];
    for (const frame of frames) {
      try {
        parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString("utf8"));
      } catch {
        // Skip an undecodable frame rather than failing the whole listing.
      }
    }
    text = parts.join("");
  } else {
    // Tolerate a leading UTF-8 BOM in plaintext artifacts (some editors add one).
    text = buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  const messages = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"user/message"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record === null || typeof record !== "object" || record.type !== "user/message") continue;
    if (record.surfaceOp !== void 0 && record.surfaceOp !== "append") continue;
    const data = record.data;
    if (data === null || typeof data !== "object") continue;
    const source = data.source;
    if (source === null || typeof source !== "object" || source.kind !== "user") continue;
    messages.push(rowOf(record));
  }
  const payload = { messages, total: messages.length };
  cache.set(logPath, { size: stamp.size, mtimeMs: stamp.mtimeMs, payload });
  return payload;
}

// ── the /api/message-minimap-messages endpoint ────────────────────────────

/** Build the route handler bound to this plugin's context and config. */
function createHandler(ctx, config) {
  const trustedHosts = trustedHostsOf(config);
  return async (req, res) => {
    res.setHeader?.("cache-control", "no-store");
    let url;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid request url" }));
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (!isTrustedRequest(req, trustedHosts)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const sessionId = url.searchParams.get("sessionId") ?? void 0;
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "missing or empty sessionId" }));
      return;
    }
    try {
      const logPath = await resolveSessionLog(sessionsRoot(), sessionId);
      if (logPath === null) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "session not found", sessionId }));
        return;
      }
      const payload = await readAllMessages(logPath);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
    }
  };
}

/** Register the minimap route; the disposer releases it on plugin unload. */
function apply(ctx, config) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/message-minimap-messages",
    handler: createHandler(ctx, config)
  }), "message-minimap: /api/message-minimap-messages route");
}

export { apply, inject, name };
