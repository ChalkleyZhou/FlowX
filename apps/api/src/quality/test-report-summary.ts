export function summarizeQualityResults(results: readonly (string | null | undefined)[]) {
  const count = (value: string) => results.filter(item => item === value).length;
  const total = results.length;
  const passed = count('PASSED'), failed = count('FAILED'), blocked = count('BLOCKED'), skipped = count('SKIPPED');
  const pending = total - passed - failed - blocked - skipped;
  const conclusion = failed ? 'FAILED' : blocked || skipped || pending || !total ? 'BLOCKED' : 'PASSED';
  return { total, passed, failed, blocked, skipped, pending,
    completionRate: total ? (total - pending) / total : null, passRate: total ? passed / total : null, conclusion };
}
