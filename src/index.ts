import { reviewAngularFile } from './services/openai.service.js';
import { readSourceFile } from './utils/file-reader.js';
import {
  formatMarkdownProjectReview,
  formatMarkdownReview,
  formatProjectReview,
  formatReview,
} from './utils/console-reporter.js';
import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { reviewAngularProject } from './agent/angular-agent.js';
import { limitsFromEnvironment } from './agent/project-tools.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  let outputPath: string | undefined;
  if (outputIndex !== -1) {
    if (outputIndex !== args.length - 2 || !args[outputIndex + 1]?.toLowerCase().endsWith('.md')) {
      throw new Error('--output requires a .md file path at the end of the command.');
    }
    outputPath = args[outputIndex + 1];
    args.splice(outputIndex, 2);
  }
  const projectMode = args[0] === '--project';
  if (
    projectMode
      ? !(args.length === 2 || (args.length === 4 && args[2] === '--focus'))
      : args.length !== 1 || args[0].startsWith('--')
  ) {
    throw new Error(
      'Usage: npx tsx src/index.ts <file.ts> | --project <directory> [--focus <relative-file.ts>] [--output <report.md>]',
    );
  }

  const source = projectMode ? undefined : await readSourceFile(args[0]);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is missing. Set it in the environment before running.');
  }
  console.error(
    'Warning: code will be sent to the OpenAI API. Secret redaction is best effort; review private code before running this command.',
  );

  if (projectMode) {
    console.log(`Project: ${args[1]}\n\nAGENT ACTIVITY\n`);
    const result = await reviewAngularProject(
      args[1],
      args[3],
      new OpenAI(),
      limitsFromEnvironment(),
    );
    console.log(formatProjectReview(result));
    if (outputPath)
      await writeFile(outputPath, formatMarkdownProjectReview(result), {
        encoding: 'utf8',
        flag: 'wx',
      });
  } else {
    const review = await reviewAngularFile(source!);
    console.log(formatReview(source!.displayPath, review));
    if (outputPath)
      await writeFile(outputPath, formatMarkdownReview(source!.displayPath, review), {
        encoding: 'utf8',
        flag: 'wx',
      });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown startup error.');
  process.exitCode = 1;
});
