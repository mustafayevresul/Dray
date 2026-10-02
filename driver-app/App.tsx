import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./services/supabaseClient";
import { LocaleProvider } from "./i18n/LocaleProvider";
import PhoneEntryScreen from "./screens/PhoneEntryScreen";
import OtpVerifyScreen from "./screens/OtpVerifyScreen";
import RegistrationScreen from "./screens/RegistrationScreen";
import HomeScreen from "./screens/HomeScreen";
import { api, AuthMeResponse } from "./services/api";

type Stage =
  | { name: "loading" }
  | { name: "phoneEntry" }
  | { name: "otpVerify"; phone: string }
  | { name: "needsRegistration" }
  | { name: "home"; driverId: string }
  | { name: "wrongRole" }; // this phone is registered as a Load Owner, not a Driver

/**
 * Root of the driver app.
 *
 * Phase 5 replaces the previous "store a driverId in AsyncStorage, trust it
 * forever" flow with real Supabase Auth phone-OTP sessions:
 *
 *   no session           -> PhoneEntryScreen -> OtpVerifyScreen
 *   session, no profile  -> RegistrationScreen (truck/license details)
 *   session, has Driver  -> HomeScreen
 *   session, has LoadOwner (not Driver) -> wrongRole screen — this build
 *     is the driver app; a load-owner account belongs in load-owner-web.
 *
 * A session on its own is never enough to reach HomeScreen — /api/auth/me
 * is what actually confirms a Driver profile exists for this account, the
 * same check every protected API route performs server-side.
 */
export default function App() {
  const [stage, setStage] = useState<Stage>({ name: "loading" });

  const resolveSession = useCallback(async (session: Session | null) => {
    if (!session) {
      setStage({ name: "phoneEntry" });
      return;
    }
    try {
      const me: AuthMeResponse = await api.getMe();
      if (me.registered && me.role === "DRIVER") {
        setStage({ name: "home", driverId: me.driverId });
      } else if (me.registered && me.role === "LOAD_OWNER") {
        setStage({ name: "wrongRole" });
      } else {
        setStage({ name: "needsRegistration" });
      }
    } catch {
      // Token invalid/expired and refresh failed — back to phone entry.
      setStage({ name: "phoneEntry" });
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => resolveSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [resolveSession]);

  async function handleRegistered() {
    // Re-resolve from the server rather than trusting the id the
    // registration response returned, for the same reason every API route
    // re-verifies rather than trusting a client claim: consistency.
    const { data } = await supabase.auth.getSession();
    await resolveSession(data.session);
  }

  let content: React.ReactNode;
  switch (stage.name) {
    case "loading":
      content = (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      );
      break;
    case "phoneEntry":
      content = <PhoneEntryScreen onCodeSent={(phone) => setStage({ name: "otpVerify", phone })} />;
      break;
    case "otpVerify":
      content = (
        <OtpVerifyScreen
          phone={stage.phone}
          onVerified={() => supabase.auth.getSession().then(({ data }) => resolveSession(data.session))}
          onBack={() => setStage({ name: "phoneEntry" })}
        />
      );
      break;
    case "needsRegistration":
      content = <RegistrationScreen onRegistered={handleRegistered} />;
      break;
    case "home":
      content = <HomeScreen driverId={stage.driverId} />;
      break;
    case "wrongRole":
      content = (
        <View style={styles.loading}>
          <Text style={styles.wrongRoleText}>
            This phone number is registered as a Load Owner. Please use the Dray web app instead.
          </Text>
        </View>
      );
      break;
  }

  return <LocaleProvider>{content}</LocaleProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB", padding: 24 },
  wrongRoleText: { fontSize: 15, color: "#374151", textAlign: "center", lineHeight: 22 },
});
