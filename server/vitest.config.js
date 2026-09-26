import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up test files inside pipeline/, routes/, and other server source.
    // Exclude the sample-bundle fixtures — they are test files for the synthetic
    // payment-service, not for the ReleaseGuard server itself.
    exclude: [
      'sample-bundles/**',
      'node_modules/**',
    ],
  },
});
