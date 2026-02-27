import * as vscode from 'vscode';
import { getConfig, validateConfig } from '../lib/config';
import { getChangedFiles } from '../lib/github-integration';
import { runVerificationPipeline, VerificationResult } from '../lib/verification-pipeline';
import { ResultsPanel } from '../webview/results-panel';

export async function verifyFixCommand(): Promise<void> {
  const config = getConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    const choice = await vscode.window.showErrorMessage(
      errors[0],
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'bugFixAgent');
    }
    return;
  }

  // Get bug description from user
  const bugDescription = await vscode.window.showInputBox({
    prompt: 'Describe the bug that was fixed',
    placeHolder: 'e.g., Dropdown menu doesn\'t close on outside click',
    ignoreFocusOut: true,
  });

  if (!bugDescription) {
    return;
  }

  // Get changed files
  let changedFiles = getChangedFiles(config);

  if (changedFiles.length === 0) {
    const manualFiles = await vscode.window.showInputBox({
      prompt: 'No git changes detected. Enter changed file paths (comma-separated)',
      placeHolder: 'src/components/Dropdown.tsx, src/hooks/useClickOutside.ts',
      ignoreFocusOut: true,
    });

    if (!manualFiles) {
      return;
    }

    changedFiles = manualFiles.split(',').map(f => f.trim());
  } else {
    // Let user confirm/edit the file list
    const fileList = changedFiles.join(', ');
    const confirmed = await vscode.window.showQuickPick(
      ['Use detected files', 'Enter files manually'],
      {
        placeHolder: `Detected changed files: ${fileList}`,
      }
    );

    if (confirmed === 'Enter files manually') {
      const manualFiles = await vscode.window.showInputBox({
        prompt: 'Enter changed file paths (comma-separated)',
        value: fileList,
        ignoreFocusOut: true,
      });
      if (manualFiles) {
        changedFiles = manualFiles.split(',').map(f => f.trim());
      }
    }
  }

  // Ask about dev server
  const startServer = await vscode.window.showQuickPick(
    [
      { label: 'Start dev server automatically', value: true },
      { label: 'Server is already running', value: false },
    ],
    { placeHolder: 'Is your dev server already running?' }
  );

  if (!startServer) {
    return;
  }

  // Run verification with progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Bug Fix Verification',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const result = await runVerificationPipeline(
          config,
          {
            bugDescription,
            changedFiles,
            startServer: startServer.value,
          },
          (message, increment) => {
            progress.report({ message, increment });
          }
        );

        // Show results
        showResults(result, bugDescription);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Verification failed: ${error.message}`);
      }
    }
  );
}

function showResults(result: VerificationResult, bugDescription: string): void {
  const panel = ResultsPanel.createOrShow();
  panel.updateResults(result, bugDescription);

  // Show quick notification
  const status = result.overallPassed ? '✅' : '❌';
  const message = `${status} Bug fix verification ${result.overallPassed ? 'passed' : 'failed'}`;

  if (result.overallPassed) {
    vscode.window.showInformationMessage(message, 'View Details').then(choice => {
      if (choice === 'View Details') {
        ResultsPanel.createOrShow();
      }
    });
  } else {
    vscode.window.showWarningMessage(message, 'View Details', 'Retry').then(choice => {
      if (choice === 'View Details') {
        ResultsPanel.createOrShow();
      } else if (choice === 'Retry') {
        vscode.commands.executeCommand('bugFixAgent.verifyFix');
      }
    });
  }
}
