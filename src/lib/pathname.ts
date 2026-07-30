/**
 * Pathname pattern parsing and URL generation.
 *
 * Supports the pattern syntax this client documents: static text, `:param` segments, optional
 * groups `(...)` (nestable), and several params in a single segment (`/v:major.:minor`). Param
 * names use the JavaScript identifier charset, `[a-zA-Z_$][a-zA-Z_$0-9]*`.
 *
 * Patterns describe a pathname only. A `?` or `#` is rejected, since search params are declared
 * with an endpoint's `query` serializer and `new URL()` would otherwise silently reinterpret
 * everything after those characters as the search string or fragment.
 */

// ---------------------------------------------------------------- types

type NameStartChar =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

/** First character of a param name, mirroring `[a-zA-Z_$]` in {@link IDENTIFIER_RE}. */
type NameStart = NameStartChar | Uppercase<NameStartChar> | "_" | "$";

/** Subsequent characters of a param name, mirroring `[a-zA-Z_$0-9]` in {@link IDENTIFIER_RE}. */
type NameChar = NameStart | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Consume a param name from `source`, returning it alongside the unconsumed remainder. */
type ScanName<
  source extends string,
  name extends string = "",
> = source extends `${infer head}${infer rest}`
  ? head extends NameChar
    ? ScanName<rest, `${name}${head}`>
    : [name, source]
  : [name, ""];

/**
 * Walk a pathname pattern character by character, collecting param names. `depth` tracks how many
 * optional groups enclose the cursor, so a param is optional when it is captured at depth > 0.
 * A `:` not followed by a valid name start is treated as literal text; the runtime rejects it.
 */
type ParseParams<
  source extends string,
  depth extends readonly unknown[] = [],
  required extends string = never,
  optional extends string = never,
> = source extends `(${infer rest}`
  ? ParseParams<rest, [...depth, unknown], required, optional>
  : source extends `)${infer rest}`
    ? ParseParams<rest, depth extends [unknown, ...infer tail] ? tail : [], required, optional>
    : source extends `:${infer rest}`
      ? rest extends `${NameStart}${string}`
        ? ScanName<rest> extends [infer name extends string, infer tail extends string]
          ? depth extends []
            ? ParseParams<tail, depth, required | name, optional>
            : ParseParams<tail, depth, required, optional | name>
          : never
        : ParseParams<rest, depth, required, optional>
      : source extends `${string}${infer rest}`
        ? ParseParams<rest, depth, required, optional>
        : { required: required; optional: optional };

/**
 * Collect param names by jumping from one `:` to the next, skipping the literal text between them
 * in a single step. Only valid without optional groups, where every param is required and the text
 * between params therefore carries no meaning. Costs one step per param rather than per character,
 * which matters because these types are re-derived at every use site.
 */
type ParseRequiredParams<
  source extends string,
  required extends string = never,
> = source extends `${string}:${infer rest}`
  ? rest extends `${NameStart}${string}`
    ? ScanName<rest> extends [infer name extends string, infer tail extends string]
      ? ParseRequiredParams<tail, required | name>
      : never
    : ParseRequiredParams<rest, required>
  : { required: required; optional: never };

/**
 * The params a pathname pattern captures. Params inside an optional group keep their key but widen
 * to include `undefined`, so a caller can pass the key through unconditionally.
 *
 * @example
 * PathnameParams<"/users/:id">    // { id: string }
 * PathnameParams<"/users(/:id)">  // { id: string | undefined }
 */
export type PathnameParams<pathname extends string> = string extends pathname
  ? Record<string, string | undefined>
  : (
        pathname extends `${string}(${string}`
          ? ParseParams<pathname>
          : ParseRequiredParams<pathname>
      ) extends { required: infer required extends string; optional: infer optional extends string }
    ? { [key in required]: string } & { [key in optional]: string | undefined }
    : never;

// ---------------------------------------------------------------- runtime

const IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z_$0-9]*/;

type Token =
  | { type: "text"; text: string }
  | { type: "param"; name: string }
  | { type: "group_start"; end: number }
  | { type: "group_end" };

/** A pathname pattern parsed into tokens, ready for {@link generate_pathname}. */
export type CompiledPathname = {
  /** The pattern this was compiled from. */
  source: string;
  tokens: Array<Token>;
};

/**
 * A pathname pattern is malformed, or the params given for it cannot produce a pathname. Thrown
 * rather than returned, because both cases are programmer errors rather than runtime failures.
 */
export class PathnameError extends Error {
  /** The pattern that failed. */
  public readonly pattern: string;

  constructor(message: string, pattern: string) {
    super(`${message}\n\nPattern: ${pattern}`);
    this.name = "PathnameError";
    this.pattern = pattern;
  }
}

/** A pathname could not be generated because required params were absent. */
export class MissingParamsError extends PathnameError {
  /** Every required param that was `null`, `undefined` or absent, not just the first. */
  public readonly missing_params: Array<string>;

  /** The params the pathname was generated from. */
  public readonly params: Record<string, unknown>;

  constructor(pattern: string, missing_params: Array<string>, params: Record<string, unknown>) {
    super(`missing param(s): ${missing_params.map((name) => `'${name}'`).join(", ")}`, pattern);
    this.name = "MissingParamsError";
    this.missing_params = missing_params;
    this.params = params;
  }
}

/**
 * Parse a pathname pattern into tokens. Do this once per endpoint and reuse the result, since
 * {@link generate_pathname} runs on every request.
 *
 * @throws {PathnameError} When the pattern contains `?`, `#`, a `:` with no valid param name, or
 * unbalanced optional-group parentheses.
 */
export function compile_pathname(source: string): CompiledPathname {
  const tokens: Array<Token> = [];
  const open_groups: Array<number> = [];
  let text = "";
  let index = 0;

  const flush_text = () => {
    if (text !== "") {
      tokens.push({ type: "text", text });
      text = "";
    }
  };

  while (index < source.length) {
    const char = source[index]!;

    if (char === "?" || char === "#") {
      throw new PathnameError(
        `pathname cannot contain '${char}'; declare search params with \`query\``,
        source,
      );
    }

    if (char === ":") {
      const name = IDENTIFIER_RE.exec(source.slice(index + 1))?.[0];
      if (name === undefined) throw new PathnameError("missing param name after ':'", source);
      flush_text();
      tokens.push({ type: "param", name });
      index += name.length + 1;
      continue;
    }

    if (char === "(") {
      flush_text();
      open_groups.push(tokens.length);
      tokens.push({ type: "group_start", end: -1 });
      index += 1;
      continue;
    }

    if (char === ")") {
      const start = open_groups.pop();
      if (start === undefined) throw new PathnameError("unmatched ')'", source);
      flush_text();
      (tokens[start] as { type: "group_start"; end: number }).end = tokens.length;
      tokens.push({ type: "group_end" });
      index += 1;
      continue;
    }

    text += char;
    index += 1;
  }

  if (open_groups.length > 0) throw new PathnameError("unmatched '('", source);
  flush_text();

  return { source, tokens };
}

/** A value accepted for a pathname param. `null` and `undefined` drop an enclosing optional group. */
export type PathnameParamValue = string | number | null | undefined;

/**
 * Generate a pathname from a compiled pattern. Param values are percent-encoded, so a value can
 * never introduce a new path segment or start a search string. A param that is `null` or
 * `undefined` drops its innermost enclosing optional group, collapsing the separator it leaves
 * behind.
 *
 * @throws {MissingParamsError} When a param outside any optional group has no value.
 * @throws {PathnameError} When a param value serializes to an empty string.
 */
export function generate_pathname(
  pattern: CompiledPathname,
  params: Record<string, PathnameParamValue> = {},
): string {
  const missing_params: Array<string> = [];
  const stack: Array<{ group_start?: number; pathname: string }> = [{ pathname: "" }];
  let index = 0;

  while (index < pattern.tokens.length) {
    const token = pattern.tokens[index]!;
    const frame = stack[stack.length - 1]!;

    if (token.type === "text") {
      frame.pathname += token.text;
      index += 1;
      continue;
    }

    if (token.type === "group_start") {
      stack.push({ group_start: index, pathname: "" });
      index += 1;
      continue;
    }

    if (token.type === "group_end") {
      const group = stack.pop()!;
      stack[stack.length - 1]!.pathname += group.pathname;
      index += 1;
      continue;
    }

    const value = params[token.name];

    if (value === null || value === undefined) {
      if (stack.length === 1) {
        if (!missing_params.includes(token.name)) missing_params.push(token.name);
        index += 1;
        continue;
      }

      // Drop the enclosing group, then avoid doubling the separator around what was removed.
      const group = stack.pop()!;
      const group_start = pattern.tokens[group.group_start!] as { end: number };
      index = group_start.end + 1;

      const parent = stack[stack.length - 1]!;
      const next = pattern.tokens[index];
      if (parent.pathname.endsWith("/") && next?.type === "text" && next.text.startsWith("/")) {
        parent.pathname = parent.pathname.slice(0, -1);
      }
      continue;
    }

    const serialized = String(value);
    if (serialized === "") {
      throw new PathnameError(`param '${token.name}' cannot be empty`, pattern.source);
    }

    frame.pathname += encodeURIComponent(serialized);
    index += 1;
  }

  if (missing_params.length > 0) {
    throw new MissingParamsError(pattern.source, missing_params, params);
  }

  return stack[0]!.pathname;
}
