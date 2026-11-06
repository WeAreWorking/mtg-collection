# MTG Collection & PRISM Deck Hub

> A self-hosted Magic: The Gathering collection manager and deck tracker built specifically for the **modular "One Card, Every Deck"** philosophy.

---

## 1. Project Background & "Why It Exists"

Most Magic: The Gathering software falls into one of two categories:
1. **Deckbuilding Sites (Archidekt, Moxfield):** Excellent for crafting lists and testing curves, but poor at tracking physical cards, conditions, storage boxes, or multi-deck overlaps.
2. **Collection Apps (Delver Lens, Dragon Shield, TCGplayer):** Good for scanning values and basic inventory, but clunky when organizing actual decks and modular card pools.

### The Inspiration: PRISM ("One Card, Every Deck")
This application was created to bridge that gap and support modular physical card systems like [PRISM: One Card, Every Deck](https://www.kickstarter.com/projects/prismmtg/prism-one-card-every-deck).

In traditional MTG, players either buy expensive duplicate copies of staple cards (e.g., fetch lands, shock lands, Rhystic Study, Sol Ring) for every deck they build, or they spend painstaking time disassembling and tracking where cards went. The PRISM philosophy solves this by keeping **one single copy** of your favorite card (your premium foil, alternate art, or sentimental copy) in a central modular pool that can be shared across multiple decks.

To make that work seamlessly in real life, you need an application that:
- Knows **what physical cards you own** and **where they are stored** (e.g., "PRISM Tray 1", "Trade Binder", "Deck Box B").
- Knows **which decks need which cards**.
- Automatically calculates **overlaps** so you know which cards are shared across 2 or more decks.
- Provides both a rich **visual view** (for enjoying card art) and a dense **spreadsheet view** (for auditing and sorting).

---

## 2. What the Software Does

### A. Dual-Perspective Management
- **Physical Collection Inventory:** Tracks physical assets including quantity, foil status, card condition (NM/LP/MP/HP/DMG), storage location, and purchase price.
- **Deck Management:** Stores full decklists (Commander, Mainboard, Sideboard) with quick deck statistics and breakdown metrics.

### B. PRISM Multi-Deck Overlap Engine
- The application cross-references your physical inventory against all registered decklists.
- **Shared Filter (`⚡ PRISM Shared`):** Instantly filters for cards that appear in 2 or more active decks. This tells you exactly which cards belong in your central PRISM modular sleeve pool.
- **Unassigned Filter (`📦 Binder / Unassigned`):** Shows cards that are not currently in any deck, perfect for identifying trade binder stock or cards available for new brews.
- **Deck Filter:** Quickly isolate cards that belong to a single specific deck.

### C. Dedicated PRISM Sleeve Marking Tool (`/prism` or `/build`)
- **Local Replica of PRISM App:** Complete offline-friendly copy of the [PRISM build tool](https://prismmtg.com/build.html).
- **1-Click Local Database Sync:** Import all decks directly from your collection database without having to re-paste decklists.
- **Visual Sleeve Stripes:** Renders the physical sleeve edge with designated color markers for each deck in the modular pool.
- **Interactive Overlap Matrix:** Visual pairwise matrix displaying shared card counts across all decks.
- **SCRY-Mode:** Fullscreen card-by-card marking walkthrough with "Done" and "Skip" triggers.
- **Printable Guide & CSV Export:** Generate print-ready guides for deckboxes and CSV backups.

### D. Dual Currency Market Pricing (USD & CAD across Top 3 US Markets)
- **Top 3 US Single Card Markets:**
  1. **TCGplayer:** Market Price benchmark pulled via Scryfall.
  2. **Card Kingdom:** Top US retail single benchmark.
  3. **Cardhoarder / Liquid Index:** Pegged market liquidity index.
- **Live CAD Conversion:** Automatically queries real-time foreign exchange rates (`USD → CAD`), giving Canadian collectors instant dual-currency valuations in both the visual grid and spreadsheet table.
- **Total Collection Valuation:** Real-time collection value displayed in the navbar in both USD and CAD (`$X.XX USD · C$Y.YY CAD`) with a one-click Scryfall price refresh.
- **Simplified Workflow:** Card condition tracking has been streamlined out of the primary workflow to focus purely on card identity, sleeve slotting, and current market values.

### C. Visual Grid & Spreadsheet Views
- **Visual Card Grid:** Renders official high-resolution Scryfall card imagery with authentic foil effects, set emblems, and deck badges showing which decks use each card.
- **Spreadsheet View:** A dense, clean tabular view that lets you scan dozens of cards at once, sort columns, and view physical inventory data at a glance.
- **Pagination & Rapid Filters:** Filter by color identity, rarity, foil status, storage box name, or search oracle/name text with responsive pagination.

### D. Smart Import & Scryfall Integration
- **1-Click Archidekt Import:** Paste any public Archidekt deck URL to automatically import the entire list with commander, sideboard, and category tags.
- **Standard Text / Export Parsing:** Supports standard formats (e.g., `4 Lightning Bolt`, `1x Snapcaster Mage (ISD) 78 *F*`).
- **Scryfall Metadata Caching:** Automatically queries Scryfall for images, mana costs, oracle text, color identities, and flip cards, caching them locally in SQLite to prevent duplicate network calls.

---

## 3. Why It Is Built the Way It Is (Architectural Decisions)

| Design Choice | Rationale |
| :--- | :--- |
| **Separate `Card` vs `DeckCard` Models** | A physical card in your collection (`Card`) exists independently of a slot in a decklist (`DeckCard`). Multiple decks can reference the same card without duplicating physical inventory entries. |
| **Normalized Name Matching for Overlaps** | PRISM overlap queries group by `DeckCard.name`. Regardless of whether Deck A uses an original printing and Deck B uses a promo printing, the system recognizes that the physical card can be shared between them. |
| **Local SQLite + Docker Architecture** | Built to run 24/7 on a home server or NAS (such as TrueNAS) via Docker Compose. Card collections and personal financial records remain 100% private and offline-capable without relying on external cloud subscriptions. |
| **Vanilla Frontend (No Heavy Frameworks)** | Built with Jinja2 templates, standard modern JavaScript, and clean CSS. This eliminates frontend build pipelines (npm, webpack, vite), ensuring the app remains lightweight, fast, and maintainable for years to come. |
| **Server-Side API Proxying** | All Scryfall lookups are executed server-side with proper user-agent headers and caching to stay compliant with Scryfall API guidelines and prevent browser CORS issues. |

---

## 4. Recommended PRISM Workflow

1. **Import Your Decks:** Go to the **Import** tab and paste the Archidekt URLs or decklists for all of your active Commander or Constructed decks.
2. **Review the PRISM Shared Pool:** Navigate to the **Collection** tab and select **⚡ PRISM Shared (2+ decks)** from the deck dropdown.
3. **Organize Physical Cards:** These shared cards become your primary PRISM pool. Update their `storage_location` (e.g., `PRISM Case - Staple Tray`).
4. **Build & Play:** When packing a deck for game night, reference the deck view to see which cards are pulled from your PRISM tray into that deck's sleeve module.

---

## 5. Technology Stack

- **Backend:** Python 3.12+, Flask 3.1, Flask-SQLAlchemy, Werkzeug, Requests
- **Database:** SQLite (persisted in `/app/data/collection.db` or mounted TrueNAS dataset)
- **Frontend:** HTML5, Modern CSS3 (Grid & Flexbox), Vanilla JavaScript (ES6+)
- **External Data:** Scryfall REST API
- **Deployment:** Docker & Docker Compose (`run.py` for local dev)
