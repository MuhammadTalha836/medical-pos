import { defineConfig } from 'vitest/config';

// Unit tests for pure business logic (no database, no server). Integration suites live in server/tests/.
export default defineConfig({
  test: {
    include: ['server/**/*.spec.ts', 'src/**/*.spec.ts', 'shared/**/*.spec.ts'],
    environment: 'node'
  }
});
