from datetime import datetime
from . import db


class Card(db.Model):
    """
    Represents a physical card entry in the user's collection.
    Multiple rows can exist for the same card if the user has copies
    in different conditions, foil/non-foil, or different storage locations.
    """
    __tablename__ = 'cards'

    id = db.Column(db.Integer, primary_key=True)
    scryfall_id = db.Column(db.String(36), nullable=True)   # Scryfall UUID
    name = db.Column(db.String(200), nullable=False)
    set_code = db.Column(db.String(10))                     # e.g. "MH3"
    set_name = db.Column(db.String(200))                    # e.g. "Modern Horizons 3"
    collector_number = db.Column(db.String(20))

    # Physical copy details
    quantity = db.Column(db.Integer, default=1, nullable=False)
    foil = db.Column(db.Boolean, default=False, nullable=False)
    condition = db.Column(db.String(10), default='NM')      # NM, LP, MP, HP, DMG
    storage_location = db.Column(db.String(200))            # e.g. "Binder A", "Commander Box"
    purchase_price = db.Column(db.Float, nullable=True)     # Amount paid per card

    # Market prices across top 3 US single card markets (and CAD conversion)
    price_usd = db.Column(db.Float, nullable=True)          # TCGplayer Market Price (normal)
    price_usd_foil = db.Column(db.Float, nullable=True)     # TCGplayer Market Price (foil)
    price_cad = db.Column(db.Float, nullable=True)          # Converted to Canadian Dollars
    price_cardkingdom = db.Column(db.Float, nullable=True)  # Card Kingdom Retail price
    price_market3 = db.Column(db.Float, nullable=True)      # 3rd Market (Cardhoarder / Index)
    prices_updated_at = db.Column(db.DateTime, nullable=True)

    # Card data cached from Scryfall (avoids re-fetching)
    image_uri = db.Column(db.String(500))
    image_uri_back = db.Column(db.String(500))              # For double-faced cards
    colors = db.Column(db.String(50))                       # Comma-separated: "W,U"
    color_identity = db.Column(db.String(50))
    type_line = db.Column(db.String(300))
    mana_cost = db.Column(db.String(100))
    oracle_text = db.Column(db.Text)
    rarity = db.Column(db.String(20))
    cmc = db.Column(db.Float)
    keywords = db.Column(db.String(500))                    # Comma-separated keywords

    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        from . import pricing
        market_data = pricing.calculate_card_market_prices(self)
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
    """A named deck, imported from Archidekt or another source."""
    __tablename__ = 'decks'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    format = db.Column(db.String(50))                       # e.g. "Commander", "Modern"
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    cards = db.relationship('DeckCard', back_populates='deck',
                            cascade='all, delete-orphan', lazy='dynamic')

    def to_dict(self):
        total_qty = db.session.query(db.func.sum(DeckCard.quantity)).filter_by(deck_id=self.id).scalar() or 0
        unique_cnt = self.cards.count()
        return {
            'id': self.id,
            'name': self.name,
            'format': self.format,
            'description': self.description,
            'card_count': total_qty,
            'total_cards': total_qty,
            'unique_cards': unique_cnt,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class DeckCard(db.Model):
    """A card slot within a deck (not tied to a physical collection entry)."""
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
        }
