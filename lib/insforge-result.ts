interface InsforgeResultError {
  message: string;
}

export interface InsforgeResult {
  error: InsforgeResultError | null;
}

/** Convert InsForge's result-tuple errors into normal control-flow errors. */
export function assertInsforgeSuccess(
  result: InsforgeResult,
  context: string,
): void {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
}
