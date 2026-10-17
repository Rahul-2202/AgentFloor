import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listFiles, readTextFile } from "../src/core/files.ts";

test("the CEO reads what an agent wrote, and nothing else", () => {
  const home = mkdtempSync(join(tmpdir(), "agentfloor-files-"));
  const work = join(home, "work");
  mkdirSync(join(work, ".agentfloor"), { recursive: true });
  mkdirSync(join(work, "docs"), { recursive: true });
  writeFileSync(join(work, "ROOM_PLAN.md"), "# Plan\n");
  writeFileSync(join(work, "docs", "spec.md"), "M0 spec\n");
  writeFileSync(join(work, ".agentfloor", "identity.json"), '{"token":"secret"}');
  writeFileSync(join(home, "env"), "export AGENTFLOOR_TOKEN=secret\n");
  writeFileSync(join(work, "blob.bin"), Buffer.from([1, 0, 2]));
  symlinkSync(join(home, "env"), join(work, "sneaky"));

  const paths = listFiles(work).map((f) => f.path);
  assert.ok(paths.includes("ROOM_PLAN.md") && paths.includes("docs/spec.md"));
  assert.ok(!paths.some((p) => p.includes(".agentfloor")), "credentials are never listed");

  assert.equal(readTextFile(work, "docs/spec.md").text, "M0 spec\n");
  assert.throws(() => readTextFile(work, "../env"), /outside the agent's folder/);
  assert.throws(() => readTextFile(work, "sneaky"), /outside the agent's folder/, "symlinks out are refused");
  assert.throws(() => readTextFile(work, ".agentfloor/identity.json"), /office's own files/);
  assert.throws(() => readTextFile(work, "blob.bin"), /isn't a text file/);
  assert.throws(() => readTextFile(work, "nope.md"), /no file/);
});
