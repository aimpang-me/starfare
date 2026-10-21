import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url);

test("the credits line does not name Tesla or SpaceX", () => {
  const credits = readFileSync(new URL("../design/assets/CREDITS.md", root), "utf8");
  assert.equal(/tesla|spacex/i.test(credits), false);
  assert.equal(credits.includes("not affiliated with any real company"), true);
});
