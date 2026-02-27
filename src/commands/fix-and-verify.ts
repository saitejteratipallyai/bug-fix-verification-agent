import * as vscode from 'vscode';
import { getConfig, validateConfig } from '../lib/config';
import { runFixAndVerifyPipeline, FixAndVerifyResult } from '../lib/fix-and-verify-pipeline';
import { ResultsPanel } from '../webview/results-panel';

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

  // Run the fix-and-verify pipeline
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🤖 Bug Fix Agent: Fix & Verify',
      cancellable: false,
    },
    async (progress) => {
      try {
        const result = await runFixAndVerifyPipeline(
          config,
          {
            bugDescription,
            hintFiles,
            startServer: serverOption.value,
          },
          (message, increment) => {
            progress.report({ message, increment });
          }
        );

        showFixAndVerifyResults(result, bugDescription);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Bug Fix Agent failed: ${error.message}`);
      }
    }
  );
}

function showFixAndVerifyResults(
  result: FixAndVerifyResult,
  bugDescription: string
): void {
  if (result.succeeded && result.finalFix) {
    const fileCount = result.finalFix.changes.length;
    const attemptCount = result.attempts.length;

    vscode.window.showInformationMessage(
      `✅ Bug fixed & verified! ${fileCount} file(s) changed in ${attemptCount} attempt(s).`,
      'View Changes',
      'View Verification'
    ).then(async (choice) => {
      if (choice === 'View Changes') {
        // Show diff in output channel
        const channel = vscode.window.createOutputChannel('Bug Fix Agent — Changes');
        channel.clear();
        channel.appendLine('═══ Bug Fix Agent: Applied Changes ═══');
        channel.appendLine(`Bug: ${bugDescription}`);
        channel.appendLine(`Approach: ${result.finalFix!.approach}`);
        channel.appendLine(`Explanation: ${result.finalFix!.explanation}`);
        channel.appendLine(`Attempts: ${attemptCount}`);
        channel.appendLine('');

        for (const change of result.finalFix!.changes) {
          channel.appendLine(`── ${change.relativePath} ──`);
          channel.appendLine(change.diff);
          channel.appendLine('');
        }
        channel.show();

        // Also open the changed files in editor
        for (const change of result.finalFix!.changes) {
          const uri = vscode.Uri.file(change.filePath);
          await vscode.window.showTextDocument(uri, { preview: false });
        }
      } else if (choice === 'View Verification' && result.finalVerification) {
        const panel = ResultsPanel.createOrShow();
        panel.updateResults(result.finalVerification, bugDescription);
      }
    });
  } else {
    // Show all attempted approaches
    vscode.window.showWarningMessage(
      `❌ Bug fix failed after ${result.attempts.length} attempt(s).`,
      'View Attempts',
      'Retry'
    ).then(choice => {
      if (choice === 'View Attempts') {
        const channel = vscode.window.createOutputChannel('Bug Fix Agent — Attempts');
        channel.clear();
        channel.appendLine('═══ Bug Fix Agent: All Attempted Fixes ═══');
        channel.appendLine(`Bug: ${bugDescription}`);
        channel.appendLine(`Total attempts: ${result.attempts.length}`);
        channel.appendLine('');

        for (const attempt of result.attempts) {
          channel.appendLine(`━━━ Attempt ${attempt.attemptNumber} ━━━`);
          channel.appendLine(`Approach: ${attempt.fix.approach}`);
          channel.appendLine(`Explanation: ${attempt.fix.explanation}`);

          if (attempt.fix.changes.length > 0) {
            channel.appendLine('');
            channel.appendLine('Changes:');
            for (const change of attempt.fix.changes) {
              channel.appendLine(`  ${change.relativePath}`);
              channel.appendLine(change.diff);
            }
          }

          if (attempt.error) {
            channel.appendLine('');
            channel.appendLine(`Error: ${attempt.error}`);
          }

          if (attempt.verification) {
            channel.appendLine('');
            channel.appendLine(
              `Verification: ${attempt.verification.overallPassed ? '✅ PASSED' : '❌ FAILED'}`
            );
            if (attempt.verification.testResult?.errorMessage) {
              channel.appendLine(`Test Error: ${attempt.verification.testResult.errorMessage}`);
            }
          }

          channel.appendLine('');
        }
        channel.show();
      } else if (choice === 'Retry') {
        vscode.commands.executeCommand('bugFixAgent.fixAndVerify');
      }
    });
  }
}
