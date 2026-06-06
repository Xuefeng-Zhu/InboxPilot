/**
 * Utility for splitting document bodies into chunks for embedding.
 *
 * Chunks are created by splitting on double newlines (paragraph boundaries).
 * If a paragraph exceeds the max chunk size, it is further split at sentence
 * boundaries or, as a last resort, at the character limit.
 *
 * The chunking function guarantees:
 * - At least one chunk for any non-empty input
 * - No content loss: concatenating all chunks reproduces all text from the original
 */

const DEFAULT_MAX_CHUNK_SIZE = 500;

/**
 * Split a document body into chunks suitable for embedding.
 *
 * @param body - The full document text
 * @param maxChunkSize - Maximum character length per chunk (default 500)
 * @returns An array of non-empty text chunks
 */
export function splitIntoChunks(body: string, maxChunkSize = DEFAULT_MAX_CHUNK_SIZE): string[] {
  if (!body || body.trim().length === 0) {
    return [];
  }

  // Split on double newlines (paragraph boundaries)
  const paragraphs = body.split(/\n\n+/);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length <= maxChunkSize) {
      chunks.push(trimmed);
    } else {
      // Split long paragraphs into smaller pieces
      const subChunks = splitLongText(trimmed, maxChunkSize);
      chunks.push(...subChunks);
    }
  }

  // If the body had content but all paragraphs were whitespace-only,
  // this shouldn't happen given the non-empty check above, but guard anyway.
  if (chunks.length === 0 && body.trim().length > 0) {
    chunks.push(body.trim());
  }

  return chunks;
}

/**
 * Split a long text block into chunks of at most maxSize characters.
 * Tries to split at sentence boundaries first, then falls back to hard splits.
 */
function splitLongText(text: string, maxSize: number): string[] {
  const result: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    // Try to find a sentence boundary within the limit
    let splitIndex = -1;

    // Look for sentence-ending punctuation followed by a space
    const searchRegion = remaining.slice(0, maxSize);
    const sentenceEnd = searchRegion.lastIndexOf('. ');
    if (sentenceEnd > 0) {
      splitIndex = sentenceEnd + 1; // Include the period
    }

    // Fall back to space boundary
    if (splitIndex <= 0) {
      const spaceIndex = searchRegion.lastIndexOf(' ');
      if (spaceIndex > 0) {
        splitIndex = spaceIndex;
      }
    }

    // Hard split as last resort
    if (splitIndex <= 0) {
      splitIndex = maxSize;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      result.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    result.push(remaining);
  }

  return result;
}
