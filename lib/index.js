// dsh-message-minimap — host half (Node).
//
// DELIBERATE NO-OP. Since DSH 0.1.7 the chat minimap needs no host data at
// all: the browser reads the whole-log turn list from the official
// `turnOutline` session projection (registered by @deepseek-ai/dsh-web-app via
// @deepseek-ai/dsh-session-turn-outline) and pages history through the
// official session face (`sessions.binding(id).session.loadThrough(seq)`), so
// the earlier /api/message-minimap-messages route — and its session-log
// parsing — is gone. That also removes the coupling to the on-disk log layout,
// which changed in 0.1.7 (session.v3/v4.jsonl.zstd with a new container
// format).
//
// The module still exists because the client module system
// (@deepseek-ai/dsh-client-modules) discovers browser bundles by scanning the
// host Loader's entries for packages declaring `dsh.client`: without this row
// (inserted by cordis.patch.yml) the /plugins/<id>/client.js bundle would
// never be advertised to the web shell.
//
// Zero external imports — loads from any install method (git, registry,
// file:, link:) without a single dependency.

/** Stable Cordis plugin name. */
const name = "message-minimap";
/** No services required. */
const inject = [];

/** Nothing to register on the host; present for the Loader entry only. */
function apply() {}

export { apply, inject, name };
