/**
 * Render a millisecond duration as a human-readable label suitable for
 * the chat-reasoning "Thought for Ns" pill.
 *
 * - Less than 1 s → `<1s`
 * - 1–59 s       → "Ns"     (e.g. "4s")
 * - ≥60 s        → "Nm Ms"  (e.g. "1m 12s", "60m 0s")
 *
 * Negative or non-finite inputs collapse to `<1s` so a corrupted timing
 * map never produces noisy output.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return '<1s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds}s`;
}
