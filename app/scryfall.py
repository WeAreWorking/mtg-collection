"""
Scryfall API client (https://scryfall.com/docs/api).

Bulk lookups use ``POST /cards/collection`` (up to 75 identifiers per
request). A short delay between requests keeps well inside Scryfall's rate
limit, and HTTP 429 responses are retried with backoff.
"""
import time
from datetime import datetime
from urllib.parse import quote

import requests

BASE_URL = 'https://api.scryfall.com'
HEADERS = {
    'User-Agent': 'MTGCollectionManager/1.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
}
RATE_DELAY = 0.1  # seconds between requests (Scryfall asks for 50–100 ms)
BATCH_SIZE = 75   # /cards/collection limit

# Process-lifetime cache of full card objects fetched by ID (card modal)
_CACHE = {}


def _request_with_retry(method: str, path: str, **kwargs) -> dict | None:
    """GET/POST with up to 4 attempts, retrying on HTTP 429 and network errors.

    Returns the decoded JSON body, or None on any other status or after the
    last attempt.
    """
    url = f'{BASE_URL}{path}' if path.startswith('/') else path
    kwargs.setdefault('headers', HEADERS)
    kwargs.setdefault('timeout', 15)

    for attempt in range(4):
        try:
            if method.upper() == 'POST':
                resp = requests.post(url, **kwargs)
            else:
                resp = requests.get(url, **kwargs)

            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                time.sleep(3.0 * (attempt + 1))
                continue
            return None
        except requests.RequestException:
            time.sleep(0.5)

    return None


def get_card_named(name: str, set_code: str = None) -> dict | None:
    """Fetch one card with ``/cards/named?fuzzy=`` (front face for DFCs), optionally in a set."""
    clean_name = name.split(' // ')[0].strip() if ' // ' in name else name
    params = {'fuzzy': clean_name}
    if set_code:
        params['set'] = set_code.lower()

    data = _request_with_retry('GET', '/cards/named', params=params)
    time.sleep(RATE_DELAY)
    return data


def get_card_by_id(scryfall_id: str) -> dict | None:
    """Fetch a card by its Scryfall UUID."""
    if scryfall_id in _CACHE:
        return _CACHE[scryfall_id]
    data = _request_with_retry('GET', f'/cards/{scryfall_id}')
    if data:
        _CACHE[scryfall_id] = data
    time.sleep(RATE_DELAY)
    return data


def get_card_by_set_number(set_code: str, collector_number: str) -> dict | None:
    """Fetch one exact printing with ``/cards/<set>/<collector_number>``."""
    path = f'/cards/{quote(set_code.lower(), safe="")}/{quote(str(collector_number), safe="")}'
    data = _request_with_retry('GET', path)
    time.sleep(RATE_DELAY)
    return data


def printing_key(set_code: str, collector_number: str) -> tuple:
    """``card_map`` key for an exact printing (set + collector number)."""
    return ('#', (set_code or '').upper(), str(collector_number or '').lower())


def search_cards(query: str, page: int = 1) -> dict | None:
    """Run a Scryfall full-text search (``/cards/search``)."""
    params = {'q': query, 'page': page}
    data = _request_with_retry('GET', '/cards/search', params=params)
    time.sleep(RATE_DELAY)
    return data


def extract_image_uris(card: dict) -> tuple[str | None, str | None]:
    """Return ``(front, back)`` "normal"-size image URLs; back is None for single-faced cards."""
    front = None
    back = None

    if 'image_uris' in card:
        front = card['image_uris'].get('normal')
    elif 'card_faces' in card:
        faces = card['card_faces']
        if len(faces) >= 1 and 'image_uris' in faces[0]:
            front = faces[0]['image_uris'].get('normal')
        if len(faces) >= 2 and 'image_uris' in faces[1]:
            back = faces[1]['image_uris'].get('normal')

    return front, back


def flatten_card(card: dict) -> dict:
    """Map a Scryfall card object to ``Card`` column values."""
    front_img, back_img = extract_image_uris(card)

    colors = card.get('colors', [])
    color_identity = card.get('color_identity', [])

    oracle_text = card.get('oracle_text', '')
    if not oracle_text and 'card_faces' in card:
        oracle_text = '\n//\n'.join(
            face.get('oracle_text', '') for face in card.get('card_faces', [])
        )

    mana_cost = card.get('mana_cost', '')
    if not mana_cost and 'card_faces' in card:
        mana_cost = card['card_faces'][0].get('mana_cost', '')

    prices = card.get('prices') or {}

    def _price(key):
        value = prices.get(key)
        return float(value) if value else None

    price_usd = _price('usd')
    # Etched foils only have a usd_etched price; treat it as the foil price
    price_usd_foil = _price('usd_foil')
    if price_usd_foil is None:
        price_usd_foil = _price('usd_etched')
    price_tix = _price('tix')

    from .pricing import get_usd_to_cad_rate
    price_cad = round(price_usd * get_usd_to_cad_rate(), 2) if price_usd is not None else None
    has_price = price_usd is not None or price_usd_foil is not None

    return {
        'scryfall_id': card.get('id'),
        'name': card.get('name', ''),
        'set_code': card.get('set', '').upper(),
        'set_name': card.get('set_name', ''),
        'collector_number': card.get('collector_number', ''),
        'image_uri': front_img,
        'image_uri_back': back_img,
        'colors': ','.join(colors),
        'color_identity': ','.join(color_identity),
        'type_line': card.get('type_line', ''),
        'mana_cost': mana_cost,
        'oracle_text': oracle_text,
        'rarity': card.get('rarity', ''),
        'cmc': card.get('cmc', 0.0),
        'keywords': ','.join(card.get('keywords', [])),
        'price_usd': price_usd,
        'price_usd_foil': price_usd_foil,
        'price_cad': price_cad,
        'price_market3': price_tix,
        'prices_updated_at': datetime.utcnow() if has_price else None,
    }


def lookup_cards_bulk(entries: list[dict]) -> dict:
    """Resolve many cards with ``/cards/collection``, 75 per request.

    Each entry has ``scryfall_id`` or ``name`` (+ optional ``set_code`` and
    ``collector_number``). With a set and collector number the exact printing
    is requested. Duplicate identifiers are sent once; an unknown set +
    collector number is retried by name + set, and a name not found in its set
    is retried by name alone.

    Returns flattened cards keyed by Scryfall ID, :func:`printing_key`,
    ``(name_lower, SET)`` and ``(name_lower, None)``; double-faced cards are
    also keyed by front face.
    """
    if not entries:
        return {}

    card_map = {}

    def _store_card(card_obj):
        flat = flatten_card(card_obj)
        sid = flat['scryfall_id']
        name_lower = flat['name'].lower()
        set_code = flat['set_code']

        if sid:
            card_map[sid] = flat
        if set_code and flat['collector_number']:
            card_map[printing_key(set_code, flat['collector_number'])] = flat
        card_map[(name_lower, set_code)] = flat
        card_map[(name_lower, None)] = flat

        # Also key double-faced / split cards by their front face
        if ' // ' in flat['name']:
            front = flat['name'].split(' // ')[0].strip().lower()
            card_map[(front, set_code)] = flat
            card_map[(front, None)] = flat

    identifiers = []
    seen = set()
    # (set, collector_number) → name, to retry printings Scryfall doesn't know
    printing_names = {}
    for e in entries:
        if e.get('scryfall_id'):
            item = {'id': e['scryfall_id']}
        elif e.get('set_code') and e.get('collector_number'):
            item = {'set': e['set_code'].lower(), 'collector_number': str(e['collector_number'])}
            printing_names[(item['set'], item['collector_number'].lower())] = e['name'].split(' // ')[0].strip()
        else:
            item = {'name': e['name'].split(' // ')[0].strip()}
            if e.get('set_code'):
                item['set'] = e['set_code'].lower()
        key = tuple(sorted(item.items()))
        if key not in seen:
            seen.add(key)
            identifiers.append(item)

    for start in range(0, len(identifiers), BATCH_SIZE):
        chunk_ids = identifiers[start:start + BATCH_SIZE]

        data = _request_with_retry('POST', '/cards/collection', json={'identifiers': chunk_ids})
        if data:
            for card in data.get('data', []):
                _store_card(card)

            # Retry misses more loosely: an unknown set + collector number by
            # name + set, a name not found in its set by name alone
            retry_ids = []
            for nf in data.get('not_found', []):
                if nf.get('collector_number') and nf.get('set'):
                    name = printing_names.get((nf['set'].lower(), str(nf['collector_number']).lower()))
                    if name:
                        retry_ids.append({'name': name, 'set': nf['set'].lower()})
                elif nf.get('set') and nf.get('name'):
                    retry_ids.append({'name': nf['name']})
            retry_ids = list({tuple(sorted(r.items())): r for r in retry_ids}.values())

            if retry_ids:
                time.sleep(RATE_DELAY)
                r2 = _request_with_retry('POST', '/cards/collection', json={'identifiers': retry_ids})
                if r2:
                    for card in r2.get('data', []):
                        _store_card(card)

        time.sleep(RATE_DELAY)

    return card_map
