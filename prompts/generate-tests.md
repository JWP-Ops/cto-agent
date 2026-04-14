# Generate Tests for Uncovered File

You are writing tests for a file with low or zero test coverage.

**To get the target file details, run these commands first:**
```bash
echo "Target file: $UNCOVERED_FILE"
echo "Current coverage: $COVERAGE_PCT%"
```

Then proceed to:

1. Read the target file at the path returned by `$UNCOVERED_FILE`
2. Identify all exported functions, classes, and methods
3. Write tests for the top-priority behaviours:
   - Happy path (expected input → expected output)
   - Edge cases (empty input, null, boundary values)
   - Error cases (invalid input, dependencies that fail)
4. Follow the existing test conventions in this repo:
   - Test files live in `tests/` (not co-located with source)
   - Use Vitest (`describe`, `it`, `expect`, `vi.mock`)
   - Mock external dependencies (HTTP calls, database, Slack)
   - Test file path mirrors source: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
5. Run the tests to confirm they pass: `npx vitest run tests/<path>.test.ts`
6. Commit: `git add tests/<path>.test.ts && git commit -m "test: add coverage for $UNCOVERED_FILE"`

**Rules:**
- Write real tests with real assertions — no `expect(true).toBe(true)`
- Mock at the module boundary (vi.mock), not inside test functions
- Do NOT modify the source file unless it has a genuine bug
- Keep the diff under 5 files and 100 lines
- If the file is too complex to test safely in one pass, test the 3 most critical functions only

**If you cannot determine safe tests with confidence:**
Create a file named `ESCALATE.txt` in the repo root with one sentence explaining why.
Do not create or modify any other files.
