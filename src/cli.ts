import { Command, Option } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites, checkLocalPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData, postReview } from './github.js';
import { printPRSummary, printErrors, printDebug, printModel, printMode, printMeta, formatDuration, estimateTokens, printProgress, printProgressDone, printAnalysisSummary, printFindings } from './output.js';
import { buildPrompt, type ReviewMode } from './prompt.js';
import { analyzeDiff, analyzeAgentic } from './analyzer.js';
import { cloneRepo, getClonePath, promptCleanup } from './cloner.js';
import { parseDiffHunks } from './diff-parser.js';
import { partitionFindings, buildReviewBody } from './review-builder.js';
import { formatInlineComment } from './formatter.js';
import { EXIT_PREREQ, EXIT_INVALID_URL, EXIT_API_ERROR, EXIT_ANALYSIS_ERROR, sanitizeError } from './errors.js';
import { generateHtmlReport, openInBrowser } from './html-report.js';
import { rmSync, existsSync } from 'node:fs';
import type { PRData, ParsedPR } from './types.js';
import type { ReviewFinding } from './schemas.js';
import { buildLocalPRData, detectDefaultBranch, hasUncommittedChanges } from './local-diff.js';

/** Exit code for local branch errors (missing branch, not a git repo, etc.) */
const EXIT_LOCAL_ERROR = 5;

/** Track active clone path for cleanup on error/SIGINT */
let activeClonePath: string | null = null;

/** Best-effort cleanup of active clone directory */
function cleanupOnExit(): void {
  if (activeClonePath) {
    try { rmSync(activeClonePath, { recursive: true, force: true }); } catch { /* best-effort */ }
    activeClonePath = null;
  }
}

process.on('SIGINT', () => { cleanupOnExit(); process.exit(130); });

/** Shared review options used by both PR and branch commands */
interface ReviewOptions {
  verbose?: boolean;
  quick?: boolean;
  deep?: boolean;
  post?: boolean;
  html?: boolean;
  model?: string;
  mode: ReviewMode;
}

/** GitHub context for posting reviews back to a PR. Absent for local branch reviews. */
interface GitHubContext {
  parsed: ParsedPR;
  octokit: ReturnType<typeof createOctokit>;
}

/**
 * Shared post-analysis flow: terminal output, HTML report, verbose counts, GitHub review posting.
 * Called from both PR and branch review flows after findings are obtained.
 *
 * When githubCtx is provided, --post will attempt to post the review to GitHub.
 * When absent (local branch review), --post is a no-op.
 */
async function handlePostAnalysis(
  findings: ReviewFinding[],
  prData: PRData,
  options: ReviewOptions,
  githubCtx?: GitHubContext,
): Promise<void> {
  printAnalysisSummary(findings);
  printFindings(findings);

  if (options.html) {
    const reportFile = generateHtmlReport(prData, findings, githubCtx?.parsed);
    openInBrowser(reportFile);
  }

  if (options.verbose) {
    if (options.post && githubCtx) {
      const diffHunks = parseDiffHunks(prData.diff);
      const { inline, offDiff } = partitionFindings(findings, diffHunks);
      const posted = inline.length + (offDiff.length > 0 ? 1 : 0);
      printDebug(`Findings: ${findings.length} raw, ${posted} posted`);
    } else {
      printDebug(`Findings: ${findings.length} raw`);
    }
  }

  if (options.post && githubCtx && findings.length > 0) {
    try {
      const postStart = performance.now();
      printProgress('Posting review to GitHub...');

      const diffHunks = parseDiffHunks(prData.diff);
      const { inline, offDiff } = partitionFindings(findings, diffHunks);
      const reviewBody = buildReviewBody(offDiff);
      const comments = inline.map((f) => ({
        path: f.file,
        line: f.line,
        side: 'RIGHT' as const,
        body: formatInlineComment(f),
      }));

      const reviewUrl = await postReview(
        githubCtx.octokit,
        githubCtx.parsed.owner,
        githubCtx.parsed.repo,
        githubCtx.parsed.prNumber,
        prData.headSha,
        reviewBody,
        comments,
      );

      printProgressDone();
      console.log(pc.dim('Review URL: ') + reviewUrl);
      const postDuration = performance.now() - postStart;
      if (options.verbose) {
        printDebug(`Post: ${formatDuration(postDuration)}`);
      }
    } catch (error: unknown) {
      console.log();
      console.error(pc.yellow('\u26A0 Failed to post review to GitHub'));
      console.error(pc.dim('  ' + sanitizeError(error)));
    }
  }
}

/**
 * Run the quick review flow: analyze diff only.
 * Shared between PR and branch commands.
 */
async function runQuickReview(
  prData: PRData,
  options: ReviewOptions,
): Promise<ReviewFinding[]> {
  const quickPrompt = buildPrompt(prData, options.mode);
  const analyzeStart = performance.now();
  try {
    printProgress('Analyzing diff...');
    const result = await analyzeDiff(prData, options.model, options.mode);
    printProgressDone();

    const analyzeDuration = performance.now() - analyzeStart;
    printModel(result.model);

    if (options.verbose) {
      printDebug(`Analyze: ${formatDuration(analyzeDuration)}, prompt ${estimateTokens(quickPrompt.length)}`);
    }
    return result.findings;
  } catch (error: unknown) {
    console.log();
    console.error(pc.red('Analysis failed'));
    console.error(sanitizeError(error));
    process.exit(EXIT_ANALYSIS_ERROR);
  }
}

/**
 * Add shared review options to a Commander command.
 * Keeps option definitions consistent between PR and branch commands.
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('--verbose', 'Show debug info: model, timing, prompt size, finding counts')
    .option('--quick', 'Quick review: analyze diff only (default)')
    .option('--deep', 'Deep review: clone repo (PR) or use local repo (branch) for cross-file impacts')
    .option('--html', 'Generate HTML report and open in browser')
    .option('--model <model-id>', 'Claude model to use (e.g., sonnet, opus, haiku, or full model ID)')
    .addOption(
      new Option('--mode <mode>', 'Review mode: strict, detailed, lenient, balanced')
        .choices(['strict', 'detailed', 'lenient', 'balanced'])
        .default('balanced')
    );
}

const program = new Command();

program
  .name('codereview')
  .description('AI-powered code review using Claude')
  .version('0.1.0');

// --- Default command: codereview <pr-url> ---

addSharedOptions(program)
  .argument('<pr-url>', 'GitHub Pull Request URL')
  .option('--post', 'Post review to GitHub PR')
  .action(async (prUrl: string, options: ReviewOptions) => {
    const failures = checkPrerequisites();
    if (failures.length > 0) {
      printErrors(failures);
      process.exit(EXIT_PREREQ);
    }

    const parsed = parsePRUrl(prUrl);
    if (!parsed) {
      console.error(pc.red('\u2716 Invalid PR URL: ' + prUrl));
      console.error(pc.dim('  Expected: https://github.com/owner/repo/pull/123'));
      process.exit(EXIT_INVALID_URL);
    }

    let prData;
    const octokit = createOctokit();
    const fetchStart = performance.now();
    try {
      printProgress('Fetching PR data...');
      prData = await fetchPRData(octokit, parsed.owner, parsed.repo, parsed.prNumber);
      printProgressDone();
    } catch (error: unknown) {
      console.log();
      console.error(pc.red('\u2716 Failed to fetch PR data'));
      console.error(pc.dim('  ' + sanitizeError(error)));
      process.exit(EXIT_API_ERROR);
    }
    const fetchDuration = performance.now() - fetchStart;
    if (options.verbose) {
      printDebug(`Fetch: ${formatDuration(fetchDuration)}`);
    }

    printPRSummary(prData);
    printMode(options.mode);
    if (options.verbose) {
      printDebug(`Mode: ${options.mode}`);
    }

    const githubCtx: GitHubContext = { parsed, octokit };
    let findings;

    if (options.deep) {
      let cloneSucceeded = false;
      const clonePath = getClonePath(prData.headRepoName);
      activeClonePath = clonePath;
      try {
      const cloneStart = performance.now();
      try {
        printProgress('Cloning repository...');
        await cloneRepo(prData.headRepoOwner, prData.headRepoName, prData.headBranch, clonePath);
        printProgressDone();
        cloneSucceeded = true;
      } catch (error: unknown) {
        console.log();
        console.error(pc.yellow('Warning: Could not clone repo -- falling back to quick review'));
        console.error(pc.dim('  ' + sanitizeError(error)));
      }
      const cloneDuration = performance.now() - cloneStart;
      if (options.verbose) {
        printDebug(`Clone: ${formatDuration(cloneDuration)}`);
      }

      if (cloneSucceeded) {
        console.log(pc.dim('Running deep review...'));
        const analyzeStart = performance.now();
        const result = await analyzeAgentic(prData, clonePath, options.model, options.mode, options.verbose);
        const analyzeDuration = performance.now() - analyzeStart;
        findings = result.findings;
        printModel(result.model);
        if (options.verbose) {
          printDebug(`Analyze (deep): ${formatDuration(analyzeDuration)}`);
          if (result.meta) {
            printMeta(result.meta);
          }
        }
      } else {
        findings = await runQuickReview(prData, options);
      }

      await handlePostAnalysis(findings, prData, options, githubCtx);

      if (cloneSucceeded) {
        try {
          await promptCleanup(clonePath);
        } catch {
          // Cleanup failure should never crash the tool
        }
      }
      } finally {
        if (activeClonePath && existsSync(activeClonePath)) {
          try { rmSync(activeClonePath, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
        activeClonePath = null;
      }
    } else {
      findings = await runQuickReview(prData, options);
      await handlePostAnalysis(findings, prData, options, githubCtx);
    }
  });

// --- Branch subcommand: codereview branch <base> [compare] ---

const branchCmd = program
  .command('branch')
  .description('Review differences between two local branches')
  .argument('<base>', 'Base branch (e.g., main, rc)')
  .argument('[compare]', 'Compare branch (defaults to default branch when base is a feature branch)');

addSharedOptions(branchCmd)
  .action(async (base: string, compare: string | undefined, options: ReviewOptions) => {
    const failures = checkLocalPrerequisites();
    if (failures.length > 0) {
      printErrors(failures);
      process.exit(EXIT_PREREQ);
    }

    let baseBranch: string;
    let compareBranch: string;

    if (compare) {
      baseBranch = base;
      compareBranch = compare;
    } else {
      // Single argument: treat it as the compare branch, auto-detect base
      compareBranch = base;
      try {
        baseBranch = detectDefaultBranch();
        console.log(pc.dim(`Base branch: ${baseBranch} (auto-detected)`));
      } catch (error: unknown) {
        console.error(pc.red('\u2716 ' + (error instanceof Error ? error.message : String(error))));
        process.exit(EXIT_LOCAL_ERROR);
      }
    }

    if (hasUncommittedChanges()) {
      console.log(pc.yellow('Warning: You have uncommitted changes. They will not be included in the review.'));
    }

    let prData: PRData;
    const fetchStart = performance.now();
    try {
      printProgress('Generating local diff...');
      prData = await buildLocalPRData(baseBranch, compareBranch);
      printProgressDone();
    } catch (error: unknown) {
      console.log();
      console.error(pc.red('\u2716 ' + (error instanceof Error ? error.message : String(error))));
      process.exit(EXIT_LOCAL_ERROR);
    }
    const fetchDuration = performance.now() - fetchStart;
    if (options.verbose) {
      printDebug(`Diff: ${formatDuration(fetchDuration)}`);
    }

    if (!prData.diff.trim()) {
      console.log(pc.dim('No differences found between branches.'));
      process.exit(0);
    }

    printPRSummary(prData);
    printMode(options.mode);
    if (options.verbose) {
      printDebug(`Mode: ${options.mode}`);
    }

    let findings;

    if (options.deep) {
      // Deep mode for local branches: no clone needed, use the current working directory
      const repoRoot = process.cwd();
      console.log(pc.dim('Running deep review (local repo)...'));
      const analyzeStart = performance.now();
      try {
        const result = await analyzeAgentic(prData, repoRoot, options.model, options.mode, options.verbose);
        const analyzeDuration = performance.now() - analyzeStart;
        findings = result.findings;
        printModel(result.model);
        if (options.verbose) {
          printDebug(`Analyze (deep): ${formatDuration(analyzeDuration)}`);
          if (result.meta) {
            printMeta(result.meta);
          }
        }
      } catch (error: unknown) {
        console.error(pc.red('Deep analysis failed'));
        console.error(sanitizeError(error));
        process.exit(EXIT_ANALYSIS_ERROR);
      }
    } else {
      findings = await runQuickReview(prData, options);
    }

    await handlePostAnalysis(findings, prData, options);
  });

program.parse();
