export function parseFirstJsonObject(source: string): Record<string, unknown> {
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    const end = findJsonObjectEnd(source, start);
    if (end !== null) {
      const value = tryParseObject(source.slice(start, end));
      if (value) return value;
    }

    const repaired = repairMissingActionObjectClosures(source, start);
    if (repaired) return repaired;
  }

  // Preserve JSON.parse's useful native error when no complete object exists.
  return JSON.parse(source) as Record<string, unknown>;
}

function tryParseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Some models close `message` but omit the surrounding action's `}` before
 * the next array item (or the actions array terminator). Repair only those
 * two structurally unambiguous positions inside the top-level `actions` array.
 */
function repairMissingActionObjectClosures(source: string, start: number) {
  const stack: Array<{ opening: "{" | "["; actions?: boolean }> = [];
  let output = "";
  let inString = false;
  let escaped = false;
  let repairs = 0;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index] as string;
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === "{") {
      stack.push({ opening: "{" });
      output += character;
      continue;
    }
    if (character === "[") {
      const prefix = source.slice(Math.max(start, index - 40), index);
      stack.push({
        opening: "[",
        actions: stack.length === 1 && /"actions"\s*:\s*$/.test(prefix),
      });
      output += character;
      continue;
    }

    const top = stack.at(-1);
    const parent = stack.at(-2);
    if (
      character === "," &&
      top?.opening === "{" &&
      parent?.opening === "[" &&
      parent.actions &&
      /^\s*\{/.test(source.slice(index + 1))
    ) {
      output += "}";
      stack.pop();
      repairs += 1;
    } else if (
      character === "]" &&
      top?.opening === "{" &&
      parent?.opening === "[" &&
      parent.actions
    ) {
      output += "}";
      stack.pop();
      repairs += 1;
    }

    if (character === "}" || character === "]") {
      const opening = stack.pop()?.opening;
      if (
        (character === "}" && opening !== "{") ||
        (character === "]" && opening !== "[")
      )
        return null;
      output += character;
      if (!stack.length) return repairs ? tryParseObject(output) : null;
      continue;
    }
    output += character;
  }
  return null;
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
