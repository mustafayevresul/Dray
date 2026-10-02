"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthProvider";

/**
 * Gates every page behind phone-OTP auth, mirroring driver-app/App.tsx's
 * flow. Kept as one component with local step state rather than separate
 * routes (/login, /verify, /register) since there's nothing else these
 * steps need to be — no deep-linking requirement, no back-button history
 * value in stepping through a login flow.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { state, sendCode, verifyCode, completeRegistration } = useAuth();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+994");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  if (state.status === "signedIn") {
    return <>{children}</>;
  }

  if (state.status === "wrongRole") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-slate-600">
          This phone number is registered as a Driver. Please use the Dray driver app instead.
        </p>
      </div>
    );
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendCode(phone.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(phone.trim(), code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeRegistration(fullName.trim(), companyName.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "needsRegistration") {
    return (
      <div className="mx-auto max-w-sm p-8 pt-24">
        <h1 className="text-xl font-bold text-slate-900">Tell us about your company</h1>
        <form onSubmit={handleRegister} className="mt-6 space-y-3">
          <input
            className="input"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Company name (optional)"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "…" : "Continue"}
          </button>
        </form>
        <style jsx global>{`
          .input {
            width: 100%;
            border: 1px solid #d1d5db;
            border-radius: 10px;
            padding: 10px 14px;
            font-size: 14px;
          }
        `}</style>
      </div>
    );
  }

  // signedOut
  return (
    <div className="mx-auto max-w-sm p-8 pt-24 text-center">
      <h1 className="text-xl font-bold text-slate-900">Welcome to Dray</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in with your phone number to post and track shipments.</p>

      {step === "phone" ? (
        <form onSubmit={handleSendCode} className="mt-6 space-y-3">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+994 50 123 45 67"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="mt-6 space-y-3">
          <p className="text-xs text-slate-400">Code sent to {phone}</p>
          <input
            className="input text-center tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "…" : "Verify"}
          </button>
          <button type="button" onClick={() => setStep("phone")} className="text-xs text-slate-400 underline">
            Use a different number
          </button>
        </form>
      )}

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
