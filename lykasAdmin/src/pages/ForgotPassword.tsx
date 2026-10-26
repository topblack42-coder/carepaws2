import { useState, type FormEvent } from "react";
import { PawPrint, CheckCircle2 } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { FormField, Input } from "../components/ui/FormUI";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <PawPrint className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Reset your password</h1>
        </div>

        <div className="animate-in rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-status-success" aria-hidden="true" />
              <p className="text-sm text-gray-700">If that email is registered, a reset link is on its way.</p>
              <a href="/login" className="mt-2 text-sm text-primary hover:underline">
                Back to sign in
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4">
                  <Alert tone="danger">{error}</Alert>
                </div>
              )}
              <FormField label="Email" htmlFor="email">
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
              <Button type="submit" className="w-full" loading={loading}>
                Send reset link
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
