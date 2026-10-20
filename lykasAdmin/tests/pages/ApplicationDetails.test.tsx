import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter, Routes, Route, useLocation, type InitialEntry } from "react-router-dom";
import ApplicationDetails from "../../src/pages/ApplicationDetails";
import { ToastProvider } from "../../src/context/ToastContext";

vi.mock("../../src/services/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/api")>("../../src/services/api");
  return {
    ...actual,
    api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  };
});

import { api } from "../../src/services/api";

type Overrides = Record<string, unknown>;

function makeApp(overrides: Overrides = {}) {
  return {
    _id: "app1",
    pet: { _id: "pet1", name: "Bea", species: "Dog", status: "Pending", imageUrl: "https://img.test/bea.jpg" },
    applicant: { _id: "u1", displayName: "Maria Santos", email: "maria@example.com" },
    phone: "0917 000 0000",
    address: "123 Main St",
    experience: "Had dogs before",
    householdSize: 3,
    isRenting: false,
    landlordApproval: false,
    type: "adoption",
    status: "pending",
    stage: "interview",
    createdAt: "2026-10-01T08:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    stageHistory: [{ stage: "submitted", changedAt: "2026-10-01T08:00:00.000Z", note: "Application submitted", changedBy: { displayName: "Maria Santos" } }],
    internalNotes: [],
    ...overrides,
  };
}

function ListStub() {
  const { search } = useLocation();
  return <div>Applications list{search}</div>;
}

function renderPage(app: Overrides = {}, entries: InitialEntry[] = ["/adoptions/app1"], initialIndex?: number) {
  vi.mocked(api.get).mockResolvedValue({ data: { data: makeApp(app) } });
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <ToastProvider>
        <Routes>
          <Route path="/adoptions" element={<ListStub />} />
          <Route path="/adoptions/:id" element={<ApplicationDetails />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const pipeline = () => screen.getByRole("list", { name: "Application pipeline" });
const stepItem = (name: string) => within(pipeline()).getAllByRole("listitem").find((li) => within(li).queryByText(name, { exact: true }))!;
const noStageCalls = () => vi.mocked(api.put).mock.calls.filter(([url]) => String(url).endsWith("/stage"));

describe("ApplicationDetails page", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("titles the page by type and shows pet, dates and contact links", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: /Adoption application: Bea/ })).toBeInTheDocument();
    expect(screen.getByAltText("Bea")).toHaveAttribute("src", "https://img.test/bea.jpg");
    expect(screen.getByRole("link", { name: /View Bea's page/ })).toHaveAttribute("href", "/pets/pet1");
    expect(screen.getByRole("link", { name: "maria@example.com" })).toHaveAttribute("href", "mailto:maria@example.com");
    expect(screen.getByRole("link", { name: /0917 000 0000/ })).toHaveAttribute("href", "tel:09170000000");
  });

  it("renders stepper states with aria-current on the current step only", async () => {
    renderPage({ stage: "interview" });
    await screen.findByRole("heading", { level: 1 });

    expect(within(stepItem("Submitted")).getByText("Completed")).toBeInTheDocument();
    expect(within(stepItem("Document review")).getByText("Completed")).toBeInTheDocument();
    expect(within(stepItem("Interview")).getByText("Current")).toBeInTheDocument();
    expect(within(stepItem("Home visit")).getByText("Next")).toBeInTheDocument();
    expect(within(stepItem("Risk assessment")).getByText("Upcoming")).toBeInTheDocument();

    const current = within(pipeline()).getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(stepItem("Interview"));
  });

  it("opens a confirm modal for the next step, sends stage and note, and updates the UI", async () => {
    renderPage({ stage: "interview" });
    vi.mocked(api.put).mockResolvedValue({ data: { data: makeApp({ stage: "home_visit" }) } });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Move to Home visit" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Note/), "Interview went well");
    await user.click(within(dialog).getByRole("button", { name: "Move to Home visit" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/applications/app1/stage", { stage: "home_visit", note: "Interview went well" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(stepItem("Home visit")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/Current: Home visit\./)).toBeInTheDocument();
  });

  it("sends the stage change once on a double click", async () => {
    renderPage({ stage: "interview" });
    let resolve!: (v: unknown) => void;
    vi.mocked(api.put).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Move to Home visit" }));
    await user.dblClick(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to Home visit" }));

    expect(api.put).toHaveBeenCalledTimes(1);
    resolve({ data: { data: makeApp({ stage: "home_visit" }) } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("never offers a control that sends stage approved or rejected", async () => {
    renderPage({ stage: "risk_assessment" });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByRole("button", { name: /^Move to/ })).not.toBeInTheDocument();
    expect(screen.getByText("Final decision required.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Decision/ })).toHaveAttribute("href", "#decision");

    vi.mocked(api.put).mockResolvedValue({ data: { data: makeApp({ stage: "approved", status: "approved" }) } });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve application" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/api/applications/app1/status", { status: "approved", note: undefined }));
    expect(noStageCalls()).toHaveLength(0);
  });

  it("explains the locked decision before risk assessment and ignores clicks", async () => {
    renderPage({ stage: "submitted", stageHistory: [] });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });

    const callout = "Final decision unlocks after Risk assessment. Currently at: Submitted (4 steps to go).";
    expect(screen.getByText(callout)).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).toHaveAttribute("title", callout);
    expect(screen.getByRole("button", { name: "Reject" })).toHaveAttribute("aria-disabled", "true");

    await user.click(approve);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens confirm modals for Approve and Reject at risk assessment", async () => {
    renderPage({ stage: "risk_assessment" });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/Final decision unlocks/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    let dialog = screen.getByRole("dialog", { name: "Approve this application?" });
    expect(within(dialog).getByText(/Adopted/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    dialog = screen.getByRole("dialog", { name: "Reject this application?" });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it("requires a rejection reason, sends it as note, and keeps the modal open with an inline error on failure", async () => {
    renderPage({ stage: "risk_assessment" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Reject application" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at least 5 characters");
    expect(api.put).not.toHaveBeenCalled();

    const failure = new AxiosError("fail", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 409,
      statusText: "Conflict",
      headers: {},
      config: {} as never,
      data: { message: "Server refused the rejection" },
    });
    vi.mocked(api.put).mockRejectedValueOnce(failure);
    await user.type(within(dialog).getByLabelText(/Reason for rejection/), "Not a good fit");
    await user.click(within(dialog).getByRole("button", { name: "Reject application" }));

    expect(await within(dialog).findByText("Server refused the rejection")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason for rejection/)).toHaveValue("Not a good fit");

    vi.mocked(api.put).mockResolvedValueOnce({
      data: { data: makeApp({ stage: "rejected", status: "rejected", reviewedAt: "2026-10-05T08:00:00.000Z", reviewedBy: { displayName: "Ana Staff" } }) },
    });
    await user.click(within(dialog).getByRole("button", { name: "Reject application" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.put).toHaveBeenLastCalledWith("/api/applications/app1/status", { status: "rejected", note: "Not a good fit" });
  });

  it("shows a rejected application as stopped with the reason and no action buttons", async () => {
    renderPage({
      stage: "rejected",
      status: "rejected",
      reviewedAt: "2026-10-05T08:00:00.000Z",
      reviewedBy: { displayName: "Ana Staff" },
      stageHistory: [
        { stage: "submitted", changedAt: "2026-10-01T08:00:00.000Z", note: "Application submitted" },
        { stage: "risk_assessment", changedAt: "2026-10-04T08:00:00.000Z" },
        { stage: "rejected", changedAt: "2026-10-05T08:00:00.000Z", note: "Home is unsuitable", changedBy: { displayName: "Ana Staff" } },
      ],
    });
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getAllByText(/Rejected on .* by Ana Staff/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Home is unsuitable/).length).toBeGreaterThan(0);
    expect(within(stepItem("Risk assessment")).getByText("Rejected here")).toBeInTheDocument();
    expect(within(pipeline()).queryByText("Rejected", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move to/ })).not.toBeInTheDocument();
  });

  it("shows an approved adoption as a read-only decision that can still be scheduled", async () => {
    renderPage({
      stage: "approved",
      status: "approved",
      reviewedAt: "2026-10-05T08:00:00.000Z",
      reviewedBy: { displayName: "Ana Staff" },
      pet: { _id: "pet1", name: "Bea", species: "Dog", status: "Adopted" },
    });
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText(/Approved on .* by Ana Staff/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to Adoption scheduled" })).toBeInTheDocument();
  });

  it("hides adoption-only stages for foster applications and links to Foster Management once approved", async () => {
    renderPage({ type: "foster", fosterPeriod: "6 weeks", stage: "approved", status: "approved", pet: { _id: "pet1", name: "Bea", species: "Dog", status: "Foster" } });
    expect(await screen.findByRole("heading", { level: 1, name: /Foster application: Bea/ })).toBeInTheDocument();

    expect(within(pipeline()).queryByText("Adoption scheduled")).not.toBeInTheDocument();
    expect(within(pipeline()).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /Start foster placement/ })).toHaveAttribute("href", "/fosters");
    expect(screen.getByText("6 weeks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move to/ })).not.toBeInTheDocument();
  });

  it("goes back through history when opened from the list, and falls back to /adoptions otherwise", async () => {
    const user = userEvent.setup();
    const first = renderPage({}, ["/adoptions?page=2", { pathname: "/adoptions/app1", state: { fromList: true } }], 1);
    await user.click(await screen.findByRole("button", { name: "Back to applications" }));
    expect(await screen.findByText("Applications list?page=2")).toBeInTheDocument();
    first.unmount();

    renderPage({}, ["/adoptions?page=2", "/adoptions/app1"], 1);
    await user.click(await screen.findByRole("button", { name: "Back to applications" }));
    expect(await screen.findByText("Applications list")).toBeInTheDocument();
  });

  it("adds an internal note with Ctrl+Enter and keeps the text when saving fails", async () => {
    renderPage();
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Add an internal note");

    vi.mocked(api.post).mockRejectedValueOnce(new Error("boom"));
    await user.type(box, "Called applicant");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(box).toHaveValue("Called applicant");

    vi.mocked(api.post).mockResolvedValueOnce({ data: { data: [{ text: "Called applicant", createdAt: "2026-10-02T08:00:00.000Z", author: { displayName: "Ana Staff" } }] } });
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText(/Ana Staff ·/)).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(api.post).toHaveBeenLastCalledWith("/api/applications/app1/notes", { text: "Called applicant" });
  });
});
