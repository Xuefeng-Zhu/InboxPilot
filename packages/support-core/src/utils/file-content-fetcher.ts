/**
 * FileContentFetcher implementation — fetches and extracts text from uploaded files.
 *
 * Supported formats:
 * - .txt, .md, .csv — read as plain text
 * - .pdf — basic text extraction (strips binary, extracts text streams)
 * - .docx — extracts text from XML content within the zip archive
 *
 * For production use, PDF and DOCX extraction is simplified.
 * A more robust solution would use dedicated libraries (pdf-parse, mammoth).
 */

import type { FileContentFetcher } from '../services/knowledge-ingestion-service.js';

/**
 * Portable download boundary used by the content extractor.
 *
 * A deployment may use `fileKey` to resolve a fixed, authenticated object
 * storage URL. Keeping this callback injected prevents support-core from
 * depending on a storage vendor and prevents service credentials from being
 * attached to an arbitrary persisted `file_url`.
 */
export type FileResponseFetcher = (
  url: string,
  fileKey?: string | null,
) => Promise<Response>;

/**
 * Get file extension from filename, normalized to lowercase.
 */
function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Extract readable text from a PDF buffer.
 * This is a simplified extraction that handles most common text-based PDFs.
 * It decodes text streams between BT/ET markers.
 */
function extractTextFromPdf(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  // Extract text between parentheses in text streams (Tj and TJ operators)
  const textParts: string[] = [];

  // Match text showing operators: (text)Tj or [(text)]TJ
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(text)) !== null) {
    textParts.push(match[1]);
  }

  // Match TJ array operator: [(text)(text)]TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(text)) !== null) {
    const inner = match[1];
    const innerParts = inner.match(/\(([^)]*)\)/g);
    if (innerParts) {
      for (const part of innerParts) {
        textParts.push(part.slice(1, -1));
      }
    }
  }

  if (textParts.length > 0) {
    return textParts.join(' ').replace(/\\n/g, '\n').replace(/\\r/g, '').trim();
  }

  // Fallback: try to extract any readable text sequences
  const readableRegex = /[\x20-\x7E]{20,}/g;
  const readable: string[] = [];
  while ((match = readableRegex.exec(text)) !== null) {
    const segment = match[0].trim();
    // Skip likely binary/metadata sequences
    if (!segment.startsWith('%PDF') && !segment.includes('endobj') && !segment.includes('endstream')) {
      readable.push(segment);
    }
  }

  return readable.join('\n').trim();
}

/**
 * Extract text from a DOCX buffer.
 * DOCX files are ZIP archives containing XML. We extract text from word/document.xml.
 */
async function extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
  // DOCX is a ZIP file. We look for the word/document.xml entry.
  // Simple ZIP parsing: find the local file headers
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const fullText = decoder.decode(bytes);

  // Look for XML content that contains <w:t> tags (Word text elements)
  // This is a pragmatic approach — find the document.xml content within the ZIP
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const textParts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = wtRegex.exec(fullText)) !== null) {
    textParts.push(match[1]);
  }

  // Join with spaces, collapse multiple spaces, add paragraph breaks at <w:p>
  if (textParts.length > 0) {
    // Re-process to detect paragraph boundaries
    const paragraphText = fullText
      .split(/<w:p[ >]/)
      .map((para) => {
        const parts: string[] = [];
        const paraWtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m: RegExpExecArray | null;
        while ((m = paraWtRegex.exec(para)) !== null) {
          parts.push(m[1]);
        }
        return parts.join('');
      })
      .filter((p) => p.trim().length > 0);

    return paragraphText.join('\n\n').trim();
  }

  return '';
}

/**
 * Creates a FileContentFetcher that uses fetch() to download files
 * and extracts text based on file extension.
 */
export function createFileContentFetcher(
  fetchFile: FileResponseFetcher = (url) => fetch(url),
): FileContentFetcher {
  return {
    async fetchTextContent(
      url: string,
      fileName: string,
      fileKey?: string | null,
    ): Promise<string> {
      const response = await fetchFile(url, fileKey);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: HTTP ${response.status}`);
      }

      const ext = getExtension(fileName);

      switch (ext) {
        case 'txt':
        case 'md':
        case 'csv': {
          return await response.text();
        }

        case 'pdf': {
          const buffer = await response.arrayBuffer();
          const text = extractTextFromPdf(buffer);
          if (!text) {
            throw new Error('Could not extract text from PDF. The file may be image-based or encrypted.');
          }
          return text;
        }

        case 'docx': {
          const buffer = await response.arrayBuffer();
          const text = await extractTextFromDocx(buffer);
          if (!text) {
            throw new Error('Could not extract text from DOCX file.');
          }
          return text;
        }

        default:
          throw new Error(`Unsupported file type: .${ext}`);
      }
    },
  };
}
