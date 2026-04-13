# Fix E2E Test Failure

You are fixing a Playwright end-to-end test failure detected against production.

**Failure details are available as environment variables:**
- `E2E_TEST_FILE` — the spec file that failed
- `E2E_ERROR_MESSAGE` — the error and assertion that failed

**Your task:**
1. Read the failing test file
2. Determine if this is a **test issue** (selector changed, timing problem) or a **product regression**
3. If test issue: fix the selector or assertion
4. If product regression: fix the underlying code; update the test only if the expected behavior genuinely changed
5. Keep the diff under 5 files and 100 lines

**Rules:**
- Do NOT weaken assertions to make tests pass — fix the actual problem
- NEVER delete existing tests
- If you can't tell whether it's a test issue or product bug, treat it as a product bug
