from datetime import datetime
from . import db


class Card(db.Model):
    """Physical copies of one printing that you own.

    One row per printing + finish + condition + storage location; ``quantity``
    counts the copies. Rows with the same ``name`` are grouped in the UI.
    """
    __tablename__ = 'cards'

    id = db.Column(db.Integer, primary_key=True)
    scryfall_id = db.Column(db.String(36), nullable=True)   # Scryfall card UUID
    name = db.Column(db.String(200), nullable=False)
    set_code = db.Column(db.String(10))                     # uppercase, e.g. "MH3"
    set_name = db.Column(db.String(200))                    # e.g. "Modern Horizons 3"
    collector_number = db.Column(db.String(20))

    # Physical copies
    quantity = db.Column(db.Integer, default=1, nullable=False)
    foil = db.Column(db.Boolean, default=False, nullable=False)
    condition = db.Column(db.String(10), default='NM')      # NM, LP, MP, HP, DMG
    storage_location = db.Column(db.String(200))            # e.g. "Binder A"
    purchase_price = db.Column(db.Float, nullable=True)     # per copy; not exposed in the UI

    # Prices from Scryfall (see pricing.py)
    price_usd = db.Column(db.Float, nullable=True)          # TCGplayer market, non-foil
    price_usd_foil = db.Column(db.Float, nullable=True)     # TCGplayer market, foil/etched
    price_cad = db.Column(db.Float, nullable=True)          # CAD at last price refresh
    price_cardkingdom = db.Column(db.Float, nullable=True)  # unused (kept for existing databases)
    price_market3 = db.Column(db.Float, nullable=True)      # MTGO price in tix (Cardhoarder)
    prices_updated_at = db.Column(db.DateTime, nullable=True)

    # Card data cached from Scryfall
    image_uri = db.Column(db.String(500))
    image_uri_back = db.Column(db.String(500))              # back face of double-faced cards
    colors = db.Column(db.String(50))                       # comma-separated, e.g. "W,U"
    color_identity = db.Column(db.String(50))               # comma-separated; "" = colourless
    type_line = db.Column(db.String(300))
    mana_cost = db.Column(db.String(100))
    oracle_text = db.Column(db.Text)
    rarity = db.Column(db.String(20))
    cmc = db.Column(db.Float)
    keywords = db.Column(db.String(500))                    # comma-separated

    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, rate: float = None):
        from . import pricing
        market_data = pricing.calculate_card_market_prices(self, rate)
        return {
            'id': self.id,
            'scryfall_id': self.scryfall_id,
            'name': self.name,
            'set_code': self.set_code,
            'set_name': self.set_name,
            'collector_number': self.collector_number,
            'quantity': self.quantity,
            'foil': self.foil,
            'condition': self.condition,
            'storage_location': self.storage_location,
            'purchase_price': self.purchase_price,
            'price_usd': market_data['primary_usd'],
            'price_cad': market_data['primary_cad'],
            'price_usd_fmt': market_data['primary_usd_fmt'],
            'price_cad_fmt': market_data['primary_cad_fmt'],
            'market_prices': market_data,
            'image_uri': self.image_uri,
            'image_uri_back': self.image_uri_back,
            'colors': self.colors.split(',') if self.colors else [],
            'color_identity': self.color_identity.split(',') if self.color_identity else [],
            'type_line': self.type_line,
            'mana_cost': self.mana_cost,
            'oracle_text': self.oracle_text,
            'rarity': self.rarity,
            'cmc': self.cmc,
            'keywords': self.keywords.split(',') if self.keywords else [],
            'added_at': self.added_at.isoformat() if self.added_at else None,
            'prices_updated_at': self.prices_updated_at.isoformat() if self.prices_updated_at else None,
        }


class Deck(db.Model):
    """A deck: built in the app or imported from a decklist / Archidekt."""
    __tablename__ = 'decks'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    format = db.Column(db.String(50), default='Commander')   # e.g. "Commander", "Modern"
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    cards = db.relationship('DeckCard', back_populates='deck',
                            cascade='all, delete-orphan', lazy='dynamic')

    def normalized_format(self):
        """Format for display; empty or numeric values (Archidekt format IDs) mean Commander."""
        raw = (self.format or '').strip()
        if not raw or raw.isdigit():
            return 'Commander'
        return self.format

    def is_commander_format(self):
        fmt = self.normalized_format().strip().lower()
        return 'commander' in fmt or 'edh' in fmt

    def commander_color_identity(self):
        """Union of the commanders' colour identities.

        Returns None when no commander is set (no restriction), otherwise a set
        of WUBRG letters (empty set = colourless commander). Uses the identity
        stored on the DeckCard, then the collection row, then the card colours.
        """
        commanders = DeckCard.query.filter_by(deck_id=self.id, is_commander=True).all()
        if not commanders:
            return None
        identity = set()
        for dc in commanders:
            dc_identity = set()
            stored = (getattr(dc, 'color_identity', None) or '').strip()
            if stored:
                dc_identity = {c.strip().upper() for c in stored.split(',') if c.strip().upper() in ('W', 'U', 'B', 'R', 'G')}
            else:
                # Fall back to collection row (source of truth for colour identity)
                col = Card.query.filter_by(name=dc.name).first()
                if col is not None and col.color_identity:
                    dc_identity = {c.strip().upper() for c in col.color_identity.split(',') if c.strip().upper() in ('W', 'U', 'B', 'R', 'G')}
                elif dc.colors:
                    dc_identity = {c.strip().upper() for c in dc.colors.split(',') if c.strip().upper() in ('W', 'U', 'B', 'R', 'G')}
            identity.update(dc_identity)
        return identity

    def expected_size(self):
        """Standard deck size: 100 Commander/EDH, 40 Draft/Sealed, 60 most others."""
        fmt = self.normalized_format().strip().lower()
        if 'commander' in fmt or 'edh' in fmt:
            return 100
        if 'draft' in fmt or 'sealed' in fmt:
            return 40
        return 60

    def to_dict(self):
        # Deck size counts commander + mainboard; the sideboard is excluded
        total_qty, unique_cnt = (
            db.session.query(db.func.coalesce(db.func.sum(DeckCard.quantity), 0), db.func.count(DeckCard.id))
            .filter(DeckCard.deck_id == self.id, DeckCard.is_sideboard == False)  # noqa: E712
            .one()
        )
        sideboard_qty = (
            db.session.query(db.func.coalesce(db.func.sum(DeckCard.quantity), 0))
            .filter(DeckCard.deck_id == self.id, DeckCard.is_sideboard == True)  # noqa: E712
            .scalar()
        )
        format = self.normalized_format()
        expected = self.expected_size()
        size_ok = total_qty == expected
        cmd_identity = self.commander_color_identity()
        return {
            'id': self.id,
            'name': self.name,
            'format': format,
            'description': self.description,
            'card_count': total_qty,
            'total_cards': total_qty,
            'unique_cards': unique_cnt,
            'sideboard_cards': sideboard_qty,
            'expected_size': expected,
            'size_ok': size_ok,
            'size_warning': None if size_ok else f"Deck has {total_qty} cards (expected {expected} for {format})",
            # None → no commander set (no colour restriction); [] → colourless commander
            'commander_color_identity': sorted(cmd_identity) if cmd_identity is not None else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class DeckCard(db.Model):
    """A card in a deck, matched to the collection by ``name`` (any printing).

    Deck slots don't reserve physical copies: the same owned card can appear
    in many decks, which is how SORTING overlaps are found.
    """
    __tablename__ = 'deck_cards'

    id = db.Column(db.Integer, primary_key=True)
    deck_id = db.Column(db.Integer, db.ForeignKey('decks.id'), nullable=False)
    scryfall_id = db.Column(db.String(36), nullable=True)
    name = db.Column(db.String(200), nullable=False)
    set_code = db.Column(db.String(10))
    quantity = db.Column(db.Integer, default=1)
    is_commander = db.Column(db.Boolean, default=False)
    is_sideboard = db.Column(db.Boolean, default=False)
    image_uri = db.Column(db.String(500))
    type_line = db.Column(db.String(300))
    mana_cost = db.Column(db.String(100))
    colors = db.Column(db.String(50))
    color_identity = db.Column(db.String(50))

    deck = db.relationship('Deck', back_populates='cards')

    def to_dict(self):
        return {
            'id': self.id,
            'deck_id': self.deck_id,
            'scryfall_id': self.scryfall_id,
            'name': self.name,
            'set_code': self.set_code,
            'quantity': self.quantity,
            'is_commander': self.is_commander,
            'is_sideboard': self.is_sideboard,
            'image_uri': self.image_uri,
            'type_line': self.type_line,
            'mana_cost': self.mana_cost,
            'colors': self.colors.split(',') if self.colors else [],
            'color_identity': self.color_identity.split(',') if self.color_identity else [],
        }


class EdhrecCache(db.Model):
    """Cached EDHREC commander page (flattened card list as JSON)."""
    __tablename__ = 'edhrec_cache'

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(300), unique=True, nullable=False, index=True)
    payload = db.Column(db.Text)              # JSON list from edhrec.parse_page
    fetched_at = db.Column(db.DateTime)
