import { reviewAngularFile } from './services/openai.service.js';
import { readSourceFile } from './utils/file-reader.js';
import { formatProjectReview, formatReview } from './utils/console-reporter.js';
import OpenAI from 'openai';
import { reviewAngularProject } from './agent/angular-agent.js';
import { limitsFromEnvironment } from './agent/project-tools.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectMode = args[0] === '--project';
  if (projectMode ? !(args.length === 2 || args.length === 4 && args[2] === '--focus') : args.length !== 1 || args[0].startsWith('--')) {
    throw new Error('Usage: npx tsx src/index.ts <file.ts> | --project <directory> [--focus <relative-file.ts>]');
  }

  const source = projectMode ? undefined : await readSourceFile(args[0]);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is missing. Set it in the environment before running.');
  }

  if (projectMode) {
    console.log(`Project: ${args[1]}\n\nAGENT ACTIVITY\n`);
    const result = await reviewAngularProject(args[1], args[3], new OpenAI(), limitsFromEnvironment());
    console.log(formatProjectReview(result));
  } else {
    const review = await reviewAngularFile(source!);
    console.log(formatReview(source!.displayPath, review));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown startup error.');
  process.exitCode = 1;
});
