import base from '../../../../eslint.config.mjs';
export default [
  ...base,
  {
    files: ['cockpit/deep-agents/skills/react/src/index-projection.ts'],
    // The virtual-path contract intentionally rejects NUL and control characters.
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['cockpit/deep-agents/skills/react/src/read-projection.ts'],
    // The pinned Deep Agents read formatter uses a literal two-space gutter.
    rules: { 'no-regex-spaces': 'off' },
  },
];
