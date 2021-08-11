#!/usr/bin/env deno -S --allow-all --unstable

const commands = {
  "test": await import("./tools/test.js"),
  "me": await import("./tools/me.js"),
};

try {
  const args = Array.from(Deno.args);
  if (args.length == 0) {
    throw new Error(`No command specified`);
  }

  const name = args.shift();
  const command = commands[name];
  if (!command) {
    throw new Error(`Unknown command ${name}`);
  }

  command.default(args);
} catch (error) {
  await Deno.writeAll(
    Deno.stderr,
    new TextEncoder().encode(`error: ${error.message}`),
  );
}
