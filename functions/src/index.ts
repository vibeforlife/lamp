import {setGlobalOptions} from "firebase-functions/v2";
import {onCall} from "firebase-functions/v2/https";
import {createCircle, createInvitation, acceptInvitation, getMyContext} from "./circles";
import {createSummon as createSummonHandler, getSummon as getSummonHandler, respondToSummon as respondToSummonHandler} from "./summons";
import {registerPushToken} from "./notifications";
import {getSummonHistory as getSummonHistoryHandler, getCircleDashboard as getCircleDashboardHandler} from "./rewards";

setGlobalOptions({region: "northamerica-northeast1", maxInstances: 5});

export const createMagicCircle = onCall(async request => createCircle(request.auth, request.data ?? {}));
export const getMagicCircle = onCall(async request => getMyContext(request.auth, request.data ?? {}));
export const createMagicInvitation = onCall(async request => createInvitation(request.auth, request.data ?? {}));
export const acceptMagicInvitation = onCall(async request => acceptInvitation(request.auth, request.data ?? {}));
export const createSummon = onCall(async request => createSummonHandler(request.auth, request.data ?? {}));
export const getSummon = onCall(async request => getSummonHandler(request.auth, request.data ?? {}));
export const respondToSummon = onCall(async request => respondToSummonHandler(request.auth, request.data ?? {}));
export const registerMagicPushToken = onCall(async request => registerPushToken(request.auth, request.data?.token));
export const getSummonHistory = onCall(async request => getSummonHistoryHandler(request.auth, request.data ?? {}));
export const getCircleDashboard = onCall(async request => getCircleDashboardHandler(request.auth, request.data ?? {}));
