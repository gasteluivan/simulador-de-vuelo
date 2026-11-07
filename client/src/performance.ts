/** Raw animation-frame intervals. Never feed the clamped physics delta into these metrics. */
export class FrameMetrics {
  private samples = new Float64Array(240);
  private cursor = 0;
  private count = 0;
  private total = 0;
  private slow = 0;
  add(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (this.count === this.samples.length) {
      this.total -= this.samples[this.cursor];
      if (this.samples[this.cursor] > 33.34) this.slow--;
    } else this.count++;
    this.samples[this.cursor] = ms;
    this.total += ms;
    if (ms > 33.34) this.slow++;
    this.cursor = (this.cursor + 1) % this.samples.length;
  }
  snapshot() {
    const values = Array.from(this.samples.subarray(0, this.count)).sort(
      (a, b) => a - b,
    );
    const mean = this.count ? this.total / this.count : 0;
    return {
      fps: mean ? 1000 / mean : 0,
      mean,
      p95: values[Math.max(0, Math.ceil(this.count * 0.95) - 1)] ?? 0,
      p99: values[Math.max(0, Math.ceil(this.count * 0.99) - 1)] ?? 0,
      slow: this.slow,
      count: this.count,
    };
  }
  reset() {
    this.cursor = this.count = this.total = this.slow = 0;
  }
}
/** Conservative, time-based resolution control. Hysteresis prevents resolution oscillation. */
export class ResolutionGovernor {
  scale = 1;
  private average = 16.67;
  private elapsed = 0;
  private bad = 0;
  private good = 0;
  update(ms: number) {
    if (ms <= 0 || ms > 250) return this.scale;
    const dt = ms / 1000;
    this.elapsed += dt;
    this.average += (ms - this.average) * (1 - Math.exp(-dt * 1.5));
    if (this.elapsed < 3) return this.scale;
    this.bad = this.average > 22 ? this.bad + dt : 0;
    this.good = this.average < 17.5 ? this.good + dt : 0;
    if (this.bad > 2) {
      this.scale = Math.max(0.6, Number((this.scale - 0.1).toFixed(1)));
      this.bad = this.good = 0;
    } else if (this.good > 8) {
      this.scale = Math.min(1, Number((this.scale + 0.05).toFixed(2)));
      this.good = this.bad = 0;
    }
    return this.scale;
  }
  reset() {
    this.scale = 1;
    this.average = 16.67;
    this.elapsed = this.bad = this.good = 0;
  }
}
