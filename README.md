# MTG Collection & SORTING Deck Hub

A self-hosted Magic: The Gathering collection manager and deck builder for the **"one card, every deck"** approach: you own one copy of a staple, it lives in a shared Pool, and every deck that runs it borrows it. The app tracks what you own, which decks use each card, and how to mark sleeves so shared cards can be sorted back into their decks.

Background, data model and design decisions: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

---

## Features

| Page | What it does |
| --- | --- |
| **Collection** (`/collection`) | Table or grid view of everything you own. Copies with the same name are grouped into one row (total quantity, every printing listed). Search by name, type or rules text; filter by colour identity, rarity, finish, deck, storage location, or **⚡ SORTING Shared** (cards in 2+ decks). Sort by name, price, quantity, mana value, rarity or date added. The card window shows every printing (edit quantity / finish / storage, **＋ Add** a copy of that printing) and prices. Select cards across pages and **bulk-remove** them, choosing how many copies of each printing to remove. |
| **Decks** (`/decks`) | Create a deck and add cards **from your collection only**, choosing which printing to show. Commander decks only allow cards inside the commander's colour identity. Size badges check 100 (Commander), 40 (Draft/Sealed) or 60 (others), excluding the sideboard. **⭐ Recommendations** lists cards you own that EDHREC suggests for your commander, ranked by how many of that commander's decks run them. |
| **Import** (`/import`) | Paste a card list into the collection, or import a deck from an Archidekt URL or exported text (optionally adding its cards to the collection). |
| **SORTING Builder** (`/sorting`) | Load decks from the database, see which cards are in 2+ decks (the Pool), and get the sleeve-stripe colours for every card: up to 48 deck slots (96 with half-marks), overlap matrix, step-by-step SCRY-Mode, CSV / print / JSON export. |

Rules the app enforces:

- **Collection = physical copies; decks = lists.** A deck slot doesn't reserve a copy, so one owned card can sit in many decks. Removing a card from a deck never touches the collection. Removing the **last** copy from the collection also removes it from every deck.
- **Names, not printings, connect the two.** Any printing you own satisfies a deck slot.

External data (all optional; cached so the app keeps working offline):

| Source | Used for |
| --- | --- |
| [Scryfall](https://scryfall.com/docs/api) | Card data, images, prices (TCGplayer USD, Cardmarket EUR, MTGO tix) |
| [EDHREC](https://edhrec.com) | Commander recommendations (cached 7 days per commander) |
| [Archidekt](https://archidekt.com) | Deck import by URL (public decks) |
| open.er-api.com / frankfurter.app | USD → CAD exchange rate (cached 1 hour) |

---

## Quick start

<details>
<summary><strong>Run locally with Python</strong></summary>

Requires Python 3.12+.

1. `pip install -r requirements.txt`
2. `python run.py`
3. Open `http://localhost:7432`

The database is created at `data/collection.db` on first run; back it up. `python run.py` uses Flask's built-in server, which is fine for local use; the Docker image runs Gunicorn instead.

</details>

<details>
<summary><strong>TrueNAS SCALE with Dockge (recommended for NAS)</strong></summary>

1. Create a dataset for the database, e.g. `/mnt/SSDs/Databases/MTG-collection`.
2. **Apps → Dockge → Stacks → Add Stack** and paste this repo's `docker-compose.yml`.
3. Set `MTG_DATA_PATH` to the dataset path and `SECRET_KEY` to a long random string.
4. **Deploy**. It pulls `ghcr.io/weareworking/mtg-collection:latest`; to update after a push to `main`, click **Redeploy**.

Full steps: [docs/install-dockge.md](docs/install-dockge.md)

</details>

<details>
<summary><strong>TrueNAS SCALE Custom App (without Dockge)</strong></summary>

1. Create the same dataset as above.
2. **Apps → Custom App → Create**, paste `docker-compose.yml`.
3. Set `MTG_DATA_PATH` (host path) and `SECRET_KEY`.
4. Update later with the app's **Update** button.

Full steps: [docs/install-truenas-custom-app.md](docs/install-truenas-custom-app.md)

</details>

<details>
<summary><strong>Docker on any machine</strong></summary>

```bash
cp .env.example .env   # set MTG_DATA_PATH and SECRET_KEY
docker compose pull
docker compose up -d
```

The app listens on port `7432`. If that port is taken, change the host side of the mapping, e.g. `"7433:7432"`. The container serves the app with Gunicorn (1 worker, 4 threads).

</details>

---

## Typical workflow

1. **Import** your collection and existing decks, or create decks on **Decks → ＋ New Deck**.
2. On a deck, set the **👑 Commander**, then add cards from your collection or from **⭐ Recommendations**.
3. **Collection → ⚡ SORTING Shared** shows your Pool; set a storage location for those cards.
4. **SORTING Builder → Load from Local Collection**, pick decks, then mark sleeves from the table or SCRY-Mode.

---

## Import formats

One card per line: quantity, name, then optionally `(SET)`, collector number and finish.

```
4 Lightning Bolt
3x Llanowar Elves
2 Snapcaster Mage (ISD)
1x Swords to Plowshares (CMM) 50 *F*
1 Black Lotus (LEA) [foil]
```

With a set code and collector number (`(CMM) 50`) that exact printing is imported.

Deck text may contain `Commander`, `Deck`/`Mainboard`, `Sideboard` and `Maybeboard` headers; a blank line ends the Commander block. Archidekt category tags (`[Commander{top}]`, `[Sideboard]`) put a card in that section. **Maybeboard cards, and cards whose primary Archidekt category is excluded from the deck (`{noDeck}`), are skipped.** Imported decks are stored under `Deck: <name>` in the collection unless you enter a storage location.

---

<details>
<summary><strong>Project structure and API</strong></summary>

```
app/
  __init__.py   app factory, SQLite setup, column migrations
  models.py     Card, Deck, DeckCard, EdhrecCache
  routes.py     pages + JSON API
  importer.py   text / Archidekt parsing and import
  scryfall.py   Scryfall client (bulk lookups, retries)
  pricing.py    price selection and USD→CAD rate
  edhrec.py     EDHREC commander data + cache
  templates/    Jinja pages
  static/       app.js (collection, decks, import), sorting.js, CSS, mana symbols
data/           collection.db (created on first run)
docs/           TrueNAS install guides
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/collection` | Grouped collection search. Params: `q`, `color` (WUBRG or `C`), `rarity`, `foil`, `set_code`, `storage`, `in_deck` (`shared`, `unassigned`, `deck:<id>`, `storage:<name>`), `sort` (`name`, `price`, `quantity`, `cmc`, `rarity`, `added_at`), `order`, `page`, `per_page` |
| `GET` `PUT` `DELETE` | `/api/collection/<id>` | Read, edit or delete one printing row |
| `POST` | `/api/collection/bulk-delete` | `{items: [{printing_id, quantity?}]}` or `{ids: [...]}` |
| `GET` | `/api/collection/search` | Owned cards for the deck builder (`q`, `deck_id`, `all=1` to ignore colour identity) |
| `GET` | `/api/collection/storage-locations` | Distinct storage locations |
| `POST` | `/api/collection/refresh-prices` | Re-fetch all prices from Scryfall |
| `GET` `POST` | `/api/decks` | List decks / create an empty deck |
| `GET` `PUT` `DELETE` | `/api/decks/<id>` | Deck with cards / rename or change format / delete |
| `POST` | `/api/decks/<id>/cards` | Add an owned card (`name` or `collection_card_id`, `quantity`, `is_commander`, `is_sideboard`) |
| `PUT` `DELETE` | `/api/decks/<id>/cards/<card_id>` | Change quantity or section / remove from deck |
| `GET` | `/api/decks/<id>/recommendations` | EDHREC suggestions you own (`sort=top\|synergy\|decks\|name`, `category`, `refresh=1`) |
| `POST` | `/api/import/collection`, `/api/import/deck` | Imports |
| `GET` | `/api/sorting/sync-data`, `/api/sorting/shared` | Decks for the SORTING builder; cards in 2+ decks |
| `GET` | `/api/stats`, `/api/currency` | Navbar totals; USD→CAD rate |
| `GET` | `/api/scryfall/card/<scryfall_id>` | Full Scryfall card (cached) |

</details>

---

## Sleeve-marking markers

SORTING assigns each deck a slot (1–48) and a stripe colour. Use one paint marker per slot and keep them in slot order. Fine-tip acrylic markers work well, for example the [Betem 48-colour dual-tip acrylic set](https://www.amazon.ca/dp/B0BR3XX6NC). The on-screen colours are a guide; your markers won't match them exactly.

Mark the **inner** (perfect-fit) sleeve, never the outer one, so a shared card can move between decks in the same outer sleeve. Avoid metallic markers; they rub off.
