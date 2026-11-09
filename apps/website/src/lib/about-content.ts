/**
 * The first-person prose rendered on /about.
 *
 * PROVENANCE: every biographical claim below is sourced from Brian Love's own
 * published writing at https://brianflove.com/about-me/ (retrieved 2026-08-24).
 * `PRINCIPLES` and `PERSONAL` are verbatim from that page; the rest is the same
 * material condensed, with no detail added.
 *
 * This page is what search engines read as an authorship and expertise signal,
 * which makes anything invented here both durable and machine-readable. Adding
 * a claim requires a citable source, not an inference — no years of experience,
 * employers, talks, awards, education, or clients that are not already public.
 *
 * The prose lives here rather than inline in the route so the spec can assert
 * that the page renders exactly these paragraphs and no others.
 */

export const ABOUT_INTRO =
  "I'm Brian Love, an agentic software architect building developer tooling for fullstack AI-powered web applications. Threadplane is the framework I build and maintain for agent UI in Angular and React: durable threads, interrupts, subagents, planning, memory, and generative UI.";

export const ABOUT_HISTORY_HEADING = 'How I got here';

export const ABOUT_HISTORY: readonly string[] = [
  'I started as an intern and then a web developer at Hamilton College, and became CTO of Webucator, an enterprise training company. I have worked remotely since 2010. In 2019 I founded LiveLoveApp to build an engineering culture around excellence and health — high standards and a sustainable pace at the same time.',
  'In 2022 Mike Ryan joined LiveLoveApp and we built Polaris, an AI-powered site reliability platform that detected outages and incidents in web applications in real time on a 7KB SDK. Polaris won a $25,000 early-stage investment from Portland Seed Fund at the 2023 Bend Venture Conference.',
  'I started building on the ChatGPT APIs when GPT-3.5 launched. From there I focused on integrating AI into web applications for financial firms — surfacing model output in complex UIs, handling sensitive structured data, and augmenting decisions rather than replacing them. I built RAG pipelines on Azure AI Search, indexing enterprise content from SharePoint into vector stores. That work taught me how retrieval actually behaves in production: the chunking tradeoffs, the reranking strategies, and how to keep answers grounded when the stakes are high.',
  'In 2025 Mike and I co-created Hashbrown, a framework for building fullstack agentic web applications with LLMs.',
] as const;

/** Verbatim from https://brianflove.com/about-me/. */
export const ABOUT_PRINCIPLES =
  'Most of my work lives where product strategy, frontend architecture, developer experience, and AI interaction design overlap. I care about software that is useful in production, understandable to the team, and honest about the tradeoffs.';

/** Verbatim from https://brianflove.com/about-me/, less the sentence naming the city. */
export const ABOUT_PERSONAL =
  'I live in Bend, Oregon with my wife Bonnie and our daughter Evelyn. I am a Christian, and that shapes how I think about ambition, responsibility, and the kind of work worth doing.';

/** Every paragraph the biography section renders, in order. */
export const ABOUT_PARAGRAPHS: readonly string[] = [
  ABOUT_INTRO,
  ...ABOUT_HISTORY,
  ABOUT_PRINCIPLES,
  ABOUT_PERSONAL,
] as const;
