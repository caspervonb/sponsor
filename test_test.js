import { assertMatch } from "https://deno.land/std@0.102.0/testing/asserts.ts";

const tests = [
  {
    input: ["testdata/test/pass.ts"],
    output: "testdata/test/pass.out",
  },
  {
    input: ["testdata/test/ignore.ts"],
    output: "testdata/test/ignore.out",
  },
  {
    input: ["testdata/test/dom.ts"],
    output: "testdata/test/dom.out",
  },
];

const browsers = [
  "chrome",
  "firefox",
];

for (const browser of browsers) {
  for (const { input, output } of tests) {
    Deno.test(`${browser}: ${input} => ${output}`, async function () {
      const process = Deno.run({
        env: {
          "NO_COLOR": "1",
        },
        cmd: [
          Deno.execPath(),
          "run",
          "--allow-all",
          "--unstable",
          "test.js",
          "--headless",
          "--browser",
          browser,
          ...input,
        ],
        stdout: "piped",
        stderr: "inherit",
      });

      const actual = new TextDecoder().decode(await process.output())
        .replaceAll(
          "\r\n",
          "\n",
        );

      const expected = new RegExp(
        (await Deno.readTextFile(output))
          .replaceAll("\r\n", "\n")
          .replaceAll("(", "\\(")
          .replaceAll(")", "\\)")
          .replaceAll(".", "\\.")
          .replaceAll("/", "\\/")
          .replaceAll(
            "[WILDCARD]",
            ".+",
          ),
      );

      process.close();

      assertMatch(actual, expected);
    });
  }
}
