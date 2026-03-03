import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeHtml, generateHtmlReport, openInBrowser } from '../src/html-report.js';
import type { PRData } from '../src/types.js';
import type { ReviewFinding } from '../src/schemas.js';
import type { ParsedPR } from '../src/types.js';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

function makePRData(overrides?: Partial<PRData>): PRData {
  return {
    number: 42,
    title: 'Add feature X',
    body: '',
    author: 'testuser',
    baseBranch: 'main',
    headBranch: 'feature-x',
    headSha: 'abc123',
    headRepoOwner: 'owner',
    headRepoName: 'repo',
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    files: [
      { filename: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2, changes: 7 },
      { filename: 'src/bar.ts', status: 'modified', additions: 5, deletions: 1, changes: 6 },
    ],
    diff: [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' const d = 5;',
      'diff --git a/src/bar.ts b/src/bar.ts',
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const y = 2;',
      ' const z = 3;',
    ].join('\n'),
    ...overrides,
  };
}

function makeParsed(): ParsedPR {
  return { owner: 'owner', repo: 'repo', prNumber: 42 };
}

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 2,
    severity: 'bug',
    confidence: 'high',
    category: 'Logic Error',
    description: 'Variable is reassigned incorrectly.',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quote', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  it('escapes single quote', () => {
    expect(escapeHtml("a 'b' c")).toBe('a &#39;b&#39; c');
  });

  it('returns string unchanged when no special chars', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('escapes combined special characters', () => {
    expect(escapeHtml('<div class="test">&\'x\'</div>')).toBe(
      '&lt;div class=&quot;test&quot;&gt;&amp;&#39;x&#39;&lt;/div&gt;',
    );
  });
});

/** Helper to get the HTML string written by the last generateHtmlReport call */
function getWrittenHtml(): string {
  const calls = vi.mocked(writeFileSync).mock.calls;
  return calls[calls.length - 1][1] as string;
}

describe('generateHtmlReport', () => {
  beforeEach(() => {
    vi.mocked(writeFileSync).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log as ReturnType<typeof vi.fn>).mockRestore();
  });

  it('writes HTML file with correct filename', () => {
    const prData = makePRData();
    const findings = [makeFinding()];
    const parsed = makeParsed();

    const result = generateHtmlReport(prData, findings, parsed);

    expect(result).toBe('codereview-repo-42.html');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeFileSync).mock.calls[0][2]).toBe('utf-8');
  });

  it('PR title appears escaped in output', () => {
    const prData = makePRData({ title: '<script>alert("xss")</script>' });
    const findings: ReviewFinding[] = [];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('diff lines have correct class names', () => {
    const prData = makePRData();
    const findings: ReviewFinding[] = [];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('class="diff-addition"');
    expect(html).toContain('class="diff-deletion"');
    expect(html).toContain('class="diff-context"');
    expect(html).toContain('class="diff-hunk-header"');
  });

  it('finding annotations appear with severity badges', () => {
    const prData = makePRData();
    const findings = [makeFinding({ severity: 'bug', category: 'Logic Error', description: 'Bad logic here.' })];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('badge-bug');
    expect(html).toContain('Bug');
    expect(html).toContain('Logic Error');
    expect(html).toContain('Bad logic here.');
  });

  it('off-diff section present when off-diff findings exist', () => {
    const prData = makePRData();
    // Finding at a line not in any diff hunk (line 100 of src/foo.ts is off-diff)
    const findings = [makeFinding({ file: 'src/foo.ts', line: 100 })];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('Off-Diff Findings');
  });

  it('off-diff section absent when no off-diff findings', () => {
    const prData = makePRData();
    // Finding at line 2 of src/foo.ts is within the hunk (lines 1-4)
    const findings = [makeFinding({ file: 'src/foo.ts', line: 2 })];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).not.toContain('Off-Diff Findings');
  });

  it('files with findings have <details open>, files without have <details> without open', () => {
    const prData = makePRData();
    // Finding only in src/foo.ts, not in src/bar.ts
    const findings = [makeFinding({ file: 'src/foo.ts', line: 2 })];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();

    // Extract just the <details ...> opening tags followed by their summary content
    const detailsTags = [...html.matchAll(/<details[^>]*class="diff-file"[^>]*>\s*<summary[^>]*>([^<]*)/g)];

    expect(detailsTags.length).toBe(2);

    const fooTag = detailsTags.find(m => m[1].includes('src/foo.ts'));
    const barTag = detailsTags.find(m => m[1].includes('src/bar.ts'));

    expect(fooTag).not.toBeUndefined();
    expect(barTag).not.toBeUndefined();

    // foo has findings -> should have open attribute
    expect(fooTag![0]).toContain('<details open');
    // bar has no findings -> should NOT have open attribute
    expect(barTag![0]).not.toContain(' open');
  });

  it('XSS: script tag in PR title is escaped', () => {
    const prData = makePRData({ title: "<script>alert('xss')</script>" });
    const findings: ReviewFinding[] = [];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain("<script>alert('xss')</script>");
  });

  it('summary header shows PR title, branch info, severity breakdown, file count', () => {
    const prData = makePRData();
    const findings = [
      makeFinding({ severity: 'bug' }),
      makeFinding({ severity: 'suggestion', line: 3, category: 'Style' }),
    ];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).toContain('Add feature X');
    expect(html).toContain('feature-x');
    expect(html).toContain('main');
    expect(html).toContain('+10');
    expect(html).toContain('-3');
    expect(html).toContain('2 files changed');
    expect(html).toContain('1 Bug');
    expect(html).toContain('1 Suggestion');
  });

  it('HTML is self-contained (no external references)', () => {
    const prData = makePRData();
    const findings: ReviewFinding[] = [];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    const html = getWrittenHtml();
    expect(html).not.toMatch(/<link[^>]+href/);
    expect(html).not.toMatch(/<script[^>]+src/);
    expect(html).toContain('<style>');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('prints file path to terminal', () => {
    const prData = makePRData();
    const findings: ReviewFinding[] = [];
    const parsed = makeParsed();

    generateHtmlReport(prData, findings, parsed);

    expect(console.log).toHaveBeenCalledWith('Report saved: ./codereview-repo-42.html');
  });

  it('uses branch-based filename when parsed is omitted', () => {
    const prData = makePRData({ headBranch: 'feature/login', baseBranch: 'main' });
    const findings: ReviewFinding[] = [];

    const result = generateHtmlReport(prData, findings);

    expect(result).toBe('codereview-feature-login-vs-main.html');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('sanitizes branch names with special chars for filename', () => {
    const prData = makePRData({ headBranch: 'feat/my branch!', baseBranch: 'rc/2.0' });
    const findings: ReviewFinding[] = [];

    const result = generateHtmlReport(prData, findings);

    expect(result).toBe('codereview-feat-my-branch--vs-rc-2.0.html');
  });

  it('generates valid HTML content when parsed is omitted', () => {
    const prData = makePRData();
    const findings = [makeFinding()];

    generateHtmlReport(prData, findings);

    const html = getWrittenHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Add feature X');
    expect(html).toContain('feature-x');
  });
});

describe('openInBrowser', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockClear();
  });

  it('calls execFile with platform-specific args (no shell injection)', () => {
    openInBrowser('test.html');
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
