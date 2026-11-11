// Stage: an isometric room with the orb standing in the middle. Scenes from a Direction add their
// objects, floor effects and orb input on top; the stage blends them on scene changes and
// exports stills, layers, SVG, PNG sequences and video loops.

import * as THREE from "three";
import gsap from "gsap";
import { zipSync, strToU8 } from "fflate";
import { Orb } from "./orb";
import { Floor } from "./floor";
import { Kit } from "./kit";
import { fieldsOf, frozenDots, liveDots, Morph, type Dots } from "./morph";
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
  orb: OrbScope;
  scope: { presence: number };
  age: number;
  leaving: boolean;
  /** the morph's source: hidden, but kept running at full strength so its dots leave moving */
  morphOut: boolean;
  /** has drawn at least one frame */
  drawn: boolean;
  /** once leaving, the age at which its loop ends; past it, its clock keeps counting instead of wrapping to t = 0 */
  endAt?: number;
}

export interface StageEvents {
  scene: (id: SceneId) => void;
  loop: (id: SceneId) => void;
}

const deg = THREE.MathUtils.degToRad;

export class Stage {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly orb: Orb;
  readonly floor = new Floor();
  config: StageConfig;
  direction: Direction;

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
  private io: IntersectionObserver;
  /** off screen, the stage neither animates nor draws */
  private onScreen = true;
  private listeners: { [K in keyof StageEvents]: Set<StageEvents[K]> } = { scene: new Set(), loop: new Set() };
  private frozen = false; // exports drive frames themselves
  private morph: Morph | null = null;
  /** the scene the morph flies from */
  private morphFrom: Active | null = null;
  private onFrame?: () => void;
  private lookKey = "";
  /** resolves once the scene's shaders are compiled; the stage then fades in */
  readonly ready: Promise<void>;
  private loaded = false;
  private shown = false;

  constructor(container: HTMLElement, config: DeepPartial<StageConfig> = {}) {
    this.container = container;
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.direction = DIRECTIONS[this.config.direction];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const gl = this.renderer.domElement;
    // hidden until everything it draws is ready, then faded in at once rather than piece by piece
    gl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 0.9s cubic-bezier(.2,.7,.2,1)";
    container.appendChild(gl);

    this.orb = new Orb({ ...this.config.orb });
    this.scene.add(this.floor.mesh, this.orb.group);

    this.ro = new ResizeObserver(() => this.resize());
    this.io = new IntersectionObserver(([e]) => (this.onScreen = e.isIntersecting));
    this.io.observe(container);
    this.ro.observe(container);
    this.resize();
    this.applyConfig({}, true);
    this.setScene(this.config.scene, { instant: true });
    // never wait forever: a slow network or a stuck compile still fades in after a few seconds
    const timeout = new Promise<void>((done) => setTimeout(done, 5000));
    const loaded = this.renderer.compileAsync(this.scene, this.camera).then(() => {}, () => {});
    this.ready = Promise.race([loaded, timeout]).then(() => {
      this.loaded = true;
    });
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
    this.floor.setLook(
      {
        ...c.grid,
        glowColor: c.orb.mid,
        glow: c.floorGlow,
        shadow: c.contactShadow,
        shadowColor: c.contactColor,
        accent: c.accent,
      },
      c.orb.radius,
    );
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
    // the dots to fly from: the current scene, live; or, cutting a morph short, what is in flight, frozen
    let from: Dots | null = null;
    let fromScene: Active | null = null;
    if (!o.instant && this.config.transition.morph && current && current.def.morph !== false && this.direction.scenes[id].morph !== false) {
      if (this.morph) from = frozenDots([...fieldsOf(current.group), ...fieldsOf(this.morph.group)], this.pxScale);
      else {
        from = liveDots(fieldsOf(current.group));
        fromScene = current;
      }
    }
    this.endMorph();
    for (const a of this.active) {
      if (a.leaving) continue;
      a.leaving = true;
      a.endAt = (Math.floor(a.age / a.def.duration) + 1) * a.def.duration;
      gsap.killTweensOf(a.scope);
      if (o.instant) this.disposeActive(a);
      else gsap.to(a.scope, { presence: 0, duration: 0.55, ease: "power2.in", onComplete: () => this.disposeActive(a) });
    }
    if (o.instant) this.active = this.active.filter((a) => !a.leaving);

    const def = this.direction.scenes[id];
    const group = new THREE.Group();
    group.name = `scene:${this.direction.id}:${id}`;
    this.scene.add(group);
    const scope = { presence: o.instant ? 1 : 0 };
    const orb: OrbScope = { state: def.orb, listen: 0, speak: 0 };
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
    const targets = fieldsOf(group);
    const morphIn = !!from && from.n > 0 && targets.length > 0;
    // arriving by a morph, its clock starts early: it moves the whole time the dots fly in, and reaches
    // t = 0 as they land, so the morph never eats into its opening (scenes read t < 0 as "not started yet")
    const age = morphIn ? -this.config.transition.duration : 0;
    const a: Active = { id, def, inst, group, orb, scope, age, leaving: false, morphOut: false, drawn: false };
    if (morphIn) {
      // the old scene's dots become the morph; the old scene runs on unseen until it lands
      current!.group.visible = false;
      if (fromScene) {
        fromScene.morphOut = true;
        gsap.killTweensOf(fromScene.scope);
        gsap.to(fromScene.scope, { presence: 0, duration: 0.55, ease: "power2.in" });
        this.morphFrom = fromScene;
      }
      scope.presence = 1;
      this.morph = new Morph(from!, targets, { ...this.config.transition }, this.resolution, this.pointScale);
      this.scene.add(this.morph.group);
    }
    this.active.push(a);
    if (!o.instant && !morphIn) gsap.to(scope, { presence: 1, duration: 0.9, delay: 0.25, ease: "power2.out" });
    this.emit("scene", id);
  }

  /** stop a morph: drop its dots and its source scene */
  private endMorph() {
    this.morph?.dispose();
    this.morph = null;
    if (this.morphFrom && this.active.includes(this.morphFrom)) this.disposeActive(this.morphFrom);
    this.morphFrom = null;
  }

  /** restart the current scene from t = 0 at full presence */
  restart() {
    this.setScene(this.config.scene, { instant: true, force: true });
  }

  private disposeActive(a: Active) {
    a.inst.dispose?.();
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
    return c ? Math.max(0, c.age % c.def.duration) / c.def.duration : 0;
  }

  /** a world point in css px from the stage's top-left: for laying HTML (cards, connectors) over it */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  // ------------------------------------------------------------------ frame
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    // the first frame's timestamp can predate the constructor; a negative step would wrap the scene clock
    // backwards and fire "loop" at once, skipping the opening scene
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
    this.last = now;
    // the scene's clock starts only once it can be seen whole
    if (this.frozen || !this.onScreen || !this.loaded) return;
    this.step(this.config.playing ? dt * this.config.speed : 0);
    this.render();
    if (!this.shown) {
      this.shown = true;
      this.renderer.domElement.style.opacity = "1";
    }
    this.onFrame?.();
  };

  step(dt: number) {
    this.floor.beginFrame();
    let best: Active | undefined;
    let listen = 0, speak = 0;
    const tick = (a: Active, dt: number) => {
      const d = a.def.duration;
      const before = a.age % d;
      a.age += dt;
      // announce the wrap before drawing it: autoplay moves on here, and this scene then plays on past its end
      if (!a.leaving && a.age % d < before) {
        this.emit("loop", a.id);
        if (a.leaving) a.endAt = a.age - (a.age % d);
      }
      // a scene on its way out never wraps to t = 0, which would replay its opening under the next scene
      const t = a.leaving && a.endAt !== undefined && a.age >= a.endAt ? d + a.age - a.endAt : a.age % d;
      a.inst.update({
        t,
        age: a.age,
        dt,
        presence: a.morphOut ? 1 : a.scope.presence,
        loopOut: !a.morphOut && !this.advances,
      });
      a.drawn = true;
      const p = a.scope.presence;
      if (!best || p > best.scope.presence) best = a;
      listen += a.orb.listen * p;
      speak += a.orb.speak * p;
    };
    for (const a of [...this.active]) if (this.active.includes(a)) tick(a, dt);
    // a scene switched to during this frame (autoplay) draws now too, so no frame goes empty
    for (const a of [...this.active]) if (!a.drawn) tick(a, 0);
    if (this.morph) {
      this.morph.update(dt, this.pxScale, this.config.orb.radius);
      if (this.morph.done) this.endMorph();
    }
    const d = this.orb.drive;
    d.state = best ? best.orb.state : "idle";
    const tint = best?.orb.tint;
    this.orb.params.mid = tint ? tint.mid : this.config.orb.mid;
    this.orb.params.highlight = tint ? tint.high : this.config.orb.highlight;
    // the floor's glow, contact shadow and accents turn with the orb's hue as it eases into a tint
    const now = this.orb.highlightNow;
    const base = srgb(this.config.orb.highlight);
    const dh = hueOf(now.x, now.y, now.z) - hueOf(base.x, base.y, base.z);
    this.orb.hueShift = dh - Math.round(dh);
    this.floor.shadowColor = shiftHue(this.config.contactColor, this.orb.hueShift);
    this.floor.glowColor = this.orb.midNow;
    d.listen = Math.min(1, listen);
    d.speak = Math.min(1, speak);
    this.orb.update(dt);
    this.floor.endFrame(this.orb.energy);
  }

  /** autoplay moves on at the loop's end (and nothing is exporting a loop), so scenes needn't fade out there */
  private get advances() {
    return this.config.autoplay && !this.frozen && !this.onFrame;
  }

  /** css px per unit of particle size */
  private get pxScale() {
    return this.pointScale.value / this.renderer.getPixelRatio();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
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
    // particle sizes are authored for the default framing at 1×
    this.pointScale.value = pr * (5.2 / this.viewH) * (this.h / 640);
  }

  // ------------------------------------------------------------------ exports
  /** Renders the current moment at `scale`× css size. */
  async snapshot(o: { scale?: number; transparent?: boolean } = {}) {
    const { scale = 2, transparent = false } = o;
    return this.withSize(scale, transparent, async () => {
      this.renderer.render(this.scene, this.camera);
      return this.compose();
    });
  }

  /** Separate transparent PNGs per layer (floor, objects, orb) + the config, zipped. */
  async exportLayers(scale = 2) {
    const files: Record<string, Uint8Array> = {};
    await this.withSize(scale, true, async () => {
      const layers: ["floor" | "objects" | "orb", string][] = [["floor", "1-floor.png"], ["objects", "2-objects.png"], ["orb", "3-orb.png"]];
      for (const [layer, name] of layers) {
        this.renderLayer(layer);
        files[name] = new Uint8Array(await (await this.compose()).arrayBuffer());
      }
      this.renderer.render(this.scene, this.camera);
      files["0-composite.png"] = new Uint8Array(await (await this.compose()).arrayBuffer());
    });
    this.renderer.setClearColor(this.config.background, 1);
    files["config.json"] = strToU8(JSON.stringify(this.config, null, 2));
    return new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
  }

  /** The current frame as vector SVG: grid, strokes, particles, floor highlights (no orb). */
  sceneSVG() {
    const fx = this.floor.frameEffects;
    return buildSceneSVG({
      camera: this.camera,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      config: this.config,
      groups: [...this.active.filter((a) => a.group.visible).map((a) => a.group), ...(this.morph ? [this.morph.group] : [])],
      ripples: fx.ripples,
      tiles: fx.tiles,
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
          const b = await this.compose();
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
    try {
      return await fn();
    } finally {
      this.renderer.setClearColor(this.config.background, 1);
      this.frozen = wasFrozen;
      this.resize();
      this.last = performance.now();
    }
  }

  private async compose() {
    return toBlob(this.renderer.domElement);
  }

  /** Render one layer in colour; everything else still writes depth so occlusion stays right. */
  private renderLayer(layer: "floor" | "objects" | "orb") {
    const saved: [THREE.Material, boolean][] = [];
    const inLayer = (o: THREE.Object3D): boolean => {
      if (o === this.floor.mesh || o === this.orb.reflection) return layer === "floor";
      if (o === this.orb.mesh || o === this.orb.backdrop) return layer === "orb";
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
    this.renderer.render(this.scene, this.camera);
    for (const [m, v] of saved) m.colorWrite = v;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    this.endMorph();
    for (const a of [...this.active]) this.disposeActive(a);
    this.orb.dispose();
    this.floor.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
