#!/usr/bin/env node
import { runSlida } from "./commands.ts";

const output = await runSlida();
if (output) {
  console.log(output);
}
