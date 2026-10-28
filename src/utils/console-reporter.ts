import type { Review } from '../reviewers/angular.reviewer.js';
import type { AgentResult } from '../agent/angular-agent.js';

const scopeLabel = (scope: AgentResult['scope']): string =>
  scope === 'focused area' ? 'focused area' : 'bounded area';

export function formatReview(filePath: string, review: Review): string {
  const output = [
    '=================================',
    '       AI ANGULAR REVIEWER',
    '=================================',
    '',
    `File: ${filePath}`,
    '',
  ];

  if (review.issues.length === 0) {
    output.push('No credible issues found.', '');
  }

  for (const issue of review.issues) {
    const location =
      issue.lineStart === issue.lineEnd
        ? `Line ${issue.lineStart}`
        : `Lines ${issue.lineStart}-${issue.lineEnd}`;
    output.push(
      `[${issue.severity}] ${location}`,
      `Problem: ${issue.problem}`,
      '',
      'Why:',
      issue.why,
      '',
      'Suggestion:',
      issue.suggestion,
      '',
      '---------------------------------',
      '',
    );
  }

  if (review.limitations.length > 0) {
    output.push('Limitations:', ...review.limitations.map((item) => `- ${item}`), '');
  }

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of review.issues) counts[issue.severity]++;

  output.push(
    'Review completed.',
    `Issues found: ${review.issues.length}`,
    `HIGH: ${counts.HIGH} | MEDIUM: ${counts.MEDIUM} | LOW: ${counts.LOW}`,
  );
  return output.join('\n');
}

export function formatProjectReview(result: AgentResult): string {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of result.review.issues) counts[issue.severity]++;
  const lines = [
    '---------------------------------',
    '',
    'CODE REVIEW',
    '',
    `Project: ${result.project}`,
    `Scope: ${scopeLabel(result.scope)}`,
    `Files read: ${result.readFiles.length}`,
    ...result.readFiles.map((file) => `- ${file}`),
    '',
  ];
  for (const severity of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    for (const issue of result.review.issues.filter((item) => item.severity === severity)) {
      lines.push(
        `[${issue.severity}] ${issue.path}:${issue.lineStart}${issue.lineEnd === issue.lineStart ? '' : `-${issue.lineEnd}`}`,
        `Problem: ${issue.problem}`,
        '',
        `Why: ${issue.why}`,
        '',
        `Suggestion: ${issue.suggestion}`,
        '',
        '---------------------------------',
        '',
      );
    }
  }
  if (!result.review.issues.length) lines.push('No confirmed issues in the files read.', '');
  if (result.review.limitations.length)
    lines.push('Limitations:', ...result.review.limitations.map((item) => `- ${item}`), '');
  lines.push(
    `Issues found: ${result.review.issues.length}`,
    `HIGH: ${counts.HIGH} | MEDIUM: ${counts.MEDIUM} | LOW: ${counts.LOW}`,
    `Tool calls: ${result.toolCalls} | Model rounds: ${result.rounds}`,
    `Tokens: input ${result.inputTokens}, output ${result.outputTokens}`,
    result.complete ? 'Bounded review completed.' : 'Review incomplete.',
  );
  return lines.join('\n');
}

export function formatMarkdownReview(filePath: string, review: Review): string {
  const lines = [`# File review: ${filePath}`, '', `Issues: ${review.issues.length}`, ''];
  for (const issue of review.issues) {
    lines.push(
      `## ${issue.severity}: lines ${issue.lineStart}-${issue.lineEnd}`,
      '',
      `**Problem:** ${issue.problem}`,
      '',
      `**Why:** ${issue.why}`,
      '',
      `**Suggestion:** ${issue.suggestion}`,
      '',
    );
  }
  lines.push('## Limitations', '', ...review.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}

export function formatMarkdownProjectReview(result: AgentResult): string {
  const lines = [
    `# Project review: ${result.project}`,
    '',
    `Scope: ${scopeLabel(result.scope)}. Review status: ${result.complete ? 'completed' : 'incomplete'}.`,
    '',
    '## Files read',
    '',
    ...result.readFiles.map((file) => `- ${file}`),
    '',
    '## Issues',
    '',
  ];
  for (const issue of result.review.issues) {
    lines.push(
      `### ${issue.severity}: ${issue.path}:${issue.lineStart}-${issue.lineEnd}`,
      '',
      `**Problem:** ${issue.problem}`,
      '',
      `**Why:** ${issue.why}`,
      '',
      `**Suggestion:** ${issue.suggestion}`,
      '',
    );
  }
  lines.push('## Limitations', '', ...result.review.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}
