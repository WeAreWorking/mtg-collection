"""
Card pricing helpers.

Prices come from Scryfall and are cached on each ``Card`` row:

- ``price_usd`` / ``price_usd_foil``: TCGplayer market price in USD
- ``price_market3``: MTGO price in tickets (tix), as listed by Cardhoarder

CAD values are derived from the USD price with a live USD→CAD exchange rate
(open.er-api.com, falling back to frankfurter.app, then to a fixed default),
cached in memory for an hour.
"""
import json
import time
import urllib.request

DEFAULT_USD_CAD_RATE = 1.40
RATE_TTL_SECONDS = 3600
_RATE_SOURCES = (
    'https://open.er-api.com/v6/latest/USD',
    'https://api.frankfurter.app/latest?from=USD&to=CAD',
)
_RATE_CACHE = {'rate': DEFAULT_USD_CAD_RATE, 'last_updated': 0.0}


def get_usd_to_cad_rate() -> float:
    """Current USD→CAD rate; the last good rate (or the default) if offline."""
    now = time.time()
    if now - _RATE_CACHE['last_updated'] < RATE_TTL_SECONDS:
        return _RATE_CACHE['rate']

    for url in _RATE_SOURCES:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'MTGCollectionManager/1.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode('utf-8'))
            cad = (data.get('rates') or {}).get('CAD')
            if isinstance(cad, (int, float)) and cad > 0:
                _RATE_CACHE['rate'] = round(float(cad), 4)
                _RATE_CACHE['last_updated'] = now
                return _RATE_CACHE['rate']
        except Exception:
            continue

    # Both sources failed: keep the previous rate and retry in 5 minutes
    _RATE_CACHE['last_updated'] = now - RATE_TTL_SECONDS + 300
    return _RATE_CACHE['rate']


def active_usd_price(card) -> float | None:
    """USD price for the copy's finish, falling back to the other finish."""
    usd = getattr(card, 'price_usd', None)
    foil_usd = getattr(card, 'price_usd_foil', None)
    if getattr(card, 'foil', False):
        return foil_usd if foil_usd is not None else usd
    return usd if usd is not None else foil_usd


def _money(value, prefix):
    return f'{prefix}{value:,.2f}' if value is not None else '—'


def calculate_card_market_prices(card, rate: float = None) -> dict:
    """Price summary for one card row: TCGplayer in USD and CAD, MTGO in tix."""
    if rate is None:
        rate = get_usd_to_cad_rate()

    usd = active_usd_price(card)
    usd = round(usd, 2) if usd is not None else None
    cad = round(usd * rate, 2) if usd is not None else None
    tix = getattr(card, 'price_market3', None)

    return {
        'rate_usd_cad': rate,
        'foil': bool(getattr(card, 'foil', False)),
        'tcgplayer': {
            'name': 'TCGplayer (market)',
            'usd': usd,
            'cad': cad,
            'usd_fmt': _money(usd, '$'),
            'cad_fmt': _money(cad, 'C$'),
        },
        'mtgo': {
            'name': 'MTGO (Cardhoarder)',
            'tix': tix,
            'tix_fmt': f'{tix:,.2f} tix' if tix is not None else '—',
        },
        'primary_usd': usd,
        'primary_cad': cad,
        'primary_usd_fmt': _money(usd, '$'),
        'primary_cad_fmt': _money(cad, 'C$'),
    }
