/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  ClassicComponentClass,
  ComponentClass,
  ComponentProps,
  ComponentType,
  ForwardRefExoticComponent,
  FunctionComponent,
  ReactElement,
} from "react";
import type {
  ColorSchemeName,
  ImageStyle,
  TextStyle,
  ViewStyle,
} from "react-native";

import type { DotNotation, ResolveDotPath } from "react-native-css/utilities";

/********************************     API      ********************************/

export type StyledReactElement<
  C extends ReactComponent,
  M extends StyledConfiguration<C>,
> = ReactElement<
  ComponentProps<C> & {
    [K in keyof M as K extends string
      ? M[K] extends undefined | false
        ? never
        : M[K] extends true | string | object
          ? K
          : never
      : never]?: string;
  }
>;

export type StyledProps<P, M extends StyledConfiguration<any>> = P & {
  [K in keyof M as K extends string
    ? M[K] extends undefined | false
      ? never
      : M[K] extends true | string | object
        ? K
        : never
    : never]?: string;
};

export type Styled = <
  const C extends ReactComponent,
  const M extends StyledConfiguration<C>,
>(
  component: C,
  mapping: M & StyledConfiguration<C>,
  options?: StyledOptions,
) => StyledComponent<C, M>;

type StyledComponent<
  C extends ReactComponent,
  M extends StyledConfiguration<C>,
> = ComponentType<
  ComponentProps<C> & {
    [K in keyof M as K extends string
      ? M[K] extends undefined | false
        ? never
        : M[K] extends true | string | object
          ? K
          : never
      : never]?: string;
  }
>;

export type StyledConfiguration<
  C extends ReactComponent,
  K extends string = string,
> = Record<
  K,
  | boolean
  | ComponentPropsDotNotation<C>
  | StyledConfigurationObject<C, ComponentPropsDotNotation<C> | false>
>;

interface StyledConfigurationObject<
  C extends ReactComponent,
  T extends ComponentPropsDotNotation<C> | false,
> {
  target: T;
  nativeStyleMapping?: T extends false
    ? NativeStyleMapping<string, ComponentProps<C>>
    : NativeStyleMapping<
        ResolveDotPath<T, ComponentProps<C>>,
        ComponentProps<C>
      >;
  /** @deprecated Please use nativeStyleMapping */
  nativeStyleToProp?: NativeStyleMapping<
    ResolveDotPath<T, ComponentProps<C>>,
    ComponentProps<C>
  >;
  /**
   * Apply CSS *inherited* text properties published by ancestors to this
   * component's style target.
   *
   * CSS inherits `color`, `font-*`, `letter-spacing`, `line-height`,
   * `text-align` and `text-transform`; React Native does not, across a
   * `<View>` → `<Text>` boundary. Setting this makes a component receive them,
   * so `<View className="text-red-500"><Text /></View>` renders red on native
   * as it already does on web.
   *
   * Only components that RENDER text should set it — `components/Text` does.
   * A component with a `<Text>` ancestor is left alone regardless, because
   * React Native's own Text-in-Text inheritance already covers that case (and
   * covers it better: it carries `style`-prop values, which never appear as
   * CSS variables).
   *
   * @default false
   */
  inheritsTextStyle?: boolean;
  /**
   * Announce to descendants that a text-rendering ancestor no longer applies.
   *
   * React Native's own `View` resets `TextAncestorContext` to `false`, because
   * a View inside a Text starts a fresh box that native Text -> Text
   * inheritance does not cross. A component that behaves the same way sets
   * this, so the CSS inheritance path takes over again below it instead of
   * deferring to an ancestor that can no longer reach the descendant.
   *
   * @default false
   */
  resetsTextAncestor?: boolean;
}

type NativeStyleMapping<T, S> = T extends object
  ? {
      [K in keyof T as K extends string ? K : never]: true | DotNotation<S>;
    } & {
      fill?: true | DotNotation<S>;
      stroke?: true | DotNotation<S>;
    }
  : Record<string, true | DotNotation<S>>;

export interface StyledOptions {
  passThrough?: boolean;
}

/***************************     React Helpers      ***************************/

export type ReactComponent<P = any> =
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  | ClassicComponentClass<P>
  | ComponentClass<P>
  | FunctionComponent<P>
  | ForwardRefExoticComponent<P>;

export type ComponentPropsDotNotation<C extends ReactComponent> = DotNotation<
  ComponentProps<C>
>;

/********************************    Styles    ********************************/

export type InlineStyleRecord = Record<string, unknown> & {
  // Used to differentiate between InlineStyleRecord and StyleRule
  s?: never;
};

export type InlineStyle =
  | InlineStyleRecord
  | undefined
  | null
  | (Record<string, unknown> | undefined | null)[]
  | (() => unknown);

/*********************************    Misc    *********************************/

export type Props = Record<string, any> | undefined | null;
export type Callback = () => void;
export type RNStyle = ViewStyle & TextStyle & ImageStyle;

/********************************    Globals    ********************************/

export interface ColorScheme {
  get: () => ColorSchemeName;
  set: (value: ColorSchemeName) => void;
}
