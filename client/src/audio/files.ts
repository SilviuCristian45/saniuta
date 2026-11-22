// Optional replacement audio files (client/public/audio/).

/** The first of `urls` that loads and decodes, or null (missing files are normal: they are optional). */
export async function fetchFirst(context: AudioContext, urls: string[]): Promise<AudioBuffer | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      // Dev servers answer unknown paths with index.html.
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
      return await context.decodeAudioData(await res.arrayBuffer());
    } catch {
      // unsupported format or broken file: try the next one
    }
  }
  return null;
}
