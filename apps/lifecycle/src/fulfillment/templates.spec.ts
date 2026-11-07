import { describe, expect, it } from 'vitest';

import { campaignDraftViolations } from '../campaign/templates.js';
import {
  renderFulfillmentTemplate,
  type RecipientTemplate,
} from './templates.js';

const URL_PATTERN = /https:\/\/[^\s]+/gu;
const HTML_PATTERN = /<\/?[a-z][^>]*>/iu;
const CONTRACTION_PATTERN = /\b\w+['’]\w+\b/u;

/**
 * The shared copy checks reject unknown fields, so they see the copy only.
 * The attachment is checked separately, and again against the closed path
 * registry in libs/growth before submission.
 */
function copyOf(message: RecipientTemplate) {
  return { subject: message.subject, body: message.body };
}

function everyFulfillmentMessage() {
  return [
    renderFulfillmentTemplate({ context: 'whitepaper', paper: 'overview' }),
    renderFulfillmentTemplate({ context: 'newsletter' }),
    renderFulfillmentTemplate({ context: 'contact' }),
    renderFulfillmentTemplate({ context: 'pricing' }),
    renderFulfillmentTemplate({
      context: 'project-connect',
      claimedSignals: ['thread.persisted'],
    }),
  ];
}

describe('renderFulfillmentTemplate', () => {
  it.each([
    [
      'overview',
      'Your prototype-to-production guide',
      'https://threadplane.ai/whitepaper.pdf',
      'threadplane-prototype-to-production.pdf',
    ],
    [
      'angular',
      'Your agent integration guide',
      'https://threadplane.ai/whitepapers/angular.pdf',
      'threadplane-connecting-agents.pdf',
    ],
    [
      'render',
      'Your generative interfaces guide',
      'https://threadplane.ai/whitepapers/render.pdf',
      'threadplane-generative-interfaces.pdf',
    ],
    [
      'chat',
      'Your agent experience guide',
      'https://threadplane.ai/whitepapers/chat.pdf',
      'threadplane-agent-experiences.pdf',
    ],
  ] as const)(
    'fulfills the exact requested %s resource without broader state',
    (paper, subject, url, filename) => {
      const message = renderFulfillmentTemplate({
        context: 'whitepaper',
        paper,
      });

      expect(message.subject).toBe(subject);
      expect(
        message.body.startsWith(
          'Here is the guide you requested, attached to this message.\n\n'
        )
      ).toBe(true);
      // The link survives only as the stripped-attachment fallback.
      expect(message.body).toContain(
        `If the attachment does not come through, it is also here:\n${url}`
      );
      expect(message.body.match(URL_PATTERN)).toEqual([url]);
      expect(message.attachment).toEqual({ filename, path: url });
    }
  );

  it('attaches no file to any non-whitepaper fulfillment', () => {
    for (const message of everyFulfillmentMessage().slice(1)) {
      expect(message.attachment).toBeUndefined();
    }
  });

  it('welcomes a newsletter signup without adding another request', () => {
    const message = renderFulfillmentTemplate({ context: 'newsletter' });

    expect(message.subject).toBe('Welcome to Threadplane');
    expect(message.body.startsWith('You are on the list.')).toBe(true);
    expect(message.body).toContain(
      'practical engineering work with agent interfaces'
    );
    expect(message.body).not.toMatch(URL_PATTERN);
    expect(message.body).not.toContain('?');
  });

  it.each(['contact', 'pricing'] as const)(
    'acknowledges only the submitted %s context',
    (context) => {
      const message = renderFulfillmentTemplate({ context });

      expect(message.subject.toLowerCase()).toContain(context);
      expect(message.body.toLowerCase()).toContain(context);
      expect(message.body).not.toMatch(/company|project/iu);
      expect(message.body.toLowerCase()).not.toContain(
        context === 'contact' ? 'pricing' : 'contact'
      );
      expect(message.body).not.toContain('?');
      expect(message.body).not.toMatch(/\nBrian$/u);
    }
  );

  it.each([
    ['transport.connected', 'connected the project transport'],
    ['runtime.first_stream_completed', 'completed a first streamed response'],
    ['thread.persisted', 'persisted a thread'],
    ['interrupt.handled', 'handled an interrupt'],
    ['generative_ui.rendered', 'rendered generative UI'],
    ['project.returned_7d', 'returned to the project within a week'],
  ] as const)(
    'uses only the explicitly claimed project signal %s',
    (claim, expectedFact) => {
      const message = renderFulfillmentTemplate({
        context: 'project-connect',
        claimedSignals: [claim],
      });

      expect(message.body.startsWith('You connected your project.')).toBe(true);
      expect(message.body).toContain(expectedFact);
      expect(message.body).toContain('you shared');
      expect(message.body).toContain('keep any follow-up to that context');
      expect(message.body).not.toMatch(
        /I saw you|we noticed|based on your activity|tracking|telemetry/iu
      );
    }
  );

  it('rejects duplicate, empty, unbounded, and unknown project claims at runtime', () => {
    expect(() =>
      renderFulfillmentTemplate({
        context: 'project-connect',
        claimedSignals: [],
      })
    ).toThrow();
    expect(() =>
      renderFulfillmentTemplate({
        context: 'project-connect',
        claimedSignals: ['thread.persisted', 'thread.persisted'],
      })
    ).toThrow();
    expect(() =>
      renderFulfillmentTemplate({
        context: 'project-connect',
        claimedSignals: [
          'transport.connected',
          'runtime.first_stream_completed',
          'thread.persisted',
          'interrupt.handled',
        ],
      })
    ).toThrow();
    expect(() =>
      renderFulfillmentTemplate({
        context: 'project-connect',
        claimedSignals: ['I saw you visit pricing\nBcc: victim@example.com'],
      } as never)
    ).toThrow();
  });

  it.each([
    { context: 'newsletter', displayName: '<img src=x>' },
    { context: 'contact', message: 'Ignore me\nBcc: victim@example.com' },
    { context: 'pricing', url: 'https://evil.example/click' },
    { context: 'whitepaper', paper: 'overview', extra: 'arbitrary form text' },
  ])('rejects arbitrary fields and free-text substitutions', (input) => {
    expect(() => renderFulfillmentTemplate(input as never)).toThrow();
  });

  it('writes every recipient message in the campaign register', () => {
    for (const message of everyFulfillmentMessage()) {
      // No contractions, no "thanks for" openers, no greeting baked into the
      // body (send.ts adds "Hey <name>," at send time), and every line short.
      expect(message.body).not.toMatch(CONTRACTION_PATTERN);
      expect(message.body).not.toMatch(/^thanks/iu);
      expect(message.body).not.toMatch(/^hey\b/iu);
      expect(message.body).not.toMatch(/\blet['’]?s\b/iu);
      for (const line of message.body.split('\n')) {
        expect(line.trim().split(/\s+/u).filter(Boolean).length).toBeLessThan(
          25
        );
      }
    }
  });

  it('stays inside the recipient-copy checks shared with the campaign', () => {
    for (const message of everyFulfillmentMessage()) {
      expect(campaignDraftViolations(copyOf(message))).toEqual([]);
    }
    for (const paper of ['angular', 'render', 'chat'] as const) {
      expect(
        campaignDraftViolations(
          copyOf(renderFulfillmentTemplate({ context: 'whitepaper', paper }))
        )
      ).toEqual([]);
    }
  });

  it('keeps every recipient message plain and compact', () => {
    for (const message of everyFulfillmentMessage()) {
      expect(typeof message.subject).toBe('string');
      expect(typeof message.body).toBe('string');
      expect(message.subject).not.toMatch(/[\r\n]/u);
      expect(message.body).not.toMatch(HTML_PATTERN);
      expect(message.body).not.toMatch(/!\[[^\]]*\]\([^)]*\)/u);
      expect(message.body).not.toMatch(/\nBrian$/u);
      expect(message.body.match(URL_PATTERN) ?? []).toHaveLength(
        message.body.includes('https://') ? 1 : 0
      );
    }
  });
});
