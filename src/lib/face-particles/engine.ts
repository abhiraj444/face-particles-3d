import type { AnimState, EffectName, ParticleSet } from "./types";
import { ORBIT_LIMIT, POINT_SIZE_REF_N, TOUCH_RADIUS_FRAC, TOUCH_SLOTS } from "./config";
import {
  createMat4,
  lookAt,
  multiply,
  perspective,
  unprojectToZ0,
  clamp,
} from "./math";
import { RENDER_FS, RENDER_VS, UPDATE_FS, UPDATE_VS } from "./shaders";

type TouchSlot = { x: number; y: number; z: number; w: number; vx: number; vy: number; id: number };

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Shader alloc failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "compile error";
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function link(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  varyings?: string[],
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("Program alloc failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (varyings) gl.transformFeedbackVaryings(prog, varyings, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "link error";
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

export class ParticleEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext | null;
  readonly supported: boolean;
  onState?: (s: AnimState) => void;

  private set: ParticleSet | null = null;
  private drawCount = 0;
  private maxCount = 0;
  private ping = 0;
  private updateProg: WebGLProgram | null = null;
  private renderProg: WebGLProgram | null = null;
  private posBuf: [WebGLBuffer, WebGLBuffer] | null = null;
  private velBuf: [WebGLBuffer, WebGLBuffer] | null = null;
  private homeBuf: WebGLBuffer | null = null;
  private seedBuf: WebGLBuffer | null = null;
  private toneBuf: WebGLBuffer | null = null;
  private colorBuf: WebGLBuffer | null = null;
  private vaoUpdate: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null;
  private vaoRender: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null;
  private tf: [WebGLTransformFeedback, WebGLTransformFeedback] | null = null;
  private uUpdate: Record<string, WebGLUniformLocation | null> = {};
  private uRender: Record<string, WebGLUniformLocation | null> = {};
  private pointRange: [number, number] = [1, 64];

  private raf = 0;
  private running = false;
  private lastT = 0;
  private acc = 0;
  private time = 0;
  private frameTimes: number[] = [];
  private renderScale = 1;
  private recordAspect: number | null = null;
  private recordDims: [number, number] | null = null;

  yaw = 0;
  pitch = 0.04;
  private gyroYaw = 0;
  private gyroPitch = 0;
  private idleOrbit = true;
  private userOrbit = false;

  size = 2;
  colorMode = 0;
  colorMix = 0.5;
  invert = 0;
  assemble = 0;
  targetAssemble = 1;
  spring = 14;
  damp = 3.2;
  turb = 0.22;
  breath = 0.012;
  mode = 0;
  effectT = 0;
  effectAmp = 0;
  effectOrigin: [number, number] = [0, 0];
  private state: AnimState = "building";
  private effectTimer = 0;
  private effectName: EffectName | null = null;

  private touches: TouchSlot[] = Array.from({ length: TOUCH_SLOTS }, () => ({
    x: 0, y: 0, z: 1, w: 0, vx: 0, vy: 0, id: -1,
  }));
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private lastTap = 0;
  private viewProj = createMat4();
  private invViewProj = createMat4();
  private proj = createMat4();
  private view = createMat4();
  private tmpEye: [number, number, number] = [0, 0, 2.3];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.gl = gl;
    this.supported = Boolean(gl);
    if (!gl) return;
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[];
    this.pointRange = [range[0] ?? 1, range[1] ?? 64];
    this.updateProg = link(gl, UPDATE_VS, UPDATE_FS, ["vPos", "vVel"]);
    this.renderProg = link(gl, RENDER_VS, RENDER_FS);
    this.uUpdate = this.uniforms(this.updateProg, [
      "uDt", "uTime", "uSpring", "uDamp", "uAssemble", "uTurb",
      "uMode", "uEffectT", "uEffectAmp", "uEffectOrigin",
    ]);
    for (let i = 0; i < 5; i++) {
      this.uUpdate[`uTouch[${i}]`] = gl.getUniformLocation(this.updateProg, `uTouch[${i}]`);
      this.uUpdate[`uTouchVel[${i}]`] = gl.getUniformLocation(this.updateProg, `uTouchVel[${i}]`);
    }
    this.uRender = this.uniforms(this.renderProg, [
      "uViewProj", "uSize", "uDpr", "uPointRange", "uTime", "uBreath", "uColorMode", "uColorMix", "uInvert",
    ]);
    this.bindInput();
  }

  private uniforms(prog: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
    const gl = this.gl!;
    const out: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const raw = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      this.acc += raw;
      const step = 1 / 60;
      while (this.acc >= step) {
        this.simulate(step);
        this.acc -= step;
      }
      this.render();
      this.adapt(raw);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.unbindInput();
    const gl = this.gl;
    if (!gl) return;
    const delBuf = (b: WebGLBuffer | null) => b && gl.deleteBuffer(b);
    if (this.posBuf) { delBuf(this.posBuf[0]); delBuf(this.posBuf[1]); }
    if (this.velBuf) { delBuf(this.velBuf[0]); delBuf(this.velBuf[1]); }
    delBuf(this.homeBuf); delBuf(this.seedBuf); delBuf(this.toneBuf); delBuf(this.colorBuf);
    if (this.updateProg) gl.deleteProgram(this.updateProg);
    if (this.renderProg) gl.deleteProgram(this.renderProg);
  }

  load(set: ParticleSet, opts?: { scatter?: boolean }): void {
    this.set = set;
    this.maxCount = set.count;
    this.drawCount = set.count;
    const gl = this.gl;
    if (!gl) return;

    const scatter = opts?.scatter !== false;
    const pos = new Float32Array(set.home.length);
    const vel = new Float32Array(set.home.length);
    if (scatter) {
      for (let i = 0; i < set.count; i++) {
        const s = set.seed[i] ?? 0;
        const a = s * Math.PI * 2;
        const r = 0.6 + (set.seed[(i + 3) % set.count] ?? 0.4) * 1.6;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = (s - 0.5) * 2.6;
        pos[i * 3 + 2] = Math.sin(a * 1.7) * r * 0.5;
      }
    } else {
      pos.set(set.home);
    }

    const buf = (data: ArrayBufferView, usage: number = gl.STATIC_DRAW) => {
      const b = gl.createBuffer();
      if (!b) throw new Error("buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data as unknown as BufferSource, usage);
      return b;
    };

    if (this.posBuf) { gl.deleteBuffer(this.posBuf[0]); gl.deleteBuffer(this.posBuf[1]); }
    if (this.velBuf) { gl.deleteBuffer(this.velBuf[0]); gl.deleteBuffer(this.velBuf[1]); }
    this.posBuf = [buf(pos, gl.DYNAMIC_COPY), buf(pos, gl.DYNAMIC_COPY)];
    this.velBuf = [buf(vel, gl.DYNAMIC_COPY), buf(vel, gl.DYNAMIC_COPY)];
    if (this.homeBuf) gl.deleteBuffer(this.homeBuf);
    if (this.seedBuf) gl.deleteBuffer(this.seedBuf);
    if (this.toneBuf) gl.deleteBuffer(this.toneBuf);
    if (this.colorBuf) gl.deleteBuffer(this.colorBuf);
    this.homeBuf = buf(set.home);
    this.seedBuf = buf(set.seed);
    this.toneBuf = buf(set.tone);
    this.colorBuf = buf(set.color);

    const makeUpdateVao = (read: 0 | 1) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf![read]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.velBuf![read]);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.homeBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    };
    const makeRenderVao = (read: 0 | 1) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf![read]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.toneBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    };
    if (this.vaoUpdate) {
      gl.deleteVertexArray(this.vaoUpdate[0]);
      gl.deleteVertexArray(this.vaoUpdate[1]);
    }
    if (this.vaoRender) {
      gl.deleteVertexArray(this.vaoRender[0]);
      gl.deleteVertexArray(this.vaoRender[1]);
    }
    this.vaoUpdate = [makeUpdateVao(0), makeUpdateVao(1)];
    this.vaoRender = [makeRenderVao(0), makeRenderVao(1)];

    const makeTf = (write: 0 | 1) => {
      const tf = gl.createTransformFeedback()!;
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.posBuf![write]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.velBuf![write]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      return tf;
    };
    if (this.tf) {
      gl.deleteTransformFeedback(this.tf[0]);
      gl.deleteTransformFeedback(this.tf[1]);
    }
    this.tf = [makeTf(1), makeTf(0)];
    this.ping = 0;
  }

  setDrawCount(n: number): void {
    this.drawCount = clamp(n | 0, 1000, this.maxCount || n);
  }

  setPointSize(px: number): void {
    this.size = px;
  }

  setColorMode(mode: boolean | number | "mono" | "hybrid" | "color"): void {
    if (typeof mode === "string") {
      this.colorMode = mode === "color" ? 1 : mode === "hybrid" ? 2 : 0;
    } else if (typeof mode === "number") {
      this.colorMode = mode;
    } else {
      this.colorMode = mode ? 1 : 0;
    }
  }

  setColorMix(mix: number): void {
    this.colorMix = clamp(mix, 0, 1);
  }

  setInvert(on: boolean): void {
    this.invert = on ? 1 : 0;
  }

  updateHomeZ(set: ParticleSet): void {
    const gl = this.gl;
    if (!gl || !this.homeBuf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.homeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, set.home);
  }

  play(name: EffectName): void {
    this.effectName = name;
    this.effectTimer = 0;
    if (name === "build") {
      this.assemble = 0;
      this.targetAssemble = 1;
      this.spring = 16;
      this.damp = 3.4;
      this.turb = 0.55;
      this.mode = 0;
      this.setState("building");
    } else if (name === "assemble") {
      this.targetAssemble = 1;
      this.spring = 18;
      this.damp = 3.6;
      this.turb = 0.2;
      this.mode = 0;
      this.setState("assembling");
    } else if (name === "disassemble") {
      this.targetAssemble = 0;
      this.mode = 4;
      this.effectAmp = 6.5;
      this.effectOrigin = [0, 0];
      this.turb = 1.1;
      this.spring = 2;
      this.damp = 1.4;
      this.setState("disassembling");
    } else if (name === "wind") {
      this.mode = 2;
      this.effectAmp = 4.2;
      this.effectOrigin = [-1.4, 0];
      this.effectT = 0;
      this.setState("effect");
    } else if (name === "vortex") {
      this.mode = 1;
      this.effectAmp = 3.4;
      this.effectOrigin = [0, 0.05];
      this.setState("effect");
    } else if (name === "ripple") {
      this.mode = 3;
      this.effectAmp = 5.5;
      this.effectT = 0;
      this.setState("effect");
    } else if (name === "fill") {
      // Scatter all particles above the scene, then let them rain down
      this.assemble = 0;
      this.targetAssemble = 0;
      this.mode = 5; // fill mode — uses uEffectT as a sweepline
      this.effectAmp = 0;
      this.effectT = 0;
      this.spring = 12;
      this.damp = 3.2;
      this.turb = 0.3;
      // Scatter particles upward in the GPU buffers
      this.scatterAbove();
      this.setState("filling");
    } else if (name === "idle") {
      this.targetAssemble = 1;
      this.mode = 0;
      this.setState("assembled");
    }
  }

  /** Scatter all particles above the scene for the fill/rain animation */
  private scatterAbove(): void {
    const gl = this.gl;
    const set = this.set;
    if (!gl || !set || !this.posBuf) return;
    const n = set.count;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = set.seed[i] ?? 0;
      // Stagger start heights based on home.y: particles destined for lower parts of the face start higher up
      // so they rain down in a continuous cascade
      pos[i * 3] = set.home[i * 3]! + (s - 0.5) * 0.25;
      pos[i * 3 + 1] = 1.6 + (1.2 - set.home[i * 3 + 1]!) * 0.8 + s * 0.5;
      pos[i * 3 + 2] = set.home[i * 3 + 2]! + (s - 0.5) * 0.2;
      vel[i * 3] = (s - 0.5) * 0.1;
      vel[i * 3 + 1] = -0.8 - s * 0.4;
      vel[i * 3 + 2] = 0;
    }
    // Upload to both ping-pong buffers
    for (const buf of this.posBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    }
    for (const buf of this.velBuf!) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel);
    }
  }

  snapshot(): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("snapshot failed"))), "image/png");
    });
  }

  getCanvasStream(fps = 30): MediaStream {
    return this.canvas.captureStream(fps);
  }

  lockIdleOrbit(lock: boolean): void {
    this.idleOrbit = !lock;
  }

  setRecordingAspect(aspect: number | null, width?: number, height?: number): void {
    this.recordAspect = aspect;
    if (aspect && width && height) {
      const gl = this.gl;
      if (gl) {
        const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as [number, number] | null;
        if (maxDims) {
          const maxW = maxDims[0] || 4096;
          const maxH = maxDims[1] || 4096;
          if (width > maxW || height > maxH) {
            const scale = Math.min(maxW / width, maxH / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
        }
      }
      this.recordDims = [width, height];
    } else {
      this.recordDims = null;
    }
    this.resize();
  }

  getParticleSet(): ParticleSet | null {
    return this.set;
  }

  getOrbit(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  private setState(s: AnimState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  getState(): AnimState {
    return this.state;
  }

  private simulate(dt: number): void {
    this.time += dt;
    this.effectTimer += dt;
    this.assemble += (this.targetAssemble - this.assemble) * Math.min(1, dt * 1.35);

    if (this.state === "building" && this.assemble > 0.92) {
      this.turb = 0.18;
      this.setState("assembled");
    }
    if (this.state === "assembling" && this.assemble > 0.92) {
      this.turb = 0.18;
      this.mode = 0;
      this.setState("assembled");
    }
    if (this.state === "disassembling") {
      this.effectAmp *= Math.exp(-dt * 1.8);
      if (this.assemble < 0.08 && this.effectTimer > 1.5) {
        // Auto-reassemble after breaking apart
        this.targetAssemble = 1;
        this.spring = 16;
        this.damp = 3.4;
        this.turb = 0.35;
        this.mode = 0;
        this.effectAmp = 0;
        this.setState("assembling");
      }
    }
    if (this.state === "filling") {
      // Sweep line progresses from top (+1.5) to bottom (-1.5) over ~4 seconds
      const sweepDuration = 4.0;
      const progress = Math.min(1.0, this.effectTimer / sweepDuration);
      // Sweep from top (Y=+1.5) down to bottom (Y=-1.5)
      const sweepY = 1.5 - progress * 3.0;
      this.effectT = sweepY;
      // Progressively increase spring for particles above the sweep line
      // Particles whose home.y >= sweepY get targetAssemble = 1
      this.targetAssemble = progress;
      this.assemble = progress;
      if (progress >= 1.0) {
        this.mode = 0;
        this.turb = 0.16;
        this.targetAssemble = 1;
        this.assemble = 1;
        this.setState("assembled");
      }
    }
    if (this.state === "effect") {
      if (this.mode === 2) this.effectOrigin[0] = -1.4 + this.effectTimer * 1.15;
      if (this.mode === 3) this.effectT = this.effectTimer;
      if (this.effectTimer > 2.4) {
        this.mode = 0;
        this.effectAmp = 0;
        this.targetAssemble = 1;
        this.setState("assembled");
      }
    }
    if (this.state === "assembled") {
      this.turb = 0.16;
      this.breath = 0.012;
    }

    const gl = this.gl;
    if (!gl || !this.updateProg || !this.vaoUpdate || !this.tf || !this.set) return;

    const read = this.ping as 0 | 1;
    gl.useProgram(this.updateProg);
    gl.uniform1f(this.uUpdate.uDt, dt);
    gl.uniform1f(this.uUpdate.uTime, this.time);
    gl.uniform1f(this.uUpdate.uSpring, this.spring);
    gl.uniform1f(this.uUpdate.uDamp, this.damp);
    gl.uniform1f(this.uUpdate.uAssemble, this.assemble);
    gl.uniform1f(this.uUpdate.uTurb, this.turb);
    gl.uniform1f(this.uUpdate.uMode, this.mode);
    gl.uniform1f(this.uUpdate.uEffectT, this.effectT);
    gl.uniform1f(this.uUpdate.uEffectAmp, this.effectAmp);
    gl.uniform2f(this.uUpdate.uEffectOrigin, this.effectOrigin[0], this.effectOrigin[1]);
    for (let i = 0; i < TOUCH_SLOTS; i++) {
      const t = this.touches[i]!;
      gl.uniform4f(this.uUpdate[`uTouch[${i}]`] ?? null, t.x, t.y, t.z, t.w);
      gl.uniform2f(this.uUpdate[`uTouchVel[${i}]`] ?? null, t.vx, t.vy);
      t.vx *= Math.exp(-dt * 8);
      t.vy *= Math.exp(-dt * 8);
      if (t.id < 0) t.w *= Math.exp(-dt * 6);
    }

    gl.bindVertexArray(this.vaoUpdate[read]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf[read]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.maxCount);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    this.ping = 1 - read;
  }

  private resize(): void {
    const canvas = this.canvas;
    const gl = this.gl;
    if (!gl) return;
    if (this.recordDims) {
      const [w, h] = this.recordDims;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      return;
    }
    const dpr = Math.min(2.5, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  private camera(): void {
    const gl = this.gl!;
    const aspect = this.recordAspect ?? (gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight));
    const baseFov = (32 * Math.PI) / 180;
    perspective(this.proj, baseFov, aspect, 0.1, 20);
    const idleY = this.idleOrbit && !this.userOrbit ? Math.sin(this.time * 0.18) * 0.1 : 0;
    const idleP = this.idleOrbit && !this.userOrbit ? Math.cos(this.time * 0.13) * 0.03 : 0;
    const yaw = clamp(this.yaw + this.gyroYaw + idleY, -ORBIT_LIMIT, ORBIT_LIMIT);
    const pitch = clamp(this.pitch + this.gyroPitch + idleP, -ORBIT_LIMIT, ORBIT_LIMIT);
    const baseDist = 2.45;
    const dist = aspect < 1.0 ? baseDist / Math.min(1.0, aspect / 0.65) : baseDist;
    this.tmpEye[0] = Math.sin(yaw) * Math.cos(pitch) * dist;
    this.tmpEye[1] = Math.sin(pitch) * dist;
    this.tmpEye[2] = Math.cos(yaw) * Math.cos(pitch) * dist;
    lookAt(this.view, this.tmpEye, [0, 0, 0], [0, 1, 0]);
    multiply(this.viewProj, this.proj, this.view);
  }

  private render(): void {
    const gl = this.gl;
    if (!gl || !this.renderProg || !this.vaoRender) return;
    this.resize();
    this.camera();
    if (this.invert) gl.clearColor(1.0, 1.0, 1.0, 1.0);
    else gl.clearColor(0.027, 0.027, 0.031, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.renderProg);
    gl.uniformMatrix4fv(this.uRender.uViewProj, false, this.viewProj);
    const n = Math.max(1000, this.drawCount);
    const size = this.size * Math.sqrt(POINT_SIZE_REF_N / n);
    const dpr = Math.min(2.5, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    gl.uniform1f(this.uRender.uSize, size);
    gl.uniform1f(this.uRender.uDpr, dpr);
    gl.uniform2f(this.uRender.uPointRange, this.pointRange[0], this.pointRange[1]);
    gl.uniform1f(this.uRender.uTime, this.time);
    gl.uniform1f(this.uRender.uBreath, this.breath);
    gl.uniform1f(this.uRender.uColorMode, this.colorMode);
    gl.uniform1f(this.uRender.uColorMix, this.colorMix);
    gl.uniform1f(this.uRender.uInvert, this.invert);
    gl.bindVertexArray(this.vaoRender[this.ping as 0 | 1]);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
  }

  private adapt(_dt: number): void {
    // Keep quality intact on all devices
  }

  worldFromClient(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((clientY - r.top) / r.height) * 2;
    return unprojectToZ0(ndcX, ndcY, this.viewProj, this.invViewProj);
  }

  private bindInput(): void {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    c.addEventListener("contextmenu", this.onMenu);
    window.addEventListener("deviceorientation", this.onOrient);
  }

  private unbindInput(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("contextmenu", this.onMenu);
    window.removeEventListener("deviceorientation", this.onOrient);
  }

  private onMenu = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    if (e.button === 2 || e.altKey) {
      this.userOrbit = true;
      this.idleOrbit = false;
      this.pointers.set(-2, { x: e.clientX, y: e.clientY, t: performance.now() });
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - this.lastTap < 280 && this.pointers.size === 0) {
      const [x, y] = this.worldFromClient(e.clientX, e.clientY);
      this.effectOrigin = [x, y];
      this.play("ripple");
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    this.syncTouches();
  };

  private onMove = (e: PointerEvent) => {
    const orbit = this.pointers.get(-2);
    if (orbit && (e.buttons & 2 || e.altKey)) {
      this.yaw = clamp(this.yaw + (e.clientX - orbit.x) * 0.004, -ORBIT_LIMIT, ORBIT_LIMIT);
      this.pitch = clamp(this.pitch + (e.clientY - orbit.y) * 0.003, -ORBIT_LIMIT, ORBIT_LIMIT);
      orbit.x = e.clientX;
      orbit.y = e.clientY;
      return;
    }
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      if (pts.length >= 2) {
        const a = pts[0]!;
        this.yaw = clamp(this.yaw + (e.movementX) * 0.003, -ORBIT_LIMIT, ORBIT_LIMIT);
        this.pitch = clamp(this.pitch + (e.movementY) * 0.0025, -ORBIT_LIMIT, ORBIT_LIMIT);
        this.userOrbit = true;
        this.idleOrbit = false;
        a.x = e.clientX;
        a.y = e.clientY;
      }
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    this.syncTouches();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pointers.delete(-2);
    this.syncTouches();
  };

  private syncTouches(): void {
    const radius = TOUCH_RADIUS_FRAC * 2.0;
    const ids = [...this.pointers.entries()].filter(([id]) => id >= 0);
    for (let i = 0; i < TOUCH_SLOTS; i++) {
      const slot = this.touches[i]!;
      const pair = ids[i];
      if (!pair) {
        slot.id = -1;
        continue;
      }
      const [id, p] = pair;
      const [x, y] = this.worldFromClient(p.x, p.y);
      if (slot.id === id) {
        slot.vx = (x - slot.x) * 28;
        slot.vy = (y - slot.y) * 28;
      }
      slot.id = id;
      slot.x = x;
      slot.y = y;
      slot.z = radius;
      slot.w = 2.8;
    }
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    this.gyroYaw = clamp((e.gamma / 45) * 0.18, -0.22, 0.22);
    this.gyroPitch = clamp(((e.beta - 45) / 45) * 0.14, -0.2, 0.2);
  };

  async requestGyro(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        return res === "granted";
      }
      return true;
    } catch {
      return false;
    }
  }
}
