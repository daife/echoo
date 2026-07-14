export type PrimeStreamedMessageField =
  | "type"
  | "text"
  | "description"
  | "generationPrompt"
  | "transcript"
  | "referenceMediaId"
  | "referenceMediaIds";

export interface PrimeDecisionStreamFieldDelta {
  actionIndex: number;
  field: PrimeStreamedMessageField;
  delta: string;
  complete: boolean;
}

type PathPart = string | number;

type ObjectFrame = {
  type: "object";
  path: PathPart[];
  phase: "key_or_end" | "colon" | "value" | "comma_or_end";
  key?: string;
};

type ArrayFrame = {
  type: "array";
  path: PathPart[];
  phase: "value_or_end" | "comma_or_end";
  index: number;
};

type Frame = ObjectFrame | ArrayFrame;

/**
 * A small incremental JSON tokenizer for Prime Figure's structured response.
 * It deliberately emits only actions[*].message string fields; the complete
 * response is still parsed and validated with JSON.parse + Zod afterwards.
 */
export class PrimeDecisionStreamParser {
  private readonly stack: Frame[] = [];
  private rootStarted = false;
  private inString = false;
  private stringRole: "key" | "value" = "value";
  private stringValue = "";
  private stringPath: PathPart[] = [];
  private escape = false;
  private unicodeDigits = "";
  private unicodeRemaining = 0;
  private inPrimitive = false;

  constructor(
    private readonly onFieldDelta: (
      event: PrimeDecisionStreamFieldDelta,
    ) => void,
  ) {}

  push(chunk: string) {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index] as string;

      if (this.inString) {
        this.consumeStringCharacter(char);
        continue;
      }

      if (this.inPrimitive) {
        if (/[,}\]\s]/.test(char)) {
          this.inPrimitive = false;
          this.completeValue();
          index -= 1;
        }
        continue;
      }

      if (/\s/.test(char)) continue;
      const frame = this.stack.at(-1);

      if (!frame) {
        if (this.rootStarted) continue;
        this.rootStarted = true;
        this.startValue(char, []);
        continue;
      }

      if (frame.type === "object") {
        if (frame.phase === "key_or_end") {
          if (char === "}") {
            this.stack.pop();
            this.completeValue();
          } else if (char === '"') {
            this.startString("key", []);
          }
          continue;
        }
        if (frame.phase === "colon") {
          if (char === ":") frame.phase = "value";
          continue;
        }
        if (frame.phase === "value") {
          this.startValue(char, [...frame.path, frame.key ?? ""]);
          continue;
        }
        if (char === ",") {
          frame.phase = "key_or_end";
          delete frame.key;
        } else if (char === "}") {
          this.stack.pop();
          this.completeValue();
        }
        continue;
      }

      if (frame.phase === "value_or_end") {
        if (char === "]") {
          const completed = this.stack.pop();
          if (completed?.type === "array")
            this.emitArrayComplete(completed.path);
          this.completeValue();
        } else {
          this.startValue(char, [...frame.path, frame.index]);
        }
        continue;
      }
      if (char === ",") {
        frame.index += 1;
        frame.phase = "value_or_end";
      } else if (char === "]") {
        const completed = this.stack.pop();
        if (completed?.type === "array") this.emitArrayComplete(completed.path);
        this.completeValue();
      }
    }
  }

  private startValue(char: string, path: PathPart[]) {
    if (char === "{") {
      this.stack.push({ type: "object", path, phase: "key_or_end" });
      return;
    }
    if (char === "[") {
      this.stack.push({ type: "array", path, phase: "value_or_end", index: 0 });
      return;
    }
    if (char === '"') {
      this.startString("value", path);
      return;
    }
    this.inPrimitive = true;
  }

  private startString(role: "key" | "value", path: PathPart[]) {
    this.inString = true;
    this.stringRole = role;
    this.stringValue = "";
    this.stringPath = path;
    this.escape = false;
    this.unicodeDigits = "";
    this.unicodeRemaining = 0;
  }

  private consumeStringCharacter(char: string) {
    if (this.unicodeRemaining > 0) {
      this.unicodeDigits += char;
      this.unicodeRemaining -= 1;
      if (this.unicodeRemaining === 0) {
        const decoded = String.fromCharCode(
          Number.parseInt(this.unicodeDigits, 16),
        );
        this.unicodeDigits = "";
        this.appendString(decoded);
      }
      return;
    }

    if (this.escape) {
      this.escape = false;
      if (char === "u") {
        this.unicodeDigits = "";
        this.unicodeRemaining = 4;
        return;
      }
      this.appendString(
        (
          {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
          } as Record<string, string>
        )[char] ?? char,
      );
      return;
    }

    if (char === "\\") {
      this.escape = true;
      return;
    }
    if (char === '"') {
      this.inString = false;
      if (this.stringRole === "key") {
        const frame = this.stack.at(-1);
        if (frame?.type === "object") {
          frame.key = this.stringValue;
          frame.phase = "colon";
        }
      } else {
        this.emitField("", true);
        this.completeValue();
      }
      return;
    }
    this.appendString(char);
  }

  private appendString(value: string) {
    this.stringValue += value;
    if (this.stringRole === "value") this.emitField(value, false);
  }

  private emitField(delta: string, complete: boolean) {
    const [actions, actionIndex, message, field, itemIndex] = this.stringPath;
    if (
      actions === "actions" &&
      typeof actionIndex === "number" &&
      message === "message" &&
      field === "referenceMediaIds" &&
      typeof itemIndex === "number"
    ) {
      this.onFieldDelta({
        actionIndex,
        field: "referenceMediaId",
        delta,
        complete,
      });
      return;
    }
    if (
      actions !== "actions" ||
      typeof actionIndex !== "number" ||
      message !== "message" ||
      !isStreamedField(field)
    )
      return;
    this.onFieldDelta({ actionIndex, field, delta, complete });
  }

  private emitArrayComplete(path: PathPart[]) {
    const [actions, actionIndex, message, field] = path;
    if (
      actions === "actions" &&
      typeof actionIndex === "number" &&
      message === "message" &&
      field === "referenceMediaIds"
    )
      this.onFieldDelta({
        actionIndex,
        field: "referenceMediaIds",
        delta: "",
        complete: true,
      });
  }

  private completeValue() {
    const parent = this.stack.at(-1);
    if (!parent) return;
    if (parent.type === "object" && parent.phase === "value") {
      parent.phase = "comma_or_end";
    } else if (parent.type === "array" && parent.phase === "value_or_end") {
      parent.phase = "comma_or_end";
    }
  }
}

function isStreamedField(
  value: PathPart | undefined,
): value is PrimeStreamedMessageField {
  return (
    value === "type" ||
    value === "text" ||
    value === "description" ||
    value === "generationPrompt" ||
    value === "transcript"
  );
}
