function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Explains why some people cannot be reached. Free rooms connect people directly, which a restrictive network
 * (some corporate or mobile connections) can block; the person may need a different network.
 */
export function unreachableNotice(names: string[]): string | undefined {
  const named = names.map((n) => n.trim() || 'a guest');
  if (named.length === 0) return undefined;
  return `Can't connect to ${joinNames(named)}. A network that blocks direct calls is the usual cause; trying a different network, such as mobile data, often helps.`;
}
