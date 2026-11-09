# MTG Collection & SORTING Deck Hub

A self-hosted Magic: The Gathering collection manager and deck tracker designed for the **modular "One Card, Every Deck"** system using a modular pool for shared staples.

For background, architecture, and workflow, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

---

## What it does

| Tab | What you can do |
| --- | --- |
| **Collection** (`/collection`) | Browse by spreadsheet or grid. Same-name cards are **clumped** with summed quantities and a `printings[]` list. Click for oracle text, images, prices, and every printing. Sort by name/price/quantity/mana/rarity/date with a separate **↑ Low to High / ↓ High to Low** dropdown, or click table headers. **Select all on page / matching filter**, then **bulk-remove** with a preview modal (all printings + per-printing “how many to remove”). Quick-add: in the card modal, browse printings (scroll strip + hover preview) and **＋ Add** one copy of that exact printing. |
| **Decks** (`/decks`) | Live size badges (`✓ 100/100`, `⚠️ 100/60`). **＋ New Deck** (defaults to Commander) with no import needed, then build **only from your collection** with a printing picker + art preview. Commander-set decks filter to **commander-legal cards** (colour identity ⊆ commander). Edit format/name, `−/+`, `👑/📦` section toggles. |
| **Import** (`/import`) | Paste text (`4 Lightning Bolt`) or import a deck via Archidekt URL / export text. Optionally sync deck cards into the Collection with storage. |
| **SORTING** (`/sorting`, `/build`) | Sleeve-marking tool: choose decks via a **selection screen** from the local database, then mark Pool cards (shared in 2+ decks) with **48 stripe colours**. Overlap matrix, SCRY-mode, CSV/print/JSON export. |

Other highlights:

- **Physical truth:** `Card` rows are what you own; `DeckCard` rows are deck slots. Removing from a deck never deletes the collection copy; removing the last collection copy clears deck slots.
- **SORTING Shared:** Collection → deck dropdown → `⚡ SORTING Shared (2+ decks)`; `📦 Binder / Unassigned` for no-deck cards.
- **Values:** Navbar USD/CAD totals (TCGplayer / Card Kingdom / Cardhoarder + live FX); card detail shows all three. Refresh with `↻`.
- **Data:** Scryfall images/mana/oracle/rarity/colours cached in SQLite.

---

## Quick Start

Pick one — steps are collapsed by default.

<details>
<summary><strong>Running Locally (Python)</strong></summary>

1. `pip install -r requirements.txt`
2. `python run.py`
3. Open `http://localhost:7432`.

> Creates `data/collection.db` on first run — back it up. Set `SECRET_KEY` for production.

</details>

<details>
<summary><strong>TrueNAS SCALE with Dockge (easiest)</strong></summary>

Prereq: create a dataset (e.g. `/mnt/SSDs/Databases/MTG-collection`). The container creates `collection.db` inside it.

1. **Apps → Dockge → Stacks → Add Stack**, paste the repo `docker-compose.yml` (image-only).
2. Set `MTG_DATA_PATH` = dataset path, `SECRET_KEY` = long random string.
3. **Deploy** (pulls `ghcr.io/weareworking/mtg-collection:latest`). Update: push → **Redeploy**.

Full steps: [docs/install-dockge.md](docs/install-dockge.md)

</details>

<details>
<summary><strong>TrueNAS SCALE native Custom App (no Dockge)</strong></summary>

Prereq: same dataset as above.

1. **Apps → Custom App → Create**, paste the same compose.
2. Set `MTG_DATA_PATH` as a Host Path/Dataset picker, `SECRET_KEY` as Secret.
3. Update Policy = pull latest. Update via **Update** button.

Full steps: [docs/install-truenas-custom-app.md](docs/install-truenas-custom-app.md)

</details>

<details>
<summary><strong>Local Docker (dev)</strong></summary>

```bash
docker compose pull
docker compose up -d
```

Port `7432` (change host side to `"7433:7432"` if in use).

</details>

---

## Recommended workflow

1. **Import** decks/cards, or **Decks → ＋ New Deck** to build from your collection.
2. **Collection → ⚡ SORTING Shared** to find your Pool; check printings/storage.
3. **Decks** → set Commander, add from collection (printing picker, colour-legal only), watch the size badge.
4. **SORTING** → *Load from Local Collection* → pick decks → mark via table / SCRY-mode.

<details>
<summary><strong>Project structure & API & notes</strong></summary>

```
app/  __init__ (factory/migration)  models (Card/Deck/DeckCard)
      routes (pages + JSON APIs)  importer  scryfall  pricing
      templates/  static/app.js, style.css, sorting.js/css, mana/
data/  Dockerfile  docker-compose.yml  run.py  requirements.txt
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/collection?q=&in_deck=&color=&rarity=&foil=&sort=&order=&page=&per_page=` | Clumped search (`sort=name\|price\|quantity\|cmc\|rarity\|added_at`, `order=asc\|desc`) |
| `POST` | `/api/collection/bulk-delete` | Bulk remove `{items:[{printing_id,quantity?}]}` (partial or full, deck cascade) |
| `GET/PUT/DELETE` | `/api/collection/<id>` | Read/edit/delete one printing |
| `GET` | `/api/collection/search?q=&deck_id=&all=` | Owned cards + printing picker; `deck_id` filters to commander-legal |
| `GET/POST` | `/api/decks` · `/api/decks/<id>` | List/create empty deck, detail/edit/delete |
| `POST` | `/api/decks/<id>/cards` | Add collection-only card (pin `collection_card_id`, colour-checked) |
| `POST` | `/api/import/collection` · `/api/import/deck` | Text / Archidekt import |
| `GET` | `/api/sorting/sync-data` · `/api/sorting/shared` | SORTING selection + shared list |

- Decks: Commander/EDH 100, Draft/Sealed 40, others 60; empty/legacy numeric defaults to Commander.
- Condition is stored per printing but the UI defaults to NM to keep focus on identity/value.

</details>

### Sleeve-marking markers (SORTING)

48 stripe colours (one colour + one slot per deck, up to 48 decks/sleeve; 96 with half-marks). No single Uni Posca 48-set exists on Amazon.ca (largest are 29/24), so the palette matches a single purchasable set:

- [Betem 48 Colors Dual Tip Acrylic Paint Markers (B0BR3XX6NC, $29.99)](https://www.amazon.ca/dp/B0BR3XX6NC) — 1mm fine + 1–5mm tips for thin stripes, opaque and quick-drying. Arrange in swatch slot order (#1–48). Mark the Perfect Fit inner sleeve (never the outer), so shared cards can move decks in the same outer sleeve. Avoid metallics (they rub off).
