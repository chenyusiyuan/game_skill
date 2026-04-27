// grid-board reducer
export const id = 'grid-board';
export const version = 'v1';
export const handles = ['add-cell', 'remove-cell'];
export const emittedEvents = ['board.cell-added', 'board.cell-removed', 'board.empty'];

export function step(state, action, params) {
  const next = { ...state, cells: [...(state.cells || [])], _events: [] };
  if (action.type === 'add-cell') {
    next.cells.push({ ...action.cell, alive: true });
    next._events.push({ type: 'board.cell-added', cell: action.cell });
    return next;
  }
  if (action.type === 'remove-cell') {
    const idx = next.cells.findIndex(c => c.id === action.cellId);
    if (idx >= 0) {
      next.cells[idx] = { ...next.cells[idx], alive: false };
      next._events.push({ type: 'board.cell-removed', cellId: action.cellId });
      if (next.cells.every(c => !c.alive)) {
        next._events.push({ type: 'board.empty' });
      }
    }
    return next;
  }
  return state;
}

export function checkInvariants(state, params) {
  const violations = [];
  const cells = state.cells || [];
  const ids = new Set();
  const positions = new Set();
  for (const cell of cells) {
    if (cell.row < 0 || cell.row >= params.rows) {
      violations.push(`bounds: cell ${cell.id} row=${cell.row} out of [0, ${params.rows})`);
    }
    if (cell.col < 0 || cell.col >= params.cols) {
      violations.push(`bounds: cell ${cell.id} col=${cell.col} out of [0, ${params.cols})`);
    }
    if (ids.has(cell.id)) violations.push(`id-unique: duplicate id ${cell.id}`);
    ids.add(cell.id);
    if (cell.alive) {
      const key = `${cell.row},${cell.col}`;
      if (positions.has(key)) violations.push(`unique-position: (${cell.row},${cell.col}) occupied by multiple alive cells`);
      positions.add(key);
    }
    // field-conformance
    for (const fdef of params['cell-fields'] || []) {
      if (fdef.type === 'enum' && cell[fdef.name] !== undefined) {
        if (!fdef.values.includes(cell[fdef.name])) {
          violations.push(`field-conformance: cell ${cell.id}.${fdef.name}=${cell[fdef.name]} not in ${fdef.values}`);
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
