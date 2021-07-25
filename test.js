#!/usr/bin/env -S deno --allow-all --unstable

import { serve } from "https://deno.land/std@0.102.0/http/server.ts";
import { serveFile } from "https://deno.land/std@0.102.0/http/file_server.ts";
import { browse } from "./web/browser.ts";
import { parse } from "https://deno.land/std@0.102.0/flags/mod.ts";
import { resolve, toFileUrl } from "https://deno.land/std@0.102.0/path/mod.ts";

// The web inspector is used in generated code, so we include it here to have
// it cached ahead of time.
import "./web/inspector.js";

function isProxy(pathname) {
  const basename = pathname.split("/").at(-1);

  return (
    basename.endsWith("_test.ts") ||
    basename.endsWith("_test.tsx") ||
    basename.endsWith("_test.js") ||
    basename.endsWith("_test.mjs") ||
    basename.endsWith("_test.jsx") ||
    basename.endsWith(".test.ts") ||
    basename.endsWith(".test.tsx") ||
    basename.endsWith(".test.js") ||
    basename.endsWith(".test.mjs") ||
    basename.endsWith(".test.jsx") ||
    basename == "test.ts" ||
    basename == "test.tsx" ||
    basename == "test.js" ||
    basename == "test.mjs" ||
    basename == "test.jsx"
  );
}

function isEmit(pathname) {
  return (
    pathname.endsWith("js") ||
    pathname.endsWith("jsx") ||
    pathname.endsWith("ts") ||
    pathname.endsWith("tsx")
  );
}

function createRequestHandler(options) {
  const handleIndex = (request) => {
    const body = `
      <html>
      <head>
        <script type="module">
          const registry = [];
          const test = Object.assign(function(t, fn) {
            let test = null;

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
            registry.push(test);
          }, {
            registry
          });

          globalThis.Deno = {
            test,
          };
        </script>
      </head>
      <body></body>
      </html>
    `;

    return request.respond({
      body,
    });
  };

  const handleProxy = (request) => {
    console.log("handleProxy");

    const inspector = new URL("./web/inspector.js", import.meta.url);
    const body = `
      // ts-ignore-file
      import { open, inspect } from "${inspector}";

      function error(exceptionDetails) {
        // TODO(caspervonb): make this an error
        return new Error(JSON.stringify(exceptionDetails));
      }

      function retry(fn, ms) {
        return new Promise(resolve => {
          fn()
          .then(resolve)
          .catch((error) => {
            setTimeout(() => {
              retry(fn, ms).then(resolve);
            }, ms);
          });
        });
      }

      const target = await retry(() => {
        return open("http://localhost:8080");
      }, 1000);

      const inspector = inspect(target.webSocketDebuggerUrl);
      await inspector.send("Runtime.enable");

      {
        const evaluateReturnObject = await inspector.send("Runtime.evaluate", {
          expression: \`
            new Promise((resolve, reject) => {
              window.addEventListener('load', resolve);
              window.addEventListener('error', reject);
            })
          \`,
          awaitPromise: true,
        });

        if (evaluateReturnObject.exceptionDetails) {
          throw error(evaluateReturnObject.exceptionDetails);
        }
      }

    {
      const evaluateReturnObject = await inspector.send(
        "Runtime.evaluate", {
          expression: "import('http://localhost:8080/${request.url.slice(1)}')",
          awaitPromise: true,
        },
      );

      if (evaluateReturnObject.exceptionDetails) {
        throw error(evaluateReturnObject.exceptionDetails);
      }
    }

      const evaluateReturnObject = await inspector.send("Runtime.evaluate", {
        expression: "Deno.test.registry",
      });

      if (evaluateReturnObject.exceptionDetails) {
        throw error(evaluateReturnObject.exceptionDetails);
      }

      const getPropertiesReturnObject = await inspector.send("Runtime.getProperties", {
        objectId: evaluateReturnObject.result.objectId,
        ownProperties: true,
      });

      if (getPropertiesReturnObject.exceptionDetails) {
        throw error(getPropertiesReturnObject.exceptionDetails);
      }

      const tests = [];
      for (const propertyDescriptor of getPropertiesReturnObject.result) {
        if (!propertyDescriptor.enumerable) {
          continue;
        }

        const getPropertiesReturnObject = await inspector.send("Runtime.getProperties", {
          objectId: propertyDescriptor.value.objectId,
          ownProperties: true,
        });

        if (getPropertiesReturnObject.exceptionDetails) {
          throw error(getPropertiesReturnObject.exceptionDetails);
        }

        const definition = {
          name: "unknown",
          ignore: false,
          once: false,
          fn: function() {
          },
        };

        for (const propertyDescriptor of getPropertiesReturnObject.result) {
          if (propertyDescriptor.value.type == "function") {
            definition[propertyDescriptor.name] = async function() {
              const callFunctionOnResultObject = await inspector.send("Runtime.callFunctionOn", {
                functionDeclaration: "function() { return this.call(undefined, arguments); }",
                objectId: propertyDescriptor.value.objectId,
                arguments: Array.from(arguments),
                awaitPromise: true,
              });

              if (callFunctionOnResultObject.exceptionDetails) {
                throw error(callFunctionOnResultObject.exceptionDetails);
              }
            };
          } else if (typeof propertyDescriptor.value.value != "undefined") {
            definition[propertyDescriptor.name] = propertyDescriptor.value.value;
          }
        }

        tests.push(definition);
      }

      let pending = tests.length;
      let interval = setInterval(function() {
        if (pending > 0) {
          return;
        }

        inspector.close();
        clearInterval(interval);
      }, 1000);

      for (const test of tests) {
        const fn = test.fn;
        test.fn = async function() {
          try {
            await fn();
          } finally {
            pending--;
          }
        };

        Deno.test(test);
      }
    `;

    return request.respond({
      headers: new Headers({
        "Content-Type": "text/javascript",
      }),
      body,
    });
  };

  const emitCache = {};
  const handleEmit = async (request) => {
    console.log("handleEmit");
    const path = request.url.slice(1);
    const key = toFileUrl(resolve(path + ".js"));

    console.log(key);
    if (!emitCache[key]) {
      const { diagnostics, files } = await Deno.emit(path, {
        compilerOptions: {
          sourceMap: false,
          inlineSources: true,
          inlineSourceMap: true,
        },
      });

      // TODO(caspervonb) main diagnostics should come from Deno.
      for (const diagnostic of diagnostics) {
        if (diagnostic.category == Deno.DiagnosticCategory.Error) {
          throw new SyntaxError(diagnostic.messageText);
        }
      }

      Object.assign(emitCache, files);
    }

    const body = emitCache[key];
    if (!body) {
      return request.respond({
        status: 404,
        body: "Not found",
      });
    }

    return request.respond({
      headers: new Headers({
        "Content-Type": "text/javascript",
      }),
      body,
    });
  };

  const handleFile = (request) => {
    return serveFile(request, request.url.slice(1)).then((response) => {
      return request.respond(response);
    }).catch((error) => {
      return request.respond({ body: error.message });
    });
  };

  return function handleRequest(request) {
    console.log(request.method, request.url);

    const isDeno = request
      .headers
      .get("user-agent")
      .toLowerCase()
      .includes("deno");

    if (request.url == "/") {
      return handleIndex(request);
    }

    if (isDeno && isProxy(request.url)) {
      return handleProxy(request);
    }

    if (!isDeno && isEmit(request.url)) {
      return handleEmit(request);
    }

    return handleFile(request);
  };
}

export async function run(options) {
  // When no browser is provided, we just pass-through to deno.
  if (!options.browser) {
    const process = Deno.run({
      cmd: [
        Deno.execPath(),
        "test",
        ...inputs,
      ],
      stdout: "inherit",
      stderr: "inherit",
    });

    const status = await process.status();
    if (status.code != 0) {
      throw new Error("Process exited with non-zero status code");
    }

    return;
  }

  // TODO(caspervonb): use port 0.
  // TODO(caspervonb): support https, or preferably make sure that the browsers
  // treat this as https (allowing WebAssembly et cetera, etc).
  const port = 8080;
  const server = await serve({ port });
  const handleRequest = createRequestHandler({});
  (async () => {
    for await (const request of server) {
      handleRequest(request);
    }
  })();

  const browser = await browse({
    ...options,
  });

  const importMap = await Deno.makeTempFile({
    dir: Deno.cwd(),
    prefix: "import_map-",
    suffix: ".json",
  });

  await Deno.writeTextFile(
    importMap,
    JSON.stringify({
      imports: {
        "./": `http://localhost:${port}/`,
      },
    }),
  );

  const tester = Deno.run({
    cmd: [
      Deno.execPath(),
      "test",
      "--reload",
      "--allow-all",
      "--unstable",
      "--import-map=" + importMap,
      ...options.inputs,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await tester.status();
  await Deno.remove(importMap);

  server.close();
  browser.close();

  if (status.code != 0) {
    throw new Error("Process exited with non-zero status code");
  }
}

export default async function main(argv) {
  if (argv.length == 0) {
    return 0;
  }

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

  // Pass-through to Deno when a browser is not specified.
  if (!["chrome", "firefox"].includes(browser)) {
    throw new Error(
      `Invalid browser value ${browser}, valid options are 'chrome' and 'firefox'`,
    );
  }

  await run({
    browser,
    headless,
    filter,
    inputs,
  });
}

if (import.meta.main) {
  await main(Deno.args);
}
