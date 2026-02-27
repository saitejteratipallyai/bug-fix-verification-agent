# Bug Fix Verification Agent

A VS Code extension that automatically verifies bug fixes using AI-powered browser testing. It generates Playwright tests from bug descriptions, records video of test execution, and provides Claude Vision analysis of the results.

## Features

- **AI Test Generation** — Describe a bug, get a runnable Playwright test
- **Video Recording** — Every test run produces a video of the browser session
- **Self-Healing Tests** — Failed tests are automatically regenerated up to 3 times
- **Claude Vision Analysis** — Screenshots are analyzed by AI for visual correctness
- **GitHub Actions Integration** — Automatically runs on bug fix PRs
- **PR Comments** — Posts pass/fail status and video artifacts to your PR
- **Local CLI** — Run the full pipeline from your terminal

## Quick Start

### 1. Install the Extension

From VS Code Marketplace:

```
ext install bug-fix-agent.bug-fix-verification-agent
```

Or build from source:

```bash
cd bug-fix-agent
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### 2. Set Your API Key

Open VS Code Settings and search for "Bug Fix Agent", then set your Anthropic API key.

Or set it as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Initialize Your Project

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

```
Bug Fix Agent: Initialize Project Config
```

This creates a `test-context.md` file. Edit it to describe your app's routes, components, and `data-testid` attributes for better test generation.

### 4. Setup Playwright

Run from the Command Palette:

```
Bug Fix Agent: Setup Playwright
```

This installs Playwright and browser binaries.

### 5. Verify a Bug Fix

Run from the Command Palette:

```
Bug Fix Agent: Verify Bug Fix
```

You'll be prompted to:
1. Describe the bug
2. Confirm the changed files
3. Choose whether to start the dev server

The extension will then:
1. Generate a Playwright test using Claude
2. Run the test with video recording
3. Retry up to 3 times if the test fails (self-healing)
4. Analyze screenshots with Claude Vision
5. Show results in a rich webview panel

## Commands

| Command | Description |
|---------|-------------|
| `Bug Fix Agent: Verify Bug Fix` | Full verification pipeline |
| `Bug Fix Agent: Verify Bug Fix from PR` | Pull bug description from a GitHub PR |
| `Bug Fix Agent: Setup Playwright` | Install Playwright + browsers |
| `Bug Fix Agent: Initialize Project Config` | Create test-context.md and directories |
| `Bug Fix Agent: Generate Test Only` | Generate a test without running it |
| `Bug Fix Agent: Run Generated Tests` | Run existing generated tests |
| `Bug Fix Agent: Analyze Screenshots with AI` | Run Claude Vision on selected screenshots |
| `Bug Fix Agent: View Verification Results` | Open the results panel |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `bugFixAgent.anthropicApiKey` | `""` | Anthropic API key |
| `bugFixAgent.baseUrl` | `http://localhost:3000` | Dev server URL |
| `bugFixAgent.devServerCommand` | `npm run dev` | Command to start the dev server |
| `bugFixAgent.devServerPort` | `3000` | Dev server port |
| `bugFixAgent.browser` | `chromium` | Browser to test with |
| `bugFixAgent.headless` | `true` | Run browser in headless mode |
| `bugFixAgent.maxRetries` | `3` | Self-healing retry attempts |
| `bugFixAgent.timeout` | `30000` | Test timeout (ms) |
| `bugFixAgent.claudeModel` | `claude-sonnet-4-5-20250929` | Claude model for generation |
| `bugFixAgent.enableVisualAnalysis` | `true` | Enable Claude Vision analysis |
| `bugFixAgent.videoResolution` | `1280x720` | Video recording resolution |
| `bugFixAgent.outputDir` | `test-results` | Output directory for artifacts |

## CLI Usage

Run the full pipeline from your terminal:

```bash
npm run verify-fix -- --bug "dropdown menu doesn't close on outside click"
```

Options:

```
--bug "description"    Bug description (required)
--files "a.tsx,b.tsx"  Changed files (auto-detected from git)
--base-url URL         Dev server URL (default: http://localhost:3000)
--retries N            Max retry attempts (default: 3)
--ci                   CI mode (non-interactive)
```

## GitHub Actions

The extension includes a GitHub Actions workflow that automatically verifies bug fix PRs.

### Setup

1. Add `ANTHROPIC_API_KEY` as a repository secret
2. Copy `.github/workflows/verify-bug-fix.yml` to your repo
3. Label bug fix PRs with `bug` or use title prefixes: `fix:`, `bugfix:`

### Trigger

The workflow runs when:
- A PR is opened/updated with the `bug` label
- A PR title starts with `fix:`, `bugfix:`, `Fix:`, or `Bug:`

### Output

- Pass/fail status commented on the PR
- Video recordings uploaded as workflow artifacts
- Claude Vision analysis included in the PR comment

## How It Works

```
Bug Description + Changed Files
         │
         ▼
  ┌─────────────┐
  │ Claude API   │ ── Generates Playwright test
  └─────────────┘
         │
         ▼
  ┌─────────────┐
  │ Playwright   │ ── Runs test with video recording
  └─────────────┘
         │
    Pass? ──── No ──▶ Self-healing (retry up to 3x)
         │                    │
        Yes                   │
         │◀───────────────────┘
         ▼
  ┌─────────────┐
  │ Claude Vision│ ── Analyzes screenshots
  └─────────────┘
         │
         ▼
    Results Panel / PR Comment
```

## Project Structure

```
your-project/
├── playwright.config.ts          # Generated by the extension
├── test-context.md               # Your app context for better tests
├── tests/
│   ├── generated/                # AI-generated tests (gitignored)
│   │   └── .gitignore
│   └── manual/                   # Your hand-written tests
├── test-results/                 # Output (gitignored)
│   ├── *.webm                    # Video recordings
│   ├── *.png                     # Screenshots
│   └── trace.zip                 # Playwright trace
└── .github/
    └── workflows/
        └── verify-bug-fix.yml    # CI pipeline
```

## Tips

- Edit `test-context.md` to describe your app's routes, components, and test IDs — this dramatically improves test generation quality
- Use `data-testid` attributes on key interactive elements
- Use `--headed` mode locally to watch tests run: set `bugFixAgent.headless` to `false`
- Use Playwright's UI mode during development: `npx playwright test --ui`

## Requirements

- Node.js 18+
- VS Code 1.85+
- Anthropic API key (Claude)
- A React app (or any web app with a dev server)

## License

MIT
