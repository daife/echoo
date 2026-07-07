import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export class PasswordService {
  async hash(password: string) {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  async verify(password: string, storedHash: string) {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;

    const expected = Buffer.from(key, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
