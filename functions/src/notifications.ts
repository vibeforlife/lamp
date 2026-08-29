import {FieldValue} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {db, messaging} from "./firebase";


export async function notifySummonRecipients(args: {circleId: string; summonId: string; wish: string; senderUid: string; recipientUids: string[]}) {
  const users = await Promise.all(args.recipientUids.map(uid => db.collection("users").doc(uid).get()));
  const tokenEntries: Array<{uid: string; key: string; token: string}> = [];
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const tokenMap = user.get("pushTokens") as Record<string, unknown> | undefined;
    if (tokenMap && typeof tokenMap === "object") {
      for (const [key, value] of Object.entries(tokenMap)) {
        if (typeof value === "string") tokenEntries.push({uid: args.recipientUids[i], key, token: value});
      }
    }
  }

  const tokens = [...new Map(tokenEntries.map(entry => [entry.token, entry])).values()];
  if (!tokens.length) return {push: {sent: 0, failed: 0, skipped: args.recipientUids.length}, email: {status: "not_configured"}};

  let response;
  try {
    // Use data-only Web Push. The service worker owns notification rendering,
    // which prevents duplicate browser notifications from FCM's automatic display.
    response = await messaging.sendEachForMulticast({
      tokens: tokens.map(entry => entry.token),
      data: {
        type: "summon",
        circleId: args.circleId,
        summonId: args.summonId,
        wish: args.wish,
      },
      webpush: {
        headers: {Urgency: "high"},
      },
    });
  } catch (error) {
    console.error("Magic Lamp push notification failed", error);
    return {push: {sent: 0, failed: tokens.length, error: "delivery_failed"}, email: {status: "not_configured"}};
  }

  const staleTokens = response.responses
    .map((result, index) => ({result, entry: tokens[index]}))
    .filter(({result}) => result.error?.code === "messaging/registration-token-not-registered" || result.error?.code === "messaging/invalid-registration-token");
  await Promise.all(staleTokens.map(({entry}) => db.collection("users").doc(entry.uid).update({
    [`pushTokens.${entry.key}`]: FieldValue.delete(),
  }).catch(error => console.warn("Magic Lamp could not remove stale push token", error))));

  return {
    push: {sent: response.successCount, failed: response.failureCount, cleaned: staleTokens.length},
    email: {status: "not_configured"},
  };
}

export async function registerPushToken(auth: {uid?: string} | null | undefined, token: unknown) {
  if (!auth?.uid || typeof token !== "string" || token.length < 20) throw new HttpsError("invalid-argument", "Invalid push token");
  const crypto = await import("node:crypto");
  const key = crypto.createHash("sha256").update(token).digest("hex");
  await db.collection("users").doc(auth.uid).update({
    [`pushTokens.${key}`]: token,
    pushTokensUpdatedAt: new Date(),
  });
  return {ok: true};
}
