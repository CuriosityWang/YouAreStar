// WebGL1 renderer for the billboard composite. One full-screen pass; the same
// code path drives the live preview and the full-resolution export, so what you
// see is exactly what you download.

import { destToSourceUV, toGLMat3, type Quad } from "../homography";
import { NEUTRAL_STATS, type Stats } from "../color";
import type { Corners } from "../../data/presets";
import { FRAG_SRC, VERT_SRC } from "./shaders";

export type BlendMode = "normal" | "multiply" | "soft-light" | "screen";
export const BLEND_MODES: BlendMode[] = ["normal", "multiply", "soft-light", "screen"];

export interface GradeParams {
  autoStrength: number; // 0..1
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  temperature: number; // -1..1
}

export interface BlendParams {
  mode: BlendMode;
  opacity: number; // 0..1
  feather: number; // 0..1
  grain: number; // 0..1
}

export const DEFAULT_GRADE: GradeParams = {
  autoStrength: 0.5,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};

export const DEFAULT_BLEND: BlendParams = {
  mode: "normal",
  opacity: 1,
  feather: 0.04,
  grain: 0.1,
};

export interface RenderState {
  corners: Corners;
  hasUser: boolean;
  srcStats: Stats;
  tgtStats: Stats;
  grade: GradeParams;
  blend: BlendParams;
  seed: number;
}

const MAX_FEATHER_UV = 0.18;

type TexImage = TexImageSource;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile error: " + log);
  }
  return sh;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private texBg: WebGLTexture;
  private texUser: WebGLTexture;
  private texMask: WebGLTexture;
  private placeholder: WebGLTexture;
  private vbo: WebGLBuffer | null = null;
  private vs: WebGLShader | null = null;
  private fs: WebGLShader | null = null;
  private hasMask = false;
  /** background pixel dimensions, set on setBackground */
  bgWidth = 0;
  bgHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error("WebGL is not available in this browser.");
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.vs = vs;
    this.fs = fs;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("program link error: " + gl.getProgramInfoLog(program));
    }
    this.program = program;
    gl.useProgram(program);

    // full-screen triangle
    const buf = gl.createBuffer();
    this.vbo = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // cache uniform locations
    for (const name of [
      "u_bg", "u_user", "u_mask", "u_hasUser", "u_hasMask", "u_destToSrc",
      "u_srcMean", "u_srcStd", "u_tgtMean", "u_tgtStd", "u_autoStrength",
      "u_brightness", "u_contrast", "u_saturation", "u_temperature",
      "u_opacity", "u_feather", "u_blendMode", "u_grain", "u_resolution", "u_seed",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    // bind samplers to fixed texture units
    gl.uniform1i(this.uniforms.u_bg, 0);
    gl.uniform1i(this.uniforms.u_user, 1);
    gl.uniform1i(this.uniforms.u_mask, 2);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.placeholder = this.makeTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.placeholder);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    this.texBg = this.placeholder;
    this.texUser = this.placeholder;
    this.texMask = this.placeholder;
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private upload(img: TexImage, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = this.makeTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    void w;
    void h;
    return tex;
  }

  setBackground(img: TexImage, width: number, height: number) {
    if (this.texBg !== this.placeholder) this.gl.deleteTexture(this.texBg);
    this.texBg = this.upload(img, width, height);
    this.bgWidth = width;
    this.bgHeight = height;
  }

  setUser(img: TexImage | null) {
    if (this.texUser !== this.placeholder) this.gl.deleteTexture(this.texUser);
    this.texUser = img ? this.upload(img, 0, 0) : this.placeholder;
  }

  setMask(img: TexImage | null) {
    if (this.texMask !== this.placeholder) this.gl.deleteTexture(this.texMask);
    this.texMask = img ? this.upload(img, 0, 0) : this.placeholder;
    this.hasMask = !!img;
  }

  /**
   * Incrementally upload `source` (its full pixels) into the existing mask
   * texture at (x, y), in mask-canvas pixels. WebGL1 texSubImage2D has no
   * source-rect arg, so callers pass a small scratch canvas already cropped to
   * the dirty region. Requires a prior setMask(canvas) so texMask is full-size.
   */
  updateMaskRegion(source: TexImageSource, x: number, y: number) {
    if (!this.hasMask) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  resize(width: number, height: number) {
    // Assigning canvas.width/height always clears + reallocates the drawing
    // buffer, so skip it when the size is unchanged (e.g. a slider/handle tick
    // re-renders at the same dimensions).
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(state: RenderState) {
    const gl = this.gl;
    const u = this.uniforms;
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texUser);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);

    const hasUser = state.hasUser;
    gl.uniform1i(u.u_hasUser, hasUser ? 1 : 0);
    gl.uniform1i(u.u_hasMask, this.hasMask ? 1 : 0);

    const m = destToSourceUV(state.corners as unknown as Quad);
    gl.uniformMatrix3fv(u.u_destToSrc, false, toGLMat3(m));

    const src = hasUser ? state.srcStats : NEUTRAL_STATS;
    const tgt = hasUser ? state.tgtStats : NEUTRAL_STATS;
    gl.uniform3fv(u.u_srcMean, src.mean);
    gl.uniform3fv(u.u_srcStd, src.std);
    gl.uniform3fv(u.u_tgtMean, tgt.mean);
    gl.uniform3fv(u.u_tgtStd, tgt.std);

    const g = state.grade;
    gl.uniform1f(u.u_autoStrength, g.autoStrength);
    gl.uniform1f(u.u_brightness, 1 + g.brightness);
    gl.uniform1f(u.u_contrast, 1 + g.contrast);
    gl.uniform1f(u.u_saturation, 1 + g.saturation);
    gl.uniform1f(u.u_temperature, g.temperature);

    const b = state.blend;
    gl.uniform1f(u.u_opacity, b.opacity);
    gl.uniform1f(u.u_feather, b.feather * MAX_FEATHER_UV);
    gl.uniform1i(u.u_blendMode, BLEND_MODES.indexOf(b.mode));
    gl.uniform1f(u.u_grain, b.grain);
    gl.uniform2f(u.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_seed, state.seed);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * @param loseContext only for throwaway renderers (export). Never pass true
   * for the live canvas: the canvas caches its context, so losing it would give
   * a remounted renderer (e.g. React StrictMode) a dead context.
   */
  dispose(loseContext = false) {
    const gl = this.gl;
    if (this.texBg !== this.placeholder) gl.deleteTexture(this.texBg);
    if (this.texUser !== this.placeholder) gl.deleteTexture(this.texUser);
    if (this.texMask !== this.placeholder) gl.deleteTexture(this.texMask);
    gl.deleteTexture(this.placeholder);
    gl.deleteProgram(this.program);
    gl.deleteShader(this.vs);
    gl.deleteShader(this.fs);
    gl.deleteBuffer(this.vbo);
    if (loseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/**
 * Render the composite at full background resolution to an offscreen canvas and
 * return a PNG blob. Uses a throwaway renderer so the live preview is untouched.
 */
export async function renderToBlob(opts: {
  bg: TexImage;
  bgWidth: number;
  bgHeight: number;
  user: TexImage | null;
  mask: TexImage | null;
  state: RenderState;
  maxDim?: number;
}): Promise<Blob> {
  const { bg, bgWidth, bgHeight, user, mask, state } = opts;
  const maxDim = opts.maxDim ?? 2400;
  const scale = Math.min(1, maxDim / Math.max(bgWidth, bgHeight));
  const w = Math.round(bgWidth * scale);
  const h = Math.round(bgHeight * scale);

  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas);
  try {
    r.resize(w, h);
    r.setBackground(bg, bgWidth, bgHeight);
    r.setUser(user);
    r.setMask(mask);
    r.render(state);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("export failed: could not encode canvas");
    return blob;
  } finally {
    // Always free the throwaway context — even if render() throws on a
    // degenerate quad — so failed exports don't leak WebGL contexts.
    r.dispose(true);
  }
}
