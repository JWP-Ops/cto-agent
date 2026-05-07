#!/bin/bash
# Standard Claude Code session-start hook
# Source-of-truth pattern: ~/Claude/README.md "Tools & skills" + per-repo CLAUDE.md
# Two parts:
#   (1) idempotent graphify install on remote sessions
#   (2) inject graphify graph context into Claude's session if graph is built
set -euo pipefail

# === Part 1: Install graphify on remote sessions (idempotent) ===
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if ! command -v graphify >/dev/null 2>&1; then
    pip install --quiet graphifyy 2>/dev/null || true
  fi
  if [ ! -f "${HOME}/.claude/skills/graphify/SKILL.md" ]; then
    graphify install >/dev/null 2>&1 || true
  fi
fi

# === Part 2: Inject graphify context if graph is built ===
REPORT="graphify-out/GRAPH_REPORT.md"
if [ ! -f "$REPORT" ]; then
  exit 0
fi

python3 <<'PY' 2>/dev/null || true
import json, pathlib, re

report = pathlib.Path("graphify-out/GRAPH_REPORT.md").read_text()

# Split into sections by "## " headers
sections = {}
current = None
buf = []
for line in report.split("\n"):
    if line.startswith("## "):
        if current is not None:
            sections[current] = "\n".join(buf).strip()
        current = line[3:].strip()
        buf = []
    else:
        buf.append(line)
if current is not None:
    sections[current] = "\n".join(buf).strip()

wanted = [
    "Summary",
    "God Nodes (most connected - your core abstractions)",
    "Surprising Connections (you probably didn't know these)",
]
parts = [f"## {k}\n{sections[k]}" for k in wanted if k in sections]

hubs = sections.get("Community Hubs (Navigation)", "")
hub_lines = [l for l in hubs.split("\n") if l.startswith("- [[")][:20]
if hub_lines:
    label_re = re.compile(r"\|([^\]]+)\]\]")
    labels = [label_re.search(l).group(1) for l in hub_lines if label_re.search(l)]
    parts.append("## Top Communities\n" + "\n".join(f"- {l}" for l in labels))

body = "\n\n".join(parts)
ctx = (
    "graphify knowledge graph is available at graphify-out/.\n\n"
    f"{body}\n\n"
    "For deeper queries: `graphify query \"<question>\"`, "
    "`graphify path \"<A>\" \"<B>\"`, `graphify explain \"<concept>\"`. "
    "Full report: graphify-out/GRAPH_REPORT.md. Wiki: graphify-out/wiki/index.md."
)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": ctx,
    }
}))
PY
