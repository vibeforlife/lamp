import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";

export const firebaseApp = initializeApp();
export const db = getFirestore(firebaseApp);
export const messaging = getMessaging(firebaseApp);
