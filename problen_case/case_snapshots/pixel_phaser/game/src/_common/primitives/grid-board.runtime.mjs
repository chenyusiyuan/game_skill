/**
 * grid-board.runtime.mjs — 浏览器 runtime wrapper for grid-board@v1
 *
 * 业务代码调：
 *   import { addCell, removeCell } from '../_common/primitives/grid-board.runtime.mjs';
 *   state.board = addCell({ rule: 'spawn', node: 'spawn-block', board: state.board,
 *                           cell: {row, col, color}, params: { rows, cols } });
 */

import { step as gbStep } from "../../../mechanics/spatial/grid-board.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function addCell(ctx) {
  const { rule, node = null, board, cell, params = {} } = ctx;
  const before = snapshot(board);
  const result = gbStep(before, { type: "add-cell", cell }, params);
  const after = { ...result };
  delete after._events;
  pushTraceEvent({
    primitive: "grid-board@v1",
    rule,
    node,
    before: { board: before, op: "add-cell", cell: snapshot(cell) },
    after: { board: after, events: result._events ?? [] },
  });
  return after;
}

export function removeCell(ctx) {
  const { rule, node = null, board, cell, cellId, params = {} } = ctx;
  const resolvedCellId = cellId ?? cell?.id ?? cell?.cellId ?? null;
  const before = snapshot(board);
  const result = gbStep(before, { type: "remove-cell", cellId: resolvedCellId }, params);
  const after = { ...result };
  delete after._events;
  pushTraceEvent({
    primitive: "grid-board@v1",
    rule,
    node,
    before: { board: before, op: "remove-cell", cell: snapshot(cell), cellId: resolvedCellId },
    after: { board: after, events: result._events ?? [] },
  });
  return after;
}
