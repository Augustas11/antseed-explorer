import assert from "node:assert/strict";
import {
  rawAddressList,
  rawDateLiteral,
  rawFiniteNumber,
  rawNonNegativeInteger,
  rawNumericString,
  rawPositiveInteger,
  rawSqlFragment,
  rawTextValuesSelect,
} from "../lib/sqlSafe";

const address = `0x${"a".repeat(40)}`;

function rejectsUnsafe(fn: () => unknown) {
  assert.throws(fn, /Unsafe SQL literal/);
}

rawPositiveInteger(1);
rawNonNegativeInteger(0);
rawFiniteNumber(12.5, "score", { min: 0, max: 100 });
rawNumericString("-123.45");
rawDateLiteral("2026-06-03");
rawSqlFragment("total_sessions DESC", ["total_sessions DESC"]);
rawAddressList([address]);
rawTextValuesSelect([address], "addr", (value) => /^0x[0-9a-f]{40}$/.test(value));

rejectsUnsafe(() => rawPositiveInteger(0));
rejectsUnsafe(() => rawNonNegativeInteger(-1));
rejectsUnsafe(() => rawFiniteNumber(Number.NaN));
rejectsUnsafe(() => rawNumericString("1; DROP TABLE events"));
rejectsUnsafe(() => rawDateLiteral("2026-06-03'; DROP TABLE daily_dau; --"));
rejectsUnsafe(() => rawSqlFragment("total_sessions DESC; DROP TABLE events", ["total_sessions DESC"]));
rejectsUnsafe(() => rawAddressList(["0xnot-an-address"]));
rejectsUnsafe(() =>
  rawTextValuesSelect([address], "addr; DROP TABLE events", (value) => /^0x[0-9a-f]{40}$/.test(value)),
);

console.log("sqlSafe helper checks passed");
