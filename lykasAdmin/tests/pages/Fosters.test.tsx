import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Fosters from "../../src/pages/Fosters";
import { ToastProvider } from "../../src/context/ToastContext";

vi.mock("../../src/services/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/api")>("../../src/services/api");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

let mockIsAdmin = false;
vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({ hasRole: (...roles: string[]) => (mockIsAdmin ? roles.includes("admin") : roles.includes("staff")) && mockIsAdmin }),
}));

import { api } from "../../src/services/api";

const DAY = 24 * 60 * 60 * 1000;

function foster(overrides: Record<string, unknown> = {}) {
  return {
    _id: "f1",
    pet: { _id: "p1", name: "Bantay" },
    fosterer: { _id: "u1", displayName: "Maria" },
    startDate: new Date(Date.now() - 40 * DAY).toISOString(),
    expectedEndDate: new Date(Date.now() - 3 * DAY).toISOString(),
    extendedDays: 0,
    status: "active",
    weeklyReportsSubmitted: 3,
    weeklyReportsRequired: 5,
    ...overrides,
  };
}

const READY = { canFinalize: true, missingReports: 0, unreviewedReports: 0, requiresVetCheck: false, healthFlags: [], returnRequest: null };

function mockApi(rows: unknown[], readiness: Record<string, unknown> = READY) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/api/foster") return Promise.resolve({ data: { data: rows, pagination: { total: rows.length, page: 1, limit: 20, pages: 1 } } });
    if (url.endsWith("/can-finalize")) return Promise.resolve({ data: { data: readiness } });
    return Promise.resolve({ data: { data: [] } });
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <Fosters />
    </ToastProvider>
  );
}

async function openManage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Complete / extend" }));
  return screen.findByLabelText("What is happening?");
}

describe("Fosters page: safeguards", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    mockIsAdmin = false;
  });

  it("flags an active placement that is past its end date, and one that is returning in an emergency", async () => {
    mockApi([foster(), foster({ _id: "f2", expectedEndDate: new Date(Date.now() + 20 * DAY).toISOString(), returnRequest: { urgency: "emergency", reason: "Hospital", status: "open" } })]);
    renderPage();
    expect(await screen.findByText("Overdue 3d")).toBeInTheDocument();
    expect(screen.getByText("Emergency return")).toBeInTheDocument();
  });

  it("extends through /extend with a reason, the fosterer's agreement and the vet's, never through /end", async () => {
    mockApi([foster()]);
    vi.mocked(api.put).mockResolvedValue({ data: { data: {} } });
    const user = userEvent.setup();
    renderPage();
    await openManage(user);

    await user.click(screen.getByLabelText("The fosterer agreed to the extension"));
    await user.click(screen.getByLabelText("A veterinarian agreed to the extension"));
    await user.type(screen.getByLabelText("Why is an extension needed?"), "Dog still recovering from surgery");
    await user.click(screen.getByRole("button", { name: "Extend foster period" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/foster/f1/extend", {
        extensionDays: 14,
        reason: "Dog still recovering from surgery",
        vetAgreed: true,
        fostererAgreed: true,
      })
    );
  });

  it("will not send an extension without a reason or without the fosterer's agreement", async () => {
    mockApi([foster()]);
    const user = userEvent.setup();
    renderPage();
    await openManage(user);

    await user.type(screen.getByLabelText("Why is an extension needed?"), "short");
    await user.click(screen.getByRole("button", { name: "Extend foster period" }));
    expect(await screen.findByText(/Explain why the extension is needed/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("will not send a 3-day extension", async () => {
    mockApi([foster()]);
    const user = userEvent.setup();
    renderPage();
    await openManage(user);

    const days = screen.getByLabelText("Extend by (days)");
    await user.clear(days);
    await user.type(days, "3");
    await user.type(screen.getByLabelText("Why is an extension needed?"), "Dog still recovering from surgery");
    await user.click(screen.getByLabelText("The fosterer agreed to the extension"));
    await user.click(screen.getByRole("button", { name: "Extend foster period" }));
    // The field's min=7 stops the form in the browser; the handler's own check backs it up.
    expect(days).toBeInvalid();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("completes through /end with the staff health check; staff cannot add an exception for missing reports", async () => {
    mockApi([foster()], { ...READY, canFinalize: false, missingReports: 2 });
    const user = userEvent.setup();
    renderPage();
    const select = await openManage(user);
    expect(await screen.findByText(/2 weekly reports are missing/)).toBeInTheDocument();

    await user.selectOptions(select, "RETURNED");
    expect(screen.getByText(/Only an admin can complete a placement with missing or unreviewed reports/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Admin exception/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Health check you did on the pet"), "Seen in person, healthy and eating well");
    await user.click(screen.getByRole("button", { name: "Review placement closure" }));
    expect(await screen.findByText(/Some reports are missing or unreviewed/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("lets an admin complete with a recorded exception", async () => {
    mockIsAdmin = true;
    mockApi([foster()], { ...READY, canFinalize: false, missingReports: 2 });
    vi.mocked(api.put).mockResolvedValue({ data: { data: {} } });
    const user = userEvent.setup();
    renderPage();
    const select = await openManage(user);
    await screen.findByText(/2 weekly reports are missing/);

    await user.selectOptions(select, "ADOPTED");
    await user.type(screen.getByLabelText("Health check you did on the pet"), "Seen in person, healthy and eating well");
    await user.type(screen.getByLabelText(/Admin exception/), "Fosterer unreachable, checked in person");
    await user.click(screen.getByRole("button", { name: "Review placement closure" }));
    expect(await screen.findByText(/Confirm closure: Bantay/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm placement closure" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/foster/f1/end", {
        outcome: "ADOPTED",
        finalHealthCheck: { notes: "Seen in person, healthy and eating well", vetVerified: false },
        completionException: { reason: "Fosterer unreachable, checked in person" },
      })
    );
  });

  it("requires a vet check when a weekly report raised a health concern", async () => {
    mockApi([foster()], { ...READY, requiresVetCheck: true, healthFlags: [{ weekNumber: 2, reasons: ["vet visit requested"] }] });
    const user = userEvent.setup();
    renderPage();
    const select = await openManage(user);
    expect(await screen.findByText(/raised a health concern \(week 2\)/)).toBeInTheDocument();

    await user.selectOptions(select, "RETURNED");
    await user.type(screen.getByLabelText("Health check you did on the pet"), "Seen in person, limping slightly");
    await user.click(screen.getByRole("button", { name: "Review placement closure" }));
    expect(await screen.findByText(/A veterinarian must check the pet first/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});
