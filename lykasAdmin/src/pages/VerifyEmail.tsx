import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { PawPrint, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");
  const { user } = useAuth();
  const [resend, setResend] = useState<{ state: "idle" | "sending" | "sent" | "error"; text?: string }>({ state: "idle" });

  async function requestNewLink() {
    setResend({ state: "sending" });
    try {
      await api.post("/api/auth/resend-verification");
      setResend({ state: "sent", text: "A new verification email is on its way." });
    } catch (err) {
      setResend({ state: "error", text: getApiErrorMessage(err, "Couldn't send a new link") });
    }
  }

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api
      .post("/api/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(getApiErrorMessage(err, "Verification failed"));
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <PawPrint className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>

        <div className="animate-in rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {status === "verifying" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" aria-hidden="true" />
              <p className="text-sm text-gray-600">Verifying your email…</p>
            </div>
          )}
          {status === "success" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-status-success" aria-hidden="true" />
              <p className="text-sm text-gray-700">Your email has been verified. You can return to the CarePaws app.</p>
              <Link to="/login" className="mt-2 text-sm text-primary hover:underline">
                Staff: continue to sign in
              </Link>
            </div>
          )}
          {status === "error" && (
            <div className="flex flex-col items-center gap-2">
              <XCircle className="h-8 w-8 text-status-danger" aria-hidden="true" />
              <p className="text-sm text-gray-700">{message}</p>
              {user ? (
                <>
                  <button
                    type="button"
                    onClick={requestNewLink}
                    disabled={resend.state === "sending" || resend.state === "sent"}
                    className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {resend.state === "sending" ? "Sending…" : "Request a new link"}
                  </button>
                  {resend.text && (
                    <p className={`text-xs ${resend.state === "error" ? "text-status-danger" : "text-gray-600"}`} role="status">
                      {resend.text}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500">Open the CarePaws app, go to Profile, and tap Resend email to get a new link.</p>
                  <Link to="/login" className="text-sm text-primary hover:underline">
                    Staff: sign in to request a new link
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
