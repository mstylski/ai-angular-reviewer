import { z } from 'zod';

export const issueSchema = z.object({
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  problem: z.string().trim().min(1),
  why: z.string().trim().min(1),
  suggestion: z.string().trim().min(1),
});

export function validIssueLocation(
  issue: { lineStart: number; lineEnd: number },
  lineCount: number,
): boolean {
  return (
    Number.isSafeInteger(issue.lineStart) &&
    Number.isSafeInteger(issue.lineEnd) &&
    issue.lineStart >= 1 &&
    issue.lineEnd >= issue.lineStart &&
    issue.lineEnd <= lineCount
  );
}
