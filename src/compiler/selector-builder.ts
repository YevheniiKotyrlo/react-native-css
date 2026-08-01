import type {
  AttrOperation,
  Selector,
  SelectorComponent,
  SelectorList,
} from "lightningcss";

import { Specificity } from "../utilities";
import type {
  AttributeQuery,
  AttrSelectorOperator,
  CompilerOptions,
  ContainerQuery,
  MediaCondition,
  PseudoClassesQuery,
  SpecificityArray,
} from "./compiler.types";

interface ReactNativeClassNameSelector {
  type: "className";
  specificity: SpecificityArray;
  className: string;
  mediaQuery?: MediaCondition[];
  containerQuery?: ContainerQuery[];
  pseudoClassesQuery?: PseudoClassesQuery;
  attributeQuery?: AttributeQuery[];
  pseudoElementQuery?: string[];
}

interface ReactNativeGlobalSelector {
  type: "rootVariables" | "universalVariables";
}

type PartialSelector = Partial<ReactNativeClassNameSelector> & {
  type: "className";
  specificity: SpecificityArray;
};

type AttributeComponent = Extract<SelectorComponent, { type: "attribute" }>;

const containerQueryMap = new WeakMap<WeakKey, ContainerQuery[]>();
const attributeQueryMap = new WeakMap<WeakKey, AttributeQuery[]>();
const mediaQueryMap = new WeakMap<WeakKey, MediaCondition[]>();
const pseudoClassesQueryMap = new WeakMap<WeakKey, PseudoClassesQuery>();

type ContainerQueryWithSpecificity = ContainerQuery & {
  specificity: SpecificityArray;
  m?: MediaCondition;
};

/**
 * One argument of an `:is()` / `:where()`, split into the part that describes
 * ANCESTORS and the part that describes the element itself.
 *
 * The split is the whole point: `:where(.b *)` puts `.b` on an ancestor, while
 * `:where(.b)` puts it on the subject. Treating every class inside the
 * pseudo-class as an ancestor — which is what a single flat pass does — turns a
 * compound selector into a descendant one, so `.a:where(.b)` stops matching the
 * element carrying both classes and starts matching `.a` nested inside `.b`.
 */
interface IsWhereBranch {
  /** Contributed to the rule only by `:is()`; `:where()` adds nothing. */
  specificity: SpecificityArray;
  /** Ancestor compounds. Conjunction — every one must be present. */
  containerQueries: ContainerQuery[];
  /** Classes the subject element must carry. */
  classNames: string[];
  /** Attribute / prop conditions on the subject element. */
  attributes: AttributeQuery[];
  /** Interaction state of the subject element. */
  pseudoClasses?: PseudoClassesQuery;
  /** Conditions that are global rather than per-element, such as `:dir()`. */
  media: MediaCondition[];
}

/** Every condition of a `:not()` argument, before it is negated. */
interface NegatableCompound {
  queries: AttributeQuery[];
  specificity: SpecificityArray;
}

export function getClassNameSelectors(
  selectors: SelectorList,
  options: CompilerOptions = {},
) {
  if (!selectors.length) {
    return [];
  }

  return selectors.flatMap(
    (selector): (ReactNativeGlobalSelector | PartialSelector)[] => {
      const root: PartialSelector = {
        type: "className",
        specificity: [],
      };

      const specificity: SpecificityArray = [0];

      if (isRootVariableSelector(selector)) {
        return [{ type: "rootVariables" }];
      } else if (isUniversalSelector(selector)) {
        return [{ type: "universalVariables" }];
      } else {
        return (
          parseComponents(
            selector.reverse(),
            options,
            root,
            root,
            specificity,
          ) ?? []
        );
      }
    },
  );
}

function parseComponents(
  [component, ...rest]: Selector,
  options: CompilerOptions,
  root: PartialSelector,
  ref: PartialSelector | ContainerQuery,
  specificity: SpecificityArray,
): PartialSelector[] | null {
  if (!component || Array.isArray(component.type)) {
    // Merge the specificity with the root specificity
    for (let i = 0; i < specificity.length; i++) {
      const value = specificity[i];
      if (value !== undefined) {
        root.specificity[i] = (root.specificity[i] ?? 0) + value;
      }
    }

    // Return the root
    return [root];
  }

  switch (component.type) {
    case "namespace": // @namespace
    case "universal": // * - universal selector
      return null;
    case "id": {
      // #id — the same question `[id="…"]` already compiles to, because React
      // Native delivers `id` as an ordinary prop.
      if (isContainerQuery(ref)) {
        // A container is registered under the CLASS NAME that declares it, so
        // an ancestor addressed by id has nothing to register under. Emitting
        // the condition anyway would leave it unenforced, matching every
        // descendant instead of none.
        return [];
      }

      getAttributeQuery(ref).push(["a", "id", "=", component.name]);
      specificity[Specificity.Id] = (specificity[Specificity.Id] ?? 0) + 1;
      return parseComponents(rest, options, root, ref, specificity);
    }
    case "type": {
      // div, span
      if (
        component.name === options.selectorPrefix ||
        component.name === "html"
      ) {
        return parseComponents(rest, options, root, ref, specificity);
      } else {
        return null;
      }
    }
    case "nesting":
      // &
      // The SelectorList should be flattened, so we can skip these
      return parseComponents(rest, options, root, ref, specificity);
    case "combinator": {
      // We only support the descendant combinator
      if (component.value === "descendant") {
        // Switch to now parsing a container query
        ref = {};
        return parseComponents(rest, options, root, ref, specificity);
      }

      return [];
    }
    case "pseudo-element": {
      switch (component.kind) {
        case "selection":
        case "placeholder": {
          specificity[Specificity.PseudoElements] =
            (specificity[Specificity.PseudoElements] ?? 0) + 1;
          root.pseudoElementQuery ??= [];
          root.pseudoElementQuery.push(component.kind);
          return parseComponents(rest, options, root, ref, specificity);
        }
        default: {
          return [];
        }
      }
    }
    case "pseudo-class": {
      switch (component.kind) {
        case "hover": {
          getPseudoClassesQuery(ref).h = 1;
          specificity[Specificity.PseudoClass] =
            (specificity[Specificity.PseudoClass] ?? 0) + 1;
          return parseComponents(rest, options, root, ref, specificity);
        }
        case "active": {
          getPseudoClassesQuery(ref).a = 1;
          specificity[Specificity.PseudoClass] =
            (specificity[Specificity.PseudoClass] ?? 0) + 1;
          return parseComponents(rest, options, root, ref, specificity);
        }
        case "focus": {
          getPseudoClassesQuery(ref).f = 1;
          specificity[Specificity.PseudoClass] =
            (specificity[Specificity.PseudoClass] ?? 0) + 1;
          return parseComponents(rest, options, root, ref, specificity);
        }
        case "not": {
          if (isContainerQuery(ref)) {
            // An ancestor cannot carry it — see ANCESTOR_PROP_STATES.
            return [];
          }

          const negation = negateSelectors(component.selectors);

          if (!negation) {
            // Either an argument has no negated form, or an argument matches
            // everything — `:not(*)` — which makes the rule unreachable.
            return [];
          }

          getAttributeQuery(ref).push(...negation.queries);
          mergeSpecificity(specificity, negation.specificity);
          return parseComponents(rest, options, root, ref, specificity);
        }
        case "where":
        case "is": {
          const branches = isContainerQuery(ref)
            ? // The pseudo-class sits in a compound that is itself an ancestor
              // of the subject, so the whole argument describes that ancestor
              // and a container query is the only shape that can carry it.
              component.selectors.flatMap((selector) => {
                return ancestorBranches(component.kind, selector);
              })
            : component.selectors.flatMap((selector) => {
                return parseIsWhereSelector(component.kind, selector) ?? [];
              });

          // Remember we're looping in reverse order,
          // So `rest` contains the selectors BEFORE this one
          const parents = parseComponents(
            rest,
            options,
            root,
            ref,
            specificity,
          );

          if (!parents) {
            return null;
          }

          // Each argument is an alternative, so every parent fans out into one
          // selector per argument.
          return parents.flatMap((parent) => {
            return branches.map((branch) => {
              return applyIsWhereBranch(
                parent,
                branch,
                component.kind === "is",
              );
            });
          });
        }
        default: {
          const query = formStatePropQuery(component.kind);

          if (!query) {
            return [];
          }

          if (
            isContainerQuery(ref) &&
            !ANCESTOR_PROP_STATES.has(component.kind)
          ) {
            return [];
          }

          getAttributeQuery(ref).push(query);
          specificity[Specificity.PseudoClass] =
            (specificity[Specificity.PseudoClass] ?? 0) + 1;
          return parseComponents(rest, options, root, ref, specificity);
        }
      }
    }
    case "attribute": {
      if (component.name === "dir") {
        if (!component.operation) {
          return [];
        }
        const operator = operatorMap[component.operation.operator];

        if (operator !== "=") {
          return [];
        }

        getMediaQuery(ref).push([operator, "dir", component.operation.value]);
        return parseComponents(rest, options, root, ref, specificity);
      } else {
        getAttributeQuery(ref).push(attributeQueryFor(component));
        specificity[Specificity.ClassName] =
          (specificity[Specificity.ClassName] ?? 0) + 1;
        return parseComponents(rest, options, root, ref, specificity);
      }
    }
    case "class": {
      if (component.name === options.selectorPrefix) {
        // Skip this one
        return parseComponents(rest, options, root, ref, specificity);
      } else if (!isContainerQuery(ref) && !ref.className) {
        ref.className = component.name;
        specificity[Specificity.ClassName] =
          (specificity[Specificity.ClassName] ?? 0) + 1;
        return parseComponents(rest, options, root, ref, specificity);
      } else if (!isContainerQuery(ref)) {
        // Only the first className is used, the rest are attribute queries.
        //
        // `~=` — Selectors 4 §6.1 defines a class selector as `[class~=name]`,
        // a whitespace-separated TOKEN of the attribute. A substring test
        // (`*=`) makes `.fp-a.fp-b` match `className="prefix-fp-a-suffix fp-b"`,
        // and it is the same question the `:is()` / `:not()` / `:where()` path
        // already answers with `~=` a few functions down, so the two paths gave
        // one selector two meanings.
        getAttributeQuery(ref).unshift([
          "a",
          "className",
          "~=",
          component.name,
        ]);
      } else {
        let containerQueries = containerQueryMap.get(root);
        if (!containerQueries) {
          containerQueries = [];
          root.containerQuery = containerQueries;
          containerQueryMap.set(root, containerQueries);
        }
        if (!ref.n) {
          containerQueries.unshift(ref);
        }

        ref.n = ref.n ? `${ref.n}.${component.name}` : `g:${component.name}`;
      }

      specificity[Specificity.ClassName] =
        (specificity[Specificity.ClassName] ?? 0) + 1;
      return parseComponents(rest, options, root, ref, specificity);
    }
  }
}

/**
 * Fold one `:is()` / `:where()` argument into the selector it qualifies.
 *
 * The parent is cloned rather than mutated because every argument is a separate
 * alternative — they must not see each other's conditions.
 */
function applyIsWhereBranch(
  parent: PartialSelector,
  branch: IsWhereBranch,
  countSpecificity: boolean,
): PartialSelector {
  const next: PartialSelector = {
    ...parent,
    specificity: [...parent.specificity],
  };

  if (countSpecificity) {
    mergeSpecificity(next.specificity, branch.specificity);
  }

  const containerQueries = [
    ...(parent.containerQuery ?? []),
    ...branch.containerQueries,
  ];

  const attributeQuery = [
    ...(parent.attributeQuery ?? []),
    // A class selector matches a whitespace-separated TOKEN of the class
    // attribute, which is what `~=` tests.
    ...branch.classNames.map((name): AttributeQuery => {
      return ["a", "className", "~=", name];
    }),
    ...branch.attributes,
  ];

  if (attributeQuery.length) {
    next.attributeQuery = attributeQuery;
  }

  if (branch.pseudoClasses) {
    next.pseudoClassesQuery = {
      ...parent.pseudoClassesQuery,
      ...branch.pseudoClasses,
    };
  }

  if (containerQueries.length) {
    next.containerQuery = containerQueries;
  }

  if (branch.media.length) {
    next.mediaQuery = parent.mediaQuery
      ? [["&", [...parent.mediaQuery, ...branch.media]]]
      : branch.media;
  }

  return next;
}

/**
 * Turn one `:is()` / `:where()` argument that describes an ANCESTOR into
 * container queries.
 *
 * There is no subject here to hang a prop condition on, so anything that is not
 * expressible as a container query takes the rule with it.
 */
function ancestorBranches(
  type: "is" | "where",
  selector: Selector,
): IsWhereBranch[] {
  return parseIsWhereComponents(type, selector)?.map(toAncestorBranch) ?? [];
}

function toAncestorBranch(query: ContainerQueryWithSpecificity): IsWhereBranch {
  const { specificity, m, ...containerQuery } = query;
  const branch = createBranch();

  branch.specificity = specificity;

  if (containerQuery.a || containerQuery.p || containerQuery.n !== undefined) {
    branch.containerQueries.push(containerQuery);
  }

  // `:dir()` is not a property of the ancestor — direction is global — so it is
  // hoisted to the rule rather than left on the container.
  if (m) {
    branch.media.push(m);
  }

  return branch;
}

/**
 * Split one `:is()` / `:where()` argument at its LAST descendant combinator.
 *
 * Everything before that combinator qualifies an ancestor; everything after it
 * qualifies the subject — the element the whole selector is about. A trailing
 * `*` is therefore the "ancestor" form (`:where(.b *)`), and its absence is the
 * compound form (`:where(.b)`).
 */
function parseIsWhereSelector(
  type: "is" | "where",
  selector: Selector,
): IsWhereBranch[] | null {
  let lastDescendant = -1;

  for (const [index, component] of selector.entries()) {
    if (component.type !== "combinator") {
      continue;
    }
    // We only support the descendant combinator
    if (component.value !== "descendant") {
      return null;
    }
    lastDescendant = index;
  }

  const ancestorComponents = selector.slice(0, Math.max(lastDescendant, 0));
  const subjectComponents = selector.slice(lastDescendant + 1);

  // `*` only means something as the subject: an ancestor has to name a class,
  // because a container is registered under the class that declares it.
  if (ancestorComponents.some((component) => component.type === "universal")) {
    return null;
  }

  const subjects = parseIsWhereCompound(type, subjectComponents);

  if (!subjects) {
    return null;
  }

  if (!ancestorComponents.length) {
    return subjects;
  }

  const ancestorQueries = parseIsWhereComponents(type, ancestorComponents);

  if (!ancestorQueries) {
    return null;
  }

  return ancestorQueries.flatMap((ancestorQuery) => {
    const ancestor = toAncestorBranch(ancestorQuery);
    return subjects.map((subject) => mergeBranches(ancestor, subject));
  });
}

/**
 * Parse the subject compound of an `:is()` / `:where()` argument — every
 * condition here is a condition on the element itself.
 *
 * Returns a list because a nested `:is()` / `:where()` fans out: each of its
 * arguments crosses with everything parsed so far.
 */
function parseIsWhereCompound(
  type: "is" | "where",
  components: SelectorComponent[],
): IsWhereBranch[] | null {
  let branches: IsWhereBranch[] = [createBranch()];

  for (const component of components) {
    if (Array.isArray(component.type)) {
      return null;
    }

    switch (component.type) {
      case "universal": {
        // Matches anything, so it adds no condition.
        break;
      }
      case "class": {
        for (const branch of branches) {
          branch.classNames.push(component.name);
          countIn(type, branch, Specificity.ClassName);
        }
        break;
      }
      case "id": {
        for (const branch of branches) {
          branch.attributes.push(["a", "id", "=", component.name]);
          countIn(type, branch, Specificity.Id);
        }
        break;
      }
      case "attribute": {
        if (component.name === "dir") {
          // `[dir]` is a media condition rather than a prop, and only the top
          // level of a selector recognises the attribute form.
          return null;
        }

        const query = attributeQueryFor(component);

        for (const branch of branches) {
          branch.attributes.push(query);
          countIn(type, branch, Specificity.ClassName);
        }
        break;
      }
      case "pseudo-class": {
        switch (component.kind) {
          case "hover": {
            for (const branch of branches) {
              (branch.pseudoClasses ??= {}).h = 1;
            }
            break;
          }
          case "active": {
            for (const branch of branches) {
              (branch.pseudoClasses ??= {}).a = 1;
            }
            break;
          }
          case "focus": {
            for (const branch of branches) {
              (branch.pseudoClasses ??= {}).f = 1;
            }
            break;
          }
          case "dir": {
            for (const branch of branches) {
              branch.media.push(["=", "dir", component.direction]);
            }
            break;
          }
          case "not": {
            const negation = negateSelectors(component.selectors);

            if (!negation) {
              return null;
            }

            for (const branch of branches) {
              branch.attributes.push(...negation.queries);
              if (type === "is") {
                mergeSpecificity(branch.specificity, negation.specificity);
              }
            }
            break;
          }
          case "where":
          case "is": {
            // The nested pseudo-class keeps the OUTER type, so a `:where()`
            // inside an `:is()` still contributes the enclosing specificity.
            const nested = component.selectors.flatMap((selector) => {
              return parseIsWhereSelector(type, selector) ?? [];
            });

            if (!nested.length) {
              return null;
            }

            branches = branches.flatMap((branch) => {
              return nested.map((inner) => mergeBranches(branch, inner));
            });
            break;
          }
          default: {
            const query = formStatePropQuery(component.kind);

            if (!query) {
              return null;
            }

            for (const branch of branches) {
              branch.attributes.push(query);
            }
            break;
          }
        }
        break;
      }
      default: {
        // type / namespace / nesting / pseudo-element / combinator
        return null;
      }
    }
  }

  return branches;
}

/**
 * Parse the ANCESTOR half of an `:is()` / `:where()` argument into container
 * queries. Each entry of the result is an ALTERNATIVE, produced by a nested
 * pseudo-class with several arguments.
 */
function parseIsWhereComponents(
  type: "is" | "where",
  selector: SelectorComponent[],
  index = 0,
  queries?: ContainerQueryWithSpecificity[],
): ContainerQueryWithSpecificity[] | null {
  const component = selector[index];

  if (!component || Array.isArray(component.type)) {
    return queries ?? [];
  }

  switch (component.type) {
    // These cannot describe an ancestor container
    case "id": // #id — a container is keyed by the class that declares it
    case "namespace": // @namespace
    case "type": // div, span
    case "nesting": // &
    case "pseudo-element": // ::selection, ::placeholder, etc
      return null;
    case "universal": {
      // `parseIsWhereSelector` has already taken the subject compound off the
      // end, so a `*` can only arrive here from a NESTED `:is()` / `:where()`
      // that still carries its own trailing `*` — `:where(:where(.dark *) .b *)`.
      if (index !== selector.length - 1) {
        // We only accept it in the last position
        return null;
      }

      // This was the only component, so we return the ref
      if (selector.length === 1) {
        return queries ?? [{ specificity: [] }];
      }

      const previous = selector[index - 1];

      // If the previous component is not a descendant combinator,
      if (
        !previous ||
        previous.type !== "combinator" ||
        previous.value !== "descendant"
      ) {
        return null;
      }

      return parseIsWhereComponents(type, selector, index + 1, queries);
    }
    case "combinator": {
      // We only support the descendant combinator
      if (component.value === "descendant") {
        // Each "block" is a new container query
        const children = parseIsWhereComponents(type, selector, index + 1);
        return children && queries ? [...queries, ...children] : children;
      }
      return null;
    }
    case "pseudo-class": {
      switch (component.kind) {
        case "dir": {
          queries ??= [{ specificity: [] }];
          queries.forEach((query) => {
            getMediaQuery(query).push(["=", "dir", component.direction]);
          });
          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
        case "hover": {
          queries ??= [{ specificity: [] }];
          queries.forEach((query) => {
            getPseudoClassesQuery(query).h = 1;
          });
          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
        case "active": {
          queries ??= [{ specificity: [] }];
          queries.forEach((query) => {
            getPseudoClassesQuery(query).a = 1;
          });
          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
        case "focus": {
          queries ??= [{ specificity: [] }];
          queries.forEach((query) => {
            getPseudoClassesQuery(query).f = 1;
          });
          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
        case "where":
        case "is": {
          // Now get the selectors inside the `is` or `where` pseudo-class
          queries = component.selectors.flatMap((selector) => {
            return parseIsWhereComponents(type, selector, 0, queries) ?? [];
          });

          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
        default: {
          if (!ANCESTOR_PROP_STATES.has(component.kind)) {
            return null;
          }

          const query = formStatePropQuery(component.kind);

          if (!query) {
            return null;
          }

          queries ??= [{ specificity: [] }];
          queries.forEach((entry) => {
            getAttributeQuery(entry).push(query);
          });
          return parseIsWhereComponents(type, selector, index + 1, queries);
        }
      }
    }
    case "attribute": {
      if (component.name === "dir") {
        return null;
      }

      const attributeQuery = attributeQueryFor(component);

      queries ??= [{ specificity: [] }];
      for (const query of queries) {
        if (type === "is") {
          query.specificity[Specificity.ClassName] =
            (query.specificity[Specificity.ClassName] ?? 0) + 1;
        }
        getAttributeQuery(query).push(attributeQuery);
      }
      return parseIsWhereComponents(type, selector, index + 1, queries);
    }
    case "class": {
      // In `is` and `where` selectors, the ref will always be a container query
      queries ??= [{ specificity: [] }];
      for (const query of queries) {
        if (type === "is") {
          query.specificity[Specificity.ClassName] =
            (query.specificity[Specificity.ClassName] ?? 0) + 1;
        }

        query.n = query.n
          ? `${query.n}.${component.name}`
          : `g:${component.name}`;
      }

      return parseIsWhereComponents(type, selector, index + 1, queries);
    }
  }
}

/**
 * `:not(a, b)` is `not(a) and not(b)`, so each argument becomes its own negated
 * query and the surrounding conjunction does the rest.
 *
 * `null` means the rule can neither be represented nor safely kept: either an
 * argument uses something with no negated form, or an argument matches
 * everything (`:not(*)`), which makes the rule unreachable.
 */
function negateSelectors(selectors: Selector[]): NegatableCompound | null {
  const queries: AttributeQuery[] = [];
  const specificity: SpecificityArray = [];

  for (const selector of selectors) {
    const compound = negatableCompound(selector);

    if (!compound) {
      return null;
    }

    const [first, ...rest] = compound.queries;

    if (!first) {
      return null;
    }

    queries.push(rest.length ? ["!", ["&", compound.queries]] : ["!", first]);

    // Selectors L4 §16.1: `:not()` takes the specificity of its MOST SPECIFIC
    // argument, not the sum of them.
    for (let i = 0; i < compound.specificity.length; i++) {
      const value = compound.specificity[i];
      if (value !== undefined) {
        specificity[i] = Math.max(specificity[i] ?? 0, value);
      }
    }
  }

  return { queries, specificity };
}

/**
 * Reduce one `:not()` argument to the conditions it asserts. Everything here
 * has to be a prop question, because that is the only kind of condition the
 * runtime can invert: `PseudoClassesQuery` is a set of `1` flags with no
 * polarity, and the ancestor container context only answers the positive
 * question.
 */
function negatableCompound(selector: Selector): NegatableCompound | null {
  const queries: AttributeQuery[] = [];
  const specificity: SpecificityArray = [];

  for (const component of selector) {
    if (Array.isArray(component.type)) {
      return null;
    }

    switch (component.type) {
      case "universal": {
        break;
      }
      case "class": {
        queries.push(["a", "className", "~=", component.name]);
        specificity[Specificity.ClassName] =
          (specificity[Specificity.ClassName] ?? 0) + 1;
        break;
      }
      case "id": {
        queries.push(["a", "id", "=", component.name]);
        specificity[Specificity.Id] = (specificity[Specificity.Id] ?? 0) + 1;
        break;
      }
      case "attribute": {
        if (component.name === "dir") {
          return null;
        }
        queries.push(attributeQueryFor(component));
        specificity[Specificity.ClassName] =
          (specificity[Specificity.ClassName] ?? 0) + 1;
        break;
      }
      case "pseudo-class": {
        if (component.kind === "not") {
          const nested = negateSelectors(component.selectors);

          if (!nested) {
            return null;
          }

          queries.push(...nested.queries);
          mergeSpecificity(specificity, nested.specificity);
          break;
        }

        const query = formStatePropQuery(component.kind);

        if (!query) {
          return null;
        }

        queries.push(query);
        specificity[Specificity.PseudoClass] =
          (specificity[Specificity.PseudoClass] ?? 0) + 1;
        break;
      }
      default: {
        return null;
      }
    }
  }

  return { queries, specificity };
}

/**
 * The form-state pseudo-classes an ANCESTOR may carry.
 *
 * A container query's attribute conditions (`ContainerQuery.a`) are not
 * evaluated: `testContainerQuery` in `src/native/conditions/container-query.ts`
 * leaves that check out, because the container context holds the container's
 * identity rather than its props. `:disabled` and `:empty` already emit into
 * that slot, and nothing new joins them — a condition that is never checked
 * applies the rule to EVERY descendant rather than to none, which is the worse
 * of the two wrong answers. Every other state pseudo-class therefore drops the
 * rule when it lands on an ancestor.
 */
const ANCESTOR_PROP_STATES = new Set(["disabled", "empty"]);

/**
 * The prop each form-state pseudo-class asks about.
 *
 * `:disabled` set the shape — one prop, tested for truthiness — and the rest
 * follow it. React Native delivers `disabled` (Pressable, Switch, Button),
 * `readOnly` (TextInput) and `children` itself; `checked` and `required` are
 * the React spellings a component receives and forwards, and are what
 * react-native-web puts on the underlying input.
 */
function formStatePropQuery(kind: string): AttributeQuery | undefined {
  switch (kind) {
    case "disabled":
      return ["a", "disabled"];
    case "enabled":
      return ["a", "disabled", "!"];
    case "checked":
      return ["a", "checked"];
    case "read-only":
      return ["a", "readOnly"];
    case "required":
      return ["a", "required"];
    case "empty":
      return ["a", "children", "!"];
    default:
      return undefined;
  }
}

/**
 * The prop an attribute selector reads, and how its value is compared.
 *
 * `class` is spelled `className` on every React Native component, and `data-*`
 * arrives through the `dataSet` prop; everything else is read from the prop of
 * the same name.
 */
function attributeQueryFor(component: AttributeComponent): AttributeQuery {
  const name = component.name === "class" ? "className" : component.name;
  const isData = name.startsWith("data-");
  const type = isData ? "d" : "a";
  const property = toRNProperty(isData ? name.replace("data-", "") : name);

  const operation = component.operation;

  if (!operation) {
    return [type, property];
  }

  const operator = operatorMap[operation.operator];

  // Selectors L4 §6.3. Only `i` changes the comparison: `s` asks for the
  // default, and the HTML-document-conditional form never applies because React
  // Native has no HTML document for its condition to be true in.
  return operation.caseSensitivity === "ascii-case-insensitive"
    ? [type, property, operator, operation.value, "i"]
    : [type, property, operator, operation.value];
}

function createBranch(): IsWhereBranch {
  return {
    specificity: [],
    containerQueries: [],
    classNames: [],
    attributes: [],
    media: [],
  };
}

function mergeBranches(
  base: IsWhereBranch,
  extra: IsWhereBranch,
): IsWhereBranch {
  const specificity = [...base.specificity];
  mergeSpecificity(specificity, extra.specificity);

  return {
    specificity,
    containerQueries: [...base.containerQueries, ...extra.containerQueries],
    classNames: [...base.classNames, ...extra.classNames],
    attributes: [...base.attributes, ...extra.attributes],
    pseudoClasses:
      base.pseudoClasses || extra.pseudoClasses
        ? { ...base.pseudoClasses, ...extra.pseudoClasses }
        : undefined,
    media: [...base.media, ...extra.media],
  };
}

function mergeSpecificity(
  target: SpecificityArray,
  source: SpecificityArray,
): void {
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    if (value !== undefined) {
      target[i] = (target[i] ?? 0) + value;
    }
  }
}

/** `:where()` contributes no specificity; `:is()` contributes its argument's. */
function countIn(
  type: "is" | "where",
  branch: IsWhereBranch,
  slot: number,
): void {
  if (type === "is") {
    branch.specificity[slot] = (branch.specificity[slot] ?? 0) + 1;
  }
}

function isContainerQuery(
  value: PartialSelector | ContainerQuery,
): value is ContainerQuery {
  return !("type" in value);
}

function getPseudoClassesQuery(key: PartialSelector | ContainerQuery) {
  let pseudoClassesQuery = pseudoClassesQueryMap.get(key);
  if (!pseudoClassesQuery) {
    if ("type" in key) {
      pseudoClassesQuery = {};
      key.pseudoClassesQuery = pseudoClassesQuery;
    } else {
      key.p ??= {};
      pseudoClassesQuery = key.p;
    }
    pseudoClassesQueryMap.set(key, pseudoClassesQuery);
  }

  return pseudoClassesQuery;
}

function getAttributeQuery(
  key: PartialSelector | ContainerQuery,
): AttributeQuery[] {
  let attributeQuery = attributeQueryMap.get(key);
  if (!attributeQuery) {
    if ("type" in key) {
      attributeQuery = [];
      key.attributeQuery = attributeQuery;
    } else {
      key.a ??= [];
      attributeQuery = key.a;
    }
    attributeQueryMap.set(key, attributeQuery);
  }

  return attributeQuery;
}

function getMediaQuery(
  key: PartialSelector | ContainerQuery,
): MediaCondition[] {
  let mediaQuery = mediaQueryMap.get(key);
  if (!mediaQuery) {
    if ("type" in key) {
      mediaQuery = [];
      key.mediaQuery = mediaQuery;
    } else {
      mediaQuery = [];
      key.m ??= ["&", mediaQuery];
    }
    mediaQueryMap.set(key, mediaQuery);
  }

  return mediaQuery;
}

function isRootVariableSelector([first, ...rest]: Selector) {
  rest = rest.filter((item) => item.type !== "nesting");
  return (
    first &&
    rest.length === 0 &&
    first.type === "pseudo-class" &&
    first.kind === "root"
  );
}

function isUniversalSelector([first, second]: Selector) {
  return first && first.type === "universal" && !second;
}

export function toRNProperty<T extends string>(str: T) {
  return str
    .replace(/^-rn-/, "")
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "") as CamelCase<T>;
}

type CamelCase<S extends string> =
  S extends `${infer P1}-${infer P2}${infer P3}`
    ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
    : Lowercase<S>;

const operatorMap: Record<AttrOperation["operator"], AttrSelectorOperator> = {
  "equal": "=",
  "includes": "~=",
  "dash-match": "|=",
  "prefix": "^=",
  "substring": "*=",
  "suffix": "$=",
};
