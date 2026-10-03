import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next 16 ships its rule sets as separate flat-config exports
// instead of one combined default (unlike the old `.eslintrc.json`, which got
// both from a single `extends: ["next/core-web-vitals", "next/typescript"]`).
// Composing `core-web-vitals` + `typescript` here reproduces that same pair,
// so the typescript-eslint recommended rules (no-explicit-any, no-unused-vars,
// etc.) keep running, not just the parser/plugin registration.
const eslintConfig = [
  {
    // .claude/worktrees holds agent checkouts in cloud sessions; linting them
    // multiplies the count (and nested configs clash).
    ignores: ['src/generated/**', '.claude/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // eslint-config-next 16's typescript.js downgrades this to 'warn';
      // the old .eslintrc.json (typescript-eslint's plain recommended, no
      // next override) enforced it as an error. Restored to match.
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],

      // New rules in eslint-config-next 16 that the old .eslintrc.json never
      // enforced (react-hooks@7's React Compiler-oriented rules, and a
      // stricter default for no-html-link-for-pages). Promoted to 'error'
      // once clean (ci-cd-github-actions ticket 18): these two have no
      // findings left. The other two still fire (16 set-state-in-effect, 2
      // purity) and stay 'warn' so they do not raise the lint ratchet; fixing
      // them component by component and promoting them is ticket 18b.
      'react-hooks/immutability': 'error',
      '@next/next/no-html-link-for-pages': 'error',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
];

export default eslintConfig;
