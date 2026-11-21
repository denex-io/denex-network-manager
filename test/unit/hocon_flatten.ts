/**
 * Flattens the subset of HOCON that dnm generates into `path -> raw value` pairs, so tests can
 * assert keys and values without depending on layout. Not a HOCON parser: it reads `key { … }`,
 * `key = { … }`, `key = ${ref} { … }` (recorded as `path = ${ref}`), dotted keys, `#` comments,
 * `key = value`, one-line objects (`key { a = 1 }`, recorded raw) and multi-line arrays (recorded
 * raw). Later assignments overwrite earlier ones; substitutions are not resolved. Anything else
 * throws, so a generator change the helper can't read fails loudly instead of passing.
 */
export function flattenHocon(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack: string[] = [];
  const path = (key: string) => (stack.length ? `${stack[stack.length - 1]}.${key}` : key);
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line === '}') {
      if (stack.pop() === undefined) {
        throw new Error(`flattenHocon: unbalanced '}' at line ${n + 1}`);
      }
      continue;
    }
    let m = /^([^\s={]+)\s*(?:=\s*)?(\$\{[^}]+\}\s*)?\{$/.exec(line);
    if (m) {
      const key = path(m[1]);
      if (m[2]) out.set(key, m[2].trim());
      stack.push(key);
      continue;
    }
    m = /^([^\s={]+)\s*=\s*\[$/.exec(line);
    if (m) {
      const items: string[] = [];
      while (++n < lines.length && !lines[n].trim().startsWith(']')) items.push(lines[n].trim());
      out.set(path(m[1]), `[${items.join(' ')}]`);
      continue;
    }
    m = /^([^\s={]+)\s*=\s*(.+)$/.exec(line) ?? /^([^\s={]+)\s*(\{.*\})$/.exec(line);
    if (m) {
      out.set(path(m[1]), m[2]);
      continue;
    }
    throw new Error(`flattenHocon: cannot read line ${n + 1}: ${line}`);
  }
  if (stack.length > 0) throw new Error(`flattenHocon: unclosed block '${stack.at(-1)}'`);
  return out;
}
