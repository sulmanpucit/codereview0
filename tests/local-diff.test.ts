import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

const {
  validateBranchExists,
  detectDefaultBranch,
  hasUncommittedChanges,
  assertInsideGitRepo,
  buildLocalPRData,
} = await import('../src/local-diff.js');

describe('validateBranchExists', () => {
  it('succeeds for existing branch', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(''));
    expect(() => validateBranchExists('main')).not.toThrow();
  });

  it('throws for non-existent branch', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('fatal: not a valid ref');
    });
    expect(() => validateBranchExists('nonexistent')).toThrow(
      "Branch 'nonexistent' does not exist",
    );
  });
});

describe('detectDefaultBranch', () => {
  it('returns main when main exists', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(''));
    expect(detectDefaultBranch()).toBe('main');
  });

  it('returns master when main does not exist but master does', () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('main')) throw new Error('not found');
      return Buffer.from('');
    });
    expect(detectDefaultBranch()).toBe('master');
  });

  it('throws when neither main nor master exists', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(() => detectDefaultBranch()).toThrow('Could not detect default branch');
  });
});

describe('hasUncommittedChanges', () => {
  it('returns false for clean working tree', () => {
    mockedExecFileSync.mockReturnValue('' as unknown as Buffer);
    expect(hasUncommittedChanges()).toBe(false);
  });

  it('returns true for dirty working tree', () => {
    mockedExecFileSync.mockReturnValue('M src/foo.ts\n' as unknown as Buffer);
    expect(hasUncommittedChanges()).toBe(true);
  });

  it('returns false for whitespace-only output', () => {
    mockedExecFileSync.mockReturnValue('  \n' as unknown as Buffer);
    expect(hasUncommittedChanges()).toBe(false);
  });
});

describe('assertInsideGitRepo', () => {
  it('succeeds inside a git repo', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from('true'));
    expect(() => assertInsideGitRepo()).not.toThrow();
  });

  it('throws outside a git repo', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => assertInsideGitRepo()).toThrow('Not inside a git repository');
  });
});

describe('buildLocalPRData', () => {
  it('rejects branch names with leading dash (security)', async () => {
    await expect(buildLocalPRData('main', '--evil')).rejects.toThrow(
      'starts with a dash',
    );
  });

  it('rejects branch names with null bytes (security)', async () => {
    await expect(buildLocalPRData('main', 'branch\0evil')).rejects.toThrow(
      'null byte',
    );
  });

  it('constructs PRData from git output', async () => {
    const diffOutput = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
    ].join('\n');

    const numstatOutput = '2\t1\tsrc/foo.ts\n';
    const nameStatusOutput = 'M\tsrc/foo.ts\n';
    const logOutput = 'Fix variable assignment\n\nDetailed description\n---';
    const firstSubject = 'Fix variable assignment';
    const author = 'Test Author';
    const headSha = 'abc123def456';
    const remoteUrl = 'https://github.com/testowner/testrepo.git';

    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];

      // assertInsideGitRepo
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      // validateBranchExists
      if (argsArr.includes('--verify')) return Buffer.from('');
      // getLocalDiff
      if (argsArr[0] === 'diff' && !argsArr.includes('--numstat') && !argsArr.includes('--name-status')) {
        return diffOutput as unknown as Buffer;
      }
      // parseDiffStats (--numstat)
      if (argsArr.includes('--numstat')) return numstatOutput as unknown as Buffer;
      // refineFileStatuses (--name-status)
      if (argsArr.includes('--name-status')) return nameStatusOutput as unknown as Buffer;
      // getCommitInfo (log with format)
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s%n%b%n---')) {
        return logOutput as unknown as Buffer;
      }
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) {
        return firstSubject as unknown as Buffer;
      }
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) {
        return author as unknown as Buffer;
      }
      // resolveRef
      if (argsArr[0] === 'rev-parse' && !argsArr.includes('--verify') && !argsArr.includes('--is-inside-work-tree')) {
        return headSha as unknown as Buffer;
      }
      // getRepoInfo
      if (argsArr.includes('get-url')) return remoteUrl as unknown as Buffer;

      return Buffer.from('');
    });

    const result = await buildLocalPRData('main', 'feature-branch');

    expect(result.number).toBe(0);
    expect(result.title).toBe('Fix variable assignment');
    expect(result.author).toBe('Test Author');
    expect(result.baseBranch).toBe('main');
    expect(result.headBranch).toBe('feature-branch');
    expect(result.headSha).toBe('abc123def456');
    expect(result.headRepoOwner).toBe('testowner');
    expect(result.headRepoName).toBe('testrepo');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    expect(result.changedFiles).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe('src/foo.ts');
    expect(result.files[0].status).toBe('modified');
    expect(result.diff).toContain('diff --git');
  });

  it('handles empty diff (no changes between branches)', async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      if (argsArr.includes('--verify')) return Buffer.from('');
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) return 'Some commit' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) return 'Author' as unknown as Buffer;
      if (argsArr[0] === 'rev-parse') return 'sha123' as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = await buildLocalPRData('main', 'main');

    expect(result.diff).toBe('');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.files).toHaveLength(0);
  });

  it('falls back to "local" when no remote is configured', async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      if (argsArr.includes('--verify')) return Buffer.from('');
      if (argsArr.includes('get-url')) throw new Error('no remote');
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) return 'commit' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) return 'Author' as unknown as Buffer;
      if (argsArr[0] === 'rev-parse') return 'sha123' as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = await buildLocalPRData('main', 'feature');

    expect(result.headRepoOwner).toBe('local');
    expect(result.headRepoName).toBe('local');
  });

  it('parses SSH remote URLs correctly', async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      if (argsArr.includes('--verify')) return Buffer.from('');
      if (argsArr.includes('get-url')) return 'git@github.com:myorg/myrepo.git' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) return 'commit' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) return 'Author' as unknown as Buffer;
      if (argsArr[0] === 'rev-parse') return 'sha123' as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = await buildLocalPRData('main', 'feature');

    expect(result.headRepoOwner).toBe('myorg');
    expect(result.headRepoName).toBe('myrepo');
  });

  it('uses execFileSync (not exec) for all subprocess calls', async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      if (argsArr.includes('--verify')) return Buffer.from('');
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) return 'commit' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) return 'Author' as unknown as Buffer;
      if (argsArr[0] === 'rev-parse') return 'sha123' as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    await buildLocalPRData('main', 'feature');

    for (const call of mockedExecFileSync.mock.calls) {
      expect(call[0]).toMatch(/^(git)$/);
      expect(Array.isArray(call[1])).toBe(true);
    }
  });

  it('handles binary files in numstat (shown as - -)', async () => {
    const numstatOutput = '-\t-\timage.png\n3\t1\tsrc/foo.ts\n';

    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('--is-inside-work-tree')) return Buffer.from('true');
      if (argsArr.includes('--verify')) return Buffer.from('');
      if (argsArr.includes('--numstat')) return numstatOutput as unknown as Buffer;
      if (argsArr.includes('--name-status')) return 'A\timage.png\nM\tsrc/foo.ts\n' as unknown as Buffer;
      if (argsArr[0] === 'diff' && !argsArr.includes('--numstat') && !argsArr.includes('--name-status')) {
        return 'diff --git a/src/foo.ts b/src/foo.ts\n' as unknown as Buffer;
      }
      if (argsArr[0] === 'log' && argsArr.includes('--format=%s')) return 'commit' as unknown as Buffer;
      if (argsArr[0] === 'log' && argsArr.includes('--format=%an')) return 'Author' as unknown as Buffer;
      if (argsArr[0] === 'rev-parse') return 'sha123' as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = await buildLocalPRData('main', 'feature');

    expect(result.files).toHaveLength(2);
    const binaryFile = result.files.find(f => f.filename === 'image.png');
    expect(binaryFile).toBeDefined();
    expect(binaryFile!.additions).toBe(0);
    expect(binaryFile!.deletions).toBe(0);
    expect(binaryFile!.status).toBe('added');
  });
});

describe('buildLocalPRData security', () => {
  it('rejects path traversal in branch names', async () => {
    await expect(buildLocalPRData('main', 'evil/../etc/passwd')).rejects.toThrow(
      'path traversal',
    );
  });

  it('validates both base and compare branches', async () => {
    await expect(buildLocalPRData('--evil', 'feature')).rejects.toThrow(
      'starts with a dash',
    );
  });
});
