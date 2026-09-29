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

  // The route reads `{ action, reason }` and answers PATCH
  // (src/app/api/moderasi/volunteer-trips/[id]/route.ts); nothing else is read,
  // so nothing else is sent.
  it("Loloskan PATCHes { action: approve, reason } to the Trip's route", async () => {
    render(<TripDecisionPanel tripId="trip-9" />);
    fireEvent.click(screen.getByRole("button", { name: /Loloskan/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderasi/volunteer-trips/trip-9");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ action: "approve", reason: "" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps Tolak disabled until a reason is written, then posts { action: reject, reason }", async () => {
    render(<TripDecisionPanel tripId="trip-9" />);
    const reject = screen.getByRole("button", { name: /Tolak/ }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /Alasan penolakan/ }), { target: { value: "   " } });
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /Alasan penolakan/ }), {
      target: { value: "Itinerary belum jelas" },
    });
    expect(reject.disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/moderasi/volunteer-trips/trip-9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ action: "reject", reason: "Itinerary belum jelas" });
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
