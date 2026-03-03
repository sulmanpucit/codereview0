# codereview

**Don't just review the lines that changed. Understand why they matter.**

AI-powered code reviews that go beyond the diff, using Claude to catch bugs, security issues, and design problems a surface-level review would miss.

- 🔍 **PR reviews** - point it at any GitHub PR and get a detailed review in seconds
- 🌳 **Local branch diffs** - review changes before you even open a PR, fully offline
- 🧠 **Deep mode** - optionally clones the repo and explores cross-file impacts
- 💬 **Post to GitHub** - adds review comments directly on the PR (as pending, so you stay in control)
- 📄 **HTML reports** - generates standalone diff reports with inline annotations

<img width="1727" height="1008" alt="codereview output showing annotated diff with findings" src="https://github.com/user-attachments/assets/e91bee0a-2241-43aa-aea0-4fdafa3fae63" />

## Getting started

You'll need Node.js 22+ and the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code). If you want to review GitHub PRs, you'll also need the [`gh` CLI](https://cli.github.com) authenticated.

```bash
# Check prerequisites
node --version    # Must be 22+
claude --version  # Must be installed with Anthropic API key
gh auth status    # Only needed for PR reviews
```

Then install:

```bash
git clone <repo-url>
cd codereview
npm install
npm run build
npm link
codereview --version  # You're good to go
```

## How it works

In **quick mode** (the default), `codereview` sends the diff to Claude for analysis - fast and lightweight.

In **deep mode** (`--deep`), it goes further: cloning the repo (for PRs) or reading your local codebase (for branches) so Claude can trace how changes ripple across files, spot broken contracts, and understand the bigger picture.

Either way, you get a structured review with findings categorized by severity and type.

## Reviewing a GitHub PR

```bash
# Quick review (diff-only, default)
codereview https://github.com/owner/repo/pull/123

# Deep review (clones repo, explores codebase)
codereview https://github.com/owner/repo/pull/123 --deep

# Post findings as GitHub PR comments
codereview https://github.com/owner/repo/pull/123 --deep --post

# Generate a standalone HTML diff report
codereview https://github.com/owner/repo/pull/123 --html

# Bugs and security only, skip the noise
codereview https://github.com/owner/repo/pull/123 --mode strict

# Use a specific model
codereview https://github.com/owner/repo/pull/123 --model sonnet
```

> **Note:** `--post` creates *pending* reviews on GitHub. Nothing goes live until you submit them through the GitHub UI.

## Reviewing local branches

Review the diff between two branches without opening a PR - great for checking your work before pushing, or reviewing a teammate's branch locally. No GitHub access needed.

**Syntax:** `codereview branch <base> <compare>`

- **base** - the branch you're comparing against (e.g. `main`, `rc`). What you branched from.
- **compare** - the branch with the new work. The one you want reviewed.

Think of it like a PR: `codereview branch rc-branch feature/login-refactor` means "review the changes in `feature/login-refactor` that aren't in `rc-branch`."

```bash
# Review feature branch against rc
codereview branch rc-branch feature/login-refactor

# Just one branch? It auto-detects main/master as the base
codereview branch feature/login-refactor

# Same flags work here too
codereview branch rc-branch feature/login-refactor --deep
codereview branch rc-branch feature/login-refactor --html
codereview branch rc-branch feature/login-refactor --mode strict
```

The diff uses merge-base semantics (`git diff base...compare`), so results match what GitHub would show for the same branches in a PR.

## CLI reference

### Shared options (PR and branch)

| Flag | Description |
| --- | --- |
| `--quick` | Quick review: analyze diff only (default) |
| `--deep` | Deep review: explore the full codebase for cross-file impacts |
| `--verbose` | Show debug info including timing, model, and token counts |
| `--model <id>` | Claude model to use (`sonnet`, `opus`, `haiku`, or full model ID) |
| `--mode <mode>` | Review mode: `balanced`, `strict`, `detailed`, or `lenient` |
| `--html` | Generate standalone HTML diff report with inline annotations |

### PR-only options

| Flag | Description |
| --- | --- |
| `--post` | Post review as GitHub PR comments (created as pending) |

## Review modes

| Mode | What it does |
| --- | --- |
| `balanced` | The default. Good signal-to-noise - skips nitpicks, surfaces what matters. |
| `strict` | Bugs and security issues only. Nothing else. |
| `detailed` | The full picture: all categories, all severities, including nitpicks. |
| `lenient` | Relaxed. No nitpicks, higher bar before anything gets flagged. |
