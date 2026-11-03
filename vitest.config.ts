import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/smoke/**'],
    setupFiles: ['test/setup/no-network.ts'],
    environment: 'node',
  },
});
