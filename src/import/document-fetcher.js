import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const defaultMaxBytes = 50 * 1024 * 1024;

/**
 * @param {{url: string, storageRoot: string, allowedHosts: string[], fetchImpl?: typeof fetch, maxBytes?: number}} options
 * @returns {Promise<{originalUrl: string, localPath: string, sha256: string, mimeType: string|null, size: number, fetchedAt: string}>}
 */
export async function downloadDocument({
  url,
  storageRoot,
  allowedHosts,
  fetchImpl = fetch,
  maxBytes = defaultMaxBytes,
}) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !allowedHosts.includes(parsedUrl.hostname)) {
    throw new Error(`URL is not from an allowed source host: ${url}`);
  }
  if (!parsedUrl.pathname.toLocaleLowerCase('de').endsWith('.pdf')) {
    throw new Error(`URL is not a PDF: ${url}`);
  }

  const response = await fetchImpl(parsedUrl, { redirect: 'manual' });
  if (!response.ok) {
    throw new Error(`Document request failed with HTTP ${response.status}: ${url}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Document exceeds size limit of ${maxBytes} bytes: ${url}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim() || null;
  if (mimeType && !['application/pdf', 'application/octet-stream'].includes(mimeType)) {
    throw new Error(`Document has unexpected MIME type ${mimeType}: ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error(`Document exceeds size limit of ${maxBytes} bytes: ${url}`);
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const documentsDirectory = path.resolve(storageRoot, 'documents');
  const localPath = path.join(documentsDirectory, `${sha256}.pdf`);
  const temporaryPath = path.join(documentsDirectory, `.${sha256}.${process.pid}.tmp`);

  await fs.mkdir(documentsDirectory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    try {
      await fs.link(temporaryPath, localPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  return {
    originalUrl: parsedUrl.toString(),
    localPath,
    sha256,
    mimeType,
    size: bytes.length,
    fetchedAt: new Date().toISOString(),
  };
}
