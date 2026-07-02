import { constants } from "node:fs";
import { access } from "node:fs/promises";

export async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
