// CLI entrypoints abort their children and await cleanup instead of orphaning
// an agent/browser when the terminal or deployment sends a termination signal.
export function handleTermination() {
  const controller = new AbortController();
  const interrupt = () => {process.exitCode = 130;controller.abort();};
  const terminate = () => {process.exitCode = 143;controller.abort();};
  process.once('SIGINT',interrupt);
  process.once('SIGTERM',terminate);
  return {signal:controller.signal,dispose() {
    process.off('SIGINT',interrupt);
    process.off('SIGTERM',terminate);
  }};
}
