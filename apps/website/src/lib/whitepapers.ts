import { FIELD_REPORT } from './field-report';

/** Stable URLs; public titles and download names describe the current edition. */
export const WHITEPAPERS = {
  overview: {
    title: FIELD_REPORT.title,
    subtitle: FIELD_REPORT.subtitle,
    pdf: 'whitepaper.pdf',
    html: 'whitepaper-preview.html',
    download: 'threadplane-prototype-to-production.pdf',
  },
  angular: {
    title: 'Connecting Agents to Applications',
    subtitle: 'Ownership, protocols and recovery across Angular and React.',
    pdf: 'whitepapers/angular.pdf',
    html: 'whitepapers/angular-preview.html',
    download: 'threadplane-connecting-agents.pdf',
  },
  render: {
    title: 'Generative Interfaces',
    subtitle:
      'Let agents describe the interface. Keep your application in control.',
    pdf: 'whitepapers/render.pdf',
    html: 'whitepapers/render-preview.html',
    download: 'threadplane-generative-interfaces.pdf',
  },
  chat: {
    title: 'Designing Agent Experiences',
    subtitle: 'Help people understand, control and recover agent work.',
    pdf: 'whitepapers/chat.pdf',
    html: 'whitepapers/chat-preview.html',
    download: 'threadplane-agent-experiences.pdf',
  },
} as const;
