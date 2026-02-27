# Bug Fix Example: Counter Reset

## Bug
The counter reset button does not reset the count to zero. After incrementing to 5 and clicking reset, the counter stays at 5.

## Root Cause
In `resetCounter()`, the line `count = 0` was commented out, so the DOM updates with the stale value.

```diff
  function resetCounter() {
-   // count = 0;  // BUG: forgot to reset variable
+   count = 0;     // FIX: properly reset the variable
    document.querySelector("#count").textContent = count;
  }
```

## Verification
The Bug Fix Verification Agent automatically:
1. Generated a Playwright test from the bug description
2. Ran the test — FAILED (confirmed the bug existed)
3. Self-healed and identified the root cause
4. Applied the fix and re-ran — PASSED
5. Claude Vision confirmed the UI renders correctly
6. Video evidence and screenshots attached below
