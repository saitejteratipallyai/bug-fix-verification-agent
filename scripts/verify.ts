#!/usr/bin/env ts-node

/**
 * Bug Fix Verification CLI
 *
 * Usage:
 *   npx ts-node scripts/verify.ts --bug "description of the bug" --files "src/A.tsx,src/B.tsx"
 *   npx ts-node scripts/verify.ts --bug "description" --ci
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

// ─── Argument Parsing ──────────────────────────────────────────────
interface CliArgs {
  bug: string;
  files: string[];
  ci: boolean;
  baseUrl: string;
  retries: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: CliArgs = {
    bug: '',
    files: [],
    ci: false,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    retries: 3,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--bug':
        parsed.bug = args[++i] || process.env.BUG_DESCRIPTION || '';
        break;
      case '--files':
        const fileStr = args[++i] || process.env.CHANGED_FILES || '';
        parsed.files = fileStr.split(',').map(f => f.trim()).filter(Boolean);
        break;
      case '--ci':
        parsed.ci = true;
        break;
      case '--base-url':
        parsed.baseUrl = args[++i];
        break;
      case '--retries':
        parsed.retries = parseInt(args[++i], 10);
        break;
    }
  }

  // Fallback to env vars
  if (!parsed.bug) {
    parsed.bug = process.env.BUG_DESCRIPTION || '';
  }
  if (parsed.files.length === 0 && process.env.CHANGED_FILES) {
    parsed.files = process.env.CHANGED_FILES.split(',').map(f => f.trim()).filter(Boolean);
  }

  return parsed;
}

// ─── Test Generation ──────────────────────────────────────────────
async function generateTest(
  client: Anthropic,
  bugDescription: string,
  changedFiles: string[],
  baseUrl: string
): Promise<string> {
  const workspaceRoot = process.cwd();

  // Read changed file contents
  const fileContents: string[] = [];
  for (const filePath of changedFiles) {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workspaceRoot, filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      fileContents.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  // Read test context if available
  let testContext = '';
  const contextPath = path.join(workspaceRoot, 'test-context.md');
  if (fs.existsSync(contextPath)) {
    testContext = `\n## App Context\n${fs.readFileSync(contextPath, 'utf-8')}\n`;
  }

  const prompt = `You are an expert QA engineer. Generate a Playwright test that verifies a bug fix.

## Bug Description
${bugDescription}

## Base URL
${baseUrl}

## Changed Files
${fileContents.join('\n\n')}
${testContext}
## Requirements
1. Write a complete Playwright test file using @playwright/test
2. Import { test, expect } from '@playwright/test'
3. Use descriptive test names referencing the bug
4. Navigate to the relevant page, interact, and assert the fix works
5. Use robust selectors: data-testid > role > text > CSS
6. Add waits for dynamic content
7. End with: await page.screenshot({ path: 'test-results/fix-verification.png' })

Output ONLY valid TypeScript code. No markdown fences. Start with import statements.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // Extract code
  const codeMatch = text.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1].trim() : (text.indexOf('import') >= 0 ? text.substring(text.indexOf('import')).trim() : text.trim());

  return code;
}

// ─── Self-Healing Regeneration ──────────────────────────────────
async function regenerateTest(
  client: Anthropic,
  bugDescription: string,
  previousTest: string,
  errorMessage: string
): Promise<string> {
  const prompt = `Fix this Playwright test that failed.

## Bug Description
${bugDescription}

## Failed Test
\`\`\`typescript
${previousTest}
\`\`\`

## Error
\`\`\`
${errorMessage}
\`\`\`

Fix the test. Output ONLY valid TypeScript code. No markdown fences.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const codeMatch = text.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : (text.indexOf('import') >= 0 ? text.substring(text.indexOf('import')).trim() : text.trim());
}

// ─── Visual Analysis ──────────────────────────────────────────────
async function analyzeScreenshot(
  client: Anthropic,
  screenshotPath: string,
  bugDescription: string
): Promise<any> {
  if (!fs.existsSync(screenshotPath)) {
    return null;
  }

  const imageData = fs.readFileSync(screenshotPath).toString('base64');

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: imageData },
        },
        {
          type: 'text',
          text: `Analyze this screenshot after a bug fix for: "${bugDescription}". Does the UI look correct? Respond as JSON: { "assessment": "...", "issues": [], "confidence": "high|medium|low", "fixApplied": true/false }`,
        },
      ],
    }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { assessment: text, issues: [], confidence: 'low' };
  } catch {
    return { assessment: text, issues: [], confidence: 'low' };
  }
}

// ─── Test Runner ──────────────────────────────────────────────────
function runPlaywright(testFile: string): Promise<{ passed: boolean; error: string; stdout: string }> {
  return new Promise(resolve => {
    const proc = spawn('npx', ['playwright', 'test', testFile, '--reporter=line'], {
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env, PLAYWRIGHT_VIDEO: 'on' },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('close', code => {
      resolve({
        passed: code === 0,
        error: stderr || stdout,
        stdout,
      });
    });
  });
}

// ─── Main ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.bug) {
    console.error('Error: --bug "description" is required');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Bug Fix Verification Agent             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Bug: ${args.bug}`);
  console.log(`Files: ${args.files.join(', ') || '(auto-detect)'}`);
  console.log(`Base URL: ${args.baseUrl}`);
  console.log('');

  // Auto-detect changed files if none provided
  if (args.files.length === 0) {
    try {
      const output = execSync('git diff --name-only HEAD', { encoding: 'utf-8' });
      args.files = output.split('\n').filter(Boolean);
      console.log(`Auto-detected ${args.files.length} changed files`);
    } catch {
      console.log('No git changes detected, proceeding without file context');
    }
  }

  // Ensure output dir exists
  const outputDir = path.join(process.cwd(), 'test-results');
  const generatedDir = path.join(process.cwd(), 'tests', 'generated');
  for (const dir of [outputDir, generatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Phase 1: Generate test
  console.log('\n📝 Generating test...');
  let testCode = await generateTest(client, args.bug, args.files, args.baseUrl);
  const testFile = path.join(generatedDir, 'fix-verification.spec.ts');
  fs.writeFileSync(testFile, testCode);
  console.log(`   Test written to: ${testFile}`);

  // Phase 2: Run with retries
  let passed = false;
  let lastError = '';

  for (let attempt = 1; attempt <= args.retries; attempt++) {
    console.log(`\n🏃 Running test (attempt ${attempt}/${args.retries})...`);
    const result = await runPlaywright(testFile);

    if (result.passed) {
      passed = true;
      console.log('\n✅ Test passed!');
      break;
    }

    lastError = result.error;
    console.log(`\n❌ Test failed (attempt ${attempt})`);

    if (attempt < args.retries) {
      console.log('🔧 Self-healing: regenerating test...');
      testCode = await regenerateTest(client, args.bug, testCode, lastError);
      fs.writeFileSync(testFile, testCode);
    }
  }

  // Phase 3: Visual analysis
  const screenshotPath = path.join(outputDir, 'fix-verification.png');
  let visualReport: any = null;

  if (fs.existsSync(screenshotPath)) {
    console.log('\n🔍 Analyzing screenshot with AI...');
    visualReport = await analyzeScreenshot(client, screenshotPath, args.bug);
    if (visualReport) {
      console.log(`   Assessment: ${visualReport.assessment}`);
      console.log(`   Confidence: ${visualReport.confidence}`);
      if (visualReport.issues?.length > 0) {
        console.log(`   Issues: ${visualReport.issues.join(', ')}`);
      }
    }

    // Save visual report
    const reportPath = path.join(outputDir, 'visual-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      bugDescription: args.bug,
      overallAssessment: visualReport?.assessment || 'No analysis available',
      ...visualReport,
    }, null, 2));
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║   Result: ${passed ? '✅ PASSED' : '❌ FAILED'}                        ║`);
  console.log('╚══════════════════════════════════════════╝');

  // Collect artifacts
  const videos = fs.readdirSync(outputDir).filter(f => f.endsWith('.webm') || f.endsWith('.mp4'));
  const screenshots = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));

  if (videos.length > 0) {
    console.log(`📹 Videos: ${videos.join(', ')}`);
  }
  if (screenshots.length > 0) {
    console.log(`📸 Screenshots: ${screenshots.join(', ')}`);
  }

  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
