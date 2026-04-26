import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * BL-077 — Regression test.
 *
 * GitHub Actions reusable-workflow inputs are strictly typed. The reusable
 * `auto-fix.yml` declares `run_id: type: string`. The expression
 * `${{ github.event.workflow_run.id }}` evaluates to a NUMBER on the
 * `workflow_run` event payload, so passing it bare to a string-typed input
 * causes the caller workflow to fail with `startup_failure` before any step
 * runs — the auto-fix never triggers and we silently lose CI safety net coverage.
 *
 * Fix: wrap with `format('{0}', ...)` (only stringify built-in available in
 * GH Actions expressions). This test is the regression guard.
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
