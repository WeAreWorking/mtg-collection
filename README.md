# MTG Collection & SORTING Deck Hub

A self-hosted Magic: The Gathering collection manager and deck tracker designed for the **modular "One Card, Every Deck"** system using a modular pool for shared staples.

For a detailed explanation of the project's background, architecture, and workflow, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

---

## What it does

| Tab | What you can do |
| --- | --- |
| **Collection** (`/collection`) | Browse your physical cards in a spreadsheet table or visual grid. Cards with the same name are **clumped into one row** — quantities are summed and different printings (sets, foil, boxes) are listed together. Click a card to see oracle text, images, market prices, and every printing. Edit quantity, finish, and storage per printing; deleting the last copy also removes the card from decks. Filter by deck (including `⚡ SORTING Shared`, `Unassigned`, per-deck and per-box), color, rarity, foil, sort, and pagination. The spreadsheet caps Type Line at ~95px with hover tooltips, hides Storage on narrow screens, and keeps price columns visible. |
| **Decks** (`/decks`) | Browse decks with live size badges (`✓ 100/100` or `⚠️ 100/60`). **Create a new deck without importing** via *＋ New Deck* (name/format, defaults to Commander), then open it to build. Open a deck to see Commander / Mainboard / Sideboard grouped by card type. **Rename the deck, change its format and description** via *Edit Deck*. **Build only from your collection:** *Add Card from Collection* offers only owned cards, with a **per-printing picker + art preview** for multi-printing names (choose set/foil/storage before adding). When a Commander is set, the builder **filters to commander-legal cards** (colour identity ⊆ commander identity — mono-blue shows blue + colourless, multicolour shows subsets) and the API rejects illegal adds. Choose Mainboard / Commander / Sideboard and quantity. Change quantity with `−`/`+`, move cards between sections with `👑` / `📦` toggles. Removing a card from a deck keeps it in your collection; deleting a deck removes only the deck. Decks warn when they don't match the expected size (100 Commander, 60 most formats, 40 Draft/Sealed). |
| **Import** (`/import`) | Add cards by pasting text (`4 Lightning Bolt`, `2x Snapcaster Mage (ISD) 78 *F*`) or import whole decks via public Archidekt URL or exported text with `Commander:` / `Sideboard:` headers. Optionally sync deck cards into the Collection with a storage location. Collection import supports a default storage location. |
| **SORTING Builder** (`/sorting`, also `/build`) | Local sleeve-marking tool for modular deck sorting (**48 stripe colours / slots**). One-click *Load from Local Collection* syncs decks from SQLite, renders sleeve-edge color stripes, an overlap matrix, SCRY-mode walkthrough, filters, CSV export, printable guide, and JSON backup (stored in `localStorage`). |

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

### Running with Docker / TrueNAS (image pull)

The image is built by GitHub Actions on every push to `main` and pushed to `ghcr.io/weareworking/mtg-collection:latest` (also tagged by commit SHA). No local build and no git clone on the NAS is needed.

**Prerequisites for both methods:** Create a dataset for app data first in TrueNAS: **Storage → Datasets → Add Dataset** (e.g. `SSDs → Databases → MTG-collection`) and note its full path (e.g. `/mnt/SSDs/Databases/MTG-collection`). The container creates `collection.db` inside it on first start. Back up that dataset to preserve your collection.

**1. TrueNAS SCALE with Dockge (easiest) - see [docs/install-dockge.md](docs/install-dockge.md)**
- **Apps → Dockge → Stacks → Add Stack**, name `mtg-collection`, paste the repo `docker-compose.yml` (image-only, no `build:`).
- In the Stack variables editor set:
  - `MTG_DATA_PATH` = your dataset path from above
  - `SECRET_KEY` = a long random string (never commit it)
- Click **Deploy**. Dockge pulls the image. Future updates: push to GitHub → wait for Actions → click **Redeploy**.

**2. TrueNAS SCALE native Custom App (no Dockge) - see [docs/install-truenas-custom-app.md](docs/install-truenas-custom-app.md)**
- **Apps → Custom App → Create**, name `mtg-collection`, paste the same compose.
- In the form set `MTG_DATA_PATH` as a **Host Path/Dataset** picker and `SECRET_KEY` as a **Secret** env var.
- Set Update Policy to pull latest. Future updates: **Apps → mtg-collection → Update**.

**Local Docker (dev):**
```bash
docker compose pull
docker compose up -d
```
Port `7432` is the app port - change the host side (`"7433:7432"`) if it's already in use on your NAS.

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
| `GET` | `/api/collection/search?q=&deck_id=&all=` | Search **owned** cards for *Add to deck* (`total_owned`, `color_identity`, `printings[]` per name; `deck_id` filters to commander-legal cards when a Commander is set) |
| `GET` | `/api/decks` · `POST /api/decks` · `GET / PUT / DELETE` | `/api/decks/<id>` — list, **create empty deck**, detail, rename/format/description, delete. Includes `expected_size`, `size_ok`, `size_warning`, `commander_color_identity`. |
| `POST` | `/api/decks/<id>/cards` | Add a card **from the collection only** (`collection_card_id` pins the printing) to a deck slot; Commander decks reject cards outside commander colour identity |
| `PUT / DELETE` | `/api/decks/<id>/cards/<card_id>` | Change quantity, move Commander/Main/Sideboard, or remove from deck (collection untouched) |
| `POST` | `/api/import/collection` · `/api/import/deck` | Text / Archidekt import |
| `GET` | `/api/sorting/sync-data` · `/api/sorting/shared` | SORTING Builder sync + shared-card list |
| `POST` | `/api/collection/refresh-prices` | Re-price all cards via Scryfall bulk lookup |
| `GET` | `/api/stats` · `/api/currency` | Navbar totals + live USD→CAD rate |

## Notes

- **Deck vs collection:** Removing a card from a deck never deletes it from the Collection. To delete a card everywhere, remove it from the Collection (Collection tab → card detail → *Remove from Collection*). If no copies remain, the card is also cleared from decks.
- **Deck sizes:** Commander/EDH 100, Draft/Sealed 40, most other formats 60. Decks with no format (or a legacy numeric value) default to Commander (100).
- **Condition:** The API still stores condition per printing, but the UI no longer asks for it on every edit (defaults to NM) to keep the flow focused on identity, sleeves, and value.

### Sleeve-marking markers (SORTING)

The SORTING palette is **48 distinct stripe colours — one colour + one slot per deck**, up to 48 decks per sleeve (96 with half-marks / dot splits). No single Uni Posca 48/52-colour set is sold on Amazon.ca (largest single Posca sets are PC-5M 29 and PC-3M 24), so the palette is matched to a single purchasable set instead:

- [Betem 48 Colors Dual Tip Acrylic Paint Markers on Amazon.ca (B0BR3XX6NC, $29.99)](https://www.amazon.ca/dp/B0BR3XX6NC) — in stock at time of writing, 1mm fine + 1–5mm round cotton nibs (fine tip suits thin sleeve stripes), opaque, quick-drying, works on plastic/sleeves. Arrange the pens in slot order (swatches show slot #1–48) so slot + colour together identify the deck. Any 48-colour acrylic paint-marker set with a fine tip will work; metallics are not recommended as they rub off inner sleeves. Mark the Perfect Fit inner sleeve (never the outer sleeve), so shared cards can move between decks in the same outer sleeve.
