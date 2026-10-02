/**
 * Push notifications — Phase 3.
 *
 * The driver app is Expo-managed, so the simplest "FCM-ready" path is
 * Expo's push notification service: it accepts one unified token format
 * and internally routes to FCM for Android / APNs for iOS, so this file
 * never has to touch Firebase Admin credentials directly. If you later
 * eject from Expo or want to send from a non-Expo admin tool too, swap
 * this module's internals for `firebase-admin`'s `messaging().send()` —
 * every call site below stays the same since they only depend on
 * `sendPushToDriver` / `sendPushToLoadOwner`.
 */

import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { db } from "@/lib/db";
import { translate, TranslationKey, SupportedLocale } from "../i18n/translate";

const expo = new Expo(); // pass { accessToken: process.env.EXPO_ACCESS_TOKEN } if using Expo's enhanced security

async function dispatch(messages: ExpoPushMessage[]) {
  const validMessages = messages.filter((m) => Expo.isExpoPushToken(m.to));
  if (validMessages.length === 0) return;

  const chunks = expo.chunkPushNotifications(validMessages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      // In production: store receipt ids and poll getPushNotificationReceiptsAsync
      // later to catch DeviceNotRegistered errors and clear stale tokens.
      const errors = receipts.filter((r) => r.status === "error");
      if (errors.length) console.warn("[push] some notifications failed:", errors);
    } catch (err) {
      console.error("[push] dispatch failed:", err);
    }
  }
}

export async function sendPushToDriver(
  driverId: string,
  titleKey: TranslationKey,
  bodyKey: TranslationKey,
  vars: Record<string, string | number> | undefined,
  data?: Record<string, unknown>
) {
  const driver = await db.driver.findUnique({
    where: { id: driverId },
    select: { expoPushToken: true, locale: true },
  });
  if (!driver?.expoPushToken) return;

  await dispatch([
    {
      to: driver.expoPushToken,
      sound: "default",
      title: translate(titleKey, vars, driver.locale.toLowerCase() as SupportedLocale),
      body: translate(bodyKey, vars, driver.locale.toLowerCase() as SupportedLocale),
      data: data ?? {},
    },
  ]);
}

export async function sendPushToLoadOwner(
  ownerId: string,
  titleKey: TranslationKey,
  bodyKey: TranslationKey,
  vars: Record<string, string | number> | undefined,
  data?: Record<string, unknown>
) {
  const owner = await db.loadOwner.findUnique({
    where: { id: ownerId },
    select: { webPushToken: true, locale: true },
  });
  if (!owner?.webPushToken) return;

  // NOTE: if the Load Owner Panel stays a web app, `webPushToken` should
  // hold a Web Push subscription instead of an Expo token, and this
  // branch should call a Web Push sender (e.g. the `web-push` npm
  // package) rather than Expo's. Left as one function with one shape
  // here for Phase 3 clarity; split when the owner app's platform is final.
  await dispatch([
    {
      to: owner.webPushToken,
      sound: "default",
      title: translate(titleKey, vars, owner.locale.toLowerCase() as SupportedLocale),
      body: translate(bodyKey, vars, owner.locale.toLowerCase() as SupportedLocale),
      data: data ?? {},
    },
  ]);
}

export async function sendPushToManyDrivers(
  targets: { driverId: string; vars: Record<string, string | number> }[],
  titleKey: TranslationKey,
  bodyKey: TranslationKey,
  data?: Record<string, unknown>
) {
  const drivers = await db.driver.findMany({
    where: { id: { in: targets.map((t) => t.driverId) } },
    select: { id: true, expoPushToken: true, locale: true },
  });

  const messages: ExpoPushMessage[] = drivers
    .filter((d) => d.expoPushToken)
    .map((d) => {
      const vars = targets.find((t) => t.driverId === d.id)!.vars;
      const locale = d.locale.toLowerCase() as SupportedLocale;
      return {
        to: d.expoPushToken!,
        sound: "default",
        title: translate(titleKey, vars, locale),
        body: translate(bodyKey, vars, locale),
        data: data ?? {},
      };
    });

  await dispatch(messages);
}
