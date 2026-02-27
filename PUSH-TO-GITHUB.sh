#!/bin/bash
# ============================================
# Run this script once you regain GitHub access
# ============================================

set -e

echo "🔑 Step 1: Authenticate with GitHub..."
gh auth login

echo ""
echo "📦 Step 2: Creating GitHub repo and pushing..."
cd "$(dirname "$0")"

gh repo create bug-fix-verification-agent \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "AI-powered VS Code extension that automatically verifies bug fixes using Playwright browser testing, video recording, and Claude Vision analysis"

echo ""
echo "✅ Done! Your repo is live at:"
gh repo view --web

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "  1. Add your ANTHROPIC_API_KEY as a repo secret:"
echo "     gh secret set ANTHROPIC_API_KEY"
echo ""
echo "  2. To publish to VS Code Marketplace:"
echo "     npx vsce login your-publisher-name"
echo "     npx vsce publish"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
