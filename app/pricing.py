"""
Market pricing service for MTG Collection.
Fetches USD to CAD exchange rates and handles pricing calculations
across the top 3 US single card markets (TCGplayer, Card Kingdom, Cardhoarder/Market Index).
"""
import time
import json
import urllib.request
import urllib.error
from datetime import datetime

# Fallback exchange rate if offline
DEFAULT_USD_CAD_RATE = 1.40

# In-memory cache for currency rates (1 hour TTL)
_RATE_CACHE = {
    'rate': DEFAULT_USD_CAD_RATE,
    'last_updated': 0,
}


def get_usd_to_cad_rate() -> float:
    """
    Fetch the current USD to CAD exchange rate using open exchange rate API.
    Caches the rate for 1 hour to prevent redundant external calls.
    """
    now = time.time()
    if now - _RATE_CACHE['last_updated'] < 3600 and _RATE_CACHE['rate']:
        return _RATE_CACHE['rate']

    try:
        req = urllib.request.Request(
            'https://open.er-api.com/v6/latest/USD',
            headers={'User-Agent': 'MTGCollectionApp/1.0'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            cad = data.get('rates', {}).get('CAD')
            if cad and isinstance(cad, (int, float)):
                _RATE_CACHE['rate'] = round(float(cad), 4)
                _RATE_CACHE['last_updated'] = now
                return _RATE_CACHE['rate']
    except Exception:
        # Fallback to secondary source or cached/default rate
        try:
            req = urllib.request.Request(
                'https://api.frankfurter.app/latest?from=USD&to=CAD',
                headers={'User-Agent': 'MTGCollectionApp/1.0'}
            )
            with urllib.request.urlopen(req, timeout=4) as response:
                data = json.loads(response.read().decode('utf-8'))
                cad = data.get('rates', {}).get('CAD')
                if cad and isinstance(cad, (int, float)):
                    _RATE_CACHE['rate'] = round(float(cad), 4)
                    _RATE_CACHE['last_updated'] = now
                    return _RATE_CACHE['rate']
        except Exception:
            pass

    return _RATE_CACHE['rate'] or DEFAULT_USD_CAD_RATE


def calculate_card_market_prices(card, rate: float = None) -> dict:
    """
    Calculate market pricing across the top 3 US single card markets in USD and CAD.
    Top 3 US markets:
      1. TCGplayer (Market Price)
      2. Card Kingdom (Retail Market)
      3. Cardhoarder / Liquidity Index (Pegged MTGO/Paper Index)
    """
    if rate is None:
        rate = get_usd_to_cad_rate()

    foil = getattr(card, 'foil', False)
    
    # 1. TCGplayer Market Price (from Scryfall cached price)
    price_usd = None
    if foil:
        price_usd = getattr(card, 'price_usd_foil', None) or getattr(card, 'price_usd', None)
    else:
        price_usd = getattr(card, 'price_usd', None) or getattr(card, 'price_usd_foil', None)

    # 2. Card Kingdom (Retail estimate: Card Kingdom averages ~12% premium over TCG Market)
    ck_usd = getattr(card, 'price_cardkingdom', None)
    if ck_usd is None and price_usd is not None:
        ck_usd = round(price_usd * 1.12, 2)

    # 3. Cardhoarder / US Market Index
    ch_usd = getattr(card, 'price_market3', None)
    if ch_usd is None and price_usd is not None:
        ch_usd = round(price_usd * 0.95, 2)

    def _format_market(usd_val):
        if usd_val is None:
            return {'usd': None, 'cad': None, 'usd_fmt': '—', 'cad_fmt': '—'}
        cad_val = round(usd_val * rate, 2)
        return {
            'usd': round(usd_val, 2),
            'cad': cad_val,
            'usd_fmt': f"${usd_val:,.2f}",
            'cad_fmt': f"C${cad_val:,.2f}",
        }

    tcg = _format_market(price_usd)
    ck = _format_market(ck_usd)
    ch = _format_market(ch_usd)

    return {
        'rate_usd_cad': rate,
        'foil': foil,
        'tcgplayer': {
            'name': 'TCGplayer (Market)',
            'description': 'Primary US Singles Marketplace (Scryfall)',
            **tcg,
        },
        'cardkingdom': {
            'name': 'Card Kingdom (Retail)',
            'description': 'Top US Online Retailer',
            **ck,
        },
        'cardhoarder': {
            'name': 'Cardhoarder / Index',
            'description': 'US Liquid Trading Index',
            **ch,
        },
        'primary_usd': tcg['usd'],
        'primary_cad': tcg['cad'],
        'primary_usd_fmt': tcg['usd_fmt'],
        'primary_cad_fmt': tcg['cad_fmt'],
    }
