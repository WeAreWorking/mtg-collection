/**
 * SORTING Sleeve Marking & Modular Deck Builder — Local Client Engine
 * Local sleeve-marking tool for modular deck sorting.
 * Stores state in localStorage with 1-click sync to the local SQLite collection database.
 */

const SORTING_STORAGE_KEY = 'sorting_decks_data_v1';
const SORTING_MARKED_KEY = 'sorting_marked_cards_v1';
const SORTING_NAME_KEY = 'sorting_active_name_v1';

// Official SORTING Palette — 48 colours (up to 48 decks per sleeve,
// 96 with half-marks). Order interleaves hue families so
// sequentially-owned decks get maximally distinct colours.
const SORTING_PALETTE = [
  '#F44336', // Red
  '#2196F3', // Blue
  '#4CAF50', // Green
  '#FFEB3B', // Yellow
  '#9C27B0', // Purple
  '#FF9800', // Orange
  '#E91E63', // Pink
  '#00BCD4', // Cyan
  '#673AB7', // Deep Purple
  '#03A9F4', // Light Blue
  '#009688', // Teal
  '#8BC34A', // Light Green
  '#3F51B5', // Indigo
  '#CDDC39', // Lime
  '#FFC107', // Amber
  '#000000', // Black
  '#FFFFFF', // White
  '#9E9E9E', // Grey
  '#D32F2F', // Dark Red
  '#1976D2', // Dark Blue
  '#388E3C', // Dark Green
  '#FBC02D', // Dark Yellow (golden-yellow)
  '#7B1FA2', // Dark Purple
  '#F57C00', // Dark Orange
  '#C2185B', // Dark Pink
  '#0097A7', // Dark Cyan
  '#512DA8', // Dark Deep Purple
  '#0288D1', // Dark Light Blue
  '#00796B', // Dark Teal
  '#689F38', // Dark Light Green
  '#303F9F', // Dark Indigo
  '#AFB42B', // Dark Lime
  '#FFA000', // Dark Amber
  '#E57373', // Light Red
  '#64B5F6', // Light Blue 300
  '#81C784', // Light Green 300
  '#FFF176', // Light Yellow
  '#BA68C8', // Light Purple
  '#FFB74D', // Light Orange
  '#F06292', // Light Pink
  '#4DD0E1', // Light Cyan
  '#9575CD', // Light Deep Purple
  '#4FC3F7', // Light Sky Blue
  '#4DB6AC', // Light Teal
  '#AED581', // Light Lime Green
  '#7986CB', // Light Indigo
  '#DCE775', // Light Lime
  '#FFD54F', // Light Amber
];

let sortingState = {
  name: localStorage.getItem(SORTING_NAME_KEY) || 'My SORTING Container',
  decks: [],
  marked: JSON.parse(localStorage.getItem(SORTING_MARKED_KEY) || '{}'),
  activeTab: 'decks',
  activeFilter: 'all', // 'all', 'shared', 'undone'
  searchQuery: '',
  scryIndex: 0,
};

// ── Initialization ────────────────────────────────────────────────────────────
function initSortingApp() {
  loadSortingState();
  bindSortingEvents();
  renderSortingUI();
}

function loadSortingState() {
  const savedDecks = localStorage.getItem(SORTING_STORAGE_KEY);
  if (savedDecks) {
    try {
      sortingState.decks = JSON.parse(savedDecks);
    } catch (e) {
      sortingState.decks = [];
    }
  }
}

function saveSortingState() {
  localStorage.setItem(SORTING_STORAGE_KEY, JSON.stringify(sortingState.decks));
  localStorage.setItem(SORTING_MARKED_KEY, JSON.stringify(sortingState.marked));
  localStorage.setItem(SORTING_NAME_KEY, sortingState.name);
}

// ── Event Handlers ────────────────────────────────────────────────────────────
function bindSortingEvents() {
  // Title editing
  const titleInput = document.getElementById('sorting-title-input');
  if (titleInput) {
    titleInput.value = sortingState.name;
    titleInput.addEventListener('input', (e) => {
      sortingState.name = e.target.value.trim() || 'My SORTING Container';
      saveSortingState();
    });
  }

  // Tabs
  document.querySelectorAll('.sorting-tab-btn').forEach((btn) => {
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
  const btnExportJson = document.getElementById('btn-export-sorting-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', exportSortingBackup);
  }

  const btnImportJson = document.getElementById('btn-import-sorting-json');
  const fileInputJson = document.getElementById('sorting-json-file-input');
  if (btnImportJson && fileInputJson) {
    btnImportJson.addEventListener('click', () => fileInputJson.click());
    fileInputJson.addEventListener('change', importSortingBackup);
  }

  // Add Deck Form
  const addDeckForm = document.getElementById('sorting-add-deck-form');
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
  document.querySelectorAll('.sorting-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sorting-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sortingState.activeFilter = btn.dataset.filter;
      renderResults();
    });
  });

  const searchInput = document.getElementById('sorting-results-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      sortingState.searchQuery = e.target.value.toLowerCase().trim();
      renderResults();
    });
  }

  // Export CSV / Printable guide
  const btnCsv = document.getElementById('btn-export-sorting-csv');
  if (btnCsv) btnCsv.addEventListener('click', exportSortingCSV);

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
  sortingState.activeTab = tabName;
  document.querySelectorAll('.sorting-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.getElementById('sorting-panel-decks')?.classList.toggle('hidden', tabName !== 'decks');
  document.getElementById('sorting-panel-results')?.classList.toggle('hidden', tabName !== 'results');

  if (tabName === 'results') {
    renderResults();
  }
}

// ── Color Swatches ────────────────────────────────────────────────────────────
function sortingPaletteColor(deckIndex) {
  return SORTING_PALETTE[deckIndex % SORTING_PALETTE.length];
}

function renderColorSwatches() {
  const container = document.getElementById('sorting-swatches-container');
  if (!container) return;
  // Show slot numbers (1–48) so auto-assigned stripes can be found fast.
  container.innerHTML = SORTING_PALETTE.map((color, idx) => `
    <div class="sorting-color-swatch ${idx === 0 ? 'active' : ''}"
         style="background: ${color};"
         data-color="${color}"
         data-index="${idx}"
         title="Slot ${idx + 1} · ${color}"><span>${idx + 1}</span></div>
  `).join('');

  container.querySelectorAll('.sorting-color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      selectSwatchColor(swatch.dataset.color);
    });
  });
}

function selectSwatchColor(color) {
  const colorInput = document.getElementById('deck-color-input');
  if (colorInput) colorInput.value = color;

  document.querySelectorAll('.sorting-color-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color.toLowerCase() === color.toLowerCase());
  });
}

// ── 1-Click Database Sync ─────────────────────────────────────────────────────
async function loadDecksFromLocalDatabase() {
  const btn = document.getElementById('btn-load-from-db');
  if (btn) btn.textContent = '⏳ Loading from DB…';

  try {
    const res = await fetch('/api/sorting/sync-data');
    if (!res.ok) throw new Error('Failed to fetch from server');
    const data = await res.json();

    if (!data.decks || data.decks.length === 0) {
      alert('No decks found in your local collection database! You can import one using the Import tab.');
      return;
    }

    // Merge or replace
    const existingNames = new Set(sortingState.decks.map((d) => d.name.toLowerCase()));
    let addedCount = 0;

    data.decks.forEach((importedDeck) => {
      if (!existingNames.has(importedDeck.name.toLowerCase())) {
        sortingState.decks.push({
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

    saveSortingState();
    renderSortingUI();
    alert(`Successfully loaded ${addedCount} deck(s) from your local collection into SORTING!`);
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
  const color = colorInput?.value || sortingPaletteColor(sortingState.decks.length);
  const rawList = listInput.value.trim();

  if (!name || !rawList) {
    alert('Please provide a deck name and a list of cards.');
    return;
  }

  if (sortingState.decks.length + 1 > SORTING_PALETTE.length) {
    alert(`SORTING holds up to ${SORTING_PALETTE.length} distinct stripe colours. Deck ${(sortingState.decks.length + 1)} will reuse colour ${sortingPaletteColor(sortingState.decks.length)} — consider half-mark (dot-split) marking or a second sleeve set.`);
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

  sortingState.decks.push(newDeck);
  saveSortingState();

  // Reset form
  nameInput.value = '';
  if (commanderInput) commanderInput.value = '';
  listInput.value = '';

  renderSortingUI();
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
function computeSortingCardData() {
  const cardMap = new Map(); // cardName.toLowerCase() -> { name, quantity, deckIds: Set() }

  sortingState.decks.forEach((deck, deckIndex) => {
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
    const decksUsing = sortingState.decks.filter((d) => val.deckIds.has(d.id));
    cardsList.push({
      name: val.name,
      isPool: decksUsing.length >= 2,
      deckCount: decksUsing.length,
      decks: decksUsing,
      isMarked: !!sortingState.marked[val.name.toLowerCase()],
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
function renderSortingUI() {
  renderDecksList();
  renderResults();
  updateHeaderDeckCount();
}

function updateHeaderDeckCount() {
  const tag = document.getElementById('sorting-deck-count-badge');
  if (tag) {
    const count = sortingState.decks.length;
    const limit = SORTING_PALETTE.length;
    tag.textContent = `${count} / ${limit} deck${count !== 1 ? 's' : ''}`;
    tag.title = count > limit
      ? `SORTING holds ${limit} distinct stripe colours. Colours repeat beyond ${limit}.`
      : `${count} deck${count !== 1 ? 's' : ''} of ${limit} stripe colours`;
  }
}

function renderDecksList() {
  const container = document.getElementById('sorting-decks-list');
  if (!container) return;

  if (sortingState.decks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem; background: var(--bg-card); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1);">
        <p style="color: var(--text-muted); font-size: 1.1rem; margin-bottom: 1rem;">No decks in this SORTING yet.</p>
        <button class="btn btn-primary btn-sm" onclick="loadDecksFromLocalDatabase()">
          📥 Import Decks from Local Database
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="sorting-deck-grid">
      ${sortingState.decks.map((deck, idx) => `
        <div class="sorting-deck-card" style="--deck-color: ${deck.color};">
          <div class="sorting-deck-card-header">
            <span class="sorting-deck-name">${escapeHtml(deck.name)}</span>
            <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background:${deck.color}; box-shadow:0 0 6px ${deck.color}; border: 1px solid rgba(0,0,0,0.4);"></span>
          </div>
          <div class="sorting-deck-commander">
            <span>👑 ${escapeHtml(deck.commander || 'No commander listed')}</span>
          </div>
          <div class="sorting-deck-meta">
            <span>Slot: ${idx + 1 > SORTING_PALETTE.length ? `Dot-split · Slot ${(idx % SORTING_PALETTE.length) + 1}b` : `Slot ${idx + 1} / ${SORTING_PALETTE.length}`}</span>
            <span>•</span>
            <span>${deck.cards ? deck.cards.length : 0} cards</span>
          </div>
          <div class="sorting-deck-actions">
            <button class="btn btn-danger btn-sm" onclick="deleteSortingDeck('${deck.id}')">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
    ${sortingState.decks.length > SORTING_PALETTE.length ? `<p class="form-hint" style="margin-top:0.5rem;">⚠️ ${sortingState.decks.length - SORTING_PALETTE.length} deck(s) beyond ${SORTING_PALETTE.length} colours reuse a stripe. Keep this list to ${SORTING_PALETTE.length} or mark the extras as half-marks (dot splits).</p>` : ''}
  `;
}

function deleteSortingDeck(deckId) {
  if (!confirm('Are you sure you want to remove this deck from SORTING?')) return;
  sortingState.decks = sortingState.decks.filter((d) => d.id !== deckId);
  saveSortingState();
  renderSortingUI();
}

function renderResults() {
  const cards = computeSortingCardData();

  // Filter
  let filtered = cards;
  if (sortingState.activeFilter === 'shared') {
    filtered = filtered.filter((c) => c.isPool);
  } else if (sortingState.activeFilter === 'undone') {
    filtered = filtered.filter((c) => !c.isMarked);
  }

  if (sortingState.searchQuery) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(sortingState.searchQuery));
  }

  // Update Stats
  const statTotal = document.getElementById('stat-sorting-total');
  const statShared = document.getElementById('stat-sorting-shared');
  const statMarked = document.getElementById('stat-sorting-marked');

  const totalCards = cards.length;
  const poolCards = cards.filter((c) => c.isPool).length;
  const markedCards = cards.filter((c) => c.isMarked).length;

  if (statTotal) statTotal.textContent = totalCards;
  if (statShared) statShared.textContent = poolCards;
  if (statMarked) statMarked.textContent = `${markedCards} / ${totalCards}`;

  // Render Overlap Matrix
  renderOverlapMatrix();

  // Render Table
  const tbody = document.getElementById('sorting-results-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">No cards match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((card) => {
    const key = card.name.toLowerCase();
    const isDone = !!sortingState.marked[key];

    // Build sleeve preview (adaptive: slots shrink as deck count grows to 48)
    const deckCount = sortingState.decks.length;
    const slotW = deckCount > 36 ? 5 : deckCount > 24 ? 7 : deckCount > 12 ? 9 : 12;
    const sleeveSlotsHtml = sortingState.decks.map((deck, deckIdx) => {
      const active = card.decks.some((d) => d.id === deck.id);
      return `<div class="sleeve-slot ${active ? 'active' : ''}" style="width:${slotW}px;${active ? `background:${deck.color}; box-shadow: 0 0 6px ${deck.color};` : ''}" title="Slot ${deckIdx + 1} · ${escapeHtml(deck.name)}${active ? ' · ' + deck.color : ''}"></div>`;
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
            ${card.isPool ? '<span class="badge badge-sorting" style="margin-left: 6px;">⚡ Pool</span>' : ''}
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
    sortingState.marked[key] = true;
  } else {
    delete sortingState.marked[key];
  }
  saveSortingState();
  renderResults();
}

// ── Overlap Matrix ────────────────────────────────────────────────────────────
function renderOverlapMatrix() {
  const container = document.getElementById('sorting-overlap-matrix');
  if (!container || sortingState.decks.length < 2) {
    if (container) container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Add 2 or more decks to calculate the overlap matrix.</p>';
    return;
  }

  const decks = sortingState.decks;
  let html = '<table class="sorting-matrix-table"><thead><tr><th>Deck</th>';

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
        html += `<td class="${shared > 0 ? 'sorting-matrix-cell-shared' : ''}">${shared}</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Export Features ───────────────────────────────────────────────────────────
function exportSortingBackup() {
  const backup = {
    version: '1.0',
    date: new Date().toISOString(),
    name: sortingState.name,
    decks: sortingState.decks,
    marked: sortingState.marked,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sorting-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSortingBackup(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.decks && Array.isArray(data.decks)) {
        sortingState.decks = data.decks;
        sortingState.name = data.name || sortingState.name;
        sortingState.marked = data.marked || {};
        saveSortingState();
        renderSortingUI();
        alert('SORTING backup restored successfully!');
      } else {
        alert('Invalid SORTING JSON file format.');
      }
    } catch (err) {
      alert('Error parsing JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportSortingCSV() {
  const cards = computeSortingCardData();
  let csv = 'Card Name,Type,Decks Count,Decks,Marked\n';
  cards.forEach((c) => {
    const deckNames = c.decks.map((d) => d.name).join('; ');
    csv += `"${c.name}","${c.isPool ? 'Pool' : 'Core'}",${c.deckCount},"${deckNames}","${c.isMarked ? 'Yes' : 'No'}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sorting-marking-guide.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── SCRY-Mode ─────────────────────────────────────────────────────────────────
function launchScryMode() {
  const cards = computeSortingCardData();
  if (cards.length === 0) {
    alert('No cards available to mark.');
    return;
  }
  sortingState.scryCards = cards.filter((c) => !c.isMarked);
  if (sortingState.scryCards.length === 0) {
    sortingState.scryCards = cards; // fall back to all if all marked
  }
  sortingState.scryIndex = 0;

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
  const card = sortingState.scryCards[sortingState.scryIndex];
  if (!card) {
    closeScryMode();
    alert('Marking session complete!');
    return;
  }

  const nameEl = document.getElementById('scry-card-name');
  const progressEl = document.getElementById('scry-progress-text');
  const stripesEl = document.getElementById('scry-stripes-display');

  if (nameEl) nameEl.textContent = card.name;
  if (progressEl) progressEl.textContent = `Card ${sortingState.scryIndex + 1} of ${sortingState.scryCards.length}`;

  if (stripesEl) {
    const deckCount = sortingState.decks.length;
    const stripeW = deckCount > 36 ? 10 : deckCount > 24 ? 14 : deckCount > 12 ? 18 : 22;
    stripesEl.innerHTML = sortingState.decks.map((deck, deckIdx) => {
      const active = card.decks.some((d) => d.id === deck.id);
      return `
        <div class="scry-stripe-item" style="display:flex; flex-direction:column; align-items:center; gap: 0.5rem;">
          <div style="width: ${stripeW}px; height: 50px; border-radius: 4px; background: ${active ? deck.color : 'rgba(255,255,255,0.06)'}; box-shadow: ${active ? `0 0 12px ${deck.color}` : 'none'};"></div>
          <span class="scry-stripe-label" style="font-size: 0.75rem; color: ${active ? '#fff' : 'var(--text-dim)'};">${deckIdx + 1} · ${escapeHtml(deck.name)}</span>
        </div>
      `;
    }).join('');
  }
}

function handleScryDone() {
  const card = sortingState.scryCards[sortingState.scryIndex];
  if (card) {
    sortingState.marked[card.name.toLowerCase()] = true;
    saveSortingState();
  }
  sortingState.scryIndex++;
  renderScryCard();
}

function handleScrySkip() {
  sortingState.scryIndex++;
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
  if (document.getElementById('sorting-builder-container')) {
    initSortingApp();
  }
});
