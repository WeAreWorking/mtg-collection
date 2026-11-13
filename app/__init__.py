"""Flask application factory. The SQLite database lives in ``data/collection.db``."""
import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def create_app():
    app = Flask(__name__)

    # In Docker, /app/data is a mounted volume (MTG_DATA_PATH in docker-compose)
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
    """Add columns introduced after a database was created.

    ``db.create_all()`` creates missing tables but never alters existing ones,
    so new columns are added here with ``ALTER TABLE``.
    """
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

            # DeckCard.color_identity (Commander colour restrictions)
            try:
                deck_cards_result = conn.execute(text("PRAGMA table_info(deck_cards)"))
                deck_cards_cols = {row[1] for row in deck_cards_result.fetchall()}
                if deck_cards_cols and 'color_identity' not in deck_cards_cols:
                    conn.execute(text("ALTER TABLE deck_cards ADD COLUMN color_identity VARCHAR(50)"))
            except Exception:
                pass

            # Empty or numeric formats (Archidekt format IDs such as "3") become Commander
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

