/**
 * Every CSS feature this library understands and deliberately does NOT ship to
 * React Native as written — and, for each one, the PROOF that the reason is
 * still true.
 *
 * The rule this file exists to enforce is that a gap in the target is a caveat,
 * never a reason to stop implementing: the compiler parses each feature below
 * in full, and what is disabled is only the final emission of a value React
 * Native cannot take. So the day React Native grows the capability, the work is
 * a one-line change here and at the emitting site, not a feature to write.
 *
 * The danger that makes the file worth its length is that a disabled feature is
 * INVISIBLE. There is no error, no failing build, and on a device it simply
 * does nothing — so a reason recorded in a comment can quietly stop being true
 * and nobody finds out. Every entry therefore carries a `verdict` that is
 * EXECUTED against React Native's own modules rather than asserted:
 *
 *   throws       — React Native raises on the faithful value. Emitting it would
 *                  crash the app at render, so the gate is load-bearing, not
 *                  tidiness. These are the ones that must never regress.
 *   inert-value  — React Native accepts the value and does nothing with it.
 *                  Emitting it is harmless, so the faithful value goes out and
 *                  starts working the day the target implements it.
 *   no-such-key  — the style key is absent from `ReactNativeStyleAttributes`,
 *                  which is the table deciding what reaches native at all. The
 *                  prop is dropped before it leaves JavaScript.
 *
 * If React Native gains one of these, the verdict test FAILS. That failure is
 * the signal to enable the feature, and it is the whole point: nothing else in
 * the system would ever tell us.
 *
 * What this file cannot decide is anything the JavaScript side forwards and the
 * NATIVE side rejects — an elliptical `borderRadius` string, a `fontFamily`
 * array. Those keys are present in the attribute table, so they leave
 * JavaScript intact and only the platform can answer. They are measured on a
 * real device instead; see `frontends/storybook/tests/native/` in the consuming
 * repo, and `contributions/120-react-native-capability-gaps.md` for the filing.
 */

type Processor = (value: unknown) => unknown;

/**
 * A module's default export, narrowed rather than asserted.
 *
 * `jest.requireActual` is typed `any`, so a type assertion here is both
 * unnecessary (it changes nothing) and unsafe (it hides a wrong shape). Landing
 * the result in `unknown` first and narrowing is the only form that is neither.
 */
function readDefaultExport(loaded: unknown, module: string): Processor {
  if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
    const exported = loaded.default;

    if (typeof exported === "function") {
      return exported as Processor;
    }
  }

  throw new Error(`${module} has no callable default export`);
}

const processor = (module: string): Processor =>
  readDefaultExport(jest.requireActual(module), module);

const processTransform = (): Processor =>
  processor("react-native/Libraries/StyleSheet/processTransform");
const processBackgroundImage = (): Processor =>
  processor("react-native/Libraries/StyleSheet/processBackgroundImage");

/** The table React Native consults to decide which style keys reach native. */
const styleAttributes = (): Record<string, unknown> => {
  const loaded: unknown = jest.requireActual(
    "react-native/Libraries/Components/View/ReactNativeStyleAttributes",
  );

  if (typeof loaded !== "object" || loaded === null) {
    throw new Error("ReactNativeStyleAttributes did not load as a module");
  }

  // Interop: the table is the default export under ESM and the module object
  // itself under CommonJS, and which one arrives depends on the transform.
  const table = "default" in loaded ? loaded.default : loaded;

  if (typeof table !== "object" || table === null) {
    throw new Error("ReactNativeStyleAttributes is not an object");
  }

  return { ...table };
};

type Verdict =
  | { readonly kind: "throws"; readonly faithful: () => unknown }
  | { readonly kind: "inert-value"; readonly faithful: () => unknown }
  | { readonly kind: "no-such-key"; readonly key: string };

interface DisabledFeature {
  /** The CSS a developer writes. */
  readonly css: string;
  /** Why React Native cannot take the faithful value, stated as a fact. */
  readonly why: string;
  readonly verdict: Verdict;
}

const DISABLED: readonly DisabledFeature[] = [
  /* -- The transform functions React Native RAISES on ---------------------- */
  {
    css: "transform: skew(10deg, 20deg)",
    why:
      "React Native implements the two axis-specific spellings and not the " +
      "combined one, so the compiler decomposes `skew(x, y)` into `skewX` and " +
      "`skewY` — which is exact, not an approximation. Emitting the `skew` key " +
      "React Native's own error message names would raise instead.",
    verdict: { kind: "throws", faithful: () => [{ skew: "10deg" }] },
  },
  {
    css: "transform: rotate3d(1, 1, 1, 45deg)",
    why:
      "An axis-angle rotation. React Native has only the three Euler " +
      "rotations, so an arbitrary axis has no representation — the compiler " +
      "maps the axis-aligned cases onto `rotateX`/`rotateY`/`rotateZ` and " +
      "warns about the rest rather than shipping a key that raises.",
    verdict: {
      kind: "throws",
      faithful: () => [{ rotate3d: "1 1 1 45deg" }],
    },
  },
  {
    css: "transform: scaleZ(2)",
    why:
      "React Native has no depth scale. The function is parsed and dropped " +
      "with a warning; the sibling transforms in the same list survive.",
    verdict: { kind: "throws", faithful: () => [{ scaleZ: 2 }] },
  },
  {
    css: "transform: translateZ(5px)",
    why:
      "React Native has no depth translation, for the same reason `scaleZ` " +
      "has no scale: the transform list is 2D with a perspective escape.",
    verdict: { kind: "throws", faithful: () => [{ translateZ: 5 }] },
  },
  {
    css: "transform: matrix(1, 0, 0, 1, 10, 20)",
    why:
      "CSS's 2D matrix carries six values; React Native accepts a 3x3 or a " +
      "4x4 and raises on anything else. The compiler expands the six into the " +
      "nine, so the declaration renders — the disabled thing is the six-value " +
      "form reaching React Native unchanged.",
    verdict: {
      kind: "throws",
      faithful: () => [{ matrix: [1, 0, 0, 1, 10, 20] }],
    },
  },

  /* -- The gradients React Native accepts and ignores ---------------------- */
  {
    css: "background-image: conic-gradient(red, blue)",
    why:
      "React Native's background-image parser knows the linear and radial " +
      "families only, and answers an empty list for the rest. Empty is inert " +
      "rather than fatal, so the faithful value is emitted and the day the " +
      "parser learns the function it starts painting with no change here.",
    verdict: {
      kind: "inert-value",
      faithful: () => "conic-gradient(red, blue)",
    },
  },
  {
    css: "background-image: repeating-linear-gradient(45deg, red, blue 10px)",
    why:
      "The repeating families are the same case as the conic one: parsed by " +
      "CSS, unknown to React Native's parser, and answered with an empty list.",
    verdict: {
      kind: "inert-value",
      faithful: () => "repeating-linear-gradient(45deg, red, blue 10px)",
    },
  },

  /* -- The style keys React Native does not forward at all ----------------- */
  {
    css: "visibility: hidden",
    why:
      "React Native has no `visibility` key, so the faithful value is emitted " +
      "beside the approximation that actually hides the element — `opacity: 0` " +
      "AND `pointerEvents: 'none'`, because opacity alone leaves a hidden " +
      "control taking taps.",
    verdict: { kind: "no-such-key", key: "visibility" },
  },
  {
    css: "border-top-style: dashed",
    why:
      "React Native carries ONE `borderStyle` for the whole box. Four edges " +
      "that disagree have nowhere to go, so the per-edge CSS names are emitted " +
      "and left inert — collapsing them onto one edge's style would be " +
      "silently wrong about the other three, which is worse than inert.",
    verdict: { kind: "no-such-key", key: "borderTopStyle" },
  },
];

/* -------------------------------------------------------------------------
 * The verdicts, executed
 * ---------------------------------------------------------------------- */

test.each(DISABLED.filter((entry) => entry.verdict.kind === "throws"))(
  "React Native still RAISES on the faithful value for `$css`",
  ({ verdict }) => {
    // The raise is what makes the GATE load-bearing: remove the gate and the
    // app crashes at render, rather than merely rendering the declaration
    // wrongly. If this ever stops throwing, React Native has grown the
    // capability and the feature should be enabled.
    const faithful = (verdict as Extract<Verdict, { kind: "throws" }>).faithful;

    expect(() => processTransform()(faithful())).toThrow();
  },
);

test.each(DISABLED.filter((entry) => entry.verdict.kind === "inert-value"))(
  "React Native still answers NOTHING for the faithful value of `$css`",
  ({ verdict }) => {
    // Inert, not fatal — which is precisely why the faithful value is shipped
    // rather than dropped. A non-empty answer here means the target learned
    // the function and the warning that accompanies it should come off.
    const faithful = (verdict as Extract<Verdict, { kind: "inert-value" }>)
      .faithful;

    expect(processBackgroundImage()(faithful())).toStrictEqual([]);
  },
);

test.each(DISABLED.filter((entry) => entry.verdict.kind === "no-such-key"))(
  "React Native still has no style key for `$css`",
  ({ verdict }) => {
    const { key } = verdict as Extract<Verdict, { kind: "no-such-key" }>;

    // `ReactNativeStyleAttributes` is the table that decides what crosses into
    // native. A key absent from it is dropped inside JavaScript, so emitting it
    // costs one dead entry in a style object and nothing else.
    expect(styleAttributes()[key]).toBeUndefined();
  },
);

test("the census covers every verdict kind, so none is silently unexercised", () => {
  // `test.each` over an empty array passes vacuously, so a kind losing its last
  // entry would take its assertions out of the suite without failing anything.
  const kinds = new Set(DISABLED.map((entry) => entry.verdict.kind));

  expect([...kinds].toSorted()).toStrictEqual([
    "inert-value",
    "no-such-key",
    "throws",
  ]);
});

test("every entry states a reason, because an unexplained gate is a bug in waiting", () => {
  for (const entry of DISABLED) {
    expect(entry.why.length).toBeGreaterThan(80);
  }
});
