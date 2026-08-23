export type ReadBoundedExecutableSkillStreamRequest = {
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

export type BoundedExecutableSkillStreamRead = {
  readonly overflow: boolean;
  readonly text: string;
};

export async function readBoundedExecutableSkillStream(
  request: ReadBoundedExecutableSkillStreamRequest,
): Promise<BoundedExecutableSkillStreamRead> {
  const reader = request.stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > request.maximumBytes) {
        await reader.cancel();
        return { overflow: true, text: '' };
      }
      const decodeOptions = { stream: true } as const;
      text += decoder.decode(chunk.value, decodeOptions);
    }
    text += decoder.decode();
    return { overflow: false, text };
  } finally {
    reader.releaseLock();
  }
}
