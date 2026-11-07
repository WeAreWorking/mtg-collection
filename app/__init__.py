import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def create_app():
    app = Flask(__name__)

    # Data directory — mapped to a TrueNAS dataset volume in production
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    os.makedirs(data_dir, exist_ok=True)

    app.config['SQLALCHEMY_DATABASE_URI'] = (
        f'sqlite:///{os.path.join(data_dir, "collection.db")}'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

    db.init_app(app)

    from .routes import main
    app.register_blueprint(main)

    with app.app_context():
        db.create_all()
        _migrate_columns()

    return app


def _migrate_columns():
    """Ensure newly added columns exist in the SQLite database without requiring external tools."""
    from sqlalchemy import text
    try:
        with db.engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(cards)"))
            existing_cols = {row[1] for row in result.fetchall()}

            new_cols = {
                'price_usd': 'FLOAT',
                'price_usd_foil': 'FLOAT',
                'price_cad': 'FLOAT',
                'price_cardkingdom': 'FLOAT',
                'price_market3': 'FLOAT',
                'prices_updated_at': 'DATETIME',
            }
            for col_name, col_type in new_cols.items():
                if col_name not in existing_cols:
                    conn.execute(text(f"ALTER TABLE cards ADD COLUMN {col_name} {col_type}"))

            # DeckCard colour identity (Commander colour restrictions)
            try:
                deck_cards_result = conn.execute(text("PRAGMA table_info(deck_cards)"))
                deck_cards_cols = {row[1] for row in deck_cards_result.fetchall()}
                if deck_cards_cols and 'color_identity' not in deck_cards_cols:
                    conn.execute(text("ALTER TABLE deck_cards ADD COLUMN color_identity VARCHAR(50)"))
            except Exception:
                pass

            # Legacy decks with empty or numeric-only format (e.g. "3") default
            # to Commander on first run after this change.
            try:
                decks_result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='decks'"))
                if decks_result.fetchone() is not None:
                    conn.execute(text(
                        "UPDATE decks SET format = 'Commander' "
                        "WHERE format IS NULL OR TRIM(format) = '' "
                        "OR TRIM(format) NOT GLOB '*[^0-9]*'"
                    ))
            except Exception:
                pass
            conn.commit()
    except Exception as e:
        print(f"Migration notice: {e}")

