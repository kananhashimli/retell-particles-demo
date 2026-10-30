# Retell · Flow stage

An animated section for Retell: the Retell orb on an isometric floor, with particle scenes for
**Listen** (Denoising, Turn-taking), **Think** (Retell LLM, Conversation flow) and **Speak**
(Colloquial, Retell voices). Scenes play on their own and morph into one another; the tabs beside
the stage jump to any scene.

- `/` – the section as it will ship.
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

- `components/FlowSection.tsx` – the homepage section: stage, tabs and scene cards.
- `lib/stage/` – the stage engine (three.js). See `lib/stage/README.md` for how scenes are written.
- `lib/stage/directions/particles.ts` – the six particle scenes.
- `lib/stage/morph.ts` – the particle morph between scenes.
- `public/orb/delay.bin.gz` – the orb's motion field, loaded at runtime.

## Notes

- The stage pauses while it's off screen, and while the tab is in the background.
- Without WebGL the tabs and cards still work over the plain background; the canvas just stays empty.
