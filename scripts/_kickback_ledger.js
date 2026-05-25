export class KickbackLedger {
  constructor(maxRekicks = 3) {
    this.counts = new Map();
    this.max = maxRekicks;
  }

  recordKickback(subtaskId) {
    const next = (this.counts.get(subtaskId) || 0) + 1;
    this.counts.set(subtaskId, next);
    return next;
  }

  shouldForceReject(subtaskId) {
    return (this.counts.get(subtaskId) || 0) >= this.max;
  }

  snapshot() {
    return Object.fromEntries(this.counts);
  }
}
