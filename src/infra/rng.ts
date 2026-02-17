/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Deterministic: same seed = same sequence
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Box-Muller: returns a standard normal variate */
  nextGaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  }

  /** Returns an array of n independent standard normal variates */
  nextGaussianVector(n: number): number[] {
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      v.push(this.nextGaussian());
    }
    return v;
  }
}
