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
