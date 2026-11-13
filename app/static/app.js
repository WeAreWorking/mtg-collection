/**
 * MTG Collection & SORTING Deck Hub — shared frontend (Collection, Decks, Import).
 * Vanilla JS, no build step. The SORTING builder lives in sorting.js.
 */

// ── Mana symbols ──────────────────────────────────────────────────────────────
// "{2}{W/U}" → <img> tags from /static/mana, falling back to Scryfall's SVGs.
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

// ── Navbar totals ─────────────────────────────────────────────────────────────
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

// Navbar ↻: re-fetch every price from Scryfall
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
 * Open the card modal for a grouped collection entry (from /api/collection),
 * fetching the live Scryfall card for prices and buy links.
 */
async function openCardModal(card) {
  openModal();
  modalInner.innerHTML = '<div class="modal-loading">Loading card details…</div>';

  let scryfallCard = null;
  if (card.scryfall_id) {
    try {
      scryfallCard = await apiFetch(`/api/scryfall/card/${card.scryfall_id}`);
    } catch (e) { /* offline: show cached data only */ }
  }

  renderCardModal(card, scryfallCard);
}

/**
 * Price box for the card modal. TCGplayer USD (with CAD) comes from the
 * cached collection row; Cardmarket EUR, MTGO tix and the buy links come from
 * the live Scryfall card when it was fetched.
 */
function renderPriceBox(card, sc) {
  const mp = card.market_prices || {};
  const live = sc.prices || {};
  const foil = !!card.foil;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const fmt = (v, prefix = '', suffix = '') => (v === null || Number.isNaN(v) ? '—' : `${prefix}${v.toFixed(2)}${suffix}`);

  const liveUsd = num(foil ? (live.usd_foil ?? live.usd_etched ?? live.usd) : (live.usd ?? live.usd_foil));
  const usd = mp.tcgplayer?.usd ?? liveUsd;
  const cad = mp.tcgplayer?.cad ?? (usd !== null && mp.rate_usd_cad ? usd * mp.rate_usd_cad : null);
  const eur = num(foil ? (live.eur_foil ?? live.eur) : (live.eur ?? live.eur_foil));
  const tix = num(live.tix) ?? mp.mtgo?.tix ?? null;
  const rateStr = mp.rate_usd_cad ? `1 USD = C$${mp.rate_usd_cad.toFixed(2)}` : '';

  const tile = (label, main, sub) => `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:0.6rem 0.8rem;">
      <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">${label}</div>
      <div style="font-size:1.15rem;font-weight:700;color:#fff;font-family:var(--font-mono);margin:2px 0;">${main}</div>
      ${sub ? `<div style="font-size:0.85rem;color:var(--gold);font-weight:600;font-family:var(--font-mono);">${sub}</div>` : ''}
    </div>`;

  const buy = sc.purchase_uris || {};
  const links = [['tcgplayer', 'TCGplayer'], ['cardkingdom', 'Card Kingdom'], ['cardmarket', 'Cardmarket']]
    .filter(([key]) => buy[key])
    .map(([key, label]) => `<a href="${escHtml(buy[key])}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${label} ↗</a>`)
    .join('');

  return `
    <div class="modal-pricing-box" style="margin-top:1rem;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;gap:0.5rem;flex-wrap:wrap;">
        <div style="font-weight:700;color:#fff;font-size:0.95rem;">💰 Prices${foil ? ' (foil)' : ''}</div>
        ${rateStr ? `<span class="badge" style="background:rgba(0,240,255,0.1);color:var(--cyan);font-size:0.75rem;">${rateStr}</span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;">
        ${tile('TCGplayer (market)', fmt(usd, '$'), cad !== null ? fmt(cad, 'C$', ' CAD') : '')}
        ${tile('Cardmarket', fmt(eur, '€'), '')}
        ${tile('MTGO (Cardhoarder)', fmt(tix, '', ' tix'), '')}
      </div>
      ${links ? `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.75rem;">${links}</div>` : ''}
      <p style="font-size:0.72rem;color:var(--text-dim);margin:0.5rem 0 0;">Prices via Scryfall. Collection totals use the TCGplayer price.</p>
    </div>`;
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


  // Every owned printing of this name (sets, finishes, storage boxes)
  const printings = Array.isArray(card.printings) ? card.printings : [];
  const printingsCount = card.printings_count || printings.length || 1;
  const totalQty = card.quantity || 1;

  // Build image section
  let imageSectionHtml = '';
  if (card.image_uri_back) {
    imageSectionHtml = `
      <div class="modal-image modal-image-dfc">
        <img id="modal-main-image" src="${card.image_uri}" alt="${escHtml(name)} front" loading="lazy" />
        <img src="${card.image_uri_back}" alt="${escHtml(name)} back" loading="lazy" />
      </div>`;
  } else if (card.image_uri) {
    imageSectionHtml = `
      <div class="modal-image">
        <img id="modal-main-image" src="${card.image_uri}" alt="${escHtml(name)}" loading="lazy" />
      </div>`;
  } else {
    imageSectionHtml = `<div class="modal-image" style="background:var(--bg-elevated);border-radius:var(--radius-sm);aspect-ratio:63/88;display:flex;align-items:center;justify-content:center;color:var(--text-dim);">No image</div>`;
  }

  const printingBrowserHtml = (card.id && printings.length > 0) ? `
    <div class="printing-browser" id="printing-browser" style="margin-top:0.6rem;">
      <div class="printing-browser-track">
        ${printings.map((p, idx) => `
          <button type="button" class="printing-browser-thumb ${idx === 0 ? 'active' : ''}" data-printing-id="${p.id}" data-image="${escHtml(p.image_uri || card.image_uri || '')}" title="${escHtml((p.set_code || '') + (p.collector_number ? ' #' + p.collector_number : '') + (p.foil ? ' Foil' : ''))} — click to preview">
            ${p.image_uri || card.image_uri ? `<img class="printing-thumb" src="${p.image_uri || card.image_uri}" alt="${escHtml(name)} ${escHtml(p.set_code || '')}" loading="lazy" onerror="this.style.display='none'" />` : `<span class="printing-thumb-placeholder">No img</span>`}
            <span class="printing-browser-label">${escHtml(p.set_code || '—')}${p.foil ? '✦' : ''} ×${p.quantity}</span>
          </button>
        `).join('')}
      </div>
      <p style="font-size:0.75rem;color:var(--text-dim);margin-top:0.4rem;">Scroll / click a printing to preview it. Hover a thumbnail in the list below for a large preview.</p>
    </div>
  ` : '';

  const printingsHtml = (card.id && printings.length > 0) ? `
    <div style="margin-top:1rem;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;flex-wrap:wrap;gap:0.4rem;">
        <div style="font-weight:700;color:#fff;">📚 Printings — ×${totalQty} total${printingsCount > 1 ? ` (${printingsCount} printings)` : ''}</div>
        <span class="badge badge-set">${escHtml((card.sets || []).join(' + ') || setCode || '—')}</span>
      </div>
      ${printingBrowserHtml}
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${printings.map((p, idx) => `
          <div class="printing-row" data-printing-id="${p.id}" style="display:grid;grid-template-columns:44px 70px 1fr 90px 110px auto auto;gap:0.5rem;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:0.5rem 0.6rem;">
            <span class="printing-thumb-wrap" data-image="${escHtml(p.image_uri || card.image_uri || '')}" title="${escHtml(name)} ${escHtml(p.set_code || '')}${p.foil ? ' Foil' : ''}">
              ${(p.image_uri || card.image_uri)
                ? `<img class="printing-thumb" src="${p.image_uri || card.image_uri}" alt="${escHtml(name)} ${escHtml(p.set_code || '')}" loading="lazy" style="width:36px;height:50px;object-fit:cover;border-radius:3px;cursor:zoom-in;" onerror="this.style.display='none'" />
                   <span class="printing-hover-preview"><img src="${p.image_uri || card.image_uri}" alt="" /></span>`
                : `<span style="width:36px;height:50px;background:var(--bg-elevated);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.6rem;">No img</span>`}
            </span>
            <span class="badge badge-set" title="Set • Collector #">${escHtml(p.set_code || '—')}${p.collector_number ? ' #' + escHtml(p.collector_number) : ''}</span>
            <span style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(p.storage_location || '')}">${p.foil ? '✦ Foil • ' : ''}${escHtml(p.storage_location || 'Binder')}</span>
            <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.78rem;color:var(--text-dim);">Qty
              <input type="number" class="filter-input printing-qty" data-id="${p.id}" value="${p.quantity}" min="0" style="width:60px;padding:0.25rem 0.4rem;" />
            </label>
            <select class="filter-select printing-foil" data-id="${p.id}" style="padding:0.25rem 0.4rem;font-size:0.8rem;">
              <option value="false" ${!p.foil ? 'selected' : ''}>Non-foil</option>
              <option value="true" ${p.foil ? 'selected' : ''}>Foil ✦</option>
            </select>
            <button type="button" class="btn btn-primary btn-sm printing-add-btn" data-id="${p.id}" title="Add one more copy of this exact printing (no need to look up the set code)">＋ Add</button>
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
        <p style="font-size:0.75rem;color:var(--text-dim);margin-top:0.4rem;">Per-printing qty/foil is saved with “Save Changes”. “＋ Add” adds one copy of that exact printing immediately. Deleting a printing removes only that set/foil copy; when the last copy is gone the card is also removed from decks.</p>
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

        ${renderPriceBox(card, sc)}
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
              // Rows deleted above (qty 0) return 404; ignore those
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
          const res = await apiFetch('/api/collection/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ ids: printings.map(p => p.id) }),
          });
          if (res.removed_from_decks) alert(`Removed from ${res.removed_from_decks} deck slot(s) as well.`);
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

    // Printing browser: click thumb to preview, hover thumb for large preview
    const browserThumbs = modalInner.querySelectorAll('.printing-browser-thumb');
    const previewPrinting = (imgSrc) => {
      const mainImg = document.getElementById('modal-main-image');
      if (mainImg && imgSrc) mainImg.src = imgSrc;
    };
    browserThumbs.forEach(thumb => {
      thumb.addEventListener('click', () => {
        browserThumbs.forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        previewPrinting(thumb.dataset.image);
        modalInner.querySelectorAll('.printing-row').forEach(row => {
          row.classList.toggle('printing-selected', row.dataset.printingId === thumb.dataset.printingId);
        });
      });
      thumb.addEventListener('mouseenter', () => previewPrinting(thumb.dataset.image));
    });
    modalInner.querySelectorAll('.printing-thumb-wrap').forEach(wrap => {
      wrap.addEventListener('mouseenter', () => previewPrinting(wrap.dataset.image));
    });
    modalInner.querySelectorAll('.printing-row').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const img = row.querySelector('.printing-thumb');
        if (img && img.src) previewPrinting(img.src);
      });
    });

    // Add one copy of this exact printing (no set-code lookup needed)
    modalInner.querySelectorAll('.printing-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.id;
        const printing = printings.find(p => String(p.id) === String(pid));
        if (!printing) return;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const current = printing.quantity || 0;
          const updated = await apiFetch(`/api/collection/${pid}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: current + 1 }),
          });
          printing.quantity = updated.quantity != null ? updated.quantity : current + 1;
          // Refresh modal + collection so totals/previews stay in sync
          closeModal();
          if (typeof loadCollection === 'function') await loadCollection();
          loadNavStats();
          // Reopen with fresh data so the new total is visible immediately
          const fresh = lastCollectionCards.find(c => c.name === card.name) || card;
          openCardModal({ ...fresh, printings: (fresh.printings && fresh.printings.length ? fresh.printings : printings) });
        } catch (e) {
          alert('Could not add a copy: ' + e.message);
          btn.disabled = false;
          btn.textContent = '＋ Add';
        }
      });
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

// ── Bulk remove ─────────────────────────────────────────────────────────────────
// Selected cards keyed by name, holding their grouped data (survives paging)
let bulkSelected = new Map();
let lastCollectionCards = [];

function toggleBulkSelection(card, checked) {
  if (checked) bulkSelected.set(card.name, card);
  else bulkSelected.delete(card.name);
  // Keep every matching checkbox (table + grid) in sync
  document.querySelectorAll('.bulk-select').forEach(cb => {
    if (cb.dataset && cb.dataset.name === card.name) cb.checked = checked;
  });
  updateBulkBar();
}

function selectAllOnPage() {
  (lastCollectionCards || []).forEach(card => bulkSelected.set(card.name, card));
  document.querySelectorAll('.bulk-select').forEach(cb => {
    const card = (lastCollectionCards || []).find(c => c.name === cb.dataset.name);
    cb.checked = !!card;
  });
  updateBulkBar();
}

async function selectAllMatchingFilter() {
  // Fetch every page of the current filter (1000 per page, up to 10 pages) so
  // "all matching" covers more than the visible page.
  const currentParams = new URLSearchParams({
    q: document.getElementById('search-q')?.value.trim() || '',
    in_deck: document.getElementById('filter-deck')?.value || '',
    color: document.getElementById('filter-color')?.value || '',
    rarity: document.getElementById('filter-rarity')?.value || '',
    foil: document.getElementById('filter-foil')?.value || '',
    sort: document.getElementById('filter-sort')?.value || 'name',
    order: document.getElementById('filter-order')?.value || 'asc',
    page: 1,
    per_page: 1000,
  });
  try {
    let page = 1;
    let pages = 1;
    while (page <= pages && page <= 10) {
      currentParams.set('page', String(page));
      const data = await apiFetch(`/api/collection?${currentParams.toString()}`);
      (data.cards || []).forEach(card => bulkSelected.set(card.name, card));
      pages = data.pages || 1;
      page += 1;
    }
    document.querySelectorAll('.bulk-select').forEach(cb => {
      cb.checked = bulkSelected.has(cb.dataset.name);
    });
    updateBulkBar();
  } catch (e) {
    // Fallback to current page if fetch fails
    selectAllOnPage();
  }
}

function updateBulkBar() {
  const barBtn = document.getElementById('btn-bulk-remove');
  const clearBtn = document.getElementById('btn-bulk-clear');
  const countEl = document.getElementById('bulk-remove-count');
  const selected = [...bulkSelected.values()];
  const totalCopies = selected.reduce((a, c) => a + (c.quantity || 0), 0);
  const show = selected.length > 0;
  if (barBtn) {
    barBtn.classList.toggle('hidden', !show);
    if (countEl) countEl.textContent = `${selected.length} name${selected.length !== 1 ? 's' : ''} · ${totalCopies} copies`;
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', !show);
  syncSelectAllCheckbox();
}

function syncSelectAllCheckbox() {
  const selAll = document.getElementById('select-all-cards');
  if (!selAll) return;
  const boxes = [...document.querySelectorAll('.bulk-select')];
  if (!boxes.length) { selAll.checked = false; selAll.indeterminate = false; return; }
  const checked = boxes.filter(b => b.checked).length;
  selAll.checked = checked === boxes.length && checked > 0;
  selAll.indeterminate = checked > 0 && checked < boxes.length;
}

function clearBulkSelection() {
  bulkSelected.clear();
  document.querySelectorAll('.bulk-select').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('select-all-cards');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  updateBulkBar();
}

function openBulkRemove() {
  if (!bulkSelected.size) return;
  const selected = [...bulkSelected.values()];
  const list = document.getElementById('bulk-remove-list');
  if (!list) return;
  list.innerHTML = selected.map(card => {
    const printings = card.printings && card.printings.length ? card.printings : [
      { id: card.id, set_code: card.set_code, collector_number: card.collector_number, foil: card.foil, quantity: card.quantity, storage_location: card.storage_location, image_uri: card.image_uri }
    ];
    const total = printings.reduce((a, p) => a + (p.quantity || 0), 0) || card.quantity || 0;
    const rows = printings.map(p => {
      const owned = p.quantity || 0;
      const img = p.image_uri || card.image_uri || '';
      const label = `${p.set_code || '—'}${p.collector_number ? ' #' + p.collector_number : ''}${p.foil ? ' ✦Foil' : ''}${p.storage_location ? ' @ ' + p.storage_location : ''}`;
      return `
        <div class="bulk-printing-row" style="display:flex; align-items:center; gap:0.6rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:0.5rem;">
          ${img ? `<img src="${img}" alt="${escHtml(card.name)}" loading="lazy" style="width:36px;height:50px;object-fit:cover;border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'" />`
                : `<span style="width:36px;height:50px;background:var(--bg-elevated);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.6rem;">No img</span>`}
          <span class="badge badge-set" style="flex-shrink:0;">${escHtml(label)}</span>
          <span style="flex:1; font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">Owned ×${owned}</span>
          <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.78rem; color:var(--text-dim);">Remove
            <input type="number" class="filter-input bulk-remove-qty" data-printing-id="${p.id}" value="${owned}" min="0" max="${owned}" style="width:64px; padding:0.25rem 0.4rem;" />
          </label>
        </div>`;
    }).join('');
    return `
      <div class="bulk-card-group">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.4rem;">
          <span style="font-weight:700; color:#fff;">${escHtml(card.name)}</span>
          <span class="badge badge-qty">×${total} owned</span>
          ${printings.length > 1 ? `<span class="badge badge-printings">${printings.length} printings</span>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:0.4rem;">${rows}</div>
      </div>`;
  }).join('');
  updateBulkRemoveTotal();
  list.querySelectorAll('.bulk-remove-qty').forEach(inp => inp.addEventListener('input', updateBulkRemoveTotal));
  document.getElementById('bulk-remove-modal')?.classList.remove('hidden');
}

function updateBulkRemoveTotal() {
  const inputs = document.querySelectorAll('.bulk-remove-qty');
  let copies = 0, printings = 0;
  inputs.forEach(inp => {
    const v = Math.min(Math.max(parseInt(inp.value, 10) || 0, 0), parseInt(inp.max, 10) || 0);
    copies += v;
    if (v > 0) printings += 1;
  });
  const totalEl = document.getElementById('bulk-remove-total');
  if (totalEl) totalEl.textContent = `Will remove ${copies} ${copies === 1 ? 'copy' : 'copies'} across ${printings} printing${printings !== 1 ? 's' : ''} (${bulkSelected.size} card name${bulkSelected.size !== 1 ? 's' : ''}).`;
  const btn = document.getElementById('bulk-remove-confirm');
  if (btn) btn.disabled = copies === 0;
}

function closeBulkRemove() {
  document.getElementById('bulk-remove-modal')?.classList.add('hidden');
}

async function confirmBulkRemove() {
  const inputs = [...document.querySelectorAll('.bulk-remove-qty')];
  const items = [];
  inputs.forEach(inp => {
    const qty = parseInt(inp.value, 10) || 0;
    const max = parseInt(inp.max, 10) || 0;
    if (qty > 0) items.push({ printing_id: Number(inp.dataset.printingId), quantity: Math.min(qty, max || qty) });
  });
  if (!items.length) return;
  const btn = document.getElementById('bulk-remove-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
  try {
    const res = await apiFetch('/api/collection/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    closeBulkRemove();
    clearBulkSelection();
    currentPage = 1;
    await loadCollection();
    loadNavStats();
    const deckNote = res.removed_from_decks ? ` Also removed from ${res.removed_from_decks} deck slot(s).` : '';
    alert(`Removed ${res.removed_copies} ${res.removed_copies === 1 ? 'copy' : 'copies'} from ${res.removed_printings} printing(s).${deckNote}`);
  } catch (e) {
    alert('Could not remove cards: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Remove selected'; }
  }
}

function initCollectionPage() {
  loadNavStats();
  populateDeckFilter();
  updateViewModeUI();

  // Bulk remove wiring
  document.getElementById('select-all-cards')?.addEventListener('change', (e) => {
    if (e.target.checked) selectAllOnPage();
    else clearBulkSelection();
  });
  document.getElementById('btn-select-all-page')?.addEventListener('click', selectAllOnPage);
  document.getElementById('btn-select-all-filter')?.addEventListener('click', selectAllMatchingFilter);
  document.getElementById('btn-bulk-remove')?.addEventListener('click', openBulkRemove);
  document.getElementById('btn-bulk-clear')?.addEventListener('click', clearBulkSelection);
  document.getElementById('bulk-remove-close')?.addEventListener('click', closeBulkRemove);
  document.getElementById('bulk-remove-cancel')?.addEventListener('click', closeBulkRemove);
  document.getElementById('bulk-remove-modal')?.addEventListener('click', (e) => { if (e.target.id === 'bulk-remove-modal') closeBulkRemove(); });
  document.getElementById('bulk-remove-confirm')?.addEventListener('click', confirmBulkRemove);

  // Table view defaults to 250 per page
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
  ['filter-deck','filter-color','filter-rarity','filter-foil','filter-sort','filter-order','filter-per-page'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        currentPage = 1; loadCollection();
      });
    }
  });

  // Clickable column headers (high/low toggle, synced to dropdowns)
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (!field) return;
      const sortEl = document.getElementById('filter-sort');
      const orderEl = document.getElementById('filter-order');
      if (!sortEl || !orderEl) return;
      if (sortEl.value === field) {
        orderEl.value = orderEl.value === 'asc' ? 'desc' : 'asc';
      } else {
        sortEl.value = field;
        orderEl.value = 'asc';
      }
      currentPage = 1;
      loadCollection();
    });
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('search-q').value = '';
    const deckFilter = document.getElementById('filter-deck');
    if (deckFilter) deckFilter.value = '';
    document.getElementById('filter-color').value = '';
    document.getElementById('filter-rarity').value = '';
    document.getElementById('filter-foil').value = '';
    document.getElementById('filter-sort').value = 'name';
    const orderEl = document.getElementById('filter-order');
    if (orderEl) orderEl.value = 'asc';
    currentPage = 1;
    loadCollection();
  });
}

function updateSortIndicators(sortBy, sortOrder) {
  document.querySelectorAll('.sortable-th').forEach(th => {
    const ind = th.querySelector('.sort-indicator');
    if (!ind) return;
    if (th.dataset.sort === sortBy) {
      ind.textContent = sortOrder === 'desc' ? ' ↓' : ' ↑';
      th.classList.add('sort-active');
    } else {
      ind.textContent = '';
      th.classList.remove('sort-active');
    }
  });
}

let collectionRequest = 0;  // ignore responses that arrive after a newer request

async function loadCollection() {
  const reqId = ++collectionRequest;
  const grid = document.getElementById('card-grid');
  const tableBody = document.getElementById('card-table-body');
  if (grid) grid.innerHTML = '<div class="loading-state">Scanning collection databanks…</div>';
  if (tableBody) tableBody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:2.5rem;color:var(--cyan);font-family:var(--font-mono);">Scanning collection databanks…</td></tr>';

  const perPageVal = parseInt(document.getElementById('filter-per-page')?.value || (viewMode === 'table' ? '250' : '60'), 10);
  const deckVal = document.getElementById('filter-deck')?.value || '';
  const sortBy = document.getElementById('filter-sort')?.value || 'name';
  const sortOrder = document.getElementById('filter-order')?.value === 'desc' ? 'desc' : 'asc';
  updateSortIndicators(sortBy, sortOrder);

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
    if (reqId !== collectionRequest) return;
    renderGrid(data);
  } catch (e) {
    if (reqId !== collectionRequest) return;
    const errHtml = `<div class="empty-state"><span class="empty-icon">⚠️</span>Error: ${escHtml(e.message)}</div>`;
    if (grid) grid.innerHTML = errHtml;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:2rem;color:var(--pink);">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderGrid(data) {
  const grid = document.getElementById('card-grid');
  const tableBody = document.getElementById('card-table-body');
  const count = document.getElementById('result-count');
  const uniqueCount = (data.total_unique ?? data.total ?? 0).toLocaleString();
  const totalCount = (data.total_quantity ?? data.total ?? 0).toLocaleString();
  count.textContent = `${totalCount} cards (${uniqueCount} unique)`;
  lastCollectionCards = data.cards || [];

  updateViewModeUI();

  if (data.cards.length === 0) {
    const emptyHtml = `<div class="empty-state">
      <span class="empty-icon">🛸</span>
      No cards found in databanks. Try adjusting your filters or <a href="/import">import some cards</a>.
    </div>`;
    if (grid) grid.innerHTML = emptyHtml;
    if (tableBody) tableBody.innerHTML = `<tr class="table-empty-row"><td colspan="12" class="table-empty-cell"><div class="empty-state"><span class="empty-icon">🛸</span>No cards found in databanks. Try adjusting your filters or <a href="/import">import some cards</a>.</div></td></tr>`;
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
          <td class="text-center"><input type="checkbox" class="bulk-select" data-name="${escHtml(card.name)}" ${bulkSelected.has(card.name) ? 'checked' : ''} title="Select for bulk remove" style="transform:scale(1.2); accent-color:var(--accent);" /></td>
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
      row.addEventListener('click', (e) => {
        if (e.target.closest('.bulk-select')) return;
        const id = row.dataset.id;
        const card = data.cards.find(c => c.id == id);
        if (card) openCardModal(card);
      });
    });
    tableBody.querySelectorAll('.bulk-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const card = data.cards.find(c => c.name === cb.dataset.name);
        if (card) toggleBulkSelection(card, cb.checked);
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
    syncSelectAllCheckbox();
  }

  // ── Render Visual Card Grid Mode ───────────────────────────────────────────
  if (grid) {
    grid.innerHTML = data.cards.map(card => {
      const decks = card.decks || [];
      const isSorting = decks.length >= 2;
      const printingsCount = card.printings_count || 1;
      return `
        <div class="card-tile" data-id="${card.id}" title="${escHtml(card.name)}">
          <div class="card-tile-select" style="position:absolute; top:6px; left:6px; z-index:2;">
            <input type="checkbox" class="bulk-select" data-name="${escHtml(card.name)}" ${bulkSelected.has(card.name) ? 'checked' : ''} title="Select for bulk remove" onclick="event.stopPropagation()" style="transform:scale(1.3); accent-color:var(--accent); background:rgba(0,0,0,0.5);" />
          </div>
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
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.bulk-select')) return;
        const id = tile.dataset.id;
        const card = data.cards.find(c => c.id == id);
        if (card) openCardModal(card);
      });
    });
    grid.querySelectorAll('.bulk-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const card = data.cards.find(c => c.name === cb.dataset.name);
        if (card) toggleBulkSelection(card, cb.checked);
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
    syncSelectAllCheckbox();
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
      const data = await apiFetch('/api/import/collection', {
        method: 'POST',
        body: JSON.stringify({
          text,
          storage:   document.getElementById('col-storage').value,
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
          format:             (document.getElementById('deck-format').value || '').trim() || 'Commander',
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
let deckSearchCache = [];           // last search results (with printings)
let deckSelectedPrinting = {};      // name -> printing id (builder selection)

function _normalizeIdentity(value) {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map(p => String(p).trim().toUpperCase()).filter(c => ['W','U','B','R','G'].includes(c));
}

function _commanderIdentity(deck) {
  if (!deck) return null;
  if (Array.isArray(deck.commander_color_identity)) return deck.commander_color_identity.slice();
  if (deck.commander_color_identity == null && Array.isArray(deck.cards)) {
    const cmds = _commanderCards(deck);
    if (!cmds.length) return null;
    const set = new Set();
    cmds.forEach(c => _normalizeIdentity(c.color_identity?.length ? c.color_identity : c.colors).forEach(col => set.add(col)));
    return Array.from(set);
  }
  return null;
}

function _commanderCards(deck) {
  return (deck?.cards || []).filter(c => c.is_commander);
}

function _isLegalForCommander(cardIdentity, commanderIdentity) {
  if (!Array.isArray(commanderIdentity)) return true; // no commander set
  const allowed = new Set(commanderIdentity.map(c => c.toUpperCase()));
  const have = new Set(_normalizeIdentity(cardIdentity));
  for (const c of have) {
    if (!allowed.has(c)) return false;
  }
  return true;
}

function _identityLabel(identity) {
  if (identity == null) return 'no commander yet — all colours allowed';
  if (!identity.length) return 'colourless';
  return identity.join('');
}

function _identitySymbols(identity) {
  if (!identity || !identity.length) return '(colourless)';
  return _normalizeIdentity(identity).map(c => `<img src="/static/mana/${c}.svg" class="mana-symbol" alt="{${c}}" title="{${c}}" onerror="this.onerror=null; this.src='https://svgs.scryfall.io/card-symbols/${c}.svg';" />`).join('');
}

function updateDeckIdentityUI() {
  const banner = document.getElementById('deck-identity-banner');
  const note = document.getElementById('deck-builder-identity');
  const toggle = document.getElementById('deck-legal-only');
  const toggleWrap = document.getElementById('deck-identity-toggle-wrap');
  const identity = _commanderIdentity(currentDeck);
  const isCommanderDeck = (() => {
    const fmt = ((currentDeck?.format || '').trim() || 'Commander').toLowerCase();
    return fmt.includes('commander') || fmt.includes('edh');
  })();
  if (banner) {
    if (identity != null && isCommanderDeck) {
      const cmds = _commanderCards(currentDeck);
      const names = cmds.map(c => c.name).join(' + ') || 'Commander';
      banner.innerHTML = `<span class="badge badge-sorting" title="Commander colour identity restricts the 99">🎨 Commander identity: ${_identitySymbols(identity)} <span style="color:var(--text-muted);font-weight:600;">${escHtml(_identityLabel(identity))}</span> <span style="color:var(--text-muted);">(${escHtml(names)})</span></span>`;
      banner.style.display = '';
    } else if (isCommanderDeck) {
      banner.innerHTML = `<span class="badge badge-set" title="Add a commander to restrict colours">👑 No commander yet — add one to enable colour identity restrictions</span>`;
      banner.style.display = '';
    } else {
      banner.innerHTML = '';
      banner.style.display = 'none';
    }
  }
  if (note) {
    note.textContent = (identity != null && isCommanderDeck)
      ? ` Commander identity ${_identityLabel(identity)} — showing only legal cards.`
      : (isCommanderDeck ? ' Set a commander to restrict colours.' : '');
  }
  if (toggleWrap) toggleWrap.style.display = (isCommanderDeck && identity != null) ? '' : 'none';
  if (toggle && identity == null) toggle.checked = true;
}

function expectedDeckSize(format, totalQty) {
  const raw = (format || '').trim();
  // Empty or numeric formats (Archidekt format IDs) count as Commander (100).
  const fmt = (!raw || /^\d+$/.test(raw)) ? 'commander' : raw.toLowerCase();
  let expected = 60;
  if (fmt.includes('commander') || fmt.includes('edh')) expected = 100;
  else if (fmt.includes('draft') || fmt.includes('sealed')) expected = 40;
  const ok = totalQty === expected;
  return {
    expected,
    ok,
    warning: ok ? null : `Deck has ${totalQty} cards (expected ${expected} for ${fmt || 'format'})`,
  };
}

function initDecksPage() {
  loadNavStats();
  loadDeckList();

  const backBtn = document.getElementById('deck-panel-back');
  if (backBtn) backBtn.addEventListener('click', closeDeckPanel);

  const createBtn = document.getElementById('btn-create-deck');
  if (createBtn) createBtn.addEventListener('click', openDeckCreateModal);
  const createClose = document.getElementById('deck-create-modal-close');
  if (createClose) createClose.addEventListener('click', closeDeckCreateModal);
  const createCancel = document.getElementById('btn-cancel-deck-create');
  if (createCancel) createCancel.addEventListener('click', closeDeckCreateModal);
  const createModal = document.getElementById('deck-create-modal');
  if (createModal) createModal.addEventListener('click', (e) => { if (e.target === createModal) closeDeckCreateModal(); });
  const createForm = document.getElementById('deck-create-form');
  if (createForm) createForm.addEventListener('submit', createDeck);

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
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(deckSearchDebounce);
        searchCollectionForDeck();
      }
    });
  }

  const slotSel = document.getElementById('deck-card-target-slot');
  if (slotSel) {
    slotSel.addEventListener('change', () => { searchCollectionForDeck(); });
  }
  const legalToggle = document.getElementById('deck-legal-only');
  if (legalToggle) {
    legalToggle.addEventListener('change', () => { searchCollectionForDeck(); });
  }

  // EDHREC recommendations
  document.getElementById('btn-toggle-recs')?.addEventListener('click', toggleRecsPanel);
  document.getElementById('btn-close-recs')?.addEventListener('click', toggleRecsPanel);
  document.getElementById('deck-recs-sort')?.addEventListener('change', () => loadDeckRecommendations());
  document.getElementById('deck-recs-category')?.addEventListener('change', () => loadDeckRecommendations());
  document.getElementById('btn-recs-refresh')?.addEventListener('click', () => loadDeckRecommendations({ refresh: true }));
}

function toggleAddCardPanel() {
  const panel = document.getElementById('deck-add-card-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    updateDeckIdentityUI();
    const input = document.getElementById('deck-card-search-input');
    if (input) input.focus();
    // Browse mode: show legal collection cards immediately without typing
    if (input && !input.value.trim()) {
      searchCollectionForDeck();
    }
  } else {
    const results = document.getElementById('deck-card-search-results');
    if (results) { results.innerHTML = ''; results.classList.add('hidden'); }
    const preview = document.getElementById('deck-printing-preview');
    if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
  }
}

function openDeckCreateModal() {
  const modal = document.getElementById('deck-create-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const fmtSel = document.getElementById('create-deck-format-select');
  if (fmtSel) fmtSel.value = 'Commander';
  const nameInput = document.getElementById('create-deck-name-input');
  if (nameInput) setTimeout(() => nameInput.focus(), 0);
}

function closeDeckCreateModal() {
  document.getElementById('deck-create-modal')?.classList.add('hidden');
}

async function createDeck(e) {
  e.preventDefault();
  const name = (document.getElementById('create-deck-name-input')?.value || '').trim();
  const format = (document.getElementById('create-deck-format-select')?.value || '').trim() || 'Commander';
  const description = document.getElementById('create-deck-desc-input')?.value || '';
  if (!name) { alert('Deck name is required.'); return; }
  try {
    const deck = await apiFetch('/api/decks', {
      method: 'POST',
      body: JSON.stringify({ name, format, description }),
    });
    closeDeckCreateModal();
    document.getElementById('create-deck-name-input').value = '';
    document.getElementById('create-deck-desc-input').value = '';
    loadDeckList();
    loadNavStats();
    // Open the new empty deck and start building from the collection
    await openDeck(deck.id, { keepAddPanel: false, autoOpenBuilder: true });
  } catch (err) {
    alert('Could not create deck: ' + err.message);
  }
}

function _printingLabel(p) {
  const set = p.set_code || '—';
  const num = p.collector_number ? ` #${p.collector_number}` : '';
  const foil = p.foil ? ' ✦Foil' : '';
  const qty = p.quantity ? ` ×${p.quantity}` : '';
  const storage = p.storage_location ? ` @ ${p.storage_location}` : '';
  return `${set}${num}${foil}${qty}${storage}`;
}

function _resolveSelectedPrinting(result) {
  const prints = result.printings || [];
  if (!prints.length) return null;
  const selectedId = deckSelectedPrinting[result.name];
  if (selectedId != null) {
    const found = prints.find(p => String(p.id) === String(selectedId));
    if (found) return found;
  }
  return prints[0];
}

function renderPrintingPreview(result) {
  const previewEl = document.getElementById('deck-printing-preview');
  if (!previewEl || !result) {
    if (previewEl) { previewEl.innerHTML = ''; previewEl.classList.add('hidden'); }
    return;
  }
  const printing = _resolveSelectedPrinting(result);
  const img = printing?.image_uri || result.image_uri || '';
  previewEl.innerHTML = `
    <div style="flex-shrink:0;">
      ${img ? `<img src="${img}" alt="${escHtml(result.name)} printing preview" style="width:120px;height:auto;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:block;" loading="lazy" onerror="this.style.display='none'" />`
            : `<div style="width:120px;aspect-ratio:63/88;background:var(--bg-elevated);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.75rem;">No image</div>`}
    </div>
    <div style="min-width:0;">
      <div style="font-weight:700;color:#fff;font-size:0.95rem;">${escHtml(result.name)}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:0.2rem;">${escHtml(result.type_line || '')}</div>
      ${printing ? `<div style="font-size:0.8rem;color:var(--cyan);font-family:var(--font-mono);margin-top:0.3rem;">${escHtml(_printingLabel(printing))}</div>` : ''}
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem;">${result.mana_cost ? formatManaCost(result.mana_cost) + ' ' : ''}${(result.color_identity || []).length ? ` Identity: ${_identitySymbols(result.color_identity)}` : ' Identity: colourless'}</div>
    </div>`;
  previewEl.classList.remove('hidden');
}

async function searchCollectionForDeck() {
  const input = document.getElementById('deck-card-search-input');
  const resultsEl = document.getElementById('deck-card-search-results');
  const q = (input?.value || '').trim();
  if (!currentDeckId) {
    if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.classList.add('hidden'); }
    return;
  }
  // Allow browsing with an empty query (shows collection up to limit)
  const legalOnly = document.getElementById('deck-legal-only')?.checked !== false;
  const slot = document.getElementById('deck-card-target-slot')?.value || 'mainboard';
  const commanderIdentity = _commanderIdentity(currentDeck);
  const isCommanderAdding = slot === 'commander';
  try {
    const params = new URLSearchParams({ q, deck_id: String(currentDeckId) });
    if (!legalOnly || isCommanderAdding) params.set('all', '1');
    const rawResults = await apiFetch(`/api/collection/search?${params.toString()}`);
    let results = Array.isArray(rawResults) ? rawResults : [];

    // Client-side legality filter as defence-in-depth (server also filters)
    if (legalOnly && !isCommanderAdding && Array.isArray(commanderIdentity)) {
      results = results.filter(r => _isLegalForCommander(r.color_identity || [], commanderIdentity));
    }

    deckSearchCache = results;

    if (!results.length) {
      const msg = q
        ? `No collection cards match "${escHtml(q)}".`
        : `No cards in your collection. Import or add cards first, then build here.`;
      const legalNote = (legalOnly && !isCommanderAdding && Array.isArray(commanderIdentity))
        ? ` (Showing only ${_identityLabel(commanderIdentity)} legal cards for this commander.)`
        : '';
      resultsEl.innerHTML = `<div style="padding:0.75rem;color:var(--text-muted);font-size:0.85rem;">${msg}${legalNote}</div>`;
      resultsEl.classList.remove('hidden');
      const preview = document.getElementById('deck-printing-preview');
      if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
      return;
    }

    resultsEl.innerHTML = results.map((r, idx) => {
      const prints = r.printings || [];
      const selected = _resolveSelectedPrinting(r);
      const printingSelect = prints.length > 1 ? `
        <select class="filter-select printing-picker" data-printing-for="${escHtml(r.name)}" style="padding:0.25rem 0.4rem;font-size:0.78rem;max-width:190px;">
          ${prints.map(p => `<option value="${p.id}" ${selected && String(p.id) === String(selected.id) ? 'selected' : ''}>${escHtml(_printingLabel(p))}</option>`).join('')}
        </select>
      ` : (prints.length === 1 ? `<span class="badge badge-set" title="Owned printing">${escHtml(_printingLabel(prints[0]))}</span>` : '');
      const previewImg = selected?.image_uri || r.image_uri || '';
      const identitySymbols = (r.color_identity || []).length
        ? `<span class="badge badge-set" title="Colour identity">${escHtml((r.color_identity || []).join(''))}</span>`
        : `<span class="badge badge-set" title="Colourless">◇</span>`;
      return `
      <div class="search-result-item" data-result-index="${idx}">
        <div style="display:flex;align-items:center;gap:0.6rem;min-width:0;flex:1;">
          <img class="printing-thumb" src="${previewImg}" alt="${escHtml(r.name)}" style="width:38px;height:52px;object-fit:cover;border-radius:3px;flex-shrink:0;cursor:zoom-in;" loading="lazy" onerror="this.style.display='none'" data-preview-name="${escHtml(r.name)}" />
          <div style="min-width:0;">
            <div style="font-weight:700;color:#fff;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);">${escHtml(r.type_line || '')} • Owned ×${r.total_owned}${r.printings_count > 1 ? ` • ${r.printings_count} printings` : ''}</div>
            <div style="display:flex;align-items:center;gap:0.35rem;margin-top:0.25rem;flex-wrap:wrap;">${identitySymbols}${printingSelect}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" data-add-card="${escHtml(r.name)}">➕ Add</button>
      </div>
    `;
    }).join('');
    resultsEl.classList.remove('hidden');

    // Preview first result by default
    if (results[0]) renderPrintingPreview(results[0]);

    // Printing pickers → update preview + selected printing
    resultsEl.querySelectorAll('.printing-picker').forEach(sel => {
      sel.addEventListener('change', () => {
        const name = sel.dataset.printingFor;
        deckSelectedPrinting[name] = sel.value;
        const result = deckSearchCache.find(r => r.name === name);
        if (!result) return;
        // Update thumb + preview
        const item = sel.closest('.search-result-item');
        const thumb = item?.querySelector('.printing-thumb');
        const printing = _resolveSelectedPrinting(result);
        if (thumb && printing?.image_uri) thumb.src = printing.image_uri;
        renderPrintingPreview(result);
      });
    });
    // Hover/click thumb → preview that card (single-printing rows too)
    resultsEl.querySelectorAll('.printing-thumb').forEach(img => {
      const show = () => {
        const name = img.dataset.previewName;
        const result = deckSearchCache.find(r => r.name === name);
        if (result) renderPrintingPreview(result);
      };
      img.addEventListener('mouseenter', show);
      img.addEventListener('click', show);
    });

    resultsEl.querySelectorAll('[data-add-card]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.addCard;
        const result = deckSearchCache.find(r => r.name === name);
        const printing = result ? _resolveSelectedPrinting(result) : null;
        addCardToDeck(name, printing ? { printingId: printing.id } : null);
      });
    });
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div style="padding:0.75rem;color:var(--pink);">Search failed: ${escHtml(e.message)}</div>`;
  }
}

async function addCardToDeck(cardName, printingInfo, opts = {}) {
  if (!currentDeckId) return;
  const slotEl = document.getElementById('deck-card-target-slot');
  const qtyEl = document.getElementById('deck-card-target-qty');
  const slot = opts.slot || (slotEl ? slotEl.value : 'mainboard');
  const qty = opts.qty || Math.max(1, parseInt(qtyEl?.value || '1', 10) || 1);
  const payload = {
    name: cardName,
    quantity: qty,
    is_commander: slot === 'commander',
    is_sideboard: slot === 'sideboard',
  };
  if (printingInfo && printingInfo.printingId) payload.collection_card_id = printingInfo.printingId;
  try {
    await apiFetch(`/api/decks/${currentDeckId}/cards`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await openDeck(currentDeckId, { keepAddPanel: true });
    updateDeckIdentityUI();
    if (!opts.fromRecs) {
      const input = document.getElementById('deck-card-search-input');
      if (input) input.focus();
    }
  } catch (e) {
    alert(e.message && e.message.includes('not legal') ? e.message : 'Could not add card: ' + e.message);
  }
}

function openDeckEditModal() {
  if (!currentDeck) return;
  const modal = document.getElementById('deck-edit-modal');
  document.getElementById('edit-deck-name-input').value = currentDeck.name || '';
  const fmtSel = document.getElementById('edit-deck-format-select');
  const rawFormat = (currentDeck.format || '').trim();
  // Empty or numeric formats (Archidekt format IDs) are shown as Commander.
  const curFormat = (!rawFormat || /^\d+$/.test(rawFormat)) ? 'Commander' : rawFormat;
  // Preserve unknown formats by adding an option on the fly
  if (curFormat && !Array.from(fmtSel.options).some(o => o.value === curFormat)) {
    const opt = document.createElement('option');
    opt.value = curFormat;
    opt.textContent = curFormat;
    fmtSel.appendChild(opt);
  }
  fmtSel.value = curFormat || 'Commander';
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
  const format = (document.getElementById('edit-deck-format-select').value || '').trim() || 'Commander';
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
      const displayFormat = (deck.format || '').trim();
      const safeFormat = (!displayFormat || /^\d+$/.test(displayFormat)) ? 'Commander' : displayFormat;
      return `
        <div class="deck-card" data-id="${deck.id}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
            <div class="deck-card-name">${escHtml(deck.name)}</div>
            ${sizeBadge}
          </div>
          <span class="format-badge" style="margin-left:0;">${escHtml(safeFormat)}</span>
          <div class="deck-card-count">${total} cards (${unique} unique)${warn ? `<div style="color:var(--warning);font-size:0.78rem;margin-top:0.3rem;" title="${escHtml(warn)}">⚠️ ${escHtml(warn)}</div>` : ''}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.deck-card').forEach(card => {
      card.addEventListener('click', () => openDeck(card.dataset.id));
    });

  } catch (e) {
    list.innerHTML = `<div class="empty-state">Error loading decks: ${escHtml(e.message)}</div>`;
  }
}

async function openDeck(deckId, opts = {}) {
  const keepAddPanel = opts.keepAddPanel || false;
  const autoOpenBuilder = opts.autoOpenBuilder || false;
  currentDeckId = deckId;
  document.getElementById('deck-list').classList.add('hidden');
  const panel = document.getElementById('deck-panel');
  panel.classList.remove('hidden');
  document.getElementById('deck-panel-cards').innerHTML = '<div class="loading-state">Loading…</div>';
  if (!keepAddPanel && !autoOpenBuilder) {
    document.getElementById('deck-add-card-panel')?.classList.add('hidden');
    const s = document.getElementById('deck-card-search-input');
    if (s) s.value = '';
    const results = document.getElementById('deck-card-search-results');
    if (results) { results.innerHTML = ''; results.classList.add('hidden'); }
    document.getElementById('deck-recs-panel')?.classList.add('hidden');
    deckRecsCache = [];
    const catSel = document.getElementById('deck-recs-category');
    if (catSel) catSel.value = '';
  }

  try {
    const deck = await apiFetch(`/api/decks/${deckId}`);
    currentDeck = deck;
    document.getElementById('deck-panel-name').textContent = deck.name;
    const deckFormat = (deck.format || '').trim();
    document.getElementById('deck-panel-format').textContent = (!deckFormat || /^\d+$/.test(deckFormat)) ? 'Commander' : deckFormat;
    document.getElementById('deck-panel-desc').textContent = deck.description || '';

    // Deck size = commander + mainboard; the sideboard is counted separately
    const inDeck = deck.cards.filter(c => !c.is_sideboard);
    const totalQty = inDeck.reduce((sum, c) => sum + (c.quantity || 1), 0);
    const uniqueQty = inDeck.length;
    const sideQty = deck.cards.filter(c => c.is_sideboard).reduce((sum, c) => sum + (c.quantity || 1), 0);
    const countsBadge = document.getElementById('deck-panel-counts');
    if (countsBadge) {
      countsBadge.textContent = `${totalQty} cards (${uniqueQty} unique)${sideQty ? ` + ${sideQty} sideboard` : ''}`;
    }
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
    updateDeckIdentityUI();

    // Keep recommendations in sync (added cards drop off; commander changes re-rank)
    const recsPanel = document.getElementById('deck-recs-panel');
    if (recsPanel && !recsPanel.classList.contains('hidden')) loadDeckRecommendations();

    if (autoOpenBuilder) {
      const addPanel = document.getElementById('deck-add-card-panel');
      if (addPanel && addPanel.classList.contains('hidden')) {
        toggleAddCardPanel();
      } else {
        searchCollectionForDeck();
      }
      document.getElementById('deck-card-search-input')?.focus();
    }

    document.getElementById('deck-panel-delete').onclick = async () => {
      if (!confirm(`Delete deck "${deck.name}"? This cannot be undone.`)) return;
      await apiFetch(`/api/decks/${deckId}`, { method: 'DELETE' });
      closeDeckPanel();
      loadDeckList();
      loadNavStats();
    };
  } catch (e) {
    document.getElementById('deck-panel-cards').innerHTML =
      `<div class="empty-state">Error: ${escHtml(e.message)}</div>`;
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
        deleteDeckCard(dcId);  // asks for confirmation
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
        modalInner.innerHTML = `<div class="modal-loading">Could not load card: ${escHtml(e.message)}</div>`;
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
    // Commander identity may have changed — refresh builder filter
    const panel = document.getElementById('deck-add-card-panel');
    if (panel && !panel.classList.contains('hidden')) searchCollectionForDeck();
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
    const panel = document.getElementById('deck-add-card-panel');
    if (panel && !panel.classList.contains('hidden')) searchCollectionForDeck();
  } catch (e) {
    alert('Could not remove card: ' + e.message);
  }
}

// ── EDHREC recommendations ────────────────────────────────────────────────────
let deckRecsCache = [];
let deckRecsRequest = 0;

function toggleRecsPanel() {
  const panel = document.getElementById('deck-recs-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) loadDeckRecommendations();
}

function _fmtPct(x) {
  const pct = (x || 0) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

async function loadDeckRecommendations(opts = {}) {
  const listEl = document.getElementById('deck-recs-list');
  const metaEl = document.getElementById('deck-recs-meta');
  if (!listEl || !currentDeckId) return;
  const sort = document.getElementById('deck-recs-sort')?.value || 'top';
  const catSel = document.getElementById('deck-recs-category');
  const category = catSel?.value || '';
  const reqId = ++deckRecsRequest;

  if (!deckRecsCache.length || opts.refresh) {
    listEl.innerHTML = `<div class="loading-state" style="padding:1rem;">${opts.refresh ? 'Refreshing from EDHREC…' : 'Loading EDHREC top cards…'}</div>`;
  }

  try {
    const params = new URLSearchParams({ sort });
    if (category) params.set('category', category);
    if (opts.refresh) params.set('refresh', '1');
    const data = await apiFetch(`/api/decks/${currentDeckId}/recommendations?${params.toString()}`);
    if (reqId !== deckRecsRequest) return; // a newer request superseded this one

    // Category dropdown (EDHREC list headers with owned counts)
    if (catSel) {
      const cats = (data.categories || []).filter(c => c.count > 0);
      catSel.innerHTML = `<option value="">All EDHREC lists</option>` + cats.map(c =>
        `<option value="${escHtml(c.name)}" ${c.name === category ? 'selected' : ''}>${escHtml(c.name)} (${c.count})</option>`
      ).join('');
      if (category && !cats.some(c => c.name === category)) catSel.value = '';
    }

    // Meta line: commander, source, freshness
    if (metaEl) {
      const parts = [];
      if ((data.commanders || []).length) parts.push(`For <strong>${escHtml(data.commanders.join(' + '))}</strong>`);
      if (data.edhrec_total) parts.push(`${data.owned_matches} of EDHREC's ${data.edhrec_total} suggested cards are in your collection and not in this deck`);
      if (data.source_url) parts.push(`<a href="${escHtml(data.source_url)}" target="_blank" rel="noopener" style="color:var(--cyan);">EDHREC ↗</a>`);
      if (data.fetched_at) parts.push(`updated ${new Date(data.fetched_at + 'Z').toLocaleDateString()}`);
      if (data.stale) parts.push(`<span style="color:var(--pink);">offline — showing cached data</span>`);
      metaEl.innerHTML = parts.join(' · ');
    }

    deckRecsCache = data.cards || [];
    if (!deckRecsCache.length) {
      const msg = data.error
        ? escHtml(data.error)
        : (data.edhrec_total
            ? 'You already have every owned EDHREC recommendation in this deck (or none of them are in your collection yet).'
            : 'No recommendations found.');
      listEl.innerHTML = `<div style="padding:0.75rem;color:var(--text-muted);font-size:0.85rem;">${msg}</div>`;
      return;
    }

    const maxIncl = Math.max(...deckRecsCache.map(r => r.inclusion || 0), 0.0001);
    listEl.innerHTML = deckRecsCache.map((r, idx) => {
      const prints = r.printings || [];
      const selected = _resolveSelectedPrinting(r);
      const thumb = selected?.image_uri || r.image_uri || '';
      const syn = r.synergy;
      const synHtml = syn == null ? '' :
        `<span class="${syn > 0 ? 'rec-syn-pos' : 'rec-syn-neg'}" title="Synergy: how much more often this card appears with this commander than in other decks of its colours">${syn > 0 ? '+' : ''}${Math.round(syn * 100)}% syn</span>`;
      const picker = prints.length > 1 ? `
        <select class="filter-select rec-printing" data-rec-index="${idx}" style="padding:0.2rem 0.3rem;font-size:0.72rem;max-width:150px;">
          ${prints.map(p => `<option value="${p.id}" ${selected && String(p.id) === String(selected.id) ? 'selected' : ''}>${escHtml(_printingLabel(p))}</option>`).join('')}
        </select>` : '';
      const pool = r.in_other_decks > 0
        ? ` • <span title="Already used in ${r.in_other_decks} of your other deck(s) — SORTING pool candidate" style="color:var(--cyan);">⚡ in ${r.in_other_decks} deck${r.in_other_decks > 1 ? 's' : ''}</span>`
        : '';
      const nameHtml = r.edhrec_url
        ? `<a href="${escHtml(r.edhrec_url)}" target="_blank" rel="noopener" title="Open on EDHREC">${escHtml(r.name)}</a>`
        : escHtml(r.name);
      return `
      <div class="rec-row ${r.rank <= 10 ? 'rec-top' : ''}">
        <div class="rec-rank" title="Top-card rank among your owned recommendations">#${r.rank}</div>
        <img class="rec-thumb" src="${thumb}" alt="${escHtml(r.name)}" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="rec-main">
          <div class="rec-name">${nameHtml}</div>
          <div class="rec-sub">${escHtml(primaryType(r.type_line || ''))} • Owned ×${r.total_owned}${pool}</div>
          <div class="rec-sub" style="margin-top:0.15rem;">${r.mana_cost ? formatManaCost(r.mana_cost) : ''}</div>
        </div>
        <div class="rec-stats" title="${r.num_decks.toLocaleString()} of ${r.potential_decks.toLocaleString()} EDHREC decks">
          <div class="rec-bar"><span style="width:${Math.max(2, (r.inclusion / maxIncl) * 100)}%;"></span></div>
          <strong style="color:#fff;">${_fmtPct(r.inclusion)}</strong> of decks ${synHtml ? '· ' + synHtml : ''}
        </div>
        <div class="rec-actions">
          ${picker}
          <button class="btn btn-primary btn-sm" data-rec-add="${idx}">➕ Add</button>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.rec-printing').forEach(sel => {
      sel.addEventListener('change', () => {
        const r = deckRecsCache[Number(sel.dataset.recIndex)];
        if (!r) return;
        deckSelectedPrinting[r.name] = sel.value;
        const p = _resolveSelectedPrinting(r);
        const img = sel.closest('.rec-row')?.querySelector('.rec-thumb');
        if (img && p?.image_uri) { img.src = p.image_uri; img.style.visibility = ''; }
      });
    });
    listEl.querySelectorAll('[data-rec-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = deckRecsCache[Number(btn.dataset.recAdd)];
        if (!r) return;
        btn.disabled = true;
        btn.textContent = 'Adding…';
        const p = _resolveSelectedPrinting(r);
        await addCardToDeck(r.name,
          p ? { printingId: p.id } : null,
          { slot: 'mainboard', qty: 1, fromRecs: true });
        // Row is re-rendered on success; if the add failed, re-enable it
        if (btn.isConnected) { btn.disabled = false; btn.textContent = '➕ Add'; }
      });
    });
  } catch (e) {
    if (reqId !== deckRecsRequest) return;
    listEl.innerHTML = `<div style="padding:0.75rem;color:var(--pink);">Could not load recommendations: ${escHtml(e.message)}</div>`;
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

// Deck-list group for a type line. Order matters: "Artifact Creature" → Creature,
// "Artifact Land" → Land.
function primaryType(typeLine) {
  const order = ['Planeswalker', 'Battle', 'Creature', 'Land', 'Instant', 'Sorcery',
                 'Artifact', 'Enchantment'];
  for (const t of order) {
    if (typeLine.includes(t)) return t;
  }
  return 'Other';
}
