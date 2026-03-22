import { describe, test, expect } from "bun:test";
import { gate, gateAsync } from "../primitives/gate.ts";
import { GateRejection } from "../errors.ts";

describe("gate", () => {
  test("passes when condition is true", () => {
    expect(() => gate(true, "should not throw")).not.toThrow();
  });

  test("throws GateRejection when condition is false", () => {
    expect(() => gate(false, "tests must pass")).toThrow(GateRejection);
  });

  test("GateRejection contains the reason", () => {
    try {
      gate(false, "boundary violated");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GateRejection);
      expect((err as GateRejection).reason).toBe("boundary violated");
      expect((err as GateRejection).message).toContain("boundary violated");
    }
  });

  test("works with expressions", () => {
    const tests = { passed: true, count: 5 };
    expect(() => gate(tests.passed, "tests")).not.toThrow();
    expect(() => gate(tests.count > 10, "need more tests")).toThrow(GateRejection);
  });
});

describe("gateAsync", () => {
  test("passes when async check returns true", async () => {
    await expect(gateAsync(async () => true, "should pass")).resolves.toBeUndefined();
  });

  test("throws when async check returns false", async () => {
    await expect(gateAsync(async () => false, "async fail")).rejects.toThrow(GateRejection);
  });

  test("works with sync check function", async () => {
    await expect(gateAsync(() => true, "sync ok")).resolves.toBeUndefined();
    await expect(gateAsync(() => false, "sync fail")).rejects.toThrow(GateRejection);
  });
});
