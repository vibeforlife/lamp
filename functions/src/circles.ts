import {FieldValue, Transaction} from "firebase-admin/firestore";
import {db} from "./firebase";
import {HttpsError} from "firebase-functions/v2/https";
import {createInviteToken, hashToken, INVITATION_TTL_MS, normalizeTimeZone, requireAuth, requireString} from "./utils";


export async function createCircle(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const displayName = requireString(data.displayName, "displayName", 60);
  const name = requireString(data.name ?? "Our Magic Circle", "name", 80);
  const timeZone = normalizeTimeZone(typeof data.timeZone === "string" ? data.timeZone : "UTC");
  const circleRef = db.collection("circles").doc();
  const memberRef = circleRef.collection("members").doc(uid);
  const userRef = db.collection("users").doc(uid);
  let existingCircleId: string | null = null;

  await db.runTransaction(async (tx: Transaction) => {
    const userSnap = await tx.get(userRef);
    const currentCircleId = userSnap.get("currentCircleId") as string | undefined;
    if (currentCircleId) {
      const existingCircleRef = db.collection("circles").doc(currentCircleId);
      const existingMemberRef = existingCircleRef.collection("members").doc(uid);
      const [existingCircle, existingMember] = await Promise.all([tx.get(existingCircleRef), tx.get(existingMemberRef)]);
      if (existingCircle.exists && existingMember.exists && existingMember.get("active") === true) {
        existingCircleId = currentCircleId;
        return;
      }
    }

    tx.set(circleRef, {
      name,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(memberRef, {
      uid,
      displayName,
      joinedAt: FieldValue.serverTimestamp(),
      active: true,
      timeZone,
    });
    tx.set(userRef, {
      currentCircleId: circleRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });

  return {circleId: existingCircleId || circleRef.id};
}

export async function getMyContext(auth: {uid?: string} | null | undefined, data: Record<string, unknown> = {}) {
  const uid = requireAuth(auth);
  const userSnap = await db.collection("users").doc(uid).get();
  const circleId = userSnap.get("currentCircleId") as string | undefined;
  if (!circleId) return {circle: null, members: []};

  await assertMember(uid, circleId);
  const requestedTimeZone = normalizeTimeZone(typeof data.timeZone === "string" ? data.timeZone : "UTC");
  if (typeof data.timeZone === "string" && data.timeZone.trim()) {
    await db.collection("circles").doc(circleId).collection("members").doc(uid).set({timeZone: requestedTimeZone}, {merge: true});
  }
  const [circleSnap, membersSnap] = await Promise.all([
    db.collection("circles").doc(circleId).get(),
    db.collection("circles").doc(circleId).collection("members").where("active", "==", true).get(),
  ]);
  if (!circleSnap.exists) return {circle: null, members: []};
  return {
    circle: {id: circleSnap.id, ...circleSnap.data()},
    members: membersSnap.docs.map(d => ({id: d.id, ...d.data()})),
  };
}

async function assertMember(uid: string, circleId: string) {
  const member = await db.collection("circles").doc(circleId).collection("members").doc(uid).get();
  if (!member.exists || member.get("active") !== true) {
    throw new HttpsError("permission-denied", "You are not a member of this Magic Circle.");
  }
  return member;
}

export async function createInvitation(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  await assertMember(uid, circleId);
  const token = createInviteToken();
  const tokenHash = hashToken(token);
  const invitationRef = db.collection("invitations").doc();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await invitationRef.set({
    circleId,
    tokenHash,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    usedAt: null,
  });

  return {invitationId: invitationRef.id, token, expiresAt: expiresAt.toISOString()};
}

export async function acceptInvitation(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const token = requireString(data.token, "token", 200);
  const displayName = requireString(data.displayName, "displayName", 60);
  const timeZone = normalizeTimeZone(typeof data.timeZone === "string" ? data.timeZone : "UTC");
  const tokenHash = hashToken(token);
  const matches = await db.collection("invitations").where("tokenHash", "==", tokenHash).limit(1).get();
  if (matches.empty) throw new HttpsError("not-found", "That invitation is invalid or has expired.");

  const invitationRef = matches.docs[0].ref;
  const userRef = db.collection("users").doc(uid);

  let circleId = "";
  await db.runTransaction(async (tx: Transaction) => {
    const invitationSnap = await tx.get(invitationRef);
    if (!invitationSnap.exists) throw new HttpsError("not-found", "That invitation is invalid or has expired.");
    const invitation = invitationSnap.data() || {};
    const expiresAt = invitation.expiresAt?.toDate?.() as Date | undefined;
    circleId = invitation.circleId as string;
    const memberRef = db.collection("circles").doc(circleId).collection("members").doc(uid);
    const [existing, userSnap] = await Promise.all([tx.get(memberRef), tx.get(userRef)]);
    if (invitation.usedAt) {
      if (userSnap.get("currentCircleId") === circleId && existing.exists && existing.get("active") === true) return;
      throw new HttpsError("failed-precondition", "That invitation is no longer active.");
    }
    if (!expiresAt || expiresAt.getTime() < Date.now()) {
      throw new HttpsError("failed-precondition", "That invitation is no longer active.");
    }
    if (!existing.exists) {
      tx.set(memberRef, {
        uid,
        displayName,
        joinedAt: FieldValue.serverTimestamp(),
        active: true,
        timeZone,
      });
    }
    tx.update(invitationRef, {usedAt: FieldValue.serverTimestamp()});
    tx.set(userRef, {currentCircleId: circleId, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
  });

  return {circleId};
}

export async function addMemberForTest(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  // Development-only helper intentionally not exported by the public index.
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  requireString(data.displayName, "displayName", 60);
  await assertMember(uid, circleId);
  throw new HttpsError("failed-precondition", "Use an invitation to add a member.");
}

export {assertMember};
