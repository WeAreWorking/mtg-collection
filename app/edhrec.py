"""
EDHREC client for commander card recommendations.

EDHREC has no official API, but every commander page is backed by a public
JSON document at ``https://json.edhrec.com/pages/commanders/<slug>.json``.
Each card in it carries ``num_decks`` (decks with this commander that run the
card) and ``potential_decks`` (decks with this commander that *could* run it);
their ratio is the "inclusion %" EDHREC shows on its Top Cards list.

Responses are cached in SQLite (``EdhrecCache``) for ``CACHE_TTL`` so the deck
builder stays fast and keeps working offline with the last good data.
"""
import json
import re
import unicodedata
from datetime import datetime, timedelta

import requests
from sqlalchemy.exc import IntegrityError

BASE_URL = 'https://json.edhrec.com/pages/commanders'
HEADERS = {'User-Agent': 'MTGCollectionManager/1.0', 'Accept': 'application/json'}
CACHE_TTL = timedelta(days=7)
TIMEOUT = 15


def slugify(name: str) -> str:
    """EDHREC-style slug: front face only, ASCII, lowercase, hyphen-separated.

    "Atraxa, Praetors' Voice" → "atraxa-praetors-voice"
    "Esika, God of the Tree // The Prismatic Bridge" → "esika-god-of-the-tree"
    """
    front = (name or '').split(' // ')[0]
    ascii_name = unicodedata.normalize('NFKD', front).encode('ascii', 'ignore').decode('ascii')
    ascii_name = ascii_name.lower().replace("'", '').replace('’', '')
    ascii_name = re.sub(r'[^a-z0-9]+', '-', ascii_name)
    return ascii_name.strip('-')


def name_key(name: str) -> str:
    """Normalised key for matching EDHREC names against collection names.

    Matches on the front face so "Delver of Secrets // Insectile Aberration"
    and "Delver of Secrets" are the same card.
    """
    front = (name or '').split(' // ')[0].strip()
    front = unicodedata.normalize('NFKD', front).encode('ascii', 'ignore').decode('ascii')
    return front.lower()


def candidate_slugs(commander_names):
    """Slugs to try for a commander (or partner pair, in both orders)."""
    slugs = [slugify(n) for n in commander_names if n]
    slugs = [s for s in slugs if s]
    if not slugs:
        return []
    if len(slugs) == 1:
        return slugs
    a, b = slugs[0], slugs[1]
    ordered = sorted([a, b])
    out = [f'{ordered[0]}-{ordered[1]}', f'{ordered[1]}-{ordered[0]}']
    # Fall back to the first commander alone if the pair page doesn't exist
    out.extend([a, b])
    return list(dict.fromkeys(out))


def parse_page(data: dict) -> list:
    """Flatten a commander page into one entry per card.

    Cards appear in several lists (e.g. "Top Cards" and "Creatures"); entries
    are merged by name and keep every list header they appeared under.
    """
    cardlists = (((data or {}).get('container') or {}).get('json_dict') or {}).get('cardlists') or []
    merged = {}
    for cl in cardlists:
        header = cl.get('header') or cl.get('tag') or ''
        tag = cl.get('tag') or ''
        for cv in cl.get('cardviews') or []:
            name = cv.get('name')
            if not name:
                continue
            num = cv.get('num_decks') or 0
            potential = cv.get('potential_decks') or 0
            synergy = cv.get('synergy')
            entry = merged.get(name)
            if entry is None:
                entry = {
                    'name': name,
                    'num_decks': num,
                    'potential_decks': potential,
                    'inclusion': round(num / potential, 4) if potential else 0.0,
                    'synergy': round(synergy, 4) if isinstance(synergy, (int, float)) else None,
                    'lists': [],
                    'tags': [],
                    'edhrec_url': f"https://edhrec.com{cv['url']}" if cv.get('url') else None,
                }
                merged[name] = entry
            if header and header not in entry['lists']:
                entry['lists'].append(header)
            if tag and tag not in entry['tags']:
                entry['tags'].append(tag)
    return list(merged.values())


def _fetch_slug(slug: str):
    try:
        resp = requests.get(f'{BASE_URL}/{slug}.json', headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as e:
        return None, f'Could not reach EDHREC ({e.__class__.__name__}).'
    if resp.status_code == 200:
        try:
            data = resp.json()
        except ValueError:
            return None, 'EDHREC returned an unreadable response.'
        # Unknown slugs sometimes return a redirect stub instead of a 404
        if not parse_page(data):
            return None, 'not_found'
        return data, None
    if resp.status_code in (403, 404):
        return None, 'not_found'
    return None, f'EDHREC returned HTTP {resp.status_code}.'


def get_recommendations(commander_names, force_refresh=False):
    """Return EDHREC card data for a commander (or partner pair).

    Result dict: ``{cards, slug, source_url, fetched_at, stale, error}``.
    ``stale`` is True when a fetch failed and cached data was served instead.
    """
    from . import db
    from .models import EdhrecCache

    slugs = candidate_slugs(commander_names)
    result = {'cards': [], 'slug': None, 'source_url': None, 'fetched_at': None, 'stale': False, 'error': None}
    if not slugs:
        result['error'] = 'Set a commander to get EDHREC recommendations.'
        return result

    now = datetime.utcnow()
    cache_rows = {row.slug: row for row in EdhrecCache.query.filter(EdhrecCache.slug.in_(slugs)).all()}

    # Fresh cache hit → no network
    if not force_refresh:
        for slug in slugs:
            row = cache_rows.get(slug)
            if row and row.fetched_at and now - row.fetched_at < CACHE_TTL:
                return _result_from_cache(row, stale=False)

    last_error = None
    for slug in slugs:
        data, err = _fetch_slug(slug)
        if data is not None:
            payload = json.dumps(parse_page(data))
            row = cache_rows.get(slug) or EdhrecCache(slug=slug)
            row.payload = payload
            row.fetched_at = now
            db.session.add(row)
            try:
                db.session.commit()
            except IntegrityError:
                # Another request cached this commander at the same moment
                db.session.rollback()
                row = EdhrecCache.query.filter_by(slug=slug).first()
                row.payload = payload
                row.fetched_at = now
                db.session.commit()
            return _result_from_cache(row, stale=False)
        if err != 'not_found':
            last_error = err
            break  # network problem — don't hammer other slugs

    # Network failed or page not found → fall back to any cached copy
    for slug in slugs:
        row = cache_rows.get(slug)
        if row:
            res = _result_from_cache(row, stale=True)
            res['error'] = last_error or 'EDHREC page not found; showing cached data.'
            return res

    result['error'] = last_error or (
        f'EDHREC has no page for "{" + ".join(n for n in commander_names if n)}" yet.'
    )
    return result


def _result_from_cache(row, stale):
    try:
        cards = json.loads(row.payload or '[]')
    except ValueError:
        cards = []
    return {
        'cards': cards,
        'slug': row.slug,
        'source_url': f'https://edhrec.com/commanders/{row.slug}',
        'fetched_at': row.fetched_at.isoformat() if row.fetched_at else None,
        'stale': stale,
        'error': None,
    }
