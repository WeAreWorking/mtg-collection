# MTG Collection & SORTING Deck Hub

A self-hosted Magic: The Gathering collection manager and deck tracker designed for the **modular "One Card, Every Deck"** system using a modular pool for shared staples.

For a detailed explanation of the project's background, architecture, and workflow, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

---

## What it does

| Tab | What you can do |
| --- | --- |
| **Collection** (`/collection`) | Browse your physical cards in a spreadsheet table or visual grid. Cards with the same name are **clumped into one row** — quantities are summed and different printings (sets, foil, boxes) are listed together. Click a card to see oracle text, images, market prices, and every printing. Edit quantity, finish, and storage per printing; deleting the last copy also removes the card from decks. Filter by deck (including `⚡ SORTING Shared`, `Unassigned`, per-deck and per-box), color, rarity, foil, sort, and pagination. The spreadsheet caps Type Line at ~95px with hover tooltips, hides Storage on narrow screens, and keeps price columns visible. |
| **Decks** (`/decks`) | Browse decks with live size badges (`✓ 100/100` or `⚠️ 100/60`). Open a deck to see Commander / Mainboard / Sideboard grouped by card type. **Rename the deck, change its format and description** via *Edit Deck*. **Add cards from your collection** with live search (shows owned quantity), choose Mainboard / Commander / Sideboard and quantity. Change quantity with `−`/`+`, move cards between sections with `👑` / `📦` toggles. Removing a card from a deck keeps it in your collection; deleting a deck removes only the deck. Decks warn when they don't match the expected size (100 Commander, 60 most formats, 40 Draft/Sealed). |
| **Import** (`/import`) | Add cards by pasting text (`4 Lightning Bolt`, `2x Snapcaster Mage (ISD) 78 *F*`) or import whole decks via public Archidekt URL or exported text with `Commander:` / `Sideboard:` headers. Optionally sync deck cards into the Collection with a storage location. Collection import supports default condition, storage, and purchase price. |
| **SORTING Builder** (`/sorting`, also `/build`) | Local sleeve-marking tool for modular deck sorting. One-click *Load from Local Collection* syncs decks from SQLite, renders sleeve-edge color stripes, an overlap matrix, SCRY-mode walkthrough, filters, CSV export, printable guide, and JSON backup (stored in `localStorage`). |

Other highlights:

- **Physical truth:** `Card` rows are what you own (quantity, foil, condition, storage location, purchase price). `DeckCard` rows are decklist slots. Many decks can reference the same card name without duplicating inventory.
- **SORTING Shared filter:** Collection → deck dropdown → `⚡ SORTING Shared (2+ decks)` shows cards used by 2+ decks. `📦 Binder / Unassigned` shows cards in no deck.
- **Market values:** Navbar shows total value in USD and CAD (TCGplayer / Card Kingdom / Cardhoarder + live FX). Card detail shows all three markets. Refresh from navbar (`↻`).
- **Card data:** Scryfall images, mana costs, oracle text, rarity, and colors are cached server-side in SQLite.

---

## Quick Start

### Running Locally (Python)

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application:**
   ```bash
   python run.py
   ```

3. Open your browser to `http://localhost:7432`.

> The app creates `data/collection.db` on first run. Back up that file to preserve your collection. Set `SECRET_KEY` in the environment for production use.

### Running with Docker / TrueNAS

1. Build and start the container:
   ```bash
   docker compose up -d
   ```

2. The application will be accessible at port `7432`. Data is persisted to the mapped directory configured in `docker-compose.yml`.

   Edit `docker-compose.yml` to point `/mnt/your-pool/mtg-data` at your actual TrueNAS dataset, and change `SECRET_KEY` to a random value.

---

## Recommended workflow

1. **Import** your decks (Archidekt links or decklists) — optionally sync cards into the Collection.
2. **Collection** → `⚡ SORTING Shared` to find your modular pool. Open each card to check its printings (sets, foil, boxes) and set storage (e.g. `SORTING Tray 1`).
3. **Decks** → open a deck, rename / set its format, and use *Add Card from Collection* to adjust lists. Keep an eye on the `✓` / `⚠️` size badge.
4. **SORTING Builder** → *Load from Local Collection*, then use the marking table / SCRY-mode to stripe sleeves by deck color.

## Project structure

```
app/
  __init__.py      # Flask factory, SQLite setup, column migration
  models.py        # Card, Deck, DeckCard + deck-size logic
  routes.py        # Pages + JSON APIs (collection, decks, import, pricing, SORTING sync)
  importer.py      # Text/Archidekt parsing, Scryfall bulk lookup, collection/deck import
  scryfall.py      # Scryfall client (bulk, caching, rate-limit handling)
  pricing.py       # USD→CAD FX (open.er-api + frankfurter fallback, 1h cache) + market math
  templates/       # base, collection, decks, import_page, sorting (Jinja2)
  static/
    app.js         # Collection + Decks + Import frontend
    style.css      # Spreadsheet/grid, deck panel, modals
    sorting.js/css   # SORTING Builder
    mana/          # Local mana-symbol SVGs (fallback to Scryfall)
data/              # SQLite DB (persist this directory)
Dockerfile, docker-compose.yml, run.py, requirements.txt
```

## API overview (selected)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/collection?q=&in_deck=&color=&rarity=&foil=&sort=&order=&page=&per_page=` | Clumped collection search — one entry per card name with `printings[]`, `sets[]`, `decks[]` |
| `GET / PUT / DELETE` | `/api/collection/<id>` | Read / edit / delete one physical printing. Deleting the last copy of a name removes deck slots too. |
| `GET` | `/api/collection/search?q=` | Search owned cards for *Add to deck* (`total_owned` summed across printings) |
| `GET` | `/api/decks` · `GET / PUT / DELETE` | `/api/decks/<id>` — list, detail, rename/format/description, delete. Includes `expected_size`, `size_ok`, `size_warning`. |
| `POST` | `/api/decks/<id>/cards` | Add a card from collection (or any name) to a deck slot |
| `PUT / DELETE` | `/api/decks/<id>/cards/<card_id>` | Change quantity, move Commander/Main/Sideboard, or remove from deck (collection untouched) |
| `POST` | `/api/import/collection` · `/api/import/deck` | Text / Archidekt import |
| `GET` | `/api/sorting/sync-data` · `/api/sorting/shared` | SORTING Builder sync + shared-card list |
| `POST` | `/api/collection/refresh-prices` | Re-price all cards via Scryfall bulk lookup |
| `GET` | `/api/stats` · `/api/currency` | Navbar totals + live USD→CAD rate |

## Notes

- **Deck vs collection:** Removing a card from a deck never deletes it from the Collection. To delete a card everywhere, remove it from the Collection (Collection tab → card detail → *Remove from Collection*). If no copies remain, the card is also cleared from decks.
- **Deck sizes:** Commander/EDH 100, Draft/Sealed 40, most other formats 60. Decks with no format (or a legacy numeric value) show no size badge until you set a format.
- **Condition:** The API still stores condition per printing, but the UI no longer asks for it on every edit (defaults to NM) to keep the flow focused on identity, sleeves, and value.
