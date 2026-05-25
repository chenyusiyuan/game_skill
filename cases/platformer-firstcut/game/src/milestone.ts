export interface MilestonePayload {
  id: string;
  kind?: string;
  value?: unknown;
  [key: string]: unknown;
}

export function emitMilestone(id: string, payload: Record<string, unknown> = {}): void {
  console.log('[milestone]', JSON.stringify({ id, ...payload }));
}

declare global {
  interface Window {
    __state?: Record<string, unknown>;
  }
}

export {};
