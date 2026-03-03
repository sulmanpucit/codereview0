# codereview

AI-powered code review using Claude. Reviews GitHub PRs or local branch diffs, exploring the full codebase to catch issues a surface-level diff review would miss.

## Installation

Requires Node.js 22+ and [Claude CLI](https://docs.anthropic.com/en/docs/claude-code). GitHub PR reviews additionally require [`gh` CLI](https://cli.github.com) authenticated.

Verify prerequisites:

```bash
node --version    # Must be 22+
claude --version  # Must be installed with Anthropic API key
gh auth status    # Required only for PR reviews (not local branch reviews)
```

```bash
git clone <repo-url>
cd codereview
npm install
npm run build
npm link
codereview --version  # Verify install
```

## Usage

### Review a GitHub PR

```bash
# Quick review (diff-only, default)
codereview https://github.com/owner/repo/pull/123

# Deep review (clones repo, explores codebase)
codereview https://github.com/owner/repo/pull/123 --deep

# Post review to GitHub PR
codereview https://github.com/owner/repo/pull/123 --deep --post

# Generate HTML diff report with inline annotations
codereview https://github.com/owner/repo/pull/123 --html

# Strict mode (bugs and security only, no nitpicks)
codereview https://github.com/owner/repo/pull/123 --mode strict

# Use a specific model
codereview https://github.com/owner/repo/pull/123 --model sonnet
```

### Review local branches

Compare two local branches without creating a PR. Works offline -- no GitHub access needed.

```bash
# Review changes between two branches
codereview branch main feature/login-refactor

# Review a feature branch against the default branch (auto-detects main/master)
codereview branch feature/login-refactor

# Deep review using local repo (no clone needed, faster than PR deep review)
codereview branch main feature/login-refactor --deep

# Generate HTML report for local branch diff
codereview branch main feature/login-refactor --html

# All review modes work with local branches
codereview branch rc feature/login-refactor --mode strict
```

When only one branch is provided, the base branch is auto-detected by checking for `main`, then `master`.

The local branch diff uses merge-base semantics (`git diff base...compare`), matching how GitHub compares branches in a PR.

## CLI Options

### Shared options (PR and branch)

| Flag | Description |
|------|-------------|
| `--quick` | Quick review: analyze diff only (default) |
| `--deep` | Deep review: clone repo (PR) or use local repo (branch) for cross-file impacts |
| `--verbose` | Show debug info including timing, model, and token counts |
| `--model <id>` | Claude model to use (e.g., `sonnet`, `opus`, `haiku`, or full model ID) |
| `--mode <mode>` | Review mode: `balanced` (default), `strict`, `detailed`, or `lenient` |
| `--html` | Generate standalone HTML diff report with inline finding annotations |

### PR-only options

| Flag | Description |
|------|-------------|
| `--post` | Post review as GitHub PR comments |

## Review Modes

| Mode | Description |
|------|-------------|
| `balanced` | Default. Skips nitpicks, good signal-to-noise ratio |
| `strict` | Bugs and security issues only, nothing else |
| `detailed` | Thorough review including all categories and nitpicks |
| `lenient` | No nitpicks, higher bar for suggestions |

When using `--post`, the tool creates PENDING reviews on GitHub. You still need to submit them manually through the GitHub UI, so nothing gets posted without your approval.

## Example Output

<img width="1727" height="1008" alt="Screenshot 2026-02-27 at 10 12 04" src="https://github.com/user-attachments/assets/e91bee0a-2241-43aa-aea0-4fdafa3fae63" />

