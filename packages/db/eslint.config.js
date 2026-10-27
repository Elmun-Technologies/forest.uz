import base from '@forest/config/eslint';
export default [...base, { files: ['src/seed/**'], rules: { 'no-console': 'off' } }];
