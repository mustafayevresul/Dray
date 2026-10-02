"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { api, AuthMeResponse } from "./api";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "needsRegistration" }
  | { status: "signedIn"; ownerId: string }
  | { status: "wrongRole" }; // this phone is registered as a Driver, not a Load Owner

type AuthContextValue = {
  state: AuthState;
  sendCode: (phone: string) => Promise<void>;
  verifyCode: (phone: string, code: string) => Promise<void>;
  completeRegistration: (fullName: string, companyName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const resolveSession = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: "signedOut" });
      return;
    }
    try {
      const me: AuthMeResponse = await api.getMe();
      if (me.registered && me.role === "LOAD_OWNER") {
        setState({ status: "signedIn", ownerId: me.ownerId });
      } else if (me.registered && me.role === "DRIVER") {
        setState({ status: "wrongRole" });
      } else {
        setState({ status: "needsRegistration" });
      }
    } catch {
      setState({ status: "signedOut" });
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => resolveSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => resolveSession(session));
    return () => sub.subscription.unsubscribe();
  }, [resolveSession]);

  async function sendCode(phone: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
  }

  async function verifyCode(phone: string, code: string) {
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error) throw error;
    const { data } = await supabase.auth.getSession();
    await resolveSession(data.session);
  }

  async function completeRegistration(fullName: string, companyName?: string) {
    await api.registerLoadOwner(fullName, companyName);
    const { data } = await supabase.auth.getSession();
    await resolveSession(data.session);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setState({ status: "signedOut" });
  }

  return (
    <AuthContext.Provider value={{ state, sendCode, verifyCode, completeRegistration, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
