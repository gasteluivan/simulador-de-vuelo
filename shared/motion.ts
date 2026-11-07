/** One Euro style filter: strong jitter suppression at rest, faster response during motion.
 * dt is seconds; cutoff is Hz. No prediction, overshoot or dependence on display refresh rate.
 */
export class AdaptiveFilter {
  private value = 0;
  private previous = 0;
  private derivative = 0;
  private initialized = false;
  constructor(
    private cutoff = 2.5,
    private beta = 0.7,
  ) {}
  reset(value?: number) {
    this.initialized = value !== undefined;
    this.value = this.previous = value ?? 0;
    this.derivative = 0;
  }
  update(raw: number, dt: number) {
    if (!this.initialized || dt > 0.5) {
      this.reset(raw);
      return raw;
    }
    dt = Math.max(0.001, dt);
    const alpha = (hz: number) => 1 - Math.exp(-2 * Math.PI * hz * dt);
    this.derivative +=
      ((raw - this.previous) / dt - this.derivative) * alpha(1);
    this.previous = raw;
    this.value +=
      (raw - this.value) *
      alpha(this.cutoff + this.beta * Math.abs(this.derivative));
    return this.value;
  }
}
