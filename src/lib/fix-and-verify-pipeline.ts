import { AgentConfig } from './config';
import {
  readCodebaseContext,
  analyzeRelevantFiles,
  generateFix,
  applyFix,
  rollbackFix,
  FixResult,
  FixBackup,
  RelevantFile,
  CodebaseContext,
} from './bug-fixer';
import {
  runVerificationPipeline,
  VerificationResult,
} from './verification-pipeline';

// ─── Interfaces ─────────────────────────────────────────────────

export interface FixAndVerifyInput {
  bugDescription: string;
  hintFiles?: string[];
  startServer?: boolean;
  testContext?: string;
}

export interface FixAttempt {
  attemptNumber: number;
  fix: FixResult;
  verification: VerificationResult | null;
  error?: string;
}

export interface FixAndVerifyResult {
  succeeded: boolean;
  attempts: FixAttempt[];
  finalFix: FixResult | null;
  finalVerification: VerificationResult | null;
  relevantFiles: RelevantFile[];
  codebaseContext: CodebaseContext | null;
}

export type ProgressCallback = (message: string, increment?: number) => void;

// ─── Pipeline ───────────────────────────────────────────────────

export async function runFixAndVerifyPipeline(
  config: AgentConfig,
  input: FixAndVerifyInput,
  onProgress?: ProgressCallback
): Promise<FixAndVerifyResult> {
  const maxAttempts = config.maxRetries;
  const attempts: FixAttempt[] = [];

  // Phase 0: Read codebase context
  onProgress?.('📖 Reading codebase context...', 2);
  const codebaseContext = await readCodebaseContext(config);
  if (codebaseContext) {
    onProgress?.(`📖 Found context: ${codebaseContext.filePath}`, 5);
  } else {
    onProgress?.('📖 No codebase context file found. Proceeding without it.', 5);
  }

  // Phase 0.5: Identify relevant files
  onProgress?.('🔍 Analyzing which files are relevant to the bug...', 8);
  const relevantFiles = await analyzeRelevantFiles(
    config,
    input.bugDescription,
    codebaseContext,
    input.hintFiles
  );
  onProgress?.(`🔍 Identified ${relevantFiles.length} relevant file(s): ${relevantFiles.map(f => f.relativePath).join(', ')}`, 12);

  let previousAttempt: { fix: FixResult; verificationError: string } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const progressBase = 12 + ((attempt - 1) / maxAttempts) * 80;

    // Phase 1: Generate fix
    onProgress?.(`🧠 Generating fix (attempt ${attempt}/${maxAttempts})...`, progressBase);
    let fix: FixResult;
    try {
      fix = await generateFix(
        config,
        input.bugDescription,
        relevantFiles,
        codebaseContext,
        previousAttempt
      );
      onProgress?.(
        `🧠 Fix generated: ${fix.approach} (${fix.changes.length} file(s))`,
        progressBase + 10
      );
    } catch (error: any) {
      onProgress?.(`❌ Fix generation failed: ${error.message}`, progressBase + 10);
      attempts.push({
        attemptNumber: attempt,
        fix: {
          changes: [],
          explanation: `Fix generation error: ${error.message}`,
          approach: 'Failed',
        },
        verification: null,
        error: error.message,
      });
      continue;
    }

    // Phase 2: Apply fix
    onProgress?.('📝 Applying fix to source files...', progressBase + 15);
    let backup: FixBackup;
    try {
      backup = applyFix(config, fix);
    } catch (error: any) {
      onProgress?.(`❌ Failed to apply fix: ${error.message}`, progressBase + 15);
      attempts.push({
        attemptNumber: attempt,
        fix,
        verification: null,
        error: `Apply failed: ${error.message}`,
      });
      continue;
    }

    // Phase 3: Run verification pipeline
    onProgress?.('🔬 Running verification agent...', progressBase + 20);
    let verification: VerificationResult;
    try {
      const changedFiles = fix.changes.map(c => c.relativePath);

      verification = await runVerificationPipeline(
        config,
        {
          bugDescription: input.bugDescription,
          changedFiles,
          testContext: input.testContext,
          startServer: input.startServer,
        },
        (message, _increment) => {
          onProgress?.(`  🔬 ${message}`);
        }
      );
    } catch (error: any) {
      onProgress?.(`❌ Verification error: ${error.message}`, progressBase + 50);
      rollbackFix(config, backup);
      attempts.push({
        attemptNumber: attempt,
        fix,
        verification: null,
        error: `Verification error: ${error.message}`,
      });
      previousAttempt = {
        fix,
        verificationError: error.message,
      };
      continue;
    }

    attempts.push({
      attemptNumber: attempt,
      fix,
      verification,
    });

    // Phase 4: Check if verification passed
    if (verification.overallPassed) {
      onProgress?.(`✅ Fix verified successfully on attempt ${attempt}!`, 95);
      return {
        succeeded: true,
        attempts,
        finalFix: fix,
        finalVerification: verification,
        relevantFiles,
        codebaseContext,
      };
    }

    // Verification failed — roll back and prepare for next attempt
    onProgress?.(
      `❌ Verification failed (attempt ${attempt}/${maxAttempts}). Rolling back...`,
      progressBase + 55
    );
    rollbackFix(config, backup);

    // Prepare error context for self-healing
    const verificationError = [
      verification.testResult?.errorMessage || '',
      verification.testResult?.stderr || '',
      verification.visualReport?.overallAssessment || '',
    ]
      .filter(Boolean)
      .join('\n---\n');

    previousAttempt = {
      fix,
      verificationError: verificationError || 'Verification tests failed but no specific error message was captured.',
    };
  }

  // All attempts exhausted
  onProgress?.(`💥 All ${maxAttempts} fix attempts failed.`, 100);

  return {
    succeeded: false,
    attempts,
    finalFix: null,
    finalVerification: null,
    relevantFiles,
    codebaseContext,
  };
}
