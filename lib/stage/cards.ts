// UI cards anchored to points in the 3D scene. Drawn on a 2D canvas over the WebGL canvas so they
// stay crisp, can blur what's behind them, and can be composited into PNG / video exports.
// The same cards can be written out as SVG, which pastes into Figma as editable layers.

import * as THREE from "three";
import { clamp } from "./util";

export type CardStyle = "glass-dark" | "glass-light" | "outline";
export type CardKind = "pill" | "chip" | "label" | "note";
export type IconName =
  | "spinner" | "check" | "wave" | "spark" | "branch" | "ear" | "speaker" | "mute" | "clock"
  | "user" | "pause" | "dot" | "arrow" | "text" | "x";

export interface CardSpec {
  kind?: CardKind;
  anchor?: THREE.Vector3 | null; // world point; null = relative to the stage centre
  x?: number; // px offset from anchor (in card-scale px)
  y?: number;
  align?: "left" | "right" | "center"; // which edge of the card sits at the point
  icon?: IconName | null;
  title?: string;
  meta?: string; // e.g. "Agent"
  time?: string; // e.g. "Now"
  lines?: string[]; // note body
  leader?: boolean;
  accent?: boolean;
  mono?: boolean;
}

export interface Card extends Required<Omit<CardSpec, "anchor" | "icon" | "meta" | "time" | "lines">> {
  anchor: THREE.Vector3 | null;
  icon: IconName | null;
  meta: string;
  time: string;
  lines: string[];
  opacity: number;
  scale: number;
  dy: number;
  reveal: number; // 0..1 characters typed (title, then lines)
  strike: number; // 0..1 strike-through on lines
  progress: number; // -1 none, 0..1 a progress bar under the title
  owner: CardScope;
}

export class CardScope {
  presence = 0;
  cards: Card[] = [];
  constructor(private layer: CardLayer) {}
  add(spec: CardSpec): Card {
    const c: Card = {
      kind: "pill", x: 0, y: 0, align: "left", title: "", leader: false, accent: false, mono: false,
      ...spec,
      anchor: spec.anchor ? spec.anchor.clone() : null,
      icon: spec.icon ?? null,
      meta: spec.meta ?? "",
      time: spec.time ?? "",
      lines: spec.lines ?? [],
      opacity: 0, scale: 1, dy: 0, reveal: 1, strike: 0, progress: -1,
      owner: this,
    };
    this.cards.push(c);
    this.layer.cards.push(c);
    return c;
  }
  dispose() {
    this.layer.cards = this.layer.cards.filter((c) => c.owner !== this);
    this.cards = [];
  }
}

// 24-unit icon paths (lucide-style strokes)
const ICONS: Record<Exclude<IconName, "spinner" | "dot">, string> = {
  check: "M5 12.5l4.2 4.2L19 7",
  wave: "M3 12h1.5M7 8v8M11 5v14M15 9v6M19 7v10M21.5 12H21",
  spark: "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  branch: "M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  ear: "M6 8.5a6 6 0 0 1 12 0c0 3.5-3.5 4.5-3.5 8a3.5 3.5 0 0 1-6.5 1.8M9.5 9a2.5 2.5 0 0 1 5 0",
  speaker: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
  pause: "M8 5v14M16 5v14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  text: "M4 6h16M4 12h16M4 18h10",
  x: "M6 6l12 12M18 6L6 18",
};

interface StyleSpec {
  font: string;
  mono: string;
}

export class CardLayer {
  readonly canvas: HTMLCanvasElement;
  cards: Card[] = [];
  style: CardStyle = "glass-dark";
  scale = 1;
  show = true;
  accent = "#3E6AEF";
  ink = "#1A1C22";
  private ctx: CanvasRenderingContext2D;
  private fonts: StyleSpec = { font: "Inter, system-ui, sans-serif", mono: "ui-monospace, monospace" };
  private paths = new Map<string, Path2D>();
  private v = new THREE.Vector3();
  time = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    this.ctx = this.canvas.getContext("2d")!;
  }

  setFonts(font: string, mono: string) {
    this.fonts = { font, mono };
  }

  scope() {
    return new CardScope(this);
  }

  private path(d: string) {
    let p = this.paths.get(d);
    if (!p) this.paths.set(d, (p = new Path2D(d)));
    return p;
  }

  /** world → css px (relative to the canvas) */
  project(p: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    this.v.copy(p).project(camera);
    return { x: (this.v.x * 0.5 + 0.5) * w, y: (-this.v.y * 0.5 + 0.5) * h };
  }

  /** Card geometry in css px, shared by canvas drawing and SVG export. */
  private layout(c: Card, camera: THREE.Camera, w: number, h: number, ctx: CanvasRenderingContext2D) {
    const s = this.scale * c.scale;
    const a = c.anchor ? this.project(c.anchor, camera, w, h) : { x: w / 2, y: h / 2 };
    const dark = this.style === "glass-dark";
    const outline = this.style === "outline";
    const mono = c.mono || (outline && c.kind !== "note");
    const fs = (c.kind === "label" ? 11 : c.kind === "chip" ? 12 : 13) * s;
    const font = `${c.kind === "label" || mono ? 500 : 450} ${fs}px ${mono ? this.fonts.mono : this.fonts.font}`;
    ctx.font = font;
    const title = outline && c.kind !== "note" ? c.title.toUpperCase() : c.title;
    const typed = Math.round(clamp(c.reveal) * (title.length + c.lines.join("").length));
    const shownTitle = title.slice(0, Math.min(typed, title.length));
    let tw = ctx.measureText(title).width;
    if (mono) tw += title.length * 0.04 * fs;
    const icon = c.icon ? 16 * s : 0;
    const padX = (c.kind === "label" ? 8 : c.kind === "chip" ? 10 : 14) * s;
    const gap = icon ? 8 * s : 0;
    const hgt = (c.kind === "label" ? 22 : c.kind === "chip" ? 28 : 40) * s;

    // note: multi-line body
    let noteLines: { text: string; full: string }[] = [];
    let noteW = 0;
    const lineH = 19 * s;
    if (c.kind === "note") {
      const bodyFont = `400 ${13 * s}px ${this.fonts.font}`;
      ctx.font = bodyFont;
      let left = Math.max(0, typed - title.length);
      noteLines = c.lines.map((full) => {
        const text = full.slice(0, Math.min(left, full.length));
        left -= full.length;
        noteW = Math.max(noteW, ctx.measureText(full).width);
        return { text, full };
      });
      ctx.font = font;
    }
    const bw = c.kind === "note" ? Math.max(tw + icon + gap, noteW) + padX * 2 : tw + icon + gap + padX * 2;
    const bh = c.kind === "note" ? 14 * s + fs + 10 * s + noteLines.length * lineH + 10 * s : hgt;
    let x = a.x + c.x * this.scale;
    const y = a.y + c.y * this.scale + c.dy * this.scale;
    if (c.align === "right") x -= bw;
    else if (c.align === "center") x -= bw / 2;
    // keep cards inside the frame
    const m = 14 * this.scale;
    let top = y - bh / 2;
    x = Math.min(Math.max(x, m), w - bw - m);
    top = Math.min(Math.max(top, m), h - bh - m - (c.meta || c.time ? 20 * s : 0));
    const yc = top + bh / 2;
    return { a, s, x, y: yc - bh / 2, bw, bh, fs, font, title, shownTitle, icon, padX, gap, noteLines, lineH, dark, outline, mono };
  }

  render(camera: THREE.Camera, w: number, h: number, dpr: number, source?: HTMLCanvasElement) {
    const { canvas, ctx } = this;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.show) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of this.cards) this.drawCard(c, camera, w, h, dpr, source);
  }

  private drawCard(c: Card, camera: THREE.Camera, w: number, h: number, dpr: number, source?: HTMLCanvasElement) {
    const alpha = clamp(c.opacity * c.owner.presence);
    if (alpha < 0.005) return;
    const ctx = this.ctx;
    const L = this.layout(c, camera, w, h, ctx);
    const { s, x, y, bw, bh, dark, outline } = L;
    const r = c.kind === "note" ? 14 * s : outline ? 7 * s : bh / 2;
    ctx.save();
    ctx.globalAlpha = alpha;

    // leader line from the anchor
    if (c.leader && c.anchor) {
      const ex = c.align === "right" ? x + bw : c.align === "center" ? x + bw / 2 : x;
      const ey = y + bh / 2;
      ctx.strokeStyle = outline ? this.rgba(this.ink, 0.35) : this.rgba(this.ink, 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.a.x, L.a.y);
      const mx = L.a.x + (ex - L.a.x) * 0.0;
      ctx.lineTo(mx, ey);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = c.accent ? this.accent : this.ink;
      ctx.beginPath();
      ctx.arc(L.a.x, L.a.y, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // body
    if (c.kind !== "label" || !outline) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      if (!outline && source) {
        // frosted glass: blur what is underneath
        ctx.save();
        ctx.clip();
        ctx.filter = `blur(${10 * s}px)`;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(source, 0, 0);
        ctx.restore();
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
      }
      if (dark) {
        ctx.fillStyle = c.accent ? this.rgba(this.accent, 0.86) : "rgba(128,130,138,0.62)";
        ctx.fill();
      } else if (outline) {
        ctx.fillStyle = c.accent ? this.rgba(this.accent, 0.08) : "rgba(255,255,255,0.78)";
        ctx.fill();
        ctx.strokeStyle = c.accent ? this.rgba(this.accent, 0.55) : this.rgba(this.ink, 0.16);
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.shadowColor = "rgba(20,24,40,0.10)";
        ctx.shadowBlur = 18 * s;
        ctx.shadowOffsetY = 6 * s;
        ctx.fillStyle = c.accent ? this.rgba(this.accent, 0.92) : "rgba(255,255,255,0.74)";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = c.accent ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    const fg = dark || c.accent && !outline ? "#ffffff" : outline && c.accent ? this.accent : this.ink;
    const cy = c.kind === "note" ? y + 14 * s + L.fs / 2 : y + bh / 2;
    let tx = x + L.padX;
    if (c.icon) {
      this.drawIcon(c.icon, tx, cy - L.icon / 2, L.icon, outline && !c.accent ? this.accent : fg, s);
      tx += L.icon + L.gap;
    }
    ctx.font = L.font;
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    if (L.mono) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${0.04 * L.fs}px`;
    ctx.fillText(L.shownTitle, tx, cy + 0.5);
    if (L.mono) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";

    if (c.progress >= 0) {
      const py = y + bh - 5 * s;
      ctx.fillStyle = dark ? "rgba(255,255,255,0.18)" : this.rgba(this.ink, 0.08);
      ctx.fillRect(x + L.padX, py, bw - L.padX * 2, 1.5 * s);
      ctx.fillStyle = dark ? "#fff" : this.accent;
      ctx.fillRect(x + L.padX, py, (bw - L.padX * 2) * clamp(c.progress), 1.5 * s);
    }

    if (c.kind === "note") {
      ctx.font = `400 ${13 * s}px ${this.fonts.font}`;
      let ly = cy + L.fs / 2 + 10 * s + L.lineH / 2;
      for (const ln of L.noteLines) {
        ctx.fillStyle = dark ? "rgba(255,255,255,0.92)" : this.rgba(this.ink, 0.82);
        ctx.fillText(ln.text, x + L.padX, ly);
        if (c.strike > 0 && ln.text) {
          const tw = ctx.measureText(ln.text).width * clamp(c.strike);
          ctx.fillStyle = dark ? "rgba(255,255,255,0.8)" : this.rgba(this.ink, 0.55);
          ctx.fillRect(x + L.padX, ly, tw, 1.2 * s);
        }
        ly += L.lineH;
      }
    }

    // meta row under pills ("Agent  Now"), as in the design
    if (c.meta || c.time) {
      ctx.font = `500 ${11.5 * s}px ${this.fonts.font}`;
      ctx.fillStyle = this.rgba(this.ink, 0.62);
      const my = y + bh + 12 * s;
      const mx = x + 14 * s;
      ctx.fillText(c.meta, mx, my);
      const mw = c.meta ? ctx.measureText(c.meta).width + 6 * s : 0;
      ctx.font = `400 ${11.5 * s}px ${this.fonts.font}`;
      ctx.fillStyle = this.rgba(this.ink, 0.38);
      ctx.fillText(c.time, mx + mw, my);
    }
    ctx.restore();
  }

  private drawIcon(name: IconName, x: number, y: number, size: number, color: string, s: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    const k = size / 24;
    if (name === "spinner") {
      // the dotted ring from the design, rotating
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.time * 2.4;
        const fadeI = ((i / n + this.time * 0.38) % 1);
        ctx.fillStyle = color;
        ctx.globalAlpha *= 1;
        ctx.beginPath();
        ctx.arc(12 * k + Math.cos(a) * 8 * k, 12 * k + Math.sin(a) * 8 * k, (1.1 + 1.1 * fadeI) * k * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (name === "dot") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(12 * k, 12 * k, 4 * k * (1 + 0.15 * Math.sin(this.time * 6)), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.scale(k, k);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(this.path(ICONS[name]));
    }
    ctx.restore();
    void s;
  }

  private rgba(hex: string, a: number) {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /** Current cards as an SVG document (editable text and shapes when pasted into Figma). */
  toSVG(camera: THREE.Camera, w: number, h: number) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}">${this.toSVGContent(camera, w, h)}</svg>`;
  }

  /** the cards' SVG elements without the <svg> wrapper */
  toSVGContent(camera: THREE.Camera, w: number, h: number) {
    const ctx = this.ctx;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const out: string[] = [];
    const fontFam = this.fonts.font.replace(/"/g, "'");
    const monoFam = this.fonts.mono.replace(/"/g, "'");
    for (const c of this.cards) {
      const alpha = clamp(c.opacity * c.owner.presence);
      if (alpha < 0.05) continue;
      ctx.save();
      const L = this.layout({ ...c, reveal: 1 }, camera, w, h, ctx);
      ctx.restore();
      const { x, y, bw, bh, s, dark, outline } = L;
      const r = c.kind === "note" ? 14 * s : outline ? 7 * s : bh / 2;
      const g: string[] = [];
      if (c.leader && c.anchor) {
        const ex = c.align === "right" ? x + bw : c.align === "center" ? x + bw / 2 : x;
        g.push(`<path d="M${L.a.x.toFixed(1)} ${L.a.y.toFixed(1)}V${(y + bh / 2).toFixed(1)}H${ex.toFixed(1)}" fill="none" stroke="${this.ink}" stroke-opacity="0.3"/>`);
        g.push(`<circle cx="${L.a.x.toFixed(1)}" cy="${L.a.y.toFixed(1)}" r="${2.5 * s}" fill="${c.accent ? this.accent : this.ink}"/>`);
      }
      const fill = dark ? (c.accent ? this.accent : "#80828A") : outline ? "#FFFFFF" : c.accent ? this.accent : "#FFFFFF";
      const fillOp = dark ? (c.accent ? 0.86 : 0.62) : outline ? 0.78 : c.accent ? 0.92 : 0.74;
      g.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${r.toFixed(1)}" fill="${fill}" fill-opacity="${fillOp}"${outline ? ` stroke="${c.accent ? this.accent : this.ink}" stroke-opacity="${c.accent ? 0.55 : 0.16}"` : ""}/>`);
      const fg = dark || (c.accent && !outline) ? "#FFFFFF" : outline && c.accent ? this.accent : this.ink;
      const cy = c.kind === "note" ? y + 14 * s + L.fs / 2 : y + bh / 2;
      let tx = x + L.padX;
      if (c.icon && c.icon !== "spinner" && c.icon !== "dot") {
        const k = L.icon / 24;
        g.push(`<path transform="translate(${tx.toFixed(1)} ${(cy - L.icon / 2).toFixed(1)}) scale(${k.toFixed(4)})" d="${ICONS[c.icon]}" fill="none" stroke="${outline && !c.accent ? this.accent : fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
      } else if (c.icon) {
        const k = L.icon / 24;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.push(`<circle cx="${(tx + 12 * k + Math.cos(a) * 8 * k).toFixed(1)}" cy="${(cy - L.icon / 2 + 12 * k + Math.sin(a) * 8 * k).toFixed(1)}" r="${(1.6 * k).toFixed(2)}" fill="${fg}"/>`);
        }
      }
      if (c.icon) tx += L.icon + L.gap;
      g.push(`<text x="${tx.toFixed(1)}" y="${cy.toFixed(1)}" dominant-baseline="central" font-family="${L.mono ? monoFam : fontFam}" font-size="${L.fs.toFixed(1)}" font-weight="${L.mono ? 500 : 450}" fill="${fg}">${esc(L.title)}</text>`);
      if (c.kind === "note") {
        let ly = cy + L.fs / 2 + 10 * s + L.lineH / 2;
        for (const ln of L.noteLines) {
          g.push(`<text x="${(x + L.padX).toFixed(1)}" y="${ly.toFixed(1)}" dominant-baseline="central" font-family="${fontFam}" font-size="${(13 * s).toFixed(1)}" fill="${dark ? "#FFFFFF" : this.ink}" fill-opacity="0.85"${c.strike > 0.5 ? ' text-decoration="line-through"' : ""}>${esc(ln.full)}</text>`);
          ly += L.lineH;
        }
      }
      if (c.meta || c.time) {
        const my = y + bh + 12 * s;
        g.push(`<text x="${(x + 14 * s).toFixed(1)}" y="${my.toFixed(1)}" dominant-baseline="central" font-family="${fontFam}" font-size="${(11.5 * s).toFixed(1)}" fill="${this.ink}"><tspan font-weight="500" fill-opacity="0.62">${esc(c.meta)}</tspan><tspan dx="6" fill-opacity="0.38">${esc(c.time)}</tspan></text>`);
      }
      out.push(`<g opacity="${alpha.toFixed(3)}">${g.join("")}</g>`);
    }
    return out.join("");
  }
}
