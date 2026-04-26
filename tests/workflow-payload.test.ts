import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * BL-077 — Regression test.
 *
 * The cto-auto-fix.yml caller has TWO failure modes that both produce silent
 * `startup_failure` runs (no logs, no jobs, no annotations) at the
 * workflow_call boundary. Both must be present for the auto-fix path to work.
 *
 * 1. Type coercion: GH Actions reusable-workflow inputs are strictly typed.
 *    auto-fix.yml declares `run_id: type:string`, but
 *    `${{ github.event.workflow_run.id }}` evaluates to a NUMBER on
 *    workflow_run events. Passing it bare causes startup_failure.
 *    Fix: wrap with `format('{0}', ...)`.
 *
 * 2. Permissions: auto-fix.yml's job requests `pull-requests: write` (it
 *    creates PRs for novel fixes). A reusable workflow cannot request more
 *    permissions than the caller grants. The caller MUST grant
 *    `pull-requests: write` at the workflow level or startup_failure fires
 *    with: "The nested job 'auto-fix' is requesting 'pull-requests: write',
 *    but is only allowed 'pull-requests: none'."
 *
 * This test is the regression guard for both.
 */

const REPO_ROOT = join(__dirname, '..');

const CALLER_TEMPLATES = [
  join(REPO_ROOT, 'caller-template/cto-auto-fix.yml'),
  join(REPO_ROOT, '.github/caller-template/cto-auto-fix.yml'),
];

const WORKFLOW_RUN_ID_REF = /\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}/;
const FORMAT_WRAPPED = /\$\{\{\s*format\s*\(\s*['"]\{0\}['"]\s*,\s*github\.event\.workflow_run\.id\s*\)\s*\}\}/;

export interface CoercionIssue {
  line: number;
  raw: string;
}

export function findUncoercedRunIdReferences(yamlText: string): CoercionIssue[] {
  const issues: CoercionIssue[] = [];
  const lines = yamlText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!WORKFLOW_RUN_ID_REF.test(line)) continue;
    if (FORMAT_WRAPPED.test(line)) continue;
    issues.push({ line: i + 1, raw: line.trim() });
  }
  return issues;
}

/**
 * Returns true if the workflow YAML grants `pull-requests: write` at the
 * workflow level. The reusable `auto-fix.yml` requests this at the job level,
 * so the caller must grant at least this much or workflow_call fails with
 * startup_failure.
 */
export function hasPullRequestsWritePermission(yamlText: string): boolean {
  const parsed = yaml.load(yamlText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return false;
  const permissions = (parsed as { permissions?: Record<string, string> | string }).permissions;
  if (!permissions) return false;
  if (typeof permissions === 'string') {
    // 'write-all' grants every scope; 'read-all' / 'none' do not include pr:write.
    return permissions === 'write-all';
  }
  return permissions['pull-requests'] === 'write';
}

describe('BL-077: workflow_run.id type coercion at workflow_call boundary', () => {
  it('detects a bare workflow_run.id reference as an issue', () => {
    const sample = `      run_id: \${{ github.event.workflow_run.id }}`;
    const issues = findUncoercedRunIdReferences(sample);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
  });

  it('accepts a format-wrapped workflow_run.id reference', () => {
    const sample = `      run_id: \${{ format('{0}', github.event.workflow_run.id) }}`;
    expect(findUncoercedRunIdReferences(sample)).toEqual([]);
  });

  it('accepts a format-wrapped reference with double-quoted format string', () => {
    const sample = `      run_id: \${{ format("{0}", github.event.workflow_run.id) }}`;
    expect(findUncoercedRunIdReferences(sample)).toEqual([]);
  });

  it('ignores lines that do not reference workflow_run.id', () => {
    const sample = `      repo: \${{ github.repository }}\n      run_id: '0'`;
    expect(findUncoercedRunIdReferences(sample)).toEqual([]);
  });

  for (const path of CALLER_TEMPLATES) {
    it(`caller-template at ${path.replace(REPO_ROOT + '/', '')} coerces run_id to string`, () => {
      if (!existsSync(path)) {
        throw new Error(`Expected caller-template file at ${path} (BL-077 dependency)`);
      }
      const yamlText = readFileSync(path, 'utf8');
      const issues = findUncoercedRunIdReferences(yamlText);
      expect(issues, `Uncoerced github.event.workflow_run.id in ${path}: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

describe('BL-077: caller workflow grants pull-requests: write permission', () => {
  it('detects missing pull-requests permission', () => {
    const sample = [
      'permissions:',
      '  contents: write',
      '  id-token: write',
    ].join('\n');
    expect(hasPullRequestsWritePermission(sample)).toBe(false);
  });

  it('accepts pull-requests: write at workflow level', () => {
    const sample = [
      'permissions:',
      '  contents: write',
      '  pull-requests: write',
      '  id-token: write',
    ].join('\n');
    expect(hasPullRequestsWritePermission(sample)).toBe(true);
  });

  it('accepts top-level write-all shorthand', () => {
    expect(hasPullRequestsWritePermission('permissions: write-all')).toBe(true);
  });

  it('rejects top-level read-all shorthand', () => {
    expect(hasPullRequestsWritePermission('permissions: read-all')).toBe(false);
  });

  it('rejects pull-requests: read', () => {
    const sample = [
      'permissions:',
      '  pull-requests: read',
    ].join('\n');
    expect(hasPullRequestsWritePermission(sample)).toBe(false);
  });

  for (const path of CALLER_TEMPLATES) {
    it(`caller-template at ${path.replace(REPO_ROOT + '/', '')} grants pull-requests: write`, () => {
      if (!existsSync(path)) {
        throw new Error(`Expected caller-template file at ${path} (BL-077 dependency)`);
      }
      const yamlText = readFileSync(path, 'utf8');
      expect(hasPullRequestsWritePermission(yamlText), `Missing pull-requests: write in ${path}`).toBe(true);
    });
  }
});
