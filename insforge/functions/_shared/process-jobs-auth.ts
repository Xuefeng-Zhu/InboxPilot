const PROCESS_JOBS_SECRET_HEADER = 'x-process-jobs-secret';

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function isAuthorizedProcessJobsRequest(
  req: Request,
  configuredSecret: string,
): boolean {
  const headerSecret = req.headers.get(PROCESS_JOBS_SECRET_HEADER);
  if (headerSecret && constantTimeEqual(headerSecret, configuredSecret)) {
    return true;
  }

  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;

  return constantTimeEqual(authorization.slice('Bearer '.length), configuredSecret);
}
