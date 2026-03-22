import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { install } from "../primitives/installer.ts";
import { InstallerError } from "../errors.ts";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "__test_tmp_installer__");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("install", () => {
  test("creates files from inline content", async () => {
    const dest = join(TEST_DIR, "pipeline", "review.ts");

    const result = await install({
      files: { [dest]: "export const review = true;" },
    });

    expect(result.installed).toContain(dest);
    const content = await Bun.file(dest).text();
    expect(content).toBe("export const review = true;");
  });

  test("creates parent directories", async () => {
    const dest = join(TEST_DIR, "deep", "nested", "file.ts");

    await install({ files: { [dest]: "content" } });

    expect(existsSync(dest)).toBe(true);
  });

  test("installs multiple files", async () => {
    const file1 = join(TEST_DIR, "a.ts");
    const file2 = join(TEST_DIR, "b.ts");

    const result = await install({
      files: {
        [file1]: "file a",
        [file2]: "file b",
      },
    });

    expect(result.installed).toHaveLength(2);
  });

  test("skips preserved files that already exist", async () => {
    const dest = join(TEST_DIR, "registry.json");
    writeFileSync(dest, '["existing data"]');

    const result = await install({
      files: { [dest]: "[]" },
      preserve: [dest],
    });

    expect(result.skipped).toContain(dest);
    expect(result.installed).not.toContain(dest);

    // Original content preserved
    const content = await Bun.file(dest).text();
    expect(content).toBe('["existing data"]');
  });

  test("creates preserved file if it doesn't exist yet", async () => {
    const dest = join(TEST_DIR, "new-registry.json");

    const result = await install({
      files: { [dest]: "[]" },
      preserve: [dest],
    });

    // File didn't exist, so it should be created despite being in preserve
    expect(result.installed).toContain(dest);
  });

  test("skips files under preserved directory prefix", async () => {
    const memoryFile = join(TEST_DIR, "memory", "project.md");
    mkdirSync(join(TEST_DIR, "memory"), { recursive: true });
    writeFileSync(memoryFile, "# Existing memory");

    const result = await install({
      files: { [memoryFile]: "# Overwritten" },
      preserve: [join(TEST_DIR, "memory/")],
    });

    expect(result.skipped).toContain(memoryFile);
    const content = await Bun.file(memoryFile).text();
    expect(content).toBe("# Existing memory");
  });

  test("is idempotent — running twice produces same result", async () => {
    const dest = join(TEST_DIR, "idem.ts");
    const manifest = { files: { [dest]: "same content" } };

    await install(manifest);
    const result2 = await install(manifest);

    expect(result2.installed).toContain(dest);
    const content = await Bun.file(dest).text();
    expect(content).toBe("same content");
  });
});
