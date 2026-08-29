import { describe, expect, it, vi } from "vitest";
import { ERROR_CODES, normalizeError } from "../src/shared/errors.js";
import { createLogger } from "../src/shared/logger.js";

describe("error and structured logging model", () => {
  it("maps SIEM error kinds to stable user-facing codes", () => {
    expect(normalizeError({ kind: "forbidden", message: "Denied" })).toEqual({ code: ERROR_CODES.SIEM_PERMISSION_DENIED, message: "Denied" });
    expect(normalizeError({ kind: "unsupported", message: "Missing" })).toEqual({ code: ERROR_CODES.SIEM_UNSUPPORTED_VERSION, message: "Missing" });
  });

  it("does not emit debug records while disabled", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    createLogger(false).debug("query", { requestCount: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("redacts secrets and full request bodies from structured diagnostics", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    createLogger(true, { module: "graph" }).debug("load", { duration: 12, apiKey: "secret", requestBody: { uuid: "event" } });
    expect(spy).toHaveBeenCalledWith("[ApePatrol] load", expect.objectContaining({ module: "graph", apiKey: "[redacted]", requestBody: "[redacted]" }));
    spy.mockRestore();
  });
});
