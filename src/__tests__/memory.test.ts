import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { remember, recall } from "../primitives/memory.ts";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "__test_tmp_memory__");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("remember", () => {
  test("creates file and writes entry", async () => {
    const path = join(TEST_DIR, "MEMORY.md");

    await remember(path, "Always use bcrypt for passwords");

    const content = await Bun.file(path).text();
    expect(content).toContain("Always use bcrypt for passwords");
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/); // has timestamp
  });

  test("appends multiple entries", async () => {
    const path = join(TEST_DIR, "MEMORY.md");

    await remember(path, "Rule one");
    await remember(path, "Rule two");

    const entries = await recall(path);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.content).toBe("Rule one");
    expect(entries[1]!.content).toBe("Rule two");
  });

  test("creates parent directories", async () => {
    const path = join(TEST_DIR, "deep", "nested", "MEMORY.md");

    await remember(path, "Nested entry");

    const entries = await recall(path);
    expect(entries).toHaveLength(1);
  });
});

describe("recall", () => {
  test("returns empty array for nonexistent file", async () => {
    const entries = await recall(join(TEST_DIR, "nope.md"));
    expect(entries).toEqual([]);
  });

  test("parses entries with timestamps", async () => {
    const path = join(TEST_DIR, "MEMORY.md");
    await remember(path, "Test entry");

    const entries = await recall(path);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Test entry");
    expect(entries[0]!.timestamp).toBeGreaterThan(0);
  });

  test("filters by search string (case-insensitive)", async () => {
    const path = join(TEST_DIR, "MEMORY.md");
    await remember(path, "Use bcrypt for passwords");
    await remember(path, "Register modules in config.ts");
    await remember(path, "Never modify the auth middleware");

    const configRules = await recall(path, "config");
    expect(configRules).toHaveLength(1);
    expect(configRules[0]!.content).toContain("config.ts");

    const authRules = await recall(path, "AUTH");
    expect(authRules).toHaveLength(1);
    expect(authRules[0]!.content).toContain("auth middleware");
  });

  test("returns all entries when no search provided", async () => {
    const path = join(TEST_DIR, "MEMORY.md");
    await remember(path, "One");
    await remember(path, "Two");
    await remember(path, "Three");

    const all = await recall(path);
    expect(all).toHaveLength(3);
  });
});
