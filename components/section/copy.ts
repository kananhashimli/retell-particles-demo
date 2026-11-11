import type { HarnessPart } from "@/lib/stage/directions/harness";
import type { SceneId } from "@/lib/stage/types";

/** Section header, from the designer brief */
export const EYEBROW = "Retell vCX Agent Harness";
export const HEADLINE = "Purpose-built intelligence behind every conversation.";
export const DESCRIPTION =
  "Retell brings together specialized models for turn-taking, context retrieval, reasoning, and response control. One coordinated agent harness, engineered for the demands of real-time conversation.";

/** TODO: the Tell-1 evaluation link isn't supplied yet */
export const TELL1_EVAL_URL = "#tell-1-evaluation";
export const TELL1_CTA = "Explore the Tell-1 evaluation";

export interface CardCopy {
  title: string;
  text: string;
  /** icon in /public/icons/m */
  icon: string;
}

/** Model card copy, from the brief. The card for a scene is the scene's model. */
export const CARDS: Partial<Record<SceneId, CardCopy>> = {
  denoise: { title: "Denoising Model", text: "Reduces background noise so the agent can hear the caller clearly.", icon: "denoise" },
  turns: { title: "Turn-Taking Model", text: "Determines when to wait and when to respond.", icon: "turns" },
  ivr: { title: "Voicemail & IVR Detection", text: "Recognizes voicemail greetings and automated phone menus.", icon: "ivr" },
  llm: { title: "Tell-1", text: "Retell’s first LLM, built for instruction following, tool use, and conversational reasoning.", icon: "llm" },
  harness: {
    title: "Retell Agent Harness",
    text: "Coordinates context, tool execution, and conversation state across cascaded and speech-to-speech agents.",
    icon: "harness",
  },
  colloquial: { title: "Colloquial Rewrite Model", text: "Refines replies into natural spoken language.", icon: "colloquial" },
  guardrails: { title: "Response Guardrails", text: "Checks generated responses against configured constraints.", icon: "guardrails" },
};

/**
 * Speech-to-speech core model. The brief asks for "a speech-to-speech model option" but gives no copy:
 * placeholder until marketing supplies it.
 */
export const S2S_CORE: CardCopy = {
  title: "Speech-to-speech model",
  text: "Hears and replies in audio directly, with the agent harness supplying context, tools, and flow.",
  icon: "voices",
};
export const S2S_TELL1_NOTE = "Tell-1 is the text LLM option for cascaded agents.";
/** response controls aren't confirmed for speech-to-speech: shown, but not as active */
export const S2S_UNCONFIRMED = "Availability to confirm";

export const HARNESS_COPY: Record<HarnessPart, CardCopy> = {
  query: { title: "Query Refinement Model", text: "Turns conversation context into focused knowledge-base searches.", icon: "query" },
  retrieval: { title: "Knowledge Retrieval", text: "Finds relevant information and makes it available to the agent.", icon: "retrieval" },
  flow: { title: "Flow Transition Model", text: "Uses conversation context to select the next step in the workflow.", icon: "flow" },
};
/** optional technical detail, per the brief: Knowledge Matching and Retrieval stay one card */
export const RETRIEVAL_DETAIL = "Embedding model and vector retrieval";
