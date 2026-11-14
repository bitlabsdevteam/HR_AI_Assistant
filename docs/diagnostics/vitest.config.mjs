import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['verification-balance.diagnostic.test.ts'], environment: 'node' },
};
