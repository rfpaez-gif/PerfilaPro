import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'netlify/functions/lib/render.js',
        'netlify/functions/lib/email-layout.js',
      ],
    },
  },
});
