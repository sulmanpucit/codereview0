import pc from 'picocolors';
import type { PRData, PrereqFailure } from './types.js';
import type { ReviewFinding } from './schemas.js';
import type { AnalysisMeta } from './analyzer.js';

/**
 * Print a colored compact PR summary with diff-stat file list.
 */
export function printPRSummary(pr: PRData): void {
  // Title
  console.log(pc.bold(pr.title));

  // Metadata line: #number author headBranch -> baseBranch (skip #0 for local reviews)
  const numberTag = pr.number > 0 ? pc.dim(`#${pr.number} `) : '';
  console.log(
    `${numberTag}${pc.cyan(pr.author)} ${pc.dim(`${pr.headBranch} -> ${pr.baseBranch}`)}`,
  );

  // Stats line: +additions -deletions N files changed
  console.log(
    `${pc.green(`+${pr.additions}`)} ${pc.red(`-${pr.deletions}`)} ${pc.dim(`${pr.changedFiles} files changed`)}`,
  );

  // Blank line before file list
  console.log();

  // Diff-stat style file list
  for (const file of pr.files) {
    console.log(
      `${pc.green(`+${file.additions}`)} ${pc.red(`-${file.deletions}`)} ${file.filename}`,
    );
  }

}

/**
 * Print prerequisite failures as red errors with actionable help.
 */
export function printErrors(failures: PrereqFailure[]): void {
  for (const f of failures) {
    console.error(pc.red(`\u2716 ${f.message}`));
    console.error(pc.dim(`  ${f.help}`));
  }
}

/**
 * Print a progress message without a trailing newline.
 * Used for "Fetching PR data..." where " done" is appended on the same line.
 */
export function printProgress(message: string): void {
  process.stdout.write(message);
}

/**
 * Complete a progress line by printing " done" in green with a newline.
 */
export function printProgressDone(): void {
  console.log(pc.green(' done'));
}

/**
 * Print a [debug] line in dimmed text. Only call when --verbose is active.
 */
export function printDebug(message: string): void {
  console.log(pc.dim(`[debug] ${message}`));
}

/**
 * Print the model name as a dimmed header line.
 * Always visible (not verbose-only).
 */
export function printModel(modelId: string): void {
  console.log(pc.dim(`Model: ${modelId}`));
}

/**
 * Print operational metadata as [debug] lines.
 * Only call when --verbose is active and meta is available.
 */
export function printMeta(meta: AnalysisMeta): void {
  printDebug(`Cost: ${formatCost(meta.cost_usd)}`);
  printDebug(`Duration: ${formatDuration(meta.duration_ms)}`);
  printDebug(`Turns: ${meta.num_turns}`);
}

/**
 * Print the review mode as a dimmed header line.
 * Always visible (not verbose-only).
 */
export function printMode(mode: string): void {
  console.log(pc.dim(`Mode: ${mode}`));
}

/**
 * Format milliseconds as human-readable duration.
 * Under 60s: "1.2s", over 60s: "1m 12s"
 */
export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format USD cost for display.
 * Under $0.01: show 4 decimal places (e.g., "$0.0030").
 * $0.01 and above: show 2 decimal places (e.g., "$0.04").
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Estimate token count from character count and format for display.
 * Uses chars/4 approximation (standard for English text with Claude tokenizers).
 */
export function estimateTokens(charCount: number): string {
  const tokens = Math.round(charCount / 4);
  if (tokens >= 1000) {
    return `~${Math.round(tokens / 1000)}k tokens`;
  }
  return `~${tokens} tokens`;
}

/**
 * Print a summary of findings counts by severity with color-coded icons.
 * Only includes severities with count > 0. Zero counts are omitted.
 * Format: "icon count label" joined by dim dot separator.
 */
export function printAnalysisSummary(findings: ReviewFinding[]): void {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const parts: string[] = [];

  const severities = ['bug', 'security', 'suggestion', 'nitpick'] as const;
  for (const severity of severities) {
    const count = counts[severity];
    if (count && count > 0) {
      if (severity === 'bug') {
        parts.push(pc.red(`\u2716 ${count} bug${count === 1 ? '' : 's'}`));
      } else if (severity === 'security') {
        parts.push(pc.yellow(`\u26A0 ${count} security`));
      } else if (severity === 'suggestion') {
        parts.push(pc.blue(`\u25C6 ${count} suggestion${count === 1 ? '' : 's'}`));
      } else if (severity === 'nitpick') {
        parts.push(pc.dim(`\u25CB ${count} nitpick${count === 1 ? '' : 's'}`));
      }
    }
  }

  if (parts.length === 0) {
    console.log(pc.dim('No findings'));
  } else {
    console.log(parts.join(pc.dim(' \u00B7 ')));
  }
}

/** Severity sort order: lower index = higher priority */
const SEVERITY_ORDER: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

/** Confidence sort order: lower index = higher priority */
const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Color-coded severity icons for terminal display */
const SEVERITY_ICONS: Record<string, string> = {
  bug: pc.red('\u2716 bug'),
  security: pc.yellow('\u26A0 security'),
  suggestion: pc.blue('\u25C6 suggestion'),
  nitpick: pc.dim('\u25CB nitpick'),
};

/**
 * Split a description into headline (first sentence) and detail (remainder).
 * Splits on the first sentence-ending punctuation (. ! ?) followed by a space and uppercase letter.
 * If no split point found, the entire description becomes the headline with no detail.
 */
export function extractHeadline(description: string): { headline: string; detail: string } {
  const match = description.match(/^(.+?[.!?])\s+([A-Z].+)$/s);
  if (match) {
    return { headline: match[1], detail: match[2] };
  }
  return { headline: description, detail: '' };
}

/**
 * Print findings sorted globally by severity (bug > security > suggestion > nitpick),
 * then by confidence (high > medium > low) within same severity.
 * Each finding is rendered as a multi-line block: headline on line 1, description indented below.
 * Findings are separated by blank lines. Nitpick findings are rendered entirely in dim text.
 * Empty findings array produces no output.
 */
export function printFindings(findings: ReviewFinding[]): void {
  if (findings.length === 0) return;

  // Sort globally: severity first, confidence second, file+line for determinism
  const sorted = [...findings].sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.severity] ?? 9;
    const sevB = SEVERITY_ORDER[b.severity] ?? 9;
    if (sevA !== sevB) return sevA - sevB;
    const confA = CONFIDENCE_ORDER[a.confidence] ?? 9;
    const confB = CONFIDENCE_ORDER[b.confidence] ?? 9;
    if (confA !== confB) return confA - confB;
    // Tertiary: file then line for deterministic output
    const fileComp = a.file.localeCompare(b.file);
    if (fileComp !== 0) return fileComp;
    return a.line - b.line;
  });

  // Print multi-line blocks with blank line separators
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const location = `${f.file}:${f.line}`;
    const { headline, detail } = extractHeadline(f.description);

    if (f.severity === 'nitpick') {
      // Entire nitpick block rendered in dim
      console.log(pc.dim(`  \u25CB nitpick ${location} ${headline}`));
      if (detail) {
        console.log(pc.dim(`    ${detail}`));
      }
    } else {
      const icon = SEVERITY_ICONS[f.severity] ?? f.severity;
      console.log(`  ${icon} ${pc.dim(location)} ${headline}`);
      if (detail) {
        console.log(`    ${detail}`);
      }
    }

    // Blank line between findings, but not after the last one
    if (i < sorted.length - 1) {
      console.log();
    }
  }
}
