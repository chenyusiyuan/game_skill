/** Returns value clamped into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
/** Linearly interpolates from a to b without clamping t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Returns a clamped linear ramp from from to to as t moves from 0 to 1. */
export function linearRamp(t: number, from: number, to: number): number {
  return lerp(from, to, clamp(t, 0, 1));
}
/** Applies exponential growth for a number of ticks. */
export function exponentialRamp(value: number, growth: number, ticks: number): number {
  return value * Math.pow(growth, ticks);
}
/** Returns base at level 1, then multiplies by growth for each later level. */
export function thresholdCurve(level: number, base: number, growth: number): number {
  return base * Math.pow(growth, Math.max(1, level) - 1);
}
/** Returns a wave multiplier using 1 as the wave 1 baseline. */
export function waveScale(wave: number, perWaveMultiplier: number): number {
  return 1 + (Math.max(1, wave) - 1) * perWaveMultiplier;
}
/** Returns a random float in the half-open range [min, max). */
export function randRange(min: number, max: number): number {
  return min + (max - min) * Math.random();
}
/** Returns a random integer in the inclusive range [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(randRange(Math.ceil(min), Math.floor(max) + 1));
}
