import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../lib/config';

const TEST_CONTEXT_TEMPLATE = `# Test Context

This file helps the AI generate better tests by providing context about your app.

## Routes
<!-- List your app's routes -->
- / — Home page
- /login — Login page
- /dashboard — Dashboard (requires auth)

## Key Components
<!-- List important components and their data-testid attributes -->
- Header: data-testid="header"
- Navigation: data-testid="nav-menu"
- Login Form: data-testid="login-form"

## Authentication
<!-- Describe how auth works in your app -->
- Uses JWT tokens stored in localStorage
- Test credentials: test@example.com / password123

## Common Interactions
<!-- Describe common user flows -->
1. Login: Navigate to /login, fill email + password, click submit
2. Navigation: Click menu items in the sidebar

## Known Test IDs
<!-- List all data-testid attributes in your app -->
\`\`\`
header
nav-menu
login-form
login-email
login-password
login-submit
\`\`\`
`;

export async function initProjectCommand(): Promise<void> {
  const config = getConfig();

  const testContextPath = path.join(config.workspaceRoot, 'test-context.md');
  const testsDir = path.join(config.workspaceRoot, 'tests');
  const generatedDir = path.join(testsDir, 'generated');
  const manualDir = path.join(testsDir, 'manual');

  // Create directories
  for (const dir of [generatedDir, manualDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create test-context.md
  if (!fs.existsSync(testContextPath)) {
    fs.writeFileSync(testContextPath, TEST_CONTEXT_TEMPLATE);
    const doc = await vscode.workspace.openTextDocument(testContextPath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
      'Created test-context.md. Edit it to describe your app for better test generation.'
    );
  } else {
    vscode.window.showInformationMessage('test-context.md already exists.');
  }

  // Create .gitignore for generated tests
  const gitignorePath = path.join(generatedDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*.spec.ts\n');
  }

  vscode.window.showInformationMessage('Project initialized for Bug Fix Agent.');
}
