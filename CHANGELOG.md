# Changelog

## 2026-11-12: Deck recommendations, bug fixes and cleanup

### Added
- **⭐ Recommendations** on the deck page: cards you own that EDHREC suggests for the deck's commander, ranked by inclusion % (EDHREC's *Top Cards*). Sort by synergy, deck count or name; filter by EDHREC list; one-click add. Supports partner commanders. Cards already in other decks are marked `⚡ in N decks`.
  - New `app/edhrec.py`, new `edhrec_cache` table (created automatically), new endpoint `GET /api/decks/<id>/recommendations`.
  - EDHREC pages are cached for 7 days; if EDHREC can't be reached, the last cached data is shown.
- Card window shows Cardmarket (EUR) and buy links for TCGplayer, Card Kingdom and Cardmarket, using the live Scryfall card.
- `CHANGELOG.md`.

### Fixed
- **Import parser cut off multi-word names without a set code** (`4 Lightning Bolt` → "Lightning", `1 Sol Ring` → "Sol"). A collector number is now only read after a set code.
- **SORTING builder had the same parser bug**, so overlaps were calculated on cut-off names. Saved SORTING decks are re-read on load; marks made on affected cards were stored under the cut-off names and appear unmarked.
- **Prices:** "Card Kingdom" was TCGplayer × 1.12 and "Cardhoarder" was the MTGO ticket price shown as USD. Both removed; prices shown are TCGplayer (USD/CAD), Cardmarket (EUR) and MTGO (tix). Etched foils now get a price.
- Colorless filter on the collection page returned nothing.
- Maybeboard cards were imported into the main deck (text import) or sideboard (Archidekt). They are now skipped.
- Deck size counted the sideboard toward 100/60/40.
- A `Commander` header without a following `Deck` header put the whole list in the commander section; a blank line now ends it.
- Archidekt export tags (`[Commander{top}]`, `[Ramp]`, `^Have,#37d67a^`) and `*E*` (etched) are parsed instead of breaking the line.
- Deck builder search filtered colour identity after taking the first 200 cards, so Commander decks could show only a few legal cards.
- Moving a card from the sideboard to the mainboard skipped the commander colour-identity check.
- SORTING deck colours followed alphabetical order instead of the deck's slot number.
- Reducing a deck card to 0 asked for confirmation twice.
- Fast typing in the collection search could show results for an older search.
- Non-numeric quantities, pages or IDs caused server errors instead of 400 responses.
- Collection imports from deck text could merge copies across different conditions.
- SORTING CSV export didn't escape quotes in card or deck names.
- **SORTING decks could share a stripe colour.** After a deck was removed, the next deck got the colour of the deck count, which another deck could already have. New decks now take the first free slot, slot numbers follow the colour (not list position), and decks are listed in slot order. Adding a deck by hand with a colour already in use asks first.
- Collector numbers in import lines (`(CMM) 50`) were ignored, so the default printing of that set was imported instead of the exact one (e.g. a borderless or showcase variant). The exact printing is now used, falling back to name + set if Scryfall doesn't know that number.
- An Archidekt URL that couldn't be fetched (private deck, typo, site down) reported "No cards found in decklist." The Import page and SORTING page now say the deck couldn't be loaded; any deck import that creates nothing returns an error instead of "imported with 0 cards".
- Archidekt cards whose primary category is excluded from the deck (`{noDeck}` in text exports, "not included in deck" on the site) were imported into the mainboard. They are now skipped like the Maybeboard. A card with no categories no longer breaks a URL import.
- Moving a card to a section that already had it (e.g. sideboard → mainboard) created a second row; the rows are now merged.
- Imports sent with `"text": null` returned a server error instead of a 400.

### Changed
- **Docker image runs Gunicorn** (1 worker, 4 threads, 300 s timeout) instead of Flask's development server. `gunicorn==23.0.0` added to `requirements.txt`. `python run.py` still works for local use.
- Adding a card to a deck takes the printing, colour identity and card data from the collection row instead of values sent by the browser.
- `POST /api/collection/bulk-delete` accepts only `{items: [{printing_id, quantity?}]}` or `{ids: [...]}`; the unused aliases and the `/api/collection/bulk-remove` route were removed.
- `/api/sorting/sync-data` no longer sends deck colours; the SORTING page assigns colour N to slot N.
- "Remove from Collection" for a multi-printing card uses one bulk request instead of one per printing.
- The navbar price refresh reports "Updated prices for X of Y printings."
- `Card.price_cardkingdom` is no longer written (column kept so existing databases still load); `Card.price_market3` holds the MTGO price in tix.

### Performance
- Collection list builds full card data only for the visible page and loads deck memberships in one query.
- Price refresh and imports send each distinct printing to Scryfall once instead of once per row.
- SORTING Pool view, bulk remove and SORTING sync use batched queries instead of one per card.
- Tables are no longer re-checked on every request; if `collection.db` is deleted while running, tables are recreated on the next failing request.

### Housekeeping
- Removed tracked `app/__pycache__/*.pyc` files (already in `.gitignore`) and the leftover `app/scratch/test_parser.py`.
- Rewrote README and PROJECT_OVERVIEW; module docstrings and comments describe current behaviour.
- Fixed TrueNAS Custom App guide typo.

### Upgrade notes
- No manual database migration needed.
- Re-import any decks or collection lists you pasted as plain text without set codes, or check them for cut-off names.
- In the SORTING builder, re-check marks on multi-word cards.
- SORTING decks are now listed in slot (colour) order. If two of your saved decks already share a colour from the old bug, remove one and add it again to give it a free slot.
- Pull the new Docker image and redeploy for Gunicorn.
