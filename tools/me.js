import { open } from "../web/browser.ts";

export function run(options) {
  open("https://github.com/sponsors/caspervonb");
}

export default async function main(args) {
  await run();
}

if (import.meta.main) {
  await main(Deno.args);
}
