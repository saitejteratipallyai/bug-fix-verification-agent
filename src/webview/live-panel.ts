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
  private _initialized: boolean = false;

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
      LivePanel.currentPanel._initialized = false;
      LivePanel.currentPanel._setInitialHtml();
      return LivePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'bugFixAgentLive',
      '\u{1F916} Bug Fix Agent \u2014 Live',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    LivePanel.currentPanel = new LivePanel(panel);
    LivePanel.currentPanel._bugDescription = bugDescription;
    LivePanel.currentPanel._setInitialHtml();
    return LivePanel.currentPanel;
  }

  public addStep(step: LiveStep): void {
    const existing = this._steps.find(s => s.id === step.id);
    if (existing) {
      Object.assign(existing, step);
    } else {
      this._steps.push(step);
    }
    this._sendUpdate();
  }

  public updateStep(id: string, updates: Partial<LiveStep>): void {
    const step = this._steps.find(s => s.id === id);
    if (step) {
      Object.assign(step, updates);
      this._sendUpdate();
    }
  }

  public setAllComplete(success: boolean): void {
    this._sendUpdate(success);
  }

  /** Send step data to the webview via postMessage — no flicker */
  private _sendUpdate(finalResult?: boolean): void {
    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
    this._panel.webview.postMessage({
      type: 'update',
      steps: this._steps,
      elapsed,
      finalResult
    });
  }

  /** Set the initial HTML once — all further updates go through postMessage */
  private _setInitialHtml(): void {
    this._initialized = true;
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
    border-radius: 6px;
    border: 1px solid var(--vscode-panel-border, #333);
    background: var(--vscode-editor-inactiveSelectionBackground, #252525);
    transition: all 0.3s ease;
    overflow: hidden;
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
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
  }
  .step-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .step.pending .step-header {
    cursor: default;
  }
  .step.pending .step-header:hover {
    background: transparent;
  }
  .step-chevron {
    font-size: 10px;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    color: var(--vscode-descriptionForeground, #777);
    width: 14px;
    text-align: center;
  }
  .step-chevron.expanded {
    transform: rotate(90deg);
  }
  .step-chevron.hidden {
    visibility: hidden;
  }
  .step-icon { font-size: 16px; flex-shrink: 0; }
  .step-label { font-size: 13px; font-weight: 600; flex: 1; word-break: break-word; }
  .step-duration { font-size: 11px; color: var(--vscode-descriptionForeground, #777); }
  .step-body {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease;
  }
  .step-body.expanded {
    max-height: 2000px;
  }
  .step-body-inner {
    padding: 0 16px 12px 52px;
  }
  .step-detail {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #999);
    line-height: 1.5;
    margin-bottom: 8px;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .code-block {
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
    max-height: 300px;
    overflow-y: auto;
  }
  .code-block code {
    font-family: var(--vscode-editor-font-family, 'SF Mono', monospace);
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
  .progress-bar {
    margin: 0 16px 12px 52px;
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
    <div class="title">\u{1F916} Bug Fix Agent v2.0 \u2014 Live Run</div>
    <div class="bug-desc">\u{1F41B} ${escapeHtml(this._bugDescription)}</div>
    <div class="meta" id="elapsed">Elapsed: 0.0s</div>
  </div>
  <div class="steps" id="steps-container"></div>
  <div id="final-banner-container"></div>

  <script>
    const vscode = acquireVsCodeApi();

    // Track which steps are expanded (persists across updates)
    const expandedSteps = new Set();

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function getIcon(status) {
      switch(status) {
        case 'running': return '\u23F3';
        case 'success': return '\u2705';
        case 'error': return '\u274C';
        case 'skipped': return '\u23ED\uFE0F';
        default: return '\u2B1C';
      }
    }

    function toggleStep(stepId) {
      if (expandedSteps.has(stepId)) {
        expandedSteps.delete(stepId);
      } else {
        expandedSteps.add(stepId);
      }
      // Re-render with updated expand state
      const stepEl = document.querySelector('[data-step-id="' + stepId + '"]');
      if (!stepEl) return;

      const chevron = stepEl.querySelector('.step-chevron');
      const body = stepEl.querySelector('.step-body');
      if (chevron && body) {
        if (expandedSteps.has(stepId)) {
          chevron.classList.add('expanded');
          body.classList.add('expanded');
        } else {
          chevron.classList.remove('expanded');
          body.classList.remove('expanded');
        }
      }
    }

    function renderStep(step) {
      const durationStr = step.duration ? ' (' + (step.duration / 1000).toFixed(1) + 's)' : '';
      const hasContent = step.detail || step.code;
      const isExpanded = expandedSteps.has(step.id);

      // Auto-expand running steps and newly completed steps with content
      if (step.status === 'running' && hasContent) {
        expandedSteps.add(step.id);
      }

      const chevronClass = hasContent
        ? ('step-chevron' + (isExpanded ? ' expanded' : ''))
        : 'step-chevron hidden';

      let bodyContent = '';
      if (hasContent) {
        let inner = '';
        if (step.detail) {
          inner += '<div class="step-detail">' + escapeHtml(step.detail) + '</div>';
        }
        if (step.code) {
          inner += '<div class="code-block"><pre><code>' + escapeHtml(step.code) + '</code></pre></div>';
        }
        bodyContent = '<div class="step-body' + (isExpanded ? ' expanded' : '') + '">'
          + '<div class="step-body-inner">' + inner + '</div></div>';
      }

      let progressBar = '';
      if (step.status === 'running') {
        progressBar = '<div class="progress-bar"><div class="progress-fill"></div></div>';
      }

      return '<div class="step ' + step.status + '" data-step-id="' + step.id + '">'
        + '<div class="step-header" data-toggle="' + step.id + '">'
        + '<span class="' + chevronClass + '">\u25B6</span>'
        + '<span class="step-icon">' + getIcon(step.status) + '</span>'
        + '<span class="step-label">' + escapeHtml(step.label) + '</span>'
        + '<span class="step-duration">' + durationStr + '</span>'
        + '</div>'
        + bodyContent
        + progressBar
        + '</div>';
    }

    // Delegated click handler for step headers
    document.addEventListener('click', function(e) {
      const header = e.target.closest('[data-toggle]');
      if (header) {
        toggleStep(header.getAttribute('data-toggle'));
      }
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        // Update elapsed time
        const elapsedEl = document.getElementById('elapsed');
        if (elapsedEl) {
          elapsedEl.textContent = 'Elapsed: ' + msg.elapsed + 's';
        }

        // Update steps
        const container = document.getElementById('steps-container');
        if (container) {
          const newHtml = msg.steps.map(renderStep).join('');
          container.innerHTML = newHtml;
        }

        // Update final banner
        const bannerContainer = document.getElementById('final-banner-container');
        if (bannerContainer) {
          if (msg.finalResult === true) {
            bannerContainer.innerHTML = '<div class="final-banner success">\u2705 Bug Fixed & Verified Successfully!</div>';
          } else if (msg.finalResult === false) {
            bannerContainer.innerHTML = '<div class="final-banner error">\u274C Fix Failed \u2014 See details above</div>';
          } else {
            bannerContainer.innerHTML = '';
          }
        }

        // Auto-scroll to show latest running step
        const runningSteps = document.querySelectorAll('.step.running');
        if (runningSteps.length > 0) {
          runningSteps[runningSteps.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  </script>
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
