import * as vscode from 'vscode';

export interface LiveStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  detail?: string;
  code?: string;
  codeLanguage?: string;
  duration?: number;
}

export class LivePanel {
  public static currentPanel: LivePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _steps: LiveStep[] = [];
  private _bugDescription: string = '';
  private _startTime: number = Date.now();

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(bugDescription: string): LivePanel {
    const column = vscode.ViewColumn.Two;

    if (LivePanel.currentPanel) {
      LivePanel.currentPanel._panel.reveal(column);
      LivePanel.currentPanel._bugDescription = bugDescription;
      LivePanel.currentPanel._steps = [];
      LivePanel.currentPanel._startTime = Date.now();
      LivePanel.currentPanel._updateHtml();
      return LivePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'bugFixAgentLive',
      '🤖 Bug Fix Agent — Live',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    LivePanel.currentPanel = new LivePanel(panel);
    LivePanel.currentPanel._bugDescription = bugDescription;
    LivePanel.currentPanel._updateHtml();
    return LivePanel.currentPanel;
  }

  public addStep(step: LiveStep): void {
    const existing = this._steps.find(s => s.id === step.id);
    if (existing) {
      Object.assign(existing, step);
    } else {
      this._steps.push(step);
    }
    this._updateHtml();
  }

  public updateStep(id: string, updates: Partial<LiveStep>): void {
    const step = this._steps.find(s => s.id === id);
    if (step) {
      Object.assign(step, updates);
      this._updateHtml();
    }
  }

  public setAllComplete(success: boolean): void {
    this._updateHtml(success);
  }

  private _updateHtml(finalResult?: boolean): void {
    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);

    const stepsHtml = this._steps.map(step => {
      const icon = step.status === 'running' ? '⏳'
        : step.status === 'success' ? '✅'
        : step.status === 'error' ? '❌'
        : step.status === 'skipped' ? '⏭️'
        : '⬜';

      const statusClass = step.status;
      const durationStr = step.duration ? ` (${(step.duration / 1000).toFixed(1)}s)` : '';

      let codeBlock = '';
      if (step.code) {
        const lang = step.codeLanguage || 'text';
        codeBlock = `<div class="code-block"><pre><code>${escapeHtml(step.code)}</code></pre></div>`;
      }

      return `
        <div class="step ${statusClass}">
          <div class="step-header">
            <span class="step-icon">${icon}</span>
            <span class="step-label">${escapeHtml(step.label)}</span>
            <span class="step-duration">${durationStr}</span>
          </div>
          ${step.detail ? `<div class="step-detail">${escapeHtml(step.detail)}</div>` : ''}
          ${codeBlock}
          ${step.status === 'running' ? '<div class="progress-bar"><div class="progress-fill"></div></div>' : ''}
        </div>`;
    }).join('');

    let finalBanner = '';
    if (finalResult === true) {
      finalBanner = `<div class="final-banner success">✅ Bug Fixed & Verified Successfully!</div>`;
    } else if (finalResult === false) {
      finalBanner = `<div class="final-banner error">❌ Fix Failed — See details above</div>`;
    }

    this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bug Fix Agent — Live</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, 'SF Mono', monospace);
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #d4d4d4);
    padding: 20px;
  }
  .header {
    border-bottom: 2px solid var(--vscode-panel-border, #333);
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .title {
    font-size: 18px;
    font-weight: bold;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .bug-desc {
    margin-top: 8px;
    padding: 10px 14px;
    background: var(--vscode-textBlockQuote-background, #2a2a2a);
    border-left: 3px solid #f0883e;
    border-radius: 0 4px 4px 0;
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #999);
  }
  .meta {
    margin-top: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #777);
  }
  .steps { display: flex; flex-direction: column; gap: 8px; }
  .step {
    padding: 12px 16px;
    border-radius: 6px;
    border: 1px solid var(--vscode-panel-border, #333);
    background: var(--vscode-editor-inactiveSelectionBackground, #252525);
    transition: all 0.3s ease;
  }
  .step.running {
    border-color: #58a6ff;
    background: rgba(88, 166, 255, 0.08);
    animation: pulse 2s infinite;
  }
  .step.success {
    border-color: #3fb950;
    background: rgba(63, 185, 80, 0.06);
  }
  .step.error {
    border-color: #f85149;
    background: rgba(248, 81, 73, 0.06);
  }
  .step-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .step-icon { font-size: 16px; flex-shrink: 0; }
  .step-label { font-size: 13px; font-weight: 600; flex: 1; }
  .step-duration { font-size: 11px; color: var(--vscode-descriptionForeground, #777); }
  .step-detail {
    margin-top: 6px;
    padding-left: 30px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #999);
    line-height: 1.5;
  }
  .code-block {
    margin-top: 8px;
    margin-left: 30px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #333);
    border-radius: 4px;
    overflow: hidden;
  }
  .code-block pre {
    padding: 10px 14px;
    font-size: 11px;
    line-height: 1.5;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
  }
  .code-block code {
    font-family: var(--vscode-editor-font-family, 'SF Mono', monospace);
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
  .progress-bar {
    margin-top: 8px;
    margin-left: 30px;
    height: 3px;
    background: var(--vscode-panel-border, #333);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    width: 40%;
    background: #58a6ff;
    border-radius: 2px;
    animation: slide 1.5s ease-in-out infinite;
  }
  .final-banner {
    margin-top: 20px;
    padding: 16px 20px;
    border-radius: 6px;
    font-size: 16px;
    font-weight: bold;
    text-align: center;
  }
  .final-banner.success {
    background: rgba(63, 185, 80, 0.12);
    border: 2px solid #3fb950;
    color: #3fb950;
  }
  .final-banner.error {
    background: rgba(248, 81, 73, 0.12);
    border: 2px solid #f85149;
    color: #f85149;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.85; }
  }
  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="title">🤖 Bug Fix Agent v2.0 — Live Run</div>
    <div class="bug-desc">🐛 ${escapeHtml(this._bugDescription)}</div>
    <div class="meta">Elapsed: ${elapsed}s</div>
  </div>
  <div class="steps">${stepsHtml}</div>
  ${finalBanner}
  ${finalResult === undefined ? '<script>setTimeout(()=>location.reload(), 2000)</script>' : ''}
</body>
</html>`;
  }

  public dispose(): void {
    LivePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
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
