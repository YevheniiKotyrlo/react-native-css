import { generateHash } from "../../native/react/rules";
import { family, weakFamily } from "../../native/reactivity";

/**
 * `family` and `weakFamily` promise one factory call per key, and cached on the result being
 * truthy. A factory that legitimately returns `0`, `""` or `false` was therefore re-run on every
 * lookup, and its key never settled on a value.
 *
 * `hashKeyFamily` in `native/react/rules.ts` is such a factory: it hands out `hashKeyCount++`, so
 * the first weak key ever hashed is assigned `0` and is the one key that never caches. Its hash
 * changes between lookups, which splits every cache keyed on that hash.
 */

test("weakFamily calls its factory once per key when the result is falsy", () => {
  let calls = 0;
  const numbers = weakFamily<object, number>(() => calls++);
  const key = {};

  expect(numbers(key)).toBe(0);
  expect(numbers(key)).toBe(0);
  expect(calls).toBe(1);
});

test("family calls its factory once per key when the result is falsy", () => {
  let calls = 0;
  const numbers = family<string, number>(() => calls++);

  expect(numbers("key")).toBe(0);
  expect(numbers("key")).toBe(0);
  expect(calls).toBe(1);
});

test("a weak key hashes to the same value on every lookup", () => {
  // The first key this module hashes is the one assigned `0`, so it is the one that exposes the
  // miss. Nothing else in this file hashes, which is what keeps it first.
  const key = {};

  expect(generateHash([key])).toBe(generateHash([key]));
});
