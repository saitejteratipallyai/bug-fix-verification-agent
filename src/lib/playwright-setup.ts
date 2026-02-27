import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentConfig } from './config';

const PLAYWRIGHT_CONFIG_TEMPLATE = `import { defineConfig, devices } from '@playwright/test';

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
  webServer: undefined, // We manage the dev server ourselves
});
`;

export async function setupPlaywright(config: AgentConfig): Promise<void> {
  const terminal = vscode.window.createTerminal('Bug Fix Agent - Setup');
  terminal.show();

  // Check if Playwright is already installed
  const packageJsonPath = path.join(config.workspaceRoot, 'package.json');
  let hasPlaywright = false;

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    hasPlaywright = '@playwright/test' in allDeps;
  }

  if (!hasPlaywright) {
    terminal.sendText('npm install -D @playwright/test');
    await waitForTerminal(2000);
  }

  // Install browser binaries
  terminal.sendText('npx playwright install --with-deps chromium');
  await waitForTerminal(2000);

  // Generate playwright config
  await generatePlaywrightConfig(config);

  // Create test directories
  const generatedDir = path.join(config.workspaceRoot, 'tests', 'generated');
  const manualDir = path.join(config.workspaceRoot, 'tests', 'manual');
  const resultsDir = path.join(config.workspaceRoot, config.outputDir);

  for (const dir of [generatedDir, manualDir, resultsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create .gitignore for generated tests
  const gitignorePath = path.join(generatedDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*.spec.ts\n');
  }

  vscode.window.showInformationMessage('Playwright setup complete!');
}

export async function generatePlaywrightConfig(config: AgentConfig): Promise<void> {
  const configContent = PLAYWRIGHT_CONFIG_TEMPLATE
    .replace('{{BASE_URL}}', config.baseUrl)
    .replace('{{VIDEO_WIDTH}}', String(config.videoResolution.width))
    .replace('{{VIDEO_HEIGHT}}', String(config.videoResolution.height))
    .replace('{{TIMEOUT}}', String(config.timeout))
    .replace('{{BROWSER}}', config.browser);

  const configPath = path.join(config.workspaceRoot, 'playwright.config.ts');

  if (fs.existsSync(configPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      'playwright.config.ts already exists. Overwrite?',
      'Yes',
      'No'
    );
    if (overwrite !== 'Yes') {
      return;
    }
  }

  fs.writeFileSync(configPath, configContent);
}

export function isPlaywrightInstalled(workspaceRoot: string): boolean {
  const nodeModulesPath = path.join(workspaceRoot, 'node_modules', '@playwright', 'test');
  return fs.existsSync(nodeModulesPath);
}

function waitForTerminal(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
