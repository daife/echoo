import { randomBytes } from "node:crypto";

const challengeTtlMs = 5 * 60_000;
const maxChallenges = 10_000;

interface CaptchaChallenge {
  answer: string;
  expiresAt: number;
}

export class CaptchaService {
  private readonly challenges = new Map<string, CaptchaChallenge>();

  create() {
    this.removeExpired();
    const left = 1 + Math.floor(Math.random() * 9);
    const right = 1 + Math.floor(Math.random() * 9);
    const id = randomBytes(18).toString("base64url");
    this.challenges.set(id, {
      answer: String(left + right),
      expiresAt: Date.now() + challengeTtlMs,
    });
    while (this.challenges.size > maxChallenges) {
      const oldest = this.challenges.keys().next().value;
      if (!oldest) break;
      this.challenges.delete(oldest);
    }
    return { id, question: `${left} + ${right} = ?` };
  }

  consume(id: string, answer: string) {
    const challenge = this.challenges.get(id);
    this.challenges.delete(id);
    return Boolean(
      challenge &&
      challenge.expiresAt > Date.now() &&
      answer.trim() === challenge.answer,
    );
  }

  private removeExpired() {
    const now = Date.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }
}
