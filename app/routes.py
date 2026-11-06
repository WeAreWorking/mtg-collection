from flask import Blueprint, jsonify, render_template, request, redirect, url_for
from sqlalchemy import or_
from . import db
from .models import Card, Deck, DeckCard
from . import scryfall as scryfall_client
from . import importer

main = Blueprint('main', __name__)


# ── Page routes ───────────────────────────────────────────────────────────────

@main.route('/')
def index():
    return redirect(url_for('main.collection'))


@main.route('/collection')
def collection():
    return render_template('collection.html')


@main.route('/import')
def import_page():
    return render_template('import_page.html')


@main.route('/decks')
def decks_page():
    return render_template('decks.html')


@main.route('/prism')
@main.route('/build')
def prism_builder_page():
    return render_template('prism.html')


# ── Collection API ────────────────────────────────────────────────────────────

@main.route('/api/collection')
def api_collection():
    """
    GET /api/collection
    Query params:
        q           — search text (name, type, oracle text)
        color       — filter by color code(s), comma-separated e.g. "W,U"
        set_code    — filter by set code e.g. "MH3"
        rarity      — common | uncommon | rare | mythic
        foil        — true | false
        storage     — storage location substring
        sort        — name | cmc | rarity | added_at (default: name)
        order       — asc | desc (default: asc)
        page        — page number (default: 1)
        per_page    — results per page (default: 60)
    """
    q = request.args.get('q', '').strip()
    color = request.args.get('color', '').strip()
    set_code = request.args.get('set_code', '').strip().upper()
    rarity = request.args.get('rarity', '').strip().lower()
    foil = request.args.get('foil', '').strip().lower()
    storage = request.args.get('storage', '').strip()
    sort_by = request.args.get('sort', 'name')
    order = request.args.get('order', 'asc')
    page = int(request.args.get('page', 1))
    per_page = min(int(request.args.get('per_page', 60)), 1000)
    in_deck = request.args.get('in_deck', '').strip()

    query = Card.query

    if q:
        like = f'%{q}%'
        query = query.filter(
            or_(
                Card.name.ilike(like),
                Card.type_line.ilike(like),
                Card.oracle_text.ilike(like),
            )
        )
    if color:
        # Match any card that contains all requested colors
        for c in color.split(','):
            c = c.strip().upper()
            if c:
                query = query.filter(Card.color_identity.contains(c))
    if set_code:
        query = query.filter(Card.set_code == set_code)
    if rarity:
        query = query.filter(Card.rarity == rarity)
    if foil == 'true':
        query = query.filter(Card.foil == True)
    elif foil == 'false':
        query = query.filter(Card.foil == False)
    if storage:
        query = query.filter(Card.storage_location.ilike(f'%{storage}%'))

    if in_deck:
        if in_deck == 'shared':
            # Subquery cards in 2+ decks
            shared_names = (
                db.session.query(DeckCard.name)
                .group_by(DeckCard.name)
                .having(db.func.count(db.func.distinct(DeckCard.deck_id)) >= 2)
                .subquery()
            )
            query = query.filter(Card.name.in_(shared_names))
        elif in_deck == 'unassigned':
            assigned_names = db.session.query(DeckCard.name).distinct().subquery()
            query = query.filter(~Card.name.in_(assigned_names))
        elif in_deck.isdigit():
            deck_card_names = (
                db.session.query(DeckCard.name)
                .filter(DeckCard.deck_id == int(in_deck))
                .subquery()
            )
            query = query.filter(Card.name.in_(deck_card_names))

    # Sorting
    sort_col = {
        'name': Card.name,
        'cmc': Card.cmc,
        'rarity': Card.rarity,
        'added_at': Card.added_at,
        'price': Card.price_usd,
        'price_cad': Card.price_cad,
    }.get(sort_by, Card.name)
    if order == 'desc':
        sort_col = sort_col.desc()
    elif sort_by in ('price', 'price_cad'):
        # For price sorting, nulls should sort to bottom
        sort_col = sort_col.desc() if order == 'desc' else sort_col.asc()
    query = query.order_by(sort_col)

    total = query.count()
    total_quantity = query.with_entities(db.func.sum(Card.quantity)).scalar() or 0
    cards = query.offset((page - 1) * per_page).limit(per_page).all()

    # Look up deck associations for PRISM multi-deck tracking
    card_names = [c.name for c in cards]
    deck_map = {}
    if card_names:
        deck_cards = (
            DeckCard.query
            .filter(DeckCard.name.in_(card_names))
            .all()
        )
        for dc in deck_cards:
            deck_map.setdefault(dc.name, []).append({
                'id': dc.deck_id,
                'name': dc.deck.name,
                'is_commander': dc.is_commander
            })

    card_dicts = []
    for c in cards:
        cd = c.to_dict()
        cd['decks'] = deck_map.get(c.name, [])
        card_dicts.append(cd)

    return jsonify({
        'total': total,
        'total_unique': total,
        'total_quantity': total_quantity,
        'page': page,
        'per_page': per_page,
        'pages': max(1, (total + per_page - 1) // per_page),
        'cards': card_dicts,
    })


@main.route('/api/collection/<int:card_id>', methods=['GET'])
def api_card_get(card_id):
    card = Card.query.get_or_404(card_id)
    return jsonify(card.to_dict())


@main.route('/api/collection/<int:card_id>', methods=['PUT'])
def api_card_edit(card_id):
    """Edit a collection entry's physical details."""
    card = Card.query.get_or_404(card_id)
    data = request.get_json() or {}

    for field in ('quantity', 'foil', 'condition', 'storage_location', 'purchase_price'):
        if field in data:
            setattr(card, field, data[field])

    db.session.commit()
    return jsonify(card.to_dict())


@main.route('/api/collection/<int:card_id>', methods=['DELETE'])
def api_card_delete(card_id):
    card = Card.query.get_or_404(card_id)
    db.session.delete(card)
    db.session.commit()
    return jsonify({'success': True})


@main.route('/api/collection/storage-locations')
def api_storage_locations():
    """Return all distinct storage location values for use in filter dropdowns."""
    rows = (
        db.session.query(Card.storage_location)
        .filter(Card.storage_location != None, Card.storage_location != '')
        .distinct()
        .order_by(Card.storage_location)
        .all()
    )
    return jsonify([r[0] for r in rows])


# ── Scryfall passthrough API ──────────────────────────────────────────────────

@main.route('/api/scryfall/card/<scryfall_id>')
def api_scryfall_card(scryfall_id):
    """Proxy a Scryfall card lookup (keeps API calls server-side)."""
    card = scryfall_client.get_card_by_id(scryfall_id)
    if card is None:
        return jsonify({'error': 'Card not found'}), 404
    return jsonify(card)


# ── Import API ────────────────────────────────────────────────────────────────

@main.route('/api/import/collection', methods=['POST'])
def api_import_collection():
    data = request.get_json() or {}
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': 'No card list provided'}), 400

    result = importer.import_collection(
        text=text,
        default_condition=data.get('condition', 'NM'),
        default_storage=data.get('storage', ''),
        default_purchase_price=data.get('purchase_price') or None,
    )
    return jsonify(result)


@main.route('/api/import/deck', methods=['POST'])
def api_import_deck():
    data = request.get_json() or {}
    text = data.get('text', '').strip()
    name = data.get('name', '').strip()
    if not text:
        return jsonify({'error': 'No decklist or URL provided'}), 400
    if not name and 'archidekt.com' not in text:
        return jsonify({'error': 'Deck name is required'}), 400

    result = importer.import_deck(
        text=text,
        deck_name=name,
        deck_format=data.get('format', ''),
        description=data.get('description', ''),
        add_to_collection=data.get('add_to_collection', True),
        collection_storage=data.get('storage', ''),
    )
    return jsonify(result)


# ── PRISM Overlap API ─────────────────────────────────────────────────────────

@main.route('/api/prism/shared')
def api_prism_shared():
    """Returns cards that appear in 2 or more decks for PRISM modular system."""
    shared = (
        db.session.query(
            DeckCard.name,
            db.func.count(db.func.distinct(DeckCard.deck_id)).label('deck_count')
        )
        .group_by(DeckCard.name)
        .having(db.func.count(db.func.distinct(DeckCard.deck_id)) >= 2)
        .all()
    )
    result = []
    for s in shared:
        dc_entries = DeckCard.query.filter_by(name=s[0]).all()
        decks = [{'id': dc.deck_id, 'name': dc.deck.name, 'is_commander': dc.is_commander} for dc in dc_entries]
        card = Card.query.filter_by(name=s[0]).first()
        result.append({
            'name': s[0],
            'deck_count': s[1],
            'decks': decks,
            'card': card.to_dict() if card else None,
        })
    return jsonify(result)


# ── Decks API ─────────────────────────────────────────────────────────────────

@main.route('/api/decks')
def api_decks():
    decks = Deck.query.order_by(Deck.created_at.desc()).all()
    return jsonify([d.to_dict() for d in decks])


@main.route('/api/decks/<int:deck_id>')
def api_deck_detail(deck_id):
    deck = Deck.query.get_or_404(deck_id)
    cards = DeckCard.query.filter_by(deck_id=deck_id).all()
    return jsonify({**deck.to_dict(), 'cards': [c.to_dict() for c in cards]})


@main.route('/api/decks/<int:deck_id>', methods=['DELETE'])
def api_deck_delete(deck_id):
    deck = Deck.query.get_or_404(deck_id)
    db.session.delete(deck)
    db.session.commit()
    return jsonify({'success': True})


# ── Stats API ─────────────────────────────────────────────────────────────────

@main.route('/api/stats')
def api_stats():
    """Quick stats and total collection valuation for the navbar."""
    from . import pricing
    cad_rate = pricing.get_usd_to_cad_rate()

    total_cards = db.session.query(db.func.sum(Card.quantity)).scalar() or 0
    unique_cards = Card.query.count()
    total_decks = Deck.query.count()

    # Calculate total collection market value in USD and CAD
    all_cards = Card.query.all()
    total_value_usd = 0.0
    for c in all_cards:
        qty = c.quantity or 1
        card_price = None
        if c.foil:
            card_price = c.price_usd_foil if c.price_usd_foil is not None else c.price_usd
        else:
            card_price = c.price_usd if c.price_usd is not None else c.price_usd_foil
        if card_price is not None:
            total_value_usd += card_price * qty

    total_value_cad = round(total_value_usd * cad_rate, 2)
    total_value_usd = round(total_value_usd, 2)

    return jsonify({
        'total_cards': total_cards,
        'unique_cards': unique_cards,
        'total_decks': total_decks,
        'total_value_usd': total_value_usd,
        'total_value_cad': total_value_cad,
        'total_value_usd_fmt': f"${total_value_usd:,.2f}",
        'total_value_cad_fmt': f"C${total_value_cad:,.2f}",
        'usd_cad_rate': cad_rate,
    })


# ── Pricing & Valuation APIs ──────────────────────────────────────────────────

@main.route('/api/currency')
def api_currency():
    """Return the current live USD-to-CAD exchange rate."""
    from . import pricing
    rate = pricing.get_usd_to_cad_rate()
    return jsonify({
        'from': 'USD',
        'to': 'CAD',
        'rate': rate,
    })


@main.route('/api/collection/refresh-prices', methods=['POST'])
def api_refresh_prices():
    """
    Fetch updated prices from Scryfall for all cards in the collection,
    update market prices across the top 3 US markets, and convert to CAD.
    """
    from datetime import datetime
    from . import pricing
    cad_rate = pricing.get_usd_to_cad_rate()

    cards = Card.query.all()
    if not cards:
        return jsonify({'updated': 0, 'message': 'No cards to update'})

    # Batch lookup cards via Scryfall collection endpoint
    entries = []
    card_by_scryfall = {}
    for c in cards:
        if c.scryfall_id:
            entries.append({'scryfall_id': c.scryfall_id})
            card_by_scryfall[c.scryfall_id] = c
        else:
            entries.append({'name': c.name, 'set_code': c.set_code})

    card_map = scryfall_client.lookup_cards_bulk(entries)

    updated_count = 0
    now = datetime.utcnow()

    for c in cards:
        flat = None
        if c.scryfall_id and c.scryfall_id in card_map:
            flat = card_map[c.scryfall_id]
        elif (c.name.lower(), c.set_code) in card_map:
            flat = card_map[(c.name.lower(), c.set_code)]
        elif (c.name.lower(), None) in card_map:
            flat = card_map[(c.name.lower(), None)]

        if flat:
            c.price_usd = flat.get('price_usd')
            c.price_usd_foil = flat.get('price_usd_foil')
            c.price_cardkingdom = flat.get('price_cardkingdom')
            c.price_market3 = flat.get('price_market3')
            
            # Recalculate CAD
            active_usd = c.price_usd_foil if (c.foil and c.price_usd_foil) else c.price_usd
            c.price_cad = round(active_usd * cad_rate, 2) if active_usd is not None else None
            c.prices_updated_at = now
            updated_count += 1

    db.session.commit()
    return jsonify({
        'success': True,
        'updated': updated_count,
        'rate_usd_cad': cad_rate,
        'message': f'Successfully updated market prices for {updated_count} cards.',
    })


# ── PRISM Sync API ────────────────────────────────────────────────────────────

@main.route('/api/prism/sync-data')
def api_prism_sync_data():
    """
    Returns all decks and cards from the database formatted for the PRISM tool.
    Allows 1-click import into the PRISM Sleeve Marking app.
    """
    decks = Deck.query.order_by(Deck.name).all()
    deck_list = []
    
    # Palette of distinctive colors for PRISM sleeve marking
    default_colors = [
        '#EEB41B', '#E54D2E', '#3E63DD', '#46A758', '#AB4ABA',
        '#00A2C7', '#F76B15', '#9E5CF2', '#FFDC00', '#2B9A66'
    ]

    for idx, d in enumerate(decks):
        deck_cards = DeckCard.query.filter_by(deck_id=d.id).all()
        commanders = [c.name for c in deck_cards if c.is_commander]
        commander_name = commanders[0] if commanders else ''
        commander_2 = commanders[1] if len(commanders) > 1 else ''

        # Build card text
        lines = []
        for dc in deck_cards:
            lines.append(f"{dc.quantity} {dc.name}")
        deck_text = "\n".join(lines)

        deck_list.append({
            'id': d.id,
            'name': d.name,
            'commander': commander_name,
            'commander2': commander_2,
            'hasTwoCommanders': bool(commander_2),
            'bracket': 2,
            'color': default_colors[idx % len(default_colors)],
            'list': deck_text,
            'cards': [{'name': dc.name, 'quantity': dc.quantity, 'isCommander': dc.is_commander} for dc in deck_cards]
        })

    return jsonify({
        'decks': deck_list,
        'count': len(deck_list),
    })
