import { describe, it, expect } from "vitest";

export function mapLegacyStatus(status: string): string {
  switch (status) {
    case "Applied":
      return "APPLIED";
    case "Test":
      return "TEST";
    case "Interview":
      return "INTERVIEW";
    case "Offer":
      return "ACCEPTED";
    case "Rejected":
      return "REJECTED";
    case "Withdrawn":
      return "WITHDRAWN";
    default:
      return status;
  }
}

describe("Status Migration Mapping", () => {
  it("should map 'Applied' to 'APPLIED'", () => {
    expect(mapLegacyStatus("Applied")).toBe("APPLIED");
  });

  it("should map 'Test' to 'TEST'", () => {
    expect(mapLegacyStatus("Test")).toBe("TEST");
  });

  it("should map 'Interview' to 'INTERVIEW'", () => {
    expect(mapLegacyStatus("Interview")).toBe("INTERVIEW");
  });

  it("should map 'Offer' to 'ACCEPTED' (no OFFER status exists in new schema)", () => {
    expect(mapLegacyStatus("Offer")).toBe("ACCEPTED");
  });

  it("should map 'Rejected' to 'REJECTED'", () => {
    expect(mapLegacyStatus("Rejected")).toBe("REJECTED");
  });

  it("should map 'Withdrawn' to 'WITHDRAWN'", () => {
    expect(mapLegacyStatus("Withdrawn")).toBe("WITHDRAWN");
  });

  it("should preserve already migrated or uppercase statuses", () => {
    expect(mapLegacyStatus("APPLIED")).toBe("APPLIED");
    expect(mapLegacyStatus("SCREENING")).toBe("SCREENING");
    expect(mapLegacyStatus("ACCEPTED")).toBe("ACCEPTED");
  });
});

