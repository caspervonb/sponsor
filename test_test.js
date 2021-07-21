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
];

for (const { input, output } of tests) {
  Deno.test(`${input} => ${output}`, async function () {
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
        "--browser",
        "chrome",
        ...input,
      ],
      stdout: "piped",
      stderr: "null",
    });

    const actual = new TextDecoder().decode(await process.output());
    const expected = new RegExp(
      (await Deno.readTextFile(output))
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
