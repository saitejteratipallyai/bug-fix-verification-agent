import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig } from './config';

// ─── Interfaces ─────────────────────────────────────────────────

export interface CodebaseContext {
  content: string;
  filePath: string;
}

export interface RelevantFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  reason: string;
}

export interface FileChange {
  filePath: string;
  relativePath: string;
  originalContent: string;
  modifiedContent: string;
  diff: string;
}

export interface FixResult {
  changes: FileChange[];
  explanation: string;
  approach: string;
}

export interface FixBackup {
  timestamp: number;
  files: Array<{
    filePath: string;
    originalContent: string;
  }>;
}

// ─── Read Codebase Context ──────────────────────────────────────

export async function readCodebaseContext(config: AgentConfig): Promise<CodebaseContext | null> {
  const candidates = [
    config.codebaseContextFile
      ? path.resolve(config.workspaceRoot, config.codebaseContextFile)
      : null,
    path.join(config.workspaceRoot, 'codebase-context.md'),
    path.join(config.workspaceRoot, 'test-context.md'),
    path.join(config.workspaceRoot, 'ARCHITECTURE.md'),
    path.join(config.workspaceRoot, 'docs', 'architecture.md'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        content: fs.readFileSync(candidate, 'utf-8'),
        filePath: candidate,
      };
    }
  }
  return null;
}

// ─── Build File Tree ────────────────────────────────────────────

function buildFileTree(workspaceRoot: string, maxDepth: number = 4): string {
  const excludeDirs = new Set([
    'node_modules', '.git', 'dist', 'out', 'build', 'test-results',
    '.next', 'coverage', '.cache', '.turbo', '.vercel',
  ]);
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) { return; }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const filtered = entries
      .filter(e => !excludeDirs.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) { return -1; }
        if (!a.isDirectory() && b.isDirectory()) { return 1; }
        return a.name.localeCompare(b.name);
      });

    for (const entry of filtered) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  }

  walk(workspaceRoot, '', 0);
  return lines.join('\n');
}

// ─── Analyze Relevant Files ────────────────────────────────────

export async function analyzeRelevantFiles(
  config: AgentConfig,
  bugDescription: string,
  codebaseContext: CodebaseContext | null,
  hintFiles?: string[]
): Promise<RelevantFile[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const relevantFiles: RelevantFile[] = [];

  // Start with user-provided hint files
  if (hintFiles && hintFiles.length > 0) {
    for (const filePath of hintFiles) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(config.workspaceRoot, filePath);
      if (fs.existsSync(absolutePath)) {
        relevantFiles.push({
          relativePath: path.relative(config.workspaceRoot, absolutePath),
          absolutePath,
          content: fs.readFileSync(absolutePath, 'utf-8'),
          reason: 'User-specified file',
        });
      }
    }
  }

  // Build file tree and ask Claude which files are relevant
  const fileTree = buildFileTree(config.workspaceRoot);

  const prompt = `You are an expert software engineer. Given a bug description and a project's file structure, identify which source files are most likely to contain the bug or need modification to fix it.

## Bug Description
${bugDescription}

## Project Context
${codebaseContext?.content || 'No context file available.'}

## File Tree
${fileTree}

## Already Identified Files
${relevantFiles.map(f => `- ${f.relativePath}: ${f.reason}`).join('\n') || 'None'}

## Instructions
Return a JSON array of the most relevant files (up to 10) that likely need to be read or modified to fix this bug. Format:
[
  { "path": "src/components/Counter.tsx", "reason": "Contains the counter component mentioned in the bug" }
]

Focus on source files (.ts, .tsx, .js, .jsx, .html, .css, .vue, .svelte, etc.).
Exclude test files, config files, and node_modules.
Output ONLY the JSON array. No explanation.`;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Parse Claude's response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const suggestedFiles: Array<{ path: string; reason: string }> = JSON.parse(jsonMatch[0]);
      for (const suggested of suggestedFiles) {
        const absolutePath = path.resolve(config.workspaceRoot, suggested.path);
        if (
          fs.existsSync(absolutePath) &&
          !relevantFiles.some(f => f.absolutePath === absolutePath)
        ) {
          const content = fs.readFileSync(absolutePath, 'utf-8');
          // Skip files larger than 50KB
          if (content.length <= 50000) {
            relevantFiles.push({
              relativePath: suggested.path,
              absolutePath,
              content,
              reason: suggested.reason,
            });
          }
        }
      }
    } catch {
      // If parsing fails, proceed with what we have
    }
  }

  return relevantFiles;
}

// ─── Generate Fix ──────────────────────────────────────────────

export async function generateFix(
  config: AgentConfig,
  bugDescription: string,
  relevantFiles: RelevantFile[],
  codebaseContext: CodebaseContext | null,
  previousAttempt?: { fix: FixResult; verificationError: string }
): Promise<FixResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  let prompt: string;

  if (previousAttempt) {
    prompt = `You are an expert software engineer tasked with fixing a bug. Your previous fix attempt FAILED verification. Try a DIFFERENT approach.

## Bug Description
${bugDescription}

## Codebase Context
${codebaseContext?.content || 'No additional context available.'}

## Relevant Source Files
${relevantFiles.map(f => `### ${f.relativePath}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

## Previous Fix Attempt (FAILED)
### Approach
${previousAttempt.fix.approach}

### Explanation
${previousAttempt.fix.explanation}

### Changes Made
${previousAttempt.fix.changes.map(c => `#### ${c.relativePath}\n\`\`\`diff\n${c.diff}\n\`\`\``).join('\n\n')}

### Verification Error
\`\`\`
${previousAttempt.verificationError}
\`\`\`

## Instructions
The previous fix attempt failed verification. Analyze the error and try a DIFFERENT approach.
Do NOT repeat the same fix. Consider:
- The error may indicate the fix was incomplete or introduced a new issue
- The test may have revealed an edge case the previous fix didn't handle
- The root cause analysis may have been wrong — reconsider from scratch

## Output Format
Respond with a JSON object:
{
  "explanation": "Detailed explanation of the root cause and the fix",
  "approach": "One-sentence summary of the fix approach",
  "changes": [
    {
      "filePath": "relative/path/to/file.ts",
      "modifiedContent": "...entire file content with fix applied..."
    }
  ]
}

IMPORTANT: The "modifiedContent" must contain the COMPLETE file content (not just the changed lines).
Output ONLY the JSON object.`;
  } else {
    prompt = `You are an expert software engineer tasked with fixing a bug. Analyze the code and produce a minimal, targeted fix.

## Bug Description
${bugDescription}

## Codebase Context
${codebaseContext?.content || 'No additional context available.'}

## Relevant Source Files
${relevantFiles.map(f => `### ${f.relativePath}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

## Instructions
1. Analyze the bug description and source code to understand the root cause
2. Produce the MINIMAL set of changes needed to fix the bug
3. Do NOT refactor unrelated code
4. Preserve existing code style and conventions

## Output Format
Respond with a JSON object:
{
  "explanation": "Detailed explanation of the root cause and the fix",
  "approach": "One-sentence summary of the fix approach",
  "changes": [
    {
      "filePath": "relative/path/to/file.ts",
      "modifiedContent": "...entire file content with fix applied..."
    }
  ]
}

IMPORTANT: The "modifiedContent" must contain the COMPLETE file content (not just the changed lines).
This will be written directly to the file. Output ONLY the JSON object.`;
  }

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return parseFixResponse(responseText, relevantFiles, config.workspaceRoot);
}

// ─── Parse Fix Response ────────────────────────────────────────

function parseFixResponse(
  responseText: string,
  relevantFiles: RelevantFile[],
  workspaceRoot: string
): FixResult {
  // Extract JSON from response (handle code fences)
  let jsonText = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  } else {
    const objMatch = responseText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      jsonText = objMatch[0];
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse fix response as JSON: ${responseText.substring(0, 200)}...`);
  }

  if (!parsed.changes || !Array.isArray(parsed.changes)) {
    throw new Error('Fix response missing "changes" array');
  }

  const changes: FileChange[] = parsed.changes.map((change: any) => {
    const relativePath = change.filePath;
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const originalFile = relevantFiles.find(f => f.relativePath === relativePath);
    const originalContent = originalFile?.content || (
      fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : ''
    );
    const modifiedContent = change.modifiedContent;

    return {
      filePath: absolutePath,
      relativePath,
      originalContent,
      modifiedContent,
      diff: generateSimpleDiff(relativePath, originalContent, modifiedContent),
    };
  });

  return {
    changes,
    explanation: parsed.explanation || 'No explanation provided',
    approach: parsed.approach || 'No approach summary provided',
  };
}

// ─── Simple Diff Generator ─────────────────────────────────────

function generateSimpleDiff(fileName: string, original: string, modified: string): string {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const diffLines: string[] = [];

  diffLines.push(`--- a/${fileName}`);
  diffLines.push(`+++ b/${fileName}`);

  const maxLen = Math.max(origLines.length, modLines.length);
  let inHunk = false;
  let hunkStart = -1;
  const hunkLines: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const modLine = i < modLines.length ? modLines[i] : undefined;

    if (origLine === modLine) {
      if (inHunk) {
        hunkLines.push(` ${origLine}`);
        // End hunk after 3 context lines
        if (hunkLines.filter(l => l.startsWith(' ')).length >= 3) {
          diffLines.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
          diffLines.push(...hunkLines);
          hunkLines.length = 0;
          inHunk = false;
        }
      }
    } else {
      if (!inHunk) {
        inHunk = true;
        hunkStart = Math.max(0, i - 1);
        // Add 1 line of context before
        if (i > 0) {
          hunkLines.push(` ${origLines[i - 1]}`);
        }
      }
      if (origLine !== undefined && modLine !== undefined) {
        hunkLines.push(`-${origLine}`);
        hunkLines.push(`+${modLine}`);
      } else if (origLine !== undefined) {
        hunkLines.push(`-${origLine}`);
      } else if (modLine !== undefined) {
        hunkLines.push(`+${modLine}`);
      }
    }
  }

  // Flush remaining hunk
  if (hunkLines.length > 0) {
    diffLines.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
    diffLines.push(...hunkLines);
  }

  return diffLines.join('\n');
}

// ─── Apply Fix ─────────────────────────────────────────────────

export function applyFix(config: AgentConfig, fixResult: FixResult): FixBackup {
  const backup: FixBackup = {
    timestamp: Date.now(),
    files: [],
  };

  for (const change of fixResult.changes) {
    const absolutePath = path.isAbsolute(change.filePath)
      ? change.filePath
      : path.resolve(config.workspaceRoot, change.filePath);

    // Back up original content
    if (fs.existsSync(absolutePath)) {
      backup.files.push({
        filePath: absolutePath,
        originalContent: fs.readFileSync(absolutePath, 'utf-8'),
      });
    } else {
      backup.files.push({
        filePath: absolutePath,
        originalContent: '',
      });
    }

    // Write the modified content
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolutePath, change.modifiedContent, 'utf-8');
  }

  return backup;
}

// ─── Rollback Fix ──────────────────────────────────────────────

export function rollbackFix(_config: AgentConfig, backup: FixBackup): void {
  for (const file of backup.files) {
    if (file.originalContent === '') {
      // File didn't exist before, remove it
      if (fs.existsSync(file.filePath)) {
        fs.unlinkSync(file.filePath);
      }
    } else {
      fs.writeFileSync(file.filePath, file.originalContent, 'utf-8');
    }
  }
}
