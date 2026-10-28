import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeLine } from './redaction.js';

export const MAX_FILE_BYTES = 100 * 1024;

export interface SourceFile {
  displayPath: string;
  fileName: string;
  numberedCode: string;
  lineCount: number;
}

export async function readSourceFile(inputPath: string): Promise<SourceFile> {
  const absolutePath = path.resolve(inputPath);
  if (path.extname(absolutePath).toLowerCase() !== '.ts') {
    throw new Error('Provide a file with a .ts extension.');
  }

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    throw new Error(`The file does not exist or cannot be opened: ${inputPath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`The specified path is not a file: ${inputPath}`);
  }
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error('The file exceeds the 100 KB limit.');
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new Error(`Cannot read the file: ${inputPath}`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error('The file exceeds the 100 KB limit.');
  }

  let code: string;
  try {
    code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The file is not valid UTF-8 text.');
  }
  if (!code.trim()) {
    throw new Error('The file is empty.');
  }

  const lines = code.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();

  return {
    displayPath: inputPath,
    fileName: path.basename(absolutePath),
    lineCount: lines.length,
    numberedCode: lines.map((line, index) => `${index + 1} | ${safeLine(line)}`).join('\n'),
  };
}
