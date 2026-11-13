from datetime import datetime

from flask import Blueprint, jsonify, render_template, request, redirect, url_for
from sqlalchemy import or_
from sqlalchemy.exc import OperationalError

from . import db
from . import edhrec as edhrec_client
from . import importer
from . import pricing
from . import scryfall as scryfall_client
from .models import Card, Deck, DeckCard

main = Blueprint('main', __name__)


@main.app_errorhandler(OperationalError)
def _handle_missing_tables(err):
    """Recreate tables if data/collection.db was deleted while the app was running."""
    db.session.rollback()
    if 'no such table' in str(err).lower():
        db.create_all()
        return jsonify({'error': 'The database was re-created. Reload the page.'}), 503
    raise err


def _int_arg(name, default, minimum=None, maximum=None):
    """Integer query parameter with a default for missing/invalid values, clamped to a range."""
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _str_field(data, key):
    """String field from a JSON body, stripped; '' when missing, null or not text."""
    value = data.get(key) if isinstance(data, dict) else None
    return value.strip() if isinstance(value, str) else ''


def _to_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


_WUBRG = ('W', 'U', 'B', 'R', 'G')


def _parse_color_identity(value):
    """Parse "W,U" / ["W","U"] / None into a set of WUBRG letters."""
    if value is None:
        return set()
    if isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        parts = str(value).split(',')
    result = set()
    for p in parts:
        c = str(p).strip().upper()
        if c in _WUBRG:
            result.add(c)
    return result


def _get_commander_identity(deck):
    """Commander colour identity set for a Deck, or None if no commander set."""
    try:
        return deck.commander_color_identity()
    except Exception:
        # Fallback for databases created before DeckCard.color_identity existed
        cmds = DeckCard.query.filter_by(deck_id=deck.id, is_commander=True).all()
        if not cmds:
            return None
        identity = set()
        for dc in cmds:
            col = Card.query.filter_by(name=dc.name).first()
            if col is not None and col.color_identity:
                identity.update(_parse_color_identity(col.color_identity))
            elif dc.colors:
                identity.update(_parse_color_identity(dc.colors))
        return identity


def _deck_card_identity(dc):
    """Colour identity of a DeckCard: stored value, else the collection row, else its colours."""
    if (dc.color_identity or '').strip():
        return _parse_color_identity(dc.color_identity)
    col = Card.query.filter_by(name=dc.name).first()
    if col is not None and col.color_identity is not None:
        return _parse_color_identity(col.color_identity)
    return _parse_color_identity(dc.colors)


def _is_commander_deck(deck):
    try:
        return deck.is_commander_format()
    except Exception:
        fmt = (deck.format or '').strip().lower()
        return 'commander' in fmt or 'edh' in fmt or not fmt or fmt.isdigit()


def _color_identity_legal(card_identity, commander_identity):
    """True when card_identity is a subset of commander_identity (colourless ⊆ anything)."""
    if commander_identity is None:
        return True
    return set(card_identity or set()).issubset(set(commander_identity or set()))


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


@main.route('/sorting')
@main.route('/build')
def sorting_builder_page():
    return render_template('sorting.html')


# ── Collection API ────────────────────────────────────────────────────────────

@main.route('/api/collection')
def api_collection():
    """Search the collection, one entry per card name.

    Query params:
        q         substring of name, type line or oracle text
        color     comma-separated colour-identity letters the card must include
                  (e.g. "W,U"); "C" means colourless
        set_code  exact set code, e.g. "MH3"
        rarity    common | uncommon | rare | mythic
        foil      true | false
        storage   storage-location substring
        in_deck   shared (in 2+ decks) | unassigned (in no deck) |
                  deck:<id> | storage:<exact location>
        sort      name | price | quantity | cmc | rarity | added_at (default name)
        order     asc | desc (default asc)
        page      1-based page (default 1)
        per_page  default 60, max 1000

    Rows sharing a name are merged: ``quantity`` is the total, ``printings``
    lists every row, and the display row prefers a foil copy with an image.
    """
    q = request.args.get('q', '').strip()
    color = request.args.get('color', '').strip()
    set_code = request.args.get('set_code', '').strip().upper()
    rarity = request.args.get('rarity', '').strip().lower()
    foil = request.args.get('foil', '').strip().lower()
    storage = request.args.get('storage', '').strip()
    sort_by = request.args.get('sort', 'name')
    order = 'desc' if request.args.get('order', 'asc').lower() == 'desc' else 'asc'
    page = _int_arg('page', 1, minimum=1)
    per_page = _int_arg('per_page', 60, minimum=1, maximum=1000)
    in_deck = request.args.get('in_deck', '').strip()

    query = Card.query
    if q:
        like = f'%{q}%'
        query = query.filter(or_(Card.name.ilike(like), Card.type_line.ilike(like), Card.oracle_text.ilike(like)))
    for c in (part.strip().upper() for part in color.split(',') if part.strip()):
        if c == 'C':
            query = query.filter(or_(Card.color_identity.is_(None), Card.color_identity == ''))
        elif c in _WUBRG:
            query = query.filter(Card.color_identity.contains(c))
    if set_code:
        query = query.filter(Card.set_code == set_code)
    if rarity:
        query = query.filter(Card.rarity == rarity)
    if foil == 'true':
        query = query.filter(Card.foil.is_(True))
    elif foil == 'false':
        query = query.filter(Card.foil.is_(False))
    if storage:
        query = query.filter(Card.storage_location.ilike(f'%{storage}%'))

    if in_deck == 'shared':
        shared_names = (
            db.select(DeckCard.name)
            .group_by(DeckCard.name)
            .having(db.func.count(db.func.distinct(DeckCard.deck_id)) >= 2)
        )
        query = query.filter(Card.name.in_(shared_names))
    elif in_deck == 'unassigned':
        query = query.filter(~Card.name.in_(db.select(DeckCard.name).distinct()))
    elif in_deck.startswith('storage:'):
        query = query.filter(Card.storage_location == in_deck.split(':', 1)[1])
    elif in_deck.startswith('deck:') or in_deck.isdigit():
        deck_id = _to_int(in_deck.split(':', 1)[-1])
        if deck_id is not None:
            query = query.filter(Card.name.in_(db.select(DeckCard.name).where(DeckCard.deck_id == deck_id)))

    # Group printings by name
    grouped = {}
    for c in query.all():
        grouped.setdefault(c.name, []).append(c)

    rate = pricing.get_usd_to_cad_rate()
    rarity_rank = {'common': 1, 'uncommon': 2, 'rare': 3, 'mythic': 4}
    groups = []
    for name, copies in grouped.items():
        primary = (next((c for c in copies if c.foil and c.image_uri), None)
                   or next((c for c in copies if c.image_uri), copies[0]))
        groups.append({
            'name': name,
            'primary': primary,
            'copies': copies,
            'quantity': sum(c.quantity or 0 for c in copies),
            'added_at': max((c.added_at for c in copies if c.added_at), default=None),
        })

    sort_keys = {
        'name': lambda g: g['name'].lower(),
        'price': lambda g: pricing.active_usd_price(g['primary']) or 0.0,
        'quantity': lambda g: g['quantity'],
        'cmc': lambda g: g['primary'].cmc or 0.0,
        'rarity': lambda g: rarity_rank.get((g['primary'].rarity or '').lower(), 0),
        'added_at': lambda g: g['added_at'] or datetime.min,
    }
    groups.sort(key=sort_keys.get(sort_by, sort_keys['name']), reverse=(order == 'desc'))

    total_unique = len(groups)
    total_quantity = sum(g['quantity'] for g in groups)
    page_groups = groups[(page - 1) * per_page: page * per_page]

    # Deck memberships for the cards on this page (one query)
    deck_map = {}
    names = [g['name'] for g in page_groups]
    if names:
        rows = (
            db.session.query(DeckCard.name, DeckCard.deck_id, DeckCard.is_commander, Deck.name)
            .join(Deck, Deck.id == DeckCard.deck_id)
            .filter(DeckCard.name.in_(names))
            .all()
        )
        for card_name, deck_id, is_cmd, deck_name in rows:
            deck_map.setdefault(card_name, []).append({'id': deck_id, 'name': deck_name, 'is_commander': is_cmd})

    cards = []
    for g in page_groups:
        copies = g['copies']
        cd = g['primary'].to_dict(rate)
        storage_locs = list(dict.fromkeys(c.storage_location for c in copies if c.storage_location))
        cd.update({
            'quantity': g['quantity'],
            'foil': any(c.foil for c in copies),
            'printings_count': len(copies),
            'printings': [{
                'id': c.id,
                'scryfall_id': c.scryfall_id,
                'set_code': c.set_code,
                'set_name': c.set_name,
                'collector_number': c.collector_number,
                'quantity': c.quantity,
                'foil': c.foil,
                'condition': c.condition or 'NM',
                'storage_location': c.storage_location or '',
                'price_usd': pricing.active_usd_price(c),
                'image_uri': c.image_uri,
            } for c in copies],
            'sets': list(dict.fromkeys(c.set_code for c in copies if c.set_code)),
            'storage_locations': storage_locs,
            'storage_location': ', '.join(storage_locs),
            'decks': deck_map.get(g['name'], []),
        })
        cards.append(cd)

    return jsonify({
        'total': total_unique,
        'total_unique': total_unique,
        'total_quantity': total_quantity,
        'page': page,
        'per_page': per_page,
        'pages': max(1, (total_unique + per_page - 1) // per_page),
        'cards': cards,
    })


@main.route('/api/collection/<int:card_id>', methods=['GET'])
def api_card_get(card_id):
    card = Card.query.get_or_404(card_id)
    return jsonify(card.to_dict())


@main.route('/api/collection/<int:card_id>', methods=['PUT'])
def api_card_edit(card_id):
    """Edit one printing row: quantity (≥ 1), foil, condition, storage_location, purchase_price."""
    card = Card.query.get_or_404(card_id)
    data = request.get_json() or {}

    if 'quantity' in data:
        qty = _to_int(data['quantity'])
        if qty is None or qty < 1:
            return jsonify({'error': 'Quantity must be a whole number of at least 1 (delete the printing to remove it).'}), 400
        card.quantity = qty
    if 'foil' in data:
        card.foil = bool(data['foil'])
    if 'condition' in data:
        card.condition = (str(data['condition'] or '').strip().upper() or 'NM')[:10]
    if 'storage_location' in data:
        card.storage_location = (str(data['storage_location'] or '').strip() or None)
    if 'purchase_price' in data:
        try:
            card.purchase_price = float(data['purchase_price']) if data['purchase_price'] not in (None, '') else None
        except (TypeError, ValueError):
            return jsonify({'error': 'purchase_price must be a number'}), 400

    db.session.commit()
    return jsonify(card.to_dict())


@main.route('/api/collection/<int:card_id>', methods=['DELETE'])
def api_card_delete(card_id):
    """Delete one printing row.

    If no copies of the name remain, the card is also removed from every deck
    (decks may only contain owned cards). Removing a card from a deck never
    changes the collection.
    """
    card = Card.query.get_or_404(card_id)
    card_name = card.name
    db.session.delete(card)
    db.session.flush()

    remaining = Card.query.filter_by(name=card_name).count()
    removed_from_decks = 0
    if remaining == 0:
        removed_from_decks = (
            DeckCard.query.filter_by(name=card_name).delete(synchronize_session=False)
        )

    db.session.commit()
    return jsonify({
        'success': True,
        'removed_from_decks': removed_from_decks,
    })


def _bulk_delete_cards(data):
    """Remove copies from many printing rows; see :func:`api_card_bulk_delete`."""
    items = data.get('items') if isinstance(data, dict) else None
    if not isinstance(items, list):
        ids = data.get('ids') if isinstance(data, dict) else None
        items = [{'printing_id': i} for i in ids] if isinstance(ids, list) else []

    removed_copies = 0
    removed_printings = 0
    updated_printings = 0
    touched_names = set()
    details = []
    skipped = []

    for item in items:
        if not isinstance(item, dict):
            item = {'printing_id': item}
        card = db.session.get(Card, _to_int(item.get('printing_id'), -1))
        if card is None:
            skipped.append(item.get('printing_id'))
            continue

        owned = card.quantity or 0
        want = _to_int(item.get('quantity'))
        remove_qty = owned if want is None else max(0, min(want, owned))
        touched_names.add(card.name)

        if remove_qty >= owned:
            db.session.delete(card)
            removed_printings += 1
            details.append({'name': card.name, 'printing_id': card.id, 'removed': owned, 'action': 'deleted'})
        elif remove_qty > 0:
            card.quantity = owned - remove_qty
            updated_printings += 1
            details.append({'name': card.name, 'printing_id': card.id, 'removed': remove_qty,
                            'remaining': card.quantity, 'action': 'decremented'})
        removed_copies += min(remove_qty, owned)

    db.session.flush()
    names_gone = []
    if touched_names:
        still_owned = {n for (n,) in db.session.query(Card.name).filter(Card.name.in_(touched_names)).distinct()}
        names_gone = sorted(touched_names - still_owned)
    removed_from_decks = 0
    if names_gone:
        removed_from_decks = DeckCard.query.filter(DeckCard.name.in_(names_gone)).delete(synchronize_session=False)

    db.session.commit()
    return {
        'success': True,
        'removed_copies': removed_copies,
        'removed_printings': removed_printings,
        'updated_printings': updated_printings,
        'removed_from_decks': removed_from_decks,
        'names_gone': names_gone,
        'skipped': skipped,
        'details': details,
    }


@main.route('/api/collection/bulk-delete', methods=['POST'])
def api_card_bulk_delete():
    """Remove copies from many printings at once.

    Body: ``{"items": [{"printing_id": 12, "quantity": 2}, ...]}`` or
    ``{"ids": [12, 13]}``. ``quantity`` is how many copies to remove from that
    row (default: all). Names with no copies left are removed from decks too.
    """
    return jsonify(_bulk_delete_cards(request.get_json(silent=True) or {}))


@main.route('/api/collection/storage-locations')
def api_storage_locations():
    """Distinct storage locations, for the collection filter dropdown."""
    rows = (
        db.session.query(Card.storage_location)
        .filter(Card.storage_location != None, Card.storage_location != '')
        .distinct()
        .order_by(Card.storage_location)
        .all()
    )
    return jsonify([r[0] for r in rows])


# ── Scryfall proxy ────────────────────────────────────────────────────────────

@main.route('/api/scryfall/card/<scryfall_id>')
def api_scryfall_card(scryfall_id):
    """Full Scryfall card object by ID (cached per process), for the card modal."""
    card = scryfall_client.get_card_by_id(scryfall_id)
    if card is None:
        return jsonify({'error': 'Card not found'}), 404
    return jsonify(card)


# ── Import API ────────────────────────────────────────────────────────────────

@main.route('/api/import/collection', methods=['POST'])
def api_import_collection():
    """Import a card list: ``{text, storage?}``."""
    data = request.get_json(silent=True) or {}
    text = _str_field(data, 'text')
    if not text:
        return jsonify({'error': 'No card list provided'}), 400

    result = importer.import_collection(
        text=text,
        default_storage=_str_field(data, 'storage'),
    )
    return jsonify(result)


@main.route('/api/import/deck', methods=['POST'])
def api_import_deck():
    """Import a deck: ``{text (list or Archidekt URL), name, format, description, add_to_collection, storage}``."""
    data = request.get_json(silent=True) or {}
    text = _str_field(data, 'text')
    name = _str_field(data, 'name')
    if not text:
        return jsonify({'error': 'No decklist or URL provided'}), 400
    if not name and 'archidekt.com' not in text:
        return jsonify({'error': 'Deck name is required'}), 400

    result = importer.import_deck(
        text=text,
        deck_name=name,
        deck_format=_str_field(data, 'format') or 'Commander',
        description=_str_field(data, 'description'),
        add_to_collection=bool(data.get('add_to_collection', True)),
        collection_storage=_str_field(data, 'storage'),
    )
    if result.get('deck_id') is None:
        # Nothing was created (unreachable Archidekt deck, no card lines…)
        return jsonify({**result, 'error': '; '.join(result.get('errors') or []) or 'Deck could not be imported.'}), 400
    return jsonify(result)


# ── SORTING API ───────────────────────────────────────────────────────────────

@main.route('/api/sorting/shared')
def api_sorting_shared():
    """Cards that appear in 2 or more decks (the SORTING Pool)."""
    shared = (
        db.session.query(DeckCard.name, db.func.count(db.func.distinct(DeckCard.deck_id)))
        .group_by(DeckCard.name)
        .having(db.func.count(db.func.distinct(DeckCard.deck_id)) >= 2)
        .all()
    )
    if not shared:
        return jsonify([])
    names = [name for name, _ in shared]

    decks_by_name = {}
    rows = (
        db.session.query(DeckCard.name, DeckCard.deck_id, DeckCard.is_commander, Deck.name)
        .join(Deck, Deck.id == DeckCard.deck_id)
        .filter(DeckCard.name.in_(names))
        .all()
    )
    for card_name, deck_id, is_cmd, deck_name in rows:
        decks_by_name.setdefault(card_name, []).append({'id': deck_id, 'name': deck_name, 'is_commander': is_cmd})

    owned = {}
    for c in Card.query.filter(Card.name.in_(names)).order_by(Card.id).all():
        owned.setdefault(c.name, c)

    rate = pricing.get_usd_to_cad_rate()
    return jsonify([{
        'name': name,
        'deck_count': count,
        'decks': decks_by_name.get(name, []),
        'card': owned[name].to_dict(rate) if name in owned else None,
    } for name, count in shared])


# ── Decks API ─────────────────────────────────────────────────────────────────

@main.route('/api/decks')
def api_decks():
    """All decks, newest first, with size checks."""
    decks = Deck.query.order_by(Deck.created_at.desc()).all()
    return jsonify([d.to_dict() for d in decks])


@main.route('/api/decks', methods=['POST'])
def api_deck_create():
    """Create an empty deck: ``{name, format?, description?}`` (format defaults to Commander)."""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Deck name is required'}), 400
    fmt_raw = data.get('format')
    fmt = fmt_raw.strip() if isinstance(fmt_raw, str) else (str(fmt_raw).strip() if fmt_raw is not None else '')
    deck_format = fmt if fmt and not fmt.isdigit() else 'Commander'
    description = data.get('description') or ''
    deck = Deck(name=name, format=deck_format, description=description)
    db.session.add(deck)
    db.session.commit()
    return jsonify(deck.to_dict()), 201


@main.route('/api/decks/<int:deck_id>')
def api_deck_detail(deck_id):
    """Deck summary plus every DeckCard."""
    deck = Deck.query.get_or_404(deck_id)
    cards = DeckCard.query.filter_by(deck_id=deck_id).all()
    return jsonify({**deck.to_dict(), 'cards': [c.to_dict() for c in cards]})


@main.route('/api/decks/<int:deck_id>', methods=['DELETE'])
def api_deck_delete(deck_id):
    """Delete a deck and its slots (collection cards are untouched)."""
    deck = Deck.query.get_or_404(deck_id)
    db.session.delete(deck)
    db.session.commit()
    return jsonify({'success': True})


@main.route('/api/decks/<int:deck_id>', methods=['PUT'])
def api_deck_edit(deck_id):
    """Update deck name, format, or description."""
    deck = Deck.query.get_or_404(deck_id)
    data = request.get_json() or {}

    if 'name' in data:
        name = str(data['name'] or '').strip()
        if not name:
            return jsonify({'error': 'Deck name cannot be empty'}), 400
        deck.name = name

    if 'format' in data:
        _fmt = (data['format'] or '').strip() if isinstance(data['format'], str) else str(data['format']).strip()
        deck.format = _fmt if _fmt and not _fmt.isdigit() else 'Commander'

    if 'description' in data:
        deck.description = data['description']

    db.session.commit()
    return jsonify(deck.to_dict())


@main.route('/api/decks/<int:deck_id>/cards', methods=['POST'])
def api_deck_card_add(deck_id):
    """Add an owned card to a deck.

    Body: ``{name, quantity?, is_commander?, is_sideboard?, collection_card_id?}``.
    ``collection_card_id`` pins the printing (set, art) shown in the deck. Cards
    not in the collection are rejected, and in Commander decks non-commander
    cards must fit the commander's colour identity. Adding a card already in
    the same section increases its quantity.
    """
    deck = Deck.query.get_or_404(deck_id)
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()

    # A pinned printing takes precedence over the name
    col_card = None
    printing_id = _to_int(data.get('collection_card_id') or data.get('printing_id'))
    if printing_id is not None:
        col_card = db.session.get(Card, printing_id)
    if col_card is None and name:
        col_card = Card.query.filter_by(name=name).order_by(Card.id).first()
    if col_card is None:
        if not name:
            return jsonify({'error': 'Card name required'}), 400
        return jsonify({'error': f'"{name}" is not in your collection. Decks can only use cards you own.'}), 400
    name = col_card.name

    qty = max(1, _to_int(data.get('quantity'), 1))
    is_cmd = bool(data.get('is_commander', False))
    is_sb = bool(data.get('is_sideboard', False)) and not is_cmd

    # Colour identity applies to the 99; commanders define the identity themselves.
    if _is_commander_deck(deck) and not is_cmd:
        commander_identity = _get_commander_identity(deck)
        card_identity = _parse_color_identity(col_card.color_identity)
        if not _color_identity_legal(card_identity, commander_identity):
            allowed = ', '.join(sorted(commander_identity)) or 'colourless'
            card_id_str = ', '.join(sorted(card_identity)) or 'colourless'
            return jsonify({
                'error': f'"{name}" ({card_id_str}) is not legal in this deck — commander colour identity is {allowed}.',
                'code': 'color_identity',
                'card_color_identity': sorted(card_identity),
                'commander_color_identity': sorted(commander_identity),
            }), 400

    printing = {
        'scryfall_id': col_card.scryfall_id,
        'set_code': col_card.set_code,
        'image_uri': col_card.image_uri,
        'type_line': col_card.type_line,
        'mana_cost': col_card.mana_cost,
        'colors': col_card.colors,
        'color_identity': col_card.color_identity,
    }

    existing = DeckCard.query.filter_by(deck_id=deck_id, name=name, is_commander=is_cmd, is_sideboard=is_sb).first()
    if existing:
        existing.quantity += qty
        for field, value in printing.items():
            if value is not None:
                setattr(existing, field, value)
        db.session.commit()
        return jsonify(existing.to_dict())

    dc = DeckCard(deck_id=deck_id, name=name, quantity=qty, is_commander=is_cmd, is_sideboard=is_sb, **printing)
    db.session.add(dc)
    db.session.commit()
    return jsonify(dc.to_dict()), 201


@main.route('/api/decks/<int:deck_id>/cards/<int:card_id>', methods=['PUT'])
def api_deck_card_edit(deck_id, card_id):
    """Change a deck card's quantity (0 removes it) or its section.

    Body: ``{quantity?, is_commander?, is_sideboard?}``. Moving a card into the
    mainboard of a Commander deck is rejected if it is outside the colour
    identity of the remaining commanders.
    """
    dc = DeckCard.query.filter_by(id=card_id, deck_id=deck_id).first_or_404()
    data = request.get_json() or {}

    if 'quantity' in data:
        q = _to_int(data['quantity'])
        if q is None:
            return jsonify({'error': 'Quantity must be a whole number'}), 400
        if q <= 0:
            db.session.delete(dc)
            db.session.commit()
            return jsonify({'deleted': True})
        dc.quantity = q

    # Target section after this edit (commander takes precedence over sideboard)
    new_cmd = bool(data['is_commander']) if 'is_commander' in data else dc.is_commander
    new_sb = (bool(data['is_sideboard']) if 'is_sideboard' in data else dc.is_sideboard) and not new_cmd

    # A card entering the mainboard (from the sideboard, or a demoted commander)
    # must fit the colour identity of the commanders that remain.
    entering_mainboard = not new_cmd and not new_sb and (dc.is_commander or dc.is_sideboard)
    if entering_mainboard:
        deck = db.session.get(Deck, deck_id)
        if deck is not None and _is_commander_deck(deck):
            other_cmds = DeckCard.query.filter(
                DeckCard.deck_id == deck_id,
                DeckCard.is_commander.is_(True),
                DeckCard.id != card_id,
            ).all()
            if other_cmds:
                remaining_identity = set()
                for other in other_cmds:
                    remaining_identity |= _deck_card_identity(other)
                card_identity = _deck_card_identity(dc)
                if not _color_identity_legal(card_identity, remaining_identity):
                    allowed = ', '.join(sorted(remaining_identity)) or 'colourless'
                    return jsonify({
                        'error': f'"{dc.name}" is not legal in the mainboard: commander colour identity is {allowed}.',
                        'code': 'color_identity',
                    }), 400

    # Moving into a section that already holds this card merges the two rows
    if (new_cmd, new_sb) != (bool(dc.is_commander), bool(dc.is_sideboard)):
        target = DeckCard.query.filter(
            DeckCard.deck_id == deck_id,
            DeckCard.name == dc.name,
            DeckCard.is_commander == new_cmd,
            DeckCard.is_sideboard == new_sb,
            DeckCard.id != dc.id,
        ).first()
        if target is not None:
            target.quantity = (target.quantity or 0) + (dc.quantity or 0)
            db.session.delete(dc)
            db.session.commit()
            return jsonify({**target.to_dict(), 'merged_from': card_id})

    dc.is_commander = new_cmd
    dc.is_sideboard = new_sb

    db.session.commit()
    return jsonify(dc.to_dict())


@main.route('/api/decks/<int:deck_id>/cards/<int:card_id>', methods=['DELETE'])
def api_deck_card_delete(deck_id, card_id):
    """Remove a card from a deck (the collection is unchanged)."""
    dc = DeckCard.query.filter_by(id=card_id, deck_id=deck_id).first_or_404()
    db.session.delete(dc)
    db.session.commit()
    return jsonify({'success': True})


@main.route('/api/decks/<int:deck_id>/recommendations')
def api_deck_recommendations(deck_id):
    """EDHREC-ranked recommendations drawn only from cards you own.

    Looks up the deck's commander(s) on EDHREC, keeps the cards that are in
    your collection, colour-legal and not already in this deck, and sorts
    them by ``sort``:

    - ``top`` (default): EDHREC inclusion % — share of this commander's decks
      that run the card ("Top Cards"), ties broken by synergy
    - ``synergy``: EDHREC synergy score (how much more often the card shows up
      with this commander than in other decks of its colours)
    - ``decks``: raw number of EDHREC decks running it
    - ``name``: alphabetical

    ``category=<header>`` narrows to one EDHREC list (e.g. "High Synergy
    Cards", "Creatures"); ``refresh=1`` bypasses the 7-day cache.
    """
    deck = Deck.query.get_or_404(deck_id)
    sort = (request.args.get('sort') or 'top').strip().lower()
    category = (request.args.get('category') or '').strip()
    force = request.args.get('refresh', '').strip().lower() in ('1', 'true', 'yes')

    base = {
        'deck_id': deck.id,
        'commanders': [],
        'sort': sort,
        'category': category,
        'categories': [],
        'cards': [],
        'edhrec_total': 0,
        'owned_matches': 0,
        'source_url': None,
        'fetched_at': None,
        'stale': False,
        'error': None,
    }

    if not _is_commander_deck(deck):
        base['error'] = 'EDHREC recommendations are only available for Commander decks.'
        return jsonify(base)

    commanders = DeckCard.query.filter_by(deck_id=deck.id, is_commander=True).order_by(DeckCard.id).all()
    commander_names = [c.name for c in commanders]
    base['commanders'] = commander_names
    if not commander_names:
        base['error'] = 'Set a commander (👑) to get EDHREC recommendations.'
        return jsonify(base)

    rec = edhrec_client.get_recommendations(commander_names, force_refresh=force)
    base.update({
        'source_url': rec['source_url'],
        'fetched_at': rec['fetched_at'],
        'stale': rec['stale'],
        'error': rec['error'],
        'edhrec_total': len(rec['cards']),
    })
    if not rec['cards']:
        return jsonify(base)

    # Cards already in this deck (any slot) are not recommended again
    in_deck = {edhrec_client.name_key(dc.name) for dc in deck.cards.all()}
    commander_identity = _get_commander_identity(deck)

    # Index the whole collection by normalised name → printing rows
    owned = {}
    for c in Card.query.order_by(Card.name).all():
        owned.setdefault(edhrec_client.name_key(c.name), []).append(c)

    # How many of your other decks already run each card (SORTING pool hint)
    other_deck_counts = {}
    rows = (
        db.session.query(DeckCard.name, db.func.count(DeckCard.deck_id.distinct()))
        .filter(DeckCard.deck_id != deck.id)
        .group_by(DeckCard.name)
        .all()
    )
    for name, cnt in rows:
        key = edhrec_client.name_key(name)
        other_deck_counts[key] = other_deck_counts.get(key, 0) + cnt

    category_counts = {}
    results = []
    for entry in rec['cards']:
        key = edhrec_client.name_key(entry['name'])
        if key in in_deck:
            continue
        copies = owned.get(key)
        if not copies:
            continue
        primary = next((c for c in copies if c.foil and c.image_uri), None) \
            or next((c for c in copies if c.image_uri), copies[0])
        identity = _parse_color_identity(primary.color_identity) if primary.color_identity else set()
        if not _color_identity_legal(identity, commander_identity):
            continue

        for header in entry.get('lists') or []:
            category_counts[header] = category_counts.get(header, 0) + 1
        if category and category not in (entry.get('lists') or []):
            continue

        results.append({
            'name': primary.name,
            'edhrec_name': entry['name'],
            'inclusion': entry.get('inclusion') or 0.0,
            'synergy': entry.get('synergy'),
            'num_decks': entry.get('num_decks') or 0,
            'potential_decks': entry.get('potential_decks') or 0,
            'lists': entry.get('lists') or [],
            'edhrec_url': entry.get('edhrec_url'),
            'image_uri': primary.image_uri,
            'mana_cost': primary.mana_cost,
            'type_line': primary.type_line,
            'cmc': primary.cmc,
            'color_identity': primary.color_identity.split(',') if primary.color_identity else [],
            'total_owned': sum(c.quantity or 0 for c in copies),
            'in_other_decks': other_deck_counts.get(key, 0),
            'printings_count': len(copies),
            'printings': [{
                'id': c.id,
                'scryfall_id': c.scryfall_id,
                'set_code': c.set_code,
                'set_name': c.set_name,
                'collector_number': c.collector_number,
                'foil': bool(c.foil),
                'quantity': c.quantity or 0,
                'storage_location': c.storage_location or '',
                'image_uri': c.image_uri,
            } for c in copies],
        })

    def _syn(r):
        return r['synergy'] if r['synergy'] is not None else -1.0

    if sort == 'synergy':
        results.sort(key=lambda r: (-_syn(r), -r['inclusion'], r['name']))
    elif sort == 'decks':
        results.sort(key=lambda r: (-r['num_decks'], -r['inclusion'], r['name']))
    elif sort == 'name':
        results.sort(key=lambda r: r['name'].lower())
    else:
        base['sort'] = 'top'
        results.sort(key=lambda r: (-r['inclusion'], -_syn(r), r['name']))

    # "Top cards" rank is always by inclusion, whatever the display sort
    by_inclusion = sorted(results, key=lambda r: (-r['inclusion'], -_syn(r), r['name']))
    rank = {r['name']: i + 1 for i, r in enumerate(by_inclusion)}
    for r in results:
        r['rank'] = rank[r['name']]

    base['cards'] = results
    base['owned_matches'] = len(results)
    base['categories'] = [{'name': k, 'count': v} for k, v in category_counts.items()]
    return jsonify(base)


@main.route('/api/collection/search')
def api_collection_search():
    """Owned cards for the deck builder, one entry per name with its ``printings``.

    ``q`` matches name or type line. With ``deck_id`` an empty ``q`` browses
    the collection, and in a Commander deck with a commander set only cards
    within its colour identity are returned (``all=1`` disables this).
    Returns at most 60 names.
    """
    q = request.args.get('q', '').strip()
    deck_id = request.args.get('deck_id', '').strip()
    show_all = request.args.get('all', '').strip().lower() in ('1', 'true', 'yes')
    target_deck = None
    if deck_id and deck_id.isdigit():
        target_deck = db.session.get(Deck, int(deck_id))
    else:
        deck_id = ''

    if not q and not deck_id:
        return jsonify([])

    commander_identity = None
    if target_deck is not None and not show_all and _is_commander_deck(target_deck):
        commander_identity = _get_commander_identity(target_deck)

    query = Card.query
    if q:
        like = f'%{q}%'
        query = query.filter(or_(Card.name.ilike(like), Card.type_line.ilike(like)))
    if commander_identity is not None:
        # Exclude any card whose identity contains a colour outside the commander's
        for c in set(_WUBRG) - set(commander_identity):
            query = query.filter(or_(Card.color_identity.is_(None), ~Card.color_identity.contains(c)))
    cards = query.order_by(Card.name).limit(400).all()

    grouped = {}
    order = []
    for c in cards:
        if c.name not in grouped:
            grouped[c.name] = []
            order.append(c.name)
        grouped[c.name].append(c)

    # Owned totals across all printings (the row limit above may cut some off)
    totals = {}
    if grouped:
        rows = (
            db.session.query(Card.name, db.func.sum(Card.quantity))
            .filter(Card.name.in_(list(grouped.keys())))
            .group_by(Card.name)
            .all()
        )
        totals = {name: total or 0 for name, total in rows}

    results = []
    for name in order:
        copies = grouped[name]
        primary = next((c for c in copies if c.foil and c.image_uri), None) or next((c for c in copies if c.image_uri), copies[0])
        identity_set = _parse_color_identity(primary.color_identity) if primary.color_identity else set()
        if commander_identity is not None and not _color_identity_legal(identity_set, commander_identity):
            continue
        printings = []
        for c in copies:
            printings.append({
                'id': c.id,
                'scryfall_id': c.scryfall_id,
                'set_code': c.set_code,
                'set_name': c.set_name,
                'collector_number': c.collector_number,
                'foil': bool(c.foil),
                'quantity': c.quantity or 0,
                'storage_location': c.storage_location or '',
                'image_uri': c.image_uri,
                'colors': c.colors.split(',') if c.colors else [],
                'color_identity': c.color_identity.split(',') if c.color_identity else [],
            })
        results.append({
            'name': primary.name,
            'scryfall_id': primary.scryfall_id,
            'image_uri': primary.image_uri,
            'mana_cost': primary.mana_cost,
            'type_line': primary.type_line,
            'set_code': primary.set_code,
            'colors': primary.colors.split(',') if primary.colors else [],
            'color_identity': primary.color_identity.split(',') if primary.color_identity else [],
            'foil': any(bool(c.foil) for c in copies),
            'total_owned': totals.get(primary.name, sum(c.quantity or 0 for c in copies)),
            'printings_count': len(printings),
            'printings': printings,
        })
        if len(results) >= 60:
            break

    return jsonify(results)


# ── Stats API ─────────────────────────────────────────────────────────────────

@main.route('/api/stats')
def api_stats():
    """Navbar totals: copies, unique names, decks and collection value (USD + CAD)."""
    rate = pricing.get_usd_to_cad_rate()
    total_cards = db.session.query(db.func.sum(Card.quantity)).scalar() or 0
    unique_cards = db.session.query(db.func.count(db.func.distinct(Card.name))).scalar() or 0
    total_decks = Deck.query.count()

    rows = db.session.query(Card.quantity, Card.foil, Card.price_usd, Card.price_usd_foil).all()
    total_value_usd = 0.0
    for qty, foil, usd, usd_foil in rows:
        price = (usd_foil if usd_foil is not None else usd) if foil else (usd if usd is not None else usd_foil)
        if price is not None:
            total_value_usd += price * (qty or 0)

    total_value_usd = round(total_value_usd, 2)
    total_value_cad = round(total_value_usd * rate, 2)
    return jsonify({
        'total_cards': total_cards,
        'unique_cards': unique_cards,
        'total_decks': total_decks,
        'total_value_usd': total_value_usd,
        'total_value_cad': total_value_cad,
        'total_value_usd_fmt': f"${total_value_usd:,.2f}",
        'total_value_cad_fmt': f"C${total_value_cad:,.2f}",
        'usd_cad_rate': rate,
    })


@main.route('/api/currency')
def api_currency():
    """Current USD→CAD exchange rate."""
    return jsonify({'from': 'USD', 'to': 'CAD', 'rate': pricing.get_usd_to_cad_rate()})


@main.route('/api/collection/refresh-prices', methods=['POST'])
def api_refresh_prices():
    """Re-fetch Scryfall prices for every printing in the collection."""
    rate = pricing.get_usd_to_cad_rate()
    cards = Card.query.all()
    if not cards:
        return jsonify({'success': True, 'updated': 0, 'message': 'No cards to update.'})

    # lookup_cards_bulk sends each distinct printing once
    entries = [
        {'scryfall_id': c.scryfall_id} if c.scryfall_id else {'name': c.name, 'set_code': c.set_code}
        for c in cards
    ]
    card_map = scryfall_client.lookup_cards_bulk(entries)

    updated_count = 0
    now = datetime.utcnow()
    for c in cards:
        flat = (card_map.get(c.scryfall_id) if c.scryfall_id else None) \
            or card_map.get((c.name.lower(), c.set_code)) \
            or card_map.get((c.name.lower(), None))
        if not flat:
            continue
        c.price_usd = flat.get('price_usd')
        c.price_usd_foil = flat.get('price_usd_foil')
        c.price_market3 = flat.get('price_market3')
        active = pricing.active_usd_price(c)
        c.price_cad = round(active * rate, 2) if active is not None else None
        c.prices_updated_at = now
        updated_count += 1

    db.session.commit()
    return jsonify({
        'success': True,
        'updated': updated_count,
        'rate_usd_cad': rate,
        'message': f'Updated prices for {updated_count} of {len(cards)} printings.',
    })


# ── SORTING sync API ──────────────────────────────────────────────────────────

@main.route('/api/sorting/sync-data')
def api_sorting_sync_data():
    """Every deck with its card list, for the SORTING builder's "Load from Local Collection".

    Stripe colours are not assigned here: the SORTING page gives each deck the
    palette colour matching its slot number.
    """
    decks = Deck.query.order_by(Deck.name).all()
    cards_by_deck = {}
    for dc in DeckCard.query.order_by(DeckCard.id).all():
        cards_by_deck.setdefault(dc.deck_id, []).append(dc)

    deck_list = []
    for d in decks:
        deck_cards = cards_by_deck.get(d.id, [])
        commanders = [c.name for c in deck_cards if c.is_commander]
        deck_list.append({
            'id': d.id,
            'name': d.name,
            'commander': commanders[0] if commanders else '',
            'commander2': commanders[1] if len(commanders) > 1 else '',
            'list': '\n'.join(f'{dc.quantity} {dc.name}' for dc in deck_cards),
            'cards': [{'name': dc.name, 'quantity': dc.quantity, 'isCommander': dc.is_commander,
                       'isSideboard': dc.is_sideboard} for dc in deck_cards],
        })

    return jsonify({'decks': deck_list, 'count': len(deck_list)})
