import * as vscode from 'vscode';
import * as path from 'path';

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

export function getConfig(): AgentConfig {
  const config = vscode.workspace.getConfiguration('bugFixAgent');
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  const apiKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';

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
