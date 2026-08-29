const privateIpv4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

export function safeRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return null;
    if (privateIpv4.some(pattern => pattern.test(host))) return null;
    return url;
  } catch {
    return null;
  }
}

export function limitedStream(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  let seen = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) throw new Error('FILE_TOO_LARGE');
      controller.enqueue(chunk);
    },
  }));
}

export function transientHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
