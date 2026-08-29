import {FieldValue, Transaction, DocumentSnapshot} from "firebase-admin/firestore";
import {db} from "./firebase";
import {HttpsError} from "firebase-functions/v2/https";
import {assertMember} from "./circles";
import {normalizeRecipients, requireAuth, requireString, requireWish} from "./utils";
import {notifySummonRecipients} from "./notifications";
import {DIFFICULTIES, awardAcceptance} from "./rewards";

export async function createSummon(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  const wish = requireWish(data.wish);
  const recipientUids = normalizeRecipients(data.recipientUids);
  const responseMode = data.responseMode === "everyone_responds" ? "everyone_responds" : "first_accepts";
  const difficulty = typeof data.difficulty === "string" && data.difficulty in DIFFICULTIES ? data.difficulty as keyof typeof DIFFICULTIES : "medium";
  const magicReward = DIFFICULTIES[difficulty];
  const requestId = typeof data.requestId === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(data.requestId) ? data.requestId : null;

  await assertMember(uid, circleId);
  const memberRefs = recipientUids.map(id => db.collection("circles").doc(circleId).collection("members").doc(id));
  const memberSnaps = await Promise.all(memberRefs.map(ref => ref.get()));
  if (memberSnaps.some((s: DocumentSnapshot) => !s.exists || s.get("active") !== true)) {
    throw new HttpsError("invalid-argument", "One or more selected Genies are not active Circle members.");
  }
  if (recipientUids.includes(uid)) throw new HttpsError("invalid-argument", "You cannot summon yourself.");

  const summonRef = requestId
    ? db.collection("circles").doc(circleId).collection("summons").doc(requestId)
    : db.collection("circles").doc(circleId).collection("summons").doc();
  let created = false;
  await db.runTransaction(async (tx: Transaction) => {
    const existing = requestId ? await tx.get(summonRef) : null;
    if (existing?.exists) {
      const existingData = existing.data() || {};
      if (existingData.senderUid !== uid || existingData.requestId !== requestId) {
        throw new HttpsError("already-exists", "That summon request has already been used.");
      }
      return;
    }
    created = true;
    tx.set(summonRef, {
      senderUid: uid, wish, recipientUids, responseMode, difficulty, magicReward, requestId,
      status: "pending", createdAt: FieldValue.serverTimestamp(),
    });
    for (const recipientUid of recipientUids) {
      tx.set(summonRef.collection("responses").doc(recipientUid), {
        uid: recipientUid, status: "pending", updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  if (!created) return {summonId: summonRef.id, notificationResult: {alreadyCreated: true}};
  const notificationResult = await notifySummonRecipients({circleId, summonId: summonRef.id, wish, senderUid: uid, recipientUids});
  return {summonId: summonRef.id, notificationResult};
}

export async function getSummon(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  const summonId = requireString(data.summonId, "summonId", 100);
  await assertMember(uid, circleId);

  const summonRef = db.collection("circles").doc(circleId).collection("summons").doc(summonId);
  const summonSnap = await summonRef.get();
  if (!summonSnap.exists) throw new HttpsError("not-found", "Summon not found.");
  const summon = summonSnap.data() || {};
  const recipientUids = Array.isArray(summon.recipientUids) ? summon.recipientUids : [];
  const senderUid = typeof summon.senderUid === "string" ? summon.senderUid : "";
  if (senderUid !== uid && !recipientUids.includes(uid)) throw new HttpsError("permission-denied", "You are not part of this summon.");

  const senderSnap = await db.collection("circles").doc(circleId).collection("members").doc(senderUid).get();
  const responseSnap = await summonRef.collection("responses").doc(uid).get();
  const responseDocs = await summonRef.collection("responses").get();
  const responseUids = responseDocs.docs.map(doc => doc.id);
  const memberDocs = await Promise.all(responseUids.map(id => db.collection("circles").doc(circleId).collection("members").doc(id).get()));
  const responses = responseDocs.docs.map((doc, index) => ({
    uid: doc.id,
    status: doc.get("status") || "pending",
    displayName: memberDocs[index].exists ? memberDocs[index].get("displayName") || "Genie" : "Genie",
  }));
  return {
    summon: {
      id: summonSnap.id, wish: summon.wish, status: summon.status, responseMode: summon.responseMode,
      senderUid, senderDisplayName: senderSnap.exists ? senderSnap.get("displayName") || "Your Genie" : "Your Genie",
      createdAt: summon.createdAt || null,
    },
    response: responseSnap.exists ? {status: responseSnap.get("status")} : null,
    responses: senderUid === uid ? responses : undefined,
  };
}

export async function respondToSummon(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  const summonId = requireString(data.summonId, "summonId", 100);
  const response = data.response === "accepted" || data.response === "rejected" || data.response === "maybe_later" || data.response === "fulfilled" ? data.response : null;
  if (!response) throw new HttpsError("invalid-argument", "Invalid summon response.");

  const summonRef = db.collection("circles").doc(circleId).collection("summons").doc(summonId);
  const responseRef = summonRef.collection("responses").doc(uid);
  await db.runTransaction(async (tx: Transaction) => {
    const [summonSnap, responseSnap] = await Promise.all([tx.get(summonRef), tx.get(responseRef)]);
    if (!summonSnap.exists || !responseSnap.exists) throw new HttpsError("not-found", "Summon not found.");

    const summonStatus = summonSnap.get("status");
    const responseMode = summonSnap.get("responseMode");
    const existingResponse = responseSnap.get("status");
    const recipientUids = Array.isArray(summonSnap.get("recipientUids")) ? summonSnap.get("recipientUids") as string[] : [];

    if (summonStatus === "fulfilled") throw new HttpsError("failed-precondition", "This wish is already fulfilled.");
    if (existingResponse && existingResponse !== "pending") {
      if (existingResponse === response) {
        if (response === "accepted") await awardAcceptance(tx, circleId, summonId, uid, Number(summonSnap.get("magicReward") || 10), String(responseMode));
        return;
      }
      throw new HttpsError("failed-precondition", "You have already responded to this summons.");
    }

    if (responseMode === "first_accepts" && summonStatus !== "pending") {
      throw new HttpsError("failed-precondition", "Another Genie has already accepted this summons.");
    }

    // All transaction reads happen before any writes.
    const responseSnaps = responseMode === "everyone_responds" && summonStatus === "pending"
      ? await Promise.all(recipientUids.map(recipientUid => tx.get(summonRef.collection("responses").doc(recipientUid))))
      : [];

    if (response === "accepted") {
      await awardAcceptance(tx, circleId, summonId, uid, Number(summonSnap.get("magicReward") || 10), String(responseMode));
    }

    tx.update(responseRef, {status: response, updatedAt: FieldValue.serverTimestamp()});

    if (response === "accepted" && responseMode === "first_accepts" && summonStatus === "pending") {
      tx.update(summonRef, {status: "accepted", acceptedBy: uid, acceptedAt: FieldValue.serverTimestamp()});
      return;
    }
    if (response === "fulfilled") {
      tx.update(summonRef, {status: "fulfilled", fulfilledBy: uid, fulfilledAt: FieldValue.serverTimestamp()});
      return;
    }

    if (responseMode === "everyone_responds" && summonStatus === "pending") {
      const everyoneResponded = responseSnaps.every((snap, index) => {
        if (!snap.exists) return false;
        const status = snap.get("status");
        return recipientUids[index] === uid ? true : status !== "pending";
      });
      if (everyoneResponded) tx.update(summonRef, {status: "completed", completedAt: FieldValue.serverTimestamp()});
    }
  });
  return {ok: true};
}
