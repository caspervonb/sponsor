import { assertMatch } from "https://deno.land/std@0.102.0/testing/asserts.ts";

const tests = [
  {
    input: ["tools/testdata/test/pass.ts"],
    output: "tools/testdata/test/pass.out",
  },
  {
    input: ["tools/testdata/test/ignore.ts"],
    output: "tools/testdata/test/ignore.out",
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
        "--headless",
        "--browser",
        "chrome",
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
