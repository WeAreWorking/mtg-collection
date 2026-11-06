import re

_FOIL_RE = re.compile(r'\*F\*|\[foil\]', re.IGNORECASE)
_LINE_RE = re.compile(
    r'^(\d+)x?\s+'
    r'(.+?)'
    r'(?:\s+\(([A-Za-z0-9]+)\))?'
    r'(?:\s+\d+)?'
    r'\s*$',
    re.IGNORECASE,
)

test_lines = [
    '1x Example Card (set) 123 *F*',
    '4x Lightning Bolt (M11) 7',
    '2x Snapcaster Mage (ISD) 78 *F*',
    '3 Llanowar Elves',
    '1 Black Lotus (LEA) [foil]',
    "2x Atraxa, Praetors' Voice (ONE) 268 *F*",
    '1x Ragavan, Nimble Pilferer (MH2) 138',
    '// Comment line (should be skipped)',
]

print('Testing Archidekt parser fixes:')
print('-' * 55)
for line in test_lines:
    if line.startswith('//'):
        print(f'  SKIP  | {line}')
        continue
    foil = bool(_FOIL_RE.search(line))
    cleaned = _FOIL_RE.sub('', line).strip()
    m = _LINE_RE.match(cleaned)
    if m:
        qty, name, set_code = m.group(1), m.group(2).strip(), m.group(3)
        print(f'  OK    | qty={qty} name="{name}" set={set_code or "?"} foil={foil}')
    else:
        print(f'  FAIL  | {line}')
        print(f'        | cleaned: {repr(cleaned)}')
