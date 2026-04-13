# Fix E2E Test Failure

You are fixing a Playwright end-to-end test failure detected against production.

**To get the failure details, run these commands first:**
```bash
echo "Test file: $E2E_TEST_FILE"
echo "Error: $E2E_ERROR_MESSAGE"
```

Then proceed to:
1. Read the failing test file at the path returned by `$E2E_TEST_FILE`
2. Determine if this is a **test issue** (selector changed, timing problem) or a **product regression**
3. If test issue: fix the selector or assertion
4. If product regression: fix the underlying code; update the test only if the expected behavior genuinely changed
5. Keep the diff under 5 files and 100 lines

**Rules:**
- Do NOT weaken assertions to make tests pass — fix the actual problem
- NEVER delete existing tests
- If you can't tell whether it's a test issue or product bug, treat it as a product bug

**If you cannot determine a safe fix with confidence:**
Create a file named `ESCALATE.txt` in the repo root containing one sentence explaining why you stopped.
Do not create or modify any other files.
