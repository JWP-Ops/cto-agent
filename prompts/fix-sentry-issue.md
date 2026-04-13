# Fix Sentry Issue

You are fixing a production error reported by Sentry.

**To get the error details, run these commands first:**
```bash
echo "Title: $SENTRY_ISSUE_TITLE"
echo "File: $SENTRY_ISSUE_FILE"
echo "Line: $SENTRY_ISSUE_LINE"
```

Then proceed to:
1. Read the file at the path returned by `$SENTRY_ISSUE_FILE` around the line number from `$SENTRY_ISSUE_LINE`
2. Understand what the error means
3. Write a failing test that reproduces the error
4. Fix the root cause (not just the symptom)
5. Verify all tests pass
6. Keep the diff under 5 files and 100 lines

**Rules:**
- NEVER modify .env files or hardcode secrets
- NEVER delete existing tests
- ALWAYS add a regression test that would catch this error again

**If you cannot determine a safe fix with confidence:**
Create a file named `ESCALATE.txt` in the repo root containing one sentence explaining why you stopped.
Do not create or modify any other files.
