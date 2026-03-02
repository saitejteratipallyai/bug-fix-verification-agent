import * as vscode from 'vscode';
import { verifyFixCommand } from './commands/verify-fix';
import { verifyFromPRCommand } from './commands/verify-from-pr';
import { setupPlaywrightCommand } from './commands/setup-playwright';
import { initProjectCommand } from './commands/init-project';
import { fixAndVerifyCommand } from './commands/fix-and-verify';
import { getConfig, validateConfig } from './lib/config';
import { generateTest } from './lib/test-generator';
import { runTests } from './lib/test-runner';
import { analyzeScreenshots } from './lib/visual-analyzer';
import { getChangedFiles } from './lib/github-integration';
import { ResultsPanel } from './webview/results-panel';

export function activate(context: vscode.ExtensionContext): void {
  console.log('Bug Fix Verification Agent — activating...');

  // Main verification command
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.verifyFix', verifyFixCommand)
  );

  // Verify from PR
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.verifyFromPR', verifyFromPRCommand)
  );

  // Setup Playwright
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.setupPlaywright', setupPlaywrightCommand)
  );

  // Initialize project
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.initProject', initProjectCommand)
  );

  // Fix and verify (two-agent pipeline)
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.fixAndVerify', fixAndVerifyCommand)
  );

  // View results
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.viewResults', () => {
      ResultsPanel.createOrShow();
    })
  );

  // Generate test only
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.generateTest', async () => {
      const config = getConfig();
      const errors = validateConfig(config);
      if (errors.length > 0) {
        vscode.window.showErrorMessage(errors[0]);
        return;
      }

      const bugDescription = await vscode.window.showInputBox({
        prompt: 'Describe the bug',
        ignoreFocusOut: true,
      });
      if (!bugDescription) {return;}

      const changedFiles = getChangedFiles(config);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating test...',
        },
        async () => {
          try {
            const result = await generateTest(config, {
              bugDescription,
              changedFiles,
            });
            const doc = await vscode.workspace.openTextDocument(result.testFilePath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Test generated: ${result.testName}`);
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed: ${error.message}`);
          }
        }
      );
    })
  );

  // Run generated tests
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.runTest', async () => {
      const config = getConfig();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Running tests...',
          cancellable: true,
        },
        async (progress) => {
          try {
            const result = await runTests(config, {
              onOutput: (line) => progress.report({ message: line }),
            });
            const status = result.passed ? '✅ Passed' : '❌ Failed';
            vscode.window.showInformationMessage(
              `Tests ${status} (${(result.duration / 1000).toFixed(1)}s)`
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(`Test run failed: ${error.message}`);
          }
        }
      );
    })
  );

  // Analyze screenshots
  context.subscriptions.push(
    vscode.commands.registerCommand('bugFixAgent.analyzeScreenshots', async () => {
      const config = getConfig();
      const errors = validateConfig(config);
      if (errors.length > 0) {
        vscode.window.showErrorMessage(errors[0]);
        return;
      }

      const bugDescription = await vscode.window.showInputBox({
        prompt: 'Bug description for context',
        ignoreFocusOut: true,
      });
      if (!bugDescription) {return;}

      const files = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { Images: ['png', 'jpg', 'jpeg'] },
        title: 'Select screenshots to analyze',
      });
      if (!files || files.length === 0) {return;}

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Analyzing screenshots...',
        },
        async () => {
          try {
            const report = await analyzeScreenshots(
              config,
              bugDescription,
              files.map((f) => f.fsPath)
            );
            vscode.window.showInformationMessage(
              `Analysis: ${report.overallAssessment}`
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
          }
        }
      );
    })
  );

  // Show status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(bug) Bug Fix Agent';
  statusBarItem.command = 'bugFixAgent.fixAndVerify';
  statusBarItem.tooltip = 'Fix Bug & Verify';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  console.log('Bug Fix Verification Agent — activated successfully!');
}

export function deactivate(): void {
  if (ResultsPanel.currentPanel) {
    ResultsPanel.currentPanel.dispose();
  }
}
