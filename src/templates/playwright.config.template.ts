export const PLAYWRIGHT_CONFIG = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/generated',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || '{{BASE_URL}}',
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    viewport: { width: {{VIDEO_WIDTH}}, height: {{VIDEO_HEIGHT}} },
    actionTimeout: {{TIMEOUT}},
  },
  outputDir: './test-results',
  projects: [
    {
      name: '{{BROWSER}}',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;
