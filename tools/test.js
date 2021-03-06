#!/usr/bin/env -S deno --allow-all --unstable

import { serve } from "https://deno.land/std@0.102.0/http/server.ts";
import { serveFile } from "https://deno.land/std@0.102.0/http/file_server.ts";
import { browse } from "../web/browser.ts";
import { parse } from "https://deno.land/std@0.102.0/flags/mod.ts";
import {
  relative,
  resolve,
  toFileUrl,
} from "https://deno.land/std@0.102.0/path/mod.ts";

// The web inspector is used in generated code, so we include it here to have
// it cached ahead of time.
import "../web/inspector.js";

function createRequestHandler({ check, inputs = [] }) {
  const normalizeFilePath = (url) => {
    if (url.startsWith("/C:/")) {
      return url.slice(1);
    }

    if (url.startsWith("/D:/")) {
      return url.slice(1);
    }

    return url;
  };

  const isTestInput = (url) => {
    for (const input of inputs) {
      if (input.startsWith("http:") || input.startsWith("https:")) {
        continue;
      }

      if (toFileUrl(resolve(input)).href == toFileUrl(url).href) {
        return true;
      }
    }

    return false;
  };

  const isTestSpecifier = (url) => {
    const basename = url.split("/").at(-1);

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
  };

  const isEmitSpecifier = (url) => {
    return (
      url.endsWith("js") ||
      url.endsWith("jsx") ||
      url.endsWith("ts") ||
      url.endsWith("tsx")
    );
  };

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
            noColor: ${Deno.noColor},
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

  const handleFavicon = (request) => {
    return request.respond({
      body: "",
    });
  };

  const handleProxy = (request) => {
    Deno.writeAllSync(
      Deno.stderr,
      new TextEncoder().encode(`Proxy ${request.url}\n`),
    );

    const inspector = new URL("../web/inspector.js", import.meta.url);
    const body = `
      import { open, close, inspect } from "${inspector}";

      function error(exceptionDetails) {
        // TODO(caspervonb): make this an error
        return new Error(JSON.stringify(exceptionDetails));
      }

      function retry(fn, ms, attempts) {
        return new Promise(resolve => {
          fn()
          .then(resolve)
          .catch((error) => {
            setTimeout(() => {
              retry(fn, ms,).then(resolve);
            }, ms);
          });
        });
      }

      const target = await retry(() => {
        return open("http://localhost:8080");
      }, 1000, 10);

      const inspector = inspect(target.webSocketDebuggerUrl);
      await inspector.send("Runtime.enable");

      {
        const evaluateReturnObject = await inspector.send("Runtime.evaluate", {
          expression: \`
            new Promise((resolve, reject) => {
              if (document.readyState == "complete") {
                resolve();
              } else {
                window.addEventListener('load', resolve);
                window.addEventListener('error', reject);
              }
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
            throw new Error("test function is not defined");
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

              const { exceptionDetails } = callFunctionOnResultObject;
              if (exceptionDetails) {
                const callFunctionOnResultObject = await inspector.send("Runtime.callFunctionOn", {
                  functionDeclaration: "function() { return this.message.toString() + this.stack.toString() }",
                  objectId: exceptionDetails.exception.objectId,
                  returnByValue: true,
                });

                throw callFunctionOnResultObject.result.value;
              }
            };
          } else if (typeof propertyDescriptor.value.value != "undefined") {
            definition[propertyDescriptor.name] = propertyDescriptor.value.value;
          }
        }

        Deno.test(definition);
      }

      const internal = Deno[Deno.internal];
      const { runTests } = internal;
      internal.runTests = function() {
        return runTests.apply(internal, arguments).finally(() => {
          inspector.close();
        });
      };
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
    Deno.writeAllSync(
      Deno.stderr,
      new TextEncoder().encode(`Emit ${request.url}\n`),
    );

    const url = toFileUrl(normalizeFilePath(request.url));
    const key = url + ".js";
    if (!emitCache[key]) {
      const { diagnostics, files } = await Deno.emit(url, {
        check,
        compilerOptions: {
          sourceMap: false,
          inlineSources: true,
          inlineSourceMap: true,
          lib: [
            "deno.ns",
            "dom",
            "dom.iterable",
            "esnext",
          ],
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
    Deno.writeAllSync(
      Deno.stderr,
      new TextEncoder().encode(`Serve ${request.url}\n`),
    );

    const path = normalizeFilePath(request.url);
    return serveFile(request, path).then((response) => {
      return request.respond(response);
    }).catch((error) => {
      return request.respond({ body: error.message });
    });
  };

  return function handleRequest(request) {
    if (request.url == "/") {
      return handleIndex(request);
    }

    if (request.url == "/favicon.ico") {
      return handleFavicon(request);
    }

    const isDeno = request
      .headers
      .get("user-agent")
      .toLowerCase()
      .includes("deno");

    const isTest = isTestSpecifier(request.url) || isTestInput(request.url);
    if (isDeno && isTest) {
      return handleProxy(request);
    }

    if (!isDeno && isEmitSpecifier(request.url)) {
      return handleEmit(request);
    }

    return handleFile(request);
  };
}

export const description = "Run tests";
export async function run(options) {
  const args = [];
  if (!options.check) {
    args.push("--no-check");
  }

  if (options.inputs) {
    args.push(...options.inputs);
  }

  // When no browser is provided, we just pass-through to deno.
  if (!options.browser) {
    const process = Deno.run({
      cmd: [
        Deno.execPath(),
        "test",
        ...args,
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
  const handleRequest = createRequestHandler(options);
  (async () => {
    for await (const request of server) {
      handleRequest(request);
    }
  })();

  const browser = await browse({
    ...options,
  });

  const config = await Deno.makeTempFile({
    prefix: "config",
    suffix: ".json",
  });

  await Deno.writeTextFile(
    config,
    JSON.stringify({
      compilerOptions: {
        lib: [
          "deno.ns",
          "dom",
          "dom.iterable",
          "esnext",
        ],
      },
    }),
  );

  const importMap = await Deno.makeTempFile({
    prefix: "import_map-",
    suffix: ".json",
  });

  if (Deno.build.os == "windows") {
    await Deno.writeTextFile(
      importMap,
      JSON.stringify({
        imports: {
          "file:///C:/": `http://localhost:${port}/C:/`,
          "file:///D:/": `http://localhost:${port}/D:/`,
        },
      }),
    );
  } else {
    await Deno.writeTextFile(
      importMap,
      JSON.stringify({
        imports: {
          "file:///": `http://localhost:${port}/`,
        },
      }),
    );
  }

  const tester = Deno.run({
    cmd: [
      Deno.execPath(),
      "test",
      "--reload",
      "--allow-all",
      "--unstable",
      "--config=" + config,
      "--import-map=" + importMap,
      ...args,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await tester.status();

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
    check,
    _: inputs,
  } = parse(argv, {
    boolean: [
      "headless",
      "check",
    ],
    string: [
      "filter",
    ],
    default: {
      "check": true,
    },
  });

  await run({
    browser,
    headless,
    filter,
    check,
    inputs,
  });
}

if (import.meta.main) {
  await main(Deno.args);
}
