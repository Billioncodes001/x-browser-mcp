export class XBrowserError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'XBrowserError'; }
}
export function errorInfo(error: unknown) {
  if (error instanceof XBrowserError) return { code: error.code, message: error.message };
  // Browser error strings can include request URLs and local authentication paths.
  if (error instanceof Error && /Timeout|TargetClosed|BrowserType/.test(error.name + error.message)) {
    return { code: 'BROWSER_OPERATION_FAILED', message: 'The browser operation failed or timed out. Check the browser window and session status; an uncertain write must not be retried automatically.' };
  }
  return { code: 'OPERATION_FAILED', message: error instanceof Error ? error.message.slice(0,600) : 'Unknown operation failure' };
}
