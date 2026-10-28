import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { readSourceFile, MAX_FILE_BYTES } from '../src/utils/file-reader.ts';
import {
  formatReview,
  formatMarkdownReview,
  formatMarkdownProjectReview,
} from '../src/utils/console-reporter.ts';
import { validateReview } from '../src/reviewers/angular.reviewer.ts';
import { ProjectTools, DEFAULT_LIMITS, limitsFromEnvironment } from '../src/agent/project-tools.ts';
import { reviewAngularProject } from '../src/agent/angular-agent.ts';
import { reviewAngularFile } from '../src/services/openai.service.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'angular-reviewer-test-'));
const createdFiles = [];

async function fixture(name, content) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, content);
  createdFiles.push(filePath);
  return filePath;
}

after(async () => {
  for (const filePath of createdFiles) await unlink(filePath);
  await rmdir(directory);
});

test('reads relative and absolute paths and numbers lines', async () => {
  const filePath = await fixture('sample.ts', 'const a = 1;\r\nconst b = 2;\r\n');
  const relativePath = path.relative(process.cwd(), filePath);
  const relative = await readSourceFile(relativePath);
  const absolute = await readSourceFile(filePath);
  assert.equal(relative.numberedCode, '1 | const a = 1;\n2 | const b = 2;');
  assert.equal(relative.lineCount, 2);
  assert.equal(absolute.numberedCode, relative.numberedCode);
  assert.equal(await readFile(filePath, 'utf8'), 'const a = 1;\r\nconst b = 2;\r\n');
});

test('rejects missing files, wrong extensions, empty files, and oversized files', async () => {
  await assert.rejects(readSourceFile(path.join(directory, 'missing.ts')), /does not exist/);
  const wrongExtension = await fixture('sample.txt', 'const a = 1;');
  await assert.rejects(readSourceFile(wrongExtension), /\.ts extension/);
  const empty = await fixture('empty.ts', '  \n');
  await assert.rejects(readSourceFile(empty), /empty/);
  const oversized = await fixture('large.ts', Buffer.alloc(MAX_FILE_BYTES + 1, 97));
  await assert.rejects(readSourceFile(oversized), /100 KB/);
});

test('rejects invalid UTF-8', async () => {
  const filePath = await fixture('invalid.ts', Buffer.from([0xff, 0xfe]));
  await assert.rejects(readSourceFile(filePath), /UTF-8/);
});

test('formats issues, line ranges, and counts', () => {
  const review = {
    issues: [
      {
        severity: 'HIGH',
        lineStart: 4,
        lineEnd: 4,
        problem: 'Mutation',
        why: 'No change notification',
        suggestion: 'Use update()',
      },
      {
        severity: 'MEDIUM',
        lineStart: 8,
        lineEnd: 10,
        problem: 'Redundant effect',
        why: 'Derived state',
        suggestion: 'Use computed()',
      },
    ],
    limitations: ['Other files were not provided'],
  };
  const report = formatReview('sample.ts', review);
  assert.match(report, /\[HIGH\] Line 4/);
  assert.match(report, /\[MEDIUM\] Lines 8-10/);
  assert.match(report, /Suggestion:\nUse computed\(\)/);
  assert.match(report, /Issues found: 2/);
  assert.match(report, /HIGH: 1 \| MEDIUM: 1 \| LOW: 0/);
  assert.match(report, /Other files were not provided/);
});

test('formats an empty review and discards line numbers outside the file', () => {
  assert.match(
    formatReview('clean.ts', { issues: [], limitations: [] }),
    /No credible issues found/,
  );
  const invalid = {
    issues: [
      {
        severity: 'LOW',
        lineStart: 9,
        lineEnd: 9,
        problem: 'Description',
        why: 'Reason',
        suggestion: 'Fix',
      },
    ],
    limitations: [],
  };
  const filtered = validateReview(invalid, 3);
  assert.equal(filtered.issues.length, 0);
  assert.match(filtered.limitations.join(' '), /outside the file/);
});

const sampleProject = path.resolve('examples/sample-angular');

test('project tools list, number lines and search related source files', async () => {
  const tools = await ProjectTools.create(sampleProject);
  const listed = await tools.listFiles('src/app', true);
  assert.ok(listed.files.includes('src/app/orders/orders.store.ts'));
  assert.ok(listed.files.includes('src/app/orders/orders.component.html'));
  const read = await tools.readFile('src/app/orders/orders.store.ts');
  assert.match(read.numberedCode, /^1 \| import/m);
  assert.match(read.numberedCode, /10 \|/);
  const cached = await tools.readFile('src/app/orders/orders.store.ts');
  assert.equal(cached.cached, true);
  assert.equal(tools.readFiles.size, 1);
  const search = await tools.searchCode('OrdersStore');
  assert.ok(
    search.matches.some((match) => match.path.endsWith('orders.component.ts') && match.line > 0),
  );
});

test('project tools block traversal, excluded files and escaping symlinks', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'angular-tool-test-'));
  const outside = await fixture('outside.ts', 'export const leaked = true;');
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'okay.ts'), 'const okay = true;');
    await writeFile(path.join(root, '.env'), 'API_KEY=secret');
    const tools = await ProjectTools.create(root);
    await assert.rejects(tools.readFile('../outside.ts'));
    await assert.rejects(tools.readFile('.env'));
    await assert.rejects(tools.readFile(outside));
    try {
      await symlink(outside, path.join(root, 'src', 'outside.ts'));
    } catch (error) {
      if (error.code === 'EPERM') {
        try {
          await symlink(directory, path.join(root, 'src', 'external'), 'junction');
          await assert.rejects(tools.readFile('src/external/outside.ts'), /Symlink escapes/);
          return;
        } catch (junctionError) {
          if (junctionError.code === 'EPERM') {
            t.diagnostic('Symlinks and junctions unavailable on this Windows account.');
            return;
          }
          throw junctionError;
        }
      }
      throw error;
    }
    await assert.rejects(tools.readFile('src/outside.ts'), /Symlink escapes/);
    assert.ok(!(await tools.listFiles('src', true)).files.includes('src/outside.ts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function mockResponse(id, output, outputText = '') {
  return {
    id,
    status: 'completed',
    output,
    output_text: outputText,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

test('agent forwards multiple tool outputs with call IDs and context', async () => {
  const requests = [];
  const responses = [
    mockResponse('r1', [
      {
        type: 'function_call',
        call_id: 'c1',
        name: 'list_files',
        arguments: JSON.stringify({ directory: 'src/app', recursive: true }),
      },
      {
        type: 'function_call',
        call_id: 'c2',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.store.ts' }),
      },
    ]),
    mockResponse('r2', [
      {
        type: 'function_call',
        call_id: 'c3',
        name: 'search_code',
        arguments: JSON.stringify({ query: 'OrdersService' }),
      },
    ]),
    mockResponse(
      'r3',
      [],
      JSON.stringify({
        issues: [
          {
            severity: 'MEDIUM',
            path: 'src/app/orders/orders.store.ts',
            lineStart: 10,
            lineEnd: 10,
            problem: 'Persistent subscription',
            why: 'The service stream does not complete.',
            suggestion: 'Subscribe once or manage the lifetime.',
          },
        ],
        limitations: [],
      }),
    ),
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };
  const result = await reviewAngularProject(sampleProject, undefined, client, undefined, () => {});
  assert.equal(result.toolCalls, 3);
  assert.equal(result.rounds, 3);
  assert.equal(result.inputTokens, 30);
  assert.equal(result.review.issues.length, 1);
  assert.equal(requests[1].previous_response_id, 'r1');
  assert.match(requests[0].instructions, /in English/);
  assert.deepEqual(
    requests[1].input.map((item) => item.call_id),
    ['c1', 'c2'],
  );
  assert.match(requests[1].input[1].output, /10 \|/);
  assert.equal(requests[2].input[0].call_id, 'c3');
});

test('agent marks exhausted budget as incomplete', async () => {
  const requests = [];
  const responses = [
    mockResponse('r1', [
      {
        type: 'function_call',
        call_id: 'c1',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.store.ts' }),
      },
      {
        type: 'function_call',
        call_id: 'c2',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.service.ts' }),
      },
    ]),
    mockResponse('r2', [], JSON.stringify({ issues: [], limitations: [] })),
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };
  const result = await reviewAngularProject(
    sampleProject,
    undefined,
    client,
    { ...DEFAULT_LIMITS, maxToolCalls: 1, maxRounds: 2 },
    () => {},
  );
  assert.equal(result.toolCalls, 1);
  assert.equal(result.complete, false);
  assert.match(result.review.limitations.join(' '), /budget/i);
  assert.match(requests[1].input[1].output, /limit reached/);
  assert.equal(requests[1].tool_choice, 'none');
});

test('agent rejects unverified issue locations and invalid focus before an API call', async () => {
  let calls = 0;
  const client = {
    responses: {
      create: async () => {
        calls++;
        return mockResponse(
          'r1',
          [],
          JSON.stringify({
            issues: [
              {
                severity: 'HIGH',
                path: 'invented.ts',
                lineStart: 1,
                lineEnd: 1,
                problem: 'Fake',
                why: 'Fake',
                suggestion: 'Fix',
              },
            ],
            limitations: [],
          }),
        );
      },
    },
  };
  await assert.rejects(
    reviewAngularProject(sampleProject, '../outside.ts', client, undefined, () => {}),
  );
  assert.equal(calls, 0);
  const result = await reviewAngularProject(sampleProject, undefined, client, undefined, () => {});
  assert.equal(result.review.issues.length, 0);
  assert.equal(result.complete, false);
});

test('agent returns errors for unknown tools and invalid arguments', async () => {
  const requests = [];
  const responses = [
    mockResponse('r1', [
      { type: 'function_call', call_id: 'bad-name', name: 'delete_file', arguments: '{}' },
      { type: 'function_call', call_id: 'bad-args', name: 'read_file', arguments: '{oops' },
    ]),
    mockResponse(
      'r2',
      [],
      JSON.stringify({ issues: [], limitations: ['Only tool validation was tested.'] }),
    ),
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };
  const result = await reviewAngularProject(sampleProject, undefined, client, undefined, () => {});
  assert.match(requests[1].input[0].output, /Unknown tool/);
  assert.match(requests[1].input[1].output, /Invalid JSON/);
  assert.equal(result.complete, false);
  assert.match(result.review.limitations.join(' '), /No source file was read/);
});

test('agent stops after the configured model-round limit without claiming success', async () => {
  const client = { responses: { create: async () => mockResponse('r1', []) } };
  const result = await reviewAngularProject(
    sampleProject,
    undefined,
    client,
    { ...DEFAULT_LIMITS, maxRounds: 1 },
    () => {},
  );
  assert.equal(result.rounds, 1);
  assert.equal(result.complete, false);
  assert.match(result.review.limitations.join(' '), /incomplete|stopped/);
  assert.deepEqual(result.review.issues, []);
});

test('environmental limits require positive integers', () => {
  assert.equal(limitsFromEnvironment({ REVIEW_MAX_TOOL_CALLS: '3' }).maxToolCalls, 3);
  assert.throws(() => limitsFromEnvironment({ REVIEW_MAX_ROUNDS: '0' }), /positive integer/);
});

test('programmatic limits reject invalid values', async () => {
  for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      ProjectTools.create(sampleProject, { ...DEFAULT_LIMITS, maxFiles: value }),
      /positive integer/,
    );
  }
  assert.throws(() => limitsFromEnvironment({ REVIEW_MAX_FILES: '1000' }), /no greater than/);
});

test('both reading modes mask credential lines and keep line numbers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'angular-redaction-'));
  try {
    await writeFile(
      path.join(root, 'sample.ts'),
      'const first = 1;\nconst apiKey = "secret-value";\nconst last = 3;',
    );
    const single = await readSourceFile(path.join(root, 'sample.ts'));
    const project = await (await ProjectTools.create(root)).readFile('sample.ts');
    for (const code of [single.numberedCode, project.numberedCode]) {
      assert.match(code, /2 \| \[redacted: possible credential\]/);
      assert.match(code, /3 \| const last/);
      assert.doesNotMatch(code, /secret-value/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project read rejects a path replaced by a symlink after validation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'angular-swap-'));
  try {
    await writeFile(path.join(root, 'source.ts'), 'export const safe = true;');
    await writeFile(path.join(root, 'target.ts'), 'export const secret = true;');
    try {
      await symlink(path.join(root, 'target.ts'), path.join(root, 'probe.ts'));
      await unlink(path.join(root, 'probe.ts'));
    } catch (error) {
      if (error.code === 'EPERM') {
        t.skip('Symlinks unavailable on this Windows account.');
        return;
      }
      throw error;
    }
    const tools = await ProjectTools.create(root);
    const original = tools.readVerified.bind(tools);
    tools.readVerified = async (canonical, maxBytes) => {
      await unlink(canonical);
      await symlink(path.join(root, 'target.ts'), canonical);
      return original(canonical, maxBytes);
    };
    await assert.rejects(tools.readFile('source.ts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project report labels bounded scope and unread files', async () => {
  const responses = [
    mockResponse('r1', [
      {
        type: 'function_call',
        call_id: 'list',
        name: 'list_files',
        arguments: JSON.stringify({ directory: 'src/app', recursive: true }),
      },
      {
        type: 'function_call',
        call_id: 'read',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.store.ts' }),
      },
    ]),
    mockResponse('r2', [], JSON.stringify({ issues: [], limitations: [] })),
  ];
  const client = { responses: { create: async () => responses.shift() } };
  const result = await reviewAngularProject(sampleProject, undefined, client, undefined, () => {});
  assert.equal(result.scope, 'bounded area');
  assert.equal(result.complete, false);
  assert.match(result.review.limitations.join(' '), /Read 1 of 4/);
  assert.match(result.review.limitations.join(' '), /not a full repository audit/);
  assert.match(formatMarkdownProjectReview(result), /Scope: bounded area/);
});

test('agent reserves final round after multiple calls and reports missing final text', async () => {
  const requests = [];
  const responses = [
    mockResponse('r1', [
      {
        type: 'function_call',
        call_id: 'a',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.store.ts' }),
      },
      {
        type: 'function_call',
        call_id: 'b',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app/orders/orders.service.ts' }),
      },
    ]),
    mockResponse('r2', []),
  ];
  const client = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return responses.shift();
      },
    },
  };
  const result = await reviewAngularProject(
    sampleProject,
    undefined,
    client,
    { ...DEFAULT_LIMITS, maxRounds: 2 },
    () => {},
  );
  assert.equal(requests[1].tool_choice, 'none');
  assert.deepEqual(
    requests[1].input.map((item) => item.call_id),
    ['a', 'b'],
  );
  assert.equal(result.complete, false);
  assert.match(result.review.limitations.join(' '), /stopped/);
});

test('single-file API errors are categorized without leaking details', async () => {
  const source = await readSourceFile(path.resolve('examples/bad-signals.ts'));
  await assert.rejects(
    reviewAngularFile(source, async () => {
      throw Object.assign(new Error('sk-very-private-token'), { status: 401 });
    }),
    (error) =>
      error.message.includes('access was denied') &&
      !error.message.includes('sk-very-private-token') &&
      Boolean(error.cause),
  );
  assert.match(
    formatMarkdownReview('sample.ts', { issues: [], limitations: [] }),
    /# File review: sample.ts/,
  );
});

test('single-file reviewer still sends numbered source and validates its report', async () => {
  const source = await readSourceFile(path.resolve('examples/bad-signals.ts'));
  let capturedPrompt = '';
  let capturedInstructions = '';
  const result = await reviewAngularFile(source, async (agent, prompt) => {
    capturedInstructions = agent.instructions;
    capturedPrompt = prompt;
    return {
      finalOutput: {
        issues: [
          {
            severity: 'HIGH',
            lineStart: 14,
            lineEnd: 14,
            problem: 'Mutable update',
            why: 'Signal value is mutated in place.',
            suggestion: 'Use update().',
          },
        ],
        limitations: [],
      },
    };
  });
  assert.match(capturedPrompt, /bad-signals.ts/);
  assert.match(capturedPrompt, /Review the file/);
  assert.match(capturedInstructions, /in English/);
  assert.match(capturedPrompt, /14 \|\s+this\.items\(\)\.push/);
  assert.equal(result.issues[0].lineStart, 14);
});
