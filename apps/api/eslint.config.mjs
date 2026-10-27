import base from '@forest/config/eslint';
// Nest DI needs runtime class imports for decorator metadata; inline type-only imports would drop them.
export default [...base, { rules: { '@typescript-eslint/consistent-type-imports': 'off' } }];
