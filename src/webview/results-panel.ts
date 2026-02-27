import * as vscode from 'vscode';
import * as path from 'path';
import { VerificationResult } from '../lib/verification-pipeline';

export class ResultsPanel {
  public static currentPanel: ResultsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'openFile':
            vscode.workspace.openTextDocument(message.path).then(doc => {
              vscode.window.showTextDocument(doc);
            });
            break;
          case 'openVideo':
            vscode.env.openExternal(vscode.Uri.file(message.path));
            break;
          case 'retry':
            vscode.commands.executeCommand('bugFixAgent.verifyFix');
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(): ResultsPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ResultsPanel.currentPanel) {
      ResultsPanel.currentPanel._panel.reveal(column);
      return ResultsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'bugFixResults',
      'Bug Fix Verification Results',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ResultsPanel.currentPanel = new ResultsPanel(panel);
    return ResultsPanel.currentPanel;
  }

  public updateResults(result: VerificationResult, bugDescription: string): void {
    this._panel.webview.html = this._getHtmlContent(result, bugDescription);
  }

  private _getHtmlContent(result: VerificationResult, bugDescription: string): string {
    const status = result.overallPassed;
    const statusEmoji = status ? '✅' : '❌';
    const statusText = status ? 'PASSED' : 'FAILED';
    const statusColor = status ? '#4caf50' : '#f44336';

    const videosHtml = result.testResult.videos
      .map(
        (v) =>
          `<div class="artifact">
            <span class="artifact-icon">📹</span>
            <a href="#" onclick="openVideo('${v.replace(/\\/g, '\\\\')}')">
              ${path.basename(v)}
            </a>
          </div>`
      )
      .join('');

    const screenshotsHtml = result.testResult.screenshots
      .map(
        (s) =>
          `<div class="artifact">
            <span class="artifact-icon">📸</span>
            <a href="#" onclick="openFile('${s.replace(/\\/g, '\\\\')}')">
              ${path.basename(s)}
            </a>
          </div>`
      )
      .join('');

    let visualAnalysisHtml = '';
    if (result.visualReport) {
      visualAnalysisHtml = `
        <div class="section">
          <h2>🔍 AI Visual Analysis</h2>
          <p class="assessment">${escapeHtml(result.visualReport.overallAssessment)}</p>
          ${result.visualReport.screenshots
            .map(
              (s) => `
            <div class="visual-result">
              <h3>${path.basename(s.screenshot)}</h3>
              <p><strong>Assessment:</strong> ${escapeHtml(s.assessment)}</p>
              <p><strong>Confidence:</strong>
                <span class="badge badge-${s.confidence}">${s.confidence}</span>
              </p>
              ${
                s.issues.length > 0
                  ? `<p><strong>Issues:</strong></p>
                <ul>${s.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
                  : '<p><strong>Issues:</strong> None found</p>'
              }
            </div>`
            )
            .join('')}
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bug Fix Verification Results</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .status-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 14px;
      color: white;
      background-color: ${statusColor};
    }
    h1 {
      margin: 0;
      font-size: 20px;
    }
    h2 {
      font-size: 16px;
      margin-top: 24px;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }
    .section {
      margin-bottom: 24px;
      padding: 16px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 16px;
    }
    .info-label {
      font-weight: bold;
      color: var(--vscode-descriptionForeground);
    }
    .artifact {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      margin: 4px 0;
      background: var(--vscode-editor-background);
      border-radius: 4px;
    }
    .artifact a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .artifact a:hover {
      text-decoration: underline;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
    }
    .badge-high { background: #4caf50; color: white; }
    .badge-medium { background: #ff9800; color: white; }
    .badge-low { background: #f44336; color: white; }
    .assessment {
      padding: 12px;
      background: var(--vscode-editor-background);
      border-left: 3px solid ${statusColor};
      border-radius: 0 4px 4px 0;
    }
    .visual-result {
      margin: 12px 0;
      padding: 12px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
    }
    .error-output {
      background: var(--vscode-editor-background);
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 300px;
      overflow-y: auto;
      border-left: 3px solid #f44336;
    }
    .test-code {
      background: var(--vscode-editor-background);
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .actions {
      margin-top: 16px;
      display: flex;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${statusEmoji} Bug Fix Verification</h1>
    <span class="status-badge">${statusText}</span>
  </div>

  <div class="section">
    <h2>📋 Summary</h2>
    <div class="info-grid">
      <span class="info-label">Bug:</span>
      <span>${escapeHtml(bugDescription)}</span>
      <span class="info-label">Duration:</span>
      <span>${(result.testResult.duration / 1000).toFixed(1)}s</span>
      <span class="info-label">Retries:</span>
      <span>${result.retryCount}</span>
      <span class="info-label">Test File:</span>
      <span>
        <a href="#" onclick="openFile('${result.testGeneration.testFilePath.replace(/\\/g, '\\\\')}')">
          ${path.basename(result.testGeneration.testFilePath)}
        </a>
      </span>
    </div>
  </div>

  ${
    !result.overallPassed && result.testResult.errorMessage
      ? `<div class="section">
          <h2>🚨 Error Output</h2>
          <div class="error-output">${escapeHtml(result.testResult.errorMessage)}</div>
        </div>`
      : ''
  }

  ${visualAnalysisHtml}

  <div class="section">
    <h2>📦 Artifacts</h2>
    ${videosHtml || '<p>No videos captured</p>'}
    ${screenshotsHtml || '<p>No screenshots captured</p>'}
  </div>

  <div class="section">
    <h2>🧪 Generated Test</h2>
    <div class="test-code">${escapeHtml(result.testGeneration.testCode)}</div>
  </div>

  <div class="actions">
    <button onclick="retry()">🔄 Retry Verification</button>
    <button onclick="openFile('${result.testGeneration.testFilePath.replace(/\\/g, '\\\\')}')">📝 Edit Test</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function openFile(p) { vscode.postMessage({ command: 'openFile', path: p }); }
    function openVideo(p) { vscode.postMessage({ command: 'openVideo', path: p }); }
    function retry() { vscode.postMessage({ command: 'retry' }); }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    ResultsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
