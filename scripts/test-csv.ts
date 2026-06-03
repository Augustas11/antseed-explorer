import assert from "node:assert/strict";
import { csvLine } from "../lib/csv";

assert.equal(csvLine(["plain", 12, null, undefined]), "plain,12,,");
assert.equal(csvLine(["=cmd", "+cmd", "-cmd", "@cmd"]), "'=cmd,'+cmd,'-cmd,'@cmd");
assert.equal(csvLine(['needs "quote"', "has,comma", "multi\nline"]), '"needs ""quote""","has,comma","multi\nline"');
assert.equal(csvLine(["safe-hex-0xabc", "0xabc"]), "safe-hex-0xabc,0xabc");

console.log("CSV helper checks passed");
