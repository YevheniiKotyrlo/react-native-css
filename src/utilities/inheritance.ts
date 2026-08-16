/**
 * The wire format between the compiler and the native runtime for CSS
 * *inherited* properties.
 *
 * The compiler publishes each inherited property an element declares as a CSS
 * variable under this prefix (`StylesheetBuilder.addDescriptor`); the native
 * runtime reads them back out of the inherited `VariableContext` and applies
 * them to components that opt in via `inheritsTextStyle`
 * (`useNativeCss`).
 *
 * It lives in `utilities` rather than in either side because both need it and
 * neither may import the other: the compiler pulls in lightningcss, which must
 * never reach an app bundle, so a native module importing from `compiler/`
 * would be a build-time dependency leaking into runtime.
 */
export const INHERIT_VARIABLE_PREFIX = "__rn-css-inherit-";

/**
 * The channel every `color` declaration publishes and every `currentcolor`
 * reads back.
 *
 * `color` is an inherited property like any other, so it needs no channel of
 * its own — it is `INHERIT_VARIABLE_PREFIX` applied to `color`, named here
 * because three separate places have to agree on it: the compiler emits the
 * read, the runtime's `CURRENT_COLOR` is that read, and the root registry seeds
 * the platform label colour behind it.
 */
export const INHERITED_COLOR_VARIABLE = `${INHERIT_VARIABLE_PREFIX}color`;

/**
 * The style function that reads a custom property from the INHERITED context
 * alone, skipping the element's own declarations.
 *
 * `var()` cascades — an element's own declaration of a name shadows the one it
 * would inherit (css-variables-1 §2), which is what a custom property means and
 * what `border-color: currentcolor` needs, since the element's own `color`
 * publishes into the channel it reads. `inherit` is the other half of that
 * pair: it is defined as the value the element WOULD have inherited, so the
 * element's own declaration is precisely the one it must not see. The two are
 * different reads of the same name and neither is expressible as the other, so
 * `inherit` gets a function of its own rather than a second variable to point
 * at — a second name would sit in the element's own scope exactly as the first
 * does, and be shadowed exactly as the first is.
 */
export const INHERITED_VAR_FUNCTION = "inheritedVar";
