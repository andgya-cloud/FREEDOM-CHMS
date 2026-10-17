import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rules tests share one emulator, so files run one after another.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'rules',
          include: ['tests/rules/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20000,
        },
      },
    ],
  },
});
