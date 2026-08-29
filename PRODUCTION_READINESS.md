# Magic Lamp V2.1 — Production Readiness

## Automated test suite

The backend integration suite covers:

- Difficulty → Magic rewards and reward ledger
- Magic → level thresholds
- Achievement unlocks and achievement persistence
- Leaderboard ordering
- Genie Dashboard data
- Shared History and My History involvement
- Persistence and timezone-aware calendar-day logic
- Duplicate response/reward idempotency and duplicate summon requests
- First Genie Wins concurrency
- Everyone Responds completion and rewards

Run it with the Firebase Emulator running:

```bash
cd functions
npm test
```

The suite expects Firestore at `127.0.0.1:8080` and uses the `magic-lamp-3dd46` project ID.

## Web Push / FCM setup

The app is already wired for Firebase Cloud Messaging Web Push. One Firebase Console value is still required:

1. Open Firebase Console for `magic-lamp-3dd46`.
2. Go to **Project settings → Cloud Messaging**.
3. Under **Web configuration → Web Push certificates**, generate a key pair if one does not already exist.
4. Copy the **public VAPID key**.
5. Put that public key into `firebase-config.js` as `vapidPublicKey`.

Do not put the VAPID private key into the web app or source repository.

The browser must be served over HTTPS in production. `localhost` is allowed for local development. Firebase's current Web FCM documentation also notes that the FCM Registration API may need to be enabled for the project.

## Push behavior

- Each browser/device registration is stored separately.
- Stale registration tokens are removed when FCM reports them as invalid.
- Summons continue to exist if push delivery fails.
- Foreground messages open the incoming summon directly.
- Background messages are rendered by `firebase-messaging-sw.js`.
- Notification taps open `magic_lamp.html?summon=<id>`.
- The summon URL remains available as a fallback/deep link.

## Final manual production checks

After the VAPID key is configured, test on at least one real mobile device/browser:

1. Genie grants notification permission.
2. Genie closes/minimizes Magic Lamp.
3. Summoner creates a summon.
4. Genie receives the push.
5. Tapping the push opens the correct summon.
6. Genie accepts.
7. Summoner sees the response without refreshing.
8. Repeat with the Genie app open in the foreground.
