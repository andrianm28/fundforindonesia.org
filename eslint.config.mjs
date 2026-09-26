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
    ignores: ['src/generated/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // eslint-config-next 16's typescript.js downgrades this to 'warn';
      // the old .eslintrc.json (typescript-eslint's plain recommended, no
      // next override) enforced it as an error. Restored to match.
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],

      // New rules in eslint-config-next 16 that were not enforced by the
      // old .eslintrc.json at all (react-hooks@7's React Compiler-oriented
      // rules, and a stricter default for no-html-link-for-pages). Left as
      // warnings rather than dropped, since they push the lint ratchet
      // above its 194 baseline; turning them into errors deliberately is
      // ci-cd-github-actions ticket 18.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
    },
  },
];

export default eslintConfig;
