// Retell orb inside a 3D scene.
//
// Port of the Iris reference orb (iris-voice.vercel.app/orb.js): same measured waveform W, delay
// field (delay.bin) and per-state motion. Differences:
//   • it draws on a camera-facing quad in world space instead of a full-screen pass;
//   • it writes sphere depth (impostor), so objects pass in front of / behind it correctly;
//   • voice input comes from the scene timeline (deterministic) instead of a microphone.

import * as THREE from "three";
import { shiftHue } from "./util";

const W = [0.3459,0.3303,0.3147,0.2991,0.284,0.2689,0.2542,0.24,0.2261,0.2129,0.2004,0.1879,0.1753,0.1635,0.1519,0.1408,0.1303,0.1199,0.1099,0.1,0.0906,0.0813,0.0724,0.064,0.0562,0.0482,0.0407,0.0334,0.0262,0.0179,0.0106,0.0057,0.0032,0.003,0.0058,0.0168,0.0428,0.0791,0.1224,0.173,0.2313,0.2973,0.3693,0.4438,0.5161,0.5831,0.6424,0.6918,0.7299,0.7522,0.7608,0.7632,0.7636,0.7631,0.7621,0.76,0.7574,0.7538,0.7493,0.7439,0.7377,0.7308,0.7237,0.7158,0.7072,0.6981,0.6885,0.6781,0.6673,0.6564,0.6448,0.6328,0.6204,0.6076,0.5943,0.5807,0.5665,0.5522,0.5374,0.5225,0.5073,0.4916,0.476,0.4598,0.4437,0.4275,0.4111,0.3948,0.3783,0.362];
const REF = { size: 500, radius: 229, cx: 249.5, cy: 248 };
const FPS = 25;
const LOOP = W.length;
const GRAIN_STD = 0.026;
const EXTENT = 1.04; // quad half-size in sphere radii

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface OrbParams {
  radius: number;
  shadow: string;
  mid: string;
  highlight: string;
  grain: number;
  speed: number;
  contrast: number;
  brightness: number;
  crop: number;
  shade: string;
  shadeAmount: number;
  reflection: number;
}

export interface OrbDrive {
  state: OrbState;
  listen: number; // caller voice level 0..1
  speak: number; // agent voice level 0..1
  bands: [number, number, number];
}

const hexRGB = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};

const vert = /* glsl */ `
uniform float uRadius;
out vec2 vP;
out vec3 vCenter;
void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vP = position.xy * ${EXTENT.toFixed(3)};
  vCenter = c.xyz;
  gl_Position = projectionMatrix * vec4(c.xy + vP * uRadius, c.z, 1.0);
}`;

// uniforms and helpers both passes share
const common = /* glsl */ `
precision highp float;
precision highp int;

uniform float uRadius, uRadiusPx;
uniform vec4  uDepth;        // projection terms for gl_FragDepth: (P[10], P[14], P[11], P[15])
uniform float uFrame, uTime;
uniform float uW[${LOOP}];
uniform sampler2D uMap;
uniform float uBright, uContrast, uOpacity;
uniform vec3  uC0, uC1, uC2;
uniform float uGrain, uGrainCell, uGrainFrame;
uniform float uIdleW, uListenW, uVar, uVarTime, uFlowMix, uRadial, uListen, uSpeak;
uniform vec3  uSpeakB;
uniform float uCrop, uShadeAmt;
uniform vec3  uShade;

vec2 mapUv(vec2 p) {
  return vec2(p.x * ${REF.radius.toFixed(1)} + ${REF.cx.toFixed(1)}, -p.y * ${REF.radius.toFixed(1)} + ${REF.cy.toFixed(1)}) / ${REF.size.toFixed(1)};
}
float waveAt(float f) {
  f = mod(f, ${LOOP}.0);
  int i = int(floor(f));
  int j = i + 1; if (j >= ${LOOP}) j = 0;
  return mix(uW[i], uW[j], f - float(i));
}
vec3 palette(float l) {
  float t = clamp(l / 0.77, 0.0, 1.0);
  return t < 0.5 ? mix(uC0, uC1, t * 2.0) : mix(uC1, uC2, t * 2.0 - 1.0);
}
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float gauss(vec2 cell) {
  vec3 u = vec3(pcg3d(uvec3(ivec3(int(cell.x) + 4096, int(cell.y) + 4096, int(uGrainFrame))))) / 4294967295.0;
  return (u.x + u.y + u.z - 1.5) * 2.0;
}
float grain(vec2 px) {
  if (uGrainCell <= 1.0) return gauss(floor(px)) * uGrainCell;
  vec2 g = px / uGrainCell, i = floor(g), f = g - i;
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(gauss(i), gauss(i + vec2(1, 0)), f.x), mix(gauss(i + vec2(0, 1)), gauss(i + vec2(1, 1)), f.x), f.y);
  return n * 1.45;
}

// the orb's colour at disc point v (1 = rim). noise is the film grain to add; shaded applies the lower shade.
vec3 orbColor(vec2 v, float noise, bool shaded) {
  // the reference orb, scaled up inside a circular mask so its rim light falls outside
  vec2 p = v / uCrop;
  float r = length(p);
  float inner = 1.0 - smoothstep(0.0, 0.9, r);
  vec2 q = p;
  q += uListen * 0.05 * vec2(sin(p.y * 3.1 + uTime * 1.7), sin(p.x * 2.7 - uTime * 1.3)) * (1.0 - r * r);
  vec2 eye = vec2(0.0, 0.05);
  q += uVar * 0.018 * vec2(sin(uVarTime * 0.09), sin(uVarTime * 0.13 + 1.7)) * inner;
  q = eye + (q - eye) * (1.0 - uIdleW * 0.03 * sin(uTime * 0.65) * inner);
  q = eye + (q - eye) * (1.0 - uListenW * 0.07 * inner);
  q = eye + (q - eye) * (1.0 - 0.16 * uSpeak * inner);

  float tau = texture(uMap, mapUv(q)).r;
  if (uFlowMix > 0.001) {
    vec2 rel = (q - eye) / vec2(1.0, 0.86);
    float dn = clamp(length(rel) / 0.95, 0.0, 1.0);
    float th = atan(rel.x, rel.y);
    float ys = mix(0.95 - 1.9 * dn, -0.95 + 1.9 * dn, 0.5 + 0.5 * uRadial / uFlowMix);
    float xs = 0.16 * sin(2.0 * th + 0.6) * sqrt(max(1.0 - ys * ys, 0.0));
    tau = mix(tau, texture(uMap, mapUv(vec2(xs, ys))).r, 0.8 * uFlowMix);
  }
  float gain = texture(uMap, mapUv(p)).g;
  tau += uListen * 5.0 * sin(r * 9.0 - uTime * 4.0) * inner;
  tau += uVar * (3.0 * sin(uVarTime * 0.11 + r * 2.3) + 2.0 * sin(uVarTime * 0.07 - p.y * 3.1));
  tau += uSpeak * 7.0 * inner + uSpeakB.y * 4.0 * sin(r * 6.0 + uTime * 1.2) + uSpeakB.z * 2.0 * (1.0 - inner);

  float lum = gain * waveAt(uFrame - tau);
  lum *= 1.0 + 0.12 * uSpeak;
  lum = (lum - 0.38) * uContrast + 0.38 + uBright;
  float gw = mix(0.72, 1.0, smoothstep(0.0, 0.15, lum)) * (1.0 - 0.25 * smoothstep(0.55, 0.78, lum));
  lum += noise * gw;
  vec3 col = palette(lum);
  if (!shaded) return col;

  // lower half multiplied down, shaded on the sphere (a light above and a little in front) so the bands curve
  // round it rather than cutting straight across. Down the middle it follows the design's stops:
  // clear to 33% below centre, 22% at 63%, full at the base.
  vec3 n = vec3(v, sqrt(max(0.0, 1.0 - dot(v, v))));
  float lit = dot(n, vec3(0.0, 0.857, 0.514));
  float sa = pow(clamp((0.208 - lit) / 0.876, 0.0, 1.0), 1.65);
  return col * mix(vec3(1.0), uShade, clamp(sa * uShadeAmt, 0.0, 1.0));
}
`;

const frag = /* glsl */ `
${common}
in vec2 vP;
in vec3 vCenter;
layout(location = 0) out highp vec4 outColor;

void main() {
  float rs = length(vP);
  vec2 p = vP / uCrop;
  float e = max(rs, length(p / vec2(${(226.5 / REF.radius).toFixed(4)}, ${(229.7 / REF.radius).toFixed(4)})));
  float aa = max(1.2 / uRadiusPx, ${(1.3 / REF.radius).toFixed(4)});
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, e);
  if (disc < 0.002) discard;

  vec3 col = orbColor(vP, grain(gl_FragCoord.xy) * uGrain, true);

  // sphere impostor depth: the front surface of a sphere of radius uRadius around vCenter
  float z = sqrt(max(0.0, 1.0 - min(rs * rs, 1.0))) * uRadius;
  float vz = vCenter.z + z;
  float cz = uDepth.x * vz + uDepth.y;
  float cw = uDepth.z * vz + uDepth.w;
  gl_FragDepth = clamp(cz / cw * 0.5 + 0.5, 0.0, 1.0);

  outColor = vec4(col, disc * uOpacity);
}`;

// The orb mirrored in the floor: one diameter lower, its own colours (before the lower shade, as the
// design's reflection is the orb's blue), blurring more and fading out the further it gets from the base.
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

const vec2 TAPS[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

void main() {
  // distance from the contact point, measured in an ellipse lying on the floor (wide, shallow), so the fade
  // rings out round the base instead of running in straight bands; 1 = 0.48 radii straight down
  float far = length(vec2(vP.x * 0.36, max(0.0, 0.976 - vP.y))) / 0.476;
  float fade = exp(-2.8 * far * far);
  if (fade < 0.004) discard;
  // progressive blur: sharp at the contact, ~0.15 radii soft by the old fade line, a little more in the tail
  float bf = min(far, 1.3);
  float blur = mix(0.012, 0.15, bf * bf * (3.0 - 2.0 * min(bf, 1.0)));
  vec2 m = vec2(vP.x, -vP.y);
  vec3 acc = orbColor(m, 0.0, false);
  for (int i = 0; i < 12; i++) {
    vec2 s = m + TAPS[i] * blur;
    acc += orbColor(s * min(1.0, 0.985 / max(length(s), 1e-4)), 0.0, false);
  }
  vec3 col = acc / 13.0;
  float edge = max(blur, 2.0 / uRadiusPx);
  float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, length(vP));
  float a = uRefl * disc * fade * uOpacity;
  if (a < 0.002) discard;
  outColor = vec4(col, a);
}`;

export class Orb {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  /** invisible sphere that only casts the key light's shadow */
  readonly caster: THREE.Mesh;
  /** mirror image on the floor, drawn under the grid and contact shadow */
  readonly reflection: THREE.Mesh;
  readonly ready: Promise<void>;
  params: OrbParams;
  drive: OrbDrive = { state: "idle", listen: 0, speak: 0, bands: [0, 0, 0] };

  private uniforms: Record<string, THREE.IUniform>;
  private weight = { listening: 0, speaking: 0, thinking: 0 };
  private d = { listen: 0, speak: 0, voice: 0, mic: 0, speakB: [0, 0, 0] };
  private frameClock = 0;
  private time = 0;
  private varTime = 0;
  private rate = 1;
  /** eased activity of the orb (0..1); scenes and lights read it for glow */
  energy = 0;
  /** hue turn of the current (tinted) orb from its configured colours; the lower shade follows it */
  hueShift = 0;

  constructor(params: OrbParams) {
    this.params = { ...params };
    const tex = new THREE.DataTexture(new Uint16Array(500 * 500 * 2), 500, 500, THREE.RGFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.ready = fetch("/orb/delay.bin")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load /orb/delay.bin");
        return r.arrayBuffer();
      })
      .then((buf) => {
        tex.image.data = new Uint16Array(buf);
        tex.needsUpdate = true;
      });

    const v3 = (h: string) => new THREE.Vector3(...hexRGB(h));
    this.uniforms = {
      uRadius: { value: params.radius },
      uRadiusPx: { value: 200 },
      uDepth: { value: new THREE.Vector4(0, 0, 0, 1) },
      uFrame: { value: 0 },
      uTime: { value: 0 },
      uW: { value: W },
      uMap: { value: tex },
      uBright: { value: params.brightness },
      uContrast: { value: params.contrast },
      uOpacity: { value: 1 },
      uC0: { value: v3(params.shadow) },
      uC1: { value: v3(params.mid) },
      uC2: { value: v3(params.highlight) },
      uGrain: { value: GRAIN_STD * params.grain },
      uGrainCell: { value: 1 },
      uGrainFrame: { value: 0 },
      uIdleW: { value: 1 },
      uListenW: { value: 0 },
      uVar: { value: 1 },
      uVarTime: { value: 0 },
      uFlowMix: { value: 0 },
      uRadial: { value: 0 },
      uListen: { value: 0 },
      uSpeak: { value: 0 },
      uSpeakB: { value: new THREE.Vector3() },
      uCrop: { value: params.crop },
      uShade: { value: v3(params.shade) },
      uShadeAmt: { value: params.shadeAmount },
      uRefl: { value: params.reflection },
    };
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = "orb";
    // keep the impostor's depth in sync with whichever camera renders it
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      const e = camera.projectionMatrix.elements;
      (this.uniforms.uDepth.value as THREE.Vector4).set(e[10], e[14], e[11], e[15]);
    };

    this.caster = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    this.caster.castShadow = true;
    this.caster.name = "orb-shadow-caster";

    const u = this.uniforms;
    this.reflection = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: reflVert,
        fragmentShader: reflFrag,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.reflection.frustumCulled = false;
    this.reflection.renderOrder = -3;
    this.reflection.name = "orb-reflection";

    this.group.add(this.mesh, this.caster, this.reflection);
    this.setParams(params);
  }

  /** the highlight colour as currently shown (eases toward a tint) */
  get highlightNow() {
    return this.uniforms.uC2.value as THREE.Vector3;
  }

  get radius() {
    return this.params.radius;
  }

  setParams(p: Partial<OrbParams>) {
    Object.assign(this.params, p);
    const r = this.params.radius;
    this.group.position.set(0, r, 0);
    this.caster.scale.setScalar(r * 0.98);
    this.uniforms.uRadius.value = r;
    this.uniforms.uGrain.value = GRAIN_STD * this.params.grain;
    const u = this.uniforms;
    u.uCrop.value = this.params.crop;
    (u.uShade.value as THREE.Vector3).set(...hexRGB(this.params.shade));
    u.uShadeAmt.value = this.params.shadeAmount;
    u.uRefl.value = this.params.reflection;
  }

  /** device pixels per world unit, for grain and edge anti-aliasing */
  setPixelScale(pxPerUnit: number) {
    const rpx = this.params.radius * pxPerUnit;
    this.uniforms.uRadiusPx.value = rpx;
    this.uniforms.uGrainCell.value = (1.05 * rpx) / REF.radius;
  }

  set opacity(v: number) {
    this.uniforms.uOpacity.value = v;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    const ease = (cur: number, target: number, k: number) => cur + (target - cur) * (1 - Math.exp(-dt * k));
    const { drive, weight, d, params } = this;
    // one bad value from a scene would poison the eased state for good: treat it as silence
    const ok = (v: number) => (Number.isFinite(v) ? v : 0);
    drive.listen = ok(drive.listen);
    drive.speak = ok(drive.speak);
    drive.bands = [ok(drive.bands[0]), ok(drive.bands[1]), ok(drive.bands[2])];
    const u = this.uniforms;
    this.time += dt;
    weight.listening = ease(weight.listening, drive.state === "listening" ? 1 : 0, 3);
    weight.speaking = ease(weight.speaking, drive.state === "speaking" ? 1 : 0, 3);
    weight.thinking = ease(weight.thinking, drive.state === "thinking" ? 1 : 0, 3);

    const follow = (cur: number, target: number) => ease(cur, target, target > cur ? 14 : 4);
    d.listen = follow(d.listen, drive.listen * weight.listening);
    d.mic = ease(d.mic, drive.listen, drive.listen > d.mic ? 14 : 7);
    d.voice = ease(d.voice, drive.speak, drive.speak > d.voice ? 14 : 7);
    d.speak = follow(d.speak, drive.speak * weight.speaking);
    for (let i = 0; i < 3; i++) d.speakB[i] = follow(d.speakB[i], drive.bands[i] * weight.speaking);

    const wIdle = Math.max(0, 1 - weight.listening - weight.speaking - weight.thinking);
    const stateRate =
      wIdle * 0.45 + weight.thinking * 0.9 + weight.listening * (0.08 + 1.4 * d.mic) + weight.speaking * (0.05 + 2.2 * d.voice);
    const wander = 1 + 0.12 * Math.sin(this.varTime * 0.17) * Math.sin(this.varTime * 0.071 + 1);
    const target = params.speed * stateRate * wander;
    this.rate = ease(this.rate, target, target > this.rate ? 5 : 3.5);
    this.frameClock = (((this.frameClock + dt * FPS * this.rate) % LOOP) + LOOP) % LOOP;

    const k = 8;
    (u.uC0.value as THREE.Vector3).lerp(new THREE.Vector3(...hexRGB(params.shadow)), 1 - Math.exp(-dt * k));
    (u.uC1.value as THREE.Vector3).lerp(new THREE.Vector3(...hexRGB(params.mid)), 1 - Math.exp(-dt * k));
    (u.uC2.value as THREE.Vector3).lerp(new THREE.Vector3(...hexRGB(params.highlight)), 1 - Math.exp(-dt * k));
    (u.uShade.value as THREE.Vector3).set(...hexRGB(shiftHue(params.shade, this.hueShift)));
    u.uBright.value = ease(u.uBright.value, params.brightness, k);
    u.uContrast.value = ease(u.uContrast.value, params.contrast, k);

    u.uFrame.value = this.frameClock;
    u.uTime.value = this.time;
    u.uGrainFrame.value = Math.floor(this.time * 1) % 100000;
    u.uIdleW.value = wIdle;
    u.uListenW.value = weight.listening;
    const activity = wIdle + weight.thinking + weight.listening * d.mic + weight.speaking * d.voice;
    this.varTime += dt * Math.min(1, activity);
    u.uVarTime.value = this.varTime;

    // flow: every state rises bottom → top, like the brand orb (set -1 inward / 1 outward to experiment)
    const dir = { idle: 0, listening: 0, thinking: 0, speaking: 0 }[drive.state];
    u.uFlowMix.value = ease(u.uFlowMix.value, Math.abs(dir), 1.6);
    u.uRadial.value = ease(u.uRadial.value, dir, 1.6);
    u.uListen.value = d.listen;
    u.uSpeak.value = d.speak;
    (u.uSpeakB.value as THREE.Vector3).set(d.speakB[0], d.speakB[1], d.speakB[2]);

    this.energy = ease(this.energy, Math.min(1, 0.25 + 0.75 * Math.max(d.listen, d.speak, weight.thinking * 0.6)), 6);
  }

  /** Jump eased state straight to the drive's targets (used before deterministic exports). */
  settle() {
    for (let i = 0; i < 90; i++) this.update(1 / 30);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.caster.geometry.dispose();
    (this.caster.material as THREE.Material).dispose();
    this.reflection.geometry.dispose();
    (this.reflection.material as THREE.Material).dispose();
    (this.uniforms.uMap.value as THREE.Texture).dispose();
  }
}
