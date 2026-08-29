import {createHash, randomBytes} from "node:crypto";
import {HttpsError} from "firebase-functions/v2/https";

export const MAX_WISH_LENGTH = 180;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function requireAuth(auth: {uid?: string} | null | undefined): string {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  return auth.uid;
}

export function requireString(value: unknown, field: string, maxLength = 100): string {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${field} is required.`);
  const result = value.trim();
  if (!result) throw new HttpsError("invalid-argument", `${field} is required.`);
  if (result.length > maxLength) throw new HttpsError("invalid-argument", `${field} is too long.`);
  return result;
}

export function requireWish(value: unknown): string {
  return requireString(value, "wish", MAX_WISH_LENGTH);
}

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}


export function normalizeTimeZone(value: string): string {
  const candidate = value.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: candidate}).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

export function normalizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpsError("invalid-argument", "recipientUids must be an array.");
  const unique = [...new Set(value.filter((v): v is string => typeof v === "string" && v.trim().length > 0))];
  if (unique.length < 1 || unique.length > 50) {
    throw new HttpsError("invalid-argument", "Choose between 1 and 50 Genies.");
  }
  return unique;
}
