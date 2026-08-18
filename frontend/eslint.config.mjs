import tseslint from 'typescript-eslint';

// Tailwind palette families that must never appear in source. Color reaches the
// DOM only through the custom properties defined in src/app/globals.css.
const PALETTE =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)';
const UTILITY =
  '(?:bg|text|border|divide|ring|ring-offset|from|to|via|fill|stroke|placeholder|outline|shadow|decoration|accent)';
const BANNED = new RegExp(
  `\\b(?:[a-z-]+:)*${UTILITY}-${PALETTE}(?:-(?:50|[1-9]00|950))?(?:/(?:\\[[^\\]]+\\]|\\d+))?\\b`,
);

const message =
  'Raw Tailwind palette color. Use a design token: bg-[var(--color-surface)], text-[var(--color-text-secondary)], etc. See DESIGN.md §2.';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'e2e/**', 'public/**', '*.mjs', '*.cjs', '*.js'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'off',
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=/${BANNED.source}/]`, message },
        { selector: `TemplateElement[value.raw=/${BANNED.source}/]`, message },
      ],
    },
  },
  {
    // DESIGN.md §5 "Login Exceptions" sanctions white-on-gradient values on the
    // auth aside, which sits outside the themed app shell.
    files: ['src/routes/LoginPage.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
