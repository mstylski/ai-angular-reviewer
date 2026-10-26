import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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
    throw new Error('Wskaż plik z rozszerzeniem .ts.');
  }

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    throw new Error(`Plik nie istnieje lub nie można go otworzyć: ${inputPath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Wskazana ścieżka nie jest plikiem: ${inputPath}`);
  }
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error('Plik przekracza limit 100 KB.');
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new Error(`Nie można odczytać pliku: ${inputPath}`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error('Plik przekracza limit 100 KB.');
  }

  let code: string;
  try {
    code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Plik nie jest poprawnym tekstem UTF-8.');
  }
  if (!code.trim()) {
    throw new Error('Plik jest pusty.');
  }

  const lines = code.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();

  return {
    displayPath: inputPath,
    fileName: path.basename(absolutePath),
    lineCount: lines.length,
    numberedCode: lines.map((line, index) => `${index + 1} | ${line}`).join('\n'),
  };
}
