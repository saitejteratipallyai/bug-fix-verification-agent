import * as vscode from 'vscode';
import { getConfig, validateConfig } from '../lib/config';
import { runFixAndVerifyPipeline, FixAndVerifyResult } from '../lib/fix-and-verify-pipeline';
import { LivePanel } from '../webview/live-panel';
import { ResultsPanel } from '../webview/results-panel';
import { isGitRepo, isGhCliAvailable, createPullRequest } from '../lib/github-integration';

export async function fixAndVerifyCommand(): Promise<void> {
  const config = getConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    const choice = await vscode.window.showErrorMessage(
      `Bug Fix Agent: ${errors[0]}`,
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'bugFixAgent');
    }
    return;
  }

  // Get bug description from user
  const bugDescription = await vscode.window.showInputBox({
    prompt: 'Describe the bug to fix',
    placeHolder: 'e.g., Counter reset button does not reset the count to zero',
    ignoreFocusOut: true,
  });

  if (!bugDescription) {
    return;
  }

  // Let user choose how to find files
  const fileOption = await vscode.window.showQuickPick(
    [
      { label: '$(search) Auto-detect relevant files', description: 'AI analyzes your codebase', value: 'auto' },
      { label: '$(file) Specify files manually', description: 'Enter file paths', value: 'manual' },
    ],
    { placeHolder: 'How should the agent find the relevant files?' }
  );

  if (!fileOption) {
    return;
  }

  let hintFiles: string[] | undefined;

  if (fileOption.value === 'manual') {
    const filesInput = await vscode.window.showInputBox({
      prompt: 'Enter file paths (comma-separated, relative to workspace root)',
      placeHolder: 'src/components/Counter.tsx, src/hooks/useCounter.ts',
      ignoreFocusOut: true,
    });

    if (filesInput) {
      hintFiles = filesInput.split(',').map(f => f.trim()).filter(Boolean);
    }
  }

  // Ask about dev server
  const serverOption = await vscode.window.showQuickPick(
    [
      { label: '$(play) Start dev server automatically', value: true },
      { label: '$(check) Server is already running', value: false },
    ],
    { placeHolder: 'Is your dev server already running?' }
  );

  if (serverOption === undefined) {
    return;
  }

  // Validate workspace looks like a project (not the extension itself)
  const workspaceDir = config.workspaceRoot;
  const workspaceName = workspaceDir.split('/').pop() || workspaceDir;

  // Open live panel
  const livePanel = LivePanel.createOrShow(bugDescription);

  // Show diagnostic info step so user can see what's happening
  livePanel.addStep({
    id: 'diag',
    label: `Workspace: ${workspaceName}`,
    status: 'success',
    detail: `Root: ${config.workspaceRoot}\nBase URL: ${config.baseUrl}\nModel: ${config.claudeModel}\nAPI Key: ${config.anthropicApiKey ? '***' + config.anthropicApiKey.slice(-4) : 'NOT SET'}\nServer: ${serverOption.value ? 'Will auto-start' : 'Already running'}`,
  });

  // Check if API key is actually set
  if (!config.anthropicApiKey) {
    livePanel.addStep({
      id: 'error',
      label: 'Missing API Key',
      status: 'error',
      detail: 'ANTHROPIC_API_KEY is not set. Set it in:\n1. Extension settings (bugFixAgent.anthropicApiKey)\n2. Or environment variable ANTHROPIC_API_KEY\n\nIf using F5 debug, make sure the env var is set in your shell before opening VS Code.',
    });
    livePanel.setAllComplete(false);
    vscode.window.showErrorMessage('Bug Fix Agent: ANTHROPIC_API_KEY is not set');
    return;
  }

  // Initialize steps
  livePanel.addStep({ id: 'context', label: 'Reading codebase context', status: 'pending' });
  livePanel.addStep({ id: 'files', label: 'Identifying relevant files', status: 'pending' });
  livePanel.addStep({ id: 'fix', label: 'Generating fix with Claude AI', status: 'pending' });
  livePanel.addStep({ id: 'apply', label: 'Applying fix to source files', status: 'pending' });
  livePanel.addStep({ id: 'test-gen', label: 'Generating Playwright test', status: 'pending' });
  livePanel.addStep({ id: 'test-run', label: 'Running browser test', status: 'pending' });
  livePanel.addStep({ id: 'visual', label: 'Analyzing screenshots with AI', status: 'pending' });

  const stepTimers: Record<string, number> = {};

  function startStep(id: string) {
    stepTimers[id] = Date.now();
    livePanel.updateStep(id, { status: 'running' });
  }

  function completeStep(id: string, detail?: string, code?: string) {
    const duration = stepTimers[id] ? Date.now() - stepTimers[id] : 0;
    livePanel.updateStep(id, { status: 'success', detail, code, duration });
  }

  function failStep(id: string, detail?: string) {
    const duration = stepTimers[id] ? Date.now() - stepTimers[id] : 0;
    livePanel.updateStep(id, { status: 'error', detail, duration });
  }

  // Run the pipeline with live updates
  try {
    const result = await runFixAndVerifyPipeline(
      config,
      {
        bugDescription,
        hintFiles,
        startServer: serverOption.value,
      },
      (message, _increment) => {
        // Log all messages to output channel for debugging
        console.log(`[BugFixAgent] ${message}`);

        // Parse progress messages to update steps
        if (message.includes('Reading codebase context')) {
          startStep('context');
        } else if (message.includes('Found context:') || message.includes('context file found')) {
          const detail = message.includes('Found') ? message : 'No context file found — using file tree only';
          completeStep('context', detail);
        } else if (message.includes('No codebase context')) {
          completeStep('context', 'No context file found — using file tree only');
        } else if (message.includes('Analyzing which files')) {
          startStep('files');
        } else if (message.includes('Identified')) {
          completeStep('files', message);
        } else if (message.includes('Generating fix')) {
          // If this is a retry attempt, mark the retry step as progressing
          const retryStep = (livePanel as any)._steps?.find((x: any) => x.id === 'retry');
          if (retryStep && retryStep.status === 'running') {
            livePanel.updateStep('retry', { detail: message });
          }
          startStep('fix');
        } else if (message.includes('Fix generated:')) {
          completeStep('fix', message);
        } else if (message.includes('Fix generation failed')) {
          failStep('fix', message);
        } else if (message.includes('Applying fix')) {
          startStep('apply');
        } else if (message.includes('Failed to apply fix')) {
          failStep('apply', message);
        } else if (message.includes('Running verification') || message.includes('verification agent')) {
          completeStep('apply', 'Fix written to disk with backup');
          startStep('test-gen');
        } else if (message.includes('Generating test') || message.includes('Test generated')) {
          if (message.includes('Test generated')) {
            completeStep('test-gen', message);
            startStep('test-run');
          } else {
            startStep('test-gen');
          }
        } else if (message.includes('Running test')) {
          startStep('test-run');
        } else if (message.includes('Test passed')) {
          completeStep('test-run', 'All assertions passed in real Chromium browser');
        } else if (message.includes('Test failed')) {
          failStep('test-run', message);
        } else if (message.includes('Analyzing screenshots') || message.includes('Visual analysis')) {
          if (message.includes('Analyzing')) {
            startStep('visual');
          } else if (message.includes('complete')) {
            completeStep('visual', 'Screenshots analyzed with Claude Vision');
          } else if (message.includes('failed')) {
            failStep('visual', message);
          }
        } else if (message.includes('Self-healing') || message.includes('Rolling back')) {
          // On retry, reset relevant steps
          livePanel.updateStep('fix', { status: 'error', detail: 'Fix attempt failed — retrying with different approach' });
          livePanel.addStep({ id: 'retry', label: 'Self-healing: Retrying with error context', status: 'running' });
        } else if (message.includes('Verification complete')) {
          completeStep('visual', message);
        } else if (message.includes('Verification failed')) {
          failStep('test-run', message);
        } else if (message.includes('Verification error')) {
          failStep('test-run', message);
        } else if (message.includes('All') && message.includes('failed')) {
          // "All N fix attempts failed"
          failStep('fix', message);
        } else if (message.includes('Server is ready')) {
          // Server status messages from test-runner
          livePanel.updateStep('test-run', { detail: message });
        } else if (message.includes('[playwright]') || message.includes('[server]')) {
          // Capture playwright/server output as running detail
          const runningStep = ['test-run', 'test-gen'].find(id => {
            const s = (livePanel as any)._steps?.find((x: any) => x.id === id);
            return s && s.status === 'running';
          });
          if (runningStep) {
            livePanel.updateStep(runningStep, { detail: message });
          }
        }
      }
    );

    // Show final result
    if (result.succeeded && result.finalFix) {
      // Update any remaining pending or running steps to success
      for (const step of ['context', 'files', 'fix', 'apply', 'test-gen', 'test-run', 'visual', 'retry']) {
        const s = (livePanel as any)._steps?.find((x: any) => x.id === step);
        if (s && (s.status === 'pending' || s.status === 'running')) {
          livePanel.updateStep(step, { status: 'success' });
        }
      }

      // If fix had failed on earlier attempt but succeeded on retry, update it
      const fixStep = (livePanel as any)._steps?.find((x: any) => x.id === 'fix');
      if (fixStep && fixStep.status === 'error') {
        livePanel.updateStep('fix', {
          status: 'success',
          detail: `Fixed on attempt ${result.attempts.length}: ${result.finalFix.approach}`,
        });
      }

      // Mark retry step as success if it exists
      const retryStep = (livePanel as any)._steps?.find((x: any) => x.id === 'retry');
      if (retryStep) {
        livePanel.updateStep('retry', {
          status: 'success',
          detail: `Self-healing succeeded on attempt ${result.attempts.length}`,
        });
      }

      // Show diff in the panel
      const diffCode = result.finalFix.changes
        .map(c => `── ${c.relativePath} ──\n${c.diff}`)
        .join('\n\n');

      livePanel.addStep({
        id: 'result',
        label: `Fix applied: ${result.finalFix.approach}`,
        status: 'success',
        detail: result.finalFix.explanation,
        code: diffCode,
      });

      // Add artifacts step
      if (result.finalVerification) {
        const artifacts = [
          ...result.finalVerification.testResult.videos.map(v => `📹 ${v.split('/').pop()}`),
          ...result.finalVerification.testResult.screenshots.map(s => `📸 ${s.split('/').pop()}`),
        ].join('\n');

        if (artifacts) {
          livePanel.addStep({
            id: 'artifacts',
            label: 'Artifacts collected',
            status: 'success',
            detail: artifacts,
          });
        }
      }

      // ─── PR Creation ───────────────────────────────────────────
      // Try to create a PR if git + gh CLI are available
      let prUrl: string | undefined;
      if (isGitRepo(config) && isGhCliAvailable(config)) {
        livePanel.addStep({ id: 'pr', label: 'Creating Pull Request', status: 'running' });
        const prStart = Date.now();

        try {
          const prResult = await createPullRequest(
            config,
            bugDescription,
            result.finalFix,
            result.finalVerification,
            (msg) => livePanel.updateStep('pr', { detail: msg })
          );
          prUrl = prResult.prUrl;
          const prDuration = Date.now() - prStart;
          livePanel.updateStep('pr', {
            status: 'success',
            label: `PR created: #${prResult.prNumber}`,
            detail: `${prResult.prUrl}\nBranch: ${prResult.branchName}`,
            duration: prDuration,
          });
        } catch (prError: any) {
          const prDuration = Date.now() - prStart;
          livePanel.updateStep('pr', {
            status: 'error',
            detail: `PR creation failed: ${prError.message}\n\nThe fix was still applied successfully.`,
            duration: prDuration,
          });
        }
      }

      livePanel.setAllComplete(true);

      // Show notification with PR link
      const notifActions = ['View Changes'];
      if (result.finalVerification) { notifActions.push('View Verification'); }
      if (prUrl) { notifActions.push('Open PR'); }

      const notifMessage = prUrl
        ? `Bug fixed, verified & PR created! ${result.finalFix.changes.length} file(s) changed.`
        : `Bug fixed & verified! ${result.finalFix.changes.length} file(s) changed.`;

      vscode.window.showInformationMessage(notifMessage, ...notifActions)
      .then(async (choice) => {
        if (choice === 'View Changes') {
          for (const change of result.finalFix!.changes) {
            const uri = vscode.Uri.file(change.filePath);
            await vscode.window.showTextDocument(uri, { preview: false });
          }
        } else if (choice === 'View Verification' && result.finalVerification) {
          const panel = ResultsPanel.createOrShow();
          panel.updateResults(result.finalVerification, bugDescription);
        } else if (choice === 'Open PR' && prUrl) {
          vscode.env.openExternal(vscode.Uri.parse(prUrl));
        }
      });
    } else {
      // Show detailed failure info in the live panel
      const failureDetails = result.attempts.map((attempt, i) => {
        const lines = [`--- Attempt ${attempt.attemptNumber} ---`];
        lines.push(`Approach: ${attempt.fix.approach}`);
        if (attempt.error) {
          lines.push(`Error: ${attempt.error}`);
        }
        if (attempt.verification) {
          if (attempt.verification.testResult.errorMessage) {
            lines.push(`Test Error: ${attempt.verification.testResult.errorMessage}`);
          }
          if (attempt.verification.testResult.stderr) {
            lines.push(`Stderr: ${attempt.verification.testResult.stderr.substring(0, 500)}`);
          }
          if (attempt.verification.visualReport?.overallAssessment) {
            lines.push(`Visual: ${attempt.verification.visualReport.overallAssessment}`);
          }
        }
        return lines.join('\n');
      }).join('\n\n');

      livePanel.addStep({
        id: 'failure-details',
        label: `Failed after ${result.attempts.length} attempt(s) — see details`,
        status: 'error',
        detail: failureDetails,
      });

      livePanel.setAllComplete(false);

      vscode.window.showWarningMessage(
        `Bug fix failed after ${result.attempts.length} attempt(s). Check the live panel for details.`,
        'Retry'
      ).then(choice => {
        if (choice === 'Retry') {
          vscode.commands.executeCommand('bugFixAgent.fixAndVerify');
        }
      });
    }
  } catch (error: any) {
    const errorDetail = [
      error.message,
      '',
      'Stack trace:',
      error.stack || 'No stack trace available',
    ].join('\n');

    livePanel.addStep({
      id: 'error',
      label: 'Pipeline error',
      status: 'error',
      detail: errorDetail,
    });
    livePanel.setAllComplete(false);
    vscode.window.showErrorMessage(`Bug Fix Agent failed: ${error.message}`);
  }
}
