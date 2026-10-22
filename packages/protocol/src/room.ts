const ROOM_SLUG = /^[a-z0-9-]{3,64}$/;

const WORDS = (
  'amber april apple arbor aspen atlas autumn basil beach berry birch bloom breeze brook cabin cactus candle canyon ' +
  'cedar cherry clover cloud cobalt comet coral cosmic cotton cove creek crisp daisy dawn delta dune ember fable ' +
  'fern field fjord flint forest fox frost garden ginger glacier glow grove harbor hazel heron hill honey iris ivory ' +
  'jade jasper juniper kettle lagoon lantern lark lemon lilac linen lotus maple marsh meadow mellow mint misty moon ' +
  'moss nectar oak ocean olive opal orchid otter panda peach pebble pine plum pond poppy porch prairie quartz quiet ' +
  'rain raven reef river robin rose sage sandy shore silver sky sleepy snow sparrow spruce star stone sunny swift ' +
  'tulip valley velvet violet willow winter wren zephyr'
).split(' ');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function isValidRoomSlug(slug: string): boolean {
  return ROOM_SLUG.test(slug);
}

/** Three words plus eight base32 characters, about 61 bits, so rooms cannot be found by guessing. */
export function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(11));
  const words = [0, 1, 2].map((i) => WORDS[bytes[i]! % WORDS.length]);
  const suffix = Array.from(bytes.slice(3), (b) => ALPHABET[b % 32]).join('');
  return `${words.join('-')}-${suffix}`;
}

export function randomId(bytes = 8): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
