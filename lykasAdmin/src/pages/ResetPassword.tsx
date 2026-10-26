import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PawPrint } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { FormField, Input } from "../components/ui/FormUI";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!token) {
      setError("This reset link is missing its token — request a new one.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { token, password });
      navigate("/login");
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to reset password"));
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
          <h1 className="text-xl font-semibold text-gray-900">Choose a new password</h1>
        </div>

        <div className="animate-in rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <FormField label="New password" htmlFor="password">
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField label="Confirm password" htmlFor="confirmPassword">
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </FormField>
            <Button type="submit" className="w-full" loading={loading}>
              Reset password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
