import base from '../../../../eslint.config.mjs';
export default [
  ...base,
  {
    files: ['**/workspace-state.ts'],
    rules: {
      // This validator intentionally rejects control characters in filesystem paths.
      'no-control-regex': 'off',
    },
  },
];
