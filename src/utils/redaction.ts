// Best-effort masking. Callers must still inspect private code before sending it.
export const sensitiveLine =
  /(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key|authorization)\s*[:=]|Bearer\s+[A-Za-z0-9._-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}/i;

export function safeLine(line: string): string {
  return sensitiveLine.test(line) ? '[redacted: possible credential]' : line;
}
