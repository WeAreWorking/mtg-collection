"""
Import logic for collection text files, Archidekt URLs, and Archidekt deck exports.

Supported collection format:
    4 Lightning Bolt
    2 Snapcaster Mage (ISD)
    1 Black Lotus (LEA) [foil]
    3x Llanowar Elves

Supported Archidekt export format (with set code, collector number, foil):
    1x Example Card (set) 123 *F*
    4x Lightning Bolt (M11) 7
    2x Snapcaster Mage (ISD) 78 *F*
    1x Tamiyo, Collector of Tales (plst) WAR-220

Direct Archidekt URLs:
    https://archidekt.com/decks/7760144/zimone_mystery_unraveler
    https://archidekt.com/decks/7760144
"""
import re
import requests
from . import db
from .models import Card, Deck, DeckCard
from . import scryfall


# ── Parsing ──────────────────────────────────────────────────────────────────

_LINE_RE = re.compile(
    r'^(\d+)x?\s+'                          # quantity (with optional 'x')
    r'(.+?)'                                 # card name (non-greedy)
    r'(?:\s+\(([A-Za-z0-9]+)\))?'           # optional set code in parens e.g. (MH2)
    r'(?:\s+\S+)?'                           # optional collector number (123, WAR-220, etc.)
    r'\s*$',
    re.IGNORECASE,
)

# Matches both Archidekt's *F* and the [foil] format
_FOIL_RE = re.compile(r'\*F\*|\[foil\]', re.IGNORECASE)
_SECTION_RE = re.compile(
    r'^(sideboard|commander|companion|maybeboard)\s*:?\s*$',
    re.IGNORECASE,
)
_ARCHIDEKT_URL_RE = re.compile(r'archidekt\.com/decks/(\d+)', re.IGNORECASE)


def parse_line(line: str) -> dict | None:
    """
    Parse a single card line into a dict with keys:
        quantity, name, set_code, foil
    Returns None if the line is blank or a comment/section header.
    """
    line = line.strip()
    if not line or line.startswith('//') or line.startswith('#'):
        return None

    foil = bool(_FOIL_RE.search(line))
    line_clean = _FOIL_RE.sub('', line).strip()

    m = _LINE_RE.match(line_clean)
    if not m:
        return None

    return {
        'quantity': int(m.group(1)),
        'name': m.group(2).strip(),
        'set_code': (m.group(3) or '').upper() or None,
        'foil': foil,
    }


def parse_collection_text(text: str) -> list[dict]:
    """Parse a full collection text block. Returns list of parsed line dicts."""
    results = []
    for line in text.splitlines():
        parsed = parse_line(line)
        if parsed:
            results.append(parsed)
    return results


def parse_deck_text(text: str) -> dict:
    """
    Parse a deck text export.
    Returns:
        {
          'mainboard': [{'quantity', 'name', 'set_code', 'foil'}, ...],
          'sideboard': [...],
          'commander': [...],
        }
    """
    sections = {'mainboard': [], 'sideboard': [], 'commander': []}
    current_section = 'mainboard'

    for line in text.splitlines():
        stripped = line.strip()

        # Detect section headers
        m = _SECTION_RE.match(stripped)
        if m:
            keyword = m.group(1).lower()
            if keyword == 'sideboard':
                current_section = 'sideboard'
            elif keyword in ('commander', 'companion'):
                current_section = 'commander'
            else:
                current_section = 'mainboard'
            continue

        if not stripped:
            continue

        parsed = parse_line(stripped)
        if parsed:
            sections[current_section].append(parsed)

    return sections


def fetch_archidekt_deck(url_or_id: str) -> dict | None:
    """
    Fetch a public Archidekt deck by URL or deck ID.
    Returns:
        {
            'name': str,
            'format': str,
            'description': str,
            'sections': {
                'mainboard': [...],
                'sideboard': [...],
                'commander': [...]
            }
        }
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
    except requests.RequestException:
        return None

    sections = {'mainboard': [], 'sideboard': [], 'commander': []}

    for c in data.get('cards', []):
        card_obj = c.get('card', {})
        oracle = card_obj.get('oracleCard', {})
        name = oracle.get('name') or card_obj.get('displayName') or ''
        edition = card_obj.get('edition', {}).get('editioncode', '').upper()
        categories = c.get('categories', [])

        is_commander = any(cat.lower() == 'commander' for cat in categories)
        is_side = any(cat.lower() in ('sideboard', 'maybeboard') for cat in categories)
        modifier = c.get('modifier', '')
        foil = 'Foil' in modifier

        entry = {
            'scryfall_id': card_obj.get('uid'),
            'name': name,
            'set_code': edition or None,
            'quantity': c.get('quantity', 1),
            'foil': foil,
        }

        if is_commander:
            sections['commander'].append(entry)
        elif is_side:
            sections['sideboard'].append(entry)
        else:
            sections['mainboard'].append(entry)

    return {
        'name': data.get('name', 'Archidekt Deck'),
        'format': data.get('deckFormat', ''),
        'description': data.get('description', ''),
        'sections': sections,
    }


# ── Card lookup resolver ──────────────────────────────────────────────────────

def _resolve_card(entry: dict, card_map: dict) -> dict | None:
    """Find flattened card data from card_map, falling back to individual lookup."""
    # 1. Match by exact Scryfall UUID if present
    sid = entry.get('scryfall_id')
    if sid and sid in card_map:
        return card_map[sid]

    name_clean = entry['name'].strip()
    name_lower = name_clean.lower()
    set_code = entry.get('set_code')

    # 2. Match: (name, set)
    if set_code and (name_lower, set_code) in card_map:
        return card_map[(name_lower, set_code)]

    # 3. Match without set
    if (name_lower, None) in card_map:
        return card_map[(name_lower, None)]

    # 4. Front face match (for DFCs)
    if ' // ' in name_lower:
        front = name_lower.split(' // ')[0].strip()
        if set_code and (front, set_code) in card_map:
            return card_map[(front, set_code)]
        if (front, None) in card_map:
            return card_map[(front, None)]

    # 5. Fallback to individual API lookup
    if sid:
        raw = scryfall.get_card_by_id(sid)
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
    """
    Parse and import a collection text block into the database.
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
    """
    Parse and import a decklist into the database as a Deck + DeckCards.
    Supports either:
      - Archidekt public URL (e.g. https://archidekt.com/decks/7760144/...)
      - Plain text decklist (Archidekt export, MTGO format, etc.)
    When add_to_collection=True, cards are also added to the main collection.
    """
    stripped_text = text.strip()
    archidekt_data = None

    # Check if input is an Archidekt link
    if 'archidekt.com/decks/' in stripped_text:
        archidekt_data = fetch_archidekt_deck(stripped_text)

    if archidekt_data:
        sections = archidekt_data['sections']
        deck_name = deck_name or archidekt_data['name']
        deck_format = deck_format or archidekt_data['format']
        description = description or archidekt_data['description']
    else:
        sections = parse_deck_text(text)

    # Default to Commander when no format was selected (or a legacy numeric
    # value such as "3" was supplied by an earlier build / Archidekt).
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
