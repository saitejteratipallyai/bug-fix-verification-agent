import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, execSync } from 'child_process';
import { AgentConfig, getOutputPath } from './config';

export interface TestResult {
  passed: boolean;
  videos: string[];
  screenshots: string[];
  traces: string[];
  errorMessage?: string;
  duration: number;
  stdout: string;
  stderr: string;
}

export interface RunnerOptions {
  testFilePath?: string;
  startServer?: boolean;
  onOutput?: (line: string) => void;
}

export async function runTests(
  config: AgentConfig,
  options: RunnerOptions = {}
): Promise<TestResult> {
  const startTime = Date.now();
  let serverProcess: ChildProcess | undefined;

  try {
    // Start dev server if requested
    if (options.startServer) {
      serverProcess = await startDevServer(config, options.onOutput);
    }

    // Run Playwright tests
    const result = await executePlaywright(config, options);

    // Collect artifacts
    const outputDir = getOutputPath(config);
    const videos = collectFiles(outputDir, ['.webm', '.mp4']);
    const screenshots = collectFiles(outputDir, ['.png', '.jpg', '.jpeg']);
    const traces = collectFiles(outputDir, ['.zip']);

    return {
      ...result,
      videos,
      screenshots,
      traces,
      duration: Date.now() - startTime,
    };
  } finally {
    // Kill dev server
    if (serverProcess?.pid) {
      killProcessTree(serverProcess.pid);
    }
  }
}

async function startDevServer(
  config: AgentConfig,
  onOutput?: (line: string) => void
): Promise<ChildProcess> {
  const [cmd, ...args] = config.devServerCommand.split(' ');

  const serverProcess = spawn(cmd, args, {
    cwd: config.workspaceRoot,
    shell: true,
    env: { ...process.env, BROWSER: 'none', PORT: String(config.devServerPort) },
    stdio: 'pipe',
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    onOutput?.(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    onOutput?.(`[server] ${data.toString().trim()}`);
  });

  // Wait for server to be ready
  await waitForServer(config.baseUrl, 30000, onOutput);

  return serverProcess;
}

async function waitForServer(
  url: string,
  timeoutMs: number,
  onOutput?: (line: string) => void
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const http = url.startsWith('https') ? await import('https') : await import('http');
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res: any) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`Server returned ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      onOutput?.(`Server is ready at ${url}`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Dev server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function executePlaywright(
  config: AgentConfig,
  options: RunnerOptions
): Promise<Pick<TestResult, 'passed' | 'stdout' | 'stderr' | 'errorMessage'>> {
  return new Promise((resolve) => {
    const args = ['playwright', 'test'];

    if (options.testFilePath) {
      args.push(options.testFilePath);
    } else {
      args.push('tests/generated/');
    }

    args.push('--reporter=json');

    if (config.headless) {
      // Playwright is headless by default
    } else {
      args.push('--headed');
    }

    const playwrightProcess = spawn('npx', args, {
      cwd: config.workspaceRoot,
      shell: true,
      env: {
        ...process.env,
        BASE_URL: config.baseUrl,
        PLAYWRIGHT_VIDEO: 'on',
      },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    playwrightProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onOutput?.(`[playwright] ${text.trim()}`);
    });

    playwrightProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onOutput?.(`[playwright] ${text.trim()}`);
    });

    playwrightProcess.on('close', (code) => {
      const passed = code === 0;
      let errorMessage: string | undefined;

      if (!passed) {
        // Try to extract error from JSON output
        try {
          const jsonResult = JSON.parse(stdout);
          const failedSuites = jsonResult.suites?.flatMap((s: any) =>
            s.specs?.filter((spec: any) => spec.ok === false) || []
          ) || [];

          if (failedSuites.length > 0) {
            errorMessage = failedSuites
              .map((spec: any) => {
                const result = spec.tests?.[0]?.results?.[0];
                return result?.error?.message || 'Unknown error';
              })
              .join('\n---\n');
          }
        } catch {
          errorMessage = stderr || stdout;
        }
      }

      resolve({ passed, stdout, stderr, errorMessage });
    });
  });
}

function collectFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      // Use tree-kill approach
      execSync(`kill -9 -${pid} 2>/dev/null || kill -9 ${pid}`, { stdio: 'ignore' });
    }
  } catch {
    // Process may have already exited
  }
}

export function cleanTestResults(config: AgentConfig): void {
  const outputDir = getOutputPath(config);
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
  }
}
