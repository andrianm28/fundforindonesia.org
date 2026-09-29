import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TripDecisionPanel } from "./TripDecisionPanel";

const fetchMock = vi.fn();

describe("TripDecisionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // The route reads exactly `{ action }` and answers PATCH
  // (src/app/api/moderasi/volunteer-trips/[id]/route.ts); nothing else is
  // read, so nothing else is sent.
  it.each([
    ["Loloskan", "approve"],
    ["Tolak", "reject"],
  ])("%s PATCHes exactly { action: %s } to the Trip's route", async (label, action) => {
    render(<TripDecisionPanel tripId="trip-9" />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderasi/volunteer-trips/trip-9");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ action });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the server's refusal text and does not refresh", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Anda tidak dapat memutuskan Volunteer Trip milik Anda sendiri." }),
    });
    render(<TripDecisionPanel tripId="trip-9" />);
    fireEvent.click(screen.getByRole("button", { name: /Loloskan/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("milik Anda sendiri");
    expect(refresh).not.toHaveBeenCalled();
  });
});
