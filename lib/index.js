// dsh-message-minimap — host half (Node).
//
// The browser half needs no host data for the rail itself: it reads the whole
// log's turn list from the official `turnOutline` session projection and pages
// history through the official session face. This half exists for two reasons:
//
// 1. The client module system (@deepseek-ai/dsh-client-modules) discovers
//    browser bundles by scanning the host Loader's entries for packages that
//    declare `dsh.client`; without this row (inserted by cordis.patch.yml) the
//    /plugins/dsh-message-minimap/client.js bundle would never be advertised.
// 2. It registers one tiny client-visible session projection,
//    `messageMinimapTimes`, folding `turn/start` boundaries into `{turn, time}`.
//    The official `turnOutline` deliberately carries no timestamps, so this is
//    what lets the hover card show the send date/time for turns whose events
//    are not loaded. It opens no route, reads no files, and keeps no host
//    state of its own; the projection registry drives it.
//
// The projection module imports zod. Registration is optional and lazy: if the
// projection service or the dependency is unavailable, this plugin still
// advertises the client bundle and the hover card falls back to the rendered
// row's clock.

/** Stable Cordis plugin name. */
const name = "message-minimap";
/** No required services; the projection is an optional internal contribution. */
const inject = [];

/**
 * Register the turn-time projection when the host projection registry is
 * available, without ever blocking the client bundle advertisement.
 * @param ctx - host root context.
 */
function apply(ctx) {
  ctx.inject(["sessionProjections"], async (projectionCtx) => {
    try {
      const { messageMinimapTimesProjection } = await import("./projection.js");
      await projectionCtx.sessionProjections.register(messageMinimapTimesProjection);
    } catch (error) {
      const reason = error !== null && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : String(error);
      projectionCtx.logger.warn("[dsh-message-minimap] turn-time projection unavailable: " + reason);
    }
  });
}

export { apply, inject, name };
