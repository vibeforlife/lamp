# Magic Lamp — Firebase Foundation

This build adds the real Firebase-backed Magic Circle and summon infrastructure on top of the verified V2 lamp/rubbing baseline.

## Implemented

- Firebase Anonymous Auth
- Secure server-side Magic Circle creation
- Private invitation tokens (hashed at rest, single-use, 7-day expiry)
- Multiple Circle members
- Every member can be Summoner and Genie
- Multi-recipient summon selection
- Everyone selection
- Firestore-backed summons and responses
- First-accepts response mode
- Firebase Cloud Messaging token registration boundary
- Push notification delivery function
- GitHub Pages-compatible FCM service worker
- Firestore security rules: client writes to protected Circle/invitation/summon data are denied; trusted callable Functions perform mutations
- Node 22 Cloud Functions runtime

## Local emulator development

The static frontend automatically connects to the Firebase Auth and Functions emulators when it is served from `localhost` or `127.0.0.1`.

The configured local endpoints are:

- Auth: `127.0.0.1:9099`
- Functions: `127.0.0.1:5001`
- Firestore: `127.0.0.1:8080`
- Emulator UI: `127.0.0.1:4000`

Start the emulators from the project root:

```bash
firebase emulators:start
```

For browser testing, serve the project directory locally over HTTP rather than opening `magic_lamp.html` directly as a `file://` URL. For example:

```bash
python3 -m http.server 8082
```

Then open:

```text
http://127.0.0.1:8082/magic_lamp.html
```

Production/GitHub Pages is not affected by the emulator routing because the emulator connections are enabled only for localhost/127.0.0.1.

## Not yet connected

- Email delivery (waiting for email provider choice/credentials)
- Web Push VAPID public key (add it to `firebase-config.js` after generating it in Firebase Console)
- Production GitHub Pages domain in Firebase Auth Authorized Domains

## Install / deploy

From the project root:

```bash
cd functions
npm install
npm run build
npm run lint
cd ..
firebase deploy --only firestore:rules,functions
```

Do not deploy until the emulator test sequence has passed.

Do not commit `functions/.env*`, secrets, or service-account JSON.

## Firebase Auth

Add the GitHub Pages hostname under Firebase Console → Authentication → Settings → Authorized domains.

## Web Push

Generate a Web Push certificate/key pair in Firebase Console → Project Settings → Cloud Messaging. Put only the PUBLIC VAPID key into `firebase-config.js`:

```js
export const vapidPublicKey = 'BFWFdNtkLPH9Al0cUhKdo-VAElcVVtKy3EGmC2hONIUJOX_tq5nxqUhsqikNHgMD9XDR_IBWbhoR_1g2Czau6h0';
```

Never put a private VAPID key in the website.

## Testing sequence

1. Start Auth + Firestore + Functions emulators.
2. Test Circle creation.
3. Test invitation creation and acceptance.
4. Test one-person summon.
5. Test multi-person summon.
6. Test Everyone selection.
7. Test Accept / Reject.
8. Test Firestore security rules.
9. Only then deploy rules/functions.
10. Test real FCM Push.
11. Add/test Email later.

## Email

Email is intentionally not deployed in this build. The notification layer is already separated so email can be added without changing the Circle or summon model. A transactional provider such as Resend can be connected next, with its API key stored as a Firebase Secret rather than in the browser.
