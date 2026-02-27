import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig } from './config';

export interface VisualAnalysisResult {
  screenshot: string;
  assessment: string;
  issues: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface VisualReport {
  bugDescription: string;
  overallAssessment: string;
  screenshots: VisualAnalysisResult[];
  passed: boolean;
}

export async function analyzeScreenshots(
  config: AgentConfig,
  bugDescription: string,
  screenshotPaths: string[]
): Promise<VisualReport> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const results: VisualAnalysisResult[] = [];

  for (const screenshotPath of screenshotPaths) {
    if (!fs.existsSync(screenshotPath)) {
      continue;
    }

    const imageData = fs.readFileSync(screenshotPath);
    const base64Image = imageData.toString('base64');
    const mediaType = getMediaType(screenshotPath);

    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `You are a QA visual testing expert. Analyze this screenshot taken after applying a bug fix.

## Bug Description
${bugDescription}

## Task
1. Does the UI look correct and properly rendered?
2. Are there any visual issues (misalignment, overflow, missing elements, broken layout)?
3. Based on the bug description, does it look like the fix was applied successfully?
4. Rate your confidence: high, medium, or low

Respond in this JSON format:
{
  "assessment": "Brief overall assessment",
  "issues": ["list of visual issues found, empty if none"],
  "confidence": "high|medium|low",
  "fixApplied": true/false
}`,
            },
          ],
        },
      ],
    });

    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        results.push({
          screenshot: screenshotPath,
          assessment: parsed.assessment || 'No assessment available',
          issues: parsed.issues || [],
          confidence: parsed.confidence || 'low',
        });
      }
    } catch {
      results.push({
        screenshot: screenshotPath,
        assessment: responseText,
        issues: [],
        confidence: 'low',
      });
    }
  }

  // Generate overall report
  const hasIssues = results.some(r => r.issues.length > 0);
  const allHighConfidence = results.every(r => r.confidence === 'high');

  return {
    bugDescription,
    overallAssessment: generateOverallAssessment(results),
    screenshots: results,
    passed: !hasIssues && allHighConfidence,
  };
}

function generateOverallAssessment(results: VisualAnalysisResult[]): string {
  if (results.length === 0) {
    return 'No screenshots were available for visual analysis.';
  }

  const issueCount = results.reduce((sum, r) => sum + r.issues.length, 0);
  const highConfidence = results.filter(r => r.confidence === 'high').length;

  if (issueCount === 0 && highConfidence === results.length) {
    return 'All screenshots look correct. No visual issues detected. High confidence that the fix is applied correctly.';
  }

  if (issueCount > 0) {
    return `Found ${issueCount} visual issue(s) across ${results.length} screenshot(s). Manual review recommended.`;
  }

  return `Analysis complete with ${highConfidence}/${results.length} high-confidence results. Some screenshots may need manual review.`;
}

function getMediaType(filePath: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}
