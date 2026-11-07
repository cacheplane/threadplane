import { z } from 'zod';

const ProjectSignalSchema = z.enum([
  'transport.connected',
  'runtime.first_stream_completed',
  'thread.persisted',
  'interrupt.handled',
  'generative_ui.rendered',
  'project.returned_7d',
]);

const FulfillmentTemplateInputSchema = z.discriminatedUnion('context', [
  z
    .object({
      context: z.literal('whitepaper'),
      paper: z.enum(['overview', 'angular', 'render', 'chat']),
    })
    .strict(),
  z.object({ context: z.literal('newsletter') }).strict(),
  z.object({ context: z.literal('contact') }).strict(),
  z.object({ context: z.literal('pricing') }).strict(),
  z
    .object({
      context: z.literal('project-connect'),
      claimedSignals: z
        .array(ProjectSignalSchema)
        .min(1)
        .max(3)
        .refine((signals) => new Set(signals).size === signals.length, {
          message: 'claimedSignals must be unique',
        }),
    })
    .strict(),
]);

export type FulfillmentTemplateInput = z.infer<
  typeof FulfillmentTemplateInputSchema
>;

/**
 * A file the recipient message carries. `path` is the public URL Resend
 * fetches the bytes from at send time, so the attachment is always the
 * currently deployed PDF; `filename` is what the recipient sees. Both are
 * re-checked against a closed registry in libs/growth before submission.
 */
export interface RecipientAttachment {
  readonly filename: string;
  readonly path: string;
}

export interface RecipientTemplate {
  readonly subject: string;
  readonly body: string;
  /** Set only by the whitepaper context; every other context sends no file. */
  readonly attachment?: RecipientAttachment;
}

/**
 * The filenames match the ones apps/website WhitePaperForm.tsx puts on the
 * on-page download, so the attachment and the direct download are the same
 * name to a contact who takes both.
 */
const WHITEPAPERS = {
  overview: {
    subject: 'Your prototype-to-production guide',
    url: 'https://threadplane.ai/whitepaper.pdf',
    filename: 'threadplane-prototype-to-production.pdf',
  },
  angular: {
    subject: 'Your agent integration guide',
    url: 'https://threadplane.ai/whitepapers/angular.pdf',
    filename: 'threadplane-connecting-agents.pdf',
  },
  render: {
    subject: 'Your generative interfaces guide',
    url: 'https://threadplane.ai/whitepapers/render.pdf',
    filename: 'threadplane-generative-interfaces.pdf',
  },
  chat: {
    subject: 'Your agent experience guide',
    url: 'https://threadplane.ai/whitepapers/chat.pdf',
    filename: 'threadplane-agent-experiences.pdf',
  },
} as const;

const PROJECT_FACTS: Record<z.infer<typeof ProjectSignalSchema>, string> = {
  'transport.connected': 'connected the project transport',
  'runtime.first_stream_completed': 'completed a first streamed response',
  'thread.persisted': 'persisted a thread',
  'interrupt.handled': 'handled an interrupt',
  'generative_ui.rendered': 'rendered generative UI',
  'project.returned_7d': 'returned to the project within a week',
};

/**
 * Recipient copy in Brian's register: no contractions, no "thanks for"
 * openers, one thought per line, no marketing tone. The "Hey <name>,"
 * greeting is added at send time; every body here stays inside the
 * recipient-copy checks in campaign/templates.ts.
 */
export function renderFulfillmentTemplate(
  candidate: unknown
): RecipientTemplate {
  const input = FulfillmentTemplateInputSchema.parse(candidate);

  switch (input.context) {
    case 'whitepaper': {
      const paper = WHITEPAPERS[input.paper];
      // The guide rides along as an attachment. The link stays as a fallback
      // for mail gateways that strip attachments from an unfamiliar sender.
      return {
        subject: paper.subject,
        body: `Here is the guide you requested, attached to this message.\n\nIf the attachment does not come through, it is also here:\n${paper.url}\n\nRead it when you have a quiet hour.\nIf something in it does not hold up in your own code, reply and tell me.`,
        attachment: { filename: paper.filename, path: paper.url },
      };
    }
    case 'newsletter':
      return {
        subject: 'Welcome to Threadplane',
        body: 'You are on the list.\n\nI write these notes about practical engineering work with agent interfaces.\nStreaming, state, interrupts, and the boundaries that make them testable.\nNo hype.\n\nIf one of them misses the mark, reply and tell me.',
      };
    case 'contact':
      return {
        subject: 'Your contact request',
        body: 'I have your contact request.\nI will read it and reply myself.',
      };
    case 'pricing':
      return {
        subject: 'Your pricing request',
        body: 'I have your pricing request.\nI will read it and reply myself.',
      };
    case 'project-connect': {
      const facts = input.claimedSignals.map((signal) => PROJECT_FACTS[signal]);
      const joinedFacts =
        facts.length === 1
          ? facts[0]
          : `${facts.slice(0, -1).join(', ')}, and ${facts.at(-1)}`;
      return {
        subject: 'Your connected Threadplane project',
        body: `You connected your project.\nIn that connection, you shared that you ${joinedFacts}.\n\nI will keep any follow-up to that context.\nNothing else.`,
      };
    }
  }
}
