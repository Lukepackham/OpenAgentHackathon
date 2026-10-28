/**
 * Candidates live in their own JSON file. This store never opens the
 * Zetaris catalogue or src/opportunities/catalog.json.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createCandidateStore(filePath) {
  let chain = Promise.resolve();
  const lock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    filePath,
    load() {
      return lock(() => readStore(filePath));
    },
    update(change) {
      return lock(async () => {
        const current = await readStore(filePath);
        const next = await change(current);
        await writeStore(filePath, next);
        return next;
      });
    },
  };
}

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    return { candidates };
  } catch (error) {
    if (error.code === "ENOENT") return { candidates: [] };
    throw new Error("The discovery candidate file could not be read.");
  }
}

async function writeStore(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const payload = JSON.stringify({ candidates: data.candidates ?? [] }, null, 2);
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, payload, "utf8");
  await unlink(filePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new Error("The discovery candidate file could not be saved.");
  }
}
