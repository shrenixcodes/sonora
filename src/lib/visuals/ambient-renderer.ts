/**
 * WebGL Ambient Visual Engine for Sonora.
 *
 * Renders atmospheric background effects derived from album artwork palettes.
 * Modes:
 *   - "aurora": organic fluid auroral ribbons
 *   - "fluid": flowing organic metaball field
 *   - "glow": soft breathing radiant glow
 *   - "cinematic": vignette stage backlight
 *   - "minimal": subtle gradient
 *   - "none": disabled
 *
 * Performance characteristics:
 *   - Throttled to target FPS (default 30 FPS)
 *   - Automatically pauses on tab/window blur or minimize
 *   - Respects prefers-reduced-motion
 */

import type { AmbientVisualMode } from "@/types/music";
import type { ArtworkPalette } from "./color-extractor";

const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const AURORA_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec3 u_color_dominant;
  uniform vec3 u_color_vibrant;
  uniform vec3 u_color_secondary;
  uniform vec3 u_color_dark;
  uniform float u_intensity;

  // Simple pseudo noise
  float hash(vec2 p) {
    p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
    return -1.0 + 2.0 * fract(16.0 * fract(p.x * p.y * (p.x + p.y)));
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = v_uv;
    float t = u_time * 0.25;

    // Layered wave distortion
    float n1 = noise(uv * 2.5 + vec2(t * 0.5, t * 0.3));
    float n2 = noise(uv * 4.0 - vec2(t * 0.3, t * 0.6) + n1 * 0.6);

    // Wave ribbons
    float ribbon1 = smoothstep(0.1, 0.8, sin(uv.y * 3.14159 + n2 * 1.5 + t * 0.4) * 0.5 + 0.5);
    float ribbon2 = smoothstep(0.2, 0.9, cos(uv.x * 2.5 + n1 * 1.2 - t * 0.3) * 0.5 + 0.5);

    // Blend artwork palette
    vec3 col = mix(u_color_dark, u_color_dominant, uv.y * 0.8 + 0.2);
    col = mix(col, u_color_secondary, ribbon1 * 0.6 * u_intensity);
    col = mix(col, u_color_vibrant, ribbon2 * 0.7 * u_intensity);

    // Soft radial vignette
    float dist = length(uv - 0.5);
    col *= (1.1 - dist * 0.75);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FLUID_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec3 u_color_dominant;
  uniform vec3 u_color_vibrant;
  uniform vec3 u_color_secondary;
  uniform vec3 u_color_dark;
  uniform float u_intensity;

  void main() {
    vec2 uv = v_uv * 2.0 - 1.0;
    float t = u_time * 0.4;

    for (int i = 1; i < 4; i++) {
      float fi = float(i);
      uv.x += 0.3 / fi * sin(fi * 2.0 * uv.y + t * 0.5);
      uv.y += 0.3 / fi * cos(fi * 2.0 * uv.x + t * 0.4);
    }

    float len = length(uv);
    float wave = sin(len * 3.0 - t) * 0.5 + 0.5;

    vec3 col = mix(u_color_dark, u_color_dominant, 0.6);
    col = mix(col, u_color_secondary, wave * 0.5 * u_intensity);
    col = mix(col, u_color_vibrant, pow(wave, 2.0) * 0.6 * u_intensity);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const GLOW_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec3 u_color_dominant;
  uniform vec3 u_color_vibrant;
  uniform vec3 u_color_dark;
  uniform float u_intensity;

  void main() {
    vec2 center = vec2(0.5, 0.45);
    float d = length(v_uv - center);
    float pulse = sin(u_time * 0.6) * 0.08 + 0.92;
    float glow = exp(-d * 2.2 * pulse) * u_intensity;

    vec3 col = mix(u_color_dark, u_color_dominant, 0.4);
    col = mix(col, u_color_vibrant, glow);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const MINIMAL_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec3 u_color_dominant;
  uniform vec3 u_color_vibrant;
  uniform vec3 u_color_dark;
  uniform float u_intensity;

  void main() {
    float blend = smoothstep(0.0, 1.0, v_uv.y * 0.7 + v_uv.x * 0.3);
    vec3 col = mix(u_color_dark, u_color_dominant, 0.35 * u_intensity + blend * 0.25);
    col = mix(col, u_color_vibrant, blend * 0.14 * u_intensity);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const CINEMATIC_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec3 u_color_dominant;
  uniform vec3 u_color_vibrant;
  uniform vec3 u_color_dark;
  uniform float u_intensity;

  void main() {
    float topGlow = exp(-v_uv.y * 2.0) * 0.3;
    float bottomGlow = exp(-(1.0 - v_uv.y) * 2.5) * 0.4;
    float vignette = 1.0 - length(v_uv - 0.5) * 0.9;

    vec3 col = u_color_dark;
    col = mix(col, u_color_dominant, topGlow * u_intensity);
    col = mix(col, u_color_vibrant, bottomGlow * u_intensity);
    col *= max(0.0, vignette);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class AmbientVisualRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private animationFrameId: number | null = null;
  private frameTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = () => this.handleResize();
  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      this.pause();
    } else {
      this.resume();
    }
  };
  private isRunning = false;
  private mode: AmbientVisualMode = "aurora";
  private targetFps = 30;
  private lastFrameTime = 0;
  private startTime = performance.now();
  private intensity = 0.8;

  // Shader state
  private currentProgram: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  // Color targets and interpolated currents
  private currentPalette: {
    dominant: [number, number, number];
    vibrant: [number, number, number];
    secondary: [number, number, number];
    dark: [number, number, number];
  };

  private targetPalette: typeof this.currentPalette;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: "low-power",
    });

    const initColor: [number, number, number] = [0.1, 0.08, 0.12];
    this.currentPalette = {
      dominant: [...initColor],
      vibrant: [0.65, 0.55, 0.98],
      secondary: [0.79, 0.66, 0.43],
      dark: [0.09, 0.08, 0.11],
    };
    this.targetPalette = JSON.parse(JSON.stringify(this.currentPalette));

    if (this.gl) {
      this.initBuffers();
      this.setMode(this.mode);
    }

    this.setupListeners();
    this.handleResize();
  }

  private setupListeners(): void {
    window.addEventListener("resize", this.onWindowResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.canvas);
    }

    // Pause when app is hidden/minimized
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    // Check reduced motion preference
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      this.targetFps = 10;
    }
  }

  private initBuffers(): void {
    if (!this.gl) return;
    const gl = this.gl;
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  private createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[AmbientRenderer] Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private setShaderSource(fragSrc: string): void {
    if (!this.gl) return;
    const gl = this.gl;

    const vert = this.createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const frag = this.createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return;

    const prog = gl.createProgram();
    if (!prog) return;

    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[AmbientRenderer] Program link error:", gl.getProgramInfoLog(prog));
      return;
    }

    if (this.currentProgram) {
      gl.deleteProgram(this.currentProgram);
    }

    this.currentProgram = prog;
    gl.useProgram(prog);

    // Uniform locations
    this.uniforms = {
      time: gl.getUniformLocation(prog, "u_time"),
      colorDominant: gl.getUniformLocation(prog, "u_color_dominant"),
      colorVibrant: gl.getUniformLocation(prog, "u_color_vibrant"),
      colorSecondary: gl.getUniformLocation(prog, "u_color_secondary"),
      colorDark: gl.getUniformLocation(prog, "u_color_dark"),
      intensity: gl.getUniformLocation(prog, "u_intensity"),
    };

    // Vertex attribute
    const posLoc = gl.getAttribLocation(prog, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  }

  setMode(mode: AmbientVisualMode): void {
    this.mode = mode;
    if (!this.gl) return;

    if (mode === "none") {
      this.pause();
      const gl = this.gl;
      gl.clearColor(0.09, 0.08, 0.11, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    switch (mode) {
      case "aurora":
        this.setShaderSource(AURORA_FRAGMENT_SRC);
        break;
      case "fluid":
        this.setShaderSource(FLUID_FRAGMENT_SRC);
        break;
      case "glow":
        this.setShaderSource(GLOW_FRAGMENT_SRC);
        break;
      case "cinematic":
        this.setShaderSource(CINEMATIC_FRAGMENT_SRC);
        break;
      case "minimal":
        this.setShaderSource(MINIMAL_FRAGMENT_SRC);
        break;
    }

    this.resume();
  }

  setPalette(palette: ArtworkPalette): void {
    this.targetPalette = {
      dominant: [
        palette.rgbDominant[0] / 255,
        palette.rgbDominant[1] / 255,
        palette.rgbDominant[2] / 255,
      ],
      vibrant: [
        palette.rgbVibrant[0] / 255,
        palette.rgbVibrant[1] / 255,
        palette.rgbVibrant[2] / 255,
      ],
      secondary: [
        palette.rgbSecondary[0] / 255,
        palette.rgbSecondary[1] / 255,
        palette.rgbSecondary[2] / 255,
      ],
      dark: [
        (palette.rgbDominant[0] * 0.2) / 255,
        (palette.rgbDominant[1] * 0.2) / 255,
        (palette.rgbDominant[2] * 0.2) / 255,
      ],
    };
  }

  setFpsLimit(fps: 15 | 30 | 60): void {
    this.targetFps = fps;
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.max(0.1, Math.min(1.0, intensity));
  }

  handleResize(): void {
    // Render at lower internal resolution for massive performance savings on low-end GPUs.
    const cssWidth = this.canvas.clientWidth || window.innerWidth;
    const cssHeight = this.canvas.clientHeight || window.innerHeight;
    const longest = Math.max(1, cssWidth, cssHeight);
    const scale = Math.min(0.4, 640 / longest);
    const width = Math.max(1, Math.floor(cssWidth * scale));
    const height = Math.max(1, Math.floor(cssHeight * scale));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.gl) {
        this.gl.viewport(0, 0, width, height);
      }
    }
  }

  resume(): void {
    if (this.isRunning || this.mode === "none") return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.loop();
  }

  pause(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
  }

  /**
   * Waits until the next frame is due, then asks the display for one. Asking
   * for every frame and returning early from those not wanted still woke the
   * renderer at the screen's own rate: on a 144 Hz panel, nearly five wakeups
   * for each frame actually drawn at the default 30 FPS.
   */
  private scheduleFrame(delay: number): void {
    this.frameTimer = window.setTimeout(() => {
      this.frameTimer = null;
      this.animationFrameId = requestAnimationFrame(this.loop);
    }, Math.max(0, delay));
  }

  private loop = (): void => {
    this.animationFrameId = null;
    if (!this.isRunning) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;
    const interval = 1000 / this.targetFps;

    if (elapsed < interval) {
      this.scheduleFrame(interval - elapsed);
      return;
    }
    this.lastFrameTime = now - (elapsed % interval);

    this.render();
    this.scheduleFrame(this.lastFrameTime + interval - performance.now());
  };

  private render(): void {
    if (!this.gl || !this.currentProgram || this.mode === "none") return;
    const gl = this.gl;

    // Smoothly lerp colors towards targets
    const lerpFactor = 0.05;
    for (const key of ["dominant", "vibrant", "secondary", "dark"] as const) {
      for (let i = 0; i < 3; i++) {
        this.currentPalette[key][i] +=
          (this.targetPalette[key][i] - this.currentPalette[key][i]) * lerpFactor;
      }
    }

    const time = (performance.now() - this.startTime) / 1000.0;

    gl.useProgram(this.currentProgram);

    if (this.uniforms.time) gl.uniform1f(this.uniforms.time, time);
    if (this.uniforms.intensity) gl.uniform1f(this.uniforms.intensity, this.intensity);
    if (this.uniforms.colorDominant)
      gl.uniform3fv(this.uniforms.colorDominant, this.currentPalette.dominant);
    if (this.uniforms.colorVibrant)
      gl.uniform3fv(this.uniforms.colorVibrant, this.currentPalette.vibrant);
    if (this.uniforms.colorSecondary)
      gl.uniform3fv(this.uniforms.colorSecondary, this.currentPalette.secondary);
    if (this.uniforms.colorDark)
      gl.uniform3fv(this.uniforms.colorDark, this.currentPalette.dark);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy(): void {
    this.pause();
    window.removeEventListener("resize", this.onWindowResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.gl && this.currentProgram) {
      this.gl.deleteProgram(this.currentProgram);
    }
    if (this.gl && this.positionBuffer) {
      this.gl.deleteBuffer(this.positionBuffer);
    }
  }
}
