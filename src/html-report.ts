/**
 * HTML report generator for code review findings.
 *
 * Produces a standalone, self-contained HTML file with GitHub-like diff styling,
 * inline finding annotations, and an off-diff findings section. Opens the report
 * in the default browser after writing.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import type { PRData } from './types.js';
import type { ReviewFinding } from './schemas.js';
import type { ParsedPR } from './types.js';
import { parseDetailedDiff, type DiffFile, type DiffLine } from './html-diff-parser.js';
import { parseDiffHunks } from './diff-parser.js';
import { partitionFindings } from './review-builder.js';
import { capitalizeSeverity } from './formatter.js';

/**
 * Escape HTML special characters to prevent XSS.
 * Replaces the 5 critical characters: & < > " '
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Open a file in the default browser using platform-specific commands.
 * Fire-and-forget: never awaits, silently ignores errors.
 */
export function openInBrowser(filePath: string): void {
  const absPath = resolve(filePath);

  switch (process.platform) {
    case 'darwin':
      execFile('open', [absPath], () => {});
      break;
    case 'win32':
      execFile('cmd', ['/c', 'start', '', absPath], () => {});
      break;
    default:
      execFile('xdg-open', [absPath], () => {});
      break;
  }
}

/**
 * Build a map of newLineNum -> ReviewFinding[] for a given file.
 * Findings attach at endLine (if present) or line.
 */
function buildFindingMap(findings: ReviewFinding[], filename: string): Map<number, ReviewFinding[]> {
  const map = new Map<number, ReviewFinding[]>();
  for (const f of findings) {
    if (f.file !== filename) continue;
    const attachLine = f.endLine ?? f.line;
    const existing = map.get(attachLine) ?? [];
    existing.push(f);
    map.set(attachLine, existing);
  }
  return map;
}

/** Replace characters unsafe for filenames with dashes */
function sanitizeForFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/** Get CSS class for severity badge */
function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'bug': return 'badge-bug';
    case 'security': return 'badge-security';
    case 'suggestion': return 'badge-suggestion';
    case 'nitpick': return 'badge-nitpick';
    default: return 'badge-suggestion';
  }
}

/** Render a severity badge HTML element */
function renderSeverityBadge(severity: string): string {
  return `<span class="severity-badge ${severityBadgeClass(severity)}">${escapeHtml(capitalizeSeverity(severity))}</span>`;
}

/** Render a single finding annotation block */
function renderAnnotation(finding: ReviewFinding): string {
  const borderClass = `annotation-${finding.severity === 'bug' || finding.severity === 'security' ? 'critical' : finding.severity === 'suggestion' ? 'suggestion' : 'nitpick'}`;
  return `<div class="annotation ${borderClass}">
  <div class="annotation-header">${renderSeverityBadge(finding.severity)} <span class="annotation-category">${escapeHtml(finding.category)}</span></div>
  <div class="annotation-body">${escapeHtml(finding.description)}</div>
</div>`;
}

/** Render a single diff line as a table row */
function renderDiffLine(line: DiffLine): string {
  const typeClass = `diff-${line.type}`;
  const oldNum = line.oldLineNum !== null ? line.oldLineNum : '';
  const newNum = line.newLineNum !== null ? line.newLineNum : '';
  return `<tr class="${typeClass}"><td class="line-num">${oldNum}</td><td class="line-num">${newNum}</td><td class="line-content">${escapeHtml(line.content)}</td></tr>`;
}

/** Render annotations for a given line number */
function renderAnnotationsForLine(findingMap: Map<number, ReviewFinding[]>, newLineNum: number | null): string {
  if (newLineNum === null) return '';
  const findings = findingMap.get(newLineNum);
  if (!findings || findings.length === 0) return '';
  return `<tr class="annotation-row"><td colspan="3">${findings.map(renderAnnotation).join('\n')}</td></tr>`;
}

/** Check if a file has any findings */
function fileHasFindings(filename: string, inlineFindings: ReviewFinding[]): boolean {
  return inlineFindings.some(f => f.file === filename);
}

/** Count severity occurrences */
function countSeverities(findings: ReviewFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

/** Render severity breakdown badges for the summary header */
function renderSeverityBreakdown(findings: ReviewFinding[]): string {
  const counts = countSeverities(findings);
  const severities = ['bug', 'security', 'suggestion', 'nitpick'] as const;
  const parts: string[] = [];
  for (const sev of severities) {
    const count = counts[sev];
    if (count && count > 0) {
      parts.push(`<span class="severity-count ${severityBadgeClass(sev)}">${count} ${capitalizeSeverity(sev)}${count === 1 ? '' : sev === 'security' ? '' : 's'}</span>`);
    }
  }
  return parts.length > 0 ? parts.join(' ') : '<span class="no-findings">No findings</span>';
}

/** Render a single diff file section */
function renderDiffFileSection(file: DiffFile, inlineFindings: ReviewFinding[]): string {
  const hasFindings = fileHasFindings(file.filename, inlineFindings);
  const openAttr = hasFindings ? ' open' : '';
  const findingMap = buildFindingMap(inlineFindings, file.filename);

  // Build file header label
  const statusLabel = file.status === 'renamed'
    ? `${escapeHtml(file.oldFilename)} → ${escapeHtml(file.filename)}`
    : escapeHtml(file.filename);

  let rows = '';
  for (const line of file.lines) {
    rows += renderDiffLine(line);
    rows += renderAnnotationsForLine(findingMap, line.newLineNum);
  }

  return `<details${openAttr} class="diff-file">
  <summary class="diff-file-header">${statusLabel}</summary>
  <div class="diff-content">
    <table class="diff-table">
      ${rows}
    </table>
  </div>
</details>`;
}

/** Render the off-diff findings section (hidden when empty) */
function renderOffDiffSection(offDiff: ReviewFinding[]): string {
  if (offDiff.length === 0) return '';
  const items = offDiff.map(f => {
    const borderClass = `annotation-${f.severity === 'bug' || f.severity === 'security' ? 'critical' : f.severity === 'suggestion' ? 'suggestion' : 'nitpick'}`;
    return `<div class="annotation ${borderClass}">
  <div class="annotation-header">${renderSeverityBadge(f.severity)} <span class="annotation-category">${escapeHtml(f.category)}</span></div>
  <div class="annotation-location">${escapeHtml(f.file)}:${f.line}</div>
  <div class="annotation-body">${escapeHtml(f.description)}</div>
</div>`;
  }).join('\n');

  return `<section class="off-diff-section">
  <h2>Off-Diff Findings</h2>
  ${items}
</section>`;
}

/** Full CSS for the HTML report */
const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #1f2328;
    background: #ffffff;
    line-height: 1.5;
    padding: 24px;
  }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
  .meta { color: #656d76; font-size: 14px; margin-bottom: 4px; }
  .stats { margin-bottom: 16px; font-size: 14px; }
  .stats .additions { color: #1a7f37; }
  .stats .deletions { color: #cf222e; }
  .stats .file-count { color: #656d76; }
  .severity-breakdown { margin-bottom: 24px; display: flex; gap: 8px; flex-wrap: wrap; }
  .severity-count {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }
  .no-findings { color: #656d76; font-size: 14px; }

  /* Severity badge colors */
  .badge-bug { background: #ffebe9; color: #cf222e; }
  .badge-security { background: #ffebe9; color: #cf222e; }
  .badge-suggestion { background: #fff8c5; color: #bf8700; }
  .badge-nitpick { background: #f6f8fa; color: #656d76; }

  /* Diff file sections */
  .diff-file {
    border: 1px solid #d0d7de;
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .diff-file-header {
    padding: 8px 16px;
    background: #f6f8fa;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 13px;
    cursor: pointer;
    font-weight: 600;
  }
  .diff-content { overflow-x: auto; }
  .diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 12px;
    line-height: 20px;
  }

  /* Line numbers */
  .line-num {
    width: 50px;
    min-width: 50px;
    padding: 0 8px;
    text-align: right;
    color: #656d76;
    user-select: none;
    vertical-align: top;
    border-right: 1px solid #d0d7de;
  }

  /* Line content */
  .line-content {
    padding: 0 12px;
    white-space: pre;
    overflow-x: visible;
  }

  /* Diff line backgrounds */
  .diff-addition { background-color: #dafbe1; }
  .diff-addition .line-content { background-color: #dafbe1; }
  .diff-deletion { background-color: #ffebe9; }
  .diff-deletion .line-content { background-color: #ffebe9; }
  .diff-context { background-color: #ffffff; }
  .diff-hunk-header {
    background-color: #ddf4ff;
    color: #656d76;
  }
  .diff-hunk-header .line-content {
    background-color: #ddf4ff;
    font-style: italic;
  }

  /* Finding annotations */
  .annotation-row td { padding: 0; }
  .annotation {
    margin: 8px 16px;
    padding: 12px;
    border-radius: 6px;
    border-left: 3px solid;
    background: #f6f8fa;
  }
  .annotation-critical { border-left-color: #cf222e; }
  .annotation-suggestion { border-left-color: #bf8700; }
  .annotation-nitpick { border-left-color: #656d76; }

  .annotation-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .severity-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .annotation-category {
    color: #656d76;
    font-weight: 500;
  }
  .annotation-body {
    font-size: 13px;
    line-height: 1.5;
    color: #1f2328;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }
  .annotation-location {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 12px;
    color: #656d76;
    margin-bottom: 4px;
  }

  /* Off-diff section */
  .off-diff-section {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid #d0d7de;
  }
  .off-diff-section h2 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
  }
`;

/**
 * Generate a self-contained HTML report for PR code review findings.
 *
 * Parses the raw diff, partitions findings into inline and off-diff,
 * builds a complete HTML document with embedded CSS, writes it to disk,
 * prints the file path, and opens it in the default browser.
 *
 * @returns The filename of the written HTML file
 */
export function generateHtmlReport(prData: PRData, findings: ReviewFinding[], parsed?: ParsedPR): string {
  // 1. Parse the raw diff into structured file/line data
  const diffFiles = parseDetailedDiff(prData.diff);

  // 2. Partition findings into inline and off-diff
  const diffHunks = parseDiffHunks(prData.diff);
  const { inline, offDiff } = partitionFindings(findings, diffHunks);

  // 3. Generate HTML
  const diffSections = diffFiles.map(f => renderDiffFileSection(f, inline)).join('\n');
  const offDiffSection = renderOffDiffSection(offDiff);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Code Review: ${escapeHtml(prData.title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(prData.title)}</h1>
    <div class="meta">${escapeHtml(prData.headBranch)} &rarr; ${escapeHtml(prData.baseBranch)}</div>
    <div class="stats">
      <span class="additions">+${prData.additions}</span>
      <span class="deletions"> -${prData.deletions}</span>
      <span class="file-count"> ${prData.changedFiles} files changed</span>
    </div>
    <div class="severity-breakdown">${renderSeverityBreakdown(findings)}</div>
    ${diffSections}
    ${offDiffSection}
  </div>
</body>
</html>`;

  // 4. Write to file
  const filename = parsed
    ? `codereview-${parsed.repo}-${parsed.prNumber}.html`
    : `codereview-${sanitizeForFilename(prData.headBranch)}-vs-${sanitizeForFilename(prData.baseBranch)}.html`;
  writeFileSync(resolve(filename), html, 'utf-8');

  // 5. Print to terminal
  console.log(`Report saved: ./${filename}`);

  return filename;
}
