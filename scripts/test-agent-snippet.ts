import assert from "node:assert/strict";
import { buildAgentSessionSnippet, snippetString } from "../lib/snippet";

const peerId = 'peer"with\\chars';
const service = 'service"with\\chars';
const snippet = buildAgentSessionSnippet({ peerId, service });

assert.equal(snippetString(peerId), '"peer\\"with\\\\chars"');
assert.match(snippet, /providerPeerId="peer\\"with\\\\chars"/);
assert.match(snippet, /service="service\\"with\\\\chars"/);
assert.doesNotMatch(snippet, /providerPeerId="peer"with\\chars"/);

console.log("Agent snippet escaping checks passed");
