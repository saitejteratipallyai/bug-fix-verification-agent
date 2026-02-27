import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { getConfig, validateConfig } from '../lib/config';
import { extractBugDescription, isBugFixPR } from '../lib/github-integration';
import { runVerificationPipeline } from '../lib/verification-pipeline';
import { ResultsPanel } from '../webview/results-panel';

export async function verifyFromPRCommand(): Promise<void> {
  const config = getConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    vscode.window.showErrorMessage(errors[0]);
    return;
  }

  // Get PR number
  const prInput = await vscode.window.showInputBox({
    prompt: 'Enter PR number or leave empty to use current branch PR',
    placeHolder: 'e.g., 123',
    ignoreFocusOut: true,
  });

  let prNumber: string;
  let prTitle: string;
  let prBody: string;
  let changedFiles: string[];

  try {
    if (prInput) {
      prNumber = prInput;
    } else {
      // Try to find PR for current branch
      const result = execSync(
        'gh pr view --json number --jq .number',
        { cwd: config.workspaceRoot, encoding: 'utf-8' }
      ).trim();
      prNumber = result;
    }

    // Get PR details
    const prJson = execSync(
      `gh pr view ${prNumber} --json title,body,labels,files`,
      { cwd: config.workspaceRoot, encoding: 'utf-8' }
    );
    const prData = JSON.parse(prJson);

    prTitle = prData.title;
    prBody = prData.body || '';
    const labels = (prData.labels || []).map((l: any) => l.name);
    changedFiles = (prData.files || []).map((f: any) => f.path);

    // Check if it's a bug fix PR
    if (!isBugFixPR(prTitle, labels)) {
      const proceed = await vscode.window.showWarningMessage(
        'This PR doesn\'t appear to be a bug fix. Continue anyway?',
        'Yes',
        'No'
      );
      if (proceed !== 'Yes') {
        return;
      }
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to fetch PR info. Make sure 'gh' CLI is installed and authenticated. Error: ${error.message}`
    );
    return;
  }

  const bugDescription = extractBugDescription(prBody) || prTitle;

  // Confirm with user
  const confirm = await vscode.window.showInformationMessage(
    `PR #${prNumber}: "${prTitle}"\nBug: ${bugDescription}\nChanged files: ${changedFiles.length}`,
    'Run Verification',
    'Cancel'
  );

  if (confirm !== 'Run Verification') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Verifying PR #${prNumber}`,
      cancellable: true,
    },
    async (progress) => {
      try {
        const result = await runVerificationPipeline(
          config,
          {
            bugDescription,
            changedFiles,
            startServer: true,
          },
          (message, increment) => {
            progress.report({ message, increment });
          }
        );

        const panel = ResultsPanel.createOrShow();
        panel.updateResults(result, bugDescription);

        const status = result.overallPassed ? '✅ Passed' : '❌ Failed';
        vscode.window.showInformationMessage(`PR #${prNumber} verification: ${status}`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Verification failed: ${error.message}`);
      }
    }
  );
}
