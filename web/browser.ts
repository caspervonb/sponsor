export type BrowserIdentifier = "chrome" | "firefox";

export interface BrowseOptions {
  url?: string;
  browser: BrowserIdentifier;
  browserPath?: string;
  browserArgs?: string[];
  headless?: boolean;
}

export async function open(url: string) {
  const cmds = {
    windows: "explorer",
    darwin: "open",
    linux: "xdg-open",
  };

  const process = Deno.run({ cmd: [cmds[Deno.build.os], url] });
  await process.status();

  process.close();
}

export function browse(options: BrowseOptions): Deno.Process {
  return Deno.run({
    cmd: [
      browserPath(options),
      ...browserArgs(options),
    ],
    stdout: "null",
    stderr: "null",
  });
}

function browserPath(options: BrowseOptions): string {
  switch (options.browser) {
    case "chrome":
      return chromePath(options);

    case "firefox":
      return firefoxPath(options);
  }
}

function browserArgs(options: BrowseOptions): string[] {
  switch (options.browser) {
    case "chrome":
      return chromeArgs(options);

    case "firefox":
      return firefoxArgs(options);
  }
}

function chromePath(options: BrowseOptions): string {
  if (options.browserPath) {
    return options.browserPath;
  }

  switch (Deno.build.os) {
    case "darwin":
      return "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome";

    case "linux":
      return "/usr/bin/google-chrome";

    case "windows":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
}

function chromeArgs(options: BrowseOptions): string[] {
  const args = [];

  args.push(
    "--disable-features=TranslateUI",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-background-networking",
    "--disable-sync",
    "--metrics-recording-only",
    "--disable-default-apps",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--force-fieldtrials=*BackgroundTracing/default/",
  );

  if (options.headless) {
    args.push(
      "--headless",
      "--disable-gpu",
    );
  }

  args.push("--remote-debugging-port=9292");

  if (options.url) {
    args.push(options.url);
  }

  return args;
}

function firefoxPath(options: BrowseOptions): string {
  if (options.browserPath) {
    return options.browserPath;
  }

  switch (Deno.build.os) {
    case "darwin":
      return "/Applications/Firefox.app/Contents/MacOS/firefox";

    case "linux":
      return "/usr/bin/firefox";

    case "windows":
      return "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
  }
}

function firefoxArgs(options: BrowseOptions): string[] {
  const args = [];

  if (options.headless) {
    args.push(
      "--headless",
    );
  }

  args.push("--remote-debugging-port=9292");

  if (options.url) {
    args.push(options.url);
  }

  return args;
}
