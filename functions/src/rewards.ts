import {FieldValue, Timestamp, Transaction} from "firebase-admin/firestore";
import {db} from "./firebase";
import {HttpsError} from "firebase-functions/v2/https";
import {assertMember} from "./circles";
import {normalizeTimeZone, requireAuth, requireString} from "./utils";

export const LEVELS = [
  {name: "Lamp Apprentice", min: 0},
  {name: "Helpful Genie", min: 100},
  {name: "Trusted Genie", min: 250},
  {name: "Royal Genie", min: 500},
  {name: "Master of the Lamp", min: 1000},
  {name: "Legendary Genie", min: 2000},
  {name: "Grand Master Genie", min: 5000},
];

export const DIFFICULTIES = {
  easy: 5,
  medium: 10,
  hard: 25,
  epic: 50,
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;

function levelFor(points: number) {
  let current = LEVELS[0];
  for (const level of LEVELS) if (points >= level.min) current = level;
  const index = LEVELS.findIndex(l => l.name === current.name);
  const next = LEVELS[index + 1] || null;
  return {current, next, index};
}

export function dayKey(value: Date, timeZone = "UTC") {
  const zone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function calendarDayDifference(later: Date, earlier: Date, timeZone = "UTC") {
  const laterKey = dayKey(later, timeZone);
  const earlierKey = dayKey(earlier, timeZone);
  const [ly, lm, ld] = laterKey.split("-").map(Number);
  const [ey, em, ed] = earlierKey.split("-").map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

function achievementList(stats: {points: number; acceptedCount: number; streak: number; responseModes: number}) {
  const list: string[] = [];
  if (stats.acceptedCount >= 1) list.push("first_call");
  if (stats.acceptedCount >= 10) list.push("ten_calls");
  if (stats.points >= 100) list.push("hundred_magic");
  if (stats.points >= 500) list.push("five_hundred_magic");
  if (stats.streak >= 3) list.push("three_day_streak");
  if (stats.streak >= 7) list.push("seven_day_streak");
  if (stats.responseModes >= 1) list.push("everyone_answered");
  return list;
}

export async function awardAcceptance(tx: Transaction, circleId: string, summonId: string, uid: string, magic: number, responseMode: string) {
  const memberRef = db.collection("circles").doc(circleId).collection("members").doc(uid);
  const ledgerRef = db.collection("circles").doc(circleId).collection("rewardLedger").doc(`${summonId}_${uid}`);
  const [memberSnap, ledgerSnap] = await Promise.all([tx.get(memberRef), tx.get(ledgerRef)]);
  if (!memberSnap.exists || memberSnap.get("active") !== true) throw new HttpsError("permission-denied", "That Genie is not an active Circle member.");
  if (ledgerSnap.exists) return false;

  const oldPoints = Number(memberSnap.get("magic") || 0);
  const oldAccepted = Number(memberSnap.get("acceptedCount") || 0);
  const oldStreak = Number(memberSnap.get("streak") || 0);
  const lastAccepted = memberSnap.get("lastAcceptedAt") as Timestamp | undefined;
  const now = new Date();
  const timeZone = normalizeTimeZone(String(memberSnap.get("timeZone") || "UTC"));
  const today = dayKey(now, timeZone);
  const previous = lastAccepted?.toDate ? lastAccepted.toDate() : null;
  let streak = 1;
  if (previous) {
    const previousKey = dayKey(previous, timeZone);
    if (previousKey === today) streak = Math.max(1, oldStreak);
    else {
      const diff = calendarDayDifference(now, previous, timeZone);
      streak = diff === 1 ? oldStreak + 1 : 1;
    }
  }
  const points = oldPoints + magic;
  const acceptedCount = oldAccepted + 1;
  const newlyEarned = achievementList({points, acceptedCount, streak, responseModes: responseMode === "everyone_responds" ? 1 : 0});
  const priorAchievements = Array.isArray(memberSnap.get("achievements")) ? memberSnap.get("achievements") as string[] : [];
  const achievements = [...new Set([...priorAchievements, ...newlyEarned])];
  tx.set(ledgerRef, {summonId, uid, magic, createdAt: FieldValue.serverTimestamp(), responseMode});
  tx.set(memberRef, {
    magic: points,
    acceptedCount,
    streak,
    bestStreak: Math.max(Number(memberSnap.get("bestStreak") || 0), streak),
    lastAcceptedAt: FieldValue.serverTimestamp(),
    achievements,
  }, {merge: true});
  return true;
}

export async function getSummonHistory(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  await assertMember(uid, circleId);
  const limit = Math.min(Math.max(Number(data.limit || 50), 1), 100);
  const [summonsSnap, membersSnap] = await Promise.all([
    db.collection("circles").doc(circleId).collection("summons").orderBy("createdAt", "desc").limit(limit).get(),
    db.collection("circles").doc(circleId).collection("members").where("active", "==", true).get(),
  ]);
  const names = new Map(membersSnap.docs.map(d => [d.id, String(d.get("displayName") || "Genie")]));
  const items = await Promise.all(summonsSnap.docs.map(async doc => {
    const d = doc.data();
    const recipientUids = Array.isArray(d.recipientUids) ? d.recipientUids as string[] : [];
    const responsesSnap = await doc.ref.collection("responses").get();
    const responses = responsesSnap.docs.map(r => ({uid: r.id, displayName: names.get(r.id) || "Genie", status: r.get("status") || "pending"}));
    return {
      id: doc.id,
      wish: String(d.wish || ""),
      senderUid: String(d.senderUid || ""),
      senderDisplayName: names.get(String(d.senderUid || "")) || "Genie",
      recipientUids,
      responseMode: d.responseMode || "first_accepts",
      difficulty: d.difficulty || "medium",
      magic: Number(d.magicReward || 10),
      status: d.status || "pending",
      createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
      completedAt: d.completedAt?.toDate ? d.completedAt.toDate().toISOString() : null,
      responses,
      myResponseStatus: responses.find(response => response.uid === uid)?.status || null,
      involvesMe: String(d.senderUid || "") === uid || recipientUids.includes(uid),
    };
  }));
  return {items};
}

export async function getCircleDashboard(auth: {uid?: string} | null | undefined, data: Record<string, unknown>) {
  const uid = requireAuth(auth);
  const circleId = requireString(data.circleId, "circleId", 100);
  await assertMember(uid, circleId);
  const membersSnap = await db.collection("circles").doc(circleId).collection("members").where("active", "==", true).get();
  const members = membersSnap.docs.map(d => {
    const points = Number(d.get("magic") || 0);
    const level = levelFor(points);
    return {
      uid: d.id,
      displayName: String(d.get("displayName") || "Genie"),
      magic: points,
      acceptedCount: Number(d.get("acceptedCount") || 0),
      streak: Number(d.get("streak") || 0),
      bestStreak: Number(d.get("bestStreak") || 0),
      achievements: Array.isArray(d.get("achievements")) ? d.get("achievements") : [],
      level: level.current.name,
      levelIndex: level.index,
      nextLevel: level.next?.name || null,
      nextLevelMagic: level.next?.min || null,
    };
  }).sort((a, b) => b.magic - a.magic);
  const me = members.find(m => m.uid === uid) || null;
  return {
    me,
    leaderboard: members,
    levels: LEVELS,
    achievements: [
      ["first_call", "First Call Answered", "Answer your first summon."],
      ["ten_calls", "Helpful Ten", "Answer 10 summons."],
      ["hundred_magic", "100 Magic", "Earn 100 Magic."],
      ["five_hundred_magic", "500 Magic", "Earn 500 Magic."],
      ["three_day_streak", "3-Day Streak", "Answer summons on 3 consecutive days."],
      ["seven_day_streak", "7-Day Streak", "Answer summons on 7 consecutive days."],
      ["everyone_answered", "Everyone Answered", "Take part in an Everyone Responds summon."],
    ].map(([id, name, description]) => ({id, name, description})),
  };
}

