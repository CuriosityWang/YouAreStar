// 2D projective transform (homography) utilities.
//
// A homography is a 3x3 matrix H mapping homogeneous points p = (x, y, 1):
//   [x']   [m0 m1 m2] [x]
//   [y'] = [m3 m4 m5] [y]
//   [w']   [m6 m7 m8] [1]
//   result = (x'/w', y'/w')
//
// Matrices here are ROW-MAJOR number[9] = [m0,m1,m2, m3,m4,m5, m6,m7,m8].

export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt];

/**
 * Solve the exact homography mapping the 4 source points to the 4 destination
 * points. Order of points must correspond (src[i] -> dst[i]).
 *
 * Builds an 8x8 linear system for the 8 unknowns (m8 fixed to 1) and solves it
 * with Gaussian elimination + partial pivoting.
 */
export function solve4Point(src: Quad, dst: Quad): Mat3 {
  // A·h = b, where h = [m0..m7]
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    // u = (m0 x + m1 y + m2) / (m6 x + m7 y + 1)
    //   => m0 x + m1 y + m2 - m6 x u - m7 y u = u
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    // v = (m3 x + m4 y + m5) / (m6 x + m7 y + 1)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. Solves A·x = b (A is n×n). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  // augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // pivot
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error("homography: degenerate quad (singular system)");
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    // normalize + eliminate
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row) => row[n]);
}

/** Invert a 3x3 matrix. Throws if singular. */
export function invert3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("homography: non-invertible matrix");
  const inv = 1 / det;
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Apply a homography to a point (returns dehomogenized [x, y]). */
export function applyMat3(m: Mat3, p: Pt): Pt {
  const [x, y] = p;
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** The unit-square source quad in UV order [TL, TR, BR, BL]. */
export const UNIT_QUAD: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * Homography mapping the destination quad (e.g. billboard corners in 0..1 image
 * space) back to source-image UV. This is what the fragment shader needs: for a
 * fragment at image-uv `p`, `applyMat3(result, p)` gives the UV to sample from
 * the user's image.
 */
export function destToSourceUV(dst: Quad): Mat3 {
  const forward = solve4Point(UNIT_QUAD, dst); // sourceUV -> dst
  return invert3x3(forward); // dst -> sourceUV
}

/** Convert a row-major Mat3 to the column-major Float32Array GLSL expects. */
export function toGLMat3(m: Mat3): Float32Array {
  return new Float32Array([
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ]);
}
