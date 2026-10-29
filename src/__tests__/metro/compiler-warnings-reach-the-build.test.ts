// A declaration the compiler drops is reported where a developer reads a build: the terminal running Metro
import { join } from "path";

import type { JsTransformOptions } from "metro-transform-worker";

import { compile } from "../../compiler";
import { transform } from "../../metro/metro-transformer";

jest.mock("@expo/metro-config", () => ({
  unstable_transformerPath: require.resolve("./_transform-worker"),
}));

type TransformerConfig = Parameters<typeof transform>[0];

const css = `.a { float: left; }`;

afterEach(() => {
  jest.restoreAllMocks();
});

test("the compiler records the dropped declaration", () => {
  expect(compile(css).warnings()).toStrictEqual({ properties: ["float"] });
});

test("the transformer Metro runs for a native stylesheet reports it", async () => {
  const written: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((argument) => String(argument)).join(" "));
    });
  }

  await transform(
    {} as TransformerConfig,
    process.cwd(),
    join(process.cwd(), "global.css"),
    Buffer.from(css),
    { type: "module", platform: "ios" } as JsTransformOptions,
  );

  expect(written.join("\n")).toContain("float");
});
