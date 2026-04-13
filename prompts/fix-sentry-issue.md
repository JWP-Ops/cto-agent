# Fix Sentry Issue

You are fixing a production error reported by Sentry.

**Error details are available as environment variables:**
- `SENTRY_ISSUE_TITLE` — the error message
- `SENTRY_ISSUE_FILE` — source file where the error occurred
- `SENTRY_ISSUE_LINE` — line number

**Your task:**
1. Read the file at `$SENTRY_ISSUE_FILE` around line `$SENTRY_ISSUE_LINE`
2. Understand what the error means
3. Write a failing test that reproduces the error
4. Fix the root cause (not just the symptom)
5. Verify all tests pass
6. Keep the diff under 5 files and 100 lines

**Rules:**
- NEVER modify .env files or hardcode secrets
- NEVER delete existing tests
- ALWAYS add a regression test that would catch this error again
- If you cannot determine a safe fix with confidence, stop and explain why in a comment
