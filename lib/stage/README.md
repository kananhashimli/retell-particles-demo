# Flow stage engine

An isometric room with the Retell orb standing in the middle. The **Line** direction defines six **scenes** (Denoising, Turn-taking, Retell LLM, Conversation flow, Colloquial, Retell voices) that animate objects, floor effects, cards and the orb's voice input around it.

```
stage.ts        renderer, iso camera, lights, scene crossfades, exports
orb.ts          the Iris orb shader as a depth-correct sphere impostor (needs /public/orb/delay.bin)
floor.ts        grid (lines / dots / crosses), contact shadow, orb light pool, ripples, tiles
cards.ts        2D card overlay (grey glass / white glass / outline), SVG export
kit.ts          fat lines, particles
config.ts       defaults + deep merge
directions/     line.ts · shared.ts (turn script, voices, helpers)
```

## Writing a scene

A scene is `{ duration, orb, create(ctx) }`. `create` builds objects into `ctx.group` and returns `update({ t, presence })`:

- `t` loops over `duration`, so make the end match the start (the loop exports depend on it).
- `presence` goes 0 → 1 on enter and 1 → 0 on exit; scale or fade by it.
- Every frame, request effects instead of owning them: `ctx.floor.ripple({...})`, `ctx.floor.tile({...})`, `ctx.floor.glow(v)`.
- Drive the orb: `ctx.orb.state`, `ctx.orb.listen`, `ctx.orb.speak`, `ctx.orb.bands`, `ctx.orb.tint`.
- Cards: `ctx.cards.add({ anchor, title, icon, meta, time, kind })`, then animate `opacity / dy / reveal / strike` (see `showBetween`, `typeBetween`).

Keep motion a pure function of `t` (use `speech(t)` and `hash()` rather than `Math.random()` per frame). PNG sequences and video loops then come out identical every time.

## Exports

`snapshot()`, `exportLayers()`, `cardsSVG()`, `exportSequence()`, `record()`. All are in the Export menu; `window.stage` is exposed for the console.
