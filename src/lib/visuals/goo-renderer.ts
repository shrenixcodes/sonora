/**
 * GPU metaball renderer for the symbiote liquid.
 *
 * Pass 1 splats every blob into a half-resolution field texture with additive
 * blending: alpha holds the field strength, rgb the color weighted by it.
 * Pass 2 thresholds the field into a surface with anti-aliased edges, shades it
 * from the field's gradient (wet specular highlight, rim light), and writes
 * premultiplied color to a transparent canvas over the app.
 *
 * Everything per-pixel runs on the GPU; the CPU only uploads a few thousand
 * blob positions per frame.
 */

export interface GooBlob {
  x: number;
  y: number;
  /** Visible radius in CSS px (for a single blob of weight 1). */
  r: number;
  /** Field contribution; chains of overlapping blobs use less than 1 each. */
  w: number;
  /** Index into the colors passed to setColors. */
  c: number;
}

/** A blob's visible radius is this fraction of its support radius at weight 1. */
const VISIBLE_FRACTION = 0.45;
const FLOATS_PER_BLOB = 5;

const SPLAT_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_blob;   // x, y, support radius, weight
layout(location = 2) in float a_color;
uniform vec2 u_view;
uniform vec3 u_colors[3];
out vec2 v_uv;
out float v_w;
out vec3 v_col;
void main() {
  vec2 p = a_blob.xy + a_corner * a_blob.z;
  vec2 clip = p / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_corner;
  v_w = a_blob.w;
  v_col = u_colors[int(a_color + 0.5)];
}`;

const SPLAT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in float v_w;
in vec3 v_col;
uniform float u_scale;
out vec4 o;
void main() {
  float d2 = dot(v_uv, v_uv);
  if (d2 >= 1.0) discard;
  float f = 1.0 - d2;
  f = f * f * f * v_w;
  o = vec4(v_col * f, f) * u_scale;
}`;

const COMPOSITE_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() {
  vec2 p = P[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_field;
uniform vec2 u_texel;
uniform float u_unscale;
uniform vec3 u_sheen;
uniform vec3 u_rim;
in vec2 v_uv;
out vec4 o;
const float T = 0.5;
float height(vec2 uv) {
  return smoothstep(T, T + 0.65, texture(u_field, uv).a * u_unscale);
}
void main() {
  vec4 s = texture(u_field, v_uv) * u_unscale;
  float f = s.a;
  float aa = max(fwidth(f), 1e-4);
  float a = smoothstep(T - aa, T + aa, f);
  if (a <= 0.001) { o = vec4(0.0); return; }

  vec3 base = s.rgb / max(f, 1e-4);
  float hx = height(v_uv + vec2(u_texel.x, 0.0)) - height(v_uv - vec2(u_texel.x, 0.0));
  float hy = height(v_uv + vec2(0.0, u_texel.y)) - height(v_uv - vec2(0.0, u_texel.y));
  vec3 n = normalize(vec3(-hx * 3.5, -hy * 3.5, 1.0));

  vec3 L = normalize(vec3(-0.5, 0.6, 0.62));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 46.0);
  float rimBand = 1.0 - smoothstep(T, T + 0.14, f);

  vec3 col = base * (0.5 + 0.5 * diffuse);
  col += u_sheen * spec * 1.15;
  col = mix(col, u_rim, rimBand * 0.55);
  o = vec4(col * a, a);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const make = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[goo] shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (!v || !f || !program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[goo] link:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function hexToVec(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class GooRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private splat: WebGLProgram;
  private composite: WebGLProgram;
  private splatViewLoc: WebGLUniformLocation | null;
  private splatColorsLoc: WebGLUniformLocation | null;
  private splatScaleLoc: WebGLUniformLocation | null;
  private compFieldLoc: WebGLUniformLocation | null;
  private compTexelLoc: WebGLUniformLocation | null;
  private compUnscaleLoc: WebGLUniformLocation | null;
  private compSheenLoc: WebGLUniformLocation | null;
  private compRimLoc: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;
  private instances: WebGLBuffer;
  private fieldTex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private floatField: boolean;
  private data = new Float32Array(FLOATS_PER_BLOB * 2048);
  private fieldW = 0;
  private fieldH = 0;
  private viewW = 0;
  private viewH = 0;
  private colors = new Float32Array(9);
  private sheen: [number, number, number] = [1, 1, 1];
  private rim: [number, number, number] = [0.65, 0.55, 0.98];

  /** Null when WebGL2 is unavailable; callers then skip the liquid. */
  static create(): GooRenderer | null {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance",
      });
      if (!gl) return null;
      return new GooRenderer(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.floatField = gl.getExtension("EXT_color_buffer_float") !== null;

    const splat = compile(gl, SPLAT_VS, SPLAT_FS);
    const composite = compile(gl, COMPOSITE_VS, COMPOSITE_FS);
    const vao = gl.createVertexArray();
    const corners = gl.createBuffer();
    const instances = gl.createBuffer();
    const fieldTex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!splat || !composite || !vao || !corners || !instances || !fieldTex || !fbo) {
      throw new Error("goo renderer setup failed");
    }
    this.splat = splat;
    this.composite = composite;
    this.splatViewLoc = gl.getUniformLocation(splat, "u_view");
    this.splatColorsLoc = gl.getUniformLocation(splat, "u_colors");
    this.splatScaleLoc = gl.getUniformLocation(splat, "u_scale");
    this.compFieldLoc = gl.getUniformLocation(composite, "u_field");
    this.compTexelLoc = gl.getUniformLocation(composite, "u_texel");
    this.compUnscaleLoc = gl.getUniformLocation(composite, "u_unscale");
    this.compSheenLoc = gl.getUniformLocation(composite, "u_sheen");
    this.compRimLoc = gl.getUniformLocation(composite, "u_rim");
    this.vao = vao;
    this.instances = instances;
    this.fieldTex = fieldTex;
    this.fbo = fbo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_BLOB * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  setColors(fills: Array<[number, number, number]>, sheen: string, rim: string): void {
    for (let i = 0; i < 3; i++) {
      const c = fills[i] ?? fills[0];
      this.colors[i * 3] = c[0] / 255;
      this.colors[i * 3 + 1] = c[1] / 255;
      this.colors[i * 3 + 2] = c[2] / 255;
    }
    this.sheen = hexToVec(sheen);
    this.rim = hexToVec(rim);
  }

  /** Sizes the canvas to the window (CSS px). */
  resize(width: number, height: number): void {
    const gl = this.gl;
    // Cap canvas backing store at 1x CSS px so Pass 2 shading stays fast on HiDPI / low-end GPUs.
    const cw = Math.max(1, Math.round(width));
    const ch = Math.max(1, Math.round(height));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.viewW = width;
    this.viewH = height;

    // The field only needs to be smooth; the threshold keeps edges crisp
    const scale = width * height > 1_600_000 ? 0.28 : 0.35;
    const fw = Math.max(1, Math.round(width * scale));
    const fh = Math.max(1, Math.round(height * scale));
    if (fw === this.fieldW && fh === this.fieldH) return;
    this.fieldW = fw;
    this.fieldH = fh;

    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    if (this.floatField) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fieldTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.floatField) {
      // Float targets unsupported after all: fall back to 8-bit
      this.floatField = false;
      this.fieldW = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.resize(width, height);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(blobs: readonly GooBlob[]): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const count = blobs.length;
    if (this.data.length < count * FLOATS_PER_BLOB) {
      this.data = new Float32Array(count * FLOATS_PER_BLOB * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    }
    const d = this.data;
    for (let i = 0; i < count; i++) {
      const b = blobs[i];
      const o = i * FLOATS_PER_BLOB;
      d[o] = b.x;
      d[o + 1] = b.y;
      d[o + 2] = b.r / VISIBLE_FRACTION;
      d[o + 3] = b.w;
      d[o + 4] = b.c;
    }
    const fieldScale = this.floatField ? 1 : 0.25;

    // Pass 1: field
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fieldW, this.fieldH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count > 0) {
      gl.useProgram(this.splat);
      gl.uniform2f(this.splatViewLoc, this.viewW, this.viewH);
      gl.uniform3fv(this.splatColorsLoc, this.colors);
      gl.uniform1f(this.splatScaleLoc, fieldScale);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, count * FLOATS_PER_BLOB);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    // Pass 2: surface
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;
    gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.uniform1i(this.compFieldLoc, 0);
    gl.uniform2f(this.compTexelLoc, 1 / this.fieldW, 1 / this.fieldH);
    gl.uniform1f(this.compUnscaleLoc, 1 / fieldScale);
    gl.uniform3fv(this.compSheenLoc, this.sheen);
    gl.uniform3fv(this.compRimLoc, this.rim);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  clear(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
