import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { PawPrint } from "lucide-react";
import { useAuth, getApiErrorMessage } from "../context/AuthContext";
import { FormField, Input } from "../components/ui/FormUI";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";

export default function Login() {
  const { user, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    const from = (location.state as { from?: Location })?.from?.pathname || "/";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(getApiErrorMessage(err, "Login failed"));
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
          <h1 className="text-lg font-semibold text-gray-900">CarePaws Admin</h1>
          <p className="text-sm text-gray-500">Sign in to manage the shelter</p>
        </div>

        <div className="animate-in rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <FormField label="Email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </FormField>
            <FormField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </FormField>

            <div className="mb-4 text-right">
              <a href="/forgot-password" className="text-sm text-primary hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" className="w-full" loading={loading}>
              Sign in
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={async (credentialResponse) => {
                if (!credentialResponse.credential) return;
                setError(null);
                try {
                  await loginWithGoogle(credentialResponse.credential);
                  navigate("/");
                } catch (err) {
                  setError(getApiErrorMessage(err, "Google sign-in failed"));
                }
              }}
              onError={() => setError("Google sign-in failed")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
