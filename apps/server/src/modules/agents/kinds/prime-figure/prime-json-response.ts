export function parseFirstJsonObject(source: string): Record<string, unknown> {
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    const end = findJsonObjectEnd(source, start);
    if (end === null) continue;

    try {
      const value = JSON.parse(source.slice(start, end)) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      // The model may have emitted an earlier brace that is not the JSON root.
    }
  }

  // Preserve JSON.parse's useful native error when no complete object exists.
  return JSON.parse(source) as Record<string, unknown>;
}

function findJsonObjectEnd(source: string, start: number) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index] as string;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;

    const opening = stack.pop();
    if (
      (character === "}" && opening !== "{") ||
      (character === "]" && opening !== "[")
    )
      return null;
    if (!stack.length) return index + 1;
  }

  return null;
}
