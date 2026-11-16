// Computes a file's SHA-256 in the browser with the Web Crypto API, so the investigator sees the hash
// before uploading. The server hashes the upload again and rejects it if the two values differ.

export const BROWSER_HASH_LIMIT = 512 * 1024 * 1024;

export const canHashInBrowser = () => Boolean(globalThis.crypto?.subtle) && window.isSecureContext;

export async function sha256OfFile(file) {
  if (!canHashInBrowser()) throw new Error('Browser hashing needs HTTPS or localhost. The server will compute the hash.');
  if (file.size > BROWSER_HASH_LIMIT) throw new Error('File is too large to hash in the browser. The server will compute the hash.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
