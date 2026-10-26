import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ToolLimits {
  maxToolCalls: number;
  maxRounds: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ToolLimits = {
  maxToolCalls: 8,
  maxRounds: 8,
  maxFiles: 8,
  maxFileBytes: 20 * 1024,
  maxTotalBytes: 80 * 1024,
};

export function limitsFromEnvironment(env: NodeJS.ProcessEnv = process.env): ToolLimits {
  const names: Record<keyof ToolLimits, string> = {
    maxToolCalls: 'REVIEW_MAX_TOOL_CALLS', maxRounds: 'REVIEW_MAX_ROUNDS',
    maxFiles: 'REVIEW_MAX_FILES', maxFileBytes: 'REVIEW_MAX_FILE_BYTES',
    maxTotalBytes: 'REVIEW_MAX_TOTAL_BYTES',
  };
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(names) as (keyof ToolLimits)[]) {
    const raw = env[names[key]];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${names[key]} must be a positive integer.`);
    limits[key] = value;
  }
  return limits;
}

const ignored = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage', 'build', 'out', '.next']);
const secretName = /(^\.|(?:^|[._-])(secret|credential|password|private|api-key|token)(?:[._-]|$)|^environments?(?:[._-]|$))/i;
const allowedExtension = new Set(['.ts', '.html']);
const sensitiveLine = /(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key|authorization)\s*[:=]|Bearer\s+[A-Za-z0-9._-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}/i;
const safeLine = (line: string): string => sensitiveLine.test(line) ? '[redacted: possible credential]' : line;
const MAX_SCAN_FILES = 500;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

export class ProjectTools {
  readonly root: string;
  readonly limits: ToolLimits;
  readonly readFiles = new Map<string, number>();
  toolCalls = 0;
  totalBytes = 0;
  private readonly cache = new Map<string, string>();

  private constructor(root: string, limits: ToolLimits) {
    this.root = root;
    this.limits = limits;
  }

  static async create(directory: string, limits: ToolLimits = DEFAULT_LIMITS): Promise<ProjectTools> {
    const root = await realpath(path.resolve(directory));
    if (!(await stat(root)).isDirectory()) throw new Error('Project path is not a directory.');
    return new ProjectTools(root, limits);
  }

  private inside(absolute: string): boolean {
    const relative = path.relative(this.root, absolute);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  private async resolve(relative: string, file: boolean): Promise<string> {
    if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) {
      throw new Error('Only relative project paths with forward slashes are allowed.');
    }
    const parts = relative.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || ignored.has(part) || secretName.test(part))) {
      throw new Error('Path is excluded or unsafe.');
    }
    if (file && !allowedExtension.has(path.extname(relative).toLowerCase())) {
      throw new Error('Only .ts and .html source files are accessible.');
    }
    const absolute = path.resolve(this.root, ...parts);
    if (!this.inside(absolute)) throw new Error('Path escapes project root.');
    const canonical = await realpath(absolute);
    if (!this.inside(canonical)) throw new Error('Symlink escapes project root.');
    const canonicalParts = path.relative(this.root, canonical).split(path.sep);
    if (canonicalParts.some((part) => ignored.has(part) || secretName.test(part))) throw new Error('Resolved path is excluded.');
    if (file && !allowedExtension.has(path.extname(canonical).toLowerCase())) throw new Error('Resolved file type is excluded.');
    const info = await stat(canonical);
    if (file && !info.isFile() || !file && !info.isDirectory()) throw new Error('Unexpected path type.');
    return canonical;
  }

  async checkFocus(relative: string): Promise<void> {
    await this.resolve(relative, true);
  }

  private async walk(directory: string, recursive: boolean, maxDepth: number, maxFiles: number): Promise<{ files: string[]; truncated: boolean }> {
    const files: string[] = [];
    const visited = new Set<string>();
    let truncated = false;
    const visit = async (current: string, depth: number): Promise<void> => {
      if (visited.has(current)) return;
      visited.add(current);
      const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= maxFiles) { truncated = true; break; }
        if (ignored.has(entry.name) || secretName.test(entry.name)) continue;
        const candidate = path.join(current, entry.name);
        let canonical: string;
        try { canonical = await realpath(candidate); } catch { continue; }
        if (!this.inside(canonical)) continue;
        if (path.relative(this.root, canonical).split(path.sep).some((part) => ignored.has(part) || secretName.test(part))) continue;
        const info = await stat(canonical);
        if (info.isDirectory()) {
          if (recursive && depth < maxDepth) await visit(canonical, depth + 1);
          else if (recursive) truncated = true;
        } else if (info.isFile() && allowedExtension.has(path.extname(entry.name).toLowerCase())) {
          files.push(path.relative(this.root, candidate).split(path.sep).join('/'));
        }
      }
    };
    await visit(directory, 0);
    return { files, truncated };
  }

  async listFiles(directory = 'src/app', recursive = true): Promise<{ files: string[]; truncated: boolean }> {
    const resolved = await this.resolve(directory, false);
    return this.walk(resolved, recursive, 4, 100);
  }

  async readFile(relative: string): Promise<{ path: string; numberedCode: string; lineCount: number; cached: boolean }> {
    const canonical = await this.resolve(relative, true);
    const projectPath = path.relative(this.root, canonical).split(path.sep).join('/');
    const cached = this.cache.get(canonical);
    if (cached !== undefined) return { path: projectPath, numberedCode: cached, lineCount: this.readFiles.get(projectPath)!, cached: true };
    if (this.readFiles.size >= this.limits.maxFiles) throw new Error('File count limit reached.');
    const info = await stat(canonical);
    if (info.size > this.limits.maxFileBytes) throw new Error('File exceeds per-file byte limit.');
    if (this.totalBytes + info.size > this.limits.maxTotalBytes) throw new Error('Total read byte limit reached.');
    const bytes = await readFile(canonical);
    if (bytes.length > this.limits.maxFileBytes || this.totalBytes + bytes.length > this.limits.maxTotalBytes) {
      throw new Error('Read byte limit reached.');
    }
    const code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = code.split(/\r\n|\n|\r/);
    if (lines.at(-1) === '') lines.pop();
    const numberedCode = lines.map((line, index) => `${index + 1} | ${safeLine(line)}`).join('\n');
    this.cache.set(canonical, numberedCode);
    this.readFiles.set(projectPath, lines.length);
    this.totalBytes += bytes.length;
    return { path: projectPath, numberedCode, lineCount: lines.length, cached: false };
  }

  async searchCode(query: string): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    if (!query.trim() || query.length > 120 || /[\r\n]/.test(query)) throw new Error('Search query must be 1–120 characters on one line.');
    const { files, truncated: listTruncated } = await this.walk(this.root, true, 8, MAX_SCAN_FILES);
    const matches: { path: string; line: number; text: string }[] = [];
    let scannedBytes = 0;
    let truncated = listTruncated;
    for (const file of files) {
      const canonical = await this.resolve(file, true);
      const info = await stat(canonical);
      if (info.size > this.limits.maxFileBytes) continue;
      if (scannedBytes + info.size > MAX_SCAN_BYTES) { truncated = true; break; }
      const bytes = await readFile(canonical);
      scannedBytes += bytes.length;
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
      content.split(/\r\n|\n|\r/).forEach((line, index) => {
        if (!sensitiveLine.test(line) && line.includes(query) && matches.length < 30) matches.push({ path: file, line: index + 1, text: line.slice(0, 240) });
        else if (line.includes(query)) truncated = true;
      });
      if (matches.length >= 30) { truncated = true; break; }
    }
    return { matches, truncated };
  }
}
