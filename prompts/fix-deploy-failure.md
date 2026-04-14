# Fix Render Deploy Failure

You are fixing a failed Render service deployment.

**Read the failure context first:**

```bash
echo "Service:  $DEPLOY_SERVICE"
echo "Deploy:   $DEPLOY_ID"
echo "Summary:  $DEPLOY_LOGS"
```

Then follow these steps:

1. **Understand the failure type** from `$DEPLOY_LOGS`:
   - TypeScript/compile error → find and fix the type or import in the target file
   - Test failure during CI → fix the failing test or the code under test
   - Dependency not found → run `npm install` and commit the updated lock file
   - Missing environment variable → write `ESCALATE.txt` (cannot be auto-fixed)

2. **Check recent commits** to find what changed:
   ```bash
   git log --oneline -10
   git diff HEAD~1 --name-only
   ```

3. **Read the relevant files** changed in the last commit.

4. **Apply the minimal targeted fix.**

5. **Run the test suite and TypeScript check:**
   ```bash
   npx vitest run
   npx tsc --noEmit
   ```

6. **Commit with [cto-fix] tag:**
   ```bash
   git add <files>
   git commit -m "[cto-fix] fix Render deploy failure in $DEPLOY_SERVICE"
   ```

**Rules:**
- Max 5 files changed, 100 lines total diff
- Every fix MUST include a regression test (except pure dependency lock file updates)
- NEVER add or change environment variables — if the failure is a missing env var, write `ESCALATE.txt`
- If the root cause is not determinable from the deploy summary and recent history, write `ESCALATE.txt`

**If you cannot safely fix this:**

Create `ESCALATE.txt` in the repo root:
```
Render deploy failure in $DEPLOY_SERVICE (deploy $DEPLOY_ID) requires manual intervention: <one sentence reason>.
```
Do not create or modify any other files.
