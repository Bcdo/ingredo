// Live-formats household/invite/reset codes as ABC-DEF while typing. The
// server canonicalizes on submit (strips hyphens/spaces, uppercases), so
// this is purely a typing aid — which is why it must never fight deletion:
// the trailing hyphen is only auto-appended while the user is adding
// characters, so backspacing over it does not snap it back.
const SIGNIFICANT = /[A-Z2-9]/;
const CODE_LENGTH = 6;

export function formatCode(next: string, previous: string): string {
  const cleaned = next
    .toUpperCase()
    .split('')
    .filter((char) => SIGNIFICANT.test(char))
    .slice(0, CODE_LENGTH);
  if (cleaned.length < 3) return cleaned.join('');
  if (cleaned.length === 3) {
    const grew = next.length > previous.length;
    return grew ? `${cleaned.join('')}-` : cleaned.join('');
  }
  return `${cleaned.slice(0, 3).join('')}-${cleaned.slice(3).join('')}`;
}
