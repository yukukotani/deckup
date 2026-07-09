#!/usr/bin/env node
import { runDeckup } from "./commands.ts";

const output = await runDeckup();
if (output) {
  console.log(output);
}
