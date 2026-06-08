import assert from "node:assert/strict";
import { clampPage, fmtUsd } from "../lib/format";

assert.equal(fmtUsd(-1234.56), "-$1,235");
assert.equal(fmtUsd(-12.3), "-$12.30");
assert.equal(fmtUsd(-0.125), "-$0.1250");
assert.equal(fmtUsd(0), "$0");
assert.equal(fmtUsd(12.3), "$12.30");

assert.equal(clampPage(undefined), 1);
assert.equal(clampPage("abc"), 1);
assert.equal(clampPage("0"), 1);
assert.equal(clampPage("2.9"), 2);

console.log("format helper checks passed");
