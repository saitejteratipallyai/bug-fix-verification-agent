# 🤖 Bug Fix Verification Agent

**AI-powered bug fix verification for VS Code** — Describe a bug, and the agent generates Playwright tests, runs them in a real browser with video recording, self-heals failing tests, and analyzes screenshots with Claude Vision.

[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=bug-fix-agent.bug-fix-verification-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Playwright](https://img.shields.io/badge/Playwright-Powered-green?logo=playwright)](https://playwright.dev)
[![Claude AI](https://img.shields.io/badge/Claude-AI-purple?logo=anthropic)](https://anthropic.com)

---

## 🎬 Demo

> The agent detects a bug, generates a test, applies the fix, and verifies it — all automatically.

![Agent Demo](https://raw.githubusercontent.com/saitejteratipallyai/bug-fix-verification-agent/main/demo/agent-terminal-demo.gif)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧠 **AI Test Generation** | Describe a bug in plain English → get a runnable Playwright test |
| 📹 **Video Recording** | Every test run produces a video of the browser session |
| 🔧 **Self-Healing Tests** | Failed tests are sent back to Claude with error context and regenerated (up to 3x) |
| 👁️ **Claude Vision Analysis** | Screenshots are analyzed by AI for visual correctness and confidence scoring |
| 🔄 **GitHub Actions CI** | Automatically runs on bug fix PRs labeled `bug` or titled `fix:` |
| 💬 **PR Comments** | Posts pass/fail status, video artifacts, and analysis to your PR |
| 💻 **CLI Support** | Run the full pipeline from your terminal |
| 🎯 **Context-Aware** | Uses `test-context.md` to understand your app's routes, components, and test IDs |

---

## 📦 Installation

### Option 1: VS Code Marketplace (Recommended)

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for **"Bug Fix Verification Agent"**
4. Click **Install**

Or run from the command palette:
```
ext install bug-fix-agent.bug-fix-verification-agent
```

### Option 2: Install from .vsix file

Download the latest `.vsix` from [Releases](https://github.com/saitejteratipallyai/bug-fix-verification-agent/releases), then:

```bash
code --install-extension bug-fix-verification-agent-1.0.0.vsix
```

### Option 3: Build from Source

```bash
git clone https://github.com/saitejteratipallyai/bug-fix-verification-agent.git
cd bug-fix-verification-agent
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

---

## 🚀 Quick Start

### 1. Set Your Anthropic API Key

Open **Settings** → search **"Bug Fix Agent"** → paste your API key.

Or set it as an environment variable:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

> Get your API key at [console.anthropic.com](https://console.anthropic.com)

### 2. Initialize Your Project

Open Command Palette (`Cmd+Shift+P`) → run:
```
Bug Fix Agent: Initialize Project Config
```

This creates:
- `test-context.md` — Describe your app for better AI test generation
- `tests/generated/` — Where AI-generated tests go
- `tests/manual/` — Your hand-written tests

### 3. Setup Playwright

```
Bug Fix Agent: Setup Playwright
```

Installs Playwright and browser binaries (Chromium by default).

### 4. Verify a Bug Fix

```
Bug Fix Agent: Verify Bug Fix
```

You'll be prompted to:
1. **Describe the bug** (e.g., "Counter reset button doesn't reset to zero")
2. **Confirm changed files** (auto-detected from git)
3. **Start dev server** (optional)

The agent then:
1. 🧠 Generates a Playwright test using Claude
2. 🎬 Runs it in a real browser with video recording
3. 🔧 If it fails, sends the error back to Claude and retries (self-healing)
4. 👁️ Analyzes screenshots with Claude Vision
5. 📊 Shows results in a rich webview panel

---

## 🔄 How It Works

```
  Bug Description + Changed Files
           │
           ▼
    ┌─────────────┐
    │  Claude AI   │ ── Generates Playwright test from bug description
    └─────────────┘
           │
           ▼
    ┌─────────────┐
    │  Playwright  │ ── Runs test with video + screenshot capture
    └─────────────┘
           │
      Pass? ──── No ──▶ Self-Healing Loop (up to 3 retries)
           │                    │ Sends error + test back to Claude
          Yes                   │ Claude regenerates a smarter test
           │◀───────────────────┘
           ▼
    ┌──────────────┐
    │ Claude Vision │ ── Analyzes screenshots for visual issues
    └──────────────┘
           │
           ▼
    ✅ Results Panel / PR Comment / Video Artifact
```

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `Bug Fix Agent: Verify Bug Fix` | Full verification pipeline |
| `Bug Fix Agent: Verify Bug Fix from PR` | Pull bug info from a GitHub PR |
| `Bug Fix Agent: Setup Playwright` | Install Playwright + browsers |
| `Bug Fix Agent: Initialize Project Config` | Create test-context.md and directories |
| `Bug Fix Agent: Generate Test Only` | Generate a test without running it |
| `Bug Fix Agent: Run Generated Tests` | Run existing generated tests |
| `Bug Fix Agent: Analyze Screenshots with AI` | Run Claude Vision on screenshots |
| `Bug Fix Agent: View Verification Results` | Open the results panel |

---

## ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `bugFixAgent.anthropicApiKey` | `""` | Anthropic API key |
| `bugFixAgent.baseUrl` | `http://localhost:3000` | Dev server URL |
| `bugFixAgent.devServerCommand` | `npm run dev` | Command to start dev server |
| `bugFixAgent.devServerPort` | `3000` | Dev server port |
| `bugFixAgent.browser` | `chromium` | Browser (`chromium`, `firefox`, `webkit`) |
| `bugFixAgent.headless` | `true` | Run browser in headless mode |
| `bugFixAgent.maxRetries` | `3` | Self-healing retry attempts |
| `bugFixAgent.timeout` | `30000` | Test timeout in ms |
| `bugFixAgent.claudeModel` | `claude-sonnet-4-5-20250929` | Claude model for generation |
| `bugFixAgent.enableVisualAnalysis` | `true` | Enable Claude Vision analysis |
| `bugFixAgent.videoResolution` | `1280x720` | Video recording resolution |
| `bugFixAgent.outputDir` | `test-results` | Output directory for artifacts |

---

## 💻 CLI Usage

Run the full pipeline from your terminal without VS Code:

```bash
# Basic usage
npm run verify-fix -- --bug "dropdown menu doesn't close on outside click"

# With specific files
npm run verify-fix -- --bug "login form validation broken" --files "src/Login.tsx,src/utils/validate.ts"

# CI mode (non-interactive, exits with code 0/1)
npm run verify-fix -- --bug "cart total wrong" --ci

# Custom server URL
npm run verify-fix -- --bug "search not working" --base-url http://localhost:8080
```

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--bug "description"` | Bug description (required) | — |
| `--files "a.tsx,b.tsx"` | Changed files | Auto-detected from git |
| `--base-url URL` | Dev server URL | `http://localhost:3000` |
| `--retries N` | Max retry attempts | `3` |
| `--ci` | CI mode (non-interactive) | `false` |

---

## 🔗 GitHub Actions Integration

Automatically verify bug fix PRs in CI.

### Setup

1. Add `ANTHROPIC_API_KEY` as a **repository secret**
2. Copy `.github/workflows/verify-bug-fix.yml` to your repo
3. Label bug fix PRs with `bug` or use title prefixes: `fix:`, `bugfix:`

### What Happens

When a PR is opened/updated:
1. The workflow detects if it's a bug fix (by label or title)
2. Runs the verification pipeline
3. Posts a comment on the PR with:
   - ✅/❌ Pass/fail status
   - Claude Vision analysis summary
   - Link to video recording artifact
4. Uploads video + screenshots as workflow artifacts

### Example PR Comment

```
## 🤖 Bug Fix Verification Results

**Status: ✅ PASSED** (attempt 2/3)

### Test Generation
Generated 28-line Playwright test for: "Counter reset doesn't work"

### Test Result
- Duration: 4.2s
- Video: 📹 [Download](link-to-artifact)

### Claude Vision Analysis
> "The UI renders correctly. Counter displays 0 after reset.
>  No visual issues detected. Confidence: HIGH"
```

---

## 📁 Project Structure

After initialization, your project will have:

```
your-project/
├── playwright.config.ts          # Auto-generated Playwright config
├── test-context.md               # Your app context (edit this!)
├── tests/
│   ├── generated/                # AI-generated tests (gitignored)
│   └── manual/                   # Your hand-written tests
├── test-results/                 # Output artifacts (gitignored)
│   ├── *.webm                    # Video recordings
│   ├── *.png                     # Screenshots
│   └── trace.zip                 # Playwright traces
└── .github/
    └── workflows/
        └── verify-bug-fix.yml    # CI pipeline
```

---

## 💡 Tips for Best Results

1. **Edit `test-context.md`** — Describe your app's routes, components, and data-testid attributes. This dramatically improves test generation quality.

2. **Use `data-testid` attributes** — Add them to key interactive elements:
   ```html
   <button data-testid="submit-btn">Submit</button>
   ```

3. **Watch tests run locally** — Set `bugFixAgent.headless` to `false` to see the browser.

4. **Use Playwright UI mode** for debugging:
   ```bash
   npx playwright test --ui
   ```

5. **Write a good bug description** — Be specific:
   - ❌ "Button broken"
   - ✅ "Counter reset button doesn't reset the count to zero — after incrementing to 5 and clicking reset, the counter stays at 5"

---

## 🔧 Requirements

- **Node.js** 18+
- **VS Code** 1.85+
- **Anthropic API key** — [Get one here](https://console.anthropic.com)
- A web app with a dev server (React, Next.js, Vue, Svelte, etc.)

---

## 🛠️ Tech Stack

- **TypeScript** — Extension core
- **Playwright** — Browser automation & video recording
- **Claude AI (Anthropic)** — Test generation & self-healing
- **Claude Vision** — Screenshot analysis
- **VS Code Extension API** — Editor integration
- **GitHub Actions** — CI/CD pipeline

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

**Built with ❤️ using Claude AI + Playwright**
