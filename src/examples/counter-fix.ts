/**
 * Bug Fix: Counter Reset Button
 *
 * BEFORE (bugged):
 *   function resetCounter() {
 *     // count = 0;  // BUG: variable never reset
 *     document.querySelector("#count").textContent = count;
 *   }
 *
 * AFTER (fixed):
 *   function resetCounter() {
 *     count = 0;  // FIX: properly reset the variable
 *     document.querySelector("#count").textContent = count;
 *   }
 *
 * Verified by Bug Fix Verification Agent:
 * - AI-generated Playwright test confirmed the fix
 * - Claude Vision analysis: HIGH confidence
 * - Video evidence recorded
 */
export const counterFixExample = {
  bug: 'Counter reset button does not reset the count to zero',
  rootCause: 'count variable not reset before DOM update',
  fix: 'Added count = 0 in resetCounter()',
  verified: true,
};
