// Retell orb inside a 3D scene.
//
// Port of the Meridian voice orb (meridian-voice-swart.vercel.app): same filament shader, styles and
// per-state motion, drawn in its Ink mode for a light page. Differences:
//   • it draws on a camera-facing quad in world space instead of a full-screen canvas;
//   • it is mirrored in the floor beneath it;
//   • voice input comes from the scene timeline (deterministic) instead of a microphone.
//
// The orb is see-through, so it writes no depth and draws last: whatever is behind it shows through.
// Voice states never change its size or outline; the energy moves inside it.

import * as THREE from "three";

const EXTENT = 1.7; // quad half-size in sphere radii: the halo and pole flares reach past the sphere
const MASK_FROM = 1.2; // the reference's soft edge, in sphere radii: the glow is gone by MASK_TO
const MASK_TO = 1.667;

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type OrbStyle = 1 | 2;

/** How one style of the orb looks. */
export interface OrbLook {
  /** size of the filaments (lower = broader, softer) */
  streaks: number;
  fine: number;
  /** vertical motion blur along the meridians */
  smear: number;
  rim: number;
  /** how much of the far side shows through */
  back: number;
  /** flares at the top and bottom */
  pole: number;
  halo: number;
  exposure: number;
  grain: number;
  /** seconds per loop */
  loop: number;
  /** picks the pattern; changes at once rather than easing */
  seed: number;
}

/** Style 1 is the reference's "For Voice" look, style 2 its "Blue" look, both with less density and glow to stay airy in the scene. */
export const ORB_LOOKS: Record<OrbStyle, OrbLook> = {
  1: { streaks: 3.2, fine: 0.7, smear: 0.2, rim: 0.75, back: 0.75, pole: 1.2, halo: 0.3, exposure: 0.7, grain: 0.15, loop: 5.76, seed: 3.7 },
  2: { streaks: 1, fine: 1.14, smear: 0, rim: 0.41, back: 0.75, pole: 0, halo: 0.3, exposure: 0.65, grain: 0.4, loop: 20, seed: 81.4 },
};

export interface OrbParams {
  radius: number;
  /** colour of the thin, light parts */
  mid: string;
  /** colour where the orb is densest */
  highlight: string;
  speed: number;
  /** the orb mirrored in the floor beneath it */
  reflection: number;
  looks: Record<OrbStyle, OrbLook>;
}

export interface OrbDrive {
  state: OrbState;
  listen: number; // caller voice level 0..1
  speak: number; // agent voice level 0..1
}

/** Per-state motion, from the reference with gentler light boosts, as scenes rarely leave these states; `react` is how strongly the voice level drives the rest. */
const STATES: Record<OrbState, { spin: number; breathe: number; exp: number; pole: number; halo: number; flow: number; wave: number; react: number }> = {
  idle: { spin: 1, breathe: 0, exp: 0, pole: 0, halo: 0, flow: 0, wave: 0, react: 0.25 },
  listening: { spin: 1.6, breathe: 0.04, exp: 0.1, pole: 0.2, halo: 0.2, flow: 0.22, wave: 0.22, react: 0.7 },
  speaking: { spin: 1.3, breathe: 0, exp: 0.06, pole: 0.12, halo: 0.15, flow: 0.12, wave: 0.1, react: 1 },
  thinking: { spin: 2.4, breathe: 0.03, exp: 0.04, pole: 0.3, halo: 0.12, flow: 0.5, wave: 0.04, react: 0 },
};

const hexRGB = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};

const vert = /* glsl */ `
uniform float uRadius;
out vec2 vP;
void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vP = position.xy * ${EXTENT.toFixed(3)};
  gl_Position = projectionMatrix * vec4(c.xy + vP * uRadius, c.z, 1.0);
}`;

// uniforms and helpers both passes share
const common = /* glsl */ `
precision highp float;
precision highp int;

uniform float uClock, uFlow, uWave, uT;
uniform float uStreaks, uFine, uRim, uBack, uPole, uHalo, uGrain, uExposure, uSeed;
uniform vec3 uCore, uMid;

#define TAU 6.28318530718

vec3 lightPath(float t) {
  float a = TAU * t, b = 2.0 * a;
  return vec3(
    -0.7 - 0.448 * cos(a) - 0.033 * sin(a) + 0.172 * cos(b) + 0.041 * sin(b),
    0.9 - 0.59 * cos(a) - 0.597 * sin(a) + 0.207 * cos(b) - 0.187 * sin(b),
    1.0 + 0.6 * (0.132 * cos(a) - 0.091 * sin(a) - 0.117 * cos(b) + 0.246 * sin(b)));
}
float h13(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// the filaments on the sphere's surface at s
float filaments(vec3 s) {
  float ph = uT * TAU;
  float lon = atan(s.x, s.z);
  float fy = 0.6 * sin(ph * 5.0 + s.x * 2.0);
  vec2 c = vec2(cos(lon), sin(lon));
  float n1 = vn(vec3(c * uStreaks, s.y * 1.1 + uSeed + 0.7 * sin(ph) + uFlow));
  float n2 = vn(vec3(c * uStreaks * 2.7 + 7.1, s.y * 1.6 + uSeed * 1.7 + 0.7 * cos(ph) - uFlow * 1.4));
  float n3 = vn(vec3(c * uStreaks * 7.0 + 3.3, s.y * 0.9 + uSeed * 0.6 + uFlow * 0.5 + fy));
  float n = smoothstep(0.3, 0.95, n1 * 0.55 + n2 * 0.35 + n3 * uFine * 0.45);
  return n * n * 1.6 * (1.0 + uWave * (0.55 + 0.45 * sin(abs(s.y) * 11.0 - uClock * 9.0)));
}
// light at disc point p (1 = the sphere's edge): both sides of the sphere, the flares and the halo
float shade(vec2 p) {
  float r2 = dot(p, p), d = sqrt(r2), I = 0.0;
  if (r2 < 1.0) {
    float z = sqrt(1.0 - r2);
    float w = mix(0.3, 0.12 + pow(1.0 - z, 1.4) * 1.7, uRim);
    I += (filaments(vec3(p, z)) + filaments(vec3(p.x, p.y, -z)) * uBack) * w;
    vec2 ld = lightPath(uT - 0.04).xy * 0.5;
    I *= 0.55 + 0.95 * pow(clamp(dot(p, ld) * 0.5 + 0.5, 0.0, 1.3), 2.0);
    I *= smoothstep(1.0, 0.93, d);
  }
  float wob = 0.1 * sin(uT * TAU * 2.0 + uSeed);
  vec2 pt = (p - vec2(wob, 0.86)) * vec2(1.0, 1.5), pb = (p - vec2(-wob * 0.6, -0.87)) * vec2(1.0, 1.5);
  float pf = 1.0 + 0.35 * sin(uT * TAU * 7.0 + uSeed);
  I += uPole * pf * (exp(-dot(pt, pt) * 55.0) + 0.8 * exp(-dot(pb, pb) * 65.0));
  I += uPole * 0.18 * (exp(-length(pt) * 5.0) + exp(-length(pb) * 6.0));
  I += uHalo * 0.3 * exp(-abs(d - 0.93) * 3.2);
  return I;
}
// light around p, blurred with stochastic samples: smear vertically, jitter sideways
float blurred(vec2 p, float jitter, float smear, int n) {
  float j = h13(vec3(gl_FragCoord.xy, uT * 97.0 + 1.0));
  float jx = h13(vec3(gl_FragCoord.yx * 0.71, uT * 53.0 + 5.0)) - 0.5;
  float I = 0.0, ws = 0.0;
  for (int i = 0; i < n; i++) {
    float k = (float(i) + j) / float(n) - 0.5;
    float w = exp(-k * k * 6.0);
    I += shade(p + vec2(k * 0.03 + jx * jitter, k * smear)) * w;
    ws += w;
  }
  return I / ws;
}
// the reference's Ink mode: light becomes density of colour, premultiplied, so the page shows through
vec4 ink(float I) {
  I *= lightPath(uT - 0.04).z;
  I *= 1.0 + (h13(vec3(gl_FragCoord.xy * 1.37, uT * 61.0 + 3.0)) - 0.5) * uGrain;
  float t = 1.0 - exp(-I * uExposure);
  float a = clamp(t * 1.15, 0.0, 1.0);
  return vec4(mix(uMid, uCore, smoothstep(0.45, 1.0, t)) * a, a);
}
`;

const frag = /* glsl */ `
${common}
uniform float uSmear;
in vec2 vP;
layout(location = 0) out highp vec4 outColor;

void main() {
  float mask = 1.0 - clamp((length(vP) - ${MASK_FROM.toFixed(3)}) / ${(MASK_TO - MASK_FROM).toFixed(3)}, 0.0, 1.0);
  if (mask < 0.002) discard;
  outColor = ink(blurred(vP, 0.035, uSmear, 12)) * mask;
}`;

// The orb mirrored in the floor: one diameter lower, blurring more and fading out the further it gets from the
// base. It is made of the same light, so it stays as airy as the orb and only exists where the orb has density.
const reflVert = /* glsl */ `
uniform float uRadius;
out vec2 vP;
void main() {
  vec4 c = modelViewMatrix * vec4(0.0, -2.0 * uRadius, 0.0, 1.0);
  vP = position.xy * ${EXTENT.toFixed(3)};
  gl_Position = projectionMatrix * vec4(c.xy + vP * uRadius, c.z, 1.0);
}`;

const reflFrag = /* glsl */ `
${common}
uniform float uRefl;
in vec2 vP;
layout(location = 0) out highp vec4 outColor;

void main() {
  // distance from the contact point, measured in an ellipse lying on the floor (wide, shallow), so the fade
  // rings out round the base instead of running in straight bands
  float far = length(vec2(vP.x * 0.36, max(0.0, 0.976 - vP.y))) / 0.6;
  float fade = exp(-2.4 * far * far);
  float a = uRefl * fade * (1.0 - clamp((length(vP) - ${MASK_FROM.toFixed(3)}) / ${(MASK_TO - MASK_FROM).toFixed(3)}, 0.0, 1.0));
  if (a < 0.002) discard;
  // a wide blur needs more samples than the orb's, or its bright flare breaks up into speckles
  float blur = mix(0.05, 0.3, min(far, 1.0));
  outColor = ink(blurred(vec2(vP.x, -vP.y), blur, blur, 24)) * a;
}`;

/** the look's values that ease when the style changes (the loop and the pattern change at once) */
const EASED = ["streaks", "fine", "smear", "rim", "back", "pole", "halo", "exposure", "grain"] as const;

export class Orb {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  /** mirror image on the floor, drawn under the grid and contact shadow */
  readonly reflection: THREE.Mesh;
  params: OrbParams;
  drive: OrbDrive = { state: "idle", listen: 0, speak: 0 };

  private uniforms: Record<string, THREE.IUniform>;
  private style: OrbStyle = 1;
  /** the look as currently shown, easing toward the style's */
  private look: OrbLook;
  private cur = { ...STATES.idle };
  private level = 0;
  private thinking = 0;
  private clock = 0;
  private flow = 0;
  private phase = 0;
  /** eased activity of the orb (0..1); the floor reads it for glow */
  energy = 0;
  /** hue turn of the current (tinted) orb from its configured colours; the floor follows it */
  hueShift = 0;

  constructor(params: OrbParams) {
    this.params = { ...params };
    this.look = { ...params.looks[this.style] };
    const v3 = (h: string) => new THREE.Vector3(...hexRGB(h));
    this.uniforms = {
      uRadius: { value: params.radius },
      uClock: { value: 0 },
      uFlow: { value: 0 },
      uWave: { value: 0 },
      uT: { value: 0 },
      uStreaks: { value: 0 },
      uFine: { value: 0 },
      uSmear: { value: 0 },
      uRim: { value: 0 },
      uBack: { value: 0 },
      uPole: { value: 0 },
      uHalo: { value: 0 },
      uGrain: { value: 0 },
      uExposure: { value: 0 },
      uSeed: { value: 0 },
      uCore: { value: v3(params.highlight) },
      uMid: { value: v3(params.mid) },
      uRefl: { value: params.reflection },
    };
    const material = (vertexShader: string, fragmentShader: string) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: this.uniforms,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material(vert, frag));
    this.mesh.frustumCulled = false;
    // after the scene's objects (kit.ts), so they show through
    this.mesh.renderOrder = 4;
    this.mesh.name = "orb";

    this.reflection = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material(reflVert, reflFrag));
    (this.reflection.material as THREE.Material).depthTest = false;
    this.reflection.frustumCulled = false;
    this.reflection.renderOrder = -3;
    this.reflection.name = "orb-reflection";

    this.group.add(this.mesh, this.reflection);
    this.setParams(params);
    this.writeLook(0);
  }

  /** the dense colour as currently shown (eases toward a tint) */
  get highlightNow() {
    return this.uniforms.uCore.value as THREE.Vector3;
  }

  /** the light colour as currently shown (eases toward a tint) */
  get midNow() {
    return this.uniforms.uMid.value as THREE.Vector3;
  }

  get radius() {
    return this.params.radius;
  }

  setParams(p: Partial<OrbParams>) {
    Object.assign(this.params, p);
    const r = this.params.radius;
    this.group.position.set(0, r, 0);
    this.uniforms.uRadius.value = r;
    this.uniforms.uRefl.value = this.params.reflection;
  }

  /** Switch style, easing the look across so it reads as one orb changing; `instant` jumps there. */
  setStyle(style: OrbStyle, instant = false) {
    this.style = style;
    if (instant) this.look = { ...this.params.looks[style] };
  }

  /** ease the shown look toward the current style's by k (0..1) and hand it to the shader */
  private writeLook(k: number) {
    const { look, uniforms: u } = this;
    const target = this.params.looks[this.style];
    for (const key of EASED) look[key] += (target[key] - look[key]) * k;
    look.loop = target.loop;
    look.seed = target.seed;
    u.uStreaks.value = look.streaks;
    u.uFine.value = look.fine;
    u.uSmear.value = look.smear;
    u.uRim.value = look.rim;
    u.uBack.value = look.back;
    u.uGrain.value = look.grain;
    u.uSeed.value = look.seed;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    const { drive, cur, uniforms: u } = this;
    // one bad value from a scene would poison the eased state for good: treat it as silence
    const ok = (v: number) => (Number.isFinite(v) ? v : 0);
    const raw = drive.state === "listening" ? ok(drive.listen) : drive.state === "speaking" ? ok(drive.speak) : 0;

    const target = STATES[drive.state];
    const k = 1 - Math.exp(-dt * 5);
    for (const key of Object.keys(target) as (keyof typeof target)[]) cur[key] += (target[key] - cur[key]) * k;
    this.level += (raw - this.level) * Math.min(1, (raw > this.level ? 30 : 7) * dt);
    this.clock += dt;
    this.flow += dt * (cur.flow + this.level * cur.react * 1.2);
    this.writeLook(k);
    const { look } = this;
    const speed = (cur.spin * (1 + this.level * cur.react * 0.5) * this.params.speed) / Math.max(0.1, look.loop);
    this.phase = (this.phase + dt * speed) % 1;

    const r = this.level * cur.react;
    const breathe = cur.breathe * Math.sin(this.clock * 2.4);
    u.uClock.value = this.clock;
    u.uFlow.value = this.flow;
    u.uT.value = this.phase;
    u.uWave.value = cur.wave + r * 1.1;
    u.uPole.value = look.pole * (1 + cur.pole + r * 0.7);
    u.uHalo.value = look.halo * (1 + cur.halo + r * 0.3);
    u.uExposure.value = look.exposure * (1 + cur.exp + r * 0.3 + breathe * 3);

    const ease = 1 - Math.exp(-dt * 8);
    (u.uCore.value as THREE.Vector3).lerp(new THREE.Vector3(...hexRGB(this.params.highlight)), ease);
    (u.uMid.value as THREE.Vector3).lerp(new THREE.Vector3(...hexRGB(this.params.mid)), ease);

    this.thinking += ((drive.state === "thinking" ? 1 : 0) - this.thinking) * k;
    this.energy += (Math.min(1, 0.25 + 0.75 * Math.max(this.level, this.thinking * 0.6)) - this.energy) * (1 - Math.exp(-dt * 6));
  }

  /** Jump eased state straight to the drive's targets (used before deterministic exports). */
  settle() {
    for (let i = 0; i < 90; i++) this.update(1 / 30);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.reflection.geometry.dispose();
    (this.reflection.material as THREE.Material).dispose();
  }
}
