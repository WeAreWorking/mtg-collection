"""
Scryfall API client.
Docs: https://scryfall.com/docs/api

Bulk lookups use Scryfall's /cards/collection endpoint, which accepts
up to 75 identifiers in a single POST request. This avoids hitting rate limits.
"""
import time
import requests

BASE_URL = 'https://api.scryfall.com'
HEADERS = {
    'User-Agent': 'MTGCollectionManager/1.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
}
RATE_DELAY = 0.1  # seconds between requests

# In-memory card cache to avoid repeated requests for the same card
_CACHE = {}


def _request_with_retry(method: str, path: str, **kwargs) -> dict | None:
    """Make an HTTP request with automatic retry on 429 rate limit."""
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
            elif resp.status_code == 429:
                wait = 3.0 * (attempt + 1)
                time.sleep(wait)
                continue
            elif resp.status_code == 404:
                return None
            else:
                return None
        except requests.RequestException:
            time.sleep(0.5)

    return None


def get_card_named(name: str, set_code: str = None) -> dict | None:
    """
    Fetch a single card by exact name (and optionally set code).
    Uses /cards/named with fuzzy matching as a fallback.
    Returns the Scryfall card object or None if not found.
    """
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


def search_cards(query: str, page: int = 1) -> dict | None:
    """
    Search for cards using Scryfall's full-text search syntax.
    """
    params = {'q': query, 'page': page}
    data = _request_with_retry('GET', '/cards/search', params=params)
    time.sleep(RATE_DELAY)
    return data


def extract_image_uris(card: dict) -> tuple[str | None, str | None]:
    """
    Return (front_image_uri, back_image_uri) for a card.
    Handles both normal cards and double-faced cards (DFCs).
    """
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
    """
    Extract the fields we care about from a Scryfall card object
    into a flat dict suitable for saving to the database.
    """
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

    prices = card.get('prices', {}) or {}
    price_usd = float(prices['usd']) if prices.get('usd') else None
    price_usd_foil = float(prices['usd_foil']) if prices.get('usd_foil') else None
    price_market3 = float(prices['tix']) if prices.get('tix') else None
    
    # Card Kingdom retail baseline (Card Kingdom averages ~12% above TCGplayer market)
    price_cardkingdom = round(price_usd * 1.12, 2) if price_usd else None

    # Calculate CAD
    from .pricing import get_usd_to_cad_rate
    cad_rate = get_usd_to_cad_rate()
    price_cad = round((price_usd or 0.0) * cad_rate, 2) if price_usd is not None else None

    from datetime import datetime
    prices_updated_at = datetime.utcnow() if (price_usd is not None or price_usd_foil is not None) else None

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
        'price_cardkingdom': price_cardkingdom,
        'price_market3': price_market3,
        'prices_updated_at': prices_updated_at,
    }


def lookup_cards_bulk(entries: list[dict]) -> dict:
    """
    Lookup a list of card entries (each has 'scryfall_id', or 'name' and optional 'set_code')
    using Scryfall's bulk /cards/collection endpoint (75 per batch).

    Returns a dict mapping:
        card['scryfall_id'] -> flattened_card_dict
        (name.lower(), set_code.upper() if set_code else None) -> flattened_card_dict
        (name.lower(), None) -> flattened_card_dict
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
        card_map[(name_lower, set_code)] = flat
        card_map[(name_lower, None)] = flat

        # For double-faced / split cards, also map front face
        if ' // ' in flat['name']:
            front = flat['name'].split(' // ')[0].strip().lower()
            card_map[(front, set_code)] = flat
            card_map[(front, None)] = flat

    chunk_size = 75
    chunks = [entries[i:i + chunk_size] for i in range(0, len(entries), chunk_size)]

    for chunk in chunks:
        identifiers = []
        for e in chunk:
            if e.get('scryfall_id'):
                identifiers.append({'id': e['scryfall_id']})
            else:
                name = e['name'].split(' // ')[0].strip()
                item = {'name': name}
                if e.get('set_code'):
                    item['set'] = e['set_code'].lower()
                identifiers.append(item)

        data = _request_with_retry('POST', '/cards/collection', json={'identifiers': identifiers})
        if data:
            for card in data.get('data', []):
                _store_card(card)

            # Retry any not_found without set code
            not_found = data.get('not_found', [])
            retry_ids = []
            for nf in not_found:
                if nf.get('set'):
                    retry_ids.append({'name': nf.get('name')})

            if retry_ids:
                time.sleep(RATE_DELAY)
                r2 = _request_with_retry('POST', '/cards/collection', json={'identifiers': retry_ids})
                if r2:
                    for card in r2.get('data', []):
                        _store_card(card)

        time.sleep(RATE_DELAY)

    return card_map
