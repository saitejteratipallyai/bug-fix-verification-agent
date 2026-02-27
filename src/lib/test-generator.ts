import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig, getGeneratedTestPath } from './config';

export interface TestGenerationInput {
  bugDescription: string;
  changedFiles: string[];
  testContext?: string;
  baseUrl?: string;
}

export interface TestGenerationResult {
  testFilePath: string;
  testCode: string;
  testName: string;
}

export async function generateTest(
  config: AgentConfig,
  input: TestGenerationInput
): Promise<TestGenerationResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Read changed file contents
  const fileContents: { path: string; content: string }[] = [];
  for (const filePath of input.changedFiles) {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(config.workspaceRoot, filePath);
    if (fs.existsSync(fullPath)) {
      fileContents.push({
        path: filePath,
        content: fs.readFileSync(fullPath, 'utf-8'),
      });
    }
  }

  // Read test context if available
  let testContextContent = '';
  const testContextPath = path.join(config.workspaceRoot, 'test-context.md');
  if (fs.existsSync(testContextPath)) {
    testContextContent = fs.readFileSync(testContextPath, 'utf-8');
  }
  if (input.testContext) {
    testContextContent += '\n' + input.testContext;
  }

  const prompt = buildPrompt(input, fileContents, testContextContent, config);

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Extract code from response
  const testCode = extractCode(responseText);

  // Generate a safe filename
  const testName = generateTestName(input.bugDescription);
  const testDir = getGeneratedTestPath(config);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testFilePath = path.join(testDir, `${testName}.spec.ts`);

  // Write the test file
  fs.writeFileSync(testFilePath, testCode);

  return {
    testFilePath,
    testCode,
    testName,
  };
}

export async function regenerateTest(
  config: AgentConfig,
  input: TestGenerationInput,
  previousTest: string,
  errorMessage: string
): Promise<TestGenerationResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `You previously generated a Playwright test to verify a bug fix, but it failed.

## Bug Description
${input.bugDescription}

## Previous Test That Failed
\`\`\`typescript
${previousTest}
\`\`\`

## Error Message
\`\`\`
${errorMessage}
\`\`\`

## Instructions
Fix the test based on the error message. Common issues:
- Wrong selectors: use more robust selectors (data-testid, role, text content)
- Timing issues: add proper waits (waitForSelector, waitForNavigation)
- Wrong assertions: adjust based on actual page state
- Navigation issues: ensure correct URL/route

Output ONLY the corrected TypeScript Playwright test code. No explanation.`;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  const testCode = extractCode(responseText);
  const testName = generateTestName(input.bugDescription);
  const testDir = getGeneratedTestPath(config);
  const testFilePath = path.join(testDir, `${testName}.spec.ts`);

  fs.writeFileSync(testFilePath, testCode);

  return { testFilePath, testCode, testName };
}

function buildPrompt(
  input: TestGenerationInput,
  fileContents: { path: string; content: string }[],
  testContext: string,
  config: AgentConfig
): string {
  let prompt = `You are an expert QA engineer. Generate a Playwright test that verifies a bug fix in a React application.

## Bug Description
${input.bugDescription}

## Base URL
${input.baseUrl || config.baseUrl}

## Changed Files
`;

  for (const file of fileContents) {
    prompt += `\n### ${file.path}\n\`\`\`typescript\n${file.content}\n\`\`\`\n`;
  }

  if (testContext) {
    prompt += `\n## App Context\n${testContext}\n`;
  }

  prompt += `
## Requirements
1. Write a complete, runnable Playwright test file using @playwright/test
2. Import { test, expect } from '@playwright/test'
3. Use descriptive test names that reference the bug
4. Include these steps:
   - Navigate to the relevant page
   - Set up any required state (fill forms, click buttons, etc.)
   - Trigger the scenario that was bugged
   - Assert the correct behavior (the fix is working)
5. Use robust selectors in this priority order:
   - data-testid attributes
   - ARIA roles (getByRole)
   - Text content (getByText)
   - CSS selectors as last resort
6. Add appropriate waits:
   - Use page.waitForSelector() for dynamic content
   - Use expect(locator).toBeVisible() for visibility checks
   - Use page.waitForLoadState('networkidle') after navigation
7. Include error handling for common failure scenarios
8. Add a screenshot step at the end: await page.screenshot({ path: 'test-results/fix-verification.png' })

## Output
Output ONLY valid TypeScript Playwright test code. No explanation, no markdown fences, no comments before or after the code. Start with import statements.`;

  return prompt;
}

function extractCode(response: string): string {
  // Try to extract from code fences first
  const codeBlockMatch = response.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // If no code fences, check if response starts with import
  if (response.trim().startsWith('import')) {
    return response.trim();
  }

  // Try to find the first import statement and take everything from there
  const importIndex = response.indexOf('import');
  if (importIndex !== -1) {
    return response.substring(importIndex).trim();
  }

  // Return as-is and hope for the best
  return response.trim();
}

function generateTestName(bugDescription: string): string {
  return 'fix-verification-' + bugDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}
