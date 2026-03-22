import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registryRead, registryAppend } from "../primitives/registry.ts";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "__test_tmp_registry__");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("registryRead", () => {
  test("returns empty array for nonexistent file", async () => {
    const entries = await registryRead(join(TEST_DIR, "nope.json"));
    expect(entries).toEqual([]);
  });

  test("reads array-format registry", async () => {
    const path = join(TEST_DIR, "tests.json");
    await Bun.write(path, JSON.stringify([
      { mind: "@auth", file: "auth.test.ts" },
      { mind: "@api", file: "api.test.ts" },
    ]));

    const entries = await registryRead<{ mind: string; file: string }>(path);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.mind).toBe("@auth");
  });

  test("reads object-with-entries format", async () => {
    const path = join(TEST_DIR, "tests.json");
    await Bun.write(path, JSON.stringify({
      entries: [{ mind: "@auth", file: "auth.test.ts" }],
    }));

    const entries = await registryRead<{ mind: string }>(path);
    expect(entries).toHaveLength(1);
  });

  test("filters entries", async () => {
    const path = join(TEST_DIR, "tests.json");
    await Bun.write(path, JSON.stringify([
      { mind: "@auth", file: "auth.test.ts" },
      { mind: "@api", file: "api.test.ts" },
      { mind: "@auth", file: "auth-e2e.test.ts" },
    ]));

    const authTests = await registryRead<{ mind: string; file: string }>(
      path,
      (e) => e.mind === "@auth",
    );
    expect(authTests).toHaveLength(2);
    expect(authTests.every((e) => e.mind === "@auth")).toBe(true);
  });
});

describe("registryAppend", () => {
  test("creates file if it doesn't exist", async () => {
    const path = join(TEST_DIR, "new", "registry.json");

    await registryAppend(path, { mind: "@auth", file: "auth.test.ts" });

    const entries = await registryRead<{ mind: string }>(path);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.mind).toBe("@auth");
  });

  test("appends to existing file", async () => {
    const path = join(TEST_DIR, "append.json");
    await Bun.write(path, JSON.stringify([{ mind: "@auth", file: "a.ts" }]));

    await registryAppend(path, { mind: "@api", file: "b.ts" });

    const entries = await registryRead<{ mind: string }>(path);
    expect(entries).toHaveLength(2);
  });

  test("appends to object-with-entries format", async () => {
    const path = join(TEST_DIR, "obj.json");
    await Bun.write(path, JSON.stringify({ entries: [{ id: 1 }] }));

    await registryAppend(path, { id: 2 });

    const entries = await registryRead<{ id: number }>(path);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.id).toBe(2);
  });
});
