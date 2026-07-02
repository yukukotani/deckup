import { sep } from "node:path";

export function normalizePath(path: string) {
  return path.split(sep).join("/");
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
