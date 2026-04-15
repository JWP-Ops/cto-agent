# CTO Agent M4 — Ambient Ops via Claude Code Routines

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three ambient operations Routines that run on Anthropic's cloud — no new servers, no new GitHub Actions. These are "set and forget" automations that watch the repos and Slack so Jake doesn't have to.

**Architecture:** Three Claude Code Routines configured in the Claude Code web UI. Each Routine gets a prompt stored in `prompts/routines/` for version control. CLAUDE.md gains a new Routines section documenting this 4th layer. No changes to the Hono monitor or GitHub Actions — Routines sit alongside the existing stack, not replacing it.

**Run budget:** Each Routine fires at most once/day (or once per qualifying event). 3 runs/day total fits comfortably in the Max plan limit (15/day) with headroom.

---

## What M4 Adds (Plain English)

| Routine | When it fires | What it does |
|---------|--------------|--------------|
| Nightly PR Digest | Every night at 9 PM CST | Scans all repos, posts a Slack summary: what's ready to merge, what needs review, what's blocked |
| Issue Triage | When a new GitHub issue is opened | Labels it (bug/feature/docs/question), sets priority, posts a triage comment, Slacks Jake on critical issues |
| Release Changelog | When a GitHub release is created | Reads the diff, writes a human-readable changelog, updates the release description |

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `prompts/routines/nightly-pr-digest.md` | Create | Routine prompt for nightly PR summary |
| `prompts/routines/issue-triage.md` | Create | Routine prompt for issue auto-triage |
| `prompts/routines/release-changelog.md` | Create | Routine prompt for release notes generation |
| `CLAUDE.md` | Modify | Add Routines as 4th architectural layer |
| `docs/superpowers/plans/2026-04-14-cto-agent-m4-routines-ambient-ops.md` | Create | Self-contained M4 plan (this document, renamed) |

No Hono monitor changes. No GitHub Actions changes. No new dependencies.

---

## Task 1: Create `prompts/routines/nightly-pr-digest.md`

```markdown
# Nightly PR Digest

You are the CTO Agent for StorScale. It's your nightly check-in. Scan all open pull requests and post a digest to Slack.

## Repos to scan
- StorScale-AI/storscale-dashboard
- StorScale-AI/storscale-agents
- JWP-Ops/cto-agent
- JWP-Ops/cfo-agent
- JWP-Ops/life-orchestrator

## Process
1. List open PRs in each repo via GitHub
2. For each PR, check: CI status, review status, last commit age, merge conflicts
3. Categorise:
   - **Ready to merge** — all checks pass, approved, no conflicts
   - **Needs review** — checks pass, no approval yet
   - **Blocked** — failing checks or merge conflicts
   - **Stale** — no activity in 3+ days

4. Post ONE Slack message to #cto-agent with this format:

```
*Nightly PR Digest — [date]*

✅ *Ready to merge (N)*
• [repo] #123 — PR title (waiting X days)

👀 *Needs review (N)*
• [repo] #124 — PR title

🚫 *Blocked (N)*
• [repo] #125 — PR title — reason

💤 *Stale (N)*
• [repo] #126 — PR title — N days idle
```

5. If all PRs are in good shape (none blocked, none stale), post a brief "All clear" message instead.

## Rules
- Never post more than one Slack message per run
- Never comment on PRs — read only
- If GitHub API is unavailable for a repo, skip it and note "could not reach [repo]" in the message
- Keep the message under 40 lines
```

---

## Task 2: Create `prompts/routines/issue-triage.md`

```markdown
# GitHub Issue Triage

You are the CTO Agent for StorScale. A new GitHub issue was just opened. Your job is to label it, assess priority, and post a triage comment.

## Get the issue details
```bash
echo "Repo: $GITHUB_REPOSITORY"
echo "Issue: #$GITHUB_ISSUE_NUMBER"
```

Then read the issue using the GitHub tool.

## Step 1: Classify the issue type
Apply exactly ONE label:
- `bug` — something broken in production
- `feature` — new capability requested
- `docs` — documentation improvement
- `question` — usage question, not a bug
- `security` — potential vulnerability (treat as critical automatically)

## Step 2: Assess priority
Apply exactly ONE priority label:
- `priority: critical` — blocks users from a core workflow → escalate to Slack immediately
- `priority: high` — significant impact, needs attention within 48h
- `priority: normal` — standard queue
- `priority: low` — nice to have

## Step 3: Post a triage comment
Be specific and direct. Example:
> **Triage:** Bug — Priority: High
>
> This looks like a race condition in the auth flow when two tabs open simultaneously. The `useSession` hook doesn't guard against concurrent refresh calls.
>
> Next step: reproduce with two browser tabs on app.storscale.ai/login, then trace to `src/hooks/useSession.ts`.

## Step 4: Escalate if needed
If `priority: critical` OR type is `security`:
- Post to #cto-agent Slack: "🚨 New [critical/security] issue: [title] — [repo]#[number]"

## Rules
- NEVER close, assign to a person, or modify the issue body
- Security issues: Slack escalation BEFORE posting the triage comment
- If you cannot determine the type with confidence, apply `question` and say so in the comment
- Keep your triage comment under 10 lines
```

---

## Task 3: Create `prompts/routines/release-changelog.md`

```markdown
# Release Changelog Generator

You are the CTO Agent for StorScale. A new GitHub release was just created (or a release tag pushed). Generate a human-readable changelog and update the release description.

## Get context
```bash
echo "Repo: $GITHUB_REPOSITORY"
echo "Tag: $GITHUB_REF_NAME"
```

## Process
1. Find the previous release tag in this repo
2. Read the git log between the previous tag and the new tag
3. Group commits by type:
   - **New** — feat commits
   - **Fixed** — fix commits
   - **Infrastructure** — chore/ci/refactor commits (summarise, don't list each one)
4. Write a changelog using StorScale brand voice:
   - Dollar amounts over technical scores: "Marketplace ROI card now shows payback period in months" not "Added payback_months field"
   - Operator perspective: what does this mean for the facility owner?
   - Skip internal/infra changes unless they affect reliability
5. Update the GitHub release description with the changelog
6. Post to #storscale-dev Slack:
   > *Release [tag] — [repo]*
   > [2-3 sentence summary of what's new]
   > Full notes: [release URL]

## Changelog format
```markdown
## What's new in [tag]

### New
- Marketplace ROI card shows monthly payback on ad spend
- Sites dashboard now live at /sites

### Fixed  
- Onboarding step 5 now saves correctly on first attempt
- Facility selector no longer flickers on load

### Infrastructure
- Supabase Realtime replaces Socket.io for chat (faster, no reconnect drops)
```

## Rules
- Never create a new release — only update the description of the one that was just created
- Keep the Slack message to 3-4 lines max
- Use plain language — Jake reads these, not developers
- If there are fewer than 3 meaningful commits, write "Minor release — see commit log for details" and skip the Slack post
```

---

## Task 4: Update `CLAUDE.md`

Add a new section after the existing `## Architecture` block:

```markdown
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
```

---

## Task 5: Create M4 plan in repo

Copy the final version of this plan to:
`cto-agent/docs/superpowers/plans/2026-04-14-cto-agent-m4-routines-ambient-ops.md`

---

## How to Configure the Routines (After Files Are Committed)

1. Go to **claude.ai/code → Routines tab** (requires Claude Code web enabled)
2. Create 3 Routines — one per prompt file:

**Routine: Nightly PR Digest**
- Trigger: Scheduled → 9 PM CST (3 AM UTC)
- Repo: `JWP-Ops/cto-agent`
- Prompt: paste contents of `prompts/routines/nightly-pr-digest.md`
- Connectors: GitHub, Slack

**Routine: Issue Triage**
- Trigger: GitHub event → `issues.opened`
- Repos: all 5 StorScale repos
- Prompt: paste contents of `prompts/routines/issue-triage.md`
- Connectors: GitHub, Slack

**Routine: Release Changelog**
- Trigger: GitHub event → `release.created`
- Repos: storscale-dashboard, storscale-agents
- Prompt: paste contents of `prompts/routines/release-changelog.md`
- Connectors: GitHub, Slack

---

## Verification

- [ ] After committing, manually trigger Issue Triage by opening a test issue on a private repo
- [ ] Verify the Slack message arrives in #cto-agent
- [ ] Verify the triage labels appear on the issue
- [ ] Close the test issue
- [ ] Wait for the next nightly digest or manually trigger via Routine API (POST with bearer token)
- [ ] Release Changelog: create a draft release tag on storscale-dashboard, verify description is updated

---

## Notes

- Routines are **research preview** as of April 14, 2026. If the feature changes significantly before M4 execution, revisit the trigger configuration.
- The `SLACK_BOT_TOKEN` blocker in memory still applies — Slack connector in Routines may use a different auth mechanism. Verify in the Routines connector setup.
- M4 does NOT touch the Hono monitor, GitHub Actions, or pattern matchers — zero regression risk on M1-M3 work.
