function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonRecord(
  text: string,
  context: string,
): Promise<Record<string, unknown>> {
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (isRecord(parsed)) {
      return parsed;
    }
    console.warn(`${context}: expected JSON object response`);
    return {};
  } catch (err) {
    console.warn(
      `${context}: failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

export async function readResponseJsonObject(
  response: Response,
  context = 'HTTP response',
): Promise<Record<string, unknown>> {
  return parseJsonRecord(await response.text(), context);
}

export async function readRequestJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
