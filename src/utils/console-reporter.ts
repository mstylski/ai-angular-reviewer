import type { Review } from '../reviewers/angular.reviewer.js';
import type { AgentResult } from '../agent/angular-agent.js';

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
    output.push('Nie wykryto wiarygodnych problemów.', '');
  }

  for (const issue of review.issues) {
    const location = issue.lineStart === issue.lineEnd
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
    output.push('Ograniczenia:', ...review.limitations.map((item) => `- ${item}`), '');
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
    '---------------------------------', '', 'CODE REVIEW', '',
    `Project: ${result.project}`,
    `Files analyzed: ${result.readFiles.length}`,
    ...result.readFiles.map((file) => `- ${file}`), '',
  ];
  for (const severity of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    for (const issue of result.review.issues.filter((item) => item.severity === severity)) {
      lines.push(`[${issue.severity}] ${issue.path}:${issue.lineStart}${issue.lineEnd === issue.lineStart ? '' : `-${issue.lineEnd}`}`,
        `Problem: ${issue.problem}`, '', `Why: ${issue.why}`, '', `Suggestion: ${issue.suggestion}`, '', '---------------------------------', '');
    }
  }
  if (!result.review.issues.length) lines.push('No confirmed issues in the inspected files.', '');
  if (result.review.limitations.length) lines.push('Limitations:', ...result.review.limitations.map((item) => `- ${item}`), '');
  lines.push(`Issues found: ${result.review.issues.length}`,
    `HIGH: ${counts.HIGH} | MEDIUM: ${counts.MEDIUM} | LOW: ${counts.LOW}`,
    `Tool calls: ${result.toolCalls} | Model rounds: ${result.rounds}`,
    `Tokens: input ${result.inputTokens}, output ${result.outputTokens}`,
    result.complete ? 'Review completed.' : 'Review incomplete.');
  return lines.join('\n');
}
