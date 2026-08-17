// dsh-message-minimap — host half (Node).
//
// DELIBERATE NO-OP: this plugin is pure client-side. The chat minimap needs
// no HTTP route, no filesystem access and no configuration — it only reads
// the conversation DOM already rendered in the browser (the chat flow items
// carry stable `data-chat-flow-kind="user"` anchors) and scrolls the existing
// chat scroll container.
//
// The host module still exists because the client module system
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
