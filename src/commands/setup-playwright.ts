import * as vscode from 'vscode';
import { getConfig } from '../lib/config';
import { setupPlaywright, isPlaywrightInstalled } from '../lib/playwright-setup';

export async function setupPlaywrightCommand(): Promise<void> {
  const config = getConfig();

  if (isPlaywrightInstalled(config.workspaceRoot)) {
    const reinstall = await vscode.window.showInformationMessage(
      'Playwright is already installed. Reinstall?',
      'Yes',
      'No'
    );
    if (reinstall !== 'Yes') {
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Setting up Playwright...',
      cancellable: false,
    },
    async () => {
      try {
        await setupPlaywright(config);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Setup failed: ${error.message}`);
      }
    }
  );
}
