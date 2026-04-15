# CTO Agent

## What This Is
Automated CI/deploy auto-fix agent and infrastructure monitor for all StorScale repos.
Monitors GitHub CI, Render deploys, Stripe webhooks, Supabase, Vercel, Cloudflare, and agent health.

## Architecture
- **patterns/** — Pattern matchers for known CI failure types (fast path, no AI)
- **monitor/** — Hono service on Render that polls all infrastructure and feeds health data
- **.github/workflows/auto-fix.yml** — Reusable workflow called by each repo on CI failure
- **prompts/** — Claude Code system prompts for novel failure analysis
- **caller-template/** — Thin workflow YAML to copy into each monitored repo

## Routines (M4 — Ambient Ops)

Three Claude Code Routines run on Anthropic-managed cloud infrastructure (not Render). They complement the monitor — the monitor handles real-time polling, Routines handle low-frequency ambient tasks.

| Routine | Trigger | Prompt |
|---------|---------|--------|
| Nightly PR Digest | Scheduled — 9 PM CST | `prompts/routines/nightly-pr-digest.md` |
| Issue Triage | GitHub webhook: `issues.opened` | `prompts/routines/issue-triage.md` |
| Release Changelog | GitHub webhook: `release.created` | `prompts/routines/release-changelog.md` |

**Run budget:** Max plan = 15 runs/day. These 3 Routines use ≤ 3-5/day in practice.

**To reconfigure a Routine:** Edit the prompt file in `prompts/routines/`, then update the Routine's prompt in Claude Code web (claude.ai/code → Routines tab).

**Why not replace the monitor?** Routines have an hourly minimum schedule — too slow for the 2-min deploy failure detection and 5-min CI polling the monitor does. Use both.

## Stack
- TypeScript, ESM (`"type": "module"`)
- Vitest for testing
- Hono + @hono/node-server for monitor service
- `anthropics/claude-code-action@v1` for AI-powered fixes

## Conventions
- Pattern matchers export `match(logText, annotations)` returning `PatternResult | null`
- Confidence threshold: 0.8 (below = escalate to Claude Code or Slack)
- Auto-fix commits use `[cto-fix]` tag in commit message
- Max diff: 5 files, 100 lines
- Max 1 fix attempt per failure — escalate on second failure

## Safety Rules
- NEVER modify .env files
- NEVER hardcode secrets
- NEVER delete tests
- Every fix MUST include a regression test
