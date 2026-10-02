const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a read (retrieve, result, list). Never used for creates, which could bill twice. */
export async function again<T>(read: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (error) {
      if (i >= tries) throw error;
      await sleep(2_000 * 2 ** i);
    }
  }
}
