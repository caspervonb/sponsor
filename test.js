import {
  gray,
  green,
  red,
  yellow,
} from "https://deno.land/std@0.102.0/fmt/colors.ts";

import { serve } from "https://deno.land/std@0.102.0/http/server.ts";
import { serveFile } from "https://deno.land/std@0.102.0/http/file_server.ts";
import { browse } from "https://deno.land/x/web@0.2.3/browser.ts";
import { parse } from "https://deno.land/std@0.102.0/flags/mod.ts";
import { resolve, toFileUrl } from "https://deno.land/std@0.102.0/path/mod.ts";

function handleIndex(request, options) {
  const body = `
    <html>
      <head>
      <title>sponsor test</title>
      <script type="module">
        // TODO(caspervonb): support injecting a full runtime polyfill.
        const tests = [];
        globalThis.Deno = {
          noColor: ${Deno.noColor},
          test(t, fn) {
            let test = null;

            // TODO(caspervonb) sanitizers and permissions are ignored but can
            // we emulate any of them?
            const defaults = {
              ignore: false,
              only: false,
            };

            if (typeof t === "string") {
              if (!fn || typeof fn != "function") {
                throw new TypeError("Missing test function");
              }
              if (!t) {
                throw new TypeError("The test name can't be empty");
              }
              test = { fn: fn, name: t, ...defaults };
            } else {
              if (!t.fn) {
                throw new TypeError("Missing test function");
              }
              if (!t.name) {
                throw new TypeError("The test name can't be empty");
              }

              test = { ...defaults, ...t };
            }

            tests.push(test);
          },
        };

        const dispatchTestEvent = (event) => {
          const url = location.origin + "/event";
          return fetch(url, {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json'
             },
             body: JSON.stringify(event),
          });
        };

        const dispatchClose = (event) => {
          // Ensure all pending promises are delivered before closing.
          return fetch("http://localhost:8080/close", {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json'
             },
             body: "{}",
          });
        };

        const createTestFilter = (filter) => {
          return (def) => {
            if (filter) {
              if (filter.startsWith("/") && filter.endsWith("/")) {
                const regex = new RegExp(filter.slice(1, filter.length - 1));
                return regex.test(def.name);
              }

              return def.name.includes(filter);
            }

            return true;
          };
        };

        const run = function({ ignore, fn }) {
          if (ignore) {
            return "ignored";
          }

          try {
            fn();
          } catch (error) {
            // TODO(caspervonb): match Deno's pretty error output
            return { failed: [String(error.message), String(error.stack)].join("\\n") };
          }

          return "ok";
        };

        const filter = ${JSON.stringify(options.filter)};
        // TODO(caspervonb): run modules in parallel.
        const specifiers = ${JSON.stringify(options.specifiers)};
        for (const specifier of specifiers) {
          // TODO(caspervonb): run modules in isolation.
          tests.splice(0, tests.length);

          await import(specifier);

          const only = tests.filter((test) => test.only);
          const filtered = (only.length > 0 ? only : tests).filter(createTestFilter(filter));

          // TODO(caspervonb): shuffle filtered tests

          await dispatchTestEvent({
            plan: {
              origin: specifier,
              total: filtered.length,
              filteredOut: tests.length - filtered.length,
              usedOnly: only.length > 0,
            },
          });

          for (const test of filtered) {
            const description = {
              origin: specifier,
              name: test.name,
            };
            const earlier = Date.now();

            await dispatchTestEvent({ wait: description });

            const result = await run(test);
            const elapsed = Date.now() - earlier;

            await dispatchTestEvent({ result: [description, result, elapsed] });
          }
        }

        dispatchClose();
      </script>
      </head>

      <body>
      </body>
    </html>
  `;

  return request.respond({
    body,
  });
}

async function handleEvent(request, callback) {
  request.respond({
    status: 200,
  });

  const body = await Deno.readAll(request.body);
  const event = JSON.parse(new TextDecoder().decode(body));
  callback(event);
}

function needsEmit(path) {
  return (
    path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".ts") ||
    path.endsWith(".tsx")
  );
}

const modules = {};
async function handleFile(request, path) {
  try {
    if (needsEmit(path)) {
      const url = toFileUrl(resolve(path + ".js"));
      if (!modules[url]) {
        // TODO(diagnostics)
        const { _diagnostics, files } = await Deno.emit(path, {
          compilerOptions: {
            sourceMap: false,
            inlineSources: true,
            inlineSourceMap: true,
          },
        });

        Object.assign(modules, files);
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/javascript");
      const body = modules[url];

      request.respond({
        headers,
        body,
      });
    } else {
      request.respond(await serveFile(request, path));
    }
  } catch (error) {
    request.respond({
      body: error.message,
    });
  }
}

export async function run(options) {
  if (!options.browser) {
    // TODO(caspervonb): pass-through
    return;
  }

  // TODO(caspervonb): use port 0.
  // TODO(caspervonb): support https, or preferably make sure that the browsers
  // treat this as https (allowing WebAssembly et cetera, etc).
  const port = 8080;
  const server = await serve({ port });
  const browser = await browse({
    url: `http://localhost:${port}`,
    ...options,
  });

  const reporter = {
    reportPlan(plan) {
      console.log("running %d tests from %s", plan.total, plan.origin);
    },

    reportWait(_description) {
      // no-op.
    },

    reportResult(description, result, elapsed) {
      const duration = gray(`(${elapsed}ms)`);
      if (result == "ok") {
        console.log(`test ${description.name} ... ${green("ok")} ${duration}`);
      } else if (result == "ignored") {
        console.log(
          `test ${description.name} ... ${yellow("ignored")} ${duration}`,
        );
      } else if (result.failed) {
        console.log(
          `test ${description.name} ... ${red("FAILED")} ${duration}`,
        );
      }
    },

    reportSummary(summary) {
      if (summary.failures.length > 0) {
        console.log("\nfailures:");
        for (const [description, failure] of summary.failures) {
          console.log(description.name, failure);
        }

        console.log("\nfailures:");
        for (const [description, _] of summary.failures) {
          console.log(description.name);
        }
      }

      const status = summary.failed > 0 ? red("FAILED") : green("ok");
      console.log(
        "\ntest result: %s. %d passed; %d failed; %d ignored; 0 measured; 0 filtered out (0ms)\n",
        status,
        summary.passed,
        summary.failed,
        summary.ignored,
      );
    },
  };

  const summary = {
    passed: 0,
    ignored: 0,
    failed: 0,
    failures: [],
  };

  let closing = false;
  for await (const request of server) {
    switch (request.url) {
      case "/":
        handleIndex(request, options);
        break;

      case "/event":
        handleEvent(request, (event) => {
          if (event.plan) {
            reporter.reportPlan(event.plan);
            summary.total += event.plan.total;
          }

          if (event.wait) {
            reporter.reportWait(event.wait);
          }

          if (event.result) {
            const [description, result, duration] = event.result;

            if (result == "ok") {
              summary.passed += 1;
            }

            if (result == "ignored") {
              summary.ignored += 1;
            }

            if (result.failed) {
              summary.failed += 1;
              summary.failures.push([description, result.failed]);
            }

            reporter.reportResult(description, result, duration);
          }
        });
        break;

      case "/close":
        await request.respond({ status: 200 });
        closing = true;
        break;

      default:
        handleFile(request, "./" + request.url.slice(1));
        break;
    }

    if (closing) {
      break;
    }
  }

  reporter.reportSummary(summary);
  server.close();
  browser.close();
}

export default async function main(argv) {
  if (argv.length == 0) {
    return;
  }

  // TODO(caspervonb): support shuffle.
  const {
    browser,
    headless,
    filter,
    _: inputs,
  } = parse(argv, {
    boolean: [
      "headless",
    ],
    string: [
      "filter",
    ],
  });

  // TODO(caspervonb): support fallthrough to `deno test`.
  if (!["chrome", "firefox"].includes(browser)) {
    throw new Error(
      `Invalid browser value ${browser}, valid options are 'chrome' and 'firefox'`,
    );
  }

  const specifiers = inputs.map((input) => "./" + input);

  await run({
    browser,
    headless,
    filter,
    specifiers,
  });
}

if (import.meta.main) {
  await main(Deno.args);
}
