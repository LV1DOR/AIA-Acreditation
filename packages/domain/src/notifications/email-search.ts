// Literal fragments plus one insertion, deletion, substitution or adjacent
// transposition. Keep very short/long terms literal to avoid noisy results and
// bound regex complexity. No user-supplied regular expressions reach Postgres.
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function emailSearchPatterns(query: string) {
  return query.trim().normalize("NFD").replace(/\p{M}/gu, "").split(/\s+/u).filter(Boolean).map(term => {
    const chars = Array.from(term), exact = literal(term);
    if (chars.length < 4 || chars.length > 48) return exact;
    const variants = new Set([exact]);
    for (let i = 0; i < chars.length; i++) {
      const before = literal(chars.slice(0, i).join("")), after = literal(chars.slice(i + 1).join(""));
      variants.add(`${before}${after}`);
      variants.add(`${before}.${after}`);
      variants.add(`${before}.${literal(chars.slice(i).join(""))}`);
      if (i + 1 < chars.length) variants.add(`${before}${literal(chars[i + 1]! + chars[i]!)}${literal(chars.slice(i + 2).join(""))}`);
    }
    return `(${[...variants].join("|")})`;
  });
}
