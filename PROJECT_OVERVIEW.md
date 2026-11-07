# MTG Collection & SORTING Deck Hub

> A self-hosted Magic: The Gathering collection manager and deck tracker built specifically for the **modular "One Card, Every Deck"** philosophy.

---

## 1. Project Background & "Why It Exists"

Most Magic: The Gathering software falls into one of two categories:

1. **Deckbuilding Sites (Archidekt, Moxfield):** Excellent for crafting lists and testing curves, but poor at tracking physical cards, conditions, storage boxes, or multi-deck overlaps.
2. **Collection Apps (Delver Lens, Dragon Shield, TCGplayer):** Good for scanning values and basic inventory, but clunky when organizing actual decks and modular card pools.

### The Inspiration: SORTING ("One Card, Every Deck")

This application was created to bridge that gap and support modular physical card systems built around the "one card, every deck" idea.

In traditional MTG, players either buy expensive duplicate copies of staple cards (e.g., fetch lands, shock lands, Rhystic Study, Sol Ring) for every deck they build, or they spend painstaking time disassembling and tracking where cards went. The SORTING philosophy solves this by keeping **one single copy** of your favorite card (your premium foil, alternate art, or sentimental copy) in a central modular pool that can be shared across multiple decks.

To make that work seamlessly in real life, you need an application that:

- Knows **what physical cards you own** and **where they are stored** (e.g., "SORTING Tray 1", "Trade Binder", "Deck Box B").
- Knows **which decks need which cards**.
- Automatically calculates **overlaps** so you know which cards are shared across 2 or more decks.
- Provides both a rich **visual view** (for enjoying card art) and a dense **spreadsheet view** (for auditing and sorting).
- Lets you **adjust decks from your collection** — rename a deck, change its format, add/remove/quantity-adjust/move cards — without losing the link between decklists and physical inventory.

---

## 2. What the Software Does

### A. Dual-Perspective Management

- **Physical Collection Inventory:** Tracks physical assets including quantity, foil status, card condition (NM/LP/MP/HP/DMG), storage location, and purchase price. The API still stores condition per printing, but the UI defaults edits to NM to keep the flow focused on identity, sleeves, and value.
- **Deck Management:** Stores full decklists (Commander, Mainboard, Sideboard) with quick deck statistics and breakdown metrics. Deck detail groups cards by type within each section.

### B. Clumped Collection (One Row per Card Name)

- The Collection API groups `Card` rows by `name` before pagination. **All printings of the same card (different sets, foil, boxes, collector numbers) become one entry** with:
  - summed `quantity`, `printings_count`, `sets[]`, `storage_locations[]`,
  - a `printings[]` array (id, set, collector number, foil, quantity, storage, price, image),
  - a representative image (preferring a foil copy with art).
- The spreadsheet and grid show `×N` plus a `N printings` badge when relevant (e.g. `Sol Ring ×4 • 4 printings`). Navbar `unique` counts distinct names, not rows.
- The detail modal lists every printing with per-printing quantity, foil toggle, storage, and delete. *Save Changes* writes each printing individually. Deleting one printing removes only that row; **deleting the last copy of a name also removes deck slots for that name**. Removing a card *from a deck* never touches the Collection.

### C. Deck Building from the Collection (no import needed)

- **Deck list:** Each card shows format, `total (unique)` counts, and a size badge — `✓ 100/100` when correct or `⚠️ 100/60` plus an explanatory line when not. Expected sizes: **100 Commander/EDH, 60 most formats, 40 Draft/Sealed**. Empty or legacy numeric values (e.g. `3`) default to **Commander** (100).
- **Create without importing:** *＋ New Deck* in the Decks header opens a name/format/description form (Commander default) that calls `POST /api/decks` for an empty deck, then jumps straight into the builder.
- **Deck detail panel:**
  - *Edit Deck* modal — rename, choose format (Commander, Standard, Modern, Pioneer, Legacy, Vintage, Pauper, Draft/Sealed, Casual/Other), and edit description/notes.
  - *Add Card from Collection* builder — **only owned cards** (browsable without typing, plus live search), each result shows image, type, colour identity, and `Owned ×N`. For multi-printing names a **printing picker** (set / number / foil / storage) plus a large **art preview** lets you pin the exact copy before adding. Pick Mainboard / Commander / Sideboard and quantity, and add. Adding an existing slot increments its quantity (and updates the pinned printing). Adding a non-owned name is rejected (`POST` returns 400).
  - **Commander colour identity:** when a Commander is set, the builder-banner shows its identity and results are filtered to cards whose colour identity is a **subset** of the commander’s (e.g. mono-blue → blue + colourless only; Azorius WU → W, U, WU, and colourless). A “only show commander-legal cards” toggle can temporarily show everything, but `POST` still enforces legality for Commander decks (EDHREC has no stable colour-identity API, so this uses the Scryfall `color_identity` already cached in SQLite).
  - Per-card controls — `−`/`+` quantity (0 prompts to remove from deck), `👑` Commander toggle, `📦` Sideboard toggle (moving to Mainboard clears both), `✕` remove from deck. Clicking the card info opens the Scryfall-backed detail view.
  - *Delete Deck* removes only the `Deck` + `DeckCard` rows, never the Collection.
- **APIs:** `POST /api/decks` (create empty), `PUT /api/decks/<id>` (name/format/description), `POST /api/decks/<id>/cards` (`collection_card_id` pins the printing, colour-checked, collection-only), `PUT`/`DELETE /api/decks/<id>/cards/<id>`, `GET /api/collection/search?q=&deck_id=&all=` (owned + printings + identity). The server resolves metadata from the selected Collection printing.

### D. SORTING Multi-Deck Overlap Engine

- The application cross-references your physical inventory against all registered decklists by card name.
- **Shared Filter (`⚡ SORTING Shared (2+ decks)`):** Instantly filters for cards that appear in 2 or more active decks. This tells you exactly which cards belong in your central SORTING modular sleeve pool.
- **Unassigned Filter (`📦 Binder / Unassigned`):** Shows cards that are not currently in any deck, perfect for identifying trade binder stock or cards available for new brews.
- **Deck Filter:** Quickly isolate cards that belong to a single specific deck (`deck:<id>`), or by storage box (`storage:<location>`).
- **Deck badges:** Collection rows show `⚡ SORTING (n)` plus per-deck pills so overlaps are visible at a glance in both views.

### E. Dedicated SORTING Sleeve Marking Tool (`/sorting` or `/build`)

- **Local SORTING tool:** Complete offline-friendly sleeve-marking tool for local use (no external build site required).
- **1-Click Local Database Sync:** Import all decks directly from your collection database (`GET /api/sorting/sync-data`) without having to re-paste decklists. State is stored in `localStorage`.
- **Visual Sleeve Stripes:** Renders the physical sleeve edge with designated color markers for each deck in the modular pool. **48 stripe colours** (PRISM-compatible: one colour + one slot per deck, up to 48 decks on one sleeve; 96 with dot splits) modelled on the single purchasable [Betem 48 Colors Dual Tip set on Amazon.ca (B0BR3XX6NC, $29.99)](https://www.amazon.ca/dp/B0BR3XX6NC) — no single Uni Posca 48-set exists there (largest are 29/24 colours) — with slot-numbered swatches and adaptive sleeve previews (slots shrink as the pool grows).
- **Interactive Overlap Matrix:** Visual pairwise matrix displaying shared card counts across all decks.
- **SCRY-Mode:** Fullscreen card-by-card marking walkthrough with "Done" and "Skip" triggers.
- **Printable Guide & CSV Export:** Generate print-ready guides for deckboxes and CSV backups, plus full JSON backup/restore.

### F. Dual Currency Market Pricing (USD & CAD across Top 3 US Markets)

- **Top 3 US Single Card Markets:**
  1. **TCGplayer:** Market Price benchmark pulled via Scryfall.
  2. **Card Kingdom:** Top US retail single benchmark.
  3. **Cardhoarder / Liquid Index:** Pegged market liquidity index (Scryfall `tix`; Card Kingdom is estimated at +12% when not in the payload).
- **Live CAD Conversion:** Automatically queries real-time foreign exchange rates (`USD → CAD`) via `open.er-api.com` with `api.frankfurter.app` fallback and a 1-hour in-memory cache (default `1.40` when offline).
- **Total Collection Valuation:** Real-time collection value displayed in the navbar in both USD and CAD (`$X.XX USD · C$Y.YY CAD`) with a one-click Scryfall price refresh (`POST /api/collection/refresh-prices` uses Scryfall bulk lookup).
- **Breakdowns everywhere:** Card detail shows all three markets in USD+CAD; spreadsheet and grid show primary (TCGplayer) values.

### G. Visual Grid & Spreadsheet Views

- **Spreadsheet View (default):** Dense tabular view for scanning dozens of cards, with mana symbols, truncated Type Line, set/rarity/foil badges, deck pills, and USD/CAD prices. Layout is `table-layout: fixed` with a `<colgroup>` so card columns stay visible:
    - Type Line is capped at **95px** with ellipsis and full text on hover.
    - Storage column is hidden under 1150px (including its `<col>`) so prices don't fall off; per-card storage remains in the title, detail modal, and filters. Foil hides under 760px.
    - Name, Set, Decks, and price columns are sized to fit a ~1000px wrapper without horizontal scrolling.
- **Visual Card Grid:** Renders official high-resolution Scryfall card imagery with set emblems, `×N`, `N printings`, foil, rarity, deck badges, and USD/CAD prices.
- **Pagination & Rapid Filters:** Filter by color identity, rarity, foil status, storage box name, or search oracle/name text with responsive pagination (60/120/250/500 per page; 250 default in table mode). Sorting supports name, price, mana value, rarity, and date added.

### H. Smart Import & Scryfall Integration

- **1-Click Archidekt Import:** Paste any public Archidekt deck URL to automatically import the entire list with commander, sideboard, and category tags.
- **Standard Text / Export Parsing:** Supports standard formats (e.g., `4 Lightning Bolt`, `1x Snapcaster Mage (ISD) 78 *F*`, `1 Black Lotus (LEA) [foil]`), with `Sideboard:` / `Commander:` / `Companion:` section detection and `*F*`/`[foil]` handling.
- **Deck → Collection sync:** Optional checkbox adds imported cards to the main collection (deduped by Scryfall ID + finish + storage) with `Deck: <name>` as the default storage.
- **Scryfall Metadata Caching:** Automatically queries Scryfall for images, mana costs, oracle text, color identities, and flip cards, caching them in SQLite. Bulk lookups use `/cards/collection` (75 per batch) with retry on `429`, DFC front-face mapping, and server-side proxying (`/api/scryfall/card/<id>`).

---

## 3. Why It Is Built the Way It Is (Architectural Decisions)

| Design Choice | Rationale |
| :--- | :--- |
| **Separate `Card` vs `DeckCard` Models** | A physical card in your collection (`Card`) exists independently of a slot in a decklist (`DeckCard`). Multiple decks can reference the same card without duplicating physical inventory entries. Removing from a deck keeps the collection intact; removing the last collection copy clears deck slots. |
| **Clump by Name in the API** | `GET /api/collection` groups `Card` rows by `name` so printings are managed together while per-printing rows persist. Deck membership and SORTING overlaps also match by name, so different printings are interchangeable for deckbuilding. |
| **Normalized Name Matching for Overlaps** | SORTING overlap queries group by `DeckCard.name`. Regardless of whether Deck A uses an original printing and Deck B uses a promo printing, the system recognizes that the physical card can be shared between them. |
| **Deck-Size Guardrails** | `Deck.expected_size()` (100 Commander, 40 Draft/Sealed, 60 others, defaulting empty/numeric to Commander) is returned by the API and rendered as `✓`/`⚠️` in the deck list and detail, preventing silent 99- or 101-card Commander decks. |
| **Local SQLite + Docker Architecture** | Built to run 24/7 on a home server or NAS (such as TrueNAS) via Docker Compose. Card collections and personal financial records remain 100% private and offline-capable without relying on external cloud subscriptions. |
| **Vanilla Frontend (No Heavy Frameworks)** | Built with Jinja2 templates, standard modern JavaScript, and clean CSS. This eliminates frontend build pipelines (npm, webpack, vite), ensuring the app remains lightweight, fast, and maintainable for years to come. |
| **Server-Side API Proxying** | All Scryfall lookups are executed server-side with proper user-agent headers and caching to stay compliant with Scryfall API guidelines and prevent browser CORS issues. |

---

## 4. Recommended SORTING Workflow

1. **Import Your Decks:** Go to the **Import** tab and paste the Archidekt URLs or decklists for all of your active Commander or Constructed decks. Check *Also add cards to Collection* for new acquisitions.
2. **Review the SORTING Shared Pool:** Navigate to the **Collection** tab and select **⚡ SORTING Shared (2+ decks)** from the deck dropdown.
3. **Organize Physical Cards:** These shared cards become your primary SORTING pool. Open each clumped card, verify its printings (e.g. `Sol Ring ×4 • 4 printings`), and update the storage location per printing (e.g. `SORTING Case - Staple Tray`).
4. **Build or Adjust Decks:** In the **Decks** tab, use *＋ New Deck* to start a deck from scratch (or import via **Import** if you have a list) and build it only from your collection — pin a printing for each card and let the Commander colour-identity filter keep the 99 legal. Rename decks and set formats as needed. Watch the `✓`/`⚠️` size badge — Commander should read `100/100`.
5. **Build & Play:** In the **SORTING Builder**, *Load from Local Collection* and use the marking table / SCRY-mode to stripe sleeves by deck color. When packing a deck for game night, reference the deck view to see which cards are pulled from your SORTING tray into that deck's sleeve module.

---

## 5. Technology Stack

- **Backend:** Python 3.12+, Flask 3.1, Flask-SQLAlchemy, Werkzeug, Requests
- **Database:** SQLite (persisted in `/app/data/collection.db` or mounted TrueNAS dataset)
- **Frontend:** HTML5, Modern CSS3 (Grid & Flexbox), Vanilla JavaScript (ES6+)
- **External Data:** Scryfall REST API, `open.er-api.com` / `api.frankfurter.app` for USD→CAD
- **Deployment:** Docker & Docker Compose (`run.py` for local dev, port `7432`)
