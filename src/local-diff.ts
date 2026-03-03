import { execFileSync } from 'node:child_process';
import type { PRData, PRFile } from './types.js';
import { validateGitArg } from './cloner.js';

/** Timeout for git commands: 30 seconds */
const GIT_TIMEOUT_MS = 30_000;

/**
 * Validate that a branch (or ref) exists in the local repository.
 * Throws with a descriptive message if the ref cannot be resolved.
 */
export function validateBranchExists(branch: string): void {
  try {
    execFileSync('git', ['rev-parse', '--verify', branch], {
      stdio: 'pipe',
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    throw new Error(`Branch '${branch}' does not exist in this repository.`);
  }
}

/**
 * Detect the default branch of the current repository.
 * Checks for 'main', then 'master'. Throws if neither exists.
 */
export function detectDefaultBranch(): string {
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS,
      });
      return candidate;
    } catch {
      // candidate doesn't exist, try next
    }
  }
  throw new Error(
    'Could not detect default branch. Neither "main" nor "master" exists. Please specify the base branch explicitly.',
  );
}

/**
 * Check for uncommitted changes in the working tree.
 * Returns true if there are staged or unstaged modifications.
 */
export function hasUncommittedChanges(): boolean {
  const output = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
  });
  return output.trim().length > 0;
}

/**
 * Get the unified diff between two branches using merge-base semantics.
 * Uses three-dot diff (base...compare) to match GitHub PR comparison behavior.
 */
function getLocalDiff(base: string, compare: string): string {
  return execFileSync(
    'git',
    ['diff', `${base}...${compare}`],
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
  ).toString();
}

/**
 * Parse git diff --numstat output into file statistics.
 * Returns per-file additions/deletions and aggregate totals.
 *
 * numstat format: "<added>\t<deleted>\t<filename>" per line.
 * Binary files show "-\t-\t<filename>".
 */
function parseDiffStats(base: string, compare: string): {
  additions: number;
  deletions: number;
  files: PRFile[];
} {
  const raw = execFileSync(
    'git',
    ['diff', '--numstat', `${base}...${compare}`],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
  ).toString().trim();

  if (!raw) {
    return { additions: 0, deletions: 0, files: [] };
  }

  let totalAdditions = 0;
  let totalDeletions = 0;
  const files: PRFile[] = [];

  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
    const filename = parts.slice(2).join('\t');

    totalAdditions += added;
    totalDeletions += deleted;

    files.push({
      filename,
      status: 'modified',
      additions: added,
      deletions: deleted,
      changes: added + deleted,
    });
  }

  return { additions: totalAdditions, deletions: totalDeletions, files };
}

/**
 * Refine file statuses using git diff --diff-filter to distinguish
 * added, deleted, renamed, and modified files.
 */
function refineFileStatuses(base: string, compare: string, files: PRFile[]): void {
  const statusOutput = execFileSync(
    'git',
    ['diff', '--name-status', `${base}...${compare}`],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
  ).toString().trim();

  if (!statusOutput) return;

  const statusMap = new Map<string, string>();
  for (const line of statusOutput.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const code = line.slice(0, tab).trim();
    const name = line.slice(tab + 1).trim();

    let status = 'modified';
    if (code === 'A') status = 'added';
    else if (code === 'D') status = 'deleted';
    else if (code.startsWith('R')) status = 'renamed';
    else if (code.startsWith('C')) status = 'copied';

    statusMap.set(name, status);
  }

  for (const f of files) {
    const status = statusMap.get(f.filename);
    if (status) f.status = status;
  }
}

/**
 * Get the commit log summary between two branches.
 * Returns the first commit subject as a title and all commit messages as a body.
 */
function getCommitInfo(base: string, compare: string): { title: string; body: string; author: string } {
  const logOutput = execFileSync(
    'git',
    ['log', '--format=%s%n%b%n---', `${base}...${compare}`],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
  ).toString().trim();

  const firstSubject = execFileSync(
    'git',
    ['log', '-1', '--format=%s', compare],
    { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS },
  ).toString().trim();

  const author = execFileSync(
    'git',
    ['log', '-1', '--format=%an', compare],
    { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS },
  ).toString().trim();

  const title = firstSubject || `${compare} -> ${base}`;
  const body = logOutput || '';

  return { title, body, author };
}

/**
 * Get the HEAD SHA of a branch.
 */
function resolveRef(ref: string): string {
  return execFileSync(
    'git',
    ['rev-parse', ref],
    { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS },
  ).toString().trim();
}

/**
 * Attempt to derive the repo name from the git remote origin URL.
 * Falls back to "local" if no remote is configured.
 */
function getRepoInfo(): { owner: string; name: string } {
  try {
    const url = execFileSync(
      'git',
      ['remote', 'get-url', 'origin'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS },
    ).toString().trim();

    // Handle SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], name: sshMatch[2] };
    }

    // Handle HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], name: httpsMatch[2] };
    }
  } catch {
    // No remote configured
  }
  return { owner: 'local', name: 'local' };
}

/**
 * Verify that the current directory is inside a git repository.
 * Throws if not.
 */
export function assertInsideGitRepo(): void {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      stdio: 'pipe',
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    throw new Error('Not inside a git repository. Run this command from within a git working tree.');
  }
}

/**
 * Build a PRData object from local git branch comparison.
 * Uses merge-base diff (three-dot) to match GitHub PR comparison semantics.
 *
 * Both branch names are validated for dangerous characters before any
 * subprocess invocation.
 */
export async function buildLocalPRData(baseBranch: string, compareBranch: string): Promise<PRData> {
  validateGitArg(baseBranch, 'Base branch');
  validateGitArg(compareBranch, 'Compare branch');

  assertInsideGitRepo();
  validateBranchExists(baseBranch);
  validateBranchExists(compareBranch);

  const diff = getLocalDiff(baseBranch, compareBranch);
  const { additions, deletions, files } = parseDiffStats(baseBranch, compareBranch);
  refineFileStatuses(baseBranch, compareBranch, files);
  const { title, body, author } = getCommitInfo(baseBranch, compareBranch);
  const headSha = resolveRef(compareBranch);
  const repoInfo = getRepoInfo();

  return {
    number: 0,
    title,
    body,
    author,
    baseBranch,
    headBranch: compareBranch,
    headSha,
    headRepoOwner: repoInfo.owner,
    headRepoName: repoInfo.name,
    additions,
    deletions,
    changedFiles: files.length,
    files,
    diff,
  };
}
