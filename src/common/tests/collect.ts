/** Drains an async iterable of CSV chunks into one string. */
export async function collect(lines: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of lines) {
    text += chunk;
  }
  return text;
}
