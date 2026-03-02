import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentConfig {
  anthropicApiKey: string;
  baseUrl: string;
  devServerCommand: string;
  devServerPort: number;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  maxRetries: number;
  timeout: number;
  claudeModel: string;
  enableVisualAnalysis: boolean;
  videoResolution: { width: number; height: number };
  outputDir: string;
  workspaceRoot: string;
  codebaseContextFile: string;
}

/** Read a .env file and return key-value pairs */
function readDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) { continue; }
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          // Remove surrounding quotes
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          result[key] = value;
        }
      }
    }
  } catch {
    // Ignore .env read errors
  }
  return result;
}

export function getConfig(): AgentConfig {
  const config = vscode.workspace.getConfiguration('bugFixAgent');
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Try to load API key from multiple sources:
  // 1. VS Code extension settings
  // 2. process.env
  // 3. .env file in workspace root
  let apiKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    const dotEnv = readDotEnv(path.join(workspaceRoot, '.env'));
    apiKey = dotEnv['ANTHROPIC_API_KEY'] || '';
  }

  return {
    anthropicApiKey: apiKey,
    baseUrl: config.get<string>('baseUrl') || 'http://localhost:3000',
    devServerCommand: config.get<string>('devServerCommand') || 'npm run dev',
    devServerPort: config.get<number>('devServerPort') || 3000,
    browser: config.get<'chromium' | 'firefox' | 'webkit'>('browser') || 'chromium',
    headless: config.get<boolean>('headless') ?? true,
    maxRetries: config.get<number>('maxRetries') || 3,
    timeout: config.get<number>('timeout') || 30000,
    claudeModel: config.get<string>('claudeModel') || 'claude-sonnet-4-5-20250929',
    enableVisualAnalysis: config.get<boolean>('enableVisualAnalysis') ?? true,
    videoResolution: config.get<{ width: number; height: number }>('videoResolution') || { width: 1280, height: 720 },
    outputDir: config.get<string>('outputDir') || 'test-results',
    workspaceRoot,
    codebaseContextFile: config.get<string>('codebaseContextFile') || '',
  };
}

export function getOutputPath(config: AgentConfig): string {
  return path.resolve(config.workspaceRoot, config.outputDir);
}

export function getGeneratedTestPath(config: AgentConfig): string {
  return path.resolve(config.workspaceRoot, 'tests', 'generated');
}

export function validateConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  if (!config.anthropicApiKey) {
    errors.push('Anthropic API key is not set. Set it in extension settings or ANTHROPIC_API_KEY environment variable.');
  }

  if (!config.workspaceRoot) {
    errors.push('No workspace folder is open.');
  }

  return errors;
}
