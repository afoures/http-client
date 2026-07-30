import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compile_pathname,
  generate_pathname,
  MissingParamsError,
  PathnameError,
} from "./pathname.ts";

/** Compile and generate in one step, as an endpoint does across its lifetime. */
function href(pattern: string, params: Record<string, string | number | null | undefined> = {}) {
  return generate_pathname(compile_pathname(pattern), params);
}

describe("compile_pathname", () => {
  test("rejects a search string", () => {
    assert.throws(
      () => compile_pathname("/users?page=1"),
      (error: unknown) => {
        assert.ok(error instanceof PathnameError);
        assert.match(error.message, /cannot contain '\?'/);
        assert.equal(error.pattern, "/users?page=1");
        return true;
      },
    );
  });

  test("rejects a fragment", () => {
    assert.throws(() => compile_pathname("/users#top"), PathnameError);
  });

  test("rejects a ':' with no param name", () => {
    assert.throws(() => compile_pathname("/users/:"), PathnameError);
    assert.throws(() => compile_pathname("/users/:-nope"), PathnameError);
    assert.throws(() => compile_pathname("/users/:1abc"), PathnameError);
  });

  test("rejects unbalanced optional groups", () => {
    assert.throws(() => compile_pathname("/users(/:id"), PathnameError);
    assert.throws(() => compile_pathname("/users/:id)"), PathnameError);
  });

  test("keeps the source for diagnostics", () => {
    assert.equal(compile_pathname("/users/:id").source, "/users/:id");
  });
});

describe("generate_pathname", () => {
  test("static pathnames pass through", () => {
    assert.equal(href("/users"), "/users");
    assert.equal(href("/"), "/");
  });

  test("substitutes required params", () => {
    assert.equal(href("/users/:id", { id: "42" }), "/users/42");
    assert.equal(href("/users/:id", { id: 42 }), "/users/42");
    assert.equal(
      href("/posts/:postId/comments/:commentId", { postId: "1", commentId: "2" }),
      "/posts/1/comments/2",
    );
  });

  test("accepts the full identifier charset in param names", () => {
    assert.equal(href("/:_hello_WORLD", { _hello_WORLD: "a" }), "/a");
    assert.equal(href("/:$_hello_WORLD$123$", { $_hello_WORLD$123$: "b" }), "/b");
  });

  test("supports several params in one segment", () => {
    assert.equal(href("/v:major.:minor", { major: 1, minor: 2 }), "/v1.2");
    assert.equal(
      href("/v:major.:minor/users/:id", { major: 1, minor: 2, id: "x" }),
      "/v1.2/users/x",
    );
    assert.equal(
      href("/blog/:year-:month-:day/:slug", { year: 2026, month: "07", day: 29, slug: "hi" }),
      "/blog/2026-07-29/hi",
    );
    assert.equal(href("/x-:id-y", { id: "1" }), "/x-1-y");
  });

  test("percent-encodes values so they cannot change the URL structure", () => {
    assert.equal(href("/users/:id", { id: "a/b" }), "/users/a%2Fb");
    assert.equal(href("/users/:id", { id: "a b" }), "/users/a%20b");
    assert.equal(href("/users/:id", { id: "100%" }), "/users/100%25");
    assert.equal(href("/users/:id", { id: "a?b#c" }), "/users/a%3Fb%23c");
    assert.equal(href("/users/:id", { id: "é" }), "/users/%C3%A9");
    assert.equal(href("/users/:id", { id: "../../admin" }), "/users/..%2F..%2Fadmin");
  });

  describe("optional groups", () => {
    test("are kept when the param has a value", () => {
      assert.equal(href("/users(/:id)", { id: "7" }), "/users/7");
      assert.equal(href("/users/(:id)", { id: "7" }), "/users/7");
      assert.equal(href("/files(.:ext)", { ext: "json" }), "/files.json");
    });

    test("are dropped when the param is absent, undefined or null", () => {
      assert.equal(href("/users(/:id)"), "/users");
      assert.equal(href("/users(/:id)", { id: undefined }), "/users");
      assert.equal(href("/users(/:id)", { id: null }), "/users");
      assert.equal(href("/files(.:ext)"), "/files");
    });

    test("collapse the separator they leave behind", () => {
      assert.equal(href("/a(/:b)/c", { b: "1" }), "/a/1/c");
      assert.equal(href("/a(/:b)/c"), "/a/c");
      assert.equal(href("/a/(:b)/c"), "/a/c");
    });

    test("resolve independently when several appear in a row", () => {
      assert.equal(href("/a(/:b)(/:c)", { b: "1", c: "2" }), "/a/1/2");
      assert.equal(href("/a(/:b)(/:c)", { c: "2" }), "/a/2");
      assert.equal(href("/a(/:b)(/:c)", { b: "1" }), "/a/1");
      assert.equal(href("/a(/:b)(/:c)"), "/a");
    });

    test("nest, dropping only the innermost group that is missing a value", () => {
      assert.equal(href("/a(/:b(/:c))/d", { b: "1", c: "2" }), "/a/1/2/d");
      assert.equal(href("/a(/:b(/:c))/d", { b: "1" }), "/a/1/d");
      assert.equal(href("/a(/:b(/:c))/d"), "/a/d");
    });

    test("never leave a protocol-relative '//' when leading and dropped", () => {
      // `//users` would resolve against any base_url as the host `users`, sending the request to a
      // different origin, so the leading separator has to collapse.
      assert.equal(href("/(:lang)/users", { lang: "fr" }), "/fr/users");
      assert.equal(href("/(:lang)/users"), "/users");
      assert.equal(
        new URL(href("/(:lang)/users"), "https://api.example.com").href,
        "https://api.example.com/users",
      );
      assert.equal(href("/(:a/)/posts"), "/posts");
    });
  });

  describe("missing params", () => {
    test("throw, reporting every absent param rather than the first", () => {
      assert.throws(
        () => href("/a/:b/:c", { b: "1" }),
        (error: unknown) => {
          assert.ok(error instanceof MissingParamsError);
          assert.deepEqual(error.missing_params, ["c"]);
          return true;
        },
      );

      assert.throws(
        () => href("/a/:b/:c"),
        (error: unknown) => {
          assert.ok(error instanceof MissingParamsError);
          assert.deepEqual(error.missing_params, ["b", "c"]);
          assert.equal(error.pattern, "/a/:b/:c");
          return true;
        },
      );
    });

    test("treat null and undefined as absent", () => {
      assert.throws(() => href("/a/:b", { b: null }), MissingParamsError);
      assert.throws(() => href("/a/:b", { b: undefined }), MissingParamsError);
    });

    test("are a PathnameError, so one check covers every pattern failure", () => {
      assert.throws(() => href("/a/:b"), PathnameError);
    });
  });

  test("rejects a value that serializes to an empty string", () => {
    assert.throws(() => href("/users/:id", { id: "" }), PathnameError);
  });

  test("reuses a compiled pattern across calls", () => {
    const pattern = compile_pathname("/users(/:id)");
    assert.equal(generate_pathname(pattern, { id: "1" }), "/users/1");
    assert.equal(generate_pathname(pattern), "/users");
    assert.equal(generate_pathname(pattern, { id: "2" }), "/users/2");
  });
});
