const signatures: Array<{ mime: string; matches: (bytes: Buffer) => boolean }> =
  [
    {
      mime: 'image/png',
      matches: (bytes) =>
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    },
    {
      mime: 'image/jpeg',
      matches: (bytes) =>
        bytes.length >= 3 &&
        bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    },
    {
      mime: 'image/gif',
      matches: (bytes) =>
        bytes.length >= 6 &&
        ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
    },
    {
      mime: 'image/webp',
      matches: (bytes) =>
        bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP',
    },
  ]

export function loginImageMime(bytes: Buffer): string | null {
  return signatures.find(({ matches }) => matches(bytes))?.mime ?? null
}
