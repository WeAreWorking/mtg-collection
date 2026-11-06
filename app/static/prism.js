/**
 * PRISM Sleeve Marking & Modular Deck Builder — Local Client Engine
 * Mirrors the functionality of https://prismmtg.com/build.html
 * Stores state in localStorage with 1-click sync to the local SQLite collection database.
 */

const PRISM_STORAGE_KEY = 'prism_decks_data_v1';
const PRISM_MARKED_KEY = 'prism_marked_cards_v1';
const PRISM_NAME_KEY = 'prism_active_name_v1';

// Official PRISM Palette
const PRISM_PALETTE = [
  '#EEB41B', // Yellow
  '#E54D2E', // Orange-Red
  '#3E63DD', // Blue
  '#46A758', // Green
  '#AB4ABA', // Magenta
  '#00A2C7', // Cyan
  '#F76B15', // Amber
  '#9E5CF2', // Purple
  '#FFDC00', // Gold
  '#2B9A66', // Emerald
];

let prismState = {
  name: localStorage.getItem(PRISM_NAME_KEY) || 'My PRISM Container',
  decks: [],
  marked: JSON.parse(localStorage.getItem(PRISM_MARKED_KEY) || '{}'),
  activeTab: 'decks',
  activeFilter: 'all', // 'all', 'shared', 'undone'
  searchQuery: '',
  scryIndex: 0,
};

// ── Initialization ────────────────────────────────────────────────────────────
function initPrismApp() {
  loadPrismState();
  bindPrismEvents();
  renderPrismUI();
}

function loadPrismState() {
  const savedDecks = localStorage.getItem(PRISM_STORAGE_KEY);
  if (savedDecks) {
    try {
      prismState.decks = JSON.parse(savedDecks);
    } catch (e) {
      prismState.decks = [];
    }
  }
}

function savePrismState() {
  localStorage.setItem(PRISM_STORAGE_KEY, JSON.stringify(prismState.decks));
  localStorage.setItem(PRISM_MARKED_KEY, JSON.stringify(prismState.marked));
  localStorage.setItem(PRISM_NAME_KEY, prismState.name);
}

// ── Event Handlers ────────────────────────────────────────────────────────────
function bindPrismEvents() {
  // Title editing
  const titleInput = document.getElementById('prism-title-input');
  if (titleInput) {
    titleInput.value = prismState.name;
    titleInput.addEventListener('input', (e) => {
      prismState.name = e.target.value.trim() || 'My PRISM Container';
      savePrismState();
    });
  }

  // Tabs
  document.querySelectorAll('.prism-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Load from local DB
  const btnLoadDb = document.getElementById('btn-load-from-db');
  if (btnLoadDb) {
    btnLoadDb.addEventListener('click', loadDecksFromLocalDatabase);
  }

  // Export & Import backup JSON
  const btnExportJson = document.getElementById('btn-export-prism-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', exportPrismBackup);
  }

  const btnImportJson = document.getElementById('btn-import-prism-json');
  const fileInputJson = document.getElementById('prism-json-file-input');
  if (btnImportJson && fileInputJson) {
    btnImportJson.addEventListener('click', () => fileInputJson.click());
    fileInputJson.addEventListener('change', importPrismBackup);
  }

  // Add Deck Form
  const addDeckForm = document.getElementById('prism-add-deck-form');
  if (addDeckForm) {
    addDeckForm.addEventListener('submit', handleAddDeck);
  }

  // Swatches
  renderColorSwatches();

  // Color picker sync
  const colorInput = document.getElementById('deck-color-input');
  if (colorInput) {
    colorInput.addEventListener('input', (e) => {
      selectSwatchColor(e.target.value);
    });
  }

  // File drag & drop or selection
  const deckFileInput = document.getElementById('deck-file-picker');
  if (deckFileInput) {
    deckFileInput.addEventListener('change', handleDeckFileUpload);
  }

  // Moxfield / Archidekt Import
  const btnImportUrl = document.getElementById('btn-import-deck-url');
  if (btnImportUrl) {
    btnImportUrl.addEventListener('click', handleUrlImport);
  }

  // Filters & Search
  document.querySelectorAll('.prism-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.prism-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      prismState.activeFilter = btn.dataset.filter;
      renderResults();
    });
  });

  const searchInput = document.getElementById('prism-results-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      prismState.searchQuery = e.target.value.toLowerCase().trim();
      renderResults();
    });
  }

  // Export CSV / Printable guide
  const btnCsv = document.getElementById('btn-export-prism-csv');
  if (btnCsv) btnCsv.addEventListener('click', exportPrismCSV);

  const btnPrint = document.getElementById('btn-print-guide');
  if (btnPrint) btnPrint.addEventListener('click', () => window.print());

  // SCRY-Mode
  const btnScry = document.getElementById('btn-launch-scry');
  if (btnScry) btnScry.addEventListener('click', launchScryMode);

  const btnScryClose = document.getElementById('btn-scry-close');
  if (btnScryClose) btnScryClose.addEventListener('click', closeScryMode);

  const btnScryDone = document.getElementById('btn-scry-done');
  if (btnScryDone) btnScryDone.addEventListener('click', handleScryDone);

  const btnScrySkip = document.getElementById('btn-scry-skip');
  if (btnScrySkip) btnScrySkip.addEventListener('click', handleScrySkip);
}

function switchTab(tabName) {
  prismState.activeTab = tabName;
  document.querySelectorAll('.prism-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.getElementById('prism-panel-decks')?.classList.toggle('hidden', tabName !== 'decks');
  document.getElementById('prism-panel-results')?.classList.toggle('hidden', tabName !== 'results');

  if (tabName === 'results') {
    renderResults();
  }
}

// ── Color Swatches ────────────────────────────────────────────────────────────
function renderColorSwatches() {
  const container = document.getElementById('prism-swatches-container');
  if (!container) return;
  container.innerHTML = PRISM_PALETTE.map((color, idx) => `
    <div class="prism-color-swatch ${idx === 0 ? 'active' : ''}"
         style="background: ${color};"
         data-color="${color}"
         title="${color}"></div>
  `).join('');

  container.querySelectorAll('.prism-color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      selectSwatchColor(swatch.dataset.color);
    });
  });
}

function selectSwatchColor(color) {
  const colorInput = document.getElementById('deck-color-input');
  if (colorInput) colorInput.value = color;

  document.querySelectorAll('.prism-color-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color.toLowerCase() === color.toLowerCase());
  });
}

// ── 1-Click Database Sync ─────────────────────────────────────────────────────
async function loadDecksFromLocalDatabase() {
  const btn = document.getElementById('btn-load-from-db');
  if (btn) btn.textContent = '⏳ Loading from DB…';

  try {
    const res = await fetch('/api/prism/sync-data');
    if (!res.ok) throw new Error('Failed to fetch from server');
    const data = await res.json();

    if (!data.decks || data.decks.length === 0) {
      alert('No decks found in your local collection database! You can import one using the Import tab.');
      return;
    }

    // Merge or replace
    const existingNames = new Set(prismState.decks.map((d) => d.name.toLowerCase()));
    let addedCount = 0;

    data.decks.forEach((importedDeck) => {
      if (!existingNames.has(importedDeck.name.toLowerCase())) {
        prismState.decks.push({
          id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          name: importedDeck.name,
          commander: importedDeck.commander || '',
          bracket: 2,
          color: importedDeck.color,
          cardList: importedDeck.list,
          cards: parseRawDecklist(importedDeck.list),
        });
        addedCount++;
      }
    });

    savePrismState();
    renderPrismUI();
    alert(`Successfully loaded ${addedCount} deck(s) from your local collection into PRISM!`);
  } catch (err) {
    alert('Error loading decks: ' + err.message);
  } finally {
    if (btn) btn.textContent = '📥 Load from Local Collection';
  }
}

// ── Deck Parsing ──────────────────────────────────────────────────────────────
function parseRawDecklist(rawText) {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const cards = [];

  const lineRegex = /^(\d+)x?\s+(.+?)(?:\s+\([A-Za-z0-9]+\))?(?:\s+\S+)?\s*$/i;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return;

    // Remove foil tags
    const clean = trimmed.replace(/\*F\*|\[foil\]/gi, '').trim();
    const match = lineRegex.exec(clean);
    if (match) {
      cards.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim(),
      });
    } else {
      // Fallback: 1 copy
      cards.push({ quantity: 1, name: clean });
    }
  });

  return cards;
}

// ── Deck Form Actions ─────────────────────────────────────────────────────────
function handleAddDeck(e) {
  e.preventDefault();

  const nameInput = document.getElementById('deck-name-input');
  const commanderInput = document.getElementById('deck-commander-input');
  const colorInput = document.getElementById('deck-color-input');
  const listInput = document.getElementById('deck-list-textarea');

  const name = nameInput.value.trim();
  const commander = commanderInput?.value.trim() || '';
  const color = colorInput?.value || PRISM_PALETTE[prismState.decks.length % PRISM_PALETTE.length];
  const rawList = listInput.value.trim();

  if (!name || !rawList) {
    alert('Please provide a deck name and a list of cards.');
    return;
  }

  const parsedCards = parseRawDecklist(rawList);

  const newDeck = {
    id: 'deck_' + Date.now(),
    name: name,
    commander: commander,
    bracket: 2,
    color: color,
    cardList: rawList,
    cards: parsedCards,
  };

  prismState.decks.push(newDeck);
  savePrismState();

  // Reset form
  nameInput.value = '';
  if (commanderInput) commanderInput.value = '';
  listInput.value = '';

  renderPrismUI();
}

function handleDeckFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const textarea = document.getElementById('deck-list-textarea');
    if (textarea) textarea.value = event.target.result;
  };
  reader.readAsText(file);
}

async function handleUrlImport() {
  const urlInput = document.getElementById('deck-url-import-input');
  const url = urlInput?.value.trim();
  if (!url) return;

  const btn = document.getElementById('btn-import-deck-url');
  if (btn) btn.textContent = 'Importing…';

  try {
    const res = await fetch('/api/import/deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: url, name: '', add_to_collection: false }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Auto-populate form
    if (data.deck_name) {
      document.getElementById('deck-name-input').value = data.deck_name;
    }
    if (data.commander) {
      document.getElementById('deck-commander-input').value = data.commander;
    }
    // Re-load decks from collection if added
    await loadDecksFromLocalDatabase();
    urlInput.value = '';
  } catch (err) {
    alert('Could not import URL: ' + err.message);
  } finally {
    if (btn) btn.textContent = 'Import URL';
  }
}

// ── Overlap & Slot Calculation ────────────────────────────────────────────────
function computePrismCardData() {
  const cardMap = new Map(); // cardName.toLowerCase() -> { name, quantity, deckIds: Set() }

  prismState.decks.forEach((deck, deckIndex) => {
    deck.cards.forEach((c) => {
      const key = c.name.toLowerCase();
      if (!cardMap.has(key)) {
        cardMap.set(key, {
          name: c.name,
          quantity: c.quantity,
          deckIds: new Set(),
        });
      }
      cardMap.get(key).deckIds.add(deck.id);
    });
  });

  const cardsList = [];
  cardMap.forEach((val) => {
    const decksUsing = prismState.decks.filter((d) => val.deckIds.has(d.id));
    cardsList.push({
      name: val.name,
      isPool: decksUsing.length >= 2,
      deckCount: decksUsing.length,
      decks: decksUsing,
      isMarked: !!prismState.marked[val.name.toLowerCase()],
    });
  });

  // Sort by pool first, then alphabetical
  cardsList.sort((a, b) => {
    if (a.isPool && !b.isPool) return -1;
    if (!a.isPool && b.isPool) return 1;
    return a.name.localeCompare(b.name);
  });

  return cardsList;
}

// ── UI Rendering ──────────────────────────────────────────────────────────────
function renderPrismUI() {
  renderDecksList();
  renderResults();
  updateHeaderDeckCount();
}

function updateHeaderDeckCount() {
  const tag = document.getElementById('prism-deck-count-badge');
  if (tag) {
    const count = prismState.decks.length;
    tag.textContent = `${count} deck${count !== 1 ? 's' : ''}`;
  }
}

function renderDecksList() {
  const container = document.getElementById('prism-decks-list');
  if (!container) return;

  if (prismState.decks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem; background: var(--bg-card); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1);">
        <p style="color: var(--text-muted); font-size: 1.1rem; margin-bottom: 1rem;">No decks in this PRISM yet.</p>
        <button class="btn btn-primary btn-sm" onclick="loadDecksFromLocalDatabase()">
          📥 Import Decks from Local Database
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="prism-deck-grid">
      ${prismState.decks.map((deck, idx) => `
        <div class="prism-deck-card" style="--deck-color: ${deck.color};">
          <div class="prism-deck-card-header">
            <span class="prism-deck-name">${escapeHtml(deck.name)}</span>
            <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background:${deck.color}; box-shadow:0 0 6px ${deck.color};"></span>
          </div>
          <div class="prism-deck-commander">
            <span>👑 ${escapeHtml(deck.commander || 'No commander listed')}</span>
          </div>
          <div class="prism-deck-meta">
            <span>Slot: Side A · Slot ${idx + 1}</span>
            <span>•</span>
            <span>${deck.cards ? deck.cards.length : 0} cards</span>
          </div>
          <div class="prism-deck-actions">
            <button class="btn btn-danger btn-sm" onclick="deletePrismDeck('${deck.id}')">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function deletePrismDeck(deckId) {
  if (!confirm('Are you sure you want to remove this deck from PRISM?')) return;
  prismState.decks = prismState.decks.filter((d) => d.id !== deckId);
  savePrismState();
  renderPrismUI();
}

function renderResults() {
  const cards = computePrismCardData();

  // Filter
  let filtered = cards;
  if (prismState.activeFilter === 'shared') {
    filtered = filtered.filter((c) => c.isPool);
  } else if (prismState.activeFilter === 'undone') {
    filtered = filtered.filter((c) => !c.isMarked);
  }

  if (prismState.searchQuery) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(prismState.searchQuery));
  }

  // Update Stats
  const statTotal = document.getElementById('stat-prism-total');
  const statShared = document.getElementById('stat-prism-shared');
  const statMarked = document.getElementById('stat-prism-marked');

  const totalCards = cards.length;
  const poolCards = cards.filter((c) => c.isPool).length;
  const markedCards = cards.filter((c) => c.isMarked).length;

  if (statTotal) statTotal.textContent = totalCards;
  if (statShared) statShared.textContent = poolCards;
  if (statMarked) statMarked.textContent = `${markedCards} / ${totalCards}`;

  // Render Overlap Matrix
  renderOverlapMatrix();

  // Render Table
  const tbody = document.getElementById('prism-results-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">No cards match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((card) => {
    const key = card.name.toLowerCase();
    const isDone = !!prismState.marked[key];

    // Build sleeve preview
    const sleeveSlotsHtml = prismState.decks.map((deck) => {
      const active = card.decks.some((d) => d.id === deck.id);
      return `<div class="sleeve-slot ${active ? 'active' : ''}" style="${active ? `background:${deck.color}; box-shadow: 0 0 6px ${deck.color};` : ''}" title="${deck.name}"></div>`;
    }).join('');

    const deckBadges = card.decks.map((d) => `
      <span class="badge" style="background: rgba(255,255,255,0.08); border-left: 3px solid ${d.color}; font-size: 0.75rem;">
        ${escapeHtml(d.name)}
      </span>
    `).join(' ');

    return `
      <tr class="${isDone ? 'is-done' : ''}">
        <td style="width: 45px; text-align: center;">
          <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleCardMarked('${escapeJs(card.name)}', this.checked)" style="transform: scale(1.2); cursor: pointer;" />
        </td>
        <td>
          <div class="card-name-text" style="font-weight: 600; font-size: 0.95rem;">
            ${escapeHtml(card.name)}
            ${card.isPool ? '<span class="badge badge-prism" style="margin-left: 6px;">⚡ Pool</span>' : ''}
          </div>
          <div style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
            ${deckBadges}
          </div>
        </td>
        <td style="width: 180px;">
          <div class="sleeve-preview" title="Sleeve edge marks">${sleeveSlotsHtml}</div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleCardMarked(cardName, isChecked) {
  const key = cardName.toLowerCase();
  if (isChecked) {
    prismState.marked[key] = true;
  } else {
    delete prismState.marked[key];
  }
  savePrismState();
  renderResults();
}

// ── Overlap Matrix ────────────────────────────────────────────────────────────
function renderOverlapMatrix() {
  const container = document.getElementById('prism-overlap-matrix');
  if (!container || prismState.decks.length < 2) {
    if (container) container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Add 2 or more decks to calculate the overlap matrix.</p>';
    return;
  }

  const decks = prismState.decks;
  let html = '<table class="prism-matrix-table"><thead><tr><th>Deck</th>';

  decks.forEach((d) => {
    html += `<th><span style="color:${d.color}">●</span> ${escapeHtml(d.name)}</th>`;
  });
  html += '</tr></thead><tbody>';

  decks.forEach((d1) => {
    html += `<tr><td style="text-align: left; font-weight:600;"><span style="color:${d1.color}">●</span> ${escapeHtml(d1.name)}</td>`;
    const d1Cards = new Set(d1.cards.map((c) => c.name.toLowerCase()));

    decks.forEach((d2) => {
      if (d1.id === d2.id) {
        html += `<td style="color: var(--text-dim); background: rgba(0,0,0,0.2);">${d1.cards.length}</td>`;
      } else {
        const shared = d2.cards.filter((c) => d1Cards.has(c.name.toLowerCase())).length;
        html += `<td class="${shared > 0 ? 'prism-matrix-cell-shared' : ''}">${shared}</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Export Features ───────────────────────────────────────────────────────────
function exportPrismBackup() {
  const backup = {
    version: '1.0',
    date: new Date().toISOString(),
    name: prismState.name,
    decks: prismState.decks,
    marked: prismState.marked,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prism-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPrismBackup(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.decks && Array.isArray(data.decks)) {
        prismState.decks = data.decks;
        prismState.name = data.name || prismState.name;
        prismState.marked = data.marked || {};
        savePrismState();
        renderPrismUI();
        alert('PRISM backup restored successfully!');
      } else {
        alert('Invalid PRISM JSON file format.');
      }
    } catch (err) {
      alert('Error parsing JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportPrismCSV() {
  const cards = computePrismCardData();
  let csv = 'Card Name,Type,Decks Count,Decks,Marked\n';
  cards.forEach((c) => {
    const deckNames = c.decks.map((d) => d.name).join('; ');
    csv += `"${c.name}","${c.isPool ? 'Pool' : 'Core'}",${c.deckCount},"${deckNames}","${c.isMarked ? 'Yes' : 'No'}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prism-marking-guide.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── SCRY-Mode ─────────────────────────────────────────────────────────────────
function launchScryMode() {
  const cards = computePrismCardData();
  if (cards.length === 0) {
    alert('No cards available to mark.');
    return;
  }
  prismState.scryCards = cards.filter((c) => !c.isMarked);
  if (prismState.scryCards.length === 0) {
    prismState.scryCards = cards; // fall back to all if all marked
  }
  prismState.scryIndex = 0;

  const overlay = document.getElementById('scry-mode-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    renderScryCard();
  }
}

function closeScryMode() {
  document.getElementById('scry-mode-overlay')?.classList.add('hidden');
  renderResults();
}

function renderScryCard() {
  const card = prismState.scryCards[prismState.scryIndex];
  if (!card) {
    closeScryMode();
    alert('Marking session complete!');
    return;
  }

  const nameEl = document.getElementById('scry-card-name');
  const progressEl = document.getElementById('scry-progress-text');
  const stripesEl = document.getElementById('scry-stripes-display');

  if (nameEl) nameEl.textContent = card.name;
  if (progressEl) progressEl.textContent = `Card ${prismState.scryIndex + 1} of ${prismState.scryCards.length}`;

  if (stripesEl) {
    stripesEl.innerHTML = prismState.decks.map((deck) => {
      const active = card.decks.some((d) => d.id === deck.id);
      return `
        <div style="display:flex; flex-direction:column; align-items:center; gap: 0.5rem;">
          <div style="width: 22px; height: 50px; border-radius: 4px; background: ${active ? deck.color : 'rgba(255,255,255,0.06)'}; box-shadow: ${active ? `0 0 12px ${deck.color}` : 'none'};"></div>
          <span style="font-size: 0.75rem; color: ${active ? '#fff' : 'var(--text-dim)'};">${escapeHtml(deck.name)}</span>
        </div>
      `;
    }).join('');
  }
}

function handleScryDone() {
  const card = prismState.scryCards[prismState.scryIndex];
  if (card) {
    prismState.marked[card.name.toLowerCase()] = true;
    savePrismState();
  }
  prismState.scryIndex++;
  renderScryCard();
}

function handleScrySkip() {
  prismState.scryIndex++;
  renderScryCard();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJs(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'");
}

// Auto-run if container present
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('prism-builder-container')) {
    initPrismApp();
  }
});
