export class EvolutionIteration {
  constructor({ rawQuery, caseId, baselineRef, subtasks }) {
    this.rawQuery = rawQuery;
    this.caseId = caseId;
    this.baselineRef = baselineRef;
    this.subtasks = Object.freeze([...(subtasks ?? [])]);
    this.results = [];
    this.iterationId = `${caseId}-${Date.now()}`;
    this.stopped = false;
    this.stopReason = null;
  }

  recordResult(subtaskId, verdict, payload = {}) {
    const result = {
      subtaskId,
      verdict,
      ...payload,
    };
    this.results.push(result);

    if (payload.stop === true || verdict === "kicked-back") {
      this.stopped = true;
      this.stopReason = payload.stopReason ?? verdict;
    }

    return result;
  }

  isStopped() {
    return this.stopped;
  }
}
