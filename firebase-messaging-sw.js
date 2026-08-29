/* Magic Lamp — Firebase Cloud Messaging background worker. */
importScripts("https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDufg9yfaqzwFMcwuc-f6CZgcqG0s-31YM",
  authDomain: "magic-lamp-3dd46.firebaseapp.com",
  projectId: "magic-lamp-3dd46",
  storageBucket: "magic-lamp-3dd46.firebasestorage.app",
  messagingSenderId: "608029301421",
  appId: "1:608029301421:web:ea28e4838989bacc774424"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || "🧞 YOU HAVE BEEN SUMMONED", {
    body: notification.body || data.wish || "Your Magic Circle needs you.",
    icon: new URL("icon-192.png", self.registration.scope).href,
    badge: new URL("icon-192.png", self.registration.scope).href,
    data
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const summonId = event.notification?.data?.summonId;
  const target = summonId ? new URL(`magic_lamp.html?summon=${encodeURIComponent(summonId)}`, self.registration.scope).href : new URL("magic_lamp.html", self.registration.scope).href;
  event.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(clientList => {
    for (const client of clientList) {
      if ("focus" in client) { client.focus(); client.navigate(target); return; }
    }
    return clients.openWindow(target);
  }));
});
