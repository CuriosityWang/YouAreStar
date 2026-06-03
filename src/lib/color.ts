// Reinhard "Color Transfer between Images" (2001) statistics, computed in the
// decorrelated lαβ color space.
//
// Pipeline (must stay in sync with the GLSL implementation in shaders.ts):
//   RGB -> LMS -> log10 -> lαβ        (forward, here + shader)
//   lαβ -> log10 LMS -> 10^x -> RGB   (inverse, shader only)
//
// We compute per-channel mean & std of lαβ for the user image (source) and for
// the billboard region (target); the shader then remaps source onto target.

export type Vec3 = [number, number, number];

export interface Stats {
  mean: Vec3;
  std: Vec3;
}

const EPS = 1e-4;

/** sRGB (0..1) -> lαβ. */
export function rgbToLab(r: number, g: number, b: number): Vec3 {
  // RGB -> LMS
  let L = 0.3811 * r + 0.5783 * g + 0.0402 * b;
  let M = 0.1967 * r + 0.7244 * g + 0.0782 * b;
  let S = 0.0241 * r + 0.1288 * g + 0.8444 * b;

  // log10, guarded
  L = Math.log10(Math.max(L, EPS));
  M = Math.log10(Math.max(M, EPS));
  S = Math.log10(Math.max(S, EPS));

  // LMS(log) -> lαβ
  const l = (L + M + S) / Math.sqrt(3);
  const a = (L + M - 2 * S) / Math.sqrt(6);
  const bb = (L - M) / Math.sqrt(2);
  return [l, a, bb];
}

/**
 * Accumulator for streaming mean/std (Welford-free two-pass not needed — we use
 * sum and sumSq which is plenty stable for 8-bit image data).
 */
export class StatsAccumulator {
  private n = 0;
  private sum: Vec3 = [0, 0, 0];
  private sumSq: Vec3 = [0, 0, 0];

  addRGB(r: number, g: number, b: number) {
    const lab = rgbToLab(r, g, b);
    this.n++;
    for (let i = 0; i < 3; i++) {
      this.sum[i] += lab[i];
      this.sumSq[i] += lab[i] * lab[i];
    }
  }

  get count() {
    return this.n;
  }

  result(): Stats {
    if (this.n === 0) {
      return { mean: [0, 0, 0], std: [1, 1, 1] };
    }
    const mean: Vec3 = [0, 0, 0];
    const std: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      mean[i] = this.sum[i] / this.n;
      const variance = Math.max(0, this.sumSq[i] / this.n - mean[i] * mean[i]);
      std[i] = Math.sqrt(variance);
    }
    return { mean, std };
  }
}

/** Neutral stats (identity transfer) — used before any image is loaded. */
export const NEUTRAL_STATS: Stats = { mean: [0, 0, 0], std: [1, 1, 1] };
