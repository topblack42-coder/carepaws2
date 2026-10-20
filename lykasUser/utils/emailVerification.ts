import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import axios from "axios";
import { api, getApiErrorMessage } from "./api";
import type { AppUser } from "../context/AuthContext";

/** Matches the server's minimum gap between verification emails. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Members must verify before gated actions (staff/admin accounts are exempt server-side). */
export function needsEmailVerification(user: Pick<AppUser, "role" | "emailVerified"> | null | undefined): boolean {
  return !!user && user.role === "user" && user.emailVerified === false;
}

/** `retryAfterSeconds` from a 429 on resend-verification, if present. */
export function getRetryAfterSeconds(err: unknown): number | undefined {
  if (!axios.isAxiosError(err) || err.response?.status !== 429) return undefined;
  const value = (err.response.data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  return typeof value === "number" && value > 0 ? Math.ceil(value) : undefined;
}

export function isEmailNotVerifiedError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 403 && (err.response.data as { code?: string } | undefined)?.code === "EMAIL_NOT_VERIFIED";
}

/** POST /api/auth/resend-verification */
export async function resendVerificationEmail(): Promise<{ emailSent: boolean; alreadyVerified: boolean }> {
  const res = await api.post("/api/auth/resend-verification");
  const data = res.data?.data ?? {};
  return { emailSent: !data.emailSkipped, alreadyVerified: !!data.alreadyVerified };
}

export interface ResendFeedback {
  kind: "success" | "error";
  text: string;
}

/** Shared by the profile banner and the expired-link screen: loading, 60s cooldown countdown, feedback, 429 handling. */
export function useResendVerification(options: { onAlreadyVerified?: () => void } = {}) {
  const { onAlreadyVerified } = options;
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<ResendFeedback | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = useCallback(async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    setFeedback(null);
    try {
      const result = await resendVerificationEmail();
      if (result.alreadyVerified) {
        setFeedback({ kind: "success", text: "Your email is already verified." });
        onAlreadyVerified?.();
      } else if (!result.emailSent) {
        setFeedback({ kind: "error", text: "We couldn't send the email right now. Please try again later." });
      } else {
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setFeedback({ kind: "success", text: "Verification email sent. Check your inbox." });
      }
    } catch (err) {
      const retryAfter = getRetryAfterSeconds(err);
      if (retryAfter) setCooldown(retryAfter);
      setFeedback({ kind: "error", text: getApiErrorMessage(err, "Couldn't send the verification email") });
    } finally {
      setSending(false);
    }
  }, [sending, cooldown, onAlreadyVerified]);

  return { resend, sending, cooldown, feedback };
}

/**
 * Friendly "verify your email" prompt with a Resend action. Used instead of
 * a raw error when a gated action is attempted by an unverified member, both
 * before the call (pre-check) and from the 403 EMAIL_NOT_VERIFIED handler.
 */
export function promptVerifyEmail(options: { title?: string; message?: string } = {}) {
  const { title = "Verify your email", message = "Please verify your email to continue. We can send you a new verification link." } = options;
  Alert.alert(title, message, [
    { text: "Not now", style: "cancel" },
    {
      text: "Resend email",
      onPress: async () => {
        try {
          const result = await resendVerificationEmail();
          if (result.alreadyVerified) Alert.alert("Already verified", "Your email is already verified.");
          else if (result.emailSent) Alert.alert("Check your inbox", "We sent you a new verification link.");
          else Alert.alert("Couldn't send email", "We couldn't send the email right now. Please try again later.");
        } catch (err) {
          Alert.alert("Couldn't send email", getApiErrorMessage(err, "Couldn't send the verification email"));
        }
      },
    },
  ]);
}
