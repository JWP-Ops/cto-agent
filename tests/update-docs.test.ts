import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');

function readWorkflow(name: string): Record<string, unknown> {
  const p = resolve(ROOT, '.github', 'workflows', name);
  return yaml.load(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

describe('update-docs workflow', () => {
  it('update-docs.yml exists', () => {
    expect(existsSync(resolve(ROOT, '.github', 'workflows', 'update-docs.yml'))).toBe(true);
  });

  it('update-docs.yml has weekly cron trigger', () => {
    const wf = readWorkflow('update-docs.yml');
    const on = wf['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('schedule');
    const schedule = on['schedule'] as Array<{ cron: string }>;
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].cron).toBeTruthy();
  });

  it('update-docs.yml has workflow_dispatch trigger', () => {
    const wf = readWorkflow('update-docs.yml');
    const on = wf['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('update-docs.yml has update-developer-site job', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    expect(jobs).toHaveProperty('update-developer-site');
  });

  it('update-docs.yml has update-notion job', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    expect(jobs).toHaveProperty('update-notion');
  });

  it('update-developer-site job dispatches to auto-fix.yml', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    const job = jobs['update-developer-site'] as Record<string, unknown>;
    const steps = job['steps'] as Array<Record<string, unknown>>;
    const dispatchStep = steps.find(s =>
      typeof s['run'] === 'string' && s['run'].includes('workflow run auto-fix.yml')
    );
    expect(dispatchStep).toBeDefined();
  });

  it('update-developer-site dispatch includes task_type update-docs', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    const job = jobs['update-developer-site'] as Record<string, unknown>;
    const steps = job['steps'] as Array<Record<string, unknown>>;
    const dispatchStep = steps.find(s =>
      typeof s['run'] === 'string' && s['run'].includes('task_type=update-docs')
    );
    expect(dispatchStep).toBeDefined();
  });

  it('update-notion job uses claude-code-action', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    const job = jobs['update-notion'] as Record<string, unknown>;
    const steps = job['steps'] as Array<Record<string, unknown>>;
    const claudeStep = steps.find(s =>
      typeof s['uses'] === 'string' && s['uses'].includes('claude-code-action')
    );
    expect(claudeStep).toBeDefined();
  });

  it('update-notion job passes notion-update-docs.md as prompt', () => {
    const wf = readWorkflow('update-docs.yml');
    const jobs = wf['jobs'] as Record<string, unknown>;
    const job = jobs['update-notion'] as Record<string, unknown>;
    const steps = job['steps'] as Array<Record<string, unknown>>;
    const claudeStep = steps.find(s =>
      typeof s['uses'] === 'string' && s['uses'].includes('claude-code-action')
    ) as Record<string, unknown> | undefined;
    expect(claudeStep).toBeDefined();
    const withBlock = claudeStep!['with'] as Record<string, unknown>;
    expect(String(withBlock['prompt_file'])).toContain('notion-update-docs.md');
  });
});

describe('update-docs prompt files', () => {
  it('prompts/update-docs.md exists', () => {
    expect(existsSync(resolve(ROOT, 'prompts', 'update-docs.md'))).toBe(true);
  });

  it('prompts/update-docs.md contains target-repo reference', () => {
    const content = readFileSync(resolve(ROOT, 'prompts', 'update-docs.md'), 'utf8');
    expect(content).toContain('target-repo');
  });

  it('prompts/update-docs.md contains developer.html reference', () => {
    const content = readFileSync(resolve(ROOT, 'prompts', 'update-docs.md'), 'utf8');
    expect(content).toContain('developer.html');
  });

  it('prompts/update-docs.md forbids auto-commit', () => {
    const content = readFileSync(resolve(ROOT, 'prompts', 'update-docs.md'), 'utf8');
    expect(content.toLowerCase()).toContain('do not');
    expect(content.toLowerCase()).toContain('commit');
  });

  it('prompts/notion-update-docs.md exists', () => {
    expect(existsSync(resolve(ROOT, 'prompts', 'notion-update-docs.md'))).toBe(true);
  });

  it('prompts/notion-update-docs.md references both Notion page IDs', () => {
    const content = readFileSync(resolve(ROOT, 'prompts', 'notion-update-docs.md'), 'utf8');
    expect(content).toContain('32c176b4-67c7-8188-9ced-ea8a6d14544b');
    expect(content).toContain('31c176b4-67c7-814f-a9da-f8962e00d7ee');
  });

  it('prompts/notion-update-docs.md restricts to capabilities sections only', () => {
    const content = readFileSync(resolve(ROOT, 'prompts', 'notion-update-docs.md'), 'utf8');
    expect(content.toLowerCase()).toContain('do not');
    expect(content.toLowerCase()).toContain('architecture');
  });
});

describe('auto-fix.yml update-docs routing', () => {
  it('auto-fix.yml task_type description includes update-docs', () => {
    const wf = readWorkflow('auto-fix.yml');
    const on = wf['on'] as Record<string, unknown>;
    const workflowCall = on['workflow_call'] as Record<string, unknown>;
    const inputs = workflowCall['inputs'] as Record<string, unknown>;
    const taskType = inputs['task_type'] as Record<string, unknown>;
    expect(String(taskType['description'])).toContain('update-docs');
  });

  it('auto-fix.yml Select prompt file step includes update-docs case', () => {
    const content = readFileSync(
      resolve(ROOT, '.github', 'workflows', 'auto-fix.yml'),
      'utf8'
    );
    expect(content).toContain('update-docs)');
    expect(content).toContain('update-docs.md');
  });
});
