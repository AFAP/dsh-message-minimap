// dsh-message-minimap — host half's turn-time projection.
//
// The chat's official `turnOutline` projection names every turn of the session
// but deliberately carries no timestamps (its brief is the rail's prompt and
// response previews). The hover card wants the send date/time for turns whose
// events are not loaded, so this unit folds the same `turn/start` boundaries
// into a second, tiny client-visible projection: one `{ turn, time }` per
// turn. It reads no files and opens no routes; the session projection registry
// drives it over the committed session log.
//
// The wire value is the complete entry array, strictly increasing by turn
// (whole-value rule). `summary: false` keeps a whole-session list out of
// session-list summaries, matching turnOutline's growth profile.
import { z } from "zod";

/** One turn's start time (Unix epoch ms), in strictly increasing turn order. */
const entrySchema = z.object({
  turn: z.number().int().nonnegative(),
  time: z.number().nonnegative()
}).strict();

const entriesSchema = z.array(entrySchema);

/** The `messageMinimapTimes` unit registered on `ctx.sessionProjections`. */
export const messageMinimapTimesProjection = {
  key: "messageMinimapTimes",
  stateVersion: 1,
  stateSchema: z.object({ turns: entriesSchema }).strict(),
  init: () => ({ turns: [] }),
  apply: (state, event) => {
    // Only a turn boundary matters; every other event keeps the state reference
    // so the registry's Object.is gate suppresses downstream work.
    if (event.type !== "turn/start") return state;
    if (typeof event.data.turn !== "number" || typeof event.time !== "number") return state;
    const last = state.turns[state.turns.length - 1];
    // Order guard: a retried boundary that does not advance the turn number
    // keeps the outline sorted and is ignored.
    if (last !== undefined && event.data.turn <= last.turn) return state;
    return { turns: [...state.turns, { turn: event.data.turn, time: event.time }] };
  },
  wire: {
    viewSchema: entriesSchema,
    view: (state) => state.turns,
    summary: false
  }
};
