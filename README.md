# Retell · Flow stage

An animated section for Retell's vCX Agent Harness: the Retell orb on an isometric floor, with a
particle scene per model in three capability groups —
**Speech perception** (Denoising, Turn-taking, Voicemail & IVR detection), **Reasoning & orchestration**
(Tell-1, Retell Agent Harness) and **Response generation** (Colloquial rewrite, Response guardrails).
Scenes play on their own and morph into one another. The groups sit on the right; the models of the
open group are tabs along the top of the stage, and the model cards on the left of the stage show
every group (the open one with descriptions, the others muted). A Cascaded / Speech-to-speech toggle
switches the core model and marks the response controls as unconfirmed for speech-to-speech. Under
speech-to-speech (duplex) the groups become two: **Semantic perception & generation** (Conversation dynamics,
Emotion and meaning, Expressive speech) and **Reasoning & orchestration** (Reasoning model, Agent harness).

- `/` – the section as it will ship: scenes play on their own.
- `/scroll` – the same section driven by scrolling: it stays on screen while the page scrolls past,
  scroll position picks the scene, and the tabs scroll the page to their scene.
- `/dev` – the lab: every setting of the stage, scene and transition, plus exports for Figma
  (SVG, layered PNGs, PNG sequences, video loops).

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

It's a standard Next.js app, so it deploys as-is to Vercel or any Node host. Both pages are
prerendered static content.

## Tuning the look

Open `/dev` while running `npm run dev`, adjust the panel, then **Save defaults · homepage**. That
writes `lib/stage/defaults/<direction>.json`, which the homepage loads. Saving only works in
development; in a production build the button reports that it's disabled.

## Where things are

- `components/FlowSection.tsx` – the homepage section: header, architecture toggle, stage and groups.
- `components/section/` – the model cards (`ModelCards.tsx`, with connectors to the orb), the stage's tab bar (`SceneTabs.tsx`) and all copy (`copy.ts`).
- `lib/stage/directions/harness.ts` – when each harness component is called; the scene and its cards both read it.
- `components/ScrollSection.tsx` – the scroll-driven version on `/scroll`.
- `components/useFlowStage.tsx` – the stage setup both share (phone framing, fade-in, scene state).
- `lib/stage/` – the stage engine (three.js). See `lib/stage/README.md` for how scenes are written.
- `lib/stage/directions/particles.ts` – the particle scenes.
- `lib/stage/morph.ts` – the particle morph between scenes.
- `lib/stage/orb.ts` – the orb shader and its two styles. `components/StylePicker.tsx` is the Style 1 / Style 2
  picker on every page; the choice is remembered in the browser.

## Notes

- The stage pauses while it's off screen, and while the tab is in the background.
- Without WebGL the tabs and cards still work over the plain background; the canvas just stays empty.
