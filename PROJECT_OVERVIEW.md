# MTG Collection & SORTING Deck Hub: Project Overview

A self-hosted Magic: The Gathering collection manager and deck builder for the **"one card, every deck"** approach.

---

## 1. Why it exists

Deck sites (Archidekt, Moxfield) are built around decklists, not physical copies: they don't know you own one Sol Ring that five decks share. Collection apps track copies but not shared deck pools. This app joins the two:

- **Collection:** what you physically own and where it's stored.
- **Decks:** lists built only from cards you own. Any number of decks can use the same card.
- **SORTING:** the cards in 2+ decks form the **Pool**. Each deck gets a slot and a stripe colour, and each Pool card's inner sleeve is marked with the stripes of every deck that uses it, so it can be sorted back after play.

---

## 2. Data model

| Table | One row per | Notes |
| --- | --- | --- |
| `cards` (`Card`) | printing + finish + condition + storage location | `quantity` counts copies. Card data (oracle text, colour identity, images, prices) is cached from Scryfall. |
| `decks` (`Deck`) | deck | `format` drives the expected size: Commander 100, Draft/Sealed 40, everything else 60. |
| `deck_cards` (`DeckCard`) | card per deck section | Linked to the collection **by name**, not by row, so any owned printing satisfies the slot. Flags: `is_commander`, `is_sideboard`. |
| `edhrec_cache` (`EdhrecCache`) | EDHREC commander page | Flattened card list as JSON plus fetch time. |

Rules:

- A deck can only contain names that exist in `cards`.
- Removing a card from a deck never changes `cards`.
- In Commander decks, a card can only enter the mainboard (when added, moved from the sideboard, or demoted from commander) if it fits the commanders' colour identity.
- Deleting the last copy of a name from `cards` deletes its `deck_cards` rows.
- Deck size counts commander + mainboard; the sideboard is shown separately.

Schema changes: `db.create_all()` adds new tables; `_migrate_columns()` in `app/__init__.py` adds columns that were introduced after a database was created.

---

## 3. Features

### Collection

- `/api/collection` groups rows by name: total `quantity`, `printings[]` (set, collector number, finish, storage, quantity, image), `sets[]`, and the decks that use the card. The display row prefers a foil printing with an image.
- Filters: text (name / type / rules text), colour identity (`C` = colourless), rarity, finish, deck, storage location, **⚡ SORTING Shared** (2+ decks) and **Unassigned** (no deck). Grouping and sorting happen before paging, so sorts are correct across pages.
- Card window: every printing with editable quantity, finish and storage; **＋ Add** adds a copy of that exact printing.
- Bulk remove: select names on one page or across all pages of a filter, review every printing, and choose how many copies of each to remove (`POST /api/collection/bulk-delete`).

### Decks

- **＋ New Deck** creates an empty deck (Commander by default). The builder searches only your collection and lets you pick the printing shown in the deck.
- **Commander colour identity:** once a commander is set (partners are combined), the builder only lists cards whose colour identity fits, and the API rejects others. Identity comes from Scryfall data cached on each card.
- **⭐ Recommendations:** `GET /api/decks/<id>/recommendations` loads the commander's EDHREC page (`json.edhrec.com`; partner pairs supported) and keeps cards you own that fit the colour identity and aren't already in the deck. The default ranking is **inclusion %**: the share of that commander's EDHREC decks running the card (`num_decks / potential_decks`), as on EDHREC's *Top Cards* list. Other sorts: synergy, deck count, name. You can filter by EDHREC list (Top Cards, High Synergy Cards, Creatures…). Rows marked `⚡ in N decks` are already used elsewhere, so they would join the Pool.

### Import

- Text lists: `qty [x] name [(SET) [collector#]] [*F* | *E* | [foil]]`. A collector number is only read after a set code, so multi-word names without a set are kept whole. Set + collector number selects the exact printing.
- Deck text: `Commander` / `Deck` / `Sideboard` / `Maybeboard` headers and Archidekt category tags set the section; maybeboard cards and cards whose primary category is `{noDeck}` are skipped.
- Archidekt URLs are read through Archidekt's public deck API; categories the owner excluded from the deck are skipped. A deck that can't be fetched returns an error.
- Cards are resolved with Scryfall's bulk `/cards/collection` endpoint (75 per request, duplicates sent once, 429 retry; an unknown set + collector number is retried by name + set), with single-card lookups as a fallback.

### Pricing

- Stored per printing from Scryfall: TCGplayer market price (USD, non-foil and foil/etched) and MTGO price in tix.
- The card window also shows Cardmarket (EUR) and links to TCGplayer, Card Kingdom and Cardmarket from the live Scryfall card.
- CAD = USD × a live exchange rate (open.er-api.com, falling back to frankfurter.app), cached for an hour. Navbar totals use the TCGplayer price for each copy's finish. **↻** re-fetches all prices.

### SORTING Builder

- **Load from Local Collection** opens a selection list of database decks; already-loaded decks are skipped.
- Slot *N* is palette colour *N* (48 colours). A new deck takes the first free slot, so removing a deck frees its colour; decks are listed in slot order. Beyond 48 decks, colours are reused as half-marks.
- Results: every card with its decks and stripe preview, Pool-only and not-yet-marked filters, overlap matrix, SCRY-Mode (one card at a time), CSV, print and JSON backup.
- State is stored in the browser's `localStorage`, not the database. Use JSON export to move it between browsers.

---

## 4. Design decisions

| Decision | Reason |
| --- | --- |
| Separate `Card` and `DeckCard` | Physical copies exist independently of decks; many decks can list the same card without duplicating inventory. |
| Match decks to the collection by name | Any printing is interchangeable in a deck, which is what makes a shared Pool work. |
| Colour identity from Scryfall | Enforces Commander deck-building rules from locally cached data. |
| EDHREC for recommendations, cached | Popularity data only EDHREC has; caching keeps the builder fast and usable offline with the last fetched data. |
| SQLite, Flask, vanilla JS | Single-user, self-hosted, no build step; easy to run on a NAS in Docker. |

---

## 5. Tech stack

Python 3.12, Flask 3.1, Flask-SQLAlchemy 3.1 (SQLAlchemy 2), SQLite, Jinja2 templates with vanilla JS/CSS, Docker image built by GitHub Actions and published to GHCR. The container runs Gunicorn (one worker so there is a single SQLite writer, four threads); `python run.py` starts Flask's development server for local use. Both listen on port `7432`. Setup instructions are in the [README](README.md).
