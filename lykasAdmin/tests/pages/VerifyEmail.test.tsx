import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import VerifyEmail from "../../src/pages/VerifyEmail";

let mockUser: { id: string } | null = null;
vi.mock("../../src/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock("../../src/services/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/api")>("../../src/services/api");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import { api } from "../../src/services/api";

function renderPage(path = "/verify-email?token=abc") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const expiredError = { isAxiosError: true, response: { status: 400, data: { message: "Invalid or expired verification token" } } };

describe("VerifyEmail page", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    mockUser = null;
  });

  it("confirms a verified email", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Your email has been verified/)).toBeTruthy());
  });

  it("points a signed-out visitor to the app instead of offering a resend they can't use", async () => {
    vi.mocked(api.post).mockRejectedValue(expiredError);
    renderPage();
    await waitFor(() => expect(screen.getByText("Invalid or expired verification token")).toBeTruthy());
    expect(screen.getByText(/tap Resend email/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request a new link" })).toBeNull();
  });

  it("lets a signed-in user request a new link from the error state", async () => {
    mockUser = { id: "staff1" };
    vi.mocked(api.post).mockImplementation((url: string) =>
      url === "/api/auth/verify-email" ? Promise.reject(expiredError) : Promise.resolve({ data: { success: true } })
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Request a new link" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/auth/resend-verification"));
    expect(await screen.findByText("A new verification email is on its way.")).toBeTruthy();
  });
});
