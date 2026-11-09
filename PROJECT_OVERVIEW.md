# MTG Collection & SORTING Deck Hub

> A self-hosted Magic: The Gathering collection manager and deck tracker for the **modular "One Card, Every Deck"** philosophy.

---

## 1. Why it exists

Deck sites (Archidekt/Moxfield) are weak at tracking physical copies, storage, and multi-deck overlaps; collection apps are weak at modular deck pools. SORTING keeps **one premium copy** of a staple in a shared pool that every deck can use, with overlaps calculated automatically.

The app tracks what you own and where it sits, which decks need it, and visual + spreadsheet views for enjoying art and auditing inventory.

---

## 2. What it does

### A. Collection — clumped by name

- `/api/collection` groups `Card` rows by name into one entry: summed `quantity`, `printings_count`, `sets[]`, and a `printings[]` array (id, set, number, foil, qty, storage, image).
- Spreadsheet (default) and grid show `×N`, `N printings` badges, SORTING/deck pills, and USD/CAD prices.
- **Sort:** field dropdown (name, price, quantity, mana value, rarity, date added) + separate **↑ Low to High / ↓ High to Low** dropdown; table headers are also clickable. Backend honours `sort=` × `order=asc|desc`.
- **Bulk remove:** checkboxes per card + `Select all on page` (header checkbox/button) and `Select all matching filter` (all pages). Confirmation modal previews **every printing** (image per printing) with per-printing “Remove n” steppers; partial removal decrements, full removal deletes. Last-copy removal clears deck slots.
- **Card modal quick-add:** printing browser (scroll strip), hover thumbnails for large preview, per-printing `＋ Add` to add one copy of that exact printing without looking up set codes on Scryfall.

### B. Decks — build in-app, collection-only

- `＋ New Deck` (`POST /api/decks`, Commander default) creates an empty deck — no import needed. Empty/legacy `"3"` formats normalise to Commander.
- Builder offers **only owned cards** with a printing picker + art preview; adding a non-owned name is rejected (400).
- **Commander colour identity:** when a Commander is set (union for partners), results filter to identity ⊆ commander (mono-blue → blue + colourless; WU → W/U/WU + colourless). API enforces legality for non-commander adds. (Uses cached Scryfall `color_identity`, not EDHREC — no stable local API.)
- `POST /api/decks/<id>/cards` accepts `collection_card_id` to pin the printing.

### C. SORTING overlap + sleeve marking

- **SORTING Shared / Unassigned / deck / storage** filters find pool vs. binder cards by name matching.
- **SORTING Builder** (`/sorting`): *Load from Local Collection* opens a **selection screen** (search, select all/clear, already-imported badges) instead of importing everything. State in `localStorage`.
- Sleeve stripes for up to **48 decks** (96 with half-marks), slot-numbered swatches, adaptive previews, overlap matrix, SCRY-mode, CSV/print/JSON export.

### D. Import, pricing, data

- Import: text/Archidekt/URL parsing; optional deck→collection sync (storage default `Deck: <name>`). Collection import takes storage only (condition defaults NM, no purchase-price field).
- Scryfall bulk lookups (75/batch, 429 retry, DFC mapping) cached server-side; dual USD/CAD from TCGplayer/Card Kingdom/Cardhoarder + live FX.

<details>
<summary><strong>Architecture choices</strong></summary>

| Choice | Rationale |
|---|---|
| Separate `Card` vs `DeckCard` | Physical copies exist apart from deck slots; many decks share a name without duplicating inventory. |
| Clump by name in API | Printings managed together; overlaps match by name so any printing is interchangeable. |
| Commander identity (Scryfall) | Enforces the 99 without external dependencies; offline-capable. |
| Deck-size guardrails | 100/60/40 badges prevent silent broken decks. |
| SQLite + Docker, vanilla frontend | Private, offline, no build pipeline; easy NAS deployment. |

</details>

---

## 3. Workflow

1. **Import** decks or **＋ New Deck** and build from collection.
2. **Collection → ⚡ SORTING Shared** to find the Pool; set storage per printing.
3. **Decks** → set Commander, add colour-legal cards, check size badge.
4. **SORTING** → pick decks from the local database, mark stripes via table / SCRY-mode.

---

## 4. Tech stack

Python 3.12 / Flask 3.1 / SQLAlchemy / SQLite · Jinja2 + vanilla JS/CSS · Scryfall API · Docker (`run.py` port `7432`). See README Quick Start (collapsible) for setup.
