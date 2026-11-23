import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../templates/", import.meta.url));
export async function syncTemplateIgnores(directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (["node_modules", ".git", ".next", ".claude"].includes(entry.name))
      continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await syncTemplateIgnores(file);
    else if (entry.name === ".gitignore")
      await fs.copyFile(file, path.join(directory, "gitignore"));
  }
}
