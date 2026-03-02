import * as vscode from 'vscode';
import { AgentConfig } from './config';
import { generateTest, regenerateTest, TestGenerationInput, TestGenerationResult } from './test-generator';
import { runTests, cleanTestResults, TestResult } from './test-runner';
import { analyzeScreenshots, VisualReport } from './visual-analyzer';

export interface VerificationInput {
  bugDescription: string;
  changedFiles: string[];
  testContext?: string;
  startServer?: boolean;
}

export interface VerificationResult {
  testGeneration: TestGenerationResult;
  testResult: TestResult;
  visualReport?: VisualReport;
  retryCount: number;
  overallPassed: boolean;
}

export type ProgressCallback = (message: string, increment?: number) => void;

export async function runVerificationPipeline(
  config: AgentConfig,
  input: VerificationInput,
  onProgress?: ProgressCallback
): Promise<VerificationResult> {
  let retryCount = 0;

  onProgress?.('Cleaning previous test results...', 5);
  cleanTestResults(config);

  // Phase 1: Generate test
  onProgress?.('Generating test from bug description...', 10);
  let testGen: TestGenerationResult;
  try {
    testGen = await generateTest(config, {
      bugDescription: input.bugDescription,
      changedFiles: input.changedFiles,
      testContext: input.testContext,
    });
    onProgress?.(`Test generated: ${testGen.testName}`, 30);
  } catch (error: any) {
    throw new Error(`Test generation failed: ${error.message}`);
  }

  // Phase 2: Run test with self-healing retries
  let testResult: TestResult;

  while (true) {
    onProgress?.(`Running test (attempt ${retryCount + 1}/${config.maxRetries})...`, 40 + retryCount * 10);

    testResult = await runTests(config, {
      testFilePath: testGen.testFilePath,
      startServer: input.startServer,
      onOutput: (line) => onProgress?.(line),
    });

    if (testResult.passed) {
      onProgress?.('Test passed!', 70);
      break;
    }

    retryCount++;
    if (retryCount >= config.maxRetries) {
      onProgress?.(`Test failed after ${config.maxRetries} attempts.`, 70);
      break;
    }

    // Self-healing: regenerate test
    onProgress?.(`Test failed. Self-healing attempt ${retryCount}...`, 40 + retryCount * 10);
    try {
      testGen = await regenerateTest(
        config,
        {
          bugDescription: input.bugDescription,
          changedFiles: input.changedFiles,
          testContext: input.testContext,
        },
        testGen.testCode,
        testResult.errorMessage || testResult.stderr
      );
    } catch (error: any) {
      onProgress?.(`Self-healing failed: ${error.message}`, 70);
      break;
    }
  }

  // Phase 3: Visual analysis
  let visualReport: VisualReport | undefined;
  if (config.enableVisualAnalysis && testResult.screenshots.length > 0) {
    onProgress?.('Analyzing screenshots with Claude Vision...', 80);
    try {
      visualReport = await analyzeScreenshots(
        config,
        input.bugDescription,
        testResult.screenshots
      );
      onProgress?.('Visual analysis complete.', 90);
    } catch (error: any) {
      onProgress?.(`Visual analysis failed: ${error.message}`, 90);
    }
  }

  // The Playwright test is the primary gate — if tests pass, the fix is working.
  // Visual analysis is advisory: it adds confidence but should NOT block a passing test.
  const overallPassed = testResult.passed;

  if (visualReport && !visualReport.passed) {
    onProgress?.(`Visual analysis flagged issues but test passed — proceeding. ${visualReport.overallAssessment}`, 95);
  }

  onProgress?.('Verification complete.', 100);

  return {
    testGeneration: testGen,
    testResult,
    visualReport,
    retryCount,
    overallPassed,
  };
}
