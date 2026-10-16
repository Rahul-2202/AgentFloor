import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One token per participant: `<id>.<hmac>`. An agent only gets its own token,
 * so it can't speak as anyone else. The CEO's token is "ceo.<hmac>".
 */
export class Auth {
  private readonly secret: Buffer;

  constructor(secret: Buffer) {
    this.secret = secret;
  }

  /** Reads the office secret from disk, creating it on first run. */
  static fromFile(path: string): Auth {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    return new Auth(Buffer.from(readFileSync(path, "utf8").trim(), "hex"));
  }

  tokenFor(id: string): string {
    return `${id}.${this.sign(id)}`;
  }

  /** The participant id a token belongs to, or null. */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const id = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const want = Buffer.from(this.sign(id));
    return given.length === want.length && timingSafeEqual(given, want) ? id : null;
  }

  private sign(id: string): string {
    return createHmac("sha256", this.secret).update(id).digest("hex").slice(0, 40);
  }
}
