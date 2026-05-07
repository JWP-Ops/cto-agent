# CTO Agent

> Workspace map: `~/Claude/README.md` — read it for cross-repo context and sister paths.

## What This Is
Automated CI/deploy auto-fix agent and infrastructure monitor for all StorScale and JWP-Ops repos. Called by every other repo's CI on failure. Monitors GitHub CI, Render deploys, Stripe webhooks, Supabase, Vercel, Cloudflare, and agent health.

## Architecture
- **patterns/** — Pattern matchers for known CI failure types (fast path, no AI)
- **monitor/** — Hono service on Render that polls all infrastructure and feeds health data
- **.github/workflows/auto-fix.yml** — Reusable workflow called by each repo on CI failure
- **prompts/** — Claude Code system prompts for novel failure analysis
- **caller-template/** — Thin workflow YAML to copy into each monitored repo

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

## Tools & skills (cross-project)

Three globally-installed tools augment Claude Code in every active repo. **Install instructions live in `~/Claude/README.md` "Tools & skills" section** — don't reproduce them here (drift trap).

- **gstack** — `/qa`, `/ship`, `/review`, `/investigate`, `/browse`. Use `/browse` for ALL web browsing in any session.
- **graphify** — knowledge graph at `graphify-out/`. Read `graphify-out/GRAPH_REPORT.md` before architecture or cross-module questions. Run `graphify update .` after significant code changes.
- **openspace** — MCP-based self-evolving skills engine (auto-fix, auto-improve, ~46% token reduction on real tasks per GDPVal). Use for complex multi-step tasks similar to ones done before. Surfaces as `delegate-task` and `skill-discovery` skills.
- **ruflo** — multi-agent orchestration skills bundle from `ruvnet/ruflo` (github-release-management, github-workflow-automation, github-project-management, reasoningbank-intelligence, agent-coordination). Use for GitHub workflow automation, cross-agent coordination, and project tracking tasks. Skills installed via symlink from `~/Claude/ruflo/.claude/skills/` to `~/.claude/skills/`.
