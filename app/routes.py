from flask import Blueprint, jsonify, render_template, request, redirect, url_for
from sqlalchemy import or_
from . import db
from .models import Card, Deck, DeckCard
from . import scryfall as scryfall_client
from . import importer

main = Blueprint('main', __name__)


def _ensure_db():
    """Create tables if the DB file is new/missing (fresh install, deleted file).

    On first launch (or if ``data/collection.db`` was removed), the collection
    API should return an empty list — which the frontend renders as
    "No cards found in databanks. Try adjusting your filters or import some
    cards." — rather than a 500 "no such table" error.
    """
    try:
        db.create_all()
    except Exception:
        pass


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


def _card_color_identity(col_card, fallback=None):
    """Colour identity for a Card row, with explicit fallback override support."""
    if fallback is not None and str(fallback).strip():
        return _parse_color_identity(fallback)
    if col_card is not None:
        return _parse_color_identity(col_card.color_identity) if col_card.color_identity else set()
    return _parse_color_identity(fallback)


def _get_commander_identity(deck):
    """Commander colour identity set for a Deck, or None if no commander set."""
    try:
        return deck.commander_color_identity()
    except Exception:
        # Fallback for rows created before DeckCard.color_identity existed
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
    """
    GET /api/collection
    Query params:
        q           — search text (name, type, oracle text)
        color       — filter by color code(s), comma-separated e.g. "W,U"
        set_code    — filter by set code e.g. "MH3"
        rarity      — common | uncommon | rare | mythic
        foil        — true | false
        storage     — storage location substring
        sort        — name | price | quantity | cmc | rarity | added_at (default: name; legacy price_desc/price_asc also accepted)
        order       — asc | desc (default: asc; separate high/low dropdown)
        page        — page number (default: 1)
        per_page    — results per page (default: 60)
    """
    _ensure_db()

    q = request.args.get('q', '').strip()
    color = request.args.get('color', '').strip()
    set_code = request.args.get('set_code', '').strip().upper()
    rarity = request.args.get('rarity', '').strip().lower()
    foil = request.args.get('foil', '').strip().lower()
    storage = request.args.get('storage', '').strip()
    sort_by = request.args.get('sort', 'name')
    order = request.args.get('order', 'asc')
    # Legacy combined values: sort=price_desc / price_asc
    if sort_by == 'price_desc':
        sort_by, order = 'price', 'desc'
    elif sort_by == 'price_asc':
        sort_by, order = 'price', 'asc'
    order = 'desc' if str(order).lower() == 'desc' else 'asc'
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
        elif in_deck.startswith('storage:'):
            loc = in_deck.split(':', 1)[1]
            query = query.filter(Card.storage_location == loc)
        elif in_deck.startswith('deck:'):
            deck_id = int(in_deck.split(':', 1)[1])
            deck_card_names = (
                db.session.query(DeckCard.name)
                .filter(DeckCard.deck_id == deck_id)
                .subquery()
            )
            query = query.filter(Card.name.in_(deck_card_names))
        elif in_deck.isdigit():
            deck_card_names = (
                db.session.query(DeckCard.name)
                .filter(DeckCard.deck_id == int(in_deck))
                .subquery()
            )
            query = query.filter(Card.name.in_(deck_card_names))

    # Fetch all matching rows to clump duplicate printings by name
    all_matching = query.all()

    # Clump by card name
    grouped = {}
    for c in all_matching:
        grouped.setdefault(c.name, []).append(c)

    clumped_cards = []
    for name, copies in grouped.items():
        # Pick primary copy (prefer foil, or with image, or first)
        primary = next((c for c in copies if c.foil and c.image_uri), None)
        if not primary:
            primary = next((c for c in copies if c.image_uri), copies[0])

        total_qty = sum(c.quantity for c in copies)
        has_foil = any(c.foil for c in copies)

        printings = []
        for c in copies:
            printings.append({
                'id': c.id,
                'scryfall_id': c.scryfall_id,
                'set_code': c.set_code,
                'set_name': c.set_name,
                'collector_number': c.collector_number,
                'quantity': c.quantity,
                'foil': c.foil,
                'condition': c.condition or 'NM',
                'storage_location': c.storage_location or '',
                'price_usd': c.price_usd_foil if (c.foil and c.price_usd_foil) else c.price_usd,
                'price_cad': c.price_cad,
                'image_uri': c.image_uri,
            })

        sets = []
        for c in copies:
            if c.set_code and c.set_code not in sets:
                sets.append(c.set_code)

        storage_locs = []
        for c in copies:
            if c.storage_location and c.storage_location not in storage_locs:
                storage_locs.append(c.storage_location)

        cd = primary.to_dict()
        cd['quantity'] = total_qty
        cd['foil'] = has_foil
        cd['printings_count'] = len(copies)
        cd['printings'] = printings
        cd['sets'] = sets
        cd['storage_locations'] = storage_locs
        cd['storage_location'] = ', '.join(storage_locs) if storage_locs else ''
        clumped_cards.append(cd)

    # Sorting clumped cards
    reverse = (order == 'desc')
    if sort_by == 'name':
        clumped_cards.sort(key=lambda x: (x['name'] or '').lower(), reverse=reverse)
    elif sort_by in ('price', 'price_cad'):
        clumped_cards.sort(key=lambda x: (x['price_usd'] or 0.0), reverse=reverse)
    elif sort_by == 'quantity':
        clumped_cards.sort(key=lambda x: (x['quantity'] or 0), reverse=reverse)
    elif sort_by == 'cmc':
        clumped_cards.sort(key=lambda x: (x['cmc'] or 0.0), reverse=reverse)
    elif sort_by == 'rarity':
        rarity_ranks = {'mythic': 4, 'rare': 3, 'uncommon': 2, 'common': 1}
        clumped_cards.sort(key=lambda x: rarity_ranks.get((x['rarity'] or '').lower(), 0), reverse=reverse)
    elif sort_by == 'added_at':
        clumped_cards.sort(key=lambda x: x.get('added_at') or '', reverse=reverse)
    else:
        clumped_cards.sort(key=lambda x: (x['name'] or '').lower(), reverse=reverse)

    total_unique = len(clumped_cards)
    total_quantity = sum(c['quantity'] for c in clumped_cards)
    paged_cards = clumped_cards[(page - 1) * per_page : page * per_page]

    # Look up deck associations for SORTING multi-deck tracking
    card_names = [c['name'] for c in paged_cards]
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

    for c in paged_cards:
        c['decks'] = deck_map.get(c['name'], [])

    return jsonify({
        'total': total_unique,
        'total_unique': total_unique,
        'total_quantity': total_quantity,
        'page': page,
        'per_page': per_page,
        'pages': max(1, (total_unique + per_page - 1) // per_page),
        'cards': paged_cards,
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
    """
    Remove a single physical printing from the collection.
    If this was the last copy of that card name, also remove the card from every deck
    (since a deck entry represents a card you physically own).
    Removing a card from a deck via the decks API never touches the collection.
    """
    card = Card.query.get_or_404(card_id)
    card_name = card.name
    db.session.delete(card)
    db.session.flush()

    remaining = Card.query.filter_by(name=card_name).count()
    removed_from_decks = 0
    if remaining == 0:
        # No copies left in collection -> remove from all decks
        removed_from_decks = (
            DeckCard.query.filter_by(name=card_name).delete(synchronize_session=False)
        )

    db.session.commit()
    return jsonify({
        'success': True,
        'removed_from_decks': removed_from_decks,
    })


def _bulk_delete_cards(data):
    """Shared logic for bulk removal (partial or full per printing)."""
    raw_items = []
    for key in ('items', 'removals', 'cards', 'printings', 'entries'):
        if isinstance(data, dict) and isinstance(data.get(key), list) and data.get(key):
            raw_items = data.get(key)
            break
    if not raw_items and isinstance(data, dict):
        for key in ('ids', 'card_ids', 'printing_ids', 'collection_card_ids'):
            if isinstance(data.get(key), list) and data.get(key):
                raw_items = [{'printing_id': i, 'quantity': None} for i in data.get(key)]
                break
    if not raw_items and isinstance(data, dict) and isinstance(data.get('names'), list):
        # Remove every copy of each named card
        raw_items = []
        for n in data.get('names') or []:
            if isinstance(n, str) and n.strip():
                for row in Card.query.filter_by(name=n.strip()).all():
                    raw_items.append({'printing_id': row.id, 'quantity': None, 'name': n.strip()})

    removed_copies = 0
    removed_printings = 0
    updated_printings = 0
    touched_names = set()
    details = []
    skipped = []

    for item in raw_items or []:
        printing_id = None
        want = None
        name_hint = None
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            printing_id = int(item)
        elif isinstance(item, str) and item.strip().isdigit():
            printing_id = int(item.strip())
        elif isinstance(item, str):
            name_hint = item.strip()
        elif isinstance(item, dict):
            for k in ('printing_id', 'collection_card_id', 'card_id', 'id'):
                if item.get(k) is not None:
                    printing_id = item.get(k)
                    break
            for k in ('quantity', 'remove_quantity', 'qty', 'count', 'amount', 'remove'):
                if k in item and item.get(k) is not None:
                    want = item.get(k)
                    break
            name_hint = item.get('name') or item.get('card_name')

        card = None
        if printing_id is not None:
            try:
                card = Card.query.get(int(printing_id))
            except (TypeError, ValueError):
                card = None
        if card is None and name_hint:
            card = Card.query.filter_by(name=str(name_hint).strip()).first()

        if card is None:
            skipped.append(str(item))
            continue

        owned = int(card.quantity or 0)
        if owned <= 0:
            db.session.delete(card)
            removed_printings += 1
            touched_names.add(card.name)
            details.append({'name': card.name, 'printing_id': card.id, 'removed': 0, 'action': 'deleted'})
            continue

        if want is None:
            remove_qty = owned
        else:
            try:
                remove_qty = int(want)
            except (TypeError, ValueError):
                remove_qty = owned
        remove_qty = max(0, min(remove_qty, owned))

        touched_names.add(card.name)
        if remove_qty <= 0:
            continue
        removed_copies += remove_qty
        if remove_qty >= owned:
            db.session.delete(card)
            removed_printings += 1
            details.append({'name': card.name, 'printing_id': card.id, 'removed': remove_qty, 'action': 'deleted'})
        else:
            card.quantity = owned - remove_qty
            updated_printings += 1
            details.append({'name': card.name, 'printing_id': card.id, 'removed': remove_qty, 'remaining': card.quantity, 'action': 'decremented'})
        db.session.flush()

    removed_from_decks = 0
    names_gone = []
    for n in touched_names:
        if Card.query.filter_by(name=n).count() == 0:
            names_gone.append(n)
    for n in names_gone:
        removed_from_decks += DeckCard.query.filter_by(name=n).delete(synchronize_session=False)

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
@main.route('/api/collection/bulk-remove', methods=['POST'])
def api_card_bulk_delete():
    """Bulk-remove copies from the collection.

    Accepts ``{items: [{printing_id|collection_card_id|card_id|id, quantity?}, …]}``
    (also ``removals``/``cards``/``printings``, or ``{ids: […]}`` for full
    removals). ``quantity`` is copies to remove from that printing row
    (default: all owned). If the last copy of a name is gone, its deck slots
    are removed too — mirroring the single-delete behaviour.
    """
    data = request.get_json(silent=True) or {}
    _ensure_db()
    return jsonify(_bulk_delete_cards(data))


@main.route('/api/collection/storage-locations')
def api_storage_locations():
    """Return all distinct storage location values for use in filter dropdowns."""
    _ensure_db()
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
        default_storage=data.get('storage', ''),
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
        deck_format=(data.get('format') or '').strip() or 'Commander',
        description=data.get('description', ''),
        add_to_collection=data.get('add_to_collection', True),
        collection_storage=data.get('storage', ''),
    )
    return jsonify(result)


# ── SORTING Overlap API ─────────────────────────────────────────────────────────

@main.route('/api/sorting/shared')
def api_sorting_shared():
    """Returns cards that appear in 2 or more decks for SORTING modular system."""
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
    _ensure_db()
    decks = Deck.query.order_by(Deck.created_at.desc()).all()
    return jsonify([d.to_dict() for d in decks])


@main.route('/api/decks', methods=['POST'])
def api_deck_create():
    """Create a new empty deck without importing (deck builder entry point)."""
    _ensure_db()
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
    deck = Deck.query.get_or_404(deck_id)
    cards = DeckCard.query.filter_by(deck_id=deck_id).all()
    return jsonify({**deck.to_dict(), 'cards': [c.to_dict() for c in cards]})


@main.route('/api/decks/<int:deck_id>', methods=['DELETE'])
def api_deck_delete(deck_id):
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
        name = data['name'].strip()
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
    """Add a card to the deck from the collection (printing-aware, colour-checked).

    Accepts an optional ``collection_card_id`` / ``printing_id`` to pin the exact
    printing (set, foil, image, storage) already owned. Only cards present in the
    collection may be added — the deck builder has no manual-name path.
    """
    deck = Deck.query.get_or_404(deck_id)
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()

    # Resolve selected printing first (id takes precedence over name)
    printing_id = data.get('collection_card_id') or data.get('printing_id') or data.get('card_id')
    col_card = None
    if printing_id:
        try:
            col_card = Card.query.get(int(printing_id))
        except (TypeError, ValueError):
            col_card = None
        if col_card is not None and not name:
            name = col_card.name
        if col_card is not None and name and col_card.name != name:
            # Client sent a stale/mismatched name; trust the printing row
            name = col_card.name

    if not name:
        return jsonify({'error': 'Card name required'}), 400

    if col_card is None:
        # Collection-only: the card must be owned (name match as fallback)
        col_card = Card.query.filter_by(name=name).first()
        if col_card is None:
            return jsonify({'error': f'"{name}" is not in your collection. The deck builder only allows cards from your collection.'}), 400

    qty = max(1, int(data.get('quantity', 1)))
    is_cmd = bool(data.get('is_commander', False))
    is_sb = bool(data.get('is_sideboard', False))

    # Commander colour-identity restriction (non-commander cards only).
    # Partners/commanders themselves define the identity, so they are exempt.
    if _is_commander_deck(deck) and not is_cmd:
        commander_identity = _get_commander_identity(deck)
        if commander_identity is not None:
            # Prefer the selected printing's identity, else name-level identity
            if col_card is not None and col_card.color_identity is not None:
                card_identity = _parse_color_identity(col_card.color_identity)
            elif data.get('color_identity'):
                card_identity = _parse_color_identity(data.get('color_identity'))
            elif col_card is not None:
                card_identity = _parse_color_identity(col_card.color_identity)
            else:
                card_identity = set()
            if not _color_identity_legal(card_identity, commander_identity):
                allowed = ', '.join(sorted(commander_identity)) or 'colourless'
                card_id_str = ', '.join(sorted(card_identity)) or 'colourless'
                return jsonify({
                    'error': f'"{name}" ({card_id_str}) is not legal in this deck — commander colour identity is {allowed}.',
                    'code': 'color_identity',
                    'card_color_identity': sorted(card_identity),
                    'commander_color_identity': sorted(commander_identity),
                }), 400

    colors_value = data.get('colors')
    if colors_value is None and col_card is not None:
        colors_value = col_card.colors
    elif isinstance(colors_value, (list, tuple)):
        colors_value = ','.join(colors_value)
    ci_value = data.get('color_identity')
    if ci_value is None and col_card is not None:
        ci_value = col_card.color_identity
    elif isinstance(ci_value, (list, tuple)):
        ci_value = ','.join(ci_value)

    # Check if card already exists in this deck under the same slot
    existing = DeckCard.query.filter_by(
        deck_id=deck_id,
        name=name,
        is_commander=is_cmd,
        is_sideboard=is_sb
    ).first()

    if existing:
        existing.quantity += qty
        # Update to the selected printing if one was pinned
        if data.get('scryfall_id'):
            existing.scryfall_id = data.get('scryfall_id')
        elif col_card is not None and col_card.scryfall_id:
            existing.scryfall_id = col_card.scryfall_id
        if data.get('set_code'):
            existing.set_code = data.get('set_code')
        elif col_card is not None and col_card.set_code:
            existing.set_code = col_card.set_code
        if data.get('image_uri'):
            existing.image_uri = data.get('image_uri')
        elif col_card is not None and col_card.image_uri:
            existing.image_uri = col_card.image_uri
        if colors_value is not None:
            existing.colors = colors_value
        if ci_value is not None:
            try:
                existing.color_identity = ci_value
            except Exception:
                pass
        db.session.commit()
        return jsonify(existing.to_dict())

    dc = DeckCard(
        deck_id=deck_id,
        name=name,
        quantity=qty,
        is_commander=is_cmd,
        is_sideboard=is_sb,
        scryfall_id=data.get('scryfall_id') or (col_card.scryfall_id if col_card else None),
        set_code=data.get('set_code') or (col_card.set_code if col_card else None),
        image_uri=data.get('image_uri') or (col_card.image_uri if col_card else None),
        type_line=data.get('type_line') or (col_card.type_line if col_card else None),
        mana_cost=data.get('mana_cost') or (col_card.mana_cost if col_card else None),
        colors=colors_value,
        color_identity=ci_value,
    )
    db.session.add(dc)
    db.session.commit()
    return jsonify(dc.to_dict()), 201


@main.route('/api/decks/<int:deck_id>/cards/<int:card_id>', methods=['PUT'])
def api_deck_card_edit(deck_id, card_id):
    """Edit card quantity or commander/sideboard flags in a deck."""
    dc = DeckCard.query.filter_by(id=card_id, deck_id=deck_id).first_or_404()
    data = request.get_json() or {}

    if 'quantity' in data:
        q = int(data['quantity'])
        if q <= 0:
            db.session.delete(dc)
            db.session.commit()
            return jsonify({'deleted': True})
        dc.quantity = q

    # Commander legality: demoting a commander or moving to sideboard/mainboard
    # must still be legal under any remaining commander.
    wants_non_commander = (
        data.get('is_sideboard') is True
        or (('is_commander' in data) and not data.get('is_commander') and dc.is_commander)
    )
    if wants_non_commander:
        deck = Deck.query.get_or_404(deck_id)
        if _is_commander_deck(deck):
            # Identity excluding the card being demoted
            other_cmds = DeckCard.query.filter(
                DeckCard.deck_id == deck_id,
                DeckCard.is_commander == True,
                DeckCard.id != card_id,
            ).all()
            if other_cmds:
                remaining_identity = set()
                for other in other_cmds:
                    stored = (getattr(other, 'color_identity', None) or '').strip()
                    if stored:
                        remaining_identity.update(_parse_color_identity(stored))
                    else:
                        col = Card.query.filter_by(name=other.name).first()
                        remaining_identity.update(_parse_color_identity(col.color_identity) if col and col.color_identity else _parse_color_identity(other.colors))
                dc_identity = _parse_color_identity(getattr(dc, 'color_identity', None)) if (getattr(dc, 'color_identity', None) or '').strip() else _parse_color_identity(dc.colors)
                if not dc_identity:
                    col = Card.query.filter_by(name=dc.name).first()
                    dc_identity = _parse_color_identity(col.color_identity) if col else set()
                if not _color_identity_legal(dc_identity, remaining_identity):
                    return jsonify({'error': f'"{dc.name}" is not legal without this commander — remaining commander colour identity is {", ".join(sorted(remaining_identity)) or "colourless"}.', 'code': 'color_identity'}), 400

    if 'is_commander' in data:
        dc.is_commander = bool(data['is_commander'])
        if dc.is_commander:
            dc.is_sideboard = False

    if 'is_sideboard' in data:
        dc.is_sideboard = bool(data['is_sideboard'])
        if dc.is_sideboard:
            dc.is_commander = False

    db.session.commit()
    return jsonify(dc.to_dict())


@main.route('/api/decks/<int:deck_id>/cards/<int:card_id>', methods=['DELETE'])
def api_deck_card_delete(deck_id, card_id):
    """Remove a card entry from a deck."""
    dc = DeckCard.query.filter_by(id=card_id, deck_id=deck_id).first_or_404()
    db.session.delete(dc)
    db.session.commit()
    return jsonify({'success': True})


@main.route('/api/collection/search')
def api_collection_search():
    """Search cards currently in the user's collection for adding to decks.

    Returns one entry per distinct name with a ``printings`` array so the
    deck builder can offer a per-printing preview picker. When ``deck_id`` is
    supplied and that deck is a Commander deck with a commander already set,
    only commander-legal cards (colour identity ⊆ commander identity) are
    returned. Pass ``all=1`` to skip that filter when browsing.
    """
    q = request.args.get('q', '').strip()
    deck_id = request.args.get('deck_id', '').strip()
    show_all = request.args.get('all', '').strip().lower() in ('1', 'true', 'yes')
    target_deck = None
    if deck_id and deck_id.isdigit():
        target_deck = Deck.query.get(int(deck_id))
    else:
        deck_id = ''

    # Browsing mode: empty query with a deck context shows the whole
    # (filtered) collection; without a deck context empty means no query.
    if not q and not deck_id:
        return jsonify([])

    like = f'%{q}%' if q else '%%'
    query = Card.query
    if q:
        query = query.filter(or_(Card.name.ilike(like), Card.type_line.ilike(like)))
    cards = (
        query
        .order_by(Card.name)
        .limit(200)
        .all()
    )

    commander_identity = None
    if target_deck is not None and not show_all and _is_commander_deck(target_deck):
        commander_identity = _get_commander_identity(target_deck)

    # Group by name, preserving every owned printing row
    grouped = {}
    order = []
    for c in cards:
        if c.name not in grouped:
            grouped[c.name] = []
            order.append(c.name)
        grouped[c.name].append(c)

    # Sum owned quantities across ALL printings of matched names
    # (not just the first 200 rows from the name search)
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
        # Representative copy prefers foil with art, else any with art
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
    """Quick stats and total collection valuation for the navbar."""
    from . import pricing
    _ensure_db()
    cad_rate = pricing.get_usd_to_cad_rate()

    total_cards = db.session.query(db.func.sum(Card.quantity)).scalar() or 0
    # Unique by card name so different printings of the same card count once
    unique_cards = db.session.query(db.func.count(db.func.distinct(Card.name))).scalar() or 0
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


# ── SORTING Sync API ────────────────────────────────────────────────────────────

@main.route('/api/sorting/sync-data')
def api_sorting_sync_data():
    """
    Returns all decks and cards from the database formatted for the SORTING tool.
    Allows 1-click import into the SORTING Sleeve Marking app.
    """
    decks = Deck.query.order_by(Deck.name).all()
    deck_list = []

    # Palette of 48 distinctive colours for SORTING sleeve marking
    # (one colour + one slot per deck, up to 48 decks per sleeve).
    # Order interleaves hue families so sequentially-synced decks differ.
    default_colors = [
        '#F44336', '#2196F3', '#4CAF50', '#FFEB3B', '#9C27B0', '#FF9800',
        '#E91E63', '#00BCD4', '#673AB7', '#03A9F4', '#009688', '#8BC34A',
        '#3F51B5', '#CDDC39', '#FFC107', '#000000', '#FFFFFF', '#9E9E9E',
        '#D32F2F', '#1976D2', '#388E3C', '#FBC02D', '#7B1FA2', '#F57C00',
        '#C2185B', '#0097A7', '#512DA8', '#0288D1', '#00796B', '#689F38',
        '#303F9F', '#AFB42B', '#FFA000', '#E57373', '#64B5F6', '#81C784',
        '#FFF176', '#BA68C8', '#FFB74D', '#F06292', '#4DD0E1', '#9575CD',
        '#4FC3F7', '#4DB6AC', '#AED581', '#7986CB', '#DCE775', '#FFD54F',
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
