import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 15000,
  },
})
