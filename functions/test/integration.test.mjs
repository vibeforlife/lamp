import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import net from 'node:net';
const require = createRequire(import.meta.url);

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'magic-lamp-3dd46';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

let db, createCircle, createInvitation, acceptInvitation, createSummon, respondToSummon, getCircleDashboard, getSummonHistory, dayKey, calendarDayDifference, registerPushToken;

const auth = uid => ({uid});
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;

async function createCircleWithMembers(count = 3) {
  const uids = Array.from({length: count}, (_, i) => id(`u${i + 1}`));
  const first = await createCircle(auth(uids[0]), {displayName: 'Summoner', name: id('Circle'), timeZone: 'America/Toronto'});
  const circleId = first.circleId;
  for (let i = 1; i < count; i++) {
    const invitation = await createInvitation(auth(uids[0]), {circleId});
    await acceptInvitation(auth(uids[i]), {token: invitation.token, displayName: `Genie ${i}`, timeZone: 'America/Toronto'});
  }
  return {circleId, uids};
}

async function summonAndRespond(circleId, senderUid, recipientUid, difficulty = 'medium', responseMode = 'first_accepts') {
  const result = await createSummon(auth(senderUid), {
    circleId,
    wish: `Automated test wish ${randomUUID()}`,
    recipientUids: [recipientUid],
    responseMode,
    difficulty,
    requestId: id('request'),
  });
  await respondToSummon(auth(recipientUid), {circleId, summonId: result.summonId, response: 'accepted'});
  return result.summonId;
}

async function ensureEmulator() {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port: Number(port)});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('connection timeout')); }, 1500);
    socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
  }).catch(error => {
    throw new Error(`Firestore emulator is not reachable at ${process.env.FIRESTORE_EMULATOR_HOST}. Start the V2.1 emulator first. Original error: ${error.message}`);
  });
  ({db} = require('../lib/firebase.js'));
  ({createCircle, createInvitation, acceptInvitation} = require('../lib/circles.js'));
  ({createSummon, respondToSummon} = require('../lib/summons.js'));
  ({getCircleDashboard, getSummonHistory, dayKey, calendarDayDifference} = require('../lib/rewards.js'));
  ({registerPushToken} = require('../lib/notifications.js'));
}


const tests = [
  ['4. difficulty maps to exact Magic rewards and ledger entries', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const [easy, medium, hard, epic] = await Promise.all([
    summonAndRespond(circleId, uids[0], uids[1], 'easy'),
    summonAndRespond(circleId, uids[0], uids[1], 'medium'),
    summonAndRespond(circleId, uids[0], uids[1], 'hard'),
    summonAndRespond(circleId, uids[0], uids[1], 'epic'),
  ]);
  const member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  assert.equal(member.get('magic'), 90);
  const ledger = await db.collection('circles').doc(circleId).collection('rewardLedger').get();
  assert.equal(ledger.size, 4);
  const rewardValues = ledger.docs.map(d => d.get('magic')).sort((a, b) => a - b);
  assert.deepEqual(rewardValues, [5, 10, 25, 50]);
  assert.ok([easy, medium, hard, epic].every(summonId => ledger.docs.some(d => d.get('summonId') === summonId))); 
}],
  ['5. Magic accumulation crosses level thresholds correctly', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  await summonAndRespond(circleId, uids[0], uids[1], 'epic');
  await summonAndRespond(circleId, uids[0], uids[1], 'hard');
  await summonAndRespond(circleId, uids[0], uids[1], 'medium');
  await summonAndRespond(circleId, uids[0], uids[1], 'easy');
  await summonAndRespond(circleId, uids[0], uids[1], 'easy');
  const dashboard = await getCircleDashboard(auth(uids[1]), {circleId});
  assert.equal(dashboard.me.magic, 100);
  assert.equal(dashboard.me.level, 'Helpful Genie');
  assert.equal(dashboard.me.nextLevel, 'Trusted Genie');
  assert.equal(dashboard.me.nextLevelMagic, 250);
  const memberRef = db.collection('circles').doc(circleId).collection('members').doc(uids[1]);
  const expectedLevels = [[0, 'Lamp Apprentice'], [100, 'Helpful Genie'], [250, 'Trusted Genie'], [500, 'Royal Genie'], [1000, 'Master of the Lamp'], [2000, 'Legendary Genie'], [5000, 'Grand Master Genie']];
  for (const [points, level] of expectedLevels) {
    await memberRef.set({magic: points}, {merge: true});
    const check = await getCircleDashboard(auth(uids[1]), {circleId});
    assert.equal(check.me.level, level);
  }
}],
  ['6. achievements unlock and remain permanently earned', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  for (let i = 0; i < 10; i++) await summonAndRespond(circleId, uids[0], uids[1], 'medium');
  for (let i = 0; i < 9; i++) await summonAndRespond(circleId, uids[0], uids[1], 'epic');
  let member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  const achievements = member.get('achievements');
  assert.ok(achievements.includes('first_call'));
  assert.ok(achievements.includes('ten_calls'));
  assert.ok(achievements.includes('hundred_magic'));
  assert.ok(achievements.includes('five_hundred_magic'));
  await summonAndRespond(circleId, uids[0], uids[1], 'easy', 'everyone_responds');
  member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  assert.ok(member.get('achievements').includes('everyone_answered'));
  await summonAndRespond(circleId, uids[0], uids[1], 'easy', 'first_accepts');
  member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  for (const achievement of ['first_call', 'ten_calls', 'hundred_magic', 'five_hundred_magic', 'everyone_answered']) {
    assert.ok(member.get('achievements').includes(achievement), `${achievement} disappeared`);
  }
}],
  ['7. leaderboard ranks active Circle members by Magic', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  await summonAndRespond(circleId, uids[0], uids[1], 'epic');
  await summonAndRespond(circleId, uids[0], uids[2], 'easy');
  const dashboard = await getCircleDashboard(auth(uids[0]), {circleId});
  assert.equal(dashboard.leaderboard[0].uid, uids[1]);
  assert.equal(dashboard.leaderboard[0].magic, 50);
  assert.equal(dashboard.leaderboard[1].uid, uids[2]);
  assert.equal(dashboard.leaderboard[1].magic, 5);
}],
  ['8. Genie Dashboard reports consistent member stats', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  await summonAndRespond(circleId, uids[0], uids[1], 'hard');
  const dashboard = await getCircleDashboard(auth(uids[1]), {circleId});
  assert.equal(dashboard.me.uid, uids[1]);
  assert.equal(dashboard.me.magic, 25);
  assert.equal(dashboard.me.acceptedCount, 1);
  assert.equal(dashboard.me.streak, 1);
  assert.equal(dashboard.me.bestStreak, 1);
  assert.equal(dashboard.me.level, 'Lamp Apprentice');
}],
  ['9. Shared History returns summon, participants, difficulty, reward and response state', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const summonId = await summonAndRespond(circleId, uids[0], uids[1], 'hard');
  const history = await getSummonHistory(auth(uids[0]), {circleId, limit: 50});
  const item = history.items.find(entry => entry.id === summonId);
  assert.ok(item);
  assert.equal(item.senderUid, uids[0]);
  assert.deepEqual(item.recipientUids, [uids[1]]);
  assert.equal(item.difficulty, 'hard');
  assert.equal(item.magic, 25);
  assert.equal(item.status, 'accepted');
  assert.equal(item.responses[0].uid, uids[1]);
  assert.equal(item.responses[0].status, 'accepted');
  const recipientHistory = await getSummonHistory(auth(uids[1]), {circleId, limit: 50});
  assert.equal(recipientHistory.items.find(entry => entry.id === summonId)?.involvesMe, true);
  const unrelatedHistory = await getSummonHistory(auth(uids[2]), {circleId, limit: 50});
  assert.equal(unrelatedHistory.items.find(entry => entry.id === summonId)?.involvesMe, false);
}],
  ['10. progression state persists across fresh reads and local calendar days are timezone-aware', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  await summonAndRespond(circleId, uids[0], uids[1], 'medium');
  const memberRef = db.collection('circles').doc(circleId).collection('members').doc(uids[1]);
  const firstRead = await memberRef.get();
  const secondRead = await memberRef.get();
  assert.equal(secondRead.get('magic'), firstRead.get('magic'));
  assert.equal(secondRead.get('acceptedCount'), firstRead.get('acceptedCount'));
  assert.equal(secondRead.get('streak'), firstRead.get('streak'));
  const beforeMidnightUtc = new Date('2026-01-01T04:30:00.000Z');
  const afterMidnightUtc = new Date('2026-01-01T05:30:00.000Z');
  assert.equal(dayKey(beforeMidnightUtc, 'America/Toronto'), '2025-12-31');
  assert.equal(dayKey(afterMidnightUtc, 'America/Toronto'), '2026-01-01');
  assert.equal(calendarDayDifference(afterMidnightUtc, beforeMidnightUtc, 'America/Toronto'), 1);
}],
  ['11. duplicate response is idempotent and does not double-reward', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const requestId = id('request');
  const result = await createSummon(auth(uids[0]), {
    circleId,
    wish: 'Idempotency test',
    recipientUids: [uids[1]],
    responseMode: 'first_accepts',
    difficulty: 'hard',
    requestId,
  });
  await respondToSummon(auth(uids[1]), {circleId, summonId: result.summonId, response: 'accepted'});
  await respondToSummon(auth(uids[1]), {circleId, summonId: result.summonId, response: 'accepted'});
  const duplicateCreate = await createSummon(auth(uids[0]), {
    circleId,
    wish: 'Idempotency test',
    recipientUids: [uids[1]],
    responseMode: 'first_accepts',
    difficulty: 'hard',
    requestId,
  });
  assert.equal(duplicateCreate.summonId, result.summonId);
  const member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  assert.equal(member.get('magic'), 25);
  assert.equal(member.get('acceptedCount'), 1);
  const ledger = await db.collection('circles').doc(circleId).collection('rewardLedger').get();
  assert.equal(ledger.size, 1);
}],
  ['12. First Genie Wins allows exactly one accepted winner', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const result = await createSummon(auth(uids[0]), {
    circleId,
    wish: 'Race test',
    recipientUids: [uids[1], uids[2]],
    responseMode: 'first_accepts',
    difficulty: 'medium',
    requestId: id('request'),
  });
  const outcomes = await Promise.allSettled([
    respondToSummon(auth(uids[1]), {circleId, summonId: result.summonId, response: 'accepted'}),
    respondToSummon(auth(uids[2]), {circleId, summonId: result.summonId, response: 'accepted'}),
  ]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  const summon = await db.collection('circles').doc(circleId).collection('summons').doc(result.summonId).get();
  assert.equal(summon.get('status'), 'accepted');
  assert.ok([uids[1], uids[2]].includes(summon.get('acceptedBy')));
  const members = await Promise.all([uids[1], uids[2]].map(uid => db.collection('circles').doc(circleId).collection('members').doc(uid).get()));
  assert.equal(members.filter(m => Number(m.get('magic') || 0) === 10).length, 1);
  assert.equal(members.filter(m => Number(m.get('acceptedCount') || 0) === 1).length, 1);
}],
  ['13. Everyone Responds stays pending until the final recipient responds, with one reward each', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const result = await createSummon(auth(uids[0]), {
    circleId,
    wish: 'Everyone test',
    recipientUids: [uids[1], uids[2]],
    responseMode: 'everyone_responds',
    difficulty: 'medium',
    requestId: id('request'),
  });
  await respondToSummon(auth(uids[1]), {circleId, summonId: result.summonId, response: 'accepted'});
  let summon = await db.collection('circles').doc(circleId).collection('summons').doc(result.summonId).get();
  assert.equal(summon.get('status'), 'pending');
  await respondToSummon(auth(uids[2]), {circleId, summonId: result.summonId, response: 'accepted'});
  summon = await db.collection('circles').doc(circleId).collection('summons').doc(result.summonId).get();
  assert.equal(summon.get('status'), 'completed');
  for (const uid of [uids[1], uids[2]]) {
    const member = await db.collection('circles').doc(circleId).collection('members').doc(uid).get();
    assert.equal(member.get('magic'), 10);
    assert.equal(member.get('acceptedCount'), 1);
  }
  const ledger = await db.collection('circles').doc(circleId).collection('rewardLedger').get();
  assert.equal(ledger.size, 2);
}],
  ['14. Reject response is recorded without awarding Magic and remains independently actionable', async () => {
  const {circleId, uids} = await createCircleWithMembers();
  const first = await createSummon(auth(uids[0]), {
    circleId, wish: 'Reject test one', recipientUids: [uids[1]], responseMode: 'first_accepts', difficulty: 'medium', requestId: id('request'),
  });
  const second = await createSummon(auth(uids[0]), {
    circleId, wish: 'Reject test two', recipientUids: [uids[1]], responseMode: 'first_accepts', difficulty: 'medium', requestId: id('request'),
  });
  await respondToSummon(auth(uids[1]), {circleId, summonId: first.summonId, response: 'rejected'});
  const firstRead = await getSummon(auth(uids[1]), {circleId, summonId: first.summonId});
  assert.equal(firstRead.response.status, 'rejected');
  assert.equal(firstRead.summon.status, 'pending');
  const secondRead = await getSummon(auth(uids[1]), {circleId, summonId: second.summonId});
  assert.equal(secondRead.response.status, 'pending');
  const history = await getSummonHistory(auth(uids[1]), {circleId, limit: 50});
  assert.equal(history.items.find(entry => entry.id === first.summonId)?.myResponseStatus, 'rejected');
  assert.equal(history.items.find(entry => entry.id === second.summonId)?.myResponseStatus, 'pending');
  const member = await db.collection('circles').doc(circleId).collection('members').doc(uids[1]).get();
  assert.equal(member.get('magic') || 0, 0);
  await respondToSummon(auth(uids[1]), {circleId, summonId: second.summonId, response: 'accepted'});
  const secondAfter = await getSummon(auth(uids[1]), {circleId, summonId: second.summonId});
  assert.equal(secondAfter.response.status, 'accepted');
}],
  ['15. push registration keeps multiple device tokens for one Genie', async () => {
  const {uids} = await createCircleWithMembers();
  const firstToken = 'a'.repeat(180);
  const secondToken = 'b'.repeat(180);
  await registerPushToken(auth(uids[1]), firstToken);
  await registerPushToken(auth(uids[1]), secondToken);
  const user = await db.collection('users').doc(uids[1]).get();
  const tokens = Object.values(user.get('pushTokens') || {});
  assert.equal(tokens.length, 2);
  assert.ok(tokens.includes(firstToken));
  assert.ok(tokens.includes(secondToken));
}],
]

async function main() {
  try {
    await ensureEmulator();
  } catch (error) {
    console.error(`TEST ENVIRONMENT ERROR: ${error.message}`);
    process.exit(2);
  }
  let passed = 0;
  for (const [name, fn] of tests) {
    const started = Date.now();
    try {
      await fn();
      passed++;
      console.log(`PASS ${name} (${Date.now() - started}ms)`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
      break;
    }
  }
  console.log(`\n${passed}/${tests.length} automated tests passed.`);
  if (process.exitCode) process.exit(process.exitCode);
}

main();
