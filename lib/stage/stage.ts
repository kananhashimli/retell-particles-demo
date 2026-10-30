// Stage: an isometric room with the orb standing in the middle. Scenes from a Direction add their
// objects, floor effects, cards and orb input on top; the stage blends them on scene changes and
// exports stills, layers, SVG cards, PNG sequences and video loops.

import * as THREE from "three";
import gsap from "gsap";
import { zipSync, strToU8 } from "fflate";
import { Orb } from "./orb";
import { Floor } from "./floor";
import { CardLayer, CardScope } from "./cards";
import { Kit } from "./kit";
import type {
  Direction, FloorScope, SceneParams, ParticleLook, Look, OrbScope, SceneContext, SceneDef, SceneId, SceneInstance, StageConfig, DeepPartial,
} from "./types";
import { DIRECTIONS } from "./directions";
import { paramDefaults, PARTICLE_LOOK_KEYS } from "./types";
import { buildSceneSVG } from "./svg";
import { DEFAULT_CONFIG, mergeConfig } from "./config";
import { hueOf, shiftHue, srgb } from "./util";

interface Active {
  id: SceneId;
  def: SceneDef;
  inst: SceneInstance;
  group: THREE.Group;
  cards: CardScope;
  orb: OrbScope;
  scope: { presence: number };
  age: number;
  leaving: boolean;
  /** once leaving, the age at which it stops: the end of the loop it is in, so it never replays its opening */
  holdAt?: number;
}

export interface StageEvents {
  scene: (id: SceneId) => void;
  loop: (id: SceneId) => void;
}

export interface StageOptions {
  font?: string;
  mono?: string;
}

const deg = THREE.MathUtils.degToRad;

export class Stage {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly orb: Orb;
  readonly floor = new Floor();
  readonly cards = new CardLayer();
  config: StageConfig;
  direction: Direction;

  private hemi = new THREE.HemisphereLight("#ffffff", "#e9ecf3", 1.4);
  private key = new THREE.DirectionalLight("#ffffff", 1.4);
  private orbLight = new THREE.PointLight("#3e8cf7", 8, 0, 2);
  private resolution = new THREE.Vector2(1, 1);
  private pointScale = { value: 1 };
  private active: Active[] = [];
  private raf = 0;
  private last = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private viewH = 5;
  private ro: ResizeObserver;
  private listeners: { [K in keyof StageEvents]: Set<StageEvents[K]> } = { scene: new Set(), loop: new Set() };
  private frozen = false; // exports drive frames themselves
  private onFrame?: () => void;
  private lookKey = "";
  private tmpColor = new THREE.Color();

  constructor(container: HTMLElement, config: DeepPartial<StageConfig> = {}, opts: StageOptions = {}) {
    this.container = container;
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.direction = DIRECTIONS[this.config.direction];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const gl = this.renderer.domElement;
    gl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    container.appendChild(gl);
    container.appendChild(this.cards.canvas);
    const cs = getComputedStyle(container);
    this.cards.setFonts(opts.font ?? cs.fontFamily, opts.mono ?? "ui-monospace, SFMono-Regular, Menlo, monospace");

    this.orb = new Orb({ ...this.config.orb });
    // from the front-left, high: lit faces toward the viewer, shadows fall away to the back-right
    this.key.position.set(-1.5, 10, 5.5);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -8;
    sc.right = sc.top = 8;
    sc.near = 1;
    sc.far = 30;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 10;
    this.key.shadow.blurSamples = 16;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.orbLight.position.set(0, 1, 0);
    this.scene.add(this.hemi, this.key, this.orbLight, this.floor.mesh, this.floor.shadowCatcher, this.orb.group);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.applyConfig({}, true);
    this.setScene(this.config.scene, { instant: true });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ events
  on<K extends keyof StageEvents>(k: K, fn: StageEvents[K]) {
    this.listeners[k].add(fn);
    return () => this.listeners[k].delete(fn);
  }
  private emit<K extends keyof StageEvents>(k: K, ...args: Parameters<StageEvents[K]>) {
    this.listeners[k].forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  }

  // ------------------------------------------------------------------ config
  get look(): Look {
    const c = this.config;
    return { bg: c.background, ink: c.ink, accent: c.accent, orbMid: c.orb.mid, orbHigh: c.orb.highlight, line: c.grid.color };
  }

  /** a scene's settings: its defaults with the config's overrides on top */
  sceneParams(id: SceneId): SceneParams {
    const defs = this.direction.scenes[id].params;
    return { ...(defs ? paramDefaults(defs) : {}), ...(this.config.sceneParams?.[id] ?? {}) };
  }

  applyConfig(patch: DeepPartial<StageConfig>, force = false) {
    const prevDirection = this.config.direction;
    const prevScene = this.config.scene;
    const prevParams = this.sceneParams(prevScene);
    const prevDensity = this.config.particles?.density;
    this.config = mergeConfig(this.config, patch);
    const c = this.config;

    this.renderer.setClearColor(c.background, 1);
    this.orb.setParams(c.orb);
    this.orbLight.position.set(0, c.orb.radius, 0);
    this.floor.setLook(
      {
        ...c.grid,
        glowColor: c.orb.highlight,
        glow: c.floorGlow,
        shadow: c.contactShadow,
        shadowColor: c.contactColor,
        accent: c.accent,
      },
      c.orb.radius,
    );
    this.hemi.intensity = c.light.ambient;
    this.key.intensity = c.light.key;
    (this.floor.shadowCatcher.material as THREE.ShadowMaterial).opacity = c.light.shadows;
    this.orbLight.color.set(c.orb.highlight);
    this.cards.style = c.cards.style;
    this.cards.scale = c.cards.scale;
    this.cards.show = c.cards.show;
    this.cards.accent = c.accent;
    this.cards.ink = c.ink;
    this.layoutCamera();

    if (c.direction !== prevDirection) {
      this.direction = DIRECTIONS[c.direction];
      this.setScene(c.scene, { instant: false, force: true });
    } else if (c.scene !== prevScene) {
      this.setScene(c.scene);
    }
    // settings that shape geometry need the scene rebuilt
    if (c.direction === prevDirection && prevDensity !== undefined && c.particles.density !== prevDensity) this.setScene(c.scene, { instant: true, force: true });
    const defs = this.direction.scenes[c.scene].params;
    if (defs && c.scene === prevScene && c.direction === prevDirection) {
      const now = this.sceneParams(c.scene);
      if (Object.entries(defs).some(([k, d]) => d.rebuild && now[k] !== prevParams[k])) this.setScene(c.scene, { instant: true, force: true });
    }
    // scenes bake colours into their materials: rebuild when the palette changes
    const lk = JSON.stringify(this.look) + c.orb.radius;
    if (lk !== this.lookKey) {
      const had = this.lookKey !== "";
      this.lookKey = lk;
      if (had && !force && c.direction === prevDirection) this.setScene(c.scene, { instant: true, force: true });
    }
  }

  // ------------------------------------------------------------------ scenes
  setScene(id: SceneId, o: { instant?: boolean; force?: boolean } = {}) {
    const current = this.active.find((a) => !a.leaving);
    if (current && current.id === id && !o.force && current.def === this.direction.scenes[id]) return;
    this.config.scene = id;
    for (const a of this.active) {
      if (a.leaving) continue;
      a.leaving = true;
      a.holdAt = (Math.floor(a.age / a.def.duration) + 1) * a.def.duration;
      gsap.killTweensOf(a.scope);
      if (o.instant) this.disposeActive(a);
      else gsap.to(a.scope, { presence: 0, duration: 0.55, ease: "power2.in", onComplete: () => this.disposeActive(a) });
    }
    if (o.instant) this.active = this.active.filter((a) => !a.leaving);

    const def = this.direction.scenes[id];
    const group = new THREE.Group();
    group.name = `scene:${this.direction.id}:${id}`;
    this.scene.add(group);
    const cards = this.cards.scope();
    const scope = { presence: o.instant ? 1 : 0 };
    cards.presence = scope.presence;
    const orb: OrbScope = { state: def.orb, listen: 0, speak: 0, bands: [0, 0, 0] };
    const floorRef = this.floor;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- read live settings from a getter
    const stage = this;
    const dir = this.direction;
    let lastParams = this.sceneParams(id);
    const floor: FloorScope = {
      ripple: (r) => this.floor.ripple({ ...r, strength: r.strength * scope.presence }),
      tile: (t) => this.floor.tile({ ...t, strength: t.strength * scope.presence }),
      glow: (v) => (this.floor.glowAdd += v * scope.presence),
      get cell() {
        return floorRef.cell;
      },
    };
    const ctx: SceneContext = {
      group,
      cards,
      floor,
      orb,
      orbRadius: this.config.orb.radius,
      look: this.look,
      kit: new Kit(this.look, this.resolution, this.pointScale),
      camera: this.camera,
      // a scene fading out after a direction switch keeps its own direction's settings
      get params() {
        if (stage.direction === dir) lastParams = stage.sceneParams(id);
        return lastParams;
      },
      // the shared particle look, with this scene's own overrides on top
      get particles() {
        const base = stage.config.particles;
        const p = this.params as SceneParams;
        let out: ParticleLook | null = null;
        for (const k of PARTICLE_LOOK_KEYS) {
          if (p[`own_${k}`] !== true || p[`p_${k}`] === undefined) continue;
          out ??= { ...base };
          (out as unknown as Record<string, unknown>)[k] = p[`p_${k}`];
        }
        return out ?? base;
      },
      get lines() {
        return stage.config.lines;
      },
      get hueShift() {
        return stage.orb.hueShift;
      },
    };
    const inst = def.create(ctx);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const a: Active = { id, def, inst, group, cards, orb, scope, age: 0, leaving: false };
    this.active.push(a);
    if (!o.instant) gsap.to(scope, { presence: 1, duration: 0.9, delay: 0.25, ease: "power2.out" });
    this.emit("scene", id);
  }

  /** restart the current scene from t = 0 at full presence */
  restart() {
    this.setScene(this.config.scene, { instant: true, force: true });
  }

  private disposeActive(a: Active) {
    a.inst.dispose?.();
    a.cards.dispose();
    this.scene.remove(a.group);
    a.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.active = this.active.filter((x) => x !== a);
  }

  get current() {
    return this.active.find((a) => !a.leaving);
  }
  get duration() {
    return this.current?.def.duration ?? 8;
  }
  /** 0..1 through the current loop */
  get progress() {
    const c = this.current;
    return c ? (c.age % c.def.duration) / c.def.duration : 0;
  }

  // ------------------------------------------------------------------ frame
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    // the first frame's timestamp can predate the constructor; a negative step would wrap the scene clock
    // backwards and fire "loop" at once, skipping the opening scene
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
    this.last = now;
    if (this.frozen) return;
    this.step(this.config.playing ? dt * this.config.speed : 0);
    this.render();
    this.onFrame?.();
  };

  step(dt: number) {
    this.floor.beginFrame();
    let best: Active | undefined;
    let listen = 0, speak = 0;
    const bands: [number, number, number] = [0, 0, 0];
    for (const a of [...this.active]) {
      const d = a.def.duration;
      const before = a.age % d;
      a.age += dt;
      // announce the wrap before drawing it: autoplay moves on here, and this scene then holds its last moment
      if (!a.leaving && a.age % d < before) {
        this.emit("loop", a.id);
        if (a.leaving) a.holdAt = a.age - (a.age % d);
      }
      // a scene fading out never wraps to t = 0, which would replay its opening under the next scene
      const t = a.leaving && a.holdAt !== undefined && a.age >= a.holdAt ? d - 1e-3 : a.age % d;
      a.cards.presence = a.scope.presence;
      a.inst.update({ t, age: a.age, dt, presence: a.scope.presence });
      const p = a.scope.presence;
      if (!best || p > best.scope.presence) best = a;
      listen += a.orb.listen * p;
      speak += a.orb.speak * p;
      for (let i = 0; i < 3; i++) bands[i] += a.orb.bands[i] * p;
    }
    const d = this.orb.drive;
    d.state = best ? best.orb.state : "idle";
    const tint = best?.orb.tint;
    this.orb.params.mid = tint ? tint.mid : this.config.orb.mid;
    this.orb.params.highlight = tint ? tint.high : this.config.orb.highlight;
    this.orbLight.color.lerp(this.tmpColor.set(this.orb.params.highlight), 1 - Math.exp(-dt * 6));
    // the shade, contact shadow and accents turn with the orb's hue as it eases into a tint
    const now = this.orb.highlightNow;
    const base = srgb(this.config.orb.highlight);
    const dh = hueOf(now.x, now.y, now.z) - hueOf(base.x, base.y, base.z);
    this.orb.hueShift = dh - Math.round(dh);
    this.floor.shadowColor = shiftHue(this.config.contactColor, this.orb.hueShift);
    d.listen = Math.min(1, listen);
    d.speak = Math.min(1, speak);
    d.bands = bands;
    this.orb.update(dt);
    this.floor.endFrame(this.orb.energy);
    this.orbLight.intensity = this.config.light.orb * (0.55 + 0.9 * this.orb.energy);
    this.cards.time += dt;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.cards.render(this.camera, this.w, this.h, this.dpr, this.renderer.domElement);
  }

  // ------------------------------------------------------------------ layout
  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.layoutCamera();
    if (!this.frozen && this.raf) this.render();
  }

  private layoutCamera() {
    const c = this.config.camera;
    const az = deg(c.azimuth), el = deg(c.elevation);
    const target = new THREE.Vector3(0, c.height, 0);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.camera.position.copy(target).addScaledVector(dir, 40);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.floor.setView(az, el);
    this.viewH = 5.2 / Math.max(0.05, c.zoom);
    const aspect = this.w / this.h;
    const hw = (this.viewH * aspect) / 2, hh = this.viewH / 2;
    this.camera.left = -hw - c.panX;
    this.camera.right = hw - c.panX;
    this.camera.top = hh - c.panY;
    this.camera.bottom = -hh - c.panY;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.resolution.set(this.w, this.h);
    this.syncPixelScale(this.dpr);
  }

  private syncPixelScale(pr: number) {
    const pxPerUnit = (this.h * pr) / this.viewH;
    this.orb.setPixelScale(pxPerUnit);
    // particle sizes are authored for the default framing at 1×
    this.pointScale.value = pr * (5.2 / this.viewH) * (this.h / 640);
  }

  // ------------------------------------------------------------------ exports
  /** Renders the current moment at `scale`× css size. */
  async snapshot(o: { scale?: number; transparent?: boolean; cards?: boolean } = {}) {
    const { scale = 2, transparent = false, cards = true } = o;
    return this.withSize(scale, transparent, async () => {
      this.renderer.render(this.scene, this.camera);
      return this.compose(cards);
    });
  }

  /** Separate transparent PNGs per layer (floor, objects, orb, cards) + the config, zipped. */
  async exportLayers(scale = 2) {
    const files: Record<string, Uint8Array> = {};
    await this.withSize(scale, true, async () => {
      const layers: ["floor" | "objects" | "orb", string][] = [["floor", "1-floor.png"], ["objects", "2-objects.png"], ["orb", "3-orb.png"]];
      for (const [layer, name] of layers) {
        this.renderLayer(layer);
        files[name] = new Uint8Array(await (await this.compose(false)).arrayBuffer());
      }
      this.renderer.render(this.scene, this.camera);
      this.cards.render(this.camera, this.w, this.h, scale, this.renderer.domElement);
      files["4-cards.png"] = new Uint8Array(await (await toBlob(this.cards.canvas)).arrayBuffer());
      files["0-composite.png"] = new Uint8Array(await (await this.compose(true)).arrayBuffer());
    });
    this.renderer.setClearColor(this.config.background, 1);
    files["4-cards.svg"] = strToU8(this.cardsSVG());
    files["config.json"] = strToU8(JSON.stringify(this.config, null, 2));
    return new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
  }

  cardsSVG() {
    return this.cards.toSVG(this.camera, this.w, this.h);
  }

  /** The current frame as vector SVG: grid, strokes, particles, floor highlights and cards (no orb). */
  sceneSVG() {
    const fx = this.floor.frameEffects;
    return buildSceneSVG({
      camera: this.camera,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      config: this.config,
      groups: this.active.map((a) => a.group),
      ripples: fx.ripples,
      tiles: fx.tiles,
      cards: this.cards.show ? this.cards.toSVGContent(this.camera, this.w, this.h) : "",
    });
  }

  /** Deterministic PNG frames of one loop (or `seconds`), zipped. */
  async exportSequence(o: { fps?: number; seconds?: number; scale?: number; transparent?: boolean; onProgress?: (p: number) => void } = {}) {
    const { fps = 30, scale = 1, transparent = false, onProgress } = o;
    this.restart();
    const seconds = o.seconds ?? this.duration;
    const n = Math.round(seconds * fps);
    const files: Record<string, Uint8Array> = {};
    this.frozen = true;
    try {
      this.orb.settle();
      await this.withSize(scale, transparent, async () => {
        for (let i = 0; i < n; i++) {
          if (i > 0) this.step(1 / fps);
          else this.step(0);
          this.renderer.render(this.scene, this.camera);
          const b = await this.compose(true);
          files[`frame-${String(i).padStart(4, "0")}.png`] = new Uint8Array(await b.arrayBuffer());
          onProgress?.((i + 1) / n);
        }
      });
    } finally {
      this.frozen = false;
      this.last = performance.now();
    }
    files["config.json"] = strToU8(JSON.stringify(this.config, null, 2));
    return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" });
  }

  /** Real-time recording of `loops` seamless loops of the current scene (MP4 when supported, else WebM). */
  async record(o: { loops?: number; fps?: number; scale?: number; onProgress?: (p: number) => void } = {}) {
    const { loops = 1, fps = 60, scale = Math.min(2, this.dpr), onProgress } = o;
    const types = ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
    const out = document.createElement("canvas");
    out.width = Math.round(this.w * scale);
    out.height = Math.round(this.h * scale);
    const octx = out.getContext("2d")!;
    const prevDpr = this.dpr;
    this.dpr = scale;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(this.w, this.h, false);
    this.syncPixelScale(scale);
    this.restart();
    this.orb.settle();
    const stream = out.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const total = (this.duration * loops) / Math.max(0.05, this.config.speed);
    const wasPlaying = this.config.playing;
    this.config.playing = true;
    const start = performance.now();
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    this.onFrame = () => {
      octx.fillStyle = this.config.background;
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(this.renderer.domElement, 0, 0);
      octx.drawImage(this.cards.canvas, 0, 0);
      const p = (performance.now() - start) / 1000 / total;
      onProgress?.(Math.min(1, p));
      if (p >= 1 && rec.state === "recording") rec.stop();
    };
    rec.start(250);
    await done;
    this.onFrame = undefined;
    this.config.playing = wasPlaying;
    this.dpr = prevDpr;
    this.resize();
    return new Blob(chunks, { type: mimeType.split(";")[0] });
  }

  private async withSize<T>(scale: number, transparent: boolean, fn: () => Promise<T>): Promise<T> {
    const wasFrozen = this.frozen;
    this.frozen = true;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(this.w, this.h, false);
    this.syncPixelScale(scale);
    this.renderer.setClearColor(this.config.background, transparent ? 0 : 1);
    this.exportScale = scale;
    try {
      return await fn();
    } finally {
      this.exportScale = 0;
      this.renderer.setClearColor(this.config.background, 1);
      this.frozen = wasFrozen;
      this.resize();
      this.last = performance.now();
    }
  }
  private exportScale = 0;

  private async compose(withCards: boolean) {
    const gl = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = gl.width;
    out.height = gl.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(gl, 0, 0);
    if (withCards) {
      this.cards.render(this.camera, this.w, this.h, this.exportScale || this.dpr, gl);
      ctx.drawImage(this.cards.canvas, 0, 0, out.width, out.height);
    }
    return toBlob(out);
  }

  /** Render one layer in colour; everything else still writes depth so occlusion stays right. */
  private renderLayer(layer: "floor" | "objects" | "orb") {
    const saved: [THREE.Material, boolean][] = [];
    const inLayer = (o: THREE.Object3D): boolean => {
      if (o === this.floor.mesh || o === this.floor.shadowCatcher || o === this.orb.reflection) return layer === "floor";
      if (o === this.orb.mesh) return layer === "orb";
      return layer === "objects";
    };
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const keep = inLayer(o);
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        saved.push([m, m.colorWrite]);
        if (!keep) m.colorWrite = false;
      }
    });
    // floor shadows of objects belong to the floor layer, but the floor itself never occludes
    this.renderer.render(this.scene, this.camera);
    for (const [m, v] of saved) m.colorWrite = v;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const a of [...this.active]) this.disposeActive(a);
    this.orb.dispose();
    this.floor.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.cards.canvas.remove();
  }
}

function toBlob(c: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
