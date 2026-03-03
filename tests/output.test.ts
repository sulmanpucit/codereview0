import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printPRSummary, printErrors, printDebug, printModel, printMode, formatDuration, formatCost, estimateTokens, printFindings, printAnalysisSummary, extractHeadline, printMeta } from '../src/output.js';
import type { PRData, PrereqFailure } from '../src/types.js';
import type { ReviewFinding } from '../src/schemas.js';

const mockPR: PRData = {
  number: 42,
  title: 'Add feature X',
  body: 'PR description',
  author: 'testauthor',
  baseBranch: 'main',
  headBranch: 'feature-x',
  headSha: 'abc123',
  additions: 50,
  deletions: 10,
  changedFiles: 2,
  files: [
    { filename: 'src/foo.ts', status: 'modified', additions: 30, deletions: 5, changes: 35 },
    { filename: 'src/bar.ts', status: 'added', additions: 20, deletions: 5, changes: 25 },
  ],
  diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,5 @@\n+new line',
};

describe('printPRSummary', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the PR title', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Add feature X');
  });

  it('prints the PR number and author', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('#42');
    expect(output).toContain('testauthor');
  });

  it('prints branch names', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('feature-x');
    expect(output).toContain('main');
  });

  it('prints file stats in diff-stat style', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('src/bar.ts');
  });

  it('prints diff stats summary', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('2 files changed');
  });

  it('skips PR number display when number is 0 (local branch review)', () => {
    const localPR: PRData = { ...mockPR, number: 0 };
    printPRSummary(localPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('#0');
    expect(output).toContain('testauthor');
  });

  it('shows PR number when number is positive', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('#42');
  });
});

describe('printErrors', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('prints each failure with X prefix', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it: https://cli.github.com' },
    ];
    printErrors(failures);
    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('\u2716');
    expect(output).toContain('gh CLI not found');
  });

  it('prints actionable help text for each failure', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it: https://cli.github.com' },
      { name: 'claude', message: 'claude CLI not found', help: 'Install it: https://docs.anthropic.com/en/docs/claude-code' },
    ];
    printErrors(failures);
    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('https://cli.github.com');
    expect(output).toContain('https://docs.anthropic.com');
  });

  it('prints multiple failures', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it' },
      { name: 'claude', message: 'claude CLI not found', help: 'Install it' },
    ];
    printErrors(failures);
    // 2 failures * 2 lines each = 4 console.error calls
    expect(errorSpy).toHaveBeenCalledTimes(4);
  });
});

describe('printDebug', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints message with [debug] prefix', () => {
    printDebug('Fetch: 1.2s');
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[debug]');
    expect(output).toContain('Fetch: 1.2s');
  });

  it('outputs a single console.log call', () => {
    printDebug('test message');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe('printModel', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints model name with Model: prefix', () => {
    printModel('claude-opus-4-6');
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Model:');
    expect(output).toContain('claude-opus-4-6');
  });

  it('outputs a single console.log call', () => {
    printModel('claude-sonnet-4-20250514');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe('printMode', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints mode name with Mode: prefix', () => {
    printMode('balanced');
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Mode:');
    expect(output).toContain('balanced');
  });

  it('outputs a single console.log call', () => {
    printMode('strict');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('works with all mode values', () => {
    const modes = ['strict', 'detailed', 'lenient', 'balanced'];
    for (const mode of modes) {
      logSpy.mockClear();
      printMode(mode);
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain(mode);
    }
  });
});

describe('formatDuration', () => {
  it('formats sub-60s as seconds with one decimal', () => {
    expect(formatDuration(1234)).toBe('1.2s');
  });

  it('formats exactly 0ms', () => {
    expect(formatDuration(0)).toBe('0.0s');
  });

  it('formats sub-second durations', () => {
    expect(formatDuration(456)).toBe('0.5s');
  });

  it('formats 60s+ as minutes and seconds', () => {
    expect(formatDuration(72_000)).toBe('1m 12s');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(120_000)).toBe('2m 0s');
  });

  it('formats just under 60s as seconds', () => {
    expect(formatDuration(59_999)).toBe('60.0s');
  });

  it('formats 60s exactly as minutes', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });
});

describe('estimateTokens', () => {
  it('estimates small counts without k suffix', () => {
    expect(estimateTokens(100)).toBe('~25 tokens');
  });

  it('estimates 1000+ tokens with k suffix', () => {
    expect(estimateTokens(4000)).toBe('~1k tokens');
  });

  it('rounds to nearest k for large counts', () => {
    expect(estimateTokens(48000)).toBe('~12k tokens');
  });

  it('handles zero characters', () => {
    expect(estimateTokens(0)).toBe('~0 tokens');
  });

  it('estimates boundary between plain and k format', () => {
    // 4000 chars / 4 = 1000 tokens -> should use k format
    expect(estimateTokens(4000)).toBe('~1k tokens');
    // 3996 chars / 4 = 999 tokens -> plain format
    expect(estimateTokens(3996)).toBe('~999 tokens');
  });
});

describe('printFindings', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('sorts findings globally by severity then confidence', () => {
    const findings: ReviewFinding[] = [
      { file: 'b.ts', line: 10, severity: 'suggestion', confidence: 'medium', category: 'quality', description: 'Suggestion B' },
      { file: 'a.ts', line: 5, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug A' },
      { file: 'c.ts', line: 20, severity: 'nitpick', confidence: 'low', category: 'style', description: 'Nitpick C' },
      { file: 'a.ts', line: 1, severity: 'security', confidence: 'high', category: 'security', description: 'Security A' },
      { file: 'b.ts', line: 3, severity: 'bug', confidence: 'low', category: 'logic', description: 'Bug B low' },
    ];

    printFindings(findings);

    // Join all console.log calls into a single string to verify ordering
    const output = logSpy.mock.calls.map((c) => c[0] ?? '').join('\n');
    // Bug high before bug low, bugs before security, security before suggestion, suggestion before nitpick
    expect(output.indexOf('Bug A')).toBeLessThan(output.indexOf('Bug B low'));
    expect(output.indexOf('Bug B low')).toBeLessThan(output.indexOf('Security A'));
    expect(output.indexOf('Security A')).toBeLessThan(output.indexOf('Suggestion B'));
    expect(output.indexOf('Suggestion B')).toBeLessThan(output.indexOf('Nitpick C'));
  });

  it('shows file:line inline on each finding', () => {
    const findings: ReviewFinding[] = [
      { file: 'src/foo.ts', line: 42, severity: 'bug', confidence: 'high', category: 'logic', description: 'Missing null check' },
    ];

    printFindings(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('src/foo.ts:42');
  });

  it('produces no output for empty findings', () => {
    printFindings([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not mutate the original findings array', () => {
    const findings: ReviewFinding[] = [
      { file: 'b.ts', line: 10, severity: 'suggestion', confidence: 'medium', category: 'quality', description: 'Second' },
      { file: 'a.ts', line: 5, severity: 'bug', confidence: 'high', category: 'logic', description: 'First' },
    ];

    const originalOrder = [...findings];
    printFindings(findings);

    // Original array should be unchanged
    expect(findings[0].description).toBe(originalOrder[0].description);
    expect(findings[1].description).toBe(originalOrder[1].description);
  });

  it('separates findings with blank lines', () => {
    const findings: ReviewFinding[] = [
      { file: 'a.ts', line: 1, severity: 'bug', confidence: 'high', category: 'logic', description: 'First bug' },
      { file: 'b.ts', line: 2, severity: 'bug', confidence: 'high', category: 'logic', description: 'Second bug' },
    ];

    printFindings(findings);

    const calls = logSpy.mock.calls;
    // Should have blank line separator (console.log() with no args) between findings
    const blankLineCalls = calls.filter((c) => c.length === 0 || c[0] === undefined);
    expect(blankLineCalls.length).toBeGreaterThanOrEqual(1);

    // Last call should NOT be a blank line (no trailing blank line)
    const lastCall = calls[calls.length - 1];
    expect(lastCall.length).toBeGreaterThan(0);
    expect(lastCall[0]).toBeDefined();
  });

  it('renders nitpick findings in dim text with circle icon', () => {
    const findings: ReviewFinding[] = [
      { file: 'src/config.ts', line: 3, severity: 'nitpick', confidence: 'low', category: 'style', description: 'Unused import' },
    ];

    printFindings(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('Unused import');
    expect(output).toContain('src/config.ts:3');
    // Should contain the circle icon character
    expect(output).toContain('\u25CB');
  });

  it('renders multi-line blocks with headline and detail', () => {
    const findings: ReviewFinding[] = [
      { file: 'src/auth.ts', line: 42, severity: 'bug', confidence: 'high', category: 'logic', description: 'Missing null check. The user object may be null when the session expires.' },
    ];

    printFindings(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    // Headline on first line
    expect(output).toContain('Missing null check.');
    // Detail on subsequent line
    expect(output).toContain('The user object may be null when the session expires.');
  });
});

describe('extractHeadline', () => {
  it('splits on first sentence-ending punctuation followed by uppercase', () => {
    const result = extractHeadline('Missing null check. The user object may be null.');
    expect(result.headline).toBe('Missing null check.');
    expect(result.detail).toBe('The user object may be null.');
  });

  it('returns full description as headline when no split point', () => {
    const result = extractHeadline('simple description without split');
    expect(result.headline).toBe('simple description without split');
    expect(result.detail).toBe('');
  });

  it('splits on exclamation mark', () => {
    const result = extractHeadline('Critical error! Check the logs for details.');
    expect(result.headline).toBe('Critical error!');
    expect(result.detail).toBe('Check the logs for details.');
  });

  it('splits on question mark', () => {
    const result = extractHeadline('Is this intentional? The variable is never used.');
    expect(result.headline).toBe('Is this intentional?');
    expect(result.detail).toBe('The variable is never used.');
  });
});

describe('printAnalysisSummary', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('shows severity counts with icons', () => {
    const findings: ReviewFinding[] = [
      { file: 'a.ts', line: 1, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug 1' },
      { file: 'a.ts', line: 2, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug 2' },
      { file: 'b.ts', line: 1, severity: 'security', confidence: 'high', category: 'security', description: 'Sec 1' },
      { file: 'c.ts', line: 1, severity: 'suggestion', confidence: 'medium', category: 'quality', description: 'Sug 1' },
      { file: 'c.ts', line: 2, severity: 'suggestion', confidence: 'medium', category: 'quality', description: 'Sug 2' },
      { file: 'c.ts', line: 3, severity: 'suggestion', confidence: 'low', category: 'quality', description: 'Sug 3' },
      { file: 'd.ts', line: 1, severity: 'nitpick', confidence: 'low', category: 'style', description: 'Nit 1' },
    ];

    printAnalysisSummary(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('2 bugs');
    expect(output).toContain('1 security');
    expect(output).toContain('3 suggestions');
    expect(output).toContain('1 nitpick');
    // Should contain severity icons
    expect(output).toContain('\u2716'); // bug icon
    expect(output).toContain('\u26A0'); // security icon
    expect(output).toContain('\u25C6'); // suggestion icon
    expect(output).toContain('\u25CB'); // nitpick icon
  });

  it('omits zero counts', () => {
    const findings: ReviewFinding[] = [
      { file: 'a.ts', line: 1, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug 1' },
      { file: 'a.ts', line: 2, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug 2' },
    ];

    printAnalysisSummary(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('2 bugs');
    expect(output).not.toContain('security');
    expect(output).not.toContain('suggestion');
    expect(output).not.toContain('nitpick');
  });

  it('prints No findings for empty array', () => {
    printAnalysisSummary([]);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('No findings');
  });

  it('uses singular form for count of 1', () => {
    const findings: ReviewFinding[] = [
      { file: 'a.ts', line: 1, severity: 'bug', confidence: 'high', category: 'logic', description: 'Bug 1' },
    ];

    printAnalysisSummary(findings);

    const output = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(output).toContain('1 bug');
    expect(output).not.toContain('1 bugs');
  });
});

describe('formatCost', () => {
  it('formats costs >= $0.01 with 2 decimal places', () => {
    expect(formatCost(0.04)).toBe('$0.04');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(0.01)).toBe('$0.01');
  });

  it('formats costs < $0.01 with 4 decimal places', () => {
    expect(formatCost(0.003)).toBe('$0.0030');
    expect(formatCost(0.0001)).toBe('$0.0001');
  });

  it('formats zero cost', () => {
    expect(formatCost(0)).toBe('$0.0000');
  });
});

describe('printMeta', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints cost, duration, and turns as debug lines', () => {
    printMeta({
      cost_usd: 0.0423,
      duration_ms: 45200,
      num_turns: 12,
      duration_api_ms: 43100,
      session_id: 'sess-abc',
    });

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[debug]');
    expect(output).toContain('Cost: $0.04');
    expect(output).toContain('Duration: 45.2s');
    expect(output).toContain('Turns: 12');
  });

  it('outputs exactly 3 debug lines', () => {
    printMeta({
      cost_usd: 0.01,
      duration_ms: 1000,
      num_turns: 5,
      duration_api_ms: 900,
      session_id: 'sess-xyz',
    });

    expect(logSpy).toHaveBeenCalledTimes(3);
  });

  it('does not display duration_api_ms or session_id', () => {
    printMeta({
      cost_usd: 0.05,
      duration_ms: 30000,
      num_turns: 8,
      duration_api_ms: 28000,
      session_id: 'sess-secret',
    });

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('28000');
    expect(output).not.toContain('sess-secret');
    expect(output).not.toContain('duration_api_ms');
    expect(output).not.toContain('session_id');
  });
});
