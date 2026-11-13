"""
Importers for plain-text card lists, Archidekt text exports and Archidekt URLs.

Plain-text lines (quantity, name, optional set code, optional foil marker):
    4 Lightning Bolt
    3x Llanowar Elves
    2 Snapcaster Mage (ISD)
    1 Black Lotus (LEA) [foil]

Archidekt text exports add a collector number, finish and category tags:
    4x Lightning Bolt (M11) 7
    2x Snapcaster Mage (ISD) 78 *F*
    1x Tamiyo, Collector of Tales (plst) WAR-220
    1x Atraxa, Praetors' Voice (2x2) 190 [Commander{top}]

A collector number is only recognised after a set code, so multi-word names
without a set code ("4 Lightning Bolt") are kept whole. With a set code and
collector number the exact printing is imported (e.g. a borderless variant).

Archidekt URLs (public decks) are fetched through Archidekt's JSON API:
    https://archidekt.com/decks/7760144/zimone_mystery_unraveler
"""
import re
import requests
from . import db
from .models import Card, Deck, DeckCard
from . import scryfall


# ── Parsing ──────────────────────────────────────────────────────────────────

_LINE_RE = re.compile(
    r'^(\d+)x?\s+'                          # quantity, optional "x"
    r'(.+?)'                                 # card name
    r'(?:\s+\(([A-Za-z0-9]+)\)'              # optional set code, e.g. (MH2)
    r'(?:\s+(\S+))?)?'                       # optional collector number after the set
    r'\s*$',
    re.IGNORECASE,
)

# Finish markers: Archidekt *F* (foil) / *E* (etched), or a plain [foil]
_FOIL_RE = re.compile(r'\*F\*|\*E\*|\[foil\]', re.IGNORECASE)
# Archidekt category tags "[Ramp,Commander{top}]" and label tags "^Have,#37d67a^"
_CATEGORY_RE = re.compile(r'\[([^\]]*)\]')
_LABEL_RE = re.compile(r'\^[^^]*\^')
_SECTION_RE = re.compile(
    r'^(?:/+\s*)?(sideboard|commander|companion|maybeboard|mainboard|deck)\s*:?\s*$',
    re.IGNORECASE,
)
_ARCHIDEKT_URL_RE = re.compile(r'archidekt\.com/decks/(\d+)', re.IGNORECASE)


def _section_from_categories(categories: list[str], excluded: set[str] = frozenset()) -> str | None:
    """Map Archidekt category tags to a deck section (None = not specified).

    ``'maybeboard'`` means "not part of the deck": the Maybeboard itself, or a
    card whose first (primary) category is excluded from the deck. Text
    exports mark those with ``{noDeck}``; the API lists them in ``excluded``.
    """
    categories = [c for c in (categories or []) if isinstance(c, str) and c.strip()]
    names = {c.split('{')[0].strip().lower() for c in categories}
    if 'maybeboard' in names:
        return 'maybeboard'
    if categories:
        first = categories[0]
        if '{nodeck}' in first.lower() or first.split('{')[0].strip().lower() in excluded:
            return 'maybeboard'
    if 'commander' in names:
        return 'commander'
    if 'sideboard' in names:
        return 'sideboard'
    return None


def parse_line(line: str) -> dict | None:
    """Parse one card line.

    Returns ``{quantity, name, set_code, foil, section}`` or None for blank
    lines, comments and unparseable text. ``section`` comes from Archidekt
    category tags and is None when the line has none.
    """
    line = line.strip()
    if not line or line.startswith('//') or line.startswith('#'):
        return None

    foil = bool(_FOIL_RE.search(line))
    line_clean = _FOIL_RE.sub('', line)
    categories = []
    for tag in _CATEGORY_RE.findall(line_clean):
        categories.extend(t for t in tag.split(',') if t.strip())
    line_clean = _CATEGORY_RE.sub('', line_clean)
    line_clean = _LABEL_RE.sub('', line_clean).strip()

    m = _LINE_RE.match(line_clean)
    if not m:
        return None

    set_code = (m.group(3) or '').upper() or None
    return {
        'quantity': int(m.group(1)),
        'name': m.group(2).strip(),
        'set_code': set_code,
        'collector_number': (m.group(4) or None) if set_code else None,
        'foil': foil,
        'section': _section_from_categories(categories),
    }


def parse_collection_text(text: str) -> list[dict]:
    """Parse a collection list into card dicts (section tags are ignored)."""
    results = []
    for line in text.splitlines():
        parsed = parse_line(line)
        if parsed:
            parsed.pop('section', None)
            results.append(parsed)
    return results


def parse_deck_text(text: str) -> dict:
    """Parse a deck export into ``{'mainboard': [...], 'sideboard': [...], 'commander': [...]}``.

    Section headers (``Commander:``, ``Sideboard:``, ``Maybeboard:``…) switch
    the current section, and a blank line ends a Commander block. An Archidekt
    category tag on a line overrides the current section.
    Maybeboard cards are not part of the deck and are skipped.
    """
    sections = {'mainboard': [], 'sideboard': [], 'commander': []}
    current_section = 'mainboard'

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            # A blank line closes a Commander block (MTGA / Moxfield layout)
            if current_section == 'commander':
                current_section = 'mainboard'
            continue

        m = _SECTION_RE.match(stripped)
        if m:
            keyword = m.group(1).lower()
            if keyword == 'sideboard':
                current_section = 'sideboard'
            elif keyword in ('commander', 'companion'):
                current_section = 'commander'
            elif keyword == 'maybeboard':
                current_section = 'maybeboard'
            else:
                current_section = 'mainboard'
            continue

        parsed = parse_line(stripped)
        if not parsed:
            continue
        section = parsed.pop('section') or current_section
        if section in sections:
            sections[section].append(parsed)

    return sections


def fetch_archidekt_deck(url_or_id: str) -> dict | None:
    """Fetch a public Archidekt deck by URL or numeric ID.

    Returns ``{name, format, description, sections}`` with the same section
    layout as :func:`parse_deck_text`, or None if the deck can't be fetched.
    Maybeboard cards and cards whose primary category is excluded from the
    deck are skipped.
    """
    deck_id = None
    m = _ARCHIDEKT_URL_RE.search(url_or_id)
    if m:
        deck_id = m.group(1)
    elif url_or_id.strip().isdigit():
        deck_id = url_or_id.strip()

    if not deck_id:
        return None

    api_url = f'https://archidekt.com/api/decks/{deck_id}/'
    try:
        resp = requests.get(api_url, headers={'User-Agent': 'MTGCollectionManager/1.0'}, timeout=15)
        if resp.status_code != 200:
            return None
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(data, dict):
        return None

    sections = {'mainboard': [], 'sideboard': [], 'commander': []}

    # Categories the deck owner excluded from the deck (e.g. "Considering")
    excluded = {
        (cat.get('name') or '').strip().lower()
        for cat in (data.get('categories') or [])
        if isinstance(cat, dict) and cat.get('includedInDeck') is False
    }

    for c in data.get('cards') or []:
        card_obj = c.get('card') or {}
        oracle = card_obj.get('oracleCard') or {}
        name = oracle.get('name') or card_obj.get('displayName') or ''
        if not name:
            continue
        edition = ((card_obj.get('edition') or {}).get('editioncode') or '').upper()
        categories = c.get('categories') or []

        section = _section_from_categories(categories, excluded)
        if section == 'maybeboard':
            continue
        modifier = c.get('modifier') or ''
        foil = modifier in ('Foil', 'Etched')

        entry = {
            'scryfall_id': card_obj.get('uid'),
            'name': name,
            'set_code': edition or None,
            'quantity': c.get('quantity', 1),
            'foil': foil,
        }

        sections[section or 'mainboard'].append(entry)

    return {
        'name': data.get('name', 'Archidekt Deck'),
        'format': data.get('deckFormat', ''),
        'description': data.get('description', ''),
        'sections': sections,
    }


# ── Card lookup resolver ──────────────────────────────────────────────────────

def _resolve_card(entry: dict, card_map: dict) -> dict | None:
    """Find a card in the bulk-lookup map, falling back to single Scryfall lookups.

    Order: Scryfall ID → set + collector number → (name, set) → name → front
    face of a DFC → API calls.
    """
    # 1. Match by exact Scryfall UUID if present
    sid = entry.get('scryfall_id')
    if sid and sid in card_map:
        return card_map[sid]

    name_clean = entry['name'].strip()
    name_lower = name_clean.lower()
    set_code = entry.get('set_code')
    collector_number = entry.get('collector_number')

    # 1b. Exact printing by set + collector number (e.g. a borderless variant)
    if set_code and collector_number:
        key = scryfall.printing_key(set_code, collector_number)
        if key in card_map:
            return card_map[key]

    # 2. Name + set
    if set_code and (name_lower, set_code) in card_map:
        return card_map[(name_lower, set_code)]

    # 3. Name only
    if (name_lower, None) in card_map:
        return card_map[(name_lower, None)]

    # 4. Front face of a double-faced card
    if ' // ' in name_lower:
        front = name_lower.split(' // ')[0].strip()
        if set_code and (front, set_code) in card_map:
            return card_map[(front, set_code)]
        if (front, None) in card_map:
            return card_map[(front, None)]

    # 5. Individual API lookups
    if sid:
        raw = scryfall.get_card_by_id(sid)
        if raw and raw.get('object') != 'error':
            return scryfall.flatten_card(raw)

    if set_code and collector_number:
        raw = scryfall.get_card_by_set_number(set_code, collector_number)
        if raw and raw.get('object') != 'error':
            return scryfall.flatten_card(raw)

    raw = scryfall.get_card_named(name_clean, set_code)
    if raw and raw.get('object') != 'error':
        return scryfall.flatten_card(raw)
    if set_code:
        raw = scryfall.get_card_named(name_clean)
        if raw and raw.get('object') != 'error':
            return scryfall.flatten_card(raw)

    return None


# ── Collection import ─────────────────────────────────────────────────────────

def import_collection(
    text: str,
    default_storage: str = '',
) -> dict:
    """Import a card list into the collection.

    Copies are merged into an existing row only when printing, finish,
    condition and storage location all match.
    """
    parsed_lines = parse_collection_text(text)
    if not parsed_lines:
        return {'imported': 0, 'skipped': 0, 'errors': ['No valid card lines found.']}

    card_map = scryfall.lookup_cards_bulk(parsed_lines)

    imported = 0
    skipped = 0
    errors = []

    for entry in parsed_lines:
        card_data = _resolve_card(entry, card_map)

        if card_data is None:
            skipped += 1
            errors.append(
                f"Not found: {entry['quantity']}x {entry['name']}" +
                (f" ({entry['set_code']})" if entry.get('set_code') else '')
            )
            continue

        foil = entry.get('foil', False)
        scryfall_id = card_data.get('scryfall_id')
        storage = default_storage or None

        existing = None
        if scryfall_id:
            existing = Card.query.filter_by(
                scryfall_id=scryfall_id,
                foil=foil,
                condition='NM',
                storage_location=storage,
            ).first()

        if existing:
            existing.quantity += entry['quantity']
        else:
            card = Card(
                quantity=entry['quantity'],
                foil=foil,
                condition='NM',
                storage_location=storage,
                **card_data,
            )
            db.session.add(card)

        imported += entry['quantity']

    db.session.commit()
    return {'imported': imported, 'skipped': skipped, 'errors': errors}


# ── Deck import ───────────────────────────────────────────────────────────────

def import_deck(
    text: str,
    deck_name: str,
    deck_format: str = 'Commander',
    description: str = '',
    add_to_collection: bool = True,
    collection_storage: str = '',
) -> dict:
    """Create a Deck (with DeckCards) from an Archidekt URL or deck text.

    With ``add_to_collection`` the cards are also added to the collection,
    stored under ``collection_storage`` (default ``"Deck: <name>"``).
    """
    stripped_text = text.strip()
    archidekt_data = None

    if 'archidekt.com/decks/' in stripped_text:
        archidekt_data = fetch_archidekt_deck(stripped_text)
        if archidekt_data is None:
            return {
                'deck_id': None, 'imported': 0, 'skipped': 0,
                'errors': ['Could not load the Archidekt deck. Check the URL, that the deck is public, '
                           'and that archidekt.com is reachable.'],
            }

    if archidekt_data:
        sections = archidekt_data['sections']
        deck_name = deck_name or archidekt_data['name']
        deck_format = deck_format or archidekt_data['format']
        description = description or archidekt_data['description']
    else:
        sections = parse_deck_text(text)

    # Archidekt reports formats as numeric IDs; treat those (and blanks) as Commander.
    _fmt = (deck_format or '').strip() if isinstance(deck_format, str) else str(deck_format).strip()
    if not _fmt or _fmt.isdigit():
        deck_format = 'Commander'

    all_entries = sections['mainboard'] + sections['sideboard'] + sections['commander']

    if not all_entries:
        return {'deck_id': None, 'imported': 0, 'skipped': 0, 'errors': ['No cards found in decklist.']}

    card_map = scryfall.lookup_cards_bulk(all_entries)

    deck = Deck(name=deck_name, format=deck_format, description=description)
    db.session.add(deck)
    db.session.flush()

    imported = 0
    skipped = 0
    errors = []
    storage = collection_storage or f"Deck: {deck_name}"

    def _process_section(entries, is_sideboard=False, is_commander=False):
        nonlocal imported, skipped
        for entry in entries:
            card_data = _resolve_card(entry, card_map)
            if card_data is None:
                skipped += 1
                errors.append(
                    f"Not found: {entry['quantity']}x {entry['name']}" +
                    (f" ({entry['set_code']})" if entry.get('set_code') else '')
                )
                continue

            deck_card = DeckCard(
                deck_id=deck.id,
                scryfall_id=card_data.get('scryfall_id'),
                name=card_data['name'],
                set_code=card_data.get('set_code'),
                quantity=entry['quantity'],
                is_commander=is_commander,
                is_sideboard=is_sideboard,
                image_uri=card_data.get('image_uri'),
                type_line=card_data.get('type_line'),
                mana_cost=card_data.get('mana_cost'),
                colors=card_data.get('colors'),
                color_identity=card_data.get('color_identity'),
            )
            db.session.add(deck_card)

            if add_to_collection:
                foil = entry.get('foil', False)
                scryfall_id = card_data.get('scryfall_id')

                existing = None
                if scryfall_id:
                    existing = Card.query.filter_by(
                        scryfall_id=scryfall_id,
                        foil=foil,
                        condition='NM',
                        storage_location=storage,
                    ).first()

                if existing:
                    existing.quantity += entry['quantity']
                else:
                    collection_card = Card(
                        quantity=entry['quantity'],
                        foil=foil,
                        condition='NM',
                        storage_location=storage,
                        **card_data,
                    )
                    db.session.add(collection_card)

            imported += entry['quantity']

    _process_section(sections['commander'], is_commander=True)
    _process_section(sections['mainboard'])
    _process_section(sections['sideboard'], is_sideboard=True)

    db.session.commit()
    return {
        'deck_id': deck.id,
        'deck_name': deck_name,
        'imported': imported,
        'skipped': skipped,
        'errors': errors,
    }
