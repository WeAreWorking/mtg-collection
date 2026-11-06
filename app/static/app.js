/**
 * MTG Collection Manager — Frontend JS
 * Plain vanilla JS, no frameworks.
 */

// ── Mana Symbol Formatter (Magic Card Style) ──────────────────────────────────
function formatManaCost(manaCost) {
  if (!manaCost) return '<span style="color:var(--text-dim);">—</span>';
  return manaCost.replace(/\{([A-Za-z0-9\/]+)\}/g, (match, sym) => {
    const clean = sym.replace('/', '').toUpperCase();
    return `<img src="/static/mana/${clean}.svg" class="mana-symbol" alt="${match}" title="${match}" onerror="this.onerror=null; this.src='https://svgs.scryfall.io/card-symbols/${clean}.svg';" />`;
  });
}

// ── Shared state ──────────────────────────────────────────────────────────────
let currentPage = 1;
let currentFilters = {};
let searchDebounceTimer = null;
let showImages = localStorage.getItem('mtg_show_images') !== 'false'; // default true

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Navbar stats ──────────────────────────────────────────────────────────────
async function loadNavStats() {
  try {
    const stats = await apiFetch('/api/stats');
    const uCount = stats.unique_cards.toLocaleString();
    const tCount = stats.total_cards.toLocaleString();
    const cardsEl = document.getElementById('stat-cards');
    if (cardsEl) cardsEl.textContent = `${tCount} cards (${uCount} unique)`;

    const decksEl = document.getElementById('stat-decks');
    if (decksEl) decksEl.textContent = `${stats.total_decks} deck${stats.total_decks !== 1 ? 's' : ''}`;

    const valEl = document.getElementById('stat-value');
    if (valEl) {
      if (stats.total_value_usd > 0) {
        valEl.textContent = `${stats.total_value_usd_fmt} USD (${stats.total_value_cad_fmt} CAD)`;
      } else {
        valEl.textContent = 'Valuation available';
      }
    }
  } catch (e) { /* silent */ }
}

// Wire up global refresh prices button
document.addEventListener('DOMContentLoaded', () => {
  const btnRefresh = document.getElementById('btn-refresh-prices');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.textContent = '⏳';
      btnRefresh.disabled = true;
      try {
        const res = await apiFetch('/api/collection/refresh-prices', { method: 'POST' });
        alert(res.message || 'Market prices updated!');
        await loadNavStats();
        if (typeof loadCollection === 'function') loadCollection();
      } catch (err) {
        alert('Failed to refresh prices: ' + err.message);
      } finally {
        btnRefresh.textContent = '↻';
        btnRefresh.disabled = false;
      }
    });
  }
});

// ── Card detail modal ─────────────────────────────────────────────────────────
const modal        = document.getElementById('card-modal');
const modalInner   = document.getElementById('modal-inner');
const modalCloseBtn = document.getElementById('modal-close-btn');

function openModal() {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  modalInner.innerHTML = '<div class="modal-loading">Loading…</div>';
}

modalCloseBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/**
 * Open the card detail modal for a collection card entry.
 * @param {object} card  — collection card dict (from /api/collection)
 */
async function openCardModal(card) {
  openModal();
  modalInner.innerHTML = '<div class="modal-loading">Loading card details…</div>';

  // If we have a scryfall_id, fetch the full Scryfall card for live data
  let scryfallCard = null;
  if (card.scryfall_id) {
    try {
      scryfallCard = await apiFetch(`/api/scryfall/card/${card.scryfall_id}`);
    } catch (e) { /* use cached data */ }
  }

  renderCardModal(card, scryfallCard);
}

function renderCardModal(card, scryfallCard) {
  const sc = scryfallCard || {};
  const name        = card.name;
  const typeLine    = card.type_line || sc.type_line || '';
  const manaCost    = card.mana_cost || sc.mana_cost || '';
  const oracleText  = card.oracle_text || sc.oracle_text || '';
  const rarity      = card.rarity || sc.rarity || '';
  const setName     = card.set_name || sc.set_name || '';
  const setCode     = card.set_code || (sc.set || '').toUpperCase();
  const scryfallUri = sc.scryfall_uri || (card.scryfall_id
    ? `https://scryfall.com/card/${card.scryfall_id}` : '');

  // Prices from Scryfall & Market calculations
  const mp = card.market_prices || {};
  const tcg = mp.tcgplayer || {};
  const ck = mp.cardkingdom || {};
  const ch = mp.cardhoarder || {};
  const rateStr = mp.rate_usd_cad ? `1 USD = C$${mp.rate_usd_cad.toFixed(2)} CAD` : 'CAD conversion active';

  // Printings grouped by name (same card, different sets/foil/boxes)
  const printings = Array.isArray(card.printings) ? card.printings : [];
  const printingsCount = card.printings_count || printings.length || 1;
  const totalQty = card.quantity || 1;

  // Build image section
  let imageSectionHtml = '';
  if (card.image_uri_back) {
    imageSectionHtml = `
      <div class="modal-image modal-image-dfc">
        <img src="${card.image_uri}" alt="${name} front" loading="lazy" />
        <img src="${card.image_uri_back}" alt="${name} back" loading="lazy" />
      </div>`;
  } else if (card.image_uri) {
    imageSectionHtml = `
      <div class="modal-image">
        <img src="${card.image_uri}" alt="${name}" loading="lazy" />
      </div>`;
  } else {
    imageSectionHtml = `<div class="modal-image" style="background:var(--bg-elevated);border-radius:var(--radius-sm);aspect-ratio:63/88;display:flex;align-items:center;justify-content:center;color:var(--text-dim);">No image</div>`;
  }

  const printingsHtml = (card.id && printings.length > 0) ? `
    <div style="margin-top:1rem;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;flex-wrap:wrap;gap:0.4rem;">
        <div style="font-weight:700;color:#fff;">📚 Printings — ×${totalQty} total${printingsCount > 1 ? ` (${printingsCount} printings)` : ''}</div>
        <span class="badge badge-set">${escHtml((card.sets || []).join(' + ') || setCode || '—')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${printings.map((p, idx) => `
          <div class="printing-row" data-printing-id="${p.id}" style="display:grid;grid-template-columns:70px 1fr 90px 110px auto;gap:0.5rem;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:0.5rem 0.6rem;">
            <span class="badge badge-set" title="Set • Collector #">${escHtml(p.set_code || '—')}${p.collector_number ? ' #' + escHtml(p.collector_number) : ''}</span>
            <span style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(p.storage_location || '')}">${p.foil ? '✦ Foil • ' : ''}${escHtml(p.storage_location || 'Binder')}</span>
            <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.78rem;color:var(--text-dim);">Qty
              <input type="number" class="filter-input printing-qty" data-id="${p.id}" value="${p.quantity}" min="0" style="width:60px;padding:0.25rem 0.4rem;" />
            </label>
            <select class="filter-select printing-foil" data-id="${p.id}" style="padding:0.25rem 0.4rem;font-size:0.8rem;">
              <option value="false" ${!p.foil ? 'selected' : ''}>Non-foil</option>
              <option value="true" ${p.foil ? 'selected' : ''}>Foil ✦</option>
            </select>
            <button class="btn btn-ghost btn-sm printing-delete" data-id="${p.id}" title="Remove this printing">✕</button>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:0.6rem;">
        <label class="form-label">Storage Location for all printings →</label>
        <div style="display:flex;gap:0.5rem;margin-top:0.3rem;">
          <input type="text" class="filter-input" id="edit-storage-all" placeholder="e.g. SORTING Tray — leave blank to keep per-printing boxes" style="flex:1;" />
          <button type="button" class="btn btn-ghost btn-sm" id="btn-apply-storage-all">Apply to all</button>
        </div>
        <p style="font-size:0.75rem;color:var(--text-dim);margin-top:0.4rem;">Per-printing qty/foil is saved with “Save Changes”. Deleting a printing removes only that set/foil copy; when the last copy is gone the card is also removed from decks.</p>
      </div>
    </div>
  ` : '';

  modalInner.innerHTML = `
    <div class="modal-layout">
      ${imageSectionHtml}
      <div class="modal-info">
        <div>
          <div class="modal-name">${escHtml(name)}</div>
          <div class="modal-type">${escHtml(typeLine)}</div>
          ${manaCost ? `<div class="modal-mana">${formatManaCost(manaCost)}</div>` : ''}
          ${printingsCount > 1 ? `<div style="margin-top:0.4rem;"><span class="badge badge-qty">×${totalQty} • ${printingsCount} printings</span></div>` : ``}
        </div>
        ${oracleText ? `<div class="modal-text">${escHtml(oracleText)}</div>` : ''}
        
        <div class="modal-meta-grid">
          <div class="modal-meta-item">
            <div class="modal-meta-label">Set(s)</div>
            <div class="modal-meta-value">${escHtml((card.sets || []).join(', ') || (setName ? `${setName} (${setCode})` : setCode))}</div>
          </div>
          <div class="modal-meta-item">
            <div class="modal-meta-label">Rarity</div>
            <div class="modal-meta-value rarity-${rarity}">${capitalize(rarity)}</div>
          </div>
          <div class="modal-meta-item">
            <div class="modal-meta-label">Finish</div>
            <div class="modal-meta-value">${card.foil ? '✦ Foil' : 'Non-Foil'}</div>
          </div>
          <div class="modal-meta-item">
            <div class="modal-meta-label">Mana Value</div>
            <div class="modal-meta-value">${card.cmc ?? sc.cmc ?? '—'}</div>
          </div>
        </div>

        <!-- Market Value Breakdown: Top 3 US Single Card Markets (USD & CAD) -->
        <div class="modal-pricing-box" style="margin-top: 1rem; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">
              💰 Single Card Market Values
            </div>
            <span class="badge" style="background: rgba(0, 240, 255, 0.1); color: var(--cyan); font-size: 0.75rem;">
              🇨🇦 ${rateStr}
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem;">
            <!-- Market 1: TCGplayer -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.6rem 0.8rem;">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">1. TCGplayer (Market)</div>
              <div style="font-size: 1.15rem; font-weight: 700; color: #fff; font-family: var(--font-mono); margin: 2px 0;">
                ${tcg.usd_fmt || '—'}
              </div>
              <div style="font-size: 0.85rem; color: var(--gold); font-weight: 600; font-family: var(--font-mono);">
                ${tcg.cad_fmt || '—'} CAD
              </div>
            </div>

            <!-- Market 2: Card Kingdom -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.6rem 0.8rem;">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">2. Card Kingdom (Retail)</div>
              <div style="font-size: 1.15rem; font-weight: 700; color: #fff; font-family: var(--font-mono); margin: 2px 0;">
                ${ck.usd_fmt || '—'}
              </div>
              <div style="font-size: 0.85rem; color: var(--gold); font-weight: 600; font-family: var(--font-mono);">
                ${ck.cad_fmt || '—'} CAD
              </div>
            </div>

            <!-- Market 3: Cardhoarder / Index -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.6rem 0.8rem;">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">3. Cardhoarder / Index</div>
              <div style="font-size: 1.15rem; font-weight: 700; color: #fff; font-family: var(--font-mono); margin: 2px 0;">
                ${ch.usd_fmt || '—'}
              </div>
              <div style="font-size: 0.85rem; color: var(--gold); font-weight: 600; font-family: var(--font-mono);">
                ${ch.cad_fmt || '—'} CAD
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    ${printingsHtml}

    <!-- Edit section (only shown for collection cards with an id) -->
    ${card.id && printings.length === 0 ? `
    <div class="modal-edit-form" id="modal-edit-form" style="margin-top: 1rem;">
      <div class="form-group">
        <label class="form-label">Quantity</label>
        <input type="number" class="filter-input" id="edit-qty"
               value="${card.quantity}" min="1" />
      </div>
      <div class="form-group">
        <label class="form-label">Foil</label>
        <select class="filter-select" id="edit-foil">
          <option value="false" ${!card.foil ? 'selected' : ''}>Non-foil</option>
          <option value="true"  ${card.foil  ? 'selected' : ''}>Foil</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Storage Location / Box</label>
        <input type="text" class="filter-input" id="edit-storage"
               value="${escHtml(card.storage_location || '')}" placeholder="e.g. SORTING Tray, Binder A, Commander Box" />
      </div>
    </div>
    ` : ''}

    <div class="modal-actions" style="margin-top: 1rem;">
      ${card.id ? `
        <button class="btn btn-primary" id="btn-save-card">Save Changes</button>
        <button class="btn btn-danger btn-sm" id="btn-delete-card">Remove from Collection</button>
      ` : ''}
      ${scryfallUri ? `
        <a href="${scryfallUri}" target="_blank" rel="noopener" class="btn btn-ghost">
          View on Scryfall ↗
        </a>
      ` : ''}
    </div>
  `;

  // Wire up buttons
  if (card.id) {
    const saveBtn = document.getElementById('btn-save-card');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      try {
        if (printings.length > 0) {
          // Save each printing individually
          const rows = modalInner.querySelectorAll('.printing-row');
          for (const row of rows) {
            const pid = row.dataset.printingId;
            const qtyEl = row.querySelector('.printing-qty');
            const foilEl = row.querySelector('.printing-foil');
            const qty = parseInt(qtyEl.value, 10);
            const foil = foilEl.value === 'true';
            if (isNaN(qty) || qty < 0) continue;
            if (qty === 0) {
              await apiFetch(`/api/collection/${pid}`, { method: 'DELETE' });
            } else {
              await apiFetch(`/api/collection/${pid}`, {
                method: 'PUT',
                body: JSON.stringify({ quantity: qty, foil }),
              });
            }
          }
          const applyAll = document.getElementById('edit-storage-all');
          if (applyAll && applyAll.value.trim()) {
            const loc = applyAll.value.trim();
            for (const row of rows) {
              const pid = row.dataset.printingId;
              // Only update if printing still exists (qty > 0)
              await apiFetch(`/api/collection/${pid}`, {
                method: 'PUT',
                body: JSON.stringify({ storage_location: loc }),
              }).catch(() => {});
            }
          }
        } else {
          const payload = {
            quantity: parseInt(document.getElementById('edit-qty').value, 10),
            foil: document.getElementById('edit-foil').value === 'true',
            storage_location: document.getElementById('edit-storage').value,
          };
          await apiFetch(`/api/collection/${card.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
        }
        closeModal();
        if (typeof loadCollection === 'function') loadCollection();
        loadNavStats();
      } catch (e) { alert('Error saving: ' + e.message); }
    });

    const delBtn = document.getElementById('btn-delete-card');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const msg = printings.length > 1
        ? `Remove all ${printingsCount} printings of "${name}" from your collection? The card will also be removed from decks.`
        : `Remove "${name}" from your collection? If this is the last copy, it will also be removed from decks.`;
      if (!confirm(msg)) return;
      try {
        if (printings.length > 0) {
          let removedFromDecks = 0;
          for (const p of [...printings].sort((a,b) => a.id - b.id)) {
            const res = await apiFetch(`/api/collection/${p.id}`, { method: 'DELETE' });
            if (res.removed_from_decks) removedFromDecks += res.removed_from_decks;
          }
          if (removedFromDecks > 0) alert(`Removed from ${removedFromDecks} deck slot(s) as well.`);
        } else {
          const res = await apiFetch(`/api/collection/${card.id}`, { method: 'DELETE' });
          if (res.removed_from_decks) alert(`Removed from ${res.removed_from_decks} deck slot(s) as well.`);
        }
        closeModal();
        if (typeof loadCollection === 'function') loadCollection();
        loadNavStats();
      } catch (e) { alert('Error deleting: ' + e.message); }
    });

    // Per-printing delete (removes just that set/foil row; last copy clears decks)
    modalInner.querySelectorAll('.printing-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.id;
        const printing = printings.find(p => String(p.id) === String(pid));
        const label = printing ? `${printing.set_code || ''} ${printing.foil ? 'foil' : ''}`.trim() : 'this printing';
        if (!confirm(`Remove ${label} copy from collection?`)) return;
        try {
          const res = await apiFetch(`/api/collection/${pid}`, { method: 'DELETE' });
          const row = btn.closest('.printing-row');
          if (res.removed_from_decks) {
            alert(`Last copy removed — also removed from ${res.removed_from_decks} deck slot(s).`);
            closeModal();
            if (typeof loadCollection === 'function') loadCollection();
            loadNavStats();
          } else {
            if (row) row.remove();
          }
        } catch (e) { alert('Error deleting printing: ' + e.message); }
      });
    });

    const applyBtn = document.getElementById('btn-apply-storage-all');
    if (applyBtn) applyBtn.addEventListener('click', async () => {
      const loc = document.getElementById('edit-storage-all').value.trim();
      if (!loc) { alert('Enter a storage location first.'); return; }
      try {
        for (const p of printings) {
          await apiFetch(`/api/collection/${p.id}`, {
            method: 'PUT',
            body: JSON.stringify({ storage_location: loc }),
          });
        }
        closeModal();
        if (typeof loadCollection === 'function') loadCollection();
        loadNavStats();
      } catch (e) { alert('Error updating storage: ' + e.message); }
    });
  }
}

// ── Collection page ───────────────────────────────────────────────────────────
let viewMode = localStorage.getItem('mtg_view_mode') || 'table'; // default to spreadsheet table

function updateViewModeUI() {
  const grid = document.getElementById('card-grid');
  const tableWrapper = document.getElementById('card-table-wrapper');
  const icon = document.getElementById('toggle-view-icon');
  const label = document.getElementById('toggle-view-label');

  if (viewMode === 'table') {
    if (grid) grid.classList.add('hidden');
    if (tableWrapper) tableWrapper.classList.remove('hidden');
    if (icon) icon.textContent = '🖼️';
    if (label) label.textContent = 'Visual Grid View';
  } else {
    if (tableWrapper) tableWrapper.classList.add('hidden');
    if (grid) grid.classList.remove('hidden');
    if (icon) icon.textContent = '📊';
    if (label) label.textContent = 'Spreadsheet View';
  }
}

async function populateDeckFilter() {
  const select = document.getElementById('filter-deck');
  if (!select) return;
  try {
    const [decks, locations] = await Promise.all([
      apiFetch('/api/decks').catch(() => []),
      apiFetch('/api/collection/storage-locations').catch(() => []),
    ]);

    let html = `
      <option value="">All Decks, Boxes &amp; Pool</option>
      <optgroup label="SORTING System">
        <option value="shared">⚡ SORTING Shared (2+ decks)</option>
        <option value="unassigned">📦 Binder / Unassigned</option>
      </optgroup>
    `;

    if (decks && decks.length > 0) {
      html += `<optgroup label="Decks">`;
      decks.forEach(d => {
        html += `<option value="deck:${d.id}">🗂️ ${escHtml(d.name)}</option>`;
      });
      html += `</optgroup>`;
    }

    if (locations && locations.length > 0) {
      html += `<optgroup label="Storage Boxes &amp; Binders">`;
      locations.forEach(loc => {
        html += `<option value="storage:${escHtml(loc)}">📦 ${escHtml(loc)}</option>`;
      });
      html += `</optgroup>`;
    }

    select.innerHTML = html;
  } catch (e) { /* silent */ }
}

function initCollectionPage() {
  loadNavStats();
  populateDeckFilter();
  updateViewModeUI();

  // Set default per_page to 250 in table mode
  const perPageEl = document.getElementById('filter-per-page');
  if (perPageEl && viewMode === 'table') {
    perPageEl.value = '250';
  }

  loadCollection();

  // View toggle button
  const toggleBtn = document.getElementById('btn-toggle-view');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      viewMode = viewMode === 'table' ? 'grid' : 'table';
      localStorage.setItem('mtg_view_mode', viewMode);
      if (viewMode === 'table' && perPageEl && perPageEl.value === '60') {
        perPageEl.value = '250';
      }
      updateViewModeUI();
      currentPage = 1;
      loadCollection();
    });
  }

  // Debounced search
  document.getElementById('search-q').addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { currentPage = 1; loadCollection(); }, 350);
  });

  // Instant filter changes
  ['filter-deck','filter-color','filter-rarity','filter-foil','filter-sort','filter-per-page'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        currentPage = 1; loadCollection();
      });
    }
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('search-q').value = '';
    const deckFilter = document.getElementById('filter-deck');
    if (deckFilter) deckFilter.value = '';
    document.getElementById('filter-color').value = '';
    document.getElementById('filter-rarity').value = '';
    document.getElementById('filter-foil').value = '';
    document.getElementById('filter-sort').value = 'name';
    currentPage = 1;
    loadCollection();
  });
}

async function loadCollection() {
  const grid = document.getElementById('card-grid');
  const tableBody = document.getElementById('card-table-body');
  if (grid) grid.innerHTML = '<div class="loading-state">Scanning collection databanks…</div>';
  if (tableBody) tableBody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:2.5rem;color:var(--cyan);font-family:var(--font-mono);">Scanning collection databanks…</td></tr>';

  const perPageVal = parseInt(document.getElementById('filter-per-page')?.value || (viewMode === 'table' ? '250' : '60'), 10);
  const deckVal = document.getElementById('filter-deck')?.value || '';
  const rawSort = document.getElementById('filter-sort').value;
  
  let sortBy = 'name';
  let sortOrder = 'asc';
  if (rawSort === 'price_desc') {
    sortBy = 'price';
    sortOrder = 'desc';
  } else if (rawSort === 'price_asc') {
    sortBy = 'price';
    sortOrder = 'asc';
  } else {
    sortBy = rawSort;
    sortOrder = 'asc';
  }

  const params = new URLSearchParams({
    q:        document.getElementById('search-q').value.trim(),
    in_deck:  deckVal,
    color:    document.getElementById('filter-color').value,
    rarity:   document.getElementById('filter-rarity').value,
    foil:     document.getElementById('filter-foil').value,
    sort:     sortBy,
    order:    sortOrder,
    page:     currentPage,
    per_page: perPageVal,
  });

  try {
    const data = await apiFetch(`/api/collection?${params}`);
    renderGrid(data);
  } catch (e) {
    const errHtml = `<div class="empty-state"><span class="empty-icon">⚠️</span>Error: ${e.message}</div>`;
    if (grid) grid.innerHTML = errHtml;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--pink);">Error: ${e.message}</td></tr>`;
  }
}

function renderGrid(data) {
  const grid = document.getElementById('card-grid');
  const tableBody = document.getElementById('card-table-body');
  const count = document.getElementById('result-count');
  const uniqueCount = (data.total_unique ?? data.total ?? 0).toLocaleString();
  const totalCount = (data.total_quantity ?? data.total ?? 0).toLocaleString();
  count.textContent = `${totalCount} cards (${uniqueCount} unique)`;

  updateViewModeUI();

  if (data.cards.length === 0) {
    const emptyHtml = `<div class="empty-state">
      <span class="empty-icon">🛸</span>
      No cards found in databanks. Try adjusting your filters or <a href="/import">import some cards</a>.
    </div>`;
    if (grid) grid.innerHTML = emptyHtml;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:3rem;color:var(--text-muted);font-family:var(--font-mono);">No cards found in databanks.</td></tr>`;
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  // ── Render Spreadsheet Table Mode ──────────────────────────────────────────
  if (tableBody) {
    tableBody.innerHTML = data.cards.map(card => {
      const decks = card.decks || [];
      let deckBadges = '';
      if (decks.length >= 2) {
        deckBadges += `<span class="badge badge-sorting" title="SORTING Shared staple in ${decks.length} decks">⚡ SORTING (${decks.length})</span> `;
      }
      if (decks.length > 0) {
        deckBadges += decks.map(d => `<span class="badge badge-storage" title="Assigned to ${escHtml(d.name)}">🗂️ ${escHtml(d.name)}</span>`).join(' ');
      } else if (card.storage_location) {
        deckBadges += `<span class="badge badge-storage">📦 ${escHtml(card.storage_location)}</span>`;
      } else {
        deckBadges += `<span class="badge badge-storage" style="opacity:0.4;">📦 Binder</span>`;
      }

      const setsTxt = (card.sets && card.sets.length) ? card.sets.join(' + ') : (card.set_code || '—');
      const printingsCount = card.printings_count || 1;
      const printingsBadge = printingsCount > 1
        ? `<span class="badge badge-printings" title="${printingsCount} printings: ${escHtml(setsTxt)}">${printingsCount} printings</span>`
        : '';

      return `
        <tr data-id="${card.id}" title="Click to view full card rulings and market pricing breakdown">
          <td class="text-center"><span class="badge badge-qty">×${card.quantity}</span></td>
          <td>
            <div class="table-card-name" title="${escHtml(card.name)}">
              <span class="table-card-name-text">${escHtml(card.name)}</span>
              ${card.foil ? '<span class="badge badge-foil" title="Foil">✦</span>' : ''}
              ${printingsBadge}
            </div>
          </td>
          <td><span class="table-mana">${formatManaCost(card.mana_cost)}</span></td>
          <td class="col-type-td"><span class="table-type" title="${escHtml(card.type_line || '')}">${escHtml(card.type_line || '—')}</span></td>
          <td class="text-center"><span class="badge badge-set">${escHtml(setsTxt)}</span></td>
          <td class="text-center"><span class="badge badge-rarity rarity-${card.rarity}">${capitalize(card.rarity || '—')}</span></td>
          <td class="text-center col-foil">${card.foil ? '<span class="badge badge-foil">Foil</span>' : '<span style="color:var(--text-dim);">—</span>'}</td>
          <td class="col-storage"><span class="badge badge-storage">${escHtml(card.storage_location || 'Binder')}</span></td>
          <td><div class="table-decks-cell">${deckBadges}</div></td>
          <td class="table-price" style="text-align:right; font-family:var(--font-mono);">${card.price_usd_fmt || '—'}</td>
          <td class="table-price" style="text-align:right; font-family:var(--font-mono); color:var(--gold); font-weight:600;">${card.price_cad_fmt || '—'}</td>
        </tr>
      `;
    }).join('');

    tableBody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const card = data.cards.find(c => c.id == id);
        if (card) openCardModal(card);
      });
    });
  }

  // ── Render Visual Card Grid Mode ───────────────────────────────────────────
  if (grid) {
    grid.innerHTML = data.cards.map(card => {
      const decks = card.decks || [];
      const isSorting = decks.length >= 2;
      const printingsCount = card.printings_count || 1;
      return `
        <div class="card-tile" data-id="${card.id}" title="${escHtml(card.name)}">
          <img src="${card.image_uri || ''}"
               alt="${escHtml(card.name)}"
               loading="lazy"
               onerror="this.style.display='none'" />
          <div class="card-tile-info">
            <div>
              <div class="card-tile-header">
                <div class="card-tile-name">${escHtml(card.name)}</div>
                ${card.mana_cost ? `<span class="card-tile-mana">${formatManaCost(card.mana_cost)}</span>` : ''}
              </div>
              ${card.type_line ? `<div class="card-tile-type">${escHtml(card.type_line)}</div>` : ''}
            </div>
            <div class="card-tile-meta">
              <span class="badge badge-qty">×${card.quantity}</span>
              ${printingsCount > 1 ? `<span class="badge badge-printings" title="${printingsCount} printings: ${escHtml((card.sets || []).join(' + '))}">${printingsCount} printings</span>` : ``}
              ${card.foil ? '<span class="badge badge-foil">✦ Foil</span>' : ''}
              ${card.set_code ? `<span class="badge badge-set">${escHtml(card.set_code)}</span>` : ''}
              ${card.rarity ? `<span class="badge badge-rarity rarity-${card.rarity}">${card.rarity[0].toUpperCase()}</span>` : ''}
              ${isSorting ? `<span class="badge badge-sorting" title="SORTING Shared staple in ${decks.length} decks">⚡ SORTING (${decks.length})</span>` : ''}
            </div>
            <div class="card-tile-price" style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.08); font-family:var(--font-mono); font-size:0.8rem;">
              <span style="color:#fff;">${card.price_usd_fmt || '—'}</span>
              <span style="color:var(--gold); font-weight:600;">${card.price_cad_fmt || '—'} CAD</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.card-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.id;
        const card = data.cards.find(c => c.id == id);
        if (card) openCardModal(card);
      });
    });
  }

  renderPagination(data);
}

function renderPagination(data) {
  const pg = document.getElementById('pagination');
  if (data.pages <= 1) { pg.classList.add('hidden'); return; }
  pg.classList.remove('hidden');

  const p = data.page;
  const total = data.pages;
  let html = '';

  html += `<button class="page-btn" ${p <= 1 ? 'disabled' : ''} onclick="goToPage(${p-1})">←</button>`;

  // Show page numbers around current page
  for (let i = Math.max(1, p - 2); i <= Math.min(total, p + 2); i++) {
    html += `<button class="page-btn ${i === p ? 'current' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  html += `<button class="page-btn" ${p >= total ? 'disabled' : ''} onclick="goToPage(${p+1})">→</button>`;
  pg.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadCollection();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Import page ───────────────────────────────────────────────────────────────
function initImportPage() {
  loadNavStats();

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById('tab-collection').classList.toggle('hidden', tabId !== 'collection');
      document.getElementById('tab-deck').classList.toggle('hidden', tabId !== 'deck');
    });
  });

  // Collection import
  document.getElementById('btn-import-collection').addEventListener('click', async () => {
    const btn  = document.getElementById('btn-import-collection');
    const text = document.getElementById('col-text').value.trim();
    const result = document.getElementById('col-result');
    if (!text) { showResult(result, 'error', 'Please paste a card list.'); return; }

    btn.disabled = true;
    btn.textContent = 'Importing… (this may take a minute)';
    result.classList.add('hidden');

    try {
      const condEl = document.getElementById('col-condition');
      const priceEl = document.getElementById('col-price');
      const data = await apiFetch('/api/import/collection', {
        method: 'POST',
        body: JSON.stringify({
          text,
          condition: condEl ? condEl.value : 'NM',
          storage:   document.getElementById('col-storage').value,
          purchase_price: priceEl ? (parseFloat(priceEl.value) || null) : null,
        }),
      });
      const errList = data.errors.length
        ? `<ul>${data.errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>` : '';
      showResult(result, data.skipped > 0 ? 'error' : 'success',
        `✅ Imported <strong>${data.imported}</strong> cards.` +
        (data.skipped > 0 ? ` ⚠️ ${data.skipped} card(s) could not be found:${errList}` : '')
      );
      loadNavStats();
    } catch (e) {
      showResult(result, 'error', `Error: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import to Collection';
    }
  });

  // Deck import
  document.getElementById('btn-import-deck').addEventListener('click', async () => {
    const btn  = document.getElementById('btn-import-deck');
    const text = document.getElementById('deck-text').value.trim();
    const name = document.getElementById('deck-name').value.trim();
    const result = document.getElementById('deck-result');
    if (!text) { showResult(result, 'error', 'Please paste a decklist or Archidekt link.'); return; }
    if (!name && !text.includes('archidekt.com')) { showResult(result, 'error', 'Please enter a deck name (or paste an Archidekt link).'); return; }

    btn.disabled = true;
    btn.textContent = 'Importing… (resolving cards via Scryfall)';
    result.classList.add('hidden');

    try {
      const syncCol = document.getElementById('deck-sync-collection')?.checked ?? true;
      const deckStorage = document.getElementById('deck-storage')?.value?.trim() || '';

      const data = await apiFetch('/api/import/deck', {
        method: 'POST',
        body: JSON.stringify({
          text,
          name,
          format:             document.getElementById('deck-format').value,
          description:        document.getElementById('deck-desc').value,
          add_to_collection:  syncCol,
          storage:            deckStorage,
        }),
      });
      const deckDisplayName = data.deck_name || name || 'Deck';
      const errList = data.errors.length
        ? `<ul>${data.errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>` : '';
      showResult(result, data.skipped > 0 ? 'error' : 'success',
        `✅ Deck "<strong>${escHtml(deckDisplayName)}</strong>" imported with <strong>${data.imported}</strong> cards.` +
        (syncCol ? ` Cards have been added to your collection.` : '') +
        ` <a href="/decks">View decks →</a> or <a href="/collection">View collection →</a>` +
        (data.skipped > 0 ? `<br>⚠️ ${data.skipped} card(s) not found:${errList}` : '')
      );
      loadNavStats();
    } catch (e) {
      showResult(result, 'error', `Error: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import Deck';
    }
  });
}

function showResult(el, type, html) {
  el.className = `import-result ${type}`;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

// ── Decks page ────────────────────────────────────────────────────────────────
let currentDeckId = null;
let currentDeck = null;
let deckSearchDebounce = null;

function expectedDeckSize(format, totalQty) {
  const fmt = (format || '').trim().toLowerCase();
  if (!fmt || /^\d+$/.test(fmt)) return { expected: null, ok: true, warning: null };
  let expected = 60;
  if (fmt.includes('commander') || fmt.includes('edh')) expected = 100;
  else if (fmt.includes('draft') || fmt.includes('sealed')) expected = 40;
  const ok = totalQty === expected;
  return {
    expected,
    ok,
    warning: ok ? null : `Deck has ${totalQty} cards (expected ${expected} for ${format || 'format'})`,
  };
}

function initDecksPage() {
  loadNavStats();
  loadDeckList();

  const backBtn = document.getElementById('deck-panel-back');
  if (backBtn) backBtn.addEventListener('click', closeDeckPanel);

  const editBtn = document.getElementById('btn-edit-deck');
  if (editBtn) editBtn.addEventListener('click', openDeckEditModal);

  const editClose = document.getElementById('deck-edit-modal-close');
  if (editClose) editClose.addEventListener('click', closeDeckEditModal);
  const editCancel = document.getElementById('btn-cancel-deck-edit');
  if (editCancel) editCancel.addEventListener('click', closeDeckEditModal);
  const editModal = document.getElementById('deck-edit-modal');
  if (editModal) editModal.addEventListener('click', (e) => { if (e.target === editModal) closeDeckEditModal(); });

  const editForm = document.getElementById('deck-edit-form');
  if (editForm) editForm.addEventListener('submit', saveDeckEdit);

  const toggleAdd = document.getElementById('btn-toggle-add-card');
  if (toggleAdd) toggleAdd.addEventListener('click', toggleAddCardPanel);
  const closeAdd = document.getElementById('btn-close-add-card');
  if (closeAdd) closeAdd.addEventListener('click', toggleAddCardPanel);

  const searchInput = document.getElementById('deck-card-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(deckSearchDebounce);
      deckSearchDebounce = setTimeout(searchCollectionForDeck, 300);
    });
  }
}

function toggleAddCardPanel() {
  const panel = document.getElementById('deck-add-card-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    const input = document.getElementById('deck-card-search-input');
    if (input) input.focus();
  } else {
    const results = document.getElementById('deck-card-search-results');
    if (results) { results.innerHTML = ''; results.classList.add('hidden'); }
  }
}

async function searchCollectionForDeck() {
  const input = document.getElementById('deck-card-search-input');
  const resultsEl = document.getElementById('deck-card-search-results');
  const q = (input?.value || '').trim();
  if (!q || q.length < 2 || !currentDeckId) {
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.classList.add('hidden'); }
    return;
  }
  try {
    const results = await apiFetch(`/api/collection/search?q=${encodeURIComponent(q)}`);
    if (!results.length) {
      resultsEl.innerHTML = `<div style="padding:0.75rem;color:var(--text-muted);font-size:0.85rem;">No collection cards match "${escHtml(q)}".</div>`;
      resultsEl.classList.remove('hidden');
      return;
    }
    resultsEl.innerHTML = results.map(r => `
      <div class="search-result-item">
        <div style="display:flex;align-items:center;gap:0.6rem;min-width:0;flex:1;">
          ${r.image_uri ? `<img src="${r.image_uri}" style="width:30px;height:42px;object-fit:cover;border-radius:3px;flex-shrink:0;" loading="lazy" />` : ''}
          <div style="min-width:0;">
            <div style="font-weight:700;color:#fff;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);">${escHtml(r.type_line || '')} • ${escHtml(r.set_code || '')} • Owned ×${r.total_owned}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" data-add-card="${escHtml(r.name)}">➕ Add</button>
      </div>
    `).join('');
    resultsEl.classList.remove('hidden');
    resultsEl.querySelectorAll('[data-add-card]').forEach(btn => {
      btn.addEventListener('click', () => addCardToDeck(btn.dataset.addCard));
    });
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div style="padding:0.75rem;color:var(--pink);">Search failed: ${escHtml(e.message)}</div>`;
  }
}

async function addCardToDeck(cardName) {
  if (!currentDeckId) return;
  const slotEl = document.getElementById('deck-card-target-slot');
  const qtyEl = document.getElementById('deck-card-target-qty');
  const slot = slotEl ? slotEl.value : 'mainboard';
  const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10) || 1);
  try {
    await apiFetch(`/api/decks/${currentDeckId}/cards`, {
      method: 'POST',
      body: JSON.stringify({
        name: cardName,
        quantity: qty,
        is_commander: slot === 'commander',
        is_sideboard: slot === 'sideboard',
      }),
    });
    await openDeck(currentDeckId, { keepAddPanel: true });
    const input = document.getElementById('deck-card-search-input');
    if (input) input.focus();
  } catch (e) {
    alert('Could not add card: ' + e.message);
  }
}

function openDeckEditModal() {
  if (!currentDeck) return;
  const modal = document.getElementById('deck-edit-modal');
  document.getElementById('edit-deck-name-input').value = currentDeck.name || '';
  const fmtSel = document.getElementById('edit-deck-format-select');
  const curFormat = currentDeck.format || '';
  // Preserve unknown formats (e.g. legacy values) by adding an option on the fly
  if (curFormat && !Array.from(fmtSel.options).some(o => o.value === curFormat)) {
    const opt = document.createElement('option');
    opt.value = curFormat;
    opt.textContent = curFormat;
    fmtSel.appendChild(opt);
  }
  fmtSel.value = curFormat;
  document.getElementById('edit-deck-desc-input').value = currentDeck.description || '';
  modal.classList.remove('hidden');
}

function closeDeckEditModal() {
  document.getElementById('deck-edit-modal')?.classList.add('hidden');
}

async function saveDeckEdit(e) {
  e.preventDefault();
  if (!currentDeckId) return;
  const name = document.getElementById('edit-deck-name-input').value.trim();
  const format = document.getElementById('edit-deck-format-select').value;
  const description = document.getElementById('edit-deck-desc-input').value;
  if (!name) { alert('Deck name is required.'); return; }
  try {
    await apiFetch(`/api/decks/${currentDeckId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, format, description }),
    });
    closeDeckEditModal();
    await openDeck(currentDeckId, { keepAddPanel: document.getElementById('deck-add-card-panel')?.classList.contains('hidden') === false });
    loadDeckList();
    loadNavStats();
  } catch (err) {
    alert('Could not save deck: ' + err.message);
  }
}

async function loadDeckList() {
  const list = document.getElementById('deck-list');
  const count = document.getElementById('deck-count');

  try {
    const decks = await apiFetch('/api/decks');
    count.textContent = `${decks.length} deck${decks.length !== 1 ? 's' : ''}`;

    if (decks.length === 0) {
      list.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">🗂️</span>
        No decks yet. <a href="/import">Import a decklist</a> to get started.
      </div>`;
      return;
    }

    list.innerHTML = decks.map(deck => {
      const total = (deck.total_cards ?? deck.card_count ?? 0).toLocaleString();
      const unique = (deck.unique_cards ?? 0).toLocaleString();
      const check = expectedDeckSize(deck.format, deck.total_cards ?? deck.card_count ?? 0);
      const warn = check.warning;
      const sizeBadge = check.expected === null
        ? ''
        : warn
          ? `<span class="badge badge-size-warning" title="${escHtml(warn)}">⚠️ ${deck.total_cards ?? deck.card_count}/${check.expected}</span>`
          : `<span class="badge badge-qty" title="Deck size matches expected ${check.expected}">✓ ${deck.total_cards ?? deck.card_count}/${check.expected}</span>`;
      return `
        <div class="deck-card" data-id="${deck.id}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
            <div class="deck-card-name">${escHtml(deck.name)}</div>
            ${sizeBadge}
          </div>
          ${deck.format ? `<span class="format-badge" style="margin-left:0;">${escHtml(deck.format)}</span>` : ''}
          <div class="deck-card-count">${total} cards (${unique} unique)${warn ? `<div style="color:var(--warning);font-size:0.78rem;margin-top:0.3rem;" title="${escHtml(warn)}">⚠️ ${escHtml(warn)}</div>` : ''}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.deck-card').forEach(card => {
      card.addEventListener('click', () => openDeck(card.dataset.id));
    });

  } catch (e) {
    list.innerHTML = `<div class="empty-state">Error loading decks: ${e.message}</div>`;
  }
}

async function openDeck(deckId, opts = {}) {
  const keepAddPanel = opts.keepAddPanel || false;
  currentDeckId = deckId;
  document.getElementById('deck-list').classList.add('hidden');
  const panel = document.getElementById('deck-panel');
  panel.classList.remove('hidden');
  document.getElementById('deck-panel-cards').innerHTML = '<div class="loading-state">Loading…</div>';
  if (!keepAddPanel) {
    document.getElementById('deck-add-card-panel')?.classList.add('hidden');
    const s = document.getElementById('deck-card-search-input');
    if (s) s.value = '';
  }

  try {
    const deck = await apiFetch(`/api/decks/${deckId}`);
    currentDeck = deck;
    document.getElementById('deck-panel-name').textContent = deck.name;
    document.getElementById('deck-panel-format').textContent = deck.format || '';
    document.getElementById('deck-panel-desc').textContent = deck.description || '';

    const totalQty = deck.cards.reduce((sum, c) => sum + (c.quantity || 1), 0);
    const uniqueQty = deck.cards.length;
    const countsBadge = document.getElementById('deck-panel-counts');
    if (countsBadge) {
      countsBadge.textContent = `${totalQty} cards (${uniqueQty} unique)`;
    }
    // Deck-size warning (100 for Commander, 60 for most other formats)
    let warnEl = document.getElementById('deck-size-warning');
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.id = 'deck-size-warning';
      document.getElementById('deck-panel-desc').after(warnEl);
    }
    const check = expectedDeckSize(deck.format, totalQty);
    if (check.warning) {
      warnEl.innerHTML = `<div class="badge badge-size-warning" style="display:inline-block;margin-top:0.4rem;" title="${escHtml(check.warning)}">${escHtml(check.warning)}</div>`;
      warnEl.style.display = 'block';
    } else {
      warnEl.innerHTML = '';
      warnEl.style.display = 'none';
    }

    renderDeckCards(deck.cards);

    document.getElementById('deck-panel-delete').onclick = async () => {
      if (!confirm(`Delete deck "${deck.name}"? This cannot be undone.`)) return;
      await apiFetch(`/api/decks/${deckId}`, { method: 'DELETE' });
      closeDeckPanel();
      loadDeckList();
      loadNavStats();
    };
  } catch (e) {
    document.getElementById('deck-panel-cards').innerHTML =
      `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

function renderDeckCards(cards) {
  const container = document.getElementById('deck-panel-cards');

  const commanders = cards.filter(c => c.is_commander);
  const mainboard  = cards.filter(c => !c.is_commander && !c.is_sideboard);
  const sideboard  = cards.filter(c => c.is_sideboard);

  let html = '';

  const renderSection = (title, section) => {
    if (!section.length) return '';
    // Group by type
    const grouped = {};
    section.forEach(c => {
      const type = primaryType(c.type_line || '');
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(c);
    });

    const secTotal = section.reduce((a,c) => a + (c.quantity || 1), 0);
    const secUnique = section.length;
    let s = `<div><div class="deck-section-title">${title} (${secTotal} cards • ${secUnique} unique)</div>`;
    for (const [type, typeCards] of Object.entries(grouped).sort()) {
      const typeTotal = typeCards.reduce((a,c) => a + (c.quantity || 1), 0);
      s += `<div class="deck-section-title" style="margin-top:0.5rem;opacity:0.6">${type} (${typeTotal})</div>`;
      typeCards.forEach(c => {
        const isCommander = !!c.is_commander;
        const isSide = !!c.is_sideboard;
        s += `
          <div class="deck-card-row" data-id="${c.id}" data-scryfall="${c.scryfall_id || ''}">
            <div class="deck-card-row-info" data-row-info="${c.id}">
              ${c.image_uri
                ? `<img src="${c.image_uri}" class="deck-card-thumb" alt="${escHtml(c.name)}" loading="lazy" />`
                : '<div class="deck-card-thumb" style="background:var(--bg-elevated);border-radius:3px"></div>'}
              <div style="min-width:0;">
                <div class="deck-card-row-name">${escHtml(c.name)}</div>
                <div class="deck-card-row-type">${formatManaCost(c.mana_cost || '')} ${escHtml(c.type_line || '')}</div>
              </div>
            </div>
            <div class="deck-card-controls">
              <div class="deck-qty-controls">
                <button class="btn-qty-minus" data-qty-minus="${c.id}" title="Remove one (at 0 removes from deck only, keeps in collection)">−</button>
                <span class="deck-card-row-qty">×${c.quantity}</span>
                <button class="btn-qty-plus" data-qty-plus="${c.id}" title="Add one">+</button>
              </div>
              <button class="btn-role-toggle ${isCommander ? 'active' : ''}" data-role-cmd="${c.id}" title="Toggle Commander">👑</button>
              <button class="btn-role-toggle ${isSide ? 'active' : ''}" data-role-side="${c.id}" title="Toggle Sideboard">📦</button>
              <button class="btn-card-delete" data-del="${c.id}" title="Remove from deck (keeps in collection)">✕</button>
            </div>
          </div>`;
      });
    }
    s += '</div>';
    return s;
  };

  html += renderSection('Commander', commanders);
  html += renderSection('Mainboard', mainboard);
  html += renderSection('Sideboard', sideboard);

  if (!html) {
    html = '<div class="empty-state">No cards in this deck. Use “Add Card from Collection” above to add cards you own.</div>';
  }
  container.innerHTML = html;

  // Quantity + / −
  container.querySelectorAll('[data-qty-plus]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dcId = btn.dataset.qtyPlus;
      const card = cards.find(x => String(x.id) === String(dcId));
      const newQty = (card ? (card.quantity || 1) : 1) + 1;
      updateDeckCardQty(dcId, newQty);
    });
  });
  container.querySelectorAll('[data-qty-minus]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dcId = btn.dataset.qtyMinus;
      const card = cards.find(x => String(x.id) === String(dcId));
      const newQty = (card ? (card.quantity || 1) : 1) - 1;
      if (newQty <= 0) {
        if (confirm('Quantity would be 0. Remove this card from the deck? (It stays in your collection.)')) {
          deleteDeckCard(dcId);
        }
        return;
      }
      updateDeckCardQty(dcId, newQty);
    });
  });

  // Role toggles — move between Commander / Mainboard / Sideboard
  container.querySelectorAll('[data-role-cmd]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dcId = btn.dataset.roleCmd;
      const card = cards.find(x => String(x.id) === String(dcId));
      if (!card) return;
      updateDeckCardRole(dcId, { is_commander: !card.is_commander, is_sideboard: false });
    });
  });
  container.querySelectorAll('[data-role-side]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dcId = btn.dataset.roleSide;
      const card = cards.find(x => String(x.id) === String(dcId));
      if (!card) return;
      updateDeckCardRole(dcId, { is_sideboard: !card.is_sideboard, is_commander: false });
    });
  });

  // Delete from deck
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDeckCard(btn.dataset.del);
    });
  });

  // Click card info to open detail
  container.querySelectorAll('.deck-card-row-info').forEach(info => {
    info.addEventListener('click', async () => {
      const row = info.closest('.deck-card-row[data-scryfall]');
      const sfId = row?.dataset.scryfall;
      if (!sfId) return;
      openModal();
      modalInner.innerHTML = '<div class="modal-loading">Loading card details…</div>';
      try {
        const sc = await apiFetch(`/api/scryfall/card/${sfId}`);
        const front = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || '';
        const back  = sc.card_faces?.[1]?.image_uris?.normal || '';
        const fakeCard = {
          scryfall_id: sfId,
          name:        sc.name,
          type_line:   sc.type_line,
          mana_cost:   sc.mana_cost || sc.card_faces?.[0]?.mana_cost || '',
          oracle_text: sc.oracle_text || sc.card_faces?.map(f=>f.oracle_text).join('\n//\n') || '',
          rarity:      sc.rarity,
          set_name:    sc.set_name,
          set_code:    (sc.set||'').toUpperCase(),
          cmc:         sc.cmc,
          image_uri:   front,
          image_uri_back: back,
        };
        renderCardModal(fakeCard, sc);
      } catch(e) {
        modalInner.innerHTML = `<div class="modal-loading">Could not load card: ${e.message}</div>`;
      }
    });
  });
}

async function updateDeckCardQty(deckCardId, newQty) {
  try {
    await apiFetch(`/api/decks/${currentDeckId}/cards/${deckCardId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity: newQty }),
    });
    await openDeck(currentDeckId, { keepAddPanel: true });
    loadDeckList();
  } catch (e) {
    alert('Could not update quantity: ' + e.message);
  }
}

async function updateDeckCardRole(deckCardId, role) {
  try {
    await apiFetch(`/api/decks/${currentDeckId}/cards/${deckCardId}`, {
      method: 'PUT',
      body: JSON.stringify(role),
    });
    await openDeck(currentDeckId, { keepAddPanel: true });
    loadDeckList();
  } catch (e) {
    alert('Could not move card: ' + e.message);
  }
}

async function deleteDeckCard(deckCardId) {
  if (!confirm('Remove this card from the deck? It will stay in your collection.')) return;
  try {
    await apiFetch(`/api/decks/${currentDeckId}/cards/${deckCardId}`, { method: 'DELETE' });
    await openDeck(currentDeckId, { keepAddPanel: true });
    loadDeckList();
    loadNavStats();
  } catch (e) {
    alert('Could not remove card: ' + e.message);
  }
}

function closeDeckPanel() {
  currentDeckId = null;
  currentDeck = null;
  document.getElementById('deck-panel').classList.add('hidden');
  document.getElementById('deck-list').classList.remove('hidden');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function primaryType(typeLine) {
  const order = ['Planeswalker','Creature','Instant','Sorcery','Enchantment',
                 'Artifact','Land','Battle'];
  for (const t of order) {
    if (typeLine.includes(t)) return t;
  }
  return 'Other';
}
