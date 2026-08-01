import { ANIMATION_ROUTE_CASES } from "./_routes/cases/animation";
import { BORDER_ROUTE_CASES } from "./_routes/cases/border";
import { BOX_MODEL_ROUTE_CASES } from "./_routes/cases/box-model";
import { EFFECT_ROUTE_CASES } from "./_routes/cases/effects";
import { LAYOUT_ROUTE_CASES } from "./_routes/cases/layout";
import { TYPOGRAPHY_ROUTE_CASES } from "./_routes/cases/typography";
import {
  readPropertyCensus,
  renderRoutes,
  routeDivergences,
  type RouteCase,
} from "./_routes/harness";

/**
 * Every property, on every route it can take, compared against itself.
 *
 * The four `*-path-equivalence` suites test routes for the properties someone
 * thought to test. This one tests them for every property the compiler CLAIMS
 * to handle, because the failure that keeps recurring is not a property whose
 * routes were checked and disagreed — it is a property whose routes were never
 * checked at all, working on the spelling the tests used and silently dead on
 * the spelling a theme uses.
 *
 * So the census is read out of `src/compiler/declarations.ts` itself
 * (`readPropertyCensus`) and the first test below fails when a property in it
 * has no case here. Adding a property to the compiler adds a failing test, and
 * the only way to make it pass is to say what that property renders on every
 * route.
 *
 * A case may declare a `divergenceNote`, which is a claim that the routes are
 * ALLOWED to disagree and a statement of why — React Native cannot express the
 * value on one of them, or the two spellings render identically. A note is
 * reviewed like any other assertion; what it is not is a way to make a failure
 * quiet, because the note has to name the reason and a wrong reason is visible.
 */

const ALL_CASES: readonly RouteCase[] = [
  ...ANIMATION_ROUTE_CASES,
  ...BORDER_ROUTE_CASES,
  ...BOX_MODEL_ROUTE_CASES,
  ...EFFECT_ROUTE_CASES,
  ...LAYOUT_ROUTE_CASES,
  ...TYPOGRAPHY_ROUTE_CASES,
];

const CASES_BY_PROPERTY = new Map(
  ALL_CASES.map((routeCase) => [routeCase.property, routeCase] as const),
);

describe("the census is covered", () => {
  const census = readPropertyCensus();

  test("every property the compiler handles has a route case", () => {
    const uncovered = [...census]
      .filter((property) => !CASES_BY_PROPERTY.has(property))
      .sort();

    expect(uncovered).toStrictEqual([]);
  });

  test("every route case names a property the compiler handles", () => {
    // The other direction, and it catches a different mistake: a case for a
    // property that was renamed or removed asserts nothing while looking like
    // coverage.
    const unknown = [...CASES_BY_PROPERTY.keys()]
      .filter((property) => !census.has(property))
      .sort();

    expect(unknown).toStrictEqual([]);
  });

  test("no property has two cases", () => {
    // A duplicate silently drops one of the two, and the one it drops is
    // whichever came first in the import order.
    const seen = new Set<string>();
    const duplicates = ALL_CASES.map((routeCase) => routeCase.property)
      .filter((property) => {
        const isDuplicate = seen.has(property);
        seen.add(property);
        return isDuplicate;
      })
      .sort();

    expect(duplicates).toStrictEqual([]);
  });
});

describe("every route renders the same style", () => {
  const agreeing = ALL_CASES.filter(
    (routeCase) => routeCase.divergenceNote === undefined,
  );

  // `describe.each`/`test.each` throw on an empty table, which would replace the
  // census failure above — the one that says WHICH properties are missing —
  // with an unrelated one about table shape.
  const runEach = agreeing.length > 0 ? test.each : test.skip.each;

  runEach(agreeing.map((routeCase) => [routeCase.property, routeCase]))(
    "%s",
    (_property, routeCase) => {
      const styles = renderRoutes(routeCase);
      const divergences = routeDivergences(styles);

      // Reported as the whole list rather than route by route, so a failure
      // says which routes disagreed and with what — the shape needed to tell a
      // compile-time fault from a runtime one without re-running anything.
      expect(divergences).toStrictEqual([]);
    },
  );
});

describe("the routes that are allowed to disagree, and why", () => {
  const diverging = ALL_CASES.filter(
    (routeCase) => routeCase.divergenceNote !== undefined,
  );

  const runEach = diverging.length > 0 ? test.each : test.skip.each;

  runEach(diverging.map((routeCase) => [routeCase.property, routeCase]))(
    "%s",
    (_property, routeCase) => {
      const divergences = routeDivergences(renderRoutes(routeCase));

      // A note claims the routes differ. If they have stopped differing the
      // note is stale and the case belongs in the block above — so this fails
      // too, rather than passing quietly on a defect someone has since fixed.
      expect(divergences.length).toBeGreaterThan(0);
    },
  );
});
