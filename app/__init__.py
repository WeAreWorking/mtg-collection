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
            conn.commit()
    except Exception as e:
        print(f"Migration notice: {e}")

