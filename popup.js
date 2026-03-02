const titleInput = document.getElementById('titleInput');
const textInput = document.getElementById('textInput');
const langSelect = document.getElementById('langSelect');
const speedSelect = document.getElementById('speedSelect');
const generateBtn = document.getElementById('generateBtn');
const clearBtn = document.getElementById('clearBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const statusEl = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const charCount = document.getElementById('charCount');
const chunkCount = document.getElementById('chunkCount');
const historyList = document.getElementById('historyList');
const player = document.getElementById('player');

const HISTORY_KEY = 'ttsMp3History';
const MAX_CHARS_PER_CHUNK = 180;
const MAX_HISTORY = 50;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#fb7185' : '#9fb0d9';
}

function updateCounts() {
  const text = textInput.value;
  const chunks = splitTextIntoChunks(text);
  charCount.textContent = `${text.length} caracteres`;
  chunkCount.textContent = `${chunks.length} bloques`;
}

function slugify(value) {
  return (value || 'audio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'audio';
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-ES');
}

function splitTextIntoChunks(text) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  const chunks = [];
  let current = '';

  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.trim();
    if (!sentence) continue;

    if (sentence.length > MAX_CHARS_PER_CHUNK) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      let remaining = sentence;
      while (remaining.length > MAX_CHARS_PER_CHUNK) {
        let cut = remaining.lastIndexOf(' ', MAX_CHARS_PER_CHUNK);
        if (cut < 40) cut = MAX_CHARS_PER_CHUNK;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) chunks.push(remaining);
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= MAX_CHARS_PER_CHUNK) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

async function fetchChunkMp3(chunk, lang, speed) {
  const params = new URLSearchParams({
    ie: 'UTF-8',
    client: 'tw-ob',
    tl: lang,
    ttsspeed: String(speed),
    q: chunk
  });

  const urls = [
    `https://translate.google.com/translate_tts?${params.toString()}`,
    `https://translate.googleapis.com/translate_tts?${params.toString()}`
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'audio/mpeg,audio/*,*/*'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('No se pudo descargar el audio.');
}

function combineMp3Parts(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return new Blob([combined], { type: 'audio/mpeg' });
}

async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

async function saveHistoryItem(item) {
  const history = await getHistory();
  history.unshift(item);
  const trimmed = history.slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  await renderHistory();
}

async function deleteHistoryItem(id) {
  const history = await getHistory();
  const filtered = history.filter(item => item.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: filtered });
  await renderHistory();
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  await renderHistory();
}

async function renderHistory() {
  const history = await getHistory();
  historyList.innerHTML = '';

  if (!history.length) {
    historyList.className = 'history empty';
    historyList.textContent = 'Todavía no has generado ningún MP3.';
    return;
  }

  historyList.className = 'history';

  for (const item of history) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-name">${escapeHtml(item.filename)}</div>
          <div class="item-meta">
            ${item.chars} caracteres · ${item.chunks} bloques · ${item.lang.toUpperCase()}<br>
            ${formatDate(item.createdAt)}
          </div>
        </div>
      </div>
      <div class="item-actions">
        <button class="ghost small copy-btn" data-name="${escapeAttr(item.filename)}">Copiar nombre</button>
        <button class="ghost small refill-btn" data-preview="${escapeAttr(item.preview || '')}">Pegar avance</button>
        <button class="ghost small danger delete-btn" data-id="${escapeAttr(item.id)}">Borrar</button>
      </div>
    `;
    historyList.appendChild(div);
  }

  historyList.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(btn.dataset.name || '');
      setStatus('Nombre copiado al portapapeles.');
    });
  });

  historyList.querySelectorAll('.refill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      textInput.value = btn.dataset.preview || '';
      updateCounts();
      setStatus('He pegado un avance del texto guardado.');
    });
  });

  historyList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteHistoryItem(btn.dataset.id);
      setStatus('Elemento eliminado del historial.');
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#96;');
}

async function generateMp3() {
  const text = textInput.value.trim();
  const lang = langSelect.value;
  const speed = speedSelect.value;

  if (!text) {
    setStatus('Pega un texto antes de generar el audio.', true);
    return;
  }

  const chunks = splitTextIntoChunks(text);
  if (!chunks.length) {
    setStatus('No he podido dividir el texto.', true);
    return;
  }

  const baseName = slugify(titleInput.value || text.slice(0, 40));
  const fileName = `${baseName}-${Date.now()}.mp3`;

  generateBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  player.classList.add('hidden');
  player.removeAttribute('src');

  try {
    setStatus(`Generando ${chunks.length} bloque(s)...`);

    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      setStatus(`Descargando bloque ${i + 1} de ${chunks.length}...`);
      const part = await fetchChunkMp3(chunks[i], lang, speed);
      parts.push(part);
      progressBar.style.width = `${Math.round(((i + 1) / chunks.length) * 100)}%`;
    }

    const blob = combineMp3Parts(parts);
    const objectUrl = URL.createObjectURL(blob);

    player.src = objectUrl;
    player.classList.remove('hidden');

    await chrome.downloads.download({
      url: objectUrl,
      filename: `tts-mp3/${fileName}`,
      saveAs: false
    });

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

    await saveHistoryItem({
      id: crypto.randomUUID(),
      filename: fileName,
      createdAt: new Date().toISOString(),
      chars: text.length,
      chunks: chunks.length,
      lang,
      preview: text.slice(0, 500)
    });

    setStatus('MP3 generado y descargado. También se ha añadido al historial.');
  } catch (err) {
    console.error(err);
    setStatus('No se pudo generar el MP3. Si falla, prueba con menos texto o cambia de idioma.', true);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener('click', generateMp3);
clearBtn.addEventListener('click', () => {
  titleInput.value = '';
  textInput.value = '';
  updateCounts();
  setStatus('Campos limpiados.');
});
clearHistoryBtn.addEventListener('click', async () => {
  await clearHistory();
  setStatus('Historial vaciado.');
});
textInput.addEventListener('input', updateCounts);

document.addEventListener('DOMContentLoaded', async () => {
  updateCounts();
  await renderHistory();
});
