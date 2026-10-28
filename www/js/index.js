import { db, trainsDb, publicDb } from '../firebase-config.js';
import { collection, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

if (!window.APP_VERSION) window.APP_VERSION = 'v1.0.0';

window.showGlobalProgress = function() {
    const el = document.getElementById('global-progress-bar');
    if (el) el.style.display = 'block';
};
window.hideGlobalProgress = function() {
    const el = document.getElementById('global-progress-bar');
    if (el) el.style.display = 'none';
};

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&' + 'amp;')
        .replace(/</g, '&' + 'lt;')
        .replace(/>/g, '&' + 'gt;')
        .replace(/"/g, '&' + 'quot;')
        .replace(/'/g, '&' + '#039;');
}

// ==========================================
// DZIENNIK DIAGNOSTYCZNY CZUWAKA (LOGI LOKALNE I AUTOZAPIS DO PLIKU)
// ==========================================
const CZUWAK_DIAGNOSTIC_LOGS_KEY = 'CZUWAK_DIAG_LOGS_V1';
const MAX_DIAGNOSTIC_LOGS = 5000;
window._diagnosticLogBuffer = [];
window._pendingLogChunk = '';
window._pickedDirectoryHandle = null;
let _persistDiagLogTimer = null;
let _streamLogFileTimer = null;

function getLogTrainNumber() {
    return window._currentActiveTrainNumber ||
           (window._currentTrainObject && window._currentTrainObject.numer) ||
           window.lastSearchedTrainNum ||
           '';
}

function getLogFileNames() {
    const now = new Date();
    const pad = (n, z = 2) => String(n).padStart(z, '0');
    const dateStr = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate());
    const trNum = getLogTrainNumber();
    const trainFileName = trNum
        ? ('czuwak_log_' + dateStr + '_poc_' + trNum + '.txt')
        : ('czuwak_log_' + dateStr + '_trasa.txt');
    const shiftFileName = 'czuwak_sluzba_' + dateStr + '.txt';
    return { dateStr, trNum, trainFileName, shiftFileName };
}

function flushLogChunkToFile(forceImmediate = false) {
    if (!window._pendingLogChunk) return;
    const chunk = window._pendingLogChunk;
    window._pendingLogChunk = '';

    const { trainFileName, shiftFileName } = getLogFileNames();

    // 1. Natywny zapis przez CzuwakWidgetBridge (Android APK)
    if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.appendLogChunk === 'function') {
        try {
            window.CzuwakNativeWidget.appendLogChunk(trainFileName, chunk);
            window.CzuwakNativeWidget.appendLogChunk(shiftFileName, chunk);
        } catch (e) {
            console.warn('Błąd natywnego zapisu logów do pliku:', e);
        }
    }

    // 2. Web File System Access API (PWA / przeglądarki ze wsparciem showDirectoryPicker)
    if (window._pickedDirectoryHandle) {
        (async () => {
            try {
                const writeToHandle = async (fname) => {
                    const fileHandle = await window._pickedDirectoryHandle.getFileHandle(fname, { create: true });
                    const writable = await fileHandle.createWritable({ keepExistingData: true });
                    const file = await fileHandle.getFile();
                    await writable.seek(file.size);
                    await writable.write(chunk);
                    await writable.close();
                };
                await writeToHandle(trainFileName);
                await writeToHandle(shiftFileName);
            } catch (e) {
                console.warn('Błąd zapisu FileSystemHandle:', e);
            }
        })();
    }
}

function scheduleStreamLogFile() {
    if (_streamLogFileTimer) return;
    _streamLogFileTimer = setTimeout(() => {
        _streamLogFileTimer = null;
        flushLogChunkToFile();
    }, 5000);
}

function schedulePersistDiagnosticLogs() {
    if (_persistDiagLogTimer) return;
    _persistDiagLogTimer = setTimeout(async () => {
        _persistDiagLogTimer = null;
        try {
            if (typeof localforage !== 'undefined' && Array.isArray(window._diagnosticLogBuffer)) {
                await localforage.setItem(CZUWAK_DIAGNOSTIC_LOGS_KEY, window._diagnosticLogBuffer.slice(0, MAX_DIAGNOSTIC_LOGS));
            }
        } catch (e) {}
    }, 2500);
}

// Inicjalne załadowanie logów z localforage
if (typeof localforage !== 'undefined') {
    localforage.getItem(CZUWAK_DIAGNOSTIC_LOGS_KEY).then(saved => {
        if (Array.isArray(saved) && saved.length > 0) {
            window._diagnosticLogBuffer = saved.concat(window._diagnosticLogBuffer).slice(0, MAX_DIAGNOSTIC_LOGS);
        }
    }).catch(() => {});
}

// Globalne chwytanie niespodziewanych błędów skryptu (Crash Logger)
window.addEventListener('error', (event) => {
    if (event && event.message) {
        window.czuwakLog('ERROR', 'CRASH', 'Błąd JS: ' + event.message + ' (' + (event.filename || '') + ':' + (event.lineno || '') + ')');
    }
});
window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'Nieznany błąd Promise';
    window.czuwakLog('ERROR', 'CRASH', 'Nieobsłużony błąd asynchroniczny: ' + reason);
});

window.czuwakLog = function(level, category, message, data = null) {
    const now = new Date();
    const pad = (n, z = 2) => String(n).padStart(z, '0');
    const timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + '.' + pad(now.getMilliseconds(), 3);
    const lvl = String(level || 'INFO').toUpperCase();
    const cat = String(category || 'APP').toUpperCase();
    const msg = String(message || '');
    const dataStr = data ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : null;
    const currentTrainNum = getLogTrainNumber();

    const entry = {
        time: timeStr,
        timestamp: now.getTime(),
        level: lvl,
        category: cat,
        message: msg,
        data: dataStr,
        train: currentTrainNum
    };

    if (!window._diagnosticLogBuffer) window._diagnosticLogBuffer = [];
    window._diagnosticLogBuffer.unshift(entry);
    if (window._diagnosticLogBuffer.length > MAX_DIAGNOSTIC_LOGS) {
        window._diagnosticLogBuffer.pop();
    }

    const trPrefix = currentTrainNum ? (' [POC ' + currentTrainNum + ']') : '';
    const lineText = '[' + timeStr + ']' + trPrefix + ' [' + cat + '] [' + lvl + '] ' + msg +
                     (dataStr ? (' | ' + dataStr) : '') + '\n';
    window._pendingLogChunk = (window._pendingLogChunk || '') + lineText;

    scheduleStreamLogFile();
    schedulePersistDiagnosticLogs();

    if (lvl === 'ERROR' || cat === 'STATION' || cat === 'ALERT' || cat === 'CRASH') {
        flushLogChunkToFile(true);
    }

    if (lvl === 'ERROR') {
        console.error('[CZUWAK][' + cat + ']' + trPrefix + ' ' + msg, dataStr || '');
    } else if (lvl === 'WARN') {
        console.warn('[CZUWAK][' + cat + ']' + trPrefix + ' ' + msg, dataStr || '');
    } else {
        console.log('[CZUWAK][' + cat + ']' + trPrefix + ' ' + msg, dataStr || '');
    }
};

window.pickLogStorageFolder = async () => {
    // 1. Android Native Bridge
    if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.pickLogFolder === 'function') {
        try {
            window.CzuwakNativeWidget.pickLogFolder();
            return;
        } catch (e) {
            console.warn('Błąd wywołania pickLogFolder:', e);
        }
    }

    // 2. Web File System Access API
    if (window.showDirectoryPicker) {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (handle) {
                window._pickedDirectoryHandle = handle;
                window.onLogFolderPicked(handle.name || 'Wybrany folder');
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                alert('Nie udało się wybrać folderu: ' + (e.message || e));
            }
        }
    } else {
        alert('Wybór folderu na dysku telefonu (.apk) jest obsługiwany przez system Android. W wersji webowej logi są zapisywane w pamięci lokalnej z możliwością pobrania pliku .txt.');
    }
};

window.onLogFolderPicked = (folderName) => {
    localStorage.setItem('CZUWAK_LOG_FOLDER_NAME', folderName);
    window.syncLogFolderUI();
    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'APP', 'Zmieniono folder zapisu logów na: ' + folderName);
    }
    flushLogChunkToFile(true);
    if (typeof window.showCzuwakWidgetActionToast === 'function') {
        window.showCzuwakWidgetActionToast('Folder logów: ' + folderName, 'folder_open', '#38bdf8');
    }
};

window.getLogFolderDisplay = () => {
    if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.getLogFolderDisplay === 'function') {
        try {
            const disp = window.CzuwakNativeWidget.getLogFolderDisplay();
            if (disp) return disp;
        } catch (e) {}
    }
    return localStorage.getItem('CZUWAK_LOG_FOLDER_NAME') || 'Pobrane / Czuwak_Logi (Domyślny)';
};

window.syncLogFolderUI = () => {
    const disp = window.getLogFolderDisplay();
    const menuLabel = document.getElementById('menuLogFolderLabel');
    if (menuLabel) menuLabel.innerText = disp;
    const modalLabel = document.getElementById('modalLogFolderLabel');
    if (modalLabel) modalLabel.innerText = disp;
};

window.copyDiagnosticLogs = function() {
    flushLogChunkToFile(true);
    const logs = window._diagnosticLogBuffer || [];
    if (logs.length === 0) {
        alert('Dziennik diagnostyczny jest pusty.');
        return;
    }
    let text = '=== CZUWAK DZIENNIK DIAGNOSTYCZNY ===\n' +
               'Wersja: ' + (window.APP_VERSION || '') + ' (' + (window.APP_BUILD || '') + ')\n' +
               'Data: ' + new Date().toISOString() + '\n' +
               'Liczba zdarzen: ' + logs.length + '\n\n';

    logs.forEach(l => {
        const trPrefix = l.train ? (' [POC ' + l.train + ']') : '';
        text += '[' + l.time + ']' + trPrefix + ' [' + l.category + '] [' + l.level + '] ' + l.message;
        if (l.data) text += ' | ' + l.data;
        text += '\n';
    });

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Skopiowano ' + logs.length + ' wpisów dziennika do schowka!');
        }).catch(() => {
            prompt('Skopiuj logi ręcznie:', text);
        });
    } else {
        prompt('Skopiuj logi ręcznie:', text);
    }
};

window.downloadDiagnosticLogs = function() {
    flushLogChunkToFile(true);
    const logs = window._diagnosticLogBuffer || [];
    if (logs.length === 0) {
        alert('Dziennik diagnostyczny jest pusty.');
        return;
    }
    const { trainFileName, trNum } = getLogFileNames();
    let text = '=== CZUWAK DZIENNIK DIAGNOSTYCZNY ===\n' +
               'Wersja: ' + (window.APP_VERSION || '') + ' (' + (window.APP_BUILD || '') + ')\n' +
               'Data eksportu: ' + new Date().toISOString() + '\n' +
               (trNum ? ('Aktywny pociąg: ' + trNum + '\n') : '') +
               'Liczba wpisow: ' + logs.length + '\n\n';

    logs.forEach(l => {
        const trPrefix = l.train ? (' [POC ' + l.train + ']') : '';
        text += '[' + l.time + ']' + trPrefix + ' [' + l.category + '] [' + l.level + '] ' + l.message;
        if (l.data) text += ' | ' + l.data;
        text += '\n';
    });

    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = trainFileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 300);
    } catch (e) {
        alert('Błąd pobierania pliku logów: ' + e.message);
    }
};

window.clearDiagnosticLogs = async function() {
    if (!confirm('Czy na pewno chcesz wyczyścić pamięć podręczną dziennika diagnostycznego? (Pliki zapisane w wybranym folderze telefonu pozostaną nienaruszone)')) return;
    window._diagnosticLogBuffer = [];
    window._pendingLogChunk = '';
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.removeItem(CZUWAK_DIAGNOSTIC_LOGS_KEY);
        }
    } catch (e) {}
    window.renderDiagnosticLogsList('all');
};

window.renderDiagnosticLogsList = function(filterCategory = 'all') {
    const container = document.getElementById('diagLogsListContainer');
    if (!container) return;
    const logs = window._diagnosticLogBuffer || [];
    const countEl = document.getElementById('diagLogsCount');
    if (countEl) countEl.innerText = String(logs.length);

    let filtered = logs;
    if (filterCategory === 'gps') {
        filtered = logs.filter(l => l.category === 'GPS' || l.category === 'SPEED' || l.category === 'TUNNEL');
    } else if (filterCategory === 'station') {
        filtered = logs.filter(l => l.category === 'STATION' || l.category === 'DELAY' || l.category === 'ALERT');
    } else if (filterCategory === 'error') {
        filtered = logs.filter(l => l.level === 'ERROR' || l.level === 'WARN' || l.category === 'CRASH');
    }

    if (filtered.length === 0) {
        container.innerHTML = '\x3Cdiv style="text-align:center; padding:20px; color:var(--text-muted);"\x3EBrak wpisów w wybranej kategorii.\x3C/div\x3E';
        return;
    }

    let html = '';
    filtered.slice(0, 200).forEach(l => {
        let catClass = 'gps';
        if (l.category === 'STATION') catClass = 'station';
        else if (l.category === 'SPEED') catClass = 'speed';
        else if (l.category === 'DELAY') catClass = 'delay';
        else if (l.category === 'ALERT') catClass = 'alert';
        else if (l.category === 'TUNNEL') catClass = 'tunnel';
        else if (l.category === 'LIFECYCLE') catClass = 'lifecycle';
        if (l.level === 'ERROR' || l.category === 'CRASH') catClass = 'error';
        else if (l.level === 'WARN') catClass = 'warn';

        const trTag = l.train ? ('\x3Cspan style="color:var(--primary); font-weight:800; font-size:0.68rem; margin-right:4px;"\x3E#' + escapeHTML(l.train) + '\x3C/span\x3E') : '';

        html += '\x3Cdiv class="diag-log-row"\x3E' +
            '\x3Cdiv class="diag-log-header"\x3E' +
                '\x3Cspan style="color:#94a3b8; font-variant-numeric:tabular-nums;"\x3E' + escapeHTML(l.time) + '\x3C/span\x3E' +
                trTag +
                '\x3Cspan class="diag-badge ' + catClass + '"\x3E' + escapeHTML(l.category) + '\x3C/span\x3E' +
                (l.level === 'WARN' || l.level === 'ERROR' ? ('\x3Cspan class="diag-badge ' + (l.level === 'ERROR' ? 'error' : 'warn') + '"\x3E' + escapeHTML(l.level) + '\x3C/span\x3E') : '') +
            '\x3C/div\x3E' +
            '\x3Cdiv class="diag-log-msg"\x3E' + escapeHTML(l.message) + '\x3C/div\x3E' +
            (l.data ? ('\x3Cdiv style="color:#64748b; font-size:0.68rem; word-break:break-all; margin-top:1px;"\x3E' + escapeHTML(l.data) + '\x3C/div\x3E') : '') +
        '\x3C/div\x3E';
    });
    container.innerHTML = html;
};

window.openDiagnosticLogsModal = function() {
    window.closeCzuwakSheet();
    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    const totalLogs = (window._diagnosticLogBuffer || []).length;
    const folderDisp = window.getLogFolderDisplay();
    const { trainFileName, shiftFileName, trNum } = getLogFileNames();

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:92vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Eterminal\x3C/span\x3E Dziennik diagnostyczny' +
                    '\x3Cspan id="diagLogsCount" style="font-size:0.75rem; font-weight:800; background:rgba(2,132,199,0.18); border:1px solid var(--primary); color:var(--primary); padding:1px 7px; border-radius:999px;"\x3E' + totalLogs + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +

            // Panel konfiguracji folderu zapisu na żywo
            '\x3Cdiv style="background:var(--input-bg); border:1.5px solid var(--primary); border-radius:10px; padding:10px 12px; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;"\x3E' +
                    '\x3Cdiv style="display:flex; align-items:center; gap:6px; font-weight:800; font-size:0.82rem; color:var(--text);"\x3E' +
                        '\x3Cspan class="material-symbols-outlined" style="color:var(--primary); font-size:1.05rem;"\x3Efolder_open\x3C/span\x3E Folder zapisu logów na żywo:' +
                    '\x3C/div\x3E' +
                    '\x3Cbutton type="button" onclick="window.pickLogStorageFolder()" style="padding:4px 10px; border-radius:6px; background:var(--primary); border:none; color:#ffffff; font-size:0.76rem; font-weight:800; cursor:pointer;"\x3E' +
                        '📁 Zmień folder' +
                    '\x3C/button\x3E' +
                '\x3C/div\x3E' +
                '\x3Cdiv id="modalLogFolderLabel" style="font-size:0.78rem; font-weight:700; color:var(--primary); word-break:break-all; margin-bottom:6px;"\x3E' + escapeHTML(folderDisp) + '\x3C/div\x3E' +
                '\x3Cdiv style="font-size:0.72rem; color:var(--text-muted); line-height:1.35;"\x3E' +
                    '🟢 \x3Cstrong style="color:var(--open);"\x3EAutozapis aktywny:\x3C/strong\x3E logi dopisują się w tle co 5 sekund do: \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(trainFileName) + '\x3C/strong\x3E oraz zbiorczego \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(shiftFileName) + '\x3C/strong\x3E.' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; padding-bottom:2px;"\x3E' +
                '\x3Cbutton type="button" class="duty-filter-btn active" id="diagFilterAll" onclick="document.querySelectorAll(\'.duty-filter-btn\').forEach(b=>b.classList.remove(\'active\')); this.classList.add(\'active\'); window.renderDiagnosticLogsList(\'all\');"\x3EWszystkie\x3C/button\x3E' +
                '\x3Cbutton type="button" class="duty-filter-btn" id="diagFilterGps" onclick="document.querySelectorAll(\'.duty-filter-btn\').forEach(b=>b.classList.remove(\'active\')); this.classList.add(\'active\'); window.renderDiagnosticLogsList(\'gps\');"\x3EGPS & Prędkość\x3C/button\x3E' +
                '\x3Cbutton type="button" class="duty-filter-btn" id="diagFilterStation" onclick="document.querySelectorAll(\'.duty-filter-btn\').forEach(b=>b.classList.remove(\'active\')); this.classList.add(\'active\'); window.renderDiagnosticLogsList(\'station\');"\x3EStacje & Postoje\x3C/button\x3E' +
                '\x3Cbutton type="button" class="duty-filter-btn" id="diagFilterError" onclick="document.querySelectorAll(\'.duty-filter-btn\').forEach(b=>b.classList.remove(\'active\')); this.classList.add(\'active\'); window.renderDiagnosticLogsList(\'error\');"\x3EBłędy / Ostrzeżenia\x3C/button\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv id="diagLogsListContainer" class="diag-log-container"\x3E\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;"\x3E' +
                '\x3Cbutton type="button" onclick="window.copyDiagnosticLogs()" class="menu-btn menu-btn-primary" style="flex:2; min-height:46px; font-weight:800; font-size:0.85rem; justify-content:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1.05rem;"\x3Econtent_copy\x3C/span\x3E Kopiuj logi' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="window.downloadDiagnosticLogs()" class="menu-btn menu-btn-secondary" style="flex:2; min-height:46px; font-weight:800; font-size:0.85rem; justify-content:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1.05rem;"\x3Edownload\x3C/span\x3E Pobierz (.txt)' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="window.clearDiagnosticLogs()" class="menu-btn menu-btn-secondary" style="flex:1; min-height:46px; font-weight:800; font-size:0.85rem; color:#f87171; justify-content:center;"\x3E' +
                    'Wyczyść' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
    window.renderDiagnosticLogsList('all');
};

// ==========================================
// HISTORIA OBSŁUGI POCIĄGÓW (ARCHIWUM SŁUŻBY DK)
// ==========================================
const CZUWAK_DUTY_HISTORY_KEY = 'CZUWAK_DUTY_HISTORY_V1';
window._cachedDutyHistory = null;

async function getDutyHistoryList() {
    if (Array.isArray(window._cachedDutyHistory)) return window._cachedDutyHistory;
    try {
        if (typeof localforage !== 'undefined') {
            const list = await localforage.getItem(CZUWAK_DUTY_HISTORY_KEY);
            if (Array.isArray(list)) {
                window._cachedDutyHistory = list;
                return list;
            }
        }
        const raw = localStorage.getItem(CZUWAK_DUTY_HISTORY_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                window._cachedDutyHistory = parsed;
                return parsed;
            }
        }
    } catch (e) {}
    window._cachedDutyHistory = [];
    return [];
}

async function saveDutyHistoryList(list) {
    window._cachedDutyHistory = list;
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.setItem(CZUWAK_DUTY_HISTORY_KEY, list);
        }
        localStorage.setItem(CZUWAK_DUTY_HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
}

window.archiveCurrentTrainToHistory = async function(statusText = 'Zakończono') {
    if (!window._currentTrainObject) return;
    const trObj = window._currentTrainObject;
    const trNum = window._currentActiveTrainNumber || trObj.numer || 'POCIĄG';
    const trName = trObj.nazwa || '';
    const dateStr = window._currentTrainDate || new Date().toISOString().split('T')[0];

    const stacjeArray = Array.isArray(trObj.stacje)
        ? trObj.stacje
        : Object.values(trObj.stacje || {});
    if (stacjeArray.length === 0) return;

    const startStName = window._crewDutyStartStationName || (stacjeArray[0] && stacjeArray[0].nazwa) || '';
    const endStName = window._crewDutyEndStationName || (stacjeArray[stacjeArray.length - 1] && stacjeArray[stacjeArray.length - 1].nazwa) || '';

    const stationsData = [];
    let checkedCount = 0;

    stacjeArray.forEach((st, idx) => {
        const sName = (typeof st === 'object' && st.nazwa) ? st.nazwa : ('Stacja ' + (idx + 1));
        const schedArr = (typeof st === 'object' && st.przyjazd) ? st.przyjazd : '-';
        const schedDep = (typeof st === 'object' && st.odjazd) ? st.odjazd : '-';

        const actual = (window._stationActualLog && window._stationActualLog[idx]) ? window._stationActualLog[idx] : null;
        const tag = window.getStationTag ? window.getStationTag(idx, sName) : null;
        const isChecked = !!(actual && actual.checked);
        if (isChecked) checkedCount++;

        stationsData.push({
            index: idx,
            name: sName,
            schedArr: schedArr,
            schedDep: schedDep,
            actualArr: actual ? actual.actualArr : null,
            actualDep: actual ? actual.actualDep : null,
            checked: isChecked,
            tag: tag || null,
            isWithinDuty: (idx >= (window._crewDutyStartIdx || 0) && idx <= (window._crewDutyEndIdx || (stacjeArray.length - 1)))
        });
    });

    const dutyEntry = {
        id: Date.now(),
        date: dateStr,
        trainNumber: String(trNum).trim(),
        trainName: trName,
        relation: (stacjeArray[0] ? stacjeArray[0].nazwa : '') + ' \u2794 ' + (stacjeArray[stacjeArray.length - 1] ? stacjeArray[stacjeArray.length - 1].nazwa : ''),
        dutyStart: startStName,
        dutyEnd: endStName,
        status: statusText,
        finalDelay: window._trainDelayMinutes || 0,
        savedAt: formatNowHHMMSS(),
        checkedCount: checkedCount,
        totalStations: stacjeArray.length,
        stations: stationsData
    };

    let history = await getDutyHistoryList();
    const existingIdx = history.findIndex(h => h.date === dateStr && String(h.trainNumber).trim() === String(trNum).trim());
    if (existingIdx >= 0) {
        history[existingIdx] = dutyEntry;
    } else {
        history.unshift(dutyEntry);
    }
    if (history.length > 80) history = history.slice(0, 80);

    await saveDutyHistoryList(history);
    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'STATION', 'Zaktualizowano historię obsługi pociągu #' + trNum + ' (' + checkedCount + ' postojów odhaczonych)');
    }
};

window.openDutyHistoryModal = async function() {
    window.closeCzuwakSheet();
    const history = await getDutyHistoryList();

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    let itemsHtml = '';
    if (history.length === 0) {
        itemsHtml = '\x3Cdiv style="text-align:center; padding:30px 15px; color:var(--text-muted); font-size:0.9rem;"\x3E' +
            '\x3Cspan class="material-symbols-outlined" style="font-size:3rem; opacity:0.4; display:block; margin-bottom:8px;"\x3Ehistory_edu\x3C/span\x3E' +
            'Brak zrealizowanych pociągów w historii.\x3Cbr\x3E' +
            'Każdy obsłużony pociąg z czasami rzeczywistymi trafi tutaj automatycznie po zakończeniu lub zmianie składu.\x3C/div\x3E';
    } else {
        history.forEach((h, hIdx) => {
            const delayStr = (h.finalDelay > 0) ? ('+' + h.finalDelay + ' min') : (h.finalDelay < 0 ? (h.finalDelay + ' min') : 'Wg planu');
            const delayColor = (h.finalDelay > 0) ? '#f87171' : '#4ade80';

            let stationsTableRows = '';
            if (Array.isArray(h.stations)) {
                h.stations.forEach(st => {
                    const dutyStyle = st.isWithinDuty ? 'font-weight:700;' : 'opacity:0.6;';
                    const arrDisp = st.actualArr ? ('\x3Cstrong style="color:#4ade80;"\x3E' + escapeHTML(st.actualArr) + '\x3C/strong\x3E') : escapeHTML(st.schedArr || '-');
                    const depDisp = st.actualDep ? ('\x3Cstrong style="color:#38bdf8;"\x3E' + escapeHTML(st.actualDep) + '\x3C/strong\x3E') : escapeHTML(st.schedDep || '-');
                    const tagBadge = st.tag ? (' \x3Cspan style="background:rgba(236,72,153,0.18); border:1px solid #ec4899; color:#f472b6; border-radius:4px; padding:1px 5px; font-size:0.68rem; font-weight:800;"\x3E' + escapeHTML(st.tag) + '\x3C/span\x3E') : '';

                    stationsTableRows += '\x3Ctr style="border-bottom:1px solid rgba(255,255,255,0.06); ' + dutyStyle + '"\x3E' +
                        '\x3Ctd style="padding:6px 8px; text-align:left;"\x3E' + escapeHTML(st.name) + tagBadge + '\x3C/td\x3E' +
                        '\x3Ctd style="padding:6px 8px; text-align:center; font-variant-numeric:tabular-nums;"\x3E' + arrDisp + '\x3C/td\x3E' +
                        '\x3Ctd style="padding:6px 8px; text-align:center; font-variant-numeric:tabular-nums;"\x3E' + depDisp + '\x3C/td\x3E' +
                    '\x3C/tr\x3E';
                });
            }

            itemsHtml +=
                '\x3Cdiv class="history-card" style="background:var(--input-bg); border:1.5px solid var(--glass-border); border-radius:12px; padding:12px; margin-bottom:12px; transition:border-color 0.2s;"\x3E' +
                    '\x3Cdiv style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; flex-wrap:wrap; gap:6px;"\x3E' +
                        '\x3Cdiv\x3E' +
                            '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                                '\x3Cspan style="font-weight:900; font-size:1.05rem; color:var(--primary);"\x3E#' + escapeHTML(h.trainNumber) + '\x3C/span\x3E' +
                                (h.trainName ? ('\x3Cspan style="font-weight:800; font-size:0.95rem; color:var(--text);"\x3E' + escapeHTML(h.trainName) + '\x3C/span\x3E') : '') +
                                '\x3Cspan style="font-size:0.75rem; color:var(--text-muted); background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;"\x3E' + escapeHTML(h.date) + '\x3C/span\x3E' +
                            '\x3C/div\x3E' +
                            '\x3Cdiv style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;"\x3E' +
                                'Odcinek DK: \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(h.dutyStart || '?') + ' \u2794 ' + escapeHTML(h.dutyEnd || '?') + '\x3C/strong\x3E' +
                            '\x3C/div\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="text-align:right;"\x3E' +
                            '\x3Cspan style="display:inline-block; font-size:0.78rem; font-weight:900; color:' + delayColor + '; background:rgba(0,0,0,0.25); border:1px solid ' + delayColor + '; padding:2px 8px; border-radius:999px;"\x3E' +
                                delayStr +
                            '\x3C/span\x3E' +
                            '\x3Cdiv style="font-size:0.7rem; color:var(--text-muted); margin-top:3px;"\x3E' + escapeHTML(h.checkedCount) + ' odhaczonych\x3C/div\x3E' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +

                    '\x3Cdiv id="historyDetails_' + h.id + '" style="display:none; margin-top:10px; padding-top:8px; border-top:1px dashed var(--glass-border);"\x3E' +
                        '\x3Cdiv style="max-height:240px; overflow-y:auto; border-radius:8px; background:rgba(0,0,0,0.2); margin-bottom:10px;"\x3E' +
                            '\x3Ctable style="width:100%; border-collapse:collapse; font-size:0.78rem; color:var(--text);"\x3E' +
                                '\x3Cthead style="position:sticky; top:0; background:var(--input-bg); font-weight:800; color:var(--text-muted); border-bottom:1px solid var(--glass-border);"\x3E' +
                                    '\x3Ctr\x3E' +
                                        '\x3Cth style="padding:6px 8px; text-align:left;"\x3EStacja\x3C/th\x3E' +
                                        '\x3Cth style="padding:6px 8px; text-align:center;"\x3EPrzyjazd\x3C/th\x3E' +
                                        '\x3Cth style="padding:6px 8px; text-align:center;"\x3EOdjazd\x3C/th\x3E' +
                                    '\x3C/tr\x3E' +
                                '\x3C/thead\x3E' +
                                '\x3Ctbody\x3E' + stationsTableRows + '\x3C/tbody\x3E' +
                            '\x3C/table\x3E' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +

                    '\x3Cdiv style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;"\x3E' +
                        '\x3Cbutton type="button" onclick="const el=document.getElementById(\'historyDetails_' + h.id + '\'); el.style.display=(el.style.display===\'none\'?\'block\':\'none\'); this.innerText=(el.style.display===\'none\'?\'📋 Szczegóły stacji\':\'🔼 Ukryj szczegóły\');" class="menu-btn menu-btn-secondary" style="flex:2; min-height:40px; font-size:0.78rem; font-weight:800; justify-content:center; padding:4px 8px;"\x3E' +
                            '📋 Szczegóły stacji' +
                        '\x3C/button\x3E' +
                        '\x3Cbutton type="button" onclick="window.copyDutyHistoryReport(' + h.id + ')" class="menu-btn menu-btn-secondary" style="flex:1; min-height:40px; font-size:0.78rem; font-weight:800; justify-content:center; padding:4px 8px;" title="Kopiuj raport do schowka"\x3E' +
                            'Kopiuj' +
                        '\x3C/button\x3E' +
                        '\x3Cbutton type="button" onclick="window.downloadDutyHistoryReport(' + h.id + ')" class="menu-btn menu-btn-secondary" style="flex:1; min-height:40px; font-size:0.78rem; font-weight:800; justify-content:center; padding:4px 8px;" title="Pobierz plik tekstowy"\x3E' +
                            'Pobierz' +
                        '\x3C/button\x3E' +
                        '\x3Cbutton type="button" onclick="window.deleteDutyHistoryItem(' + h.id + ')" style="background:transparent; border:none; color:#f87171; cursor:pointer; padding:6px 8px; font-weight:800; font-size:0.75rem;" title="Usuń z historii"\x3E' +
                            'Usuń' +
                        '\x3C/button\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E';
        });
    }

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:92vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Emanage_history\x3C/span\x3E Historia obsługi pociągów' +
                    '\x3Cspan style="font-size:0.75rem; font-weight:800; background:rgba(2,132,199,0.18); border:1px solid var(--primary); color:var(--primary); padding:1px 7px; border-radius:999px;"\x3E' + history.length + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px; line-height:1.35;"\x3E' +
                'Zestawienie obsłużonych pociągów z godzinami planowymi oraz rzeczywistymi czasami przyjazdu i odjazdu odnotowanymi na szlaku.' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="max-height:60vh; overflow-y:auto; padding-right:2px;"\x3E' + itemsHtml + '\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; gap:8px; margin-top:12px;"\x3E' +
                '\x3Cbutton type="button" onclick="window.clearAllDutyHistory()" class="menu-btn menu-btn-secondary" style="flex:1; min-height:46px; font-weight:800; color:#f87171; justify-content:center;"\x3E' +
                    'Wyczyść całą historię' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" class="menu-btn menu-btn-primary" style="flex:2; min-height:46px; font-weight:800; justify-content:center;"\x3E' +
                    'Zamknij' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
};

window.generateDutyHistoryReportText = async function(dutyId) {
    const history = await getDutyHistoryList();
    const h = history.find(item => item.id === dutyId);
    if (!h) return '';

    let text = '=== CZUWAK RAPORT OBSŁUGI POCIĄGU ===\n' +
               'Pociąg: #' + h.trainNumber + (h.trainName ? (' ' + h.trainName) : '') + '\n' +
               'Data służby: ' + h.date + '\n' +
               'Relacja: ' + h.relation + '\n' +
               'Odcinek DK: ' + (h.dutyStart || '?') + ' -> ' + (h.dutyEnd || '?') + '\n' +
               'Opóźnienie końcowe: ' + ((h.finalDelay > 0) ? ('+' + h.finalDelay + ' min') : (h.finalDelay < 0 ? (h.finalDelay + ' min') : 'Wg planu')) + '\n' +
               'Odhaczonych postojów: ' + h.checkedCount + ' / ' + h.totalStations + '\n\n' +
               '--- PRZEBIEG TRASY ---\n';

    if (Array.isArray(h.stations)) {
        h.stations.forEach(st => {
            const arrStr = st.actualArr ? ('Rzecz: ' + st.actualArr) : ('Plan: ' + (st.schedArr || '-'));
            const depStr = st.actualDep ? ('Rzecz: ' + st.actualDep) : ('Plan: ' + (st.schedDep || '-'));
            const tagStr = st.tag ? (' [' + st.tag + ']') : '';
            text += st.name + tagStr + '\n  Przyjazd: ' + arrStr + ' | Odjazd: ' + depStr + '\n';
        });
    }
    return text;
};

window.copyDutyHistoryReport = async function(dutyId) {
    const text = await window.generateDutyHistoryReportText(dutyId);
    if (!text) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        if (typeof window.showCzuwakWidgetActionToast === 'function') {
            window.showCzuwakWidgetActionToast('Skopiowano raport służby do schowka', 'content_copy', '#38bdf8');
        } else {
            alert('Skopiowano raport służby do schowka!');
        }
    } catch (e) {
        alert('Błąd kopiowania raportu: ' + e.message);
    }
};

window.downloadDutyHistoryReport = async function(dutyId) {
    const text = await window.generateDutyHistoryReportText(dutyId);
    if (!text) return;
    const history = await getDutyHistoryList();
    const h = history.find(item => item.id === dutyId);
    const fname = 'raport_poc_' + (h ? h.trainNumber : 'pociag') + '_' + (h ? h.date.replace(/-/g, '') : 'data') + '.txt';

    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) a.remove();
            URL.revokeObjectURL(url);
        }, 300);
    } catch (e) {
        alert('Błąd pobierania raportu: ' + e.message);
    }
};

window.deleteDutyHistoryItem = async function(dutyId) {
    if (!confirm('Czy na pewno chcesz usunąć ten pociąg z historii?')) return;
    let history = await getDutyHistoryList();
    history = history.filter(h => h.id !== dutyId);
    await saveDutyHistoryList(history);
    window.openDutyHistoryModal();
};

window.clearAllDutyHistory = async function() {
    if (!confirm('Czy na pewno chcesz wyczyścić całą historię obsługi pociągów?')) return;
    await saveDutyHistoryList([]);
    window.openDutyHistoryModal();
};

// ==========================================
// PLANER SŁUŻBY (MOJA SŁUŻBA - PLANOWANIE POCIĄGÓW Z DOMU I 1-TAP START)
// ==========================================
const CZUWAK_DUTY_PLAN_KEY = 'CZUWAK_DUTY_PLAN_V1';
let _cachedDutyPlanStore = null;
window._activeDutyPlanDate = localStorage.getItem('CZUWAK_ACTIVE_PLAN_DATE') || null;
window._activeDutyPlanItemId = localStorage.getItem('CZUWAK_ACTIVE_PLAN_ITEM_ID') || null;
window._plannerDraftTags = {};
window._plannerLoadedTrain = null;

async function getDutyPlanStore() {
    if (_cachedDutyPlanStore && typeof _cachedDutyPlanStore === 'object') {
        return _cachedDutyPlanStore;
    }
    try {
        if (typeof localforage !== 'undefined') {
            const store = await localforage.getItem(CZUWAK_DUTY_PLAN_KEY);
            if (store && typeof store === 'object') {
                _cachedDutyPlanStore = store;
                return store;
            }
        }
        const raw = localStorage.getItem(CZUWAK_DUTY_PLAN_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                _cachedDutyPlanStore = parsed;
                return parsed;
            }
        }
    } catch (e) {}
    _cachedDutyPlanStore = {};
    return {};
}

async function saveDutyPlanStore(store) {
    _cachedDutyPlanStore = store;
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.setItem(CZUWAK_DUTY_PLAN_KEY, store);
        }
        localStorage.setItem(CZUWAK_DUTY_PLAN_KEY, JSON.stringify(store));
    } catch (e) {}
}

async function getDutyPlanForDate(dateStr) {
    const store = await getDutyPlanStore();
    return Array.isArray(store[dateStr]) ? store[dateStr] : [];
}

async function saveDutyPlanItem(dateStr, item) {
    const store = await getDutyPlanStore();
    if (!Array.isArray(store[dateStr])) {
        store[dateStr] = [];
    }
    const idx = store[dateStr].findIndex(i => String(i.id) === String(item.id));
    if (idx >= 0) {
        store[dateStr][idx] = item;
    } else {
        store[dateStr].push(item);
    }
    await saveDutyPlanStore(store);
    window.syncDutyPlanHomeCardUI();
}

async function deleteDutyPlanItem(dateStr, itemId) {
    const store = await getDutyPlanStore();
    if (Array.isArray(store[dateStr])) {
        store[dateStr] = store[dateStr].filter(i => String(i.id) !== String(itemId));
        await saveDutyPlanStore(store);
    }
    window.syncDutyPlanHomeCardUI();
}

window.deleteDutyPlanItemPrompt = async function(dateStr, itemId) {
    if (!confirm('Czy na pewno chcesz usunąć ten pociąg z planu służby?')) return;
    await deleteDutyPlanItem(dateStr, itemId);
    window.openDutyPlannerModal(dateStr);
};

window.markDutyPlanItemCompleted = async function(dateStr, itemId, reasonText = '') {
    const dStr = dateStr || window._activeDutyPlanDate || window.selectedTrainDepartureDate || getLocalYYYYMMDD(new Date());
    const store = await getDutyPlanStore();
    if (Array.isArray(store[dStr])) {
        const item = store[dStr].find(i => String(i.id) === String(itemId));
        if (item) {
            item.status = 'completed';
            item.completedAt = formatNowHHMMSS();
            item.completionReason = reasonText || '';
            await saveDutyPlanStore(store);
        }
    }
    window._activeDutyPlanItemId = null;
    try {
        localStorage.removeItem('CZUWAK_ACTIVE_PLAN_ITEM_ID');
    } catch (e) {}
    window.syncDutyPlanHomeCardUI();
};

window.markDutyPlanItemCompletedByTrain = async function(dateStr, trainNum, reasonText = '') {
    if (!trainNum) return;
    const cleanNum = String(trainNum).trim();
    const dStr = dateStr || window._activeDutyPlanDate || window.selectedTrainDepartureDate || getLocalYYYYMMDD(new Date());
    const store = await getDutyPlanStore();
    if (Array.isArray(store[dStr])) {
        const item = store[dStr].find(i => String(i.trainNumber).trim() === cleanNum && i.status !== 'completed');
        if (item) {
            item.status = 'completed';
            item.completedAt = formatNowHHMMSS();
            item.completionReason = reasonText || '';
            await saveDutyPlanStore(store);
        }
    }
    window._activeDutyPlanItemId = null;
    try {
        localStorage.removeItem('CZUWAK_ACTIVE_PLAN_ITEM_ID');
    } catch (e) {}
    window.syncDutyPlanHomeCardUI();
};

window.launchPlannedTrain = async function(dateStr, itemId) {
    const store = await getDutyPlanStore();
    const items = store[dateStr] || [];
    const item = items.find(i => String(i.id) === String(itemId));
    if (!item) {
        alert('Nie znaleziono wybranego pociągu w planie służby.');
        return;
    }

    const cleanNum = String(item.trainNumber || '').trim();
    if (!cleanNum) {
        alert('Błędny numer pociągu w planie.');
        return;
    }

    window._activeDutyPlanDate = dateStr;
    window._activeDutyPlanItemId = String(item.id);
    try {
        localStorage.setItem('CZUWAK_ACTIVE_PLAN_DATE', dateStr);
        localStorage.setItem('CZUWAK_ACTIVE_PLAN_ITEM_ID', String(item.id));
    } catch (e) {}

    window.selectedTrainDepartureDate = dateStr;
    try {
        localStorage.setItem('CZUWAK_SELECTED_DEPARTURE_DATE', dateStr);
    } catch (e) {}
    window.syncTrainDateButtonsUI();

    if (item.tags && typeof item.tags === 'object') {
        Object.keys(item.tags).forEach(stKey => {
            const tagVal = item.tags[stKey];
            const numIdx = parseInt(stKey, 10);
            if (!isNaN(numIdx)) {
                localStorage.setItem(getStationTagStorageKey(cleanNum, numIdx), tagVal);
            }
            localStorage.setItem(getStationTagByNameStorageKey(cleanNum, stKey), tagVal);
        });
    }

    if (typeof item.startStationIdx === 'number' && typeof item.endStationIdx === 'number') {
        try {
            localStorage.setItem('CZUWAK_DUTY_SEG_' + cleanNum, JSON.stringify({
                startIdx: item.startStationIdx,
                endIdx: item.endStationIdx
            }));
        } catch (e) {}
    }

    item.status = 'active';
    await saveDutyPlanStore(store);

    window.closeCzuwakSheet();

    window.stopTrainTracking();
    window._configPanelForceExpanded = true;
    window.switchMode('train');
    window.switchTrainMode('number');
    const trIn = document.getElementById('trainInput');
    if (trIn) {
        trIn.value = cleanNum;
        try { trIn.blur(); } catch (e) {}
    }
    window.lastSearchedTrainNum = cleanNum;
    window.forceExactTrainMatch = true;

    window.findTrainForConfiguration(true);

    if (typeof window.showActionToast === 'function') {
        window.showActionToast('🚀 Uruchomiono pociąg #' + cleanNum + ' (' + (item.startStationName || '') + ' \u2794 ' + (item.endStationName || '') + ')');
    }
    window.syncDutyPlanHomeCardUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.syncDutyPlanHomeCardUI = async function() {
    const cardEl = document.getElementById('activeDutyPlanHomeCard');
    if (!cardEl) return;

    if (window._currentTrainObject) {
        cardEl.style.display = 'none';
        return;
    }

    const todayStr = getLocalYYYYMMDD(new Date());
    const selectedDate = window.selectedTrainDepartureDate || todayStr;
    const store = await getDutyPlanStore();

    let planItems = store[selectedDate] || [];
    let dateUsed = selectedDate;
    if (planItems.length === 0 && selectedDate !== todayStr && store[todayStr] && store[todayStr].length > 0) {
        planItems = store[todayStr];
        dateUsed = todayStr;
    }

    if (!Array.isArray(planItems) || planItems.length === 0) {
        cardEl.innerHTML =
            '\x3Cdiv style="background:rgba(2, 132, 199, 0.08); border:1.5px dashed rgba(2, 132, 199, 0.35); border-radius:12px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer;" onclick="window.openDutyPlannerModal()"\x3E' +
                '\x3Cdiv style="display:flex; align-items:center; gap:10px; min-width:0;"\x3E' +
                    '\x3Cdiv style="width:38px; height:38px; border-radius:8px; background:rgba(2,132,199,0.18); display:flex; align-items:center; justify-content:center; color:var(--primary); flex-shrink:0;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined"\x3Ecalendar_month\x3C/span\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="min-width:0;"\x3E' +
                        '\x3Cdiv style="font-weight:800; font-size:0.9rem; color:var(--text);"\x3EPlaner służby (Moja Służba)\x3C/div\x3E' +
                        '\x3Cdiv style="font-size:0.75rem; color:var(--text-muted); margin-top:1px;"\x3EZaplanuj pociągi z domu i startuj na peronie 1 dotknięciem!\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" class="menu-btn menu-btn-primary" style="min-height:38px; padding:4px 12px; font-size:0.78rem; font-weight:800; flex-shrink:0; justify-content:center;"\x3E+ Zaplanuj\x3C/button\x3E' +
            '\x3C/div\x3E';
        cardEl.style.display = 'block';
        return;
    }

    const totalCount = planItems.length;
    const completedCount = planItems.filter(i => i.status === 'completed').length;
    const pendingItem = planItems.find(i => i.status !== 'completed');

    if (!pendingItem) {
        cardEl.innerHTML =
            '\x3Cdiv style="background:rgba(34, 197, 94, 0.12); border:1.5px solid #22c55e; border-radius:12px; padding:12px 14px; margin-bottom:4px;"\x3E' +
                '\x3Cdiv style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;"\x3E' +
                    '\x3Cdiv style="display:flex; align-items:center; gap:8px; color:#4ade80; font-weight:800; font-size:0.92rem;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined"\x3Everified\x3C/span\x3E' +
                        'Służba na dzień ' + escapeHTML(dateUsed) + ' zrealizowana! (' + totalCount + ' pociągi obsłużone)' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="display:flex; gap:6px;"\x3E' +
                        '\x3Cbutton type="button" onclick="window.openDutyHistoryModal()" class="menu-btn menu-btn-secondary" style="min-height:38px; font-size:0.78rem; padding:4px 10px; font-weight:800;"\x3EHistoria\x3C/button\x3E' +
                        '\x3Cbutton type="button" data-date="' + escapeHTML(dateUsed) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" class="menu-btn menu-btn-primary" style="min-height:38px; font-size:0.78rem; padding:4px 10px; font-weight:800;"\x3EPlaner\x3C/button\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E';
        cardEl.style.display = 'block';
        return;
    }

    const curIndex = planItems.indexOf(pendingItem);
    const trNum = pendingItem.trainNumber || '';
    const trName = pendingItem.trainName ? (' ' + pendingItem.trainName) : '';
    const startName = pendingItem.startStationName || 'Początek';
    const endName = pendingItem.endStationName || 'Koniec';
    const depTime = pendingItem.depTime ? (' (' + pendingItem.depTime + ')') : '';
    const arrTime = pendingItem.arrTime ? (' (' + pendingItem.arrTime + ')') : '';

    let tagBadgesHtml = '';
    if (pendingItem.tags && typeof pendingItem.tags === 'object') {
        Object.keys(pendingItem.tags).forEach(k => {
            const t = pendingItem.tags[k];
            if (!t) return;
            const isP115 = /p115/i.test(t);
            const badgeBg = isP115 ? 'rgba(239, 68, 68, 0.18)' : 'rgba(236, 72, 153, 0.18)';
            const badgeBorder = isP115 ? '#ef4444' : '#ec4899';
            const badgeColor = isP115 ? '#fca5a5' : '#f472b6';
            tagBadgesHtml += '\x3Cspan style="display:inline-flex; align-items:center; gap:3px; background:' + badgeBg + '; border:1px solid ' + badgeBorder + '; color:' + badgeColor + '; padding:2px 6px; border-radius:6px; font-size:0.7rem; font-weight:800;"\x3E' +
                escapeHTML(k) + ': ' + escapeHTML(t) +
            '\x3C/span\x3E ';
        });
    }

    let prevCompletedHtml = '';
    if (completedCount > 0) {
        const completedTrains = planItems.filter(i => i.status === 'completed');
        let prevPills = '';
        completedTrains.forEach(ct => {
            prevPills += '\x3Cspan style="display:inline-block; background:rgba(34,197,94,0.15); border:1px solid #22c55e; color:#4ade80; border-radius:4px; padding:1px 6px; font-size:0.68rem; font-weight:800;"\x3E✓ #' + escapeHTML(ct.trainNumber) + ' (' + escapeHTML(ct.completedAt || 'zrobiony') + ')\x3C/span\x3E ';
        });
        prevCompletedHtml = '\x3Cdiv style="margin-bottom:8px; font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:6px; flex-wrap:wrap;"\x3E' +
            'Zrealizowane: ' + prevPills +
        '\x3C/div\x3E';
    }

    cardEl.innerHTML =
        '\x3Cdiv style="background:linear-gradient(135deg, rgba(2, 132, 199, 0.14), rgba(37, 99, 235, 0.18)); border:1.5px solid var(--primary); border-radius:14px; padding:14px; box-shadow:0 4px 14px rgba(2, 132, 199, 0.2);"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"\x3E' +
                '\x3Cdiv style="display:inline-flex; align-items:center; gap:6px; background:rgba(2, 132, 199, 0.25); border:1px solid var(--primary); border-radius:999px; padding:2px 10px; font-size:0.75rem; font-weight:900; color:#38bdf8; letter-spacing:0.3px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem;"\x3Eevent_available\x3C/span\x3E PLAN SŁUŻBY (' + (curIndex + 1) + ' z ' + totalCount + ')' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" data-date="' + escapeHTML(dateUsed) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" style="background:transparent; border:none; color:var(--primary); font-weight:800; font-size:0.76rem; cursor:pointer; display:inline-flex; align-items:center; gap:2px; padding:2px 4px;"\x3E' +
                    'Wszystkie (' + totalCount + ') \u2794' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
            prevCompletedHtml +
            '\x3Cdiv style="margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.15rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan style="color:var(--primary); font-weight:900;"\x3E#' + escapeHTML(trNum) + '\x3C/span\x3E' +
                    '\x3Cspan\x3E' + escapeHTML(trName) + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cdiv style="font-size:0.82rem; color:var(--text); margin-top:3px; line-height:1.4;"\x3E' +
                    'Odcinek DK: \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(startName) + escapeHTML(depTime) + '\x3C/strong\x3E \u2794 \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(endName) + escapeHTML(arrTime) + '\x3C/strong\x3E' +
                '\x3C/div\x3E' +
                (tagBadgesHtml ? ('\x3Cdiv style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;"\x3E' + tagBadgesHtml + '\x3C/div\x3E') : '') +
            '\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                '\x3Cbutton type="button" data-date="' + escapeHTML(dateUsed) + '" data-itemid="' + escapeHTML(pendingItem.id) + '" onclick="window.launchPlannedTrain(this.dataset.date, this.dataset.itemid)" class="menu-btn menu-btn-primary" style="flex:1; min-height:48px; font-size:0.95rem; font-weight:900; justify-content:center; gap:8px; background:linear-gradient(135deg, #0284c7, #2563eb); border-color:#38bdf8; box-shadow:0 4px 12px rgba(37,99,235,0.35);"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1.25rem;"\x3Erocket_launch\x3C/span\x3E Uruchom pociąg #' + escapeHTML(trNum) + ' (1-Tap)' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';
    cardEl.style.display = 'block';
};

window.openDutyPlannerModal = async function(targetDateStr = null) {
    window.closeCzuwakSheet();
    const curDate = targetDateStr || window.selectedTrainDepartureDate || getLocalYYYYMMDD(new Date());
    const store = await getDutyPlanStore();
    const items = Array.isArray(store[curDate]) ? store[curDate] : [];

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    const now = new Date();
    const yesterdayStr = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const todayStr = getLocalYYYYMMDD(now);
    const tomorrowStr = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    let itemsHtml = '';
    if (items.length === 0) {
        itemsHtml =
            '\x3Cdiv style="text-align:center; padding:30px 15px; color:var(--text-muted); font-size:0.88rem; background:rgba(255,255,255,0.02); border:1px dashed var(--glass-border); border-radius:12px; margin-bottom:12px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:3rem; opacity:0.4; display:block; margin-bottom:8px; color:var(--primary);"\x3Eedit_calendar\x3C/span\x3E' +
                'Brak zaplanowanych pociągów na dzień \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(curDate) + '\x3C/strong\x3E.\x3Cbr\x3E' +
                'Przygotuj pociągi w domu przed służbą, dodając numery, odcinek DK, procedurę P115 i znaczniki (PRM), aby na peronie startować 1 kliknięciem bez wpisywania i szukania!\x3C/div\x3E';
    } else {
        items.forEach((item, idx) => {
            let statusPill = '';
            if (item.status === 'completed') {
                statusPill = '\x3Cspan style="background:rgba(34, 197, 94, 0.16); border:1px solid #22c55e; color:#4ade80; border-radius:999px; padding:2px 8px; font-size:0.7rem; font-weight:800;"\x3E✓ Zakończony' + (item.completedAt ? (' (' + escapeHTML(item.completedAt) + ')') : '') + '\x3C/span\x3E';
            } else if (item.status === 'active') {
                statusPill = '\x3Cspan style="background:rgba(2, 132, 199, 0.2); border:1px solid var(--primary); color:#38bdf8; border-radius:999px; padding:2px 8px; font-size:0.7rem; font-weight:800;"\x3E🔵 Aktywny na szlaku\x3C/span\x3E';
            } else {
                statusPill = '\x3Cspan style="background:rgba(245, 158, 11, 0.16); border:1px solid #f59e0b; color:#fbbf24; border-radius:999px; padding:2px 8px; font-size:0.7rem; font-weight:800;"\x3E⏳ Oczekuje (' + (idx + 1) + '/' + items.length + ')\x3C/span\x3E';
            }

            let tagsHtml = '';
            if (item.tags && typeof item.tags === 'object') {
                Object.keys(item.tags).forEach(k => {
                    const t = item.tags[k];
                    if (!t) return;
                    const isP115 = /p115/i.test(t);
                    const tagStyle = isP115
                        ? 'background:rgba(239, 68, 68, 0.18); border:1px solid #ef4444; color:#fca5a5;'
                        : 'background:rgba(236, 72, 153, 0.18); border:1px solid #ec4899; color:#f472b6;';
                    tagsHtml += '\x3Cspan style="display:inline-flex; align-items:center; gap:3px; border-radius:6px; padding:2px 6px; font-size:0.7rem; font-weight:800; ' + tagStyle + '"\x3E' +
                        escapeHTML(k) + ': ' + escapeHTML(t) +
                    '\x3C/span\x3E ';
                });
            }

            const trNum = item.trainNumber || '';
            const trName = item.trainName ? (' ' + item.trainName) : '';
            const startName = item.startStationName || 'Start';
            const endName = item.endStationName || 'Koniec';
            const depTime = item.depTime ? (' (' + item.depTime + ')') : '';
            const arrTime = item.arrTime ? (' (' + item.arrTime + ')') : '';

            itemsHtml +=
                '\x3Cdiv class="history-card" style="background:var(--input-bg); border:1.5px solid var(--glass-border); border-radius:12px; padding:12px; margin-bottom:10px;"\x3E' +
                    '\x3Cdiv style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;"\x3E' +
                        '\x3Cdiv\x3E' +
                            '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                                '\x3Cspan style="font-weight:900; font-size:1.05rem; color:var(--primary);"\x3E#' + escapeHTML(trNum) + '\x3C/span\x3E' +
                                '\x3Cspan style="font-weight:800; font-size:0.95rem; color:var(--text);"\x3E' + escapeHTML(trName) + '\x3C/span\x3E' +
                            '\x3C/div\x3E' +
                            '\x3Cdiv style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;"\x3E' +
                                'Odcinek DK: \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(startName) + escapeHTML(depTime) + ' \u2794 ' + escapeHTML(endName) + escapeHTML(arrTime) + '\x3C/strong\x3E' +
                            '\x3C/div\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="text-align:right;"\x3E' + statusPill + '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                    (tagsHtml ? ('\x3Cdiv style="margin-bottom:8px; display:flex; flex-wrap:wrap; gap:4px;"\x3E' + tagsHtml + '\x3C/div\x3E') : '') +
                    '\x3Cdiv style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;"\x3E' +
                        '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" data-itemid="' + escapeHTML(item.id) + '" onclick="window.launchPlannedTrain(this.dataset.date, this.dataset.itemid)" class="menu-btn menu-btn-primary" style="flex:2; min-height:42px; font-size:0.82rem; font-weight:900; justify-content:center; gap:4px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Erocket_launch\x3C/span\x3E Uruchom (1-Tap)' +
                        '\x3C/button\x3E' +
                        '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" data-itemid="' + escapeHTML(item.id) + '" onclick="window.openAddTrainToPlanModal(this.dataset.date, this.dataset.itemid)" class="menu-btn menu-btn-secondary" style="flex:1; min-height:42px; font-size:0.78rem; font-weight:800; justify-content:center; padding:4px 8px;"\x3E' +
                            'Edytuj' +
                        '\x3C/button\x3E' +
                        '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" data-itemid="' + escapeHTML(item.id) + '" onclick="window.deleteDutyPlanItemPrompt(this.dataset.date, this.dataset.itemid)" style="background:transparent; border:none; color:#f87171; cursor:pointer; padding:6px 8px; font-weight:800; font-size:0.75rem;" title="Usuń z planu"\x3E' +
                            'Usuń' +
                        '\x3C/button\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E';
        });
    }

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:92vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Ecalendar_month\x3C/span\x3E Planer służby (Moje pociągi)' +
                    '\x3Cspan style="font-size:0.75rem; font-weight:800; background:rgba(2,132,199,0.18); border:1px solid var(--primary); color:var(--primary); padding:1px 7px; border-radius:999px;"\x3E' + items.length + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +

            // WYBÓR DATY SŁUŻBY
            '\x3Cdiv style="background:var(--input-bg); border:1px solid var(--glass-border); border-radius:10px; padding:8px 10px; margin-bottom:12px;"\x3E' +
                '\x3Cdiv style="display:flex; gap:6px; margin-bottom:6px;"\x3E' +
                    '\x3Cbutton type="button" data-date="' + escapeHTML(yesterdayStr) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" class="date-quick-btn' + (curDate === yesterdayStr ? ' active' : '') + '" style="flex:1;"\x3EWczoraj\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-date="' + escapeHTML(todayStr) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" class="date-quick-btn' + (curDate === todayStr ? ' active' : '') + '" style="flex:1;"\x3EDzisiaj\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-date="' + escapeHTML(tomorrowStr) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" class="date-quick-btn' + (curDate === tomorrowStr ? ' active' : '') + '" style="flex:1;"\x3EJutro\x3C/button\x3E' +
                '\x3C/div\x3E' +
                '\x3Cinput type="date" value="' + escapeHTML(curDate) + '" onchange="window.openDutyPlannerModal(this.value)" style="width:100%; margin-bottom:0; padding:6px 10px; font-weight:700; font-size:0.88rem;"\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="max-height:55vh; overflow-y:auto; padding-right:2px;"\x3E' + itemsHtml + '\x3C/div\x3E' +

            '\x3Cdiv style="display:flex; gap:8px; margin-top:12px;"\x3E' +
                '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" onclick="window.openAddTrainToPlanModal(this.dataset.date)" class="menu-btn menu-btn-primary" style="flex:2; min-height:48px; font-weight:900; font-size:0.95rem; justify-content:center; gap:6px; background:linear-gradient(135deg, #0284c7, #2563eb); border-color:#38bdf8;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eadd_circle\x3C/span\x3E + Dodaj pociąg do służby' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" class="menu-btn menu-btn-secondary" style="flex:1; min-height:48px; font-weight:800; justify-content:center;"\x3E' +
                    'Zamknij' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
};

window.openAddTrainToPlanModal = async function(targetDateStr, editItemId = null) {
    window.closeCzuwakSheet();
    const curDate = targetDateStr || window.selectedTrainDepartureDate || getLocalYYYYMMDD(new Date());

    window._plannerDraftTags = {};
    window._plannerLoadedTrain = null;
    let prefilledNum = '';
    let savedStart = 0;
    let savedEnd = null;

    if (editItemId) {
        const store = await getDutyPlanStore();
        const items = store[curDate] || [];
        const existing = items.find(i => String(i.id) === String(editItemId));
        if (existing) {
            prefilledNum = existing.trainNumber || '';
            savedStart = existing.startStationIdx || 0;
            savedEnd = existing.endStationIdx || null;
            if (existing.tags && typeof existing.tags === 'object') {
                window._plannerDraftTags = Object.assign({}, existing.tags);
            }
        }
    }

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:92vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3E' + (editItemId ? 'edit' : 'add_circle') + '\x3C/span\x3E ' +
                    (editItemId ? 'Edytuj pociąg w służbie' : 'Zaplanuj pociąg do służby') +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px;"\x3E' +
                'Data służby: \x3Cstrong style="color:var(--primary); font-size:0.86rem;"\x3E' + escapeHTML(curDate) + '\x3C/strong\x3E' +
            '\x3C/div\x3E' +

            // KROK 1: NUMER LUB NAZWA POCIĄGU
            '\x3Cdiv style="background:var(--input-bg); border:1px solid var(--glass-border); border-radius:10px; padding:10px 12px; margin-bottom:12px;"\x3E' +
                '\x3Clabel for="plannerTrainInput" style="display:block; font-size:0.82rem; font-weight:800; color:var(--text); margin-bottom:6px;"\x3E1. Wpisz numer lub nazwę pociągu:\x3C/label\x3E' +
                '\x3Cdiv style="display:flex; gap:6px;"\x3E' +
                    '\x3Cinput type="text" id="plannerTrainInput" list="trainsDictionary" value="' + escapeHTML(prefilledNum) + '" placeholder="np. 14101 lub HUTNIK..." onchange="window.plannerLoadTrainDetails(this.value)" style="flex:1; margin-bottom:0; font-weight:800; font-size:0.95rem; min-height:44px;"\x3E' +
                    '\x3Cbutton type="button" onclick="window.plannerLoadTrainDetails(document.getElementById(\'plannerTrainInput\').value)" class="menu-btn menu-btn-primary" style="min-height:44px; padding:4px 12px; font-weight:800; font-size:0.8rem; flex-shrink:0;"\x3EWczytaj\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +

            // KROK 2 & 3: KONTENER Z TRASĄ, ODCINKIEM DK I STACJAMI
            '\x3Cdiv id="plannerTrainDetailsSection" style="display:none;"\x3E' +
                '\x3Cdiv style="background:rgba(2, 132, 199, 0.08); border:1px solid rgba(2, 132, 199, 0.3); border-radius:10px; padding:10px 12px; margin-bottom:12px;"\x3E' +
                    '\x3Cdiv style="font-size:0.84rem; font-weight:800; color:var(--primary); margin-bottom:8px; display:flex; align-items:center; gap:5px;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem;"\x3Ebadge\x3C/span\x3E 2. Wybierz swój odcinek obsługi DK:' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="margin-bottom:8px;"\x3E' +
                        '\x3Clabel style="display:block; font-size:0.75rem; font-weight:700; color:var(--text-muted); margin-bottom:3px;"\x3EStacja objęcia pociągu (Start DK):\x3C/label\x3E' +
                        '\x3Cselect id="plannerDutyStartSelect" onchange="window.plannerOnStationDutyChange()" style="width:100%; min-height:44px; font-weight:700; font-size:0.88rem; background:var(--input-bg); color:var(--text); border:1px solid var(--input-border); border-radius:8px; padding:6px 10px;"\x3E\x3C/select\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv\x3E' +
                        '\x3Clabel style="display:block; font-size:0.75rem; font-weight:700; color:var(--text-muted); margin-bottom:3px;"\x3EStacja zdania pociągu (Zmiana DK):\x3C/label\x3E' +
                        '\x3Cselect id="plannerDutyEndSelect" onchange="window.plannerOnStationDutyChange()" style="width:100%; min-height:44px; font-weight:700; font-size:0.88rem; background:var(--input-bg); color:var(--text); border:1px solid var(--input-border); border-radius:8px; padding:6px 10px;"\x3E\x3C/select\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E' +

                '\x3Cdiv style="margin-bottom:12px;"\x3E' +
                    '\x3Cdiv style="font-size:0.84rem; font-weight:800; color:var(--text); margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;"\x3E' +
                        '\x3Cspan\x3E3. Stacje odcinka DK (Procedura P115 i znaczniki):\x3C/span\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="max-height:30vh; overflow-y:auto; border:1px solid var(--glass-border); border-radius:10px; background:rgba(0,0,0,0.15);"\x3E' +
                        '\x3Ctable style="width:100%; border-collapse:collapse; font-size:0.78rem;"\x3E' +
                            '\x3Ctbody id="plannerStationsChecklist"\x3E\x3C/tbody\x3E' +
                        '\x3C/table\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;"\x3EKliknij \x22+ P115 / Notatka\x22 przy stacji, aby ustawić mruganie ekranu P115 z numerami wagonów lub znacznik PRM.\x3C/div\x3E' +
                '\x3C/div\x3E' +

                '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                    '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" data-editid="' + escapeHTML(editItemId || '') + '" onclick="window.saveCurrentTrainToPlan(this.dataset.date, this.dataset.editid)" class="menu-btn menu-btn-primary" style="flex:2; min-height:48px; font-weight:900; font-size:0.95rem; justify-content:center; gap:6px; background:linear-gradient(135deg, #059669, #10b981); border-color:#34d399;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined"\x3Esave\x3C/span\x3E Zapisz w planie służby' +
                    '\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-date="' + escapeHTML(curDate) + '" onclick="window.openDutyPlannerModal(this.dataset.date)" class="menu-btn menu-btn-secondary" style="flex:1; min-height:48px; font-weight:800; justify-content:center;"\x3E' +
                        'Anuluj' +
                    '\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);

    if (prefilledNum) {
        window.plannerLoadTrainDetails(prefilledNum);
        if (savedEnd !== null) {
            window.plannerRenderDutySelectors(window._plannerLoadedTrain, savedStart, savedEnd);
        }
    }
};

window.plannerLoadTrainDetails = function(rawInput) {
    if (!rawInput) return;
    const cleanNum = rawInput.includes(' | ') ? rawInput.split(' | ')[0].trim() : rawInput.trim();
    if (!cleanNum) return;

    if (!bazaPociagow || bazaPociagow.length === 0) {
        alert('Baza pociągów nie została jeszcze załadowana.');
        return;
    }

    let matches = bazaPociagow.filter(p => String(p.numer) === cleanNum);
    if (matches.length === 0) {
        matches = bazaPociagow.filter(p => p.nazwa && String(p.nazwa).toUpperCase() === cleanNum.toUpperCase());
    }
    if (matches.length === 0) {
        matches = bazaPociagow.filter(p => p.nazwa && String(p.nazwa).toUpperCase().includes(cleanNum.toUpperCase()));
    }
    if (matches.length === 0) {
        alert('Nie znaleziono pociągu: ' + cleanNum);
        return;
    }

    const train = matches[0];
    window._plannerLoadedTrain = train;
    window.plannerRenderDutySelectors(train);
};

window.plannerRenderDutySelectors = function(train, savedStartIdx = 0, savedEndIdx = null) {
    if (!train) return;
    const stacjeArray = Array.isArray(train.stacje) ? train.stacje : Object.values(train.stacje || {});
    if (stacjeArray.length < 2) {
        alert('Ten pociąg nie ma listy stacji.');
        return;
    }

    const totalStations = stacjeArray.length;
    const sIdx = Math.max(0, Math.min(totalStations - 2, savedStartIdx));
    const eIdx = (savedEndIdx !== null && savedEndIdx !== undefined)
        ? Math.max(sIdx + 1, Math.min(totalStations - 1, savedEndIdx))
        : (totalStations - 1);

    const startSel = document.getElementById('plannerDutyStartSelect');
    const endSel = document.getElementById('plannerDutyEndSelect');
    const boxEl = document.getElementById('plannerTrainDetailsSection');
    if (!startSel || !endSel || !boxEl) return;

    let startOpts = '';
    let endOpts = '';
    stacjeArray.forEach((st, idx) => {
        const sName = (typeof st === 'object' && st.nazwa) ? st.nazwa : ('Stacja ' + (idx + 1));
        const depStr = (typeof st === 'object' && st.odjazd && st.odjazd !== '-') ? (' (odj. ' + st.odjazd + ')') : '';
        const arrStr = (typeof st === 'object' && st.przyjazd && st.przyjazd !== '-') ? (' (przyj. ' + st.przyjazd + ')') : '';

        if (idx < totalStations - 1) {
            startOpts += '\x3Coption value="' + idx + '"' + (idx === sIdx ? ' selected' : '') + '\x3E' +
                (idx + 1) + '. ' + escapeHTML(sName + depStr) + '\x3C/option\x3E';
        }
        if (idx > 0) {
            endOpts += '\x3Coption value="' + idx + '"' + (idx === eIdx ? ' selected' : '') + '\x3E' +
                (idx + 1) + '. ' + escapeHTML(sName + arrStr) + '\x3C/option\x3E';
        }
    });

    startSel.innerHTML = startOpts;
    endSel.innerHTML = endOpts;
    boxEl.style.display = 'block';

    window.plannerRenderDutyStationsChecklist(sIdx, eIdx);
};

window.plannerOnStationDutyChange = function() {
    const startSel = document.getElementById('plannerDutyStartSelect');
    const endSel = document.getElementById('plannerDutyEndSelect');
    const sIdx = parseInt(startSel ? startSel.value : '0', 10) || 0;
    const eIdx = parseInt(endSel ? endSel.value : '0', 10) || 0;
    window.plannerRenderDutyStationsChecklist(sIdx, eIdx);
};

window.plannerRenderDutyStationsChecklist = function(sIdx, eIdx) {
    const listEl = document.getElementById('plannerStationsChecklist');
    if (!listEl || !window._plannerLoadedTrain) return;

    const stacjeArray = Array.isArray(window._plannerLoadedTrain.stacje)
        ? window._plannerLoadedTrain.stacje
        : Object.values(window._plannerLoadedTrain.stacje || {});

    let rowsHtml = '';
    for (let i = sIdx; i <= eIdx && i < stacjeArray.length; i++) {
        const st = stacjeArray[i];
        const sName = (typeof st === 'object' && st.nazwa) ? st.nazwa : ('Stacja ' + (i + 1));
        const depStr = (typeof st === 'object' && st.odjazd && st.odjazd !== '-') ? ('odj. ' + st.odjazd) : '';
        const arrStr = (typeof st === 'object' && st.przyjazd && st.przyjazd !== '-') ? ('przyj. ' + st.przyjazd) : '';
        const timeStr = [arrStr, depStr].filter(Boolean).join(' | ') || '-';

        const curTag = (window._plannerDraftTags && (window._plannerDraftTags[sName] || window._plannerDraftTags[i])) || '';
        const isP115 = /p115/i.test(curTag);

        let badgeBtn = '';
        if (curTag) {
            const bStyle = isP115
                ? 'background:rgba(239, 68, 68, 0.2); border:1px solid #ef4444; color:#fca5a5;'
                : 'background:rgba(236, 72, 153, 0.2); border:1px solid #ec4899; color:#f472b6;';
            badgeBtn = '\x3Cbutton type="button" data-idx="' + i + '" data-name="' + escapeHTML(sName) + '" onclick="window.openPlannerStationTagDialog(this.dataset.name, this.dataset.idx)" style="cursor:pointer; border-radius:6px; padding:3px 8px; font-size:0.72rem; font-weight:800; max-width:140px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ' + bStyle + '" title="Edytuj znacznik / P115"\x3E' +
                (isP115 ? '⚠️ ' : '🔖 ') + escapeHTML(curTag) +
            '\x3C/button\x3E';
        } else {
            badgeBtn = '\x3Cbutton type="button" data-idx="' + i + '" data-name="' + escapeHTML(sName) + '" onclick="window.openPlannerStationTagDialog(this.dataset.name, this.dataset.idx)" class="date-quick-btn" style="min-height:30px; padding:2px 8px; font-size:0.72rem; font-weight:700;"\x3E' +
                '+ P115 / Notatka' +
            '\x3C/button\x3E';
        }

        const isTerminal = (i === sIdx || i === eIdx);
        const termIcon = (i === sIdx) ? 'trip_origin' : (i === eIdx ? 'flag' : 'radio_button_unchecked');
        const termColor = (i === sIdx) ? '#22c55e' : (i === eIdx ? '#f43f5e' : 'var(--text-muted)');

        rowsHtml +=
            '\x3Ctr style="border-bottom:1px solid rgba(255,255,255,0.06); ' + (isTerminal ? 'background:rgba(255,255,255,0.02);' : '') + '"\x3E' +
                '\x3Ctd style="padding:7px 6px; text-align:left;"\x3E' +
                    '\x3Cdiv style="display:flex; align-items:center; gap:5px;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:' + termColor + ';"\x3E' + termIcon + '\x3C/span\x3E' +
                        '\x3Cdiv\x3E' +
                            '\x3Cdiv style="font-weight:' + (isTerminal ? '800' : '600') + '; font-size:0.82rem; color:var(--text);"\x3E' + escapeHTML(sName) + '\x3C/div\x3E' +
                            '\x3Cdiv style="font-size:0.7rem; color:var(--text-muted);"\x3E' + escapeHTML(timeStr) + '\x3C/div\x3E' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/td\x3E' +
                '\x3Ctd style="padding:7px 6px; text-align:right;"\x3E' + badgeBtn + '\x3C/td\x3E' +
            '\x3C/tr\x3E';
    }

    listEl.innerHTML = rowsHtml;
};

window.openPlannerStationTagDialog = function(stName, stIdxStr) {
    const stIdx = parseInt(stIdxStr, 10);
    const curTag = (window._plannerDraftTags && (window._plannerDraftTags[stName] || window._plannerDraftTags[stIdx])) || '';
    const isCurP115 = /p115/i.test(curTag) || /poza peron/i.test(curTag) || /kr[oó]tki peron/i.test(curTag);

    let p115CoachesVal = '';
    if (isCurP115) {
        const m = curTag.match(/p115\s*:\s*([^|]+)/i) || curTag.match(/poza\s*peron[a-z]*\s*:\s*([^|]+)/i);
        p115CoachesVal = m ? m[1].trim() : '';
    }

    const tagSubOverlay = document.createElement('div');
    tagSubOverlay.id = 'plannerTagSubOverlay';
    tagSubOverlay.className = 'czuwak-sheet-overlay';
    tagSubOverlay.style.zIndex = '10050';
    tagSubOverlay.onclick = (e) => { if (e.target === tagSubOverlay) tagSubOverlay.remove(); };

    const presets = [
        { label: '♿ Wózek / PRM', val: '♿ PRM' },
        { label: '🚲 Rowery', val: '🚲 Rowery' },
        { label: '👥 Grupa podróżnych', val: '👥 Grupa' },
        { label: '⚡ Awaria drzwi', val: '⚡ Awaria drzwi' }
    ];

    let presetsHtml = '';
    presets.forEach(p => {
        presetsHtml += '\x3Cbutton type="button" data-val="' + escapeHTML(p.val) + '" onclick="document.getElementById(\'plannerTagCustomInput\').value = this.dataset.val;" class="hud-btn" style="min-height:44px; text-align:left; justify-content:flex-start;"\x3E' +
            escapeHTML(p.label) +
        '\x3C/button\x3E';
    });

    tagSubOverlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:90vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.02rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Ebookmark\x3C/span\x3E Znacznik / P115: ' + escapeHTML(stName) +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="document.getElementById(\'plannerTagSubOverlay\').remove()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +

            // PROCEDURA P115
            '\x3Cdiv style="background:rgba(220, 38, 38, 0.12); border:1.5px solid #ef4444; border-radius:12px; padding:12px; margin-bottom:12px;"\x3E' +
                '\x3Clabel style="display:flex; align-items:center; gap:8px; cursor:pointer;"\x3E' +
                    '\x3Cinput type="checkbox" id="chkPlannerP115" ' + (isCurP115 ? 'checked' : '') + ' onchange="document.getElementById(\'plannerP115Box\').style.display=this.checked?\'block\':\'none\';" style="width:22px; height:22px; accent-color:#ef4444; cursor:pointer;"\x3E' +
                    '\x3Cdiv\x3E' +
                        '\x3Cdiv style="font-size:0.92rem; font-weight:900; color:#f87171; display:flex; align-items:center; gap:5px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem;"\x3Ewarning\x3C/span\x3E PROCEDURA P115 (Skład poza peronem)' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="font-size:0.75rem; color:var(--text-muted);"\x3EKrótka krawędź peronowa na stacji ' + escapeHTML(stName) + '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/label\x3E' +
                '\x3Cdiv id="plannerP115Box" style="display:' + (isCurP115 ? 'block' : 'none') + '; margin-top:10px; padding-top:8px; border-top:1px dashed rgba(239, 68, 68, 0.4);"\x3E' +
                    '\x3Clabel style="display:block; font-size:0.78rem; font-weight:800; color:#fca5a5; margin-bottom:4px;"\x3ENumery wagonów poza peronem:\x3C/label\x3E' +
                    '\x3Cinput type="text" id="plannerP115CoachesInput" value="' + escapeHTML(p115CoachesVal) + '" placeholder="np. wag. 1, 2 lub 11, 12" style="width:100%; padding:9px 12px; font-weight:800; font-size:0.92rem; border-radius:8px; border:1px solid #ef4444; background:var(--input-bg); color:var(--text);"\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="font-size:0.78rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;"\x3EInne znaczniki drużyny:\x3C/div\x3E' +
            '\x3Cdiv style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:12px;"\x3E' + presetsHtml + '\x3C/div\x3E' +

            '\x3Cdiv style="margin-bottom:14px;"\x3E' +
                '\x3Clabel style="display:block; font-size:0.8rem; font-weight:800; color:var(--text); margin-bottom:4px;"\x3ETreść notatki / tagu:\x3C/label\x3E' +
                '\x3Cinput type="text" id="plannerTagCustomInput" value="' + escapeHTML(curTag.replace(/⚠️\s*P115[^|]*(\|)?/i, '').trim()) + '" placeholder="np. ♿ PRM, pasażer na wózku..." style="width:100%; padding:9px 12px; font-weight:800; font-size:0.95rem; border-radius:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                '\x3Cbutton type="button" data-name="' + escapeHTML(stName) + '" data-idx="' + stIdx + '" onclick="const pOn=document.getElementById(\'chkPlannerP115\').checked; const pTxt=document.getElementById(\'plannerP115CoachesInput\').value.trim(); const cTxt=document.getElementById(\'plannerTagCustomInput\').value.trim(); let finalTag=\'\'; if (pOn) { finalTag = \'⚠️ P115: \' + (pTxt || \'skład poza peronem\'); if (cTxt) finalTag += \' | \' + cTxt; } else { finalTag = cTxt; } window.savePlannerStationTag(this.dataset.name, this.dataset.idx, finalTag); document.getElementById(\'plannerTagSubOverlay\').remove();" class="menu-btn menu-btn-primary" style="flex:2; min-height:48px; font-weight:900; justify-content:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Echeck\x3C/span\x3E Zapisz znacznik' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" data-name="' + escapeHTML(stName) + '" data-idx="' + stIdx + '" onclick="window.savePlannerStationTag(this.dataset.name, this.dataset.idx, null); document.getElementById(\'plannerTagSubOverlay\').remove();" class="menu-btn menu-btn-secondary" style="flex:1; min-height:48px; color:#f87171; justify-content:center;"\x3E' +
                    'Usuń' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(tagSubOverlay);
};

window.savePlannerStationTag = function(stName, stIdx, tagVal) {
    if (!window._plannerDraftTags) window._plannerDraftTags = {};
    if (tagVal) {
        window._plannerDraftTags[stName] = tagVal;
    } else {
        delete window._plannerDraftTags[stName];
        delete window._plannerDraftTags[stIdx];
    }
    const startSel = document.getElementById('plannerDutyStartSelect');
    const endSel = document.getElementById('plannerDutyEndSelect');
    const sIdx = parseInt(startSel ? startSel.value : '0', 10) || 0;
    const eIdx = parseInt(endSel ? endSel.value : '0', 10) || 0;
    window.plannerRenderDutyStationsChecklist(sIdx, eIdx);
};

window.saveCurrentTrainToPlan = async function(targetDateStr, editItemId = null) {
    if (!window._plannerLoadedTrain) {
        alert('Wybierz i załaduj najpierw pociąg.');
        return;
    }

    const startSel = document.getElementById('plannerDutyStartSelect');
    const endSel = document.getElementById('plannerDutyEndSelect');
    const sIdx = parseInt(startSel ? startSel.value : '0', 10) || 0;
    const eIdx = parseInt(endSel ? endSel.value : '0', 10) || 0;

    if (sIdx >= eIdx) {
        alert('Stacja zdania DK musi być za stacją objęcia.');
        return;
    }

    const train = window._plannerLoadedTrain;
    const stacjeArray = Array.isArray(train.stacje) ? train.stacje : Object.values(train.stacje || {});
    const startSt = stacjeArray[sIdx] || {};
    const endSt = stacjeArray[eIdx] || {};

    const startName = (typeof startSt === 'object' && startSt.nazwa) ? startSt.nazwa : ('Stacja ' + (sIdx + 1));
    const endName = (typeof endSt === 'object' && endSt.nazwa) ? endSt.nazwa : ('Stacja ' + (eIdx + 1));
    const depTime = (typeof startSt === 'object' && startSt.odjazd) ? startSt.odjazd : '-';
    const arrTime = (typeof endSt === 'object' && endSt.przyjazd) ? endSt.przyjazd : '-';

    const item = {
        id: editItemId ? String(editItemId) : String(Date.now()),
        trainNumber: String(train.numer || '').trim(),
        trainName: String(train.nazwa || '').trim(),
        relation: (stacjeArray[0] ? (stacjeArray[0].nazwa || stacjeArray[0]) : '') + ' \u2794 ' + (stacjeArray[stacjeArray.length - 1] ? (stacjeArray[stacjeArray.length - 1].nazwa || stacjeArray[stacjeArray.length - 1]) : ''),
        startStationIdx: sIdx,
        startStationName: startName,
        endStationIdx: eIdx,
        endStationName: endName,
        depTime: depTime,
        arrTime: arrTime,
        tags: Object.assign({}, window._plannerDraftTags),
        status: 'pending',
        completedAt: null
    };

    await saveDutyPlanItem(targetDateStr, item);

    if (typeof window.showActionToast === 'function') {
        window.showActionToast('✓ Zapisano pociąg #' + item.trainNumber + ' w planie służby');
    }

    window.openDutyPlannerModal(targetDateStr);
};

// ==========================================
// MOTYW APLIKACJI (CIEMNY / JASNY / SYSTEMOWY)
// ==========================================
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('themeIcon');

function getSystemTheme() {
    try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
    } catch (e) {}
    return 'dark';
}

function syncThemeUI(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeIcon) {
        if (theme === 'dark') {
            themeIcon.innerText = 'nightlight';
            themeIcon.title = 'Motyw Ciemny (kliknij: Czerń OLED)';
        } else if (theme === 'oled') {
            themeIcon.innerText = 'light_mode';
            themeIcon.title = 'Motyw Czerń OLED (kliknij: Tryb Jasny)';
        } else {
            themeIcon.innerText = 'dark_mode';
            themeIcon.title = 'Motyw Jasny (kliknij: Tryb Ciemny)';
        }
    }
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        const col = theme === 'oled' ? '#000000' : (theme === 'dark' ? '#0f172a' : '#2563eb');
        metaThemeColor.setAttribute('content', col);
    }
    const menuThemeLabel = document.getElementById('menuThemeLabel');
    if (menuThemeLabel) {
        if (theme === 'oled') menuThemeLabel.innerText = 'Motyw: Czerń OLED (0% baterii)';
        else if (theme === 'dark') menuThemeLabel.innerText = 'Motyw: Ciemny (Granat)';
        else menuThemeLabel.innerText = 'Motyw: Jasny';
    }
}

window.cycleTheme = function() {
    const themeNow = document.documentElement.getAttribute('data-theme') || 'dark';
    let newTheme = 'oled';
    if (themeNow === 'dark') newTheme = 'oled';
    else if (themeNow === 'oled') newTheme = 'light';
    else newTheme = 'dark';
    localStorage.setItem('CZUWAK_THEME_PREFERENCE', newTheme);
    syncThemeUI(newTheme);
};

window.resetThemeToAuto = function() {
    localStorage.removeItem('CZUWAK_THEME_PREFERENCE');
    const sysTheme = getSystemTheme();
    syncThemeUI(sysTheme);
    alert('Przywrócono motyw automatyczny (' + (sysTheme === 'dark' ? 'Tryb Ciemny' : 'Tryb Jasny') + '), zgodny z systemem Twojego urządzenia.');
};

if (themeToggle && themeIcon) {
    let savedPref = localStorage.getItem('CZUWAK_THEME_PREFERENCE');
    let effectiveTheme = (savedPref === 'dark' || savedPref === 'light' || savedPref === 'oled') ? savedPref : getSystemTheme();
    syncThemeUI(effectiveTheme);

    themeToggle.addEventListener('click', () => {
        window.cycleTheme();
    });

    if (window.matchMedia) {
        const mqlDark = window.matchMedia('(prefers-color-scheme: dark)');
        const mqlHandler = (e) => {
            if (!localStorage.getItem('CZUWAK_THEME_PREFERENCE')) {
                syncThemeUI(e.matches ? 'dark' : 'light');
            }
        };
        if (mqlDark.addEventListener) mqlDark.addEventListener('change', mqlHandler);
        else if (mqlDark.addListener) mqlDark.addListener(mqlHandler);
    }
}

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('menu-overlay')) {
        e.target.classList.remove('active');
    }
});

// ==========================================
// KLUCZE PAMIĘCI I ZMIENNE STANU
// ==========================================
const STATIONS_DICT_KEY = 'czuwak_v1_stations_dict';
const TRAINS_KEY = 'czuwak_v1_trains';
const RECENT_TRAINS_KEY = 'CZUWAK_RECENT_TRAINS';
const MAX_RECENT_ITEMS = 5;

// Dedykowana baza IndexedDB dla kafelków OpenRailwayMap Offline
const ormTilesDb = (typeof localforage !== 'undefined' && localforage.createInstance)
    ? localforage.createInstance({ name: 'czuwak_orm_tiles_v1', storeName: 'tiles' })
    : localforage;

let bazaPociagow = [];
window._cachedStationList = [];
let currentMode = 'train';
let currentTrainMode = 'number';

window.lastSearchedTrainNum = '';
window.lastSearchedTrainName = '';
window.activeTrackingMode = null;

// ==========================================
// KONFIGURACJA ODLEGŁOŚCI ALARMU (SUWAK 1-15 KM) I TRYBU (BUDZIK VS JEDNOKROTNY)
// ==========================================
window.getAlertDistanceKm = () => {
    const raw = parseFloat(localStorage.getItem('CZUWAK_ALERT_DISTANCE_KM') || '6.0');
    if (isNaN(raw) || raw < 1.0) return 6.0;
    if (raw > 20.0) return 20.0;
    return raw;
};

window.getAlertMode = () => {
    const m = localStorage.getItem('CZUWAK_ALERT_MODE');
    return (m === 'alarm' || m === 'once') ? m : 'once';
};

window.onAlertDistanceChange = (val) => {
    const num = Math.max(1.0, Math.min(15.0, parseFloat(val) || 6.0));
    localStorage.setItem('CZUWAK_ALERT_DISTANCE_KM', num.toFixed(1));
    window.syncAlertConfigUI();
    if (typeof window.updateOrmApproachCircle === 'function') {
        window.updateOrmApproachCircle();
    }
};

window.setAlertMode = (mode) => {
    const cleanMode = (mode === 'alarm') ? 'alarm' : 'once';
    localStorage.setItem('CZUWAK_ALERT_MODE', cleanMode);
    if (cleanMode === 'once') {
        window.stopAlarmLoop();
    }
    window.syncAlertConfigUI();
};

window.syncAlertConfigUI = () => {
    if (typeof window.syncNotificationSoundUI === 'function') {
        window.syncNotificationSoundUI();
    }
    const dist = window.getAlertDistanceKm();
    const distStr = dist.toFixed(1) + ' km';
    const mode = window.getAlertMode();
    const isEnabled = window.isStationApproachAlertsEnabled();

    const slider = document.getElementById('alertDistanceSlider');
    if (slider && parseFloat(slider.value) !== dist) {
        slider.value = dist;
    }
    const labelEl = document.getElementById('alertDistanceValueLabel');
    if (labelEl) labelEl.innerText = distStr;

    document.querySelectorAll('.preset-km-btn').forEach(btn => {
        const bVal = parseFloat(btn.dataset.km || '0');
        btn.classList.toggle('active', Math.abs(bVal - dist) < 0.05);
    });

    const btnOnce = document.getElementById('btnAlertModeOnce');
    const btnAlarm = document.getElementById('btnAlertModeAlarm');
    if (btnOnce) {
        btnOnce.style.borderColor = (mode === 'once') ? 'var(--primary)' : '';
        btnOnce.style.background = (mode === 'once') ? 'rgba(2, 132, 199, 0.16)' : '';
    }
    if (btnAlarm) {
        btnAlarm.style.borderColor = (mode === 'alarm') ? 'var(--warning)' : '';
        btnAlarm.style.background = (mode === 'alarm') ? 'rgba(245, 158, 11, 0.16)' : '';
    }

    const stripDist = document.getElementById('stripAlertDist');
    if (stripDist) stripDist.innerText = isEnabled ? distStr : 'WYŁ.';
    const stripMode = document.getElementById('stripAlertMode');
    if (stripMode) {
        stripMode.innerText = !isEnabled
            ? 'Wyłączony'
            : (mode === 'alarm' ? 'Budzik (do potwierdzenia)' : 'Jednokrotny');
        stripMode.style.color = !isEnabled
            ? 'var(--danger)'
            : (mode === 'alarm' ? 'var(--warning)' : 'var(--primary)');
    }

    const btnToggle = document.getElementById('btnToggleStationAlerts');
    if (btnToggle) {
        if (isEnabled) {
            btnToggle.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--open); font-size:1.15rem;"\x3Enotifications_active\x3C/span\x3E Alarm stacyjny (' + distStr + '): WŁĄCZONY';
        } else {
            btnToggle.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--text-muted); font-size:1.15rem;"\x3Enotifications_off\x3C/span\x3E Alarm stacyjny (' + distStr + '): WYŁĄCZONY';
        }
    }

    const routeGpsBtnLabel = document.getElementById('routeCardGpsBtnLabel');
    if (routeGpsBtnLabel) {
        routeGpsBtnLabel.innerText = 'Włącz Czuwak GPS (' + distStr + ')';
    }
};

// ==========================================
// ZAPOBIEGANIE WYŁĄCZANIU EKRANU (WAKE LOCK)
// ==========================================
window._screenWakeLock = null;

window.requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try {
            window._screenWakeLock = await navigator.wakeLock.request('screen');
            window._screenWakeLock.addEventListener('release', () => {
                window._screenWakeLock = null;
            });
        } catch (err) {
            console.warn('Błąd aktywacji Wake Lock:', err);
        }
    }
};

window.releaseWakeLock = () => {
    if (window._screenWakeLock) {
        try { window._screenWakeLock.release(); } catch (e) {}
        window._screenWakeLock = null;
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.activeTrackingMode === 'gps') {
        window.requestWakeLock();
    }
});

// ==========================================
// AKUSTYCZNY GONG KOLEJOWY I TRYB BUDZIKA
// ==========================================
window._akbAudioCtx = null;
window._alarmLoopInterval = null;
window._alarmAcknowledgedForKey = new Set();

window.isStationApproachAlertsEnabled = () => {
    return localStorage.getItem('CZUWAK_STATION_ALERTS_ENABLED') !== 'false';
};

window.toggleStationApproachAlerts = () => {
    const currentState = window.isStationApproachAlertsEnabled();
    const newState = !currentState;
    localStorage.setItem('CZUWAK_STATION_ALERTS_ENABLED', newState ? 'true' : 'false');
    window.syncAlertConfigUI();
    if (!newState) {
        window.dismissStationApproachToast();
    }
};

window.updateStationAlertsMenuButton = () => {
    window.syncAlertConfigUI();
};

// ==========================================
// SYSTEM DŹWIĘKÓW CZUWAKA (3 DŹWIĘKI + WŁASNY Z TELEFONU W INDEXEDDB)
// ==========================================
const CUSTOM_SOUND_IDB_KEY = 'CZUWAK_CUSTOM_SOUND_DATA_IDB';
window._currentAudioPlayer = null;
window._cachedCustomSoundData = null;

// Inicjalne załadowanie własnego dźwięku z IndexedDB (oraz migracja ze starego localStorage)
(async function initCustomSoundFromIdb() {
    try {
        const legacyData = localStorage.getItem('CZUWAK_CUSTOM_SOUND_DATA');
        if (legacyData) {
            window._cachedCustomSoundData = legacyData;
            if (typeof localforage !== 'undefined') {
                await localforage.setItem(CUSTOM_SOUND_IDB_KEY, legacyData);
                localStorage.removeItem('CZUWAK_CUSTOM_SOUND_DATA');
            }
        } else if (typeof localforage !== 'undefined') {
            const idbData = await localforage.getItem(CUSTOM_SOUND_IDB_KEY);
            if (idbData) {
                window._cachedCustomSoundData = idbData;
            }
        }
        if (typeof window.syncNotificationSoundUI === 'function') {
            window.syncNotificationSoundUI();
        }
    } catch (e) {}
})();

window.getNotificationSoundType = () => {
    const s = localStorage.getItem('CZUWAK_NOTIFICATION_SOUND_TYPE');
    return (s === 'radar' || s === 'horn' || s === 'custom') ? s : 'chime';
};

window.setNotificationSound = (type) => {
    const cleanType = (type === 'radar' || type === 'horn' || type === 'custom') ? type : 'chime';
    localStorage.setItem('CZUWAK_NOTIFICATION_SOUND_TYPE', cleanType);
    window.syncNotificationSoundUI();
    window.playNotificationSound(cleanType);
};

window.handleCustomSoundSelected = (inputEl) => {
    if (!inputEl || !inputEl.files || inputEl.files.length === 0) return;
    const file = inputEl.files[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
        alert('Wybrany plik audio jest zbyt duży (maks. 12 MB). Proszę wybrać mniejszy plik dzwonka.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const dataUrl = e.target.result;
            window._cachedCustomSoundData = dataUrl;
            if (typeof localforage !== 'undefined') {
                await localforage.setItem(CUSTOM_SOUND_IDB_KEY, dataUrl);
                localStorage.removeItem('CZUWAK_CUSTOM_SOUND_DATA');
            } else {
                localStorage.setItem('CZUWAK_CUSTOM_SOUND_DATA', dataUrl);
            }
            localStorage.setItem('CZUWAK_CUSTOM_SOUND_NAME', file.name || 'Własny dźwięk');
            localStorage.setItem('CZUWAK_NOTIFICATION_SOUND_TYPE', 'custom');
            window.syncNotificationSoundUI();
            window.playNotificationSound('custom');
        } catch (err) {
            console.error('Błąd zapisu pliku audio w IndexedDB:', err);
            alert('Wystąpił błąd podczas zapisywania pliku dźwiękowego.');
        }
    };
    reader.onerror = () => {
        alert('Błąd odczytu pliku audio z urządzenia.');
    };
    reader.readAsDataURL(file);
};

window.clearCustomSound = async () => {
    window._cachedCustomSoundData = null;
    localStorage.removeItem('CZUWAK_CUSTOM_SOUND_DATA');
    localStorage.removeItem('CZUWAK_CUSTOM_SOUND_NAME');
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.removeItem(CUSTOM_SOUND_IDB_KEY);
        }
    } catch (e) {}
    localStorage.setItem('CZUWAK_NOTIFICATION_SOUND_TYPE', 'chime');
    const fileInput = document.getElementById('customAudioFileInput');
    if (fileInput) fileInput.value = '';
    window.syncNotificationSoundUI();
    window.playNotificationSound('chime');
};

window.syncNotificationSoundUI = () => {
    const curType = window.getNotificationSoundType();
    const customData = window._cachedCustomSoundData || localStorage.getItem('CZUWAK_CUSTOM_SOUND_DATA');
    const customName = localStorage.getItem('CZUWAK_CUSTOM_SOUND_NAME') || '';

    const btnChime = document.getElementById('btnSoundChime');
    const btnRadar = document.getElementById('btnSoundRadar');
    const btnHorn = document.getElementById('btnSoundHorn');
    const btnCustom = document.getElementById('btnSoundCustom');

    const updateBtn = (btn, isAct, activeColor) => {
        if (!btn) return;
        btn.style.borderColor = isAct ? activeColor : '';
        btn.style.background = isAct ? 'rgba(2, 132, 199, 0.22)' : '';
        btn.style.color = isAct ? '#ffffff' : '';
    };

    updateBtn(btnChime, curType === 'chime', 'var(--primary)');
    updateBtn(btnRadar, curType === 'radar', '#38bdf8');
    updateBtn(btnHorn, curType === 'horn', '#f59e0b');
    updateBtn(btnCustom, curType === 'custom', '#a855f7');

    const panel = document.getElementById('customSoundPanel');
    if (panel) {
        panel.style.display = (curType === 'custom') ? 'block' : 'none';
    }

    const nameLabel = document.getElementById('customSoundNameLabel');
    if (nameLabel) {
        if (customData && customName) {
            nameLabel.innerText = '📁 ' + customName;
            nameLabel.style.color = 'var(--text)';
        } else {
            nameLabel.innerText = 'Brak wybranego pliku (kliknij „Wybierz z pamięci”)';
            nameLabel.style.color = 'var(--text-muted)';
        }
    }

    const delBtn = document.getElementById('btnDeleteCustomSound');
    if (delBtn) {
        delBtn.style.display = (customData || customName) ? 'inline-flex' : 'none';
    }
};

window.playCurrentNotificationSound = () => {
    window.playNotificationSound();
};

// Synteza Web Audio dla 3 wbudowanych sygnałów Czuwaka
window.playSynthesizedSound = (soundType) => {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!window._akbAudioCtx) {
            window._akbAudioCtx = new AudioCtx();
        }
        const ctx = window._akbAudioCtx;
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const now = ctx.currentTime;

        if (soundType === 'radar') {
            // Dźwięk 2: Radar Czuwaka (Nowoczesny sonar pokładowy)
            const playChirp = (startOffset, fStart, fEnd, duration, peakGain) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(fStart, now + startOffset);
                osc.frequency.exponentialRampToValueAtTime(fEnd, now + startOffset + duration);

                gain.gain.setValueAtTime(0.001, now + startOffset);
                gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + startOffset);
                osc.stop(now + startOffset + duration + 0.05);
            };

            // Główny impuls sonaru
            playChirp(0.00, 520, 980, 0.22, 0.95);
            // Wyższa harmoniczna
            playChirp(0.00, 1040, 1960, 0.18, 0.35);
            // Subtelne echo po 280 ms
            playChirp(0.28, 880, 1320, 0.20, 0.60);
        } else if (soundType === 'horn') {
            // Dźwięk 3: Sygnał pociągu (Trąbka lokomotywy PKP)
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1900, now);
            filter.connect(ctx.destination);

            const freqs = [311.13, 370.00, 466.16, 622.25]; // Akord lokomotywy PKP

            const playBlast = (startOffset, duration, peakGain) => {
                const blastGain = ctx.createGain();
                blastGain.gain.setValueAtTime(0.001, now + startOffset);
                blastGain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.03);
                blastGain.gain.setValueAtTime(peakGain * 0.95, now + startOffset + duration - 0.05);
                blastGain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
                blastGain.connect(filter);

                freqs.forEach(f => {
                    const osc = ctx.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(f, now + startOffset);
                    osc.connect(blastGain);
                    osc.start(now + startOffset);
                    osc.stop(now + startOffset + duration + 0.05);
                });
            };

            // Dwa wyraziste sygnały baczność lokomotywy
            playBlast(0.00, 0.36, 0.85);
            playBlast(0.44, 0.52, 0.95);
        } else {
            // Dźwięk 1 (Domyślny): Bim-Bam dwukrotny gong peronowy PKP
            const playTone = (freq, startOffset, duration, peakGain) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + startOffset);
                gain.gain.setValueAtTime(0.001, now + startOffset);
                gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + startOffset);
                osc.stop(now + startOffset + duration + 0.05);
            };

            // Cykl 1: Bim (698.46 Hz) -> Bam (880.00 Hz)
            playTone(698.46, 0.00, 0.40, 0.95);
            playTone(880.00, 0.30, 0.48, 1.00);

            // Cykl 2: Bim (698.46 Hz) -> Bam (880.00 Hz)
            playTone(698.46, 0.82, 0.40, 0.95);
            playTone(880.00, 1.12, 0.55, 1.00);
        }
    } catch (e) {
        console.warn('Błąd syntezy sygnału audio:', e);
    }
};

window.playNotificationSound = (explicitType = null) => {
    const soundType = explicitType || window.getNotificationSoundType();

    if (soundType === 'custom') {
        const customData = window._cachedCustomSoundData || localStorage.getItem('CZUWAK_CUSTOM_SOUND_DATA');
        if (customData) {
            try {
                if (window._currentAudioPlayer) {
                    try { window._currentAudioPlayer.pause(); } catch (e) {}
                    window._currentAudioPlayer = null;
                }
                const audio = new Audio(customData);
                audio.volume = 1.0;
                window._currentAudioPlayer = audio;
                const p = audio.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(err => {
                        console.warn('Błąd odtwarzania własnego pliku audio, fallback do gongu:', err);
                        window.playSynthesizedSound('chime');
                    });
                }
                return;
            } catch (err) {
                console.warn('Wyjątek odtwarzacza własnego audio:', err);
            }
        }
        window.playSynthesizedSound('chime');
        return;
    }

    window.playSynthesizedSound(soundType);
};

window.playStationChime = () => {
    window.playNotificationSound();
};

window.stopAlarmLoop = () => {
    if (window._alarmLoopInterval) {
        clearInterval(window._alarmLoopInterval);
        window._alarmLoopInterval = null;
    }
    if (window._currentAudioPlayer) {
        try {
            window._currentAudioPlayer.pause();
            window._currentAudioPlayer.currentTime = 0;
        } catch (e) {}
        window._currentAudioPlayer = null;
    }
    if ('vibrate' in navigator) {
        try { navigator.vibrate(0); } catch (e) {}
    }
};

window.showCzuwakWidgetActionToast = (message, icon = 'check_circle', color = '#4ade80') => {
    let toast = document.getElementById('czuwakActionToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'czuwakActionToast';
        toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:99998; background:rgba(15,23,42,0.96); border:1.5px solid ' + color + '; border-radius:999px; padding:8px 18px; color:#ffffff; font-size:0.84rem; font-weight:800; display:flex; align-items:center; gap:8px; box-shadow:0 8px 24px rgba(0,0,0,0.5); backdrop-filter:blur(8px); transition:opacity 0.3s ease; animation: slideDownToast 0.3s ease-out;';
        document.body.appendChild(toast);
    }
    toast.style.borderColor = color;
    toast.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm" style="color:' + color + ';"\x3E' + icon + '\x3C/span\x3E ' +
        '\x3Cspan\x3E' + escapeHTML(message) + '\x3C/span\x3E';
    toast.style.display = 'flex';
    toast.style.opacity = '1';

    if (window._czuwakActionToastTimer) clearTimeout(window._czuwakActionToastTimer);
    window._czuwakActionToastTimer = setTimeout(() => {
        if (toast) {
            toast.style.opacity = '0';
            setTimeout(() => { if (toast) toast.style.display = 'none'; }, 300);
        }
    }, 3800);
};

window.syncPendingWidgetEvents = () => {
    if (!window.CzuwakNativeWidget || typeof window.CzuwakNativeWidget.getPendingEvents !== 'function') return;
    try {
        const rawJson = window.CzuwakNativeWidget.getPendingEvents();
        if (!rawJson || rawJson === '{}') return;
        const events = JSON.parse(rawJson);

        if (events.stopChecked && typeof events.stopIdx === 'number' && events.stopIdx >= 0) {
            const stopIdx = events.stopIdx;
            const stopTime = events.stopTime || formatNowHHMMSS();
            window.recordStationArrivalStop(stopIdx, stopTime);

            let stName = 'Stacja ' + (stopIdx + 1);
            if (window._currentTrainObject && window._currentTrainObject.stacje) {
                const arr = Array.isArray(window._currentTrainObject.stacje)
                    ? window._currentTrainObject.stacje
                    : Object.values(window._currentTrainObject.stacje);
                if (arr[stopIdx]) {
                    const st = arr[stopIdx];
                    stName = (typeof st === 'object' && st.nazwa) ? st.nazwa : (typeof st === 'string' ? st : stName);
                }
            }
            window.showCzuwakWidgetActionToast('Post\u00f3j odhaczony z pulpitu: ' + stName + ' (' + stopTime + ')', 'check_circle', '#4ade80');
        }

        if (events.delayChanged && typeof events.delayMinutes === 'number') {
            window.setTrainDelay(events.delayMinutes);
            window.showCzuwakWidgetActionToast('Op\u00f3\u017anienie podbite z pulpitu: +' + events.delayMinutes + ' min', 'schedule', '#fbbf24');
        }
    } catch (e) {
        console.warn('B\u0142\u0105d synchronizacji zdarze\u0144 widgetu:', e);
    }
};

window.acknowledgeStationAlarm = () => {
    window.stopAlarmLoop();
    document.body.classList.remove('p115-screen-active');
    if (window._currentActiveAlertKey) {
        window._alarmAcknowledgedForKey.add(window._currentActiveAlertKey);
    }
    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'ALERT', 'Potwierdzono i wyciszono alarm stacyjny (klucz=' + (window._currentActiveAlertKey || 'brak') + ')');
    }
    const ackBtn = document.getElementById('btnAckStationAlarm');
    if (ackBtn) {
        ackBtn.style.background = 'var(--open)';
        ackBtn.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Echeck_circle\x3C/span\x3E Potwierdzono – budzik wyciszony';
        setTimeout(() => {
            if (ackBtn && ackBtn.parentNode) ackBtn.remove();
        }, 1200);
    }
    const toast = document.getElementById('stationApproachToast');
    if (toast) {
        toast.style.borderColor = 'var(--primary)';
    }
};

window.dismissStationApproachToast = () => {
    window.stopAlarmLoop();
    document.body.classList.remove('p115-screen-active');
    const toast = document.getElementById('stationApproachToast');
    if (toast) {
        toast.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => { if (toast && toast.parentNode) toast.remove(); }, 350);
    }
};

window.updateStationApproachToast = (stationName, distanceKm, isEstimated = false) => {
    const toast = document.getElementById('stationApproachToast');
    if (!toast) return;
    const nameEl = document.getElementById('stationApproachToastName');
    if (nameEl) nameEl.textContent = stationName;
    const distEl = document.getElementById('stationApproachToastDist');
    if (distEl) {
        const estTag = isEstimated ? ' (szacowane)' : '';
        distEl.innerHTML = 'Pozostało ok. \x3Cstrong style="color:#38bdf8; font-size:1.05rem;"\x3E' + distanceKm.toFixed(1) + ' km' + estTag + '\x3C/strong\x3E. Wygłoś komunikat pożegnalny.';
    }
};

async function fireNativeOrWebNotification(notifTitle, notifBody, alertKey) {
    try {
        const LocalNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
        if (LocalNotifications) {
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== 'granted') {
                await LocalNotifications.requestPermissions();
            }

            // Utwórz priorytetowy kanał powiadomień w systemie Android z ominięciem trybu Nie przeszkadzać (DND)
            if (typeof LocalNotifications.createChannel === 'function') {
                try {
                    await LocalNotifications.createChannel({
                        id: 'czuwak_approach_alarm_channel',
                        name: 'Czuwak – Alarm i zbliżanie do stacji',
                        description: 'Priorytetowe powiadomienia o zbliżaniu się do stacji z dźwiękiem, wibracją i ominięciem trybu Nie przeszkadzać (DND)',
                        importance: 5,
                        visibility: 1,
                        vibration: true,
                        lights: true,
                        lightColor: '#f59e0b',
                        bypassDnd: true
                    });
                } catch (chErr) {}
            }

            const alertMode = window.getAlertMode ? window.getAlertMode() : 'alarm';
            const isAlarmMode = (alertMode === 'alarm');

            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: notifTitle,
                        body: notifBody,
                        id: Math.abs(alertKey.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 100000 || 1001,
                        channelId: 'czuwak_approach_alarm_channel',
                        schedule: { at: new Date(Date.now() + 100) },
                        sound: 'default',
                        ongoing: isAlarmMode,
                        autoCancel: !isAlarmMode
                    }
                ]
            });
            return;
        }
    } catch (e) {
        console.warn('Błąd powiadomienia Capacitor:', e);
    }

    if ('Notification' in window && Notification.permission === 'granted') {
        const notifOptions = {
            body: notifBody,
            icon: 'favicon.svg',
            badge: 'favicon.svg',
            tag: 'station-approach-' + alertKey
        };

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
                if (reg && typeof reg.showNotification === 'function') {
                    return reg.showNotification(notifTitle, notifOptions);
                }
                throw new Error('Fallback to new Notification');
            }).catch(() => {
                try { new Notification(notifTitle, notifOptions); } catch (e) {}
            });
        } else {
            try { new Notification(notifTitle, notifOptions); } catch (e) {}
        }
    }
}

window._stationApproachAlertsFired = new Set();
window.triggerStationApproachAlert = (stationName, distanceKm, forceTest = false, isEstimated = false) => {
    if (!forceTest && !window.isStationApproachAlertsEnabled()) return;

    const trainNum = window._currentActiveTrainNumber || window.lastSearchedTrainNum || 'TRAIN';
    const alertKey = forceTest ? ('TEST_' + Date.now()) : (trainNum + '_' + String(stationName).toUpperCase().trim());

    if (!forceTest && window._stationApproachAlertsFired.has(alertKey)) {
        window.updateStationApproachToast(stationName, distanceKm, isEstimated);
        return;
    }
    if (!forceTest) {
        window._stationApproachAlertsFired.add(alertKey);
    }
    window._currentActiveAlertKey = alertKey;

    const alertMode = window.getAlertMode();
    const isAlarmLoopMode = (alertMode === 'alarm');

    // 1. Akustyczny podwójny gong stacyjny (Bim-Bam Bim-Bam)
    window.stopAlarmLoop();
    window.playStationChime();

    const isHandoverStation = (typeof window._crewDutyEndStationName === 'string' &&
        window._crewDutyEndStationName &&
        String(stationName).toUpperCase().trim() === window._crewDutyEndStationName);

    const stIdxMatch = window._currentRouteStationsWithGps && window._currentRouteStationsWithGps.find(s => s && s.name === String(stationName).toUpperCase().trim());
    const matchedIdx = (stIdxMatch && typeof stIdxMatch.index === 'number') ? stIdxMatch.index : -1;
    const isP115Station = window.isStationP115 ? window.isStationP115(matchedIdx, stationName) : false;
    const p115Coaches = isP115Station && window.getStationP115Coaches ? window.getStationP115Coaches(matchedIdx, stationName) : '';

    if (isP115Station) {
        document.body.classList.add('p115-screen-active');
        if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.strobeTorch === 'function') {
            try { window.CzuwakNativeWidget.strobeTorch(10, 130); } catch (e) {}
        }
    } else {
        document.body.classList.remove('p115-screen-active');
    }

    if (typeof window.czuwakLog === 'function') {
        const dStr = (typeof distanceKm === 'number') ? (distanceKm >= 1 ? distanceKm.toFixed(2) + ' km' : Math.round(distanceKm * 1000) + ' m') : '?';
        window.czuwakLog('INFO', 'ALERT', 'Alarm zbliżania do stacji: ' + stationName + ' (' + dStr + (isEstimated ? ', tunel/estymacja' : '') + ', tryb=' + alertMode + (isHandoverStation ? ', STACJA ZMIANY DK' : '') + (isP115Station ? ', PROCEDURA P115' : '') + ')');
    }

    // 2. Zsynchronizowana wibracja urządzenia (różny wzorzec dla P115 vs stacji zmiany DK vs pośredniej)
    const hapticPattern = isP115Station
        ? [350, 120, 350, 120, 350, 120, 500, 200, 500]
        : (isHandoverStation
            ? [400, 150, 400, 150, 600, 200, 800]
            : [250, 100, 250, 350, 250, 100, 250]);

    if ('vibrate' in navigator) {
        try { navigator.vibrate(hapticPattern); } catch (e) {}
    }

    // Jeśli wybrany jest TRYB BUDZIKA (alarm), zapętlamy gong i wibrację co 3.8s do czasu potwierdzenia!
    if (isAlarmLoopMode) {
        window._alarmLoopInterval = setInterval(() => {
            if (window._alarmAcknowledgedForKey.has(alertKey)) {
                window.stopAlarmLoop();
                document.body.classList.remove('p115-screen-active');
                return;
            }
            window.playStationChime();
            if ('vibrate' in navigator) {
                try { navigator.vibrate(hapticPattern); } catch (e) {}
            }
            if (isP115Station && window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.strobeTorch === 'function') {
                try { window.CzuwakNativeWidget.strobeTorch(6, 130); } catch (e) {}
            }
        }, 3800);
    }

    // 3. Pływający baner wizualny w dolnej strefie kciuka z odliczaniem kilometrów
    let toast = document.getElementById('stationApproachToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stationApproachToast';
        toast.className = 'glass-panel';
        document.body.appendChild(toast);
    }
    const borderCol = isP115Station ? '#ef4444' : (isAlarmLoopMode ? '#f59e0b' : 'var(--primary)');
    toast.className = 'glass-panel' + (isP115Station ? ' p115-strobe-alert' : '');
    toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:99999; max-width:94%; width:460px; padding:16px 18px; border-radius:16px; background:rgba(15, 23, 42, 0.98); border:2px solid ' + borderCol + '; box-shadow:0 -10px 30px rgba(0,0,0,0.85), 0 0 25px rgba(245, 158, 11, 0.4); display:flex; flex-direction:column; gap:12px; animation: slideUpToast 0.3s ease-out;';

    const estTag = isEstimated ? ' (estymacja w tunelu)' : '';

    let tagAlertNoticeHtml = '';
    if (stIdxMatch && typeof stIdxMatch.index === 'number') {
        const stationTagText = window.getStationTag(stIdxMatch.index);
        if (stationTagText && !isP115Station) {
            tagAlertNoticeHtml = '\x3Cdiv style="padding:6px 12px; border-radius:8px; background:rgba(236,72,153,0.18); border:1px solid #ec4899; color:#f472b6; font-size:0.82rem; font-weight:800; display:flex; align-items:center; gap:6px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Ebookmark\x3C/span\x3E Znacznik drużyny: ' + escapeHTML(stationTagText) +
            '\x3C/div\x3E';
        }
    }

    let p115BannerHtml = '';
    if (isP115Station) {
        const coachesHtml = p115Coaches
            ? ('\x3Cdiv style="font-size:1.05rem; font-weight:900; margin-top:6px; background:rgba(0,0,0,0.4); border-radius:8px; padding:6px 10px; border:1px solid rgba(255,255,255,0.45); color:#fff;"\x3E' +
                'Poza krawędzią: \x3Cstrong style="color:#fef08a;"\x3E' + escapeHTML(p115Coaches) + '\x3C/strong\x3E' +
               '\x3C/div\x3E')
            : '';
        p115BannerHtml =
            '\x3Cdiv style="background:#dc2626; color:#ffffff; border-radius:12px; padding:12px 14px; text-align:center; box-shadow:0 0 25px rgba(239, 68, 68, 0.9); border:2px solid #fecaca; margin-bottom:4px;"\x3E' +
                '\x3Cdiv style="font-size:1.35rem; font-weight:900; letter-spacing:1px; display:flex; align-items:center; justify-content:center; gap:8px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1.75rem;"\x3Ewarning\x3C/span\x3E ' +
                    'PROCEDURA P115' +
                '\x3C/div\x3E' +
                '\x3Cdiv style="font-size:0.95rem; font-weight:800; margin-top:2px;"\x3E' +
                    'SKŁAD POCIĄGU NIE MIEŚCI SIĘ W PERONIE!' +
                '\x3C/div\x3E' +
                coachesHtml +
            '\x3C/div\x3E';
    }

    const handoverButtonHtml = isHandoverStation
        ? ('\x3Cbutton type="button" data-stname="' + escapeHTML(stationName) + '" onclick="window.completeCrewDutyAndStopCzuwak(this.dataset.stname, \'Odhaczono stację zmiany DK na banerze alarmu\')" style="width:100%; min-height:52px; padding:12px 16px; border-radius:12px; border:1.5px solid #22c55e; background:rgba(34, 197, 94, 0.22); color:#4ade80; font-weight:900; font-size:0.95rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; letter-spacing:0.4px;"\x3E' +
            '\x3Cspan class="material-symbols-outlined"\x3Etask_alt\x3C/span\x3E Odhacz zmianę DK i wyłącz Czuwak' +
           '\x3C/button\x3E')
        : '';

    const alarmAckButtonHtml = isAlarmLoopMode
        ? ('\x3Cbutton id="btnAckStationAlarm" type="button" onclick="window.acknowledgeStationAlarm()" style="width:100%; min-height:52px; padding:12px 16px; border-radius:12px; border:none; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; font-weight:900; font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(245, 158, 11, 0.5); text-transform:uppercase; letter-spacing:0.5px;"\x3E' +
            '\x3Cspan class="material-symbols-outlined"\x3Enotifications_off\x3C/span\x3E Potwierdź komunikat / Wycisz Czuwak' +
           '\x3C/button\x3E')
        : '';

    const headerAlertLabel = isP115Station
        ? '⚠️ PROCEDURA P115 – KRÓTKI PERON!'
        : (isHandoverStation
            ? 'STACJA ZMIANY DK – KONIEC OBSŁUGI!'
            : (isAlarmLoopMode ? 'ALARM CZUWAKA – POTWIERDŹ!' : 'Zbliżasz się do stacji'));

    toast.innerHTML =
        p115BannerHtml +
        '\x3Cdiv style="display:flex; align-items:center; gap:12px; width:100%;"\x3E' +
            '\x3Cdiv style="width:44px; height:44px; border-radius:50%; background:rgba(2, 132, 199, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1.5px solid ' + borderCol + ';"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="color:' + borderCol + '; font-size:1.75rem; animation:train-pulse 1.2s infinite;"\x3E' + (isAlarmLoopMode ? 'alarm_on' : 'notification_important') + '\x3C/span\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="flex:1; min-width:0;"\x3E' +
                '\x3Cdiv style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:' + borderCol + '; font-weight:800; display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined icon-sm" style="font-size:0.9rem;"\x3Etrip_origin\x3C/span\x3E ' +
                    headerAlertLabel +
                '\x3C/div\x3E' +
                '\x3Cdiv id="stationApproachToastName" style="font-size:1.15rem; font-weight:900; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"\x3E' + escapeHTML(stationName) + '\x3C/div\x3E' +
                '\x3Cdiv id="stationApproachToastDist" style="font-size:0.86rem; color:#cbd5e1; margin-top:2px;"\x3E' +
                    'Pozostało ok. \x3Cstrong style="color:#38bdf8; font-size:1.05rem;"\x3E' + distanceKm.toFixed(1) + ' km' + estTag + '\x3C/strong\x3E. ' +
                    (isHandoverStation ? 'Wygłoś komunikat i przygotuj się do zdania składu.' : (isP115Station ? 'Zastosuj procedurę P115 dla wagonów poza peronem!' : 'Wygłoś komunikat pożegnalny.')) +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cbutton onclick="window.dismissStationApproachToast()" aria-label="Zamknij powiadomienie" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#cbd5e1; cursor:pointer; padding:8px; display:flex; align-items:center; justify-content:center; min-height:44px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
            '\x3C/button\x3E' +
        '\x3C/div\x3E' +
        tagAlertNoticeHtml +
        alarmAckButtonHtml +
        handoverButtonHtml;

    // 4. Powiadomienie systemowe Android / PWA
    const notifTitle = (isP115Station ? '⚠️ PROCEDURA P115: ' : (isHandoverStation ? 'Stacja zmiany DK: ' : 'Zbliżasz się do stacji: ')) + stationName;
    const notifBody = isP115Station
        ? ('SKŁAD NIE MIEŚCI SIĘ W PERONIE! ' + (p115Coaches ? ('Poza peronem: ' + p115Coaches + '. ') : '') + 'Pozostało ok. ' + distanceKm.toFixed(1) + ' km.')
        : ('Pozostało ok. ' + distanceKm.toFixed(1) + ' km. Wygłoś komunikat pożegnalny.');
    fireNativeOrWebNotification(notifTitle, notifBody, alertKey);
};

window.testStationAlert = () => {
    const menuEl = document.getElementById('menuOverlay');
    if (menuEl) menuEl.classList.remove('active');
    const dist = window.getAlertDistanceKm();
    window.triggerStationApproachAlert('STACJA TESTOWA', dist, true, false);
};

window.hideGpsSignalWarning = () => {
    const banner = document.getElementById('gpsSignalWarningBanner');
    if (banner) banner.style.display = 'none';
};

window.showGpsSignalWarning = (msgHtml) => {
    const banner = document.getElementById('gpsSignalWarningBanner');
    const textEl = document.getElementById('gpsSignalWarningText');
    if (textEl && msgHtml) textEl.innerHTML = msgHtml;
    if (banner) banner.style.display = 'flex';
};

// ==========================================
// KÓŁKO PRĘDKOŚCI (KM/H) I STATUSU SYGNAŁU GPS
// ==========================================
const GPS_BADGE_SVGS = {
    ok: '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/\x3E\x3C/svg\x3E',
    bts: '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M2 22h20V2L2 22zm18-2h-3V9.83l3-3V20z"/\x3E\x3C/svg\x3E',
    tunnel: '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/\x3E\x3C/svg\x3E',
    searching: '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M20.94 11A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/\x3E\x3C/svg\x3E',
    off: '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M20.94 11A8.994 8.994 0 0 0 13 3.06V1h-2v2.06c-.98.11-1.91.38-2.77.78l1.53 1.53C10.46 5.13 11.22 5 12 5c3.87 0 7 3.13 7 7 0 .78-.13 1.54-.37 2.24l1.53 1.53c.4-.86.67-1.79.78-2.77H23v-2h-2.06zM3.27 2L2 3.27l3.07 3.07C3.99 7.82 3.27 9.57 3.06 11.5H1v2h2.06A8.994 8.994 0 0 0 11 21.44V23.5h2v-2.06c1.93-.21 3.68-.93 5.16-2.01L20.73 22 22 20.73 3.27 2zM12 19c-3.87 0-7-3.13-7-7 0-1.61.55-3.09 1.46-4.27l9.81 9.81A6.92 6.92 0 0 1 12 19z"/\x3E\x3C/svg\x3E'
};

window.updateSpeedAndGpsIndicator = (speedKmH, gpsState = 'searching') => {
    const circle = document.getElementById('fabSpeedGpsCircle');
    const valEl = document.getElementById('fabSpeedValue');
    const unitEl = document.getElementById('fabSpeedUnit');
    const badgeEl = document.getElementById('fabGpsStatusBadge');
    if (!circle || !valEl || !badgeEl) return;

    circle.classList.remove('gps-ok', 'gps-bts', 'gps-tunnel', 'gps-off');
    if (gpsState === 'ok') {
        circle.classList.add('gps-ok');
        badgeEl.innerHTML = GPS_BADGE_SVGS.ok;
        if (unitEl) unitEl.innerText = 'km/h';
    } else if (gpsState === 'bts') {
        circle.classList.add('gps-bts');
        badgeEl.innerHTML = GPS_BADGE_SVGS.bts;
        if (unitEl) unitEl.innerText = 'km/h BTS';
    } else if (gpsState === 'tunnel') {
        circle.classList.add('gps-tunnel');
        badgeEl.innerHTML = GPS_BADGE_SVGS.tunnel;
        if (unitEl) unitEl.innerText = 'tunel';
    } else if (gpsState === 'searching') {
        circle.classList.add('gps-off');
        badgeEl.innerHTML = GPS_BADGE_SVGS.searching;
        if (unitEl) unitEl.innerText = 'szukam';
    } else {
        circle.classList.add('gps-off');
        badgeEl.innerHTML = GPS_BADGE_SVGS.off;
        if (unitEl) unitEl.innerText = 'wył.';
    }

    if (typeof speedKmH === 'number' && !isNaN(speedKmH) && speedKmH >= 0) {
        valEl.innerText = String(Math.round(speedKmH));
    } else {
        valEl.innerText = '--';
    }
};

window.centerOnActiveTrainPosition = () => {
    if (window._crewDutyCompleted) {
        if (confirm('Odcinek obsługi DK został zakończony i Czuwak jest wyłączony. Czy chcesz ponownie uruchomić śledzenie Czuwaka?')) {
            window._crewDutyCompleted = false;
            window.locateTrainByGPS(false);
        }
        return;
    }
    if (window.activeTrackingMode !== 'gps') {
        window.locateTrainByGPS(false);
        return;
    }
    const rowToCenter = document.querySelector('.train-moving-row') ||
                        document.querySelector('.station-standing-train-row') ||
                        document.querySelector('.train-route-table tr.active-station-row');
    if (rowToCenter) {
        window.centerOnElement(rowToCenter);
    } else {
        window.locateTrainByGPS(false);
    }
};

window.stopTrainTracking = () => {
    window.activeTrackingMode = null;
    window.releaseWakeLock();
    if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.stopForegroundTracking === 'function') {
        try { window.CzuwakNativeWidget.stopForegroundTracking(); } catch (e) {}
    }
    window.stopAlarmLoop();
    window.hideGpsSignalWarning();
    window.updateSpeedAndGpsIndicator(null, 'off');
    if (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) {
        try { navigator.geolocation.clearWatch(window._trainGpsWatchId); } catch (e) {}
        window._trainGpsWatchId = null;
    }
    if (window._trainGpsPollInterval) {
        clearInterval(window._trainGpsPollInterval);
        window._trainGpsPollInterval = null;
    }
    if (window._gpsWatchdogInterval) {
        clearInterval(window._gpsWatchdogInterval);
        window._gpsWatchdogInterval = null;
    }
    const gpsBtn = document.getElementById('fabGpsBtn');
    if (gpsBtn) {
        gpsBtn.classList.remove('fab-active');
        gpsBtn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Emy_location\x3C/span\x3E';
    }
    document.querySelectorAll('.gps-distance-indicator').forEach(el => el.remove());
    if (typeof window.dismissStationApproachToast === 'function') window.dismissStationApproachToast();
};

// Samoczynne wyłączenie Czuwaka po odhaczeniu / osiągnięciu stacji zmiany DK
window.completeCrewDutyAndStopCzuwak = (stationName, reasonText = '') => {
    window._crewDutyCompleted = true;
    window.stopTrainTracking();
    if (typeof window.archiveCurrentTrainToHistory === 'function') {
        window.archiveCurrentTrainToHistory(reasonText || 'Zakończenie obsługi DK');
    }
    if (typeof window.markDutyPlanItemCompleted === 'function') {
        if (window._activeDutyPlanDate && window._activeDutyPlanItemId) {
            window.markDutyPlanItemCompleted(window._activeDutyPlanDate, window._activeDutyPlanItemId, stationName || 'Zakończenie DK');
        } else if (window._currentActiveTrainNumber) {
            window.markDutyPlanItemCompletedByTrain(window.selectedTrainDepartureDate, window._currentActiveTrainNumber, stationName || 'Zakończenie DK');
        }
    }
    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'STATION', 'Zakończono odcinek drużyny na stacji ' + (stationName || window._crewDutyEndStationName || 'stacja końcowa') + (reasonText ? (' (' + reasonText + ')') : ''));
    }

    const bannerEl = document.getElementById('crewDutyStatusHeader');
    if (bannerEl) {
        bannerEl.style.background = 'rgba(34, 197, 94, 0.16)';
        bannerEl.style.borderColor = '#22c55e';
        bannerEl.innerHTML =
            '\x3Cdiv style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:10px; flex-wrap:wrap;"\x3E' +
                '\x3Cdiv style="display:flex; align-items:center; gap:8px; color:#4ade80; font-weight:800; font-size:0.9rem;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Etask_alt\x3C/span\x3E' +
                    '\x3Cspan\x3EZakończono obsługę DK na stacji \x3Cstrong style="color:#fff;"\x3E' + escapeHTML(stationName || window._crewDutyEndStationName || '') + '\x3C/strong\x3E – Czuwak wyłączył się samoczynnie' +
                    (reasonText ? (' (' + escapeHTML(reasonText) + ')') : '') + '.\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cbutton type="button" onclick="window.resumeCrewDutyCzuwak()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--primary); background:var(--input-bg); color:var(--primary); font-weight:800; font-size:0.78rem; cursor:pointer;"\x3EWznów Czuwak\x3C/button\x3E' +
                    '\x3Cbutton type="button" onclick="window.closeActiveTrainAndSleep()" style="padding:6px 12px; border-radius:8px; border:1px solid rgba(239, 68, 68, 0.5); background:rgba(239, 68, 68, 0.15); color:#f87171; font-weight:800; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Zamknij obsługiwany pociąg i uśpij aplikację Czuwak"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem;"\x3Epower_settings_new\x3C/span\x3E Zamknij\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E';
    }

    try {
        if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.updateWidget === 'function') {
            const trNum = window._currentActiveTrainNumber || '';
            const trName = (window._currentTrainObject && window._currentTrainObject.nazwa) ? (' ' + window._currentTrainObject.nazwa) : '';
            window.CzuwakNativeWidget.updateWidget(
                (trNum + trName).trim() || 'Poci\u0105g',
                'Koniec s\u0142u\u017cby DK',
                '0.0 km',
                'Zdano sk\u0142ad: ' + (stationName || ''),
                'Czuwak OFF',
                '0 km/h',
                'Zako\u0144czono: ' + (stationName || '')
            );
        }
    } catch (e) {}

    const miniHud = document.getElementById('floatingMiniHud');
    if (miniHud) miniHud.style.display = 'none';

    fireNativeOrWebNotification(
        'Koniec odcinka obsługi DK: ' + (stationName || ''),
        'Stacja zmiany DK została odhaczona. Czuwak wyłączył się automatycznie.',
        'DUTY_END_' + Date.now()
    );
};

window.resumeCrewDutyCzuwak = () => {
    window._crewDutyCompleted = false;
    window.triggerSearch();
};

// ==========================================
// OBSŁUGA SIECI I ROZMIARU CZCIONKI
// ==========================================
window.addEventListener('online', () => {
    const netMsg = document.getElementById('networkStatus');
    if (netMsg) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecloud_done\x3C/span\x3E Połączenie przywrócone (Bazy Offline gotowe)';
        netMsg.className = "msg-online";
    }
});

window.addEventListener('offline', () => {
    const netMsg = document.getElementById('networkStatus');
    if (netMsg) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ewifi_off\x3C/span\x3E Tryb Offline (Czuwak i GPS działają z pamięci)';
        netMsg.className = "msg-offline";
    }
});

const savedFontSize = localStorage.getItem('fontSize');
if (savedFontSize) {
    document.documentElement.style.fontSize = savedFontSize + 'px';
}
window.changeFontSize = (step) => {
    let currentSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    let newSize = currentSize + step;
    if (newSize >= 12 && newSize <= 24) {
        document.documentElement.style.fontSize = newSize + 'px';
        localStorage.setItem('fontSize', newSize);
    }
};

// ==========================================
// FUNKCJE DAT I ZEGARA (CZAS LOKALNY)
// ==========================================
const dniTygodnia = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
const miesiace = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

function getLocalYYYYMMDD(dateObj) {
    const d = dateObj instanceof Date && !isNaN(dateObj) ? dateObj : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseYYYYMMDDToDate(dateStr, fallbackDate) {
    if (!dateStr || typeof dateStr !== 'string') return fallbackDate || new Date();
    const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    return fallbackDate || new Date();
}

function formatPlDate(val) {
    if (!val) return '';
    if (typeof val === 'number' || /^\d+$/.test(String(val))) {
        const d = new Date(Number(val));
        if (!isNaN(d)) {
            return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
        }
    }
    let s = String(val).trim();
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
    }
    return s;
}

function formatPlDateTime(val) {
    if (!val) return '';
    if (typeof val === 'number' || /^\d+$/.test(String(val))) {
        const d = new Date(Number(val));
        if (!isNaN(d)) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
        }
    }
    return String(val);
}

// ==========================================
// WYBÓR DATY WYJAZDU POCIĄGU PRZEZ PRACOWNIKA
// ==========================================
const savedInitialDepDate = localStorage.getItem('CZUWAK_SELECTED_DEPARTURE_DATE');
window.selectedTrainDepartureDate = (savedInitialDepDate && /^\d{4}-\d{2}-\d{2}$/.test(savedInitialDepDate))
    ? savedInitialDepDate
    : getLocalYYYYMMDD(new Date());

window.syncTrainDateButtonsUI = () => {
    const inputEl = document.getElementById('trainDepartureDateInput');
    if (inputEl && inputEl.value !== window.selectedTrainDepartureDate) {
        inputEl.value = window.selectedTrainDepartureDate;
    }

    const now = new Date();
    const yesterdayStr = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const todayStr = getLocalYYYYMMDD(now);
    const tomorrowStr = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    const btnY = document.getElementById('btnDateYesterday');
    const btnT = document.getElementById('btnDateToday');
    const btnTom = document.getElementById('btnDateTomorrow');

    if (btnY) btnY.classList.toggle('active', window.selectedTrainDepartureDate === yesterdayStr);
    if (btnT) btnT.classList.toggle('active', window.selectedTrainDepartureDate === todayStr);
    if (btnTom) btnTom.classList.toggle('active', window.selectedTrainDepartureDate === tomorrowStr);
};

window.setRelativeTrainDate = (offsetDays) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(offsetDays || 0));
    window.selectedTrainDepartureDate = getLocalYYYYMMDD(target);
    try {
        localStorage.setItem('CZUWAK_SELECTED_DEPARTURE_DATE', window.selectedTrainDepartureDate);
    } catch (e) {}
    window.czuwakLog('INFO', 'STATE', 'Zmieniono datę wyjazdu na: ' + window.selectedTrainDepartureDate);
    window.syncTrainDateButtonsUI();
    window.triggerSearch();
};

window.onTrainDateChange = (val) => {
    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        window.selectedTrainDepartureDate = val;
    } else {
        window.selectedTrainDepartureDate = getLocalYYYYMMDD(new Date());
    }
    try {
        localStorage.setItem('CZUWAK_SELECTED_DEPARTURE_DATE', window.selectedTrainDepartureDate);
    } catch (e) {}
    window.czuwakLog('INFO', 'STATE', 'Wprowadzono datę wyjazdu: ' + window.selectedTrainDepartureDate);
    window.syncTrainDateButtonsUI();
    window.triggerSearch();
};

function getHolidayName(targetDate = null) {
    const checkD = targetDate ? new Date(targetDate) : new Date();
    const y = checkD.getFullYear();
    const m = String(checkD.getMonth() + 1).padStart(2, '0');
    const d = String(checkD.getDate()).padStart(2, '0');
    const fullDate = `${y}-${m}-${d}`;
    const monthDay = `${m}-${d}`;

    try {
        const dynamicRaw = localStorage.getItem('CZUWAK_HOLIDAYS');
        if (dynamicRaw) {
            const dynamicList = JSON.parse(dynamicRaw);
            for (const h of dynamicList) {
                if (h.type === 'fixed' && h.date === monthDay) return h.name;
                if (h.type === 'movable' && h.date === fullDate) return h.name;
            }
        }
    } catch (e) {}

    const staleSwieta = {
        "01-01": "Nowy Rok", "01-06": "Trzech Króli", "05-01": "Święto Pracy",
        "05-03": "Święto Konstytucji 3 Maja", "08-15": "Wniebowzięcie NMP",
        "11-01": "Wszystkich Świętych", "11-11": "Święto Niepodległości",
        "12-24": "Wigilia Bożego Narodzenia", "12-25": "Boże Narodzenie (1. dzień)",
        "12-26": "Boże Narodzenie (2. dzień)"
    };
    return staleSwieta[monthDay] || null;
}

let _clockIntervalId = null;
let _lastClockMinute = -1;
let _lastClockLocalDay = null;

function tickZegar(forceHeaderRender = false) {
    const d = new Date();
    const currentDayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dayChanged = (_lastClockLocalDay !== null && _lastClockLocalDay !== currentDayKey);
    _lastClockLocalDay = currentDayKey;

    const currentMinute = d.getHours() * 60 + d.getMinutes();
    if (forceHeaderRender || dayChanged || currentMinute !== _lastClockMinute) {
        _lastClockMinute = currentMinute;
        const dzienTyg = dniTygodnia[d.getDay()];
        const dzienMies = d.getDate();
        const miesiac = miesiace[d.getMonth()];
        const rok = d.getFullYear();
        const pelnaData = `${dzienTyg}, ${dzienMies} ${miesiac} ${rok}`;
        const swieto = getHolidayName(d);
        const swietoTag = swieto
            ? ('\x3Cdiv class="holiday-tag"\x3E\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecelebration\x3C/span\x3E ' + escapeHTML(swieto) + '\x3C/div\x3E')
            : '';

        const dateBarEl = document.getElementById('dateBar');
        if (dateBarEl) {
            dateBarEl.innerHTML =
                '\x3Cdiv style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; text-align:center;"\x3E' +
                    '\x3Cdiv style="display:flex; align-items:center; justify-content:center; gap:6px;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecalendar_today\x3C/span\x3E ' +
                        '\x3Cspan\x3E' + pelnaData + '\x3C/span\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv id="clockTimeText" style="font-size: 1.5rem; font-weight: 800; color: var(--primary); margin-top: 2px; font-variant-numeric: tabular-nums; letter-spacing: 0.5px;"\x3E' +
                        d.toLocaleTimeString('pl-PL') +
                    '\x3C/div\x3E' +
                    swietoTag +
                '\x3C/div\x3E';
        }
    } else {
        const clockTimeEl = document.getElementById('clockTimeText');
        if (clockTimeEl) {
            clockTimeEl.textContent = d.toLocaleTimeString('pl-PL');
        }
    }
    if (typeof window.syncPendingWidgetEvents === 'function') {
        window.syncPendingWidgetEvents();
    }
}

function startClockLoop() {
    if (_clockIntervalId) return;
    tickZegar();
    _clockIntervalId = setInterval(() => {
        if (!document.hidden) tickZegar();
    }, 1000);
}
startClockLoop();

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        tickZegar(true);
        if (typeof window.syncPendingWidgetEvents === 'function') {
            window.syncPendingWidgetEvents();
        }
    }
});

// ==========================================
// STATYSTYKI I WERSJONOWANIE BAZ DANYCH
// ==========================================
window.updateStats = async () => {
    window.syncAlertConfigUI();

    const lastStationsTs = parseInt(localStorage.getItem('STATIONS_SYNC_TIMESTAMP') || '0', 10);
    const elStationsSync = document.getElementById('stat_stations_sync');
    if (elStationsSync) {
        elStationsSync.innerText = lastStationsTs > 0 ? formatPlDateTime(lastStationsTs) : 'Brak';
        elStationsSync.style.color = lastStationsTs > 0 ? '' : 'var(--danger)';
    }

    const lastTrainsSyncStr = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    const trainsTtlStr = localStorage.getItem('TRAINS_SYNC_TTL');
    const elTrainsSync = document.getElementById('stat_trains_sync');
    const elTrainsExpires = document.getElementById('stat_trains_expires');
    if (lastTrainsSyncStr && trainsTtlStr) {
        const expiresTrainsMs = parseInt(lastTrainsSyncStr, 10) + parseInt(trainsTtlStr, 10);
        const diffHours = Math.ceil((expiresTrainsMs - Date.now()) / (1000 * 60 * 60));
        if (elTrainsSync) {
            elTrainsSync.innerText = formatPlDateTime(parseInt(lastTrainsSyncStr, 10));
            elTrainsSync.style.color = '';
        }
        if (elTrainsExpires) {
            if (diffHours > 0) {
                elTrainsExpires.innerText = 'za ok. ' + diffHours + ' godz.';
                elTrainsExpires.style.color = '';
            } else {
                elTrainsExpires.innerText = 'Wygasła';
                elTrainsExpires.style.color = 'var(--danger)';
            }
        }
    } else {
        if (elTrainsSync) { elTrainsSync.innerText = 'Brak'; elTrainsSync.style.color = 'var(--danger)'; }
        if (elTrainsExpires) { elTrainsExpires.innerText = 'Brak'; elTrainsExpires.style.color = 'var(--danger)'; }
    }

    const elStatStations = document.getElementById('stat_stations');
    if (elStatStations) {
        elStatStations.innerText = Array.isArray(window._cachedStationList) ? window._cachedStationList.length : 0;
    }
    const elStatTrains = document.getElementById('stat_trains');
    if (elStatTrains) {
        elStatTrains.innerText = Array.isArray(bazaPociagow) ? bazaPociagow.length : 0;
    }

    const elStatOrmTiles = document.getElementById('stat_orm_tiles');
    if (elStatOrmTiles && ormTilesDb && typeof ormTilesDb.length === 'function') {
        try {
            const tileCount = await ormTilesDb.length();
            elStatOrmTiles.innerText = tileCount + ' kafelków';
            elStatOrmTiles.style.color = tileCount > 0 ? 'var(--open)' : '';
        } catch (e) {}
    }

    let totalBytes = 0;
    try {
        for (let key in localStorage) {
            if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
                totalBytes += ((localStorage[key].length + key.length) * 2);
            }
        }
        if (Array.isArray(window._cachedStationList)) totalBytes += JSON.stringify(window._cachedStationList).length * 2;
        if (Array.isArray(bazaPociagow)) totalBytes += JSON.stringify(bazaPociagow).length * 2;
    } catch (e) {}

    let cacheKB = totalBytes / 1024;
    const storageEl = document.getElementById('stat_storage');
    if (storageEl) {
        storageEl.innerText = cacheKB > 1024 ? (cacheKB / 1024).toFixed(2) + ' MB' : cacheKB.toFixed(2) + ' KB';
    }

    const appVerEl = document.getElementById('stat_app_version');
    if (appVerEl) {
        const verStr = window.APP_VERSION || 'v1.0.0';
        const buildStr = window.APP_BUILD ? (' (' + window.APP_BUILD + ')') : '';
        appVerEl.innerText = verStr + buildStr;
    }
};

// ==========================================
// MECHANIZM SAMODZIELNEJ AKTUALIZACJI APK (BEZ SKLEPU PLAY)
// ==========================================
function getApkFileName() {
    return 'czuwak.apk';
}

const DEFAULT_APK_DOWNLOAD_URL = 'https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk';
const REMOTE_ENV_JS_URL = 'https://raw.githubusercontent.com/piotrrgw/czuwak/main/www/env.js';
window._latestApkFileName = 'czuwak.apk';
window._latestApkDownloadUrl = DEFAULT_APK_DOWNLOAD_URL;
window._latestDetectedVersionLabel = null;

function parseVersionScore(versionStr, buildStr) {
    if (!versionStr) return 0;
    const cleanVer = String(versionStr).trim().replace(/^v/i, '').split('-')[0];
    const parts = cleanVer.split('.');
    let score = 0;
    if (parts[0]) score += (parseInt(parts[0], 10) || 0) * 1000000000;
    if (parts[1]) score += (parseInt(parts[1], 10) || 0) * 1000000;
    if (parts[2]) score += (parseInt(parts[2], 10) || 0) * 1000;
    if (buildStr) {
        const bNum = parseInt(String(buildStr).replace(/^0+/, '') || '0', 10);
        if (!isNaN(bNum)) score += Math.min(999, bNum);
    }
    return score;
}

window.downloadAppUpdate = function() {
    const fileName = window._latestApkFileName || getApkFileName();
    const targetUrl = window._latestApkDownloadUrl || 'https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk';
    const verInfo = window._latestDetectedVersionLabel ? (' (' + window._latestDetectedVersionLabel + ')') : '';
    const msg = 'Za chwilę rozpocznie się pobieranie aktualizacji Czuwaka' + verInfo + '.\n\nPlik: ' + fileName + '\n\nPo pobraniu otwórz plik i kliknij "Aktualizuj" (bazy danych i ustawienia zostaną zachowane).';
    if (confirm(msg)) {
        try {
            const link = document.createElement('a');
            link.href = targetUrl;
            link.download = fileName;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => { if (link.parentNode) link.remove(); }, 500);
        } catch (e) {
            window.location.href = targetUrl;
        }
    }
};

window.renderForcedApkUpdateScreen = function(minVerStr, apkUrl) {
    const fileName = window._latestApkFileName || getApkFileName(minVerStr);
    if (apkUrl) window._latestApkDownloadUrl = apkUrl;
    document.body.innerHTML =
        '\x3Cdiv style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; text-align:center; padding:30px; background:var(--bg-gradient); color:var(--text);"\x3E' +
            '\x3Cspan class="material-symbols-outlined" style="font-size:5rem; color:var(--warning); margin-bottom:20px;"\x3Esystem_update\x3C/span\x3E' +
            '\x3Ch1 style="color:var(--text-main); margin-bottom:10px;"\x3EWymagana aktualizacja Czuwaka\x3C/h1\x3E' +
            '\x3Cp style="color:var(--text-muted); font-size:1.05rem; line-height:1.6; max-width:480px;"\x3E' +
                'Twoja wersja aplikacji (' + escapeHTML(window.APP_VERSION || 'v1.0.0') + ') wymaga aktualizacji.\x3Cbr\x3E' +
                'Wymagana wersja minimalna: \x3Cstrong\x3E' + escapeHTML(minVerStr) + '\x3C/strong\x3E.' +
            '\x3C/p\x3E' +
            '\x3Cp style="font-size:0.9rem; color:var(--primary); margin-bottom:28px; max-width:440px;"\x3E' +
                'Kliknij poniższy przycisk, aby pobrać nowy plik instalacyjny \x3Cstrong\x3E' + escapeHTML(fileName) + '\x3C/strong\x3E i zainstalować nakładkę aktualizacyjną.' +
            '\x3C/p\x3E' +
            '\x3Cbutton class="menu-btn menu-btn-primary" onclick="window.downloadAppUpdate()" style="max-width:340px; min-height:52px; font-size:1rem; justify-content:center;"\x3E' +
                '\x3Cspan class="material-symbols-outlined"\x3Edownload\x3C/span\x3E Pobierz i zainstaluj aktualizację (.apk)' +
            '\x3C/button\x3E' +
        '\x3C/div\x3E';
};

window.showSoftApkUpdateBanner = function(newVerLabel, apkUrl) {
    if (apkUrl) window._latestApkDownloadUrl = apkUrl;
    if (newVerLabel) window._latestDetectedVersionLabel = newVerLabel;
    const banner = document.getElementById('updateBanner');
    const bannerText = document.getElementById('updateBannerText');
    if (bannerText && newVerLabel) {
        bannerText.innerText = 'Dostępna nowa wersja Czuwaka (' + newVerLabel + ')! Kliknij, aby pobrać i zainstalować (.apk)';
    }
    if (banner) {
        banner.style.display = 'flex';
    }
};

window.checkAppUpdate = async function(isManual = false, dbStatusData = null) {
    const btn = document.getElementById('btnCheckApkUpdate');
    if (isManual && btn) {
        btn.disabled = true;
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Sprawdzam wersję APK...';
    }

    const currentScore = parseVersionScore(window.APP_VERSION || 'v1.0.0', window.APP_BUILD || '001');
    let foundNewer = false;
    let detectedLabel = '';

    try {
        let sysData = dbStatusData;
        if (!sysData && isManual) {
            try {
                const snap = await getDoc(doc(db, 'system', 'db_status'));
                if (snap.exists()) sysData = snap.data();
            } catch (e) {}
        }

        if (sysData) {
            if (sysData.czuwakApkUrl) {
                window._latestApkDownloadUrl = sysData.czuwakApkUrl;
                try {
                    const uParts = sysData.czuwakApkUrl.split('/');
                    const fName = uParts[uParts.length - 1].split('?')[0];
                    if (fName.endsWith('.apk')) {
                        window._latestApkFileName = decodeURIComponent(fName);
                    }
                } catch (e) {}
            }
            if (sysData.minCzuwakVersion) {
                const minScore = parseVersionScore(sysData.minCzuwakVersion, '000');
                if (currentScore < minScore) {
                    window.renderForcedApkUpdateScreen(sysData.minCzuwakVersion, sysData.czuwakApkUrl);
                    return true;
                }
            }
            if (sysData.latestCzuwakVersion) {
                const latestFirestoreScore = parseVersionScore(sysData.latestCzuwakVersion, sysData.latestCzuwakBuild || '999');
                if (currentScore < latestFirestoreScore) {
                    foundNewer = true;
                    detectedLabel = sysData.latestCzuwakVersion + (sysData.latestCzuwakBuild ? (' build ' + sysData.latestCzuwakBuild) : '');
                }
            }
        }

        // Sprawdź oficjalny GitHub Releases API – gwarancja prawidłowych linków bez błędu 404
        if (!foundNewer) {
            try {
                const ghResp = await fetch('https://api.github.com/repos/piotrrgw/czuwak/releases/latest', { cache: 'no-store' });
                if (ghResp.ok) {
                    const release = await ghResp.json();
                    if (release && release.tag_name) {
                        const tagParts = release.tag_name.replace(/^v/i, '').split('-build.');
                        const relVer = 'v' + tagParts[0];
                        const relBuild = tagParts[1] || '0';
                        const relScore = parseVersionScore(relVer, relBuild);
                        const curBuildInt = parseInt(String(window.APP_BUILD || '1').replace(/^0+/, '') || '1', 10);
                        const relBuildInt = parseInt(String(relBuild).replace(/^0+/, '') || '0', 10);

                        if (relBuildInt > curBuildInt || relScore > currentScore) {
                            foundNewer = true;
                            detectedLabel = relVer + (relBuild ? (' (kompilacja ' + relBuild + ')') : '');

                            let apkAsset = null;
                            if (Array.isArray(release.assets)) {
                                apkAsset = release.assets.find(a => a.name && a.name.toLowerCase().endsWith('.apk') && a.name.toLowerCase().includes('v'));
                                if (!apkAsset) {
                                    apkAsset = release.assets.find(a => a.name && a.name.toLowerCase().endsWith('.apk'));
                                }
                            }

                            if (apkAsset && apkAsset.browser_download_url) {
                                window._latestApkDownloadUrl = apkAsset.browser_download_url;
                                window._latestApkFileName = apkAsset.name;
                            } else {
                                window._latestApkDownloadUrl = 'https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk';
                                window._latestApkFileName = getApkFileName(relVer, relBuild);
                            }
                        }
                    }
                }
            } catch (ghErr) {}
        }

        if (!foundNewer) {
            const resp = await fetch(REMOTE_ENV_JS_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (resp.ok) {
                const envText = await resp.text();
                const verMatch = envText.match(/APP_VERSION\s*=\s*"([^"]+)"/);
                const buildMatch = envText.match(/APP_BUILD\s*=\s*"([^"]+)"/);
                const apkNameMatch = envText.match(/APP_APK_NAME\s*=\s*"([^"]+)"/);
                const remoteVer = verMatch ? verMatch[1] : null;
                const remoteBuild = buildMatch ? buildMatch[1] : null;
                if (remoteVer) {
                    const remoteScore = parseVersionScore(remoteVer, remoteBuild || '1');
                    const curBuildInt = parseInt(String(window.APP_BUILD || '1').replace(/^0+/, '') || '1', 10);
                    const remBuildInt = parseInt(String(remoteBuild || '1').replace(/^0+/, '') || '1', 10);
                    if (remBuildInt > curBuildInt || remoteScore > currentScore) {
                        foundNewer = true;
                        detectedLabel = remoteVer + (remoteBuild ? (' (kompilacja ' + remoteBuild + ')') : '');
                        window._latestApkFileName = 'czuwak.apk';
                        window._latestApkDownloadUrl = 'https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk';
                    }
                }
            }
        }

        if (foundNewer) {
            window.showSoftApkUpdateBanner(detectedLabel, window._latestApkDownloadUrl);
            if (isManual) {
                const menuEl = document.getElementById('menuOverlay');
                if (menuEl) menuEl.classList.remove('active');
                window.downloadAppUpdate();
            }
        } else if (isManual) {
            alert('Posiadasz najnowszą wersję aplikacji Czuwak: ' + (window.APP_VERSION || 'v1.0.0') + ' (kompilacja ' + (window.APP_BUILD || '001') + ').');
        }
    } catch (e) {
        if (isManual) {
            alert('Nie udało się sprawdzić aktualizacji APK (brak połączenia z siecią).');
        }
    } finally {
        if (isManual && btn) {
            btn.disabled = false;
            btn.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--open);"\x3Esystem_update\x3C/span\x3E Sprawdź aktualizację aplikacji (.apk)';
        }
    }
    return foundNewer;
};

window.checkDbVersion = async function() {
    let updateStatus = {
        needsStations: false,
        needsTrains: false,
        isMissingMeta: false,
        isExpired: false,
        offline: false
    };

    let hasStations = Array.isArray(window._cachedStationList) && window._cachedStationList.length > 0;
    let hasTrains = Array.isArray(bazaPociagow) && bazaPociagow.length > 0;

    if (!hasStations) {
        try {
            const c = await localforage.getItem(STATIONS_DICT_KEY);
            if (c && (Array.isArray(c) ? c.length > 0 : Object.keys(c).length > 0)) hasStations = true;
        } catch (e) {}
    }
    if (!hasTrains) {
        try {
            const c = await localforage.getItem(TRAINS_KEY);
            if (c && (Array.isArray(c) ? c.length > 0 : Object.keys(c).length > 0)) hasTrains = true;
        } catch (e) {}
    }

    const localTimeStations = parseInt(localStorage.getItem('STATIONS_SYNC_TIMESTAMP') || '0', 10);
    const isStationsMissingMeta = !localTimeStations;

    const localTimeTrains = parseInt(localStorage.getItem('TRAINS_SYNC_TIMESTAMP') || '0', 10);
    const trainsTtl = parseInt(localStorage.getItem('TRAINS_SYNC_TTL') || '0', 10);
    const isTrainsMissingMeta = !localTimeTrains || !trainsTtl;
    const isTrainsExpired = localTimeTrains > 0 && trainsTtl > 0 && (Date.now() - localTimeTrains > trainsTtl);

    const isMissingMeta = isStationsMissingMeta || isTrainsMissingMeta;
    const isExpired = isTrainsExpired;

    let isServerNewerStationsLoud = false;
    let isServerNewerTrains = false;

    try {
        const snap = await getDoc(doc(db, 'system', 'db_status'));
        if (snap.exists()) {
            const data = snap.data();

            window.checkAppUpdate(false, data);

            if (data.holidays) {
                localStorage.setItem('CZUWAK_HOLIDAYS', JSON.stringify(data.holidays));
            }

            const serverLoudTimeStations = data.lastUpdateStations || 0;
            const serverTimeTrains = data.lastUpdateTrains || 0;

            if (localTimeStations > 0 && serverLoudTimeStations > localTimeStations) {
                isServerNewerStationsLoud = true;
                window.pendingServerVersionStations = serverLoudTimeStations;
            }
            if (localTimeTrains > 0 && serverTimeTrains > localTimeTrains) {
                isServerNewerTrains = true;
                window.pendingServerVersionTrains = serverTimeTrains;
            }
        } else {
            window.checkAppUpdate(false, null);
        }
    } catch (e) {
        updateStatus.offline = true;
    }

    const needsStations = !hasStations || isStationsMissingMeta || isServerNewerStationsLoud;
    const needsTrains = !hasTrains || isTrainsMissingMeta || isTrainsExpired || isServerNewerTrains;

    updateStatus.needsStations = needsStations;
    updateStatus.needsTrains = needsTrains;
    updateStatus.isMissingMeta = isMissingMeta;
    updateStatus.isExpired = isExpired;

    if (needsStations || needsTrains) {
        const banner = document.getElementById('dbUpdateBanner');
        let updateType = 'all';
        let bannerText = "Dostępne aktualizacje baz danych! Kliknij, aby pobrać.";
        let bannerIcon = "sync";

        if (needsStations && !needsTrains) {
            updateType = 'stacje';
            bannerText = "Opublikowano nowy słownik stacji GPS (LOUD)! Kliknij, aby pobrać.";
            bannerIcon = "map";
        } else if (needsTrains && !needsStations) {
            updateType = 'pociagi';
            bannerText = isTrainsExpired
                ? "Minęło 24-48h – rozkład pociągów wymaga odświeżenia! Kliknij, aby pobrać."
                : "Dostępny nowy rozkład pociągów! Kliknij, aby pobrać.";
            bannerIcon = "train";
        }

        if (banner) {
            banner.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3E' + bannerIcon + '\x3C/span\x3E ' + bannerText;
            banner.onclick = () => {
                banner.style.display = 'none';
                window.pobierzDane(updateType, true);
            };
            banner.style.display = 'flex';
        }
    }

    return updateStatus;
};

window.checkUpdatesManually = async function() {
    const btn = document.getElementById('btnCheckUpdates');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin" style="font-size:1.1rem;"\x3Esync\x3C/span\x3E Sprawdzam...';
    }
    const status = await window.checkDbVersion();
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem;"\x3Ecloud_sync\x3C/span\x3E Sprawdź';
    }
    if (!status) return;
    if (status.offline) {
        alert("Brak połączenia z internetem. Aplikacja pracuje w trybie Offline.");
    } else if (status.needsStations || status.needsTrains) {
        const menuEl = document.getElementById('menuOverlay');
        if (menuEl) menuEl.classList.remove('active');
        let type = (status.needsStations && status.needsTrains) ? 'all' : (status.needsStations ? 'stacje' : 'pociagi');
        window.pobierzDane(type, true);
    } else {
        alert("Baza pociągów oraz słownik stacji GPS są w pełni aktualne!");
    }
};

// ==========================================
// POBIERANIE DANYCH (pociagi co 24-48h + stations_dict przy LOUD + OpenRailwayMap Offline)
// ==========================================
window.partialSyncTrainsFailed = false;
window._isSyncMinimized = false;
window._bgSyncBannerHideTimer = null;

window.updateBgSyncBannerStage = function(stageText) {
    const titleEl = document.getElementById('bgSyncBannerTitle');
    if (titleEl && stageText) titleEl.innerText = stageText;
};

window.minimizeSyncToBackground = function() {
    window._isSyncMinimized = true;
    const loader = document.getElementById('trainLoaderOverlay');
    if (loader) {
        loader.style.transition = 'opacity 0.25s ease';
        loader.style.opacity = '0';
        setTimeout(() => {
            if (window._isSyncMinimized && loader) {
                loader.style.display = 'none';
                loader.style.opacity = '1';
            }
        }, 250);
    }
    const menuEl = document.getElementById('menuOverlay');
    if (menuEl) menuEl.classList.remove('active');

    const bgBanner = document.getElementById('bgSyncBanner');
    if (bgBanner) bgBanner.style.display = 'flex';
    const syncProgressContainer = document.getElementById('syncProgressContainer');
    if (syncProgressContainer) syncProgressContainer.style.display = 'none';

    zbudujListePociagow();
    if (!window.stateRestored) {
        window.restoreLastState();
        window.stateRestored = true;
    }
};

window.pobierzDane = async function(type = 'all', force = false) {
    window.showGlobalProgress();
    window._isSyncMinimized = false;

    const bgBannerInit = document.getElementById('bgSyncBanner');
    if (bgBannerInit) bgBannerInit.style.display = 'none';

    const btnRefreshAll = document.getElementById('btnRefreshAll');
    const btnRefreshStacje = document.getElementById('btnRefreshStacje');
    const btnRefreshPociagi = document.getElementById('btnRefreshPociagi');

    if (force) {
        if (btnRefreshAll) { btnRefreshAll.disabled = true; btnRefreshAll.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Synchronizowanie...'; }
        if (type === 'stacje' || type === 'all') {
            if (btnRefreshStacje) { btnRefreshStacje.disabled = true; btnRefreshStacje.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Odświeżanie...'; }
        }
        if (type === 'pociagi' || type === 'all') {
            if (btnRefreshPociagi) { btnRefreshPociagi.disabled = true; btnRefreshPociagi.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Odświeżanie...'; }
        }
    }

    let cachedStationsDict = await localforage.getItem(STATIONS_DICT_KEY);
    if (typeof cachedStationsDict === 'string') {
        try { cachedStationsDict = JSON.parse(cachedStationsDict); } catch (e) {}
    }
    let hasCachedStations = false;
    if (cachedStationsDict && typeof cachedStationsDict === 'object') {
        const list = Array.isArray(cachedStationsDict) ? cachedStationsDict : Object.values(cachedStationsDict);
        if (list.length > 0) {
            window._cachedStationList = list;
            hasCachedStations = true;
        }
    }
    const lastSyncStations = localStorage.getItem('STATIONS_SYNC_TIMESTAMP');
    const needStationsUpdate = !hasCachedStations || !lastSyncStations;

    let cachedTrains = await localforage.getItem(TRAINS_KEY);
    if (typeof cachedTrains === 'string') {
        try { cachedTrains = JSON.parse(cachedTrains); } catch (e) {}
    }
    let needTrainsUpdate = true;
    const lastTrainsSyncStr = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    let trainsTtlStr = localStorage.getItem('TRAINS_SYNC_TTL');

    if (!trainsTtlStr) {
        const randomTTL = (Math.floor(Math.random() * (48 - 24 + 1)) + 24) * 60 * 60 * 1000;
        localStorage.setItem('TRAINS_SYNC_TTL', randomTTL.toString());
        trainsTtlStr = randomTTL.toString();
    }

    if (!force && Array.isArray(cachedTrains) && cachedTrains.length > 0 && lastTrainsSyncStr && trainsTtlStr) {
        if (Date.now() - parseInt(lastTrainsSyncStr, 10) < parseInt(trainsTtlStr, 10)) {
            bazaPociagow = cachedTrains;
            needTrainsUpdate = false;
        }
    }
    if ((!bazaPociagow || bazaPociagow.length === 0) && Array.isArray(cachedTrains) && cachedTrains.length > 0) {
        bazaPociagow = cachedTrains;
    }

    const willDownloadStations = (type === 'stacje' && force) || ((type === 'all' || type === 'stacje') && needStationsUpdate);
    const willDownloadTrains = (type === 'all' || type === 'pociagi') && (force || needTrainsUpdate || !cachedTrains);

    const canContinueInBackground = hasCachedStations && Array.isArray(bazaPociagow) && bazaPociagow.length > 0;
    if (canContinueInBackground) {
        zbudujListePociagow();
        if (!window.stateRestored) {
            window.restoreLastState();
            window.stateRestored = true;
        }
    }

    const loader = document.getElementById('trainLoaderOverlay');
    const dynamicComposition = document.getElementById('train-dynamic-composition');
    const btnMinimizeSync = document.getElementById('btnMinimizeSync');
    let loaderActive = false;

    if (willDownloadStations || willDownloadTrains) {
        loaderActive = true;
        if (loader) {
            if (dynamicComposition && typeof window.getTrainIndicatorHTML === 'function') {
                dynamicComposition.innerHTML = window.getTrainIndicatorHTML(8);
            }
            loader.style.display = 'flex';
            loader.style.opacity = '1';
        }
        if (btnMinimizeSync) {
            btnMinimizeSync.style.display = canContinueInBackground ? 'inline-flex' : 'none';
        }
    }

    const progressContainer = document.getElementById('syncProgressContainer');
    const progressBar = document.getElementById('syncProgressBar');
    const trainProgressText = document.getElementById('trainProgressText');
    const bgSyncBannerBar = document.getElementById('bgSyncBannerBar');
    const bgSyncBannerPct = document.getElementById('bgSyncBannerPct');

    const renderPct = (val) => {
        const clamped = Math.max(0, Math.min(100, Math.round(val)));
        if (progressBar) progressBar.style.width = clamped + '%';
        if (trainProgressText) trainProgressText.innerText = clamped + '%';
        if (bgSyncBannerBar) bgSyncBannerBar.style.width = clamped + '%';
        if (bgSyncBannerPct) bgSyncBannerPct.innerText = clamped + '%';
    };

    if (progressContainer && loaderActive && !window._isSyncMinimized) progressContainer.style.display = 'block';
    renderPct(0);

    document.getElementById('dbUpdateBanner').style.display = 'none';
    const netMsg = document.getElementById('networkStatus');
    const syncMsg = document.getElementById('syncTimestamp');

    if (!willDownloadStations && !willDownloadTrains && !force) {
        renderPct(100);
        const localDateTrains = lastTrainsSyncStr ? formatPlDateTime(parseInt(lastTrainsSyncStr, 10)) : 'Brak';
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Echeck_circle\x3C/span\x3E Baza z pamięci podręcznej';
        netMsg.className = "msg-online";
        syncMsg.innerHTML = "Pociągi pobrane: " + localDateTrains;

        zbudujListePociagow();
        if (!window.stateRestored) {
            window.restoreLastState();
            window.stateRestored = true;
        }
        if (progressContainer) progressContainer.style.display = 'none';
        if (loader) setTimeout(() => { loader.style.display = 'none'; }, 300);
        window.hideGlobalProgress();

        // W tle dociągnij bazową mapę OpenRailwayMap jeśli jeszcze nie pobrano
        if (navigator.onLine && localStorage.getItem('CZUWAK_ORM_BASE_SYNCED') !== 'true') {
            window.downloadPolandOrmBaseOffline(false);
        }
        return;
    }

    netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined spin icon-sm"\x3Esync\x3C/span\x3E Inicjalizacja pobierania...';
    netMsg.className = "msg-online";
    renderPct(10);

    let errors = [];
    let checksums = { trains: 0 };
    let stationsDownloadFailed = false;
    let trainsDownloadFailed = false;

    try {
        const sysSnap = await getDoc(doc(db, 'system', 'db_status'));
        if (sysSnap.exists()) {
            const sysData = sysSnap.data();
            checksums.trains = sysData.checksumTrains || 0;
            if (sysData.holidays) {
                localStorage.setItem('CZUWAK_HOLIDAYS', JSON.stringify(sysData.holidays));
            }
        }
    } catch (e) {
        console.warn("Nie udało się pobrać sum kontrolnych z system/db_status.");
    }
    renderPct(20);

    if (willDownloadStations) {
        try {
            netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined spin icon-sm"\x3Esync\x3C/span\x3E Pobieram słownik stacji GPS...';
            window.updateBgSyncBannerStage('Aktualizacja w tle: Pobieram słownik stacji GPS...');

            const stDoc = await getDoc(doc(publicDb, 'public_data', 'stations_dict'));
            if (!stDoc.exists()) {
                throw new Error("Dokument public_data/stations_dict nie istnieje");
            }
            const stationsArray = stDoc.data().data || [];
            const stMap = {};
            stationsArray.forEach(data => {
                if (data && data.epa !== undefined) {
                    stMap[data.epa] = data;
                } else if (data && data.stacja) {
                    stMap[data.stacja] = data;
                }
            });

            window._cachedStationList = Object.values(stMap);
            await localforage.setItem(STATIONS_DICT_KEY, stMap);

            const exactNowStations = window.pendingServerVersionStations || Date.now();
            window.pendingServerVersionStations = null;
            localStorage.setItem('STATIONS_SYNC_TIMESTAMP', exactNowStations.toString());
            renderPct(willDownloadTrains ? 50 : 92);
        } catch (e) {
            console.error("Błąd pobierania stacji GPS:", e);
            errors.push("Słownik Stacji: " + e.message);
            stationsDownloadFailed = true;
        }
    }

    if (willDownloadTrains) {
        try {
            netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined spin icon-sm"\x3Esync\x3C/span\x3E Pobieram paczki tras pociągów...';
            window.updateBgSyncBannerStage('Aktualizacja w tle: Pobieram rozkłady pociągów...');
            renderPct(60);

            let loadedTrains = [];
            const trSnap = await getDocs(collection(trainsDb, 'pociagi_ic'));
            renderPct(85);

            trSnap.forEach(d => {
                if (d.id.startsWith('bucket_')) {
                    const daneZKoszyka = d.data().dane || [];
                    loadedTrains.push(...daneZKoszyka);
                }
            });

            if (checksums.trains > 0 && loadedTrains.length < (checksums.trains * 0.8)) {
                throw new Error("BŁĄD SUMY KONTROLNEJ! Oczekiwano ok. " + checksums.trains + " pociągów, pobrano " + loadedTrains.length + ".");
            }
            if (loadedTrains.length === 0) {
                throw new Error("Pobrano 0 pociągów z bazy rozkładów.");
            }

            bazaPociagow = loadedTrains;
            await localforage.setItem(TRAINS_KEY, loadedTrains);

            const exactNowTrains = window.pendingServerVersionTrains || Date.now();
            window.pendingServerVersionTrains = null;
            localStorage.setItem('TRAINS_SYNC_TIMESTAMP', exactNowTrains.toString());

            const newTrainsTtl = (Math.floor(Math.random() * (48 - 24 + 1)) + 24) * 60 * 60 * 1000;
            localStorage.setItem('TRAINS_SYNC_TTL', newTrainsTtl.toString());
            renderPct(94);
        } catch (e) {
            console.error("Błąd pobierania pociągów:", e);
            errors.push("Baza Pociągów: " + e.message);
            trainsDownloadFailed = true;
            if (Array.isArray(cachedTrains) && cachedTrains.length > 0) {
                bazaPociagow = cachedTrains;
            }
        }
    }

    // -> POBIERANIE BAZOWEJ MAPY KOLEJOWEJ OPENRAILWAYMAP OFFLINE DO BAZY
    if (navigator.onLine && (type === 'all' || localStorage.getItem('CZUWAK_ORM_BASE_SYNCED') !== 'true')) {
        try {
            window.updateBgSyncBannerStage('Zapisywanie mapy kolejowej OpenRailwayMap Offline...');
            await window.downloadPolandOrmBaseOffline(false);
        } catch (e) {}
    }

    renderPct(100);
    window.partialSyncTrainsFailed = trainsDownloadFailed;

    const finalTrainsTs = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    const finalTrainsDate = finalTrainsTs ? formatPlDateTime(parseInt(finalTrainsTs, 10)) : 'Brak';

    if (errors.length === 0) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecloud_done\x3C/span\x3E Baza aktualna (Tryb Offline gotowy)';
        netMsg.className = "msg-online";
        syncMsg.innerHTML = "Pociągi pobrane: " + finalTrainsDate;
    } else if (Array.isArray(bazaPociagow) && bazaPociagow.length > 0 && window._cachedStationList.length > 0) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ewifi_off\x3C/span\x3E Tryb Offline (Dane z pamięci)';
        netMsg.className = "msg-offline";
        syncMsg.innerHTML = "Ostatnia kopia: " + finalTrainsDate;
    } else {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Eerror\x3C/span\x3E Błąd synchronizacji bazy!';
        netMsg.className = "msg-offline";
    }

    zbudujListePociagow();
    if (!window.stateRestored) {
        window.restoreLastState();
        window.stateRestored = true;
    } else {
        window.triggerSearch();
    }

    window.updateStats();

    if (btnRefreshAll) { btnRefreshAll.disabled = false; btnRefreshAll.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Ecloud_sync\x3C/span\x3E Synchronizuj wszystko (Bazy + Mapa)'; }
    if (btnRefreshStacje) { btnRefreshStacje.disabled = false; btnRefreshStacje.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Emap\x3C/span\x3E Odśwież słownik stacji GPS'; }
    if (btnRefreshPociagi) { btnRefreshPociagi.disabled = false; btnRefreshPociagi.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Etrain\x3C/span\x3E Odśwież rozkłady pociągów'; }

    const bgBannerFinal = document.getElementById('bgSyncBanner');
    if (bgBannerFinal && window._isSyncMinimized) {
        setTimeout(() => { bgBannerFinal.style.display = 'none'; }, 2000);
    }
    if (progressContainer) progressContainer.style.display = 'none';
    if (loader) {
        setTimeout(() => { loader.style.display = 'none'; }, 350);
    }
    window.hideGlobalProgress();
};

// ==========================================
// MODUŁ OPENRAILWAYMAP (PODGLĄD TRASY + BAZA OFFLINE W LOCALFORAGE)
// ==========================================
window._ormLeafletMap = null;
window._ormRouteLayerGroup = null;
window._ormTrainMarker = null;
window._ormApproachCircle = null;
window._ormNextStationCoords = null;
window._currentRouteStationsWithGps = [];

function lon2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}
function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

async function fetchAndCacheSingleTile(layerPrefix, url, tileKey) {
    try {
        const existing = await ormTilesDb.getItem(tileKey);
        if (existing) return true;
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) return false;
        if (resp.headers && resp.headers.get('x-blocked')) return false;
        const blob = await resp.blob();
        if (!blob || blob.size < 100 || (blob.type && !blob.type.includes('image'))) return false;
        await ormTilesDb.setItem(tileKey, blob);
        return true;
    } catch (e) {
        return false;
    }
}

function createOfflineCapableTileLayer(urlTemplate, layerPrefix, options) {
    if (typeof L === 'undefined') return null;
    const OfflineLayer = L.TileLayer.extend({
        createTile: function(coords, done) {
            const tile = document.createElement('img');
            L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
            L.DomEvent.on(tile, 'error', L.bind(this._tileOnError, this, done, tile));
            tile.alt = '';
            tile.setAttribute('role', 'presentation');

            const tileKey = layerPrefix + '_' + coords.z + '_' + coords.x + '_' + coords.y;
            const onlineUrl = this.getTileUrl(coords);

            ormTilesDb.getItem(tileKey).then((cachedBlob) => {
                if (cachedBlob && (cachedBlob instanceof Blob) && cachedBlob.size >= 100) {
                    const objUrl = URL.createObjectURL(cachedBlob);
                    tile.src = objUrl;
                    return;
                }
                if (navigator.onLine) {
                    fetch(onlineUrl, { mode: 'cors' })
                        .then(r => {
                            if (!r.ok || (r.headers && r.headers.get('x-blocked'))) {
                                throw new Error('Tile HTTP ' + r.status);
                            }
                            return r.blob();
                        })
                        .then(blob => {
                            if (!blob || blob.size < 100 || (blob.type && !blob.type.includes('image'))) {
                                throw new Error('Invalid tile blob');
                            }
                            ormTilesDb.setItem(tileKey, blob).catch(() => {});
                            tile.src = URL.createObjectURL(blob);
                        })
                        .catch(() => {
                            tile.src = onlineUrl;
                        });
                } else {
                    tile.src = onlineUrl;
                }
            }).catch(() => {
                tile.src = onlineUrl;
            });

            return tile;
        }
    });
    return new OfflineLayer(urlTemplate, options);
}

// Pobranie bazowej mapy sieci kolejowej Polski OpenRailwayMap do bazy offline (zoom 6..8)
window.downloadPolandOrmBaseOffline = async function(isManual = false) {
    if (!navigator.onLine) {
        if (isManual) alert('Brak połączenia z internetem. Nie można pobrać nowych kafelków OpenRailwayMap.');
        return;
    }
    const btn = document.getElementById('btnRefreshOrmOffline');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Pobieranie mapy kolejowej (0%)...';
    }

    const tileTasks = [];
    // Obszar Polski: lat 49.0..54.9, lon 14.1..24.2 dla zoom 6 i 7 (kompletna siatka szlaków Polski)
    for (let z = 6; z <= 7; z++) {
        const xMin = lon2tile(14.1, z);
        const xMax = lon2tile(24.2, z);
        const yMin = lat2tile(54.9, z);
        const yMax = lat2tile(49.0, z);
        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                tileTasks.push({
                    key: 'orm_' + z + '_' + x + '_' + y,
                    url: 'https://a.tiles.openrailwaymap.org/standard/' + z + '/' + x + '/' + y + '.png'
                });
                tileTasks.push({
                    key: 'osmfr_' + z + '_' + x + '_' + y,
                    url: 'https://a.tile.openstreetmap.fr/osmfr/' + z + '/' + x + '/' + y + '.png'
                });
            }
        }
    }

    let completed = 0;
    const batchSize = 6;
    for (let i = 0; i < tileTasks.length; i += batchSize) {
        const slice = tileTasks.slice(i, i + batchSize);
        await Promise.allSettled(slice.map(t => fetchAndCacheSingleTile('', t.url, t.key)));
        completed += slice.length;
        if (btn) {
            const pct = Math.min(100, Math.round((completed / tileTasks.length) * 100));
            btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E Pobieranie mapy ORM (' + pct + '%)...';
        }
    }

    localStorage.setItem('CZUWAK_ORM_BASE_SYNCED', 'true');
    window.updateStats();

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--open);"\x3Echeck_circle\x3C/span\x3E Mapa OpenRailwayMap zapisana Offline';
    }
    if (isManual) {
        alert('Bazowa mapa kolejowa OpenRailwayMap została pobrana do lokalnej bazy danych telefonu (IndexedDB)!');
    }
};

// Automatyczne / ręczne pobranie szczegółowych kafelków OpenRailwayMap (zoom 8..11) wzdłuż aktualnie wybranej trasy pociągu
window._activeRouteCacheTaskKey = null;
window.downloadCurrentRouteMapOffline = async function(isManual = false) {
    const pts = window._currentRouteStationsWithGps || [];
    if (pts.length === 0) {
        if (isManual) alert('Najpierw wybierz pociąg, aby pobrać mapę jego trasy do bazy Offline.');
        return;
    }

    const btn = document.getElementById('btnCacheRouteOrm');
    const lbl = document.getElementById('btnCacheRouteOrmLabel');
    const iconEl = document.getElementById('iconCacheRouteOrm');

    if (!navigator.onLine) {
        if (lbl) lbl.innerText = 'Mapa trasy z pamięci Offline';
        if (isManual) alert('Brak połączenia z internetem. Korzystasz z kafelków zapisanych już w bazie Offline.');
        return;
    }

    const routeKey = (window._currentActiveTrainNumber || 'TR') + '_' + pts.length + '_' + (pts[0]?.name || '') + '_' + (pts[pts.length - 1]?.name || '');
    if (!isManual && window._activeRouteCacheTaskKey === routeKey) {
        return;
    }
    window._activeRouteCacheTaskKey = routeKey;

    if (btn) btn.disabled = true;
    if (iconEl) iconEl.innerText = 'downloading';
    if (lbl) lbl.innerText = 'Auto-pobieranie mapy trasy (0%)...';

    const tileMap = new Map();
    const addTilePair = (z, x, y) => {
        const ormKey = 'orm_' + z + '_' + x + '_' + y;
        if (!tileMap.has(ormKey)) {
            tileMap.set(ormKey, 'https://a.tiles.openrailwaymap.org/standard/' + z + '/' + x + '/' + y + '.png');
        }
        const osmfrKey = 'osmfr_' + z + '_' + x + '_' + y;
        if (!tileMap.has(osmfrKey)) {
            tileMap.set(osmfrKey, 'https://a.tile.openstreetmap.fr/osmfr/' + z + '/' + x + '/' + y + '.png');
        }
    };

    // Próbkowanie punktów wzdłuż każdego odcinka trasy pociągu (zoom 8, 9, 10, 11 wokół stacji)
    for (let i = 0; i < pts.length; i++) {
        const A = pts[i];
        [8, 9, 10, 11].forEach(z => {
            const tx = lon2tile(A.lng, z);
            const ty = lat2tile(A.lat, z);
            const rad = (z <= 9) ? 1 : 0;
            for (let dx = -rad; dx <= rad; dx++) {
                for (let dy = -rad; dy <= rad; dy++) {
                    addTilePair(z, tx + dx, ty + dy);
                }
            }
        });
        if (i < pts.length - 1) {
            const B = pts[i + 1];
            const steps = 6;
            for (let s = 1; s < steps; s++) {
                const frac = s / steps;
                const lat = A.lat + (B.lat - A.lat) * frac;
                const lng = A.lng + (B.lng - A.lng) * frac;
                [8, 9, 10].forEach(z => {
                    addTilePair(z, lon2tile(lng, z), lat2tile(lat, z));
                });
            }
        }
    }

    const entries = Array.from(tileMap.entries());
    let done = 0;
    const batchSize = 8;
    for (let i = 0; i < entries.length; i += batchSize) {
        if (window._activeRouteCacheTaskKey !== routeKey) return;
        const chunk = entries.slice(i, i + batchSize);
        await Promise.allSettled(chunk.map(([k, u]) => fetchAndCacheSingleTile('', u, k)));
        done += chunk.length;
        if (lbl) {
            const pct = Math.min(100, Math.round((done / entries.length) * 100));
            lbl.innerText = 'Mapa trasy Offline (' + pct + '%)...';
        }
    }

    if (btn) btn.disabled = false;
    if (iconEl) iconEl.innerText = 'download_done';
    if (lbl) lbl.innerText = 'Mapa trasy pobrana Offline ✓';
    const badge = document.getElementById('ormOfflineBadge');
    if (badge) badge.innerText = 'Trasa w bazie Offline (' + entries.length + ' warstw)';
    window.updateStats();
};

window.initOrUpdateOpenRailwayMap = function() {
    if (typeof L === 'undefined') return;
    const container = document.getElementById('openRailwayMapContainer');
    if (!container) return;

    if (!window._ormLeafletMap) {
        window._ormLeafletMap = L.map(container, {
            center: [52.069, 19.480],
            zoom: 6,
            zoomControl: true
        });

        const baseOsmFr = createOfflineCapableTileLayer(
            'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
            'osmfr',
            {
                maxZoom: 19,
                subdomains: 'abc',
                attribution: '&' + 'copy; OpenStreetMap &' + 'copy; OSM-FR'
            }
        );
        const railwayOverlay = createOfflineCapableTileLayer(
            'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
            'orm',
            {
                maxZoom: 17,
                subdomains: 'abc',
                attribution: '&' + 'copy; OpenRailwayMap'
            }
        );

        if (baseOsmFr) baseOsmFr.addTo(window._ormLeafletMap);
        if (railwayOverlay) railwayOverlay.addTo(window._ormLeafletMap);
        window._ormRouteLayerGroup = L.layerGroup().addTo(window._ormLeafletMap);
    }

    setTimeout(() => {
        if (window._ormLeafletMap) window._ormLeafletMap.invalidateSize();
    }, 100);

    if (!window._ormRouteLayerGroup) return;
    window._ormRouteLayerGroup.clearLayers();
    window._ormApproachCircle = null;
    window._ormTrainMarker = null;

    const pts = window._currentRouteStationsWithGps || [];
    if (pts.length === 0) return;

    const latlngs = pts.map(p => [p.lat, p.lng]);

    // Linia trasy pociągu
    L.polyline(latlngs, {
        color: '#0284c7',
        weight: 4,
        opacity: 0.85,
        dashArray: '8, 6'
    }).addTo(window._ormRouteLayerGroup);

    // Znaczniki stacji na trasie
    pts.forEach((st, idx) => {
        const isEndpoint = (idx === 0 || idx === pts.length - 1);
        const marker = L.circleMarker([st.lat, st.lng], {
            radius: isEndpoint ? 7 : 5,
            fillColor: isEndpoint ? '#f59e0b' : '#38bdf8',
            color: '#0f172a',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.95
        });
        const popupHtml =
            '\x3Cdiv style="font-family:sans-serif; font-size:0.84rem; line-height:1.35;"\x3E' +
                '\x3Cstrong\x3E' + escapeHTML(st.name) + '\x3C/strong\x3E\x3Cbr\x3E' +
                'Przyj: \x3Cstrong\x3E' + escapeHTML(st.arrStr || '-') + '\x3C/strong\x3E | Odj: \x3Cstrong\x3E' + escapeHTML(st.depStr || '-') + '\x3C/strong\x3E' +
            '\x3C/div\x3E';
        marker.bindPopup(popupHtml);
        marker.addTo(window._ormRouteLayerGroup);
    });

    if (latlngs.length >= 2) {
        window._ormLeafletMap.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
    } else if (latlngs.length === 1) {
        window._ormLeafletMap.setView(latlngs[0], 11);
    }

    if (window._lastTrainGpsFix) {
        window.updateOrmLiveTrainPosition(
            window._lastTrainGpsFix.lat,
            window._lastTrainGpsFix.lng,
            window._ormNextStationCoords
        );
    }
};

window.updateOrmApproachCircle = function() {
    if (!window._ormLeafletMap || !window._ormRouteLayerGroup || !window._ormNextStationCoords) return;
    if (window._ormApproachCircle) {
        window._ormApproachCircle.setRadius(window.getAlertDistanceKm() * 1000);
    }
};

window.updateOrmLiveTrainPosition = function(userLat, userLng, nextStationObj) {
    if (nextStationObj && typeof nextStationObj.lat === 'number' && typeof nextStationObj.lng === 'number') {
        window._ormNextStationCoords = nextStationObj;
    }
    if (!window._ormLeafletMap || !window._ormRouteLayerGroup) return;

    if (!window._ormTrainMarker) {
        window._ormTrainMarker = L.circleMarker([userLat, userLng], {
            radius: 9,
            fillColor: '#22c55e',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 1
        }).addTo(window._ormRouteLayerGroup);
        window._ormTrainMarker.bindPopup('\x3Cstrong\x3ETwoja pozycja pociągu (GPS)\x3C/strong\x3E');
    } else {
        window._ormTrainMarker.setLatLng([userLat, userLng]);
    }

    if (window._ormNextStationCoords) {
        const radMeters = window.getAlertDistanceKm() * 1000;
        if (!window._ormApproachCircle) {
            window._ormApproachCircle = L.circle([window._ormNextStationCoords.lat, window._ormNextStationCoords.lng], {
                radius: radMeters,
                color: '#f59e0b',
                weight: 2,
                dashArray: '6, 6',
                fillColor: '#f59e0b',
                fillOpacity: 0.12
            }).addTo(window._ormRouteLayerGroup);
        } else {
            window._ormApproachCircle.setLatLng([window._ormNextStationCoords.lat, window._ormNextStationCoords.lng]);
            window._ormApproachCircle.setRadius(radMeters);
        }
    }
};

window.centerOrmMapOnUser = function() {
    if (!window._ormLeafletMap) return;
    window._ormLeafletMap.invalidateSize();
    if (window._lastTrainGpsFix && typeof window._lastTrainGpsFix.lat === 'number') {
        window._ormLeafletMap.setView([window._lastTrainGpsFix.lat, window._lastTrainGpsFix.lng], 14, { animate: true });
    } else if (window._currentRouteStationsWithGps && window._currentRouteStationsWithGps.length > 0) {
        const first = window._currentRouteStationsWithGps[0];
        window._ormLeafletMap.setView([first.lat, first.lng], 13, { animate: true });
    }
};

window.fitOrmMapRoute = function() {
    if (!window._ormLeafletMap || !window._currentRouteStationsWithGps) return;
    const pts = window._currentRouteStationsWithGps;
    if (pts.length >= 2) {
        const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
        window._ormLeafletMap.fitBounds(bounds, { padding: [30, 30], animate: true });
    }
};

window.toggleOpenRailwayMap = function(forceOpen = null) {
    const wrapper = document.getElementById('openRailwayMapWrapper');
    const lbl = document.getElementById('btnToggleOrmMapLabel');
    const fabMapBtn = document.getElementById('fabMapBtn');
    if (!wrapper) return;

    let shouldOpen = false;
    if (forceOpen === true) {
        shouldOpen = true;
    } else if (forceOpen === false) {
        shouldOpen = false;
    } else {
        const isHidden = (wrapper.style.display === 'none' || !wrapper.style.display);
        shouldOpen = isHidden;
    }

    if (shouldOpen) {
        wrapper.style.display = 'flex';
        if (lbl) lbl.innerText = 'Ukryj mapę OpenRailwayMap';
        if (fabMapBtn) fabMapBtn.classList.add('fab-active');
        window.initOrUpdateOpenRailwayMap();
        setTimeout(() => {
            window.centerOrmMapOnUser();
        }, 150);
    } else {
        wrapper.style.display = 'none';
        if (lbl) lbl.innerText = 'Pokaż trasę na OpenRailwayMap';
        if (fabMapBtn) fabMapBtn.classList.remove('fab-active');
    }
};

// ==========================================
// NAWIGACJA I HISTORIA 5 OSTATNICH POCIĄGÓW
// ==========================================
window.toggleMenu = () => {
    window.updateStats();
    document.getElementById('menuOverlay').classList.toggle('active');
};

window.switchMode = (mode) => {
    currentMode = mode;
    localStorage.setItem('CZUWAK_LAST_MODE', mode);

    const tabTrain = document.getElementById('tabTrain');
    const tabRecent = document.getElementById('tabRecent');
    if (tabTrain) tabTrain.classList.toggle('active', mode === 'train');
    if (tabRecent) tabRecent.classList.toggle('active', mode === 'recent');

    const searchTrainBox = document.getElementById('searchTrainBox');
    const searchRecentBox = document.getElementById('searchRecentBox');
    if (searchTrainBox) searchTrainBox.style.display = mode === 'train' ? 'block' : 'none';
    if (searchRecentBox) searchRecentBox.style.display = mode === 'recent' ? 'block' : 'none';

    document.getElementById('detailsList').style.display = 'none';
    document.getElementById('mainStatusBox').style.display = 'none';
    document.getElementById('detailsList').innerHTML = '';

    const ormSec = document.getElementById('openRailwayMapSection');
    if (ormSec && mode !== 'train') ormSec.style.display = 'none';

    const fabContainer = document.getElementById('trainFabContainer');

    if (mode === 'train') {
        if (fabContainer) fabContainer.style.display = document.querySelector('.train-route-table') ? 'flex' : 'none';
        window.triggerSearch();
    } else if (mode === 'recent') {
        window.stopTrainTracking();
        if (fabContainer) fabContainer.style.display = 'none';
        window.renderRecentView();
    }
};

window.switchTrainMode = (mode) => {
    currentTrainMode = mode;
    localStorage.setItem('CZUWAK_LAST_TRAIN_MODE', mode);
    const tabNum = document.getElementById('subTabTrainNumber');
    const tabName = document.getElementById('subTabTrainName');
    if (tabNum) tabNum.classList.toggle('active', mode === 'number');
    if (tabName) tabName.classList.toggle('active', mode === 'name');

    const boxNum = document.getElementById('trainNumberContainer');
    const boxName = document.getElementById('trainNameContainer');
    if (boxNum) boxNum.style.display = mode === 'number' ? 'block' : 'none';
    if (boxName) boxName.style.display = mode === 'name' ? 'block' : 'none';
};

window.submitTrainConfiguration = () => {
    window.findTrainForConfiguration();
};

window.addRecentTrain = (trainObj) => {
    if (!trainObj || !trainObj.numer) return;
    const cleanNum = String(trainObj.numer).trim();
    if (!cleanNum) return;
    try {
        let list = JSON.parse(localStorage.getItem(RECENT_TRAINS_KEY) || '[]');
        if (!Array.isArray(list)) list = [];
        list = list.filter(item => {
            const num = typeof item === 'object' && item ? item.numer : item;
            return String(num).trim() !== cleanNum;
        });
        list.unshift({
            numer: cleanNum,
            nazwa: String(trainObj.nazwa || '').trim(),
            relacja: String(trainObj.relacja || '').trim()
        });
        if (list.length > MAX_RECENT_ITEMS) list = list.slice(0, MAX_RECENT_ITEMS);
        localStorage.setItem(RECENT_TRAINS_KEY, JSON.stringify(list));
    } catch (e) {}
};

window.clearRecentHistory = () => {
    if (confirm('Czy na pewno chcesz wyczyścić historię ostatnich pociągów?')) {
        localStorage.removeItem(RECENT_TRAINS_KEY);
        window.renderRecentView();
    }
};

window.renderRecentView = () => {
    const trContainer = document.getElementById('recentTrainsContainer');
    if (!trContainer) return;

    let trains = [];
    try {
        trains = JSON.parse(localStorage.getItem(RECENT_TRAINS_KEY) || '[]');
        if (!Array.isArray(trains)) trains = [];
    } catch (e) { trains = []; }

    if (trains.length === 0) {
        trContainer.innerHTML =
            '\x3Cdiv class="recent-empty-state"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:2.8rem; color:var(--text-muted); opacity:0.6; margin-bottom:8px;"\x3Edirections_transit\x3C/span\x3E' +
                '\x3Cdiv style="font-weight:700; color:var(--text); font-size:1rem; margin-bottom:4px;"\x3EBrak ostatnio używanych pociągów\x3C/div\x3E' +
                '\x3Cdiv style="font-size:0.85rem; color:var(--text-muted); max-width:280px; margin:0 auto; line-height:1.4;"\x3EWyszukaj pociąg w zakładce Pociąg, a pojawi się tutaj automatycznie.\x3C/div\x3E' +
            '\x3C/div\x3E';
    } else {
        let trHtml = '\x3Cdiv style="display:flex; flex-direction:column; gap:8px;"\x3E';
        trains.forEach(t => {
            const num = t && t.numer ? String(t.numer) : '';
            if (!num) return;
            const escNum = escapeHTML(num);
            const nazwa = t && t.nazwa ? escapeHTML(t.nazwa) : '';
            const relacja = t && t.relacja ? escapeHTML(t.relacja) : '';
            const titleText = nazwa ? (escNum + ' \u2022 ' + nazwa) : escNum;

            trHtml +=
                '\x3Cdiv class="card glass-panel recent-item-card" data-numer="' + escNum + '" onclick="window.selectTrainByNumber(this.dataset.numer)"\x3E' +
                    '\x3Cdiv style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;"\x3E' +
                        '\x3Cdiv class="recent-icon-wrapper"\x3E' +
                            '\x3Cspan class="material-symbols-outlined"\x3Edirections_transit\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;"\x3E' +
                            '\x3Cdiv style="font-weight:700; font-size:1.02rem; color:var(--text);"\x3E' + titleText + '\x3C/div\x3E' +
                            (relacja ? ('\x3Cdiv style="font-size:0.82rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;"\x3E' + relacja + '\x3C/div\x3E') : '') +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cspan class="material-symbols-outlined recent-arrow"\x3Echevron_right\x3C/span\x3E' +
                '\x3C/div\x3E';
        });
        trHtml += '\x3C/div\x3E';
        trContainer.innerHTML = trHtml;
    }
};

window.selectTrainByNumber = (numerPociagu) => {
    window.stopTrainTracking();
    window._configPanelForceExpanded = true;
    window.switchMode('train');
    window.switchTrainMode('number');
    const trIn = document.getElementById('trainInput');
    if (trIn) {
        trIn.value = numerPociagu;
        try { trIn.blur(); } catch (e) {}
    }
    window.lastSearchedTrainNum = numerPociagu;
    window.forceExactTrainMatch = true;

    window.findTrainForConfiguration();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.clearSearch = (inputId) => {
    const el = document.getElementById(inputId);
    if (el) el.value = '';

    window.stopTrainTracking();
    window._currentTrainObject = null;
    window._pendingTrain = null;
    window._pendingTrainBestMatch = null;
    window.forceExactTrainMatch = false;
    window.expandTrainConfigPanel();

    const dList = document.getElementById('detailsList');
    if (dList) {
        dList.innerHTML = '';
        dList.style.display = 'none';
    }
    const mBox = document.getElementById('mainStatusBox');
    if (mBox) mBox.style.display = 'none';

    const ormSec = document.getElementById('openRailwayMapSection');
    if (ormSec) ormSec.style.display = 'none';

    const dutyBox = document.getElementById('crewDutyConfigBox');
    if (dutyBox) dutyBox.style.display = 'none';

    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'none';

    window.lastSearchedTrainNum = '';
    window.lastSearchedTrainName = '';
    localStorage.removeItem('CZUWAK_CONFIRMED_TRAIN_NUM');
    localStorage.removeItem('CZUWAK_LAST_TRAIN_NUM');
    localStorage.removeItem('CZUWAK_LAST_TRAIN_NAME');

    window.renderSleepState();
};

let searchTimeout = null;
window.triggerSearch = () => {
    const currentTrainInput = document.getElementById('trainInput') ? document.getElementById('trainInput').value : '';
    const currentTrainName = document.getElementById('trainNameInput') ? document.getElementById('trainNameInput').value : '';
    if (window.lastSearchedTrainNum !== currentTrainInput || window.lastSearchedTrainName !== currentTrainName) {
        window.forceExactTrainMatch = false;
        window.lastSearchedTrainNum = currentTrainInput;
        window.lastSearchedTrainName = currentTrainName;
        window.stopTrainTracking();
    }

    if (searchTimeout) clearTimeout(searchTimeout);
    document.getElementById('mainStatusBox').style.display = 'none';
    document.getElementById('detailsList').style.display = 'none';
    document.getElementById('skeletonLoader').style.display = 'block';

    searchTimeout = setTimeout(() => {
        if (document.getElementById('skeletonLoader')) document.getElementById('skeletonLoader').style.display = 'none';
        try {
            wyswietlWidok();
        } catch (e) {
            console.error("Błąd podczas renderowania widoku: ", e);
            document.getElementById('detailsList').innerHTML = '\x3Cdiv style="color:var(--danger); padding:20px; text-align:center;"\x3EBłąd wyświetlania: ' + escapeHTML(e.message) + '\x3C/div\x3E';
            document.getElementById('detailsList').style.display = 'block';
        }
    }, 250);
};

window.closeActiveTrainAndSleep = () => {
    if (!confirm('Czy na pewno chcesz zamkn\u0105\u0107 obs\u0142ugiwany poci\u0105g i u\u015bpi\u0107 aplikacj\u0119 Czuwak?')) {
        return;
    }

    if (typeof window.archiveCurrentTrainToHistory === 'function') {
        window.archiveCurrentTrainToHistory('Zakończenie i uśpienie');
    }
    if (typeof window.markDutyPlanItemCompleted === 'function') {
        if (window._activeDutyPlanDate && window._activeDutyPlanItemId) {
            window.markDutyPlanItemCompleted(window._activeDutyPlanDate, window._activeDutyPlanItemId, 'Zakończono ręcznie');
        } else if (window._currentActiveTrainNumber) {
            window.markDutyPlanItemCompletedByTrain(window.selectedTrainDepartureDate, window._currentActiveTrainNumber, 'Zakończono ręcznie');
        }
    }

    window.stopTrainTracking();
    window.stopAlarmLoop();

    const trainNumToClear = window._currentActiveTrainNumber;
    try {
        if (trainNumToClear) {
            localStorage.removeItem('CZUWAK_TRAIN_DELAY_' + trainNumToClear);
            localStorage.removeItem('CZUWAK_ACTIVE_ACTUAL_LOG_' + trainNumToClear);
        }
        localStorage.removeItem('CZUWAK_CONFIRMED_TRAIN_NUM');
        localStorage.removeItem('CZUWAK_LAST_TRAIN_NUM');
        localStorage.removeItem('CZUWAK_LAST_TRAIN_NAME');
    } catch (e) {}

    window._currentTrainObject = null;
    window._pendingTrain = null;
    window._pendingTrainBestMatch = null;
    window._currentActiveTrainNumber = null;
    window._lastTrainGpsFix = null;
    window._crewDutyCompleted = false;
    window._stationActualLog = {};
    window._trainDelayMinutes = 0;
    if (window._passedStationIndices) window._passedStationIndices.clear();

    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'APP', 'Zamknięto obsługiwany pociąg i uśpiono aplikację');
    }

    const trIn = document.getElementById('trainInput');
    const nameIn = document.getElementById('trainNameInput');
    if (trIn) trIn.value = '';
    if (nameIn) nameIn.value = '';

    const ormSec = document.getElementById('openRailwayMapSection');
    if (ormSec) ormSec.style.display = 'none';

    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'none';

    const dutyBox = document.getElementById('crewDutyConfigBox');
    if (dutyBox) dutyBox.style.display = 'none';

    const mainBox = document.getElementById('mainStatusBox');
    if (mainBox) mainBox.style.display = 'none';

    const miniHud = document.getElementById('floatingMiniHud');
    if (miniHud) miniHud.style.display = 'none';

    try {
        if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.clearWidget === 'function') {
            window.CzuwakNativeWidget.clearWidget();
        }
    } catch (e) {}

    window.expandTrainConfigPanel();
    window.updateSpeedAndGpsIndicator(0, 'idle', 'U\u015bpiony');
    window.renderSleepState();
    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.renderSleepState = () => {
    window.stopTrainTracking();
    window._currentTrainObject = null;
    window._pendingTrain = null;
    window.expandTrainConfigPanel();

    const dutyBox = document.getElementById('crewDutyConfigBox');
    if (dutyBox) dutyBox.style.display = 'none';
    const ormSec = document.getElementById('openRailwayMapSection');
    if (ormSec) ormSec.style.display = 'none';
    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'none';
    const mainBox = document.getElementById('mainStatusBox');
    if (mainBox) mainBox.style.display = 'none';

    const listContainer = document.getElementById('detailsList');
    if (listContainer) {
        listContainer.innerHTML =
            '\x3Cdiv class="card glass-panel" style="text-align: center; padding: 26px 16px; margin: 12px 0;"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size: 3rem; color: #38bdf8; opacity: 0.85; margin-bottom: 8px;"\x3Epower_settings_new\x3C/span\x3E' +
                '\x3Cdiv style="font-size: 1.15rem; font-weight: 800; color: var(--text); margin-bottom: 6px;"\x3EAplikacja Czuwak jest u\u015bpiona\x3C/div\x3E' +
                '\x3Cdiv style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.45; max-width: 320px; margin: 0 auto 14px auto;"\x3E' +
                    'Czuwak nie zu\u017cywa baterii ani GPS. Wprowad\u017a numer poci\u0105gu i kliknij \u201EZa\u0142aduj stacje poci\u0105gu\u201D, aby skonfigurowa\u0107 odcinek obs\u0142ugi DK.' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E';
        listContainer.style.display = 'block';
    }

    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
};

window.restoreLastState = () => {
    const confirmedTrainNum = localStorage.getItem('CZUWAK_CONFIRMED_TRAIN_NUM') || '';
    const lastTrNum = localStorage.getItem('CZUWAK_LAST_TRAIN_NUM') || '';
    const lastTrName = localStorage.getItem('CZUWAK_LAST_TRAIN_NAME') || '';

    const trInput = document.getElementById('trainInput');
    const nameInput = document.getElementById('trainNameInput');
    if (trInput) trInput.value = lastTrNum;
    if (nameInput) nameInput.value = lastTrName;

    window.syncTrainDateButtonsUI();

    const lastMode = localStorage.getItem('CZUWAK_LAST_MODE') || 'train';
    const lastTrMode = localStorage.getItem('CZUWAK_LAST_TRAIN_MODE') || 'number';

    window.switchTrainMode(lastTrMode);
    window.switchMode(lastMode);

    if (confirmedTrainNum && (lastTrNum || lastTrName)) {
        window.forceExactTrainMatch = true;
        window.findTrainForConfiguration(true);
    } else {
        window.renderSleepState();
    }

    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
};

window.hardReinstall = async () => {
    if (confirm("Czy na pewno chcesz wyczyścić zapisane bazy w pamięci telefonu i pobrać je od nowa?")) {
        const userThemePref = localStorage.getItem('CZUWAK_THEME_PREFERENCE');
        const userFontSize = localStorage.getItem('fontSize');
        const recentTrains = localStorage.getItem(RECENT_TRAINS_KEY);
        const alertDist = localStorage.getItem('CZUWAK_ALERT_DISTANCE_KM');
        const alertMode = localStorage.getItem('CZUWAK_ALERT_MODE');

        localStorage.clear();
        await localforage.clear();
        try { await ormTilesDb.clear(); } catch (e) {}

        if (userThemePref) localStorage.setItem('CZUWAK_THEME_PREFERENCE', userThemePref);
        if (userFontSize) localStorage.setItem('fontSize', userFontSize);
        if (recentTrains) localStorage.setItem(RECENT_TRAINS_KEY, recentTrains);
        if (alertDist) localStorage.setItem('CZUWAK_ALERT_DISTANCE_KM', alertDist);
        if (alertMode) localStorage.setItem('CZUWAK_ALERT_MODE', alertMode);

        window.location.reload();
    }
};

function zbudujListePociagow() {
    const dlNum = document.getElementById('trainsDictionary');
    const dlName = document.getElementById('trainNamesDictionary');
    if (dlNum) dlNum.innerHTML = '';
    if (dlName) dlName.innerHTML = '';

    const unikalneNumery = new Set();
    const unikalneNazwy = new Set();
    (bazaPociagow || []).forEach(p => {
        if (dlNum && p.numer && !unikalneNumery.has(p.numer)) {
            unikalneNumery.add(p.numer);
            const optNum = document.createElement('option');
            optNum.value = p.nazwa ? `${p.numer} | ${p.nazwa}` : p.numer;
            dlNum.appendChild(optNum);
        }
        if (p.nazwa) unikalneNazwy.add(String(p.nazwa).trim());
    });
    if (dlName) {
        [...unikalneNazwy].sort((a, b) => String(a).localeCompare(String(b), 'pl')).forEach(nazwa => {
            const optName = document.createElement('option');
            optName.value = nazwa;
            dlName.appendChild(optName);
        });
    }
}

// ==========================================
// HARMONOGRAM I DOBÓR WARIANTU WG WYBRANEJ PRZEZ PRACOWNIKA DATY WYJAZDU
// ==========================================
function timeToMinutes(tStr) {
    if (!tStr) return null;
    const p = String(tStr).split(':');
    if (p.length !== 2) return null;
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

function computeTrainAbsSchedule(stacjeArray) {
    let dayOffset = 0;
    let prevRawMin = -1;
    const total = stacjeArray.length;
    const schedule = stacjeArray.map(function(st, idx) {
        const isFirst = (idx === 0);
        const isLast = (idx === total - 1);
        const isIntermediate = !isFirst && !isLast;

        let arrStr = typeof st === 'object' && st !== null && st.przyjazd ? String(st.przyjazd).trim() : null;
        let depStr = typeof st === 'object' && st !== null && st.odjazd ? String(st.odjazd).trim() : null;
        if (arrStr === '-' || arrStr === '') arrStr = null;
        if (depStr === '-' || depStr === '') depStr = null;

        let arrRaw = arrStr ? timeToMinutes(arrStr) : null;
        let depRaw = depStr ? timeToMinutes(depStr) : null;

        const onlyBoarding = isIntermediate && (arrRaw === null && depRaw !== null);
        const onlyAlighting = isIntermediate && (depRaw === null && arrRaw !== null);

        if (arrRaw === null && depRaw !== null) arrRaw = depRaw;
        if (depRaw === null && arrRaw !== null) depRaw = arrRaw;

        let arr = null;
        let dep = null;

        if (arrRaw !== null) {
            if (prevRawMin !== -1 && arrRaw < prevRawMin && (prevRawMin - arrRaw) > 180) {
                dayOffset += 1440;
            }
            arr = dayOffset + arrRaw;
            prevRawMin = arrRaw;
        }
        if (depRaw !== null) {
            if (prevRawMin !== -1 && depRaw < prevRawMin && (prevRawMin - depRaw) > 180) {
                dayOffset += 1440;
            }
            dep = dayOffset + depRaw;
            prevRawMin = depRaw;
        }

        if (onlyAlighting && arr !== null) {
            dep = arr + 1;
        }

        return {
            arr: arr,
            dep: dep,
            onlyBoarding: onlyBoarding,
            onlyAlighting: onlyAlighting
        };
    });

    for (let i = 0; i < schedule.length; i++) {
        if (schedule[i].onlyAlighting && i < schedule.length - 1 && schedule[i].dep !== null && schedule[i + 1].arr !== null) {
            if (schedule[i].dep > schedule[i + 1].arr) {
                schedule[i].dep = schedule[i + 1].arr;
            }
        }
        if (schedule[i].onlyBoarding && i > 0 && schedule[i].dep !== null) {
            const prevDep = schedule[i - 1].dep !== null ? schedule[i - 1].dep : 0;
            schedule[i].arr = Math.max(prevDep, schedule[i].dep - 1);
        }
    }

    return schedule;
}

function extractTrainDates(train) {
    let str = train.data || train.daty_kursowania || train.terminy_kursowania || "";
    let isoMatches = String(str).match(/\d{4}-\d{2}-\d{2}/g) || [];
    let plMatches = (String(str).match(/\d{1,2}\.\d{1,2}\.\d{4}/g) || []).map(dStr => {
        const p = dStr.split('.');
        return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
    });
    return Array.from(new Set([...isoMatches, ...plMatches]));
}

// Dopasowanie wariantu pociągu do DATY WYBRANEJ PRZEZ PRACOWNIKA (window.selectedTrainDepartureDate)
function scoreTrainVariantForSelectedDate(train, now) {
    const selectedDateStr = window.selectedTrainDepartureDate || getLocalYYYYMMDD(now);
    const selectedDateObj = parseYYYYMMDDToDate(selectedDateStr, now);
    const todayDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAgo = Math.round((todayDateObj.getTime() - selectedDateObj.getTime()) / (1000 * 3600 * 24));

    const tNow = now.getHours() * 60 + now.getMinutes();
    const relNow = tNow + (daysAgo * 1440);

    const dates = extractTrainDates(train);
    const plSelected = formatPlDate(selectedDateStr);

    let runLabel = plSelected;
    if (daysAgo === 1) {
        runLabel = plSelected + ' (Wyjazd wczoraj)';
    } else if (daysAgo === 0) {
        runLabel = plSelected + ' (Wyjazd dzisiaj)';
    } else if (daysAgo === -1) {
        runLabel = plSelected + ' (Wyjazd jutro)';
    } else if (daysAgo > 1) {
        runLabel = plSelected + ' (Wyjazd ' + daysAgo + ' dni temu)';
    }

    if (dates.includes(selectedDateStr)) {
        return {
            score: 0.01,
            relNow: relNow,
            date: runLabel,
            originDateObj: selectedDateObj,
            daysAgo: daysAgo,
            exactDateMatch: true
        };
    }

    if (dates.length === 0) {
        return {
            score: 0.5,
            relNow: relNow,
            date: runLabel,
            originDateObj: selectedDateObj,
            daysAgo: daysAgo,
            exactDateMatch: true
        };
    }

    let minDiffDays = Infinity;
    dates.forEach(dStr => {
        const dObj = parseYYYYMMDDToDate(dStr, selectedDateObj);
        const diff = Math.abs(dObj.getTime() - selectedDateObj.getTime()) / (1000 * 3600 * 24);
        if (diff < minDiffDays) minDiffDays = diff;
    });

    return {
        score: 10 + minDiffDays,
        relNow: relNow,
        date: runLabel + ' [rozkład z: ' + dates.map(formatPlDate).join(', ') + ']',
        originDateObj: selectedDateObj,
        daysAgo: daysAgo,
        exactDateMatch: false
    };
}

window.centerOnElement = (element, smooth = true) => {
    if (!element) return;
    requestAnimationFrame(() => {
        setTimeout(() => {
            const rect = element.getBoundingClientRect();
            const elTop = rect.top + window.pageYOffset;
            const viewportH = window.innerHeight || document.documentElement.clientHeight;
            const targetY = Math.max(0, Math.round(elTop - (viewportH / 2) + (rect.height / 2)));
            try {
                window.scrollTo({ top: targetY, behavior: smooth ? 'smooth' : 'auto' });
            } catch (e) {
                window.scrollTo(0, targetY);
            }
        }, 80);
    });
};

// ==========================================
// ZWIJANIE / UKRYWANIE PANELU KONFIGURACJI PO SKONFIGUROWANIU
// ==========================================
window._configPanelForceExpanded = false;

window.collapseTrainConfigPanel = () => {
    window._configPanelForceExpanded = false;
    const body = document.getElementById('trainConfigCollapsibleBody');
    const bar = document.getElementById('collapsedTrainConfigBar');
    const planCard = document.getElementById('activeDutyPlanHomeCard');
    if (planCard) planCard.style.display = 'none';
    if (body && bar && window._currentTrainObject) {
        body.style.display = 'none';
        bar.style.display = 'flex';
    }
};

window.expandTrainConfigPanel = () => {
    window._configPanelForceExpanded = true;
    const body = document.getElementById('trainConfigCollapsibleBody');
    const bar = document.getElementById('collapsedTrainConfigBar');
    if (body) body.style.display = 'block';
    if (bar) bar.style.display = 'none';
    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
};

window.toggleTrainConfigPanel = (forceOpen) => {
    const body = document.getElementById('trainConfigCollapsibleBody');
    if (!body) return;
    if (forceOpen === true || body.style.display === 'none') {
        window.expandTrainConfigPanel();
    } else {
        window.collapseTrainConfigPanel();
    }
};

window.syncCollapsedConfigBar = (trainTitleStr, dutySubStr) => {
    const tEl = document.getElementById('collapsedConfigTrainTitle');
    const sEl = document.getElementById('collapsedConfigDutySub');
    if (tEl && trainTitleStr) tEl.innerText = trainTitleStr;
    if (sEl && dutySubStr) sEl.innerText = dutySubStr;
};

// ==========================================
// AUTOMATYCZNY ZAPIS RZECZYWISTEGO POSTOJU (HH:MM:SS) I ODJAZDU (HH:MM:SS) + ODHACZANIE STACJI
// ==========================================
window._stationActualLog = {};
window._currentStandingStationIdx = null;

function formatNowHHMMSS() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
}
window.formatNowHHMMSS = formatNowHHMMSS;

window._trainDelayMinutes = 0;

function addMinutesToHHMM(hhmmStr, extraMinutes) {
    if (!hhmmStr || hhmmStr === '-' || !hhmmStr.includes(':')) return null;
    const parts = hhmmStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    const totalMin = ((h * 60 + m + Number(extraMinutes)) % 1440 + 1440) % 1440;
    const newH = Math.floor(totalMin / 60);
    const newM = totalMin % 60;
    return String(newH).padStart(2, '0') + ':' + String(newM).padStart(2, '0');
}

window.isAutoDelayEnabled = () => {
    return localStorage.getItem('CZUWAK_AUTO_DELAY_ENABLED') !== 'false';
};

window.setAutoDelayEnabled = (val) => {
    localStorage.setItem('CZUWAK_AUTO_DELAY_ENABLED', val ? 'true' : 'false');
    const menuLabel = document.getElementById('menuAutoDelayLabel');
    if (menuLabel) {
        menuLabel.innerText = 'Auto-obliczanie opóźnień z GPS: ' + (val ? 'WŁĄCZONE' : 'WYŁĄCZONE');
    }
};

window.toggleAutoDelayEnabled = () => {
    const cur = window.isAutoDelayEnabled();
    window.setAutoDelayEnabled(!cur);
    alert('Automatyczne wyliczanie opóźnienia ze stacji zostało ' + (!cur ? 'WŁĄCZONE' : 'WYŁĄCZONE') + '.');
};

window.showAutoDelayToast = (stName, delayMin, typeLabel = '') => {
    let toast = document.getElementById('autoDelayToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'autoDelayToast';
        toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:99998; background:rgba(15,23,42,0.96); border:1.5px solid #f59e0b; border-radius:999px; padding:8px 18px; color:#ffffff; font-size:0.84rem; font-weight:800; display:flex; align-items:center; gap:8px; box-shadow:0 8px 24px rgba(0,0,0,0.5); backdrop-filter:blur(8px); transition:opacity 0.3s ease; animation: slideDownToast 0.3s ease-out;';
        document.body.appendChild(toast);
    }
    const txt = delayMin > 0
        ? ('+' + delayMin + ' min opóźnienia (' + stName + ')')
        : ('Pociąg jedzie planowo (' + stName + ')');
    toast.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm" style="color:#fbbf24;"\x3Eschedule\x3C/span\x3E ' +
        '\x3Cspan\x3EAuto-opóźnienie: \x3Cstrong style="color:#fbbf24;"\x3E' + escapeHTML(txt) + '\x3C/strong\x3E\x3C/span\x3E';
    toast.style.display = 'flex';
    toast.style.opacity = '1';

    if (window._autoDelayToastTimer) clearTimeout(window._autoDelayToastTimer);
    window._autoDelayToastTimer = setTimeout(() => {
        if (toast) {
            toast.style.opacity = '0';
            setTimeout(() => { if (toast) toast.style.display = 'none'; }, 300);
        }
    }, 3800);
};

window.autoCalculateDelayFromActualTime = (idx) => {
    if (!window.isAutoDelayEnabled()) return;
    if (!window._currentTrainObject) return;

    const stacjeArray = Array.isArray(window._currentTrainObject.stacje)
        ? window._currentTrainObject.stacje
        : Object.values(window._currentTrainObject.stacje || {});
    if (idx < 0 || idx >= stacjeArray.length) return;

    const entry = window._stationActualLog && window._stationActualLog[idx];
    if (!entry) return;

    const stObj = stacjeArray[idx];
    const arrStr = (stObj && typeof stObj === 'object' && stObj.przyjazd && stObj.przyjazd !== '-') ? String(stObj.przyjazd).trim() : null;
    const depStr = (stObj && typeof stObj === 'object' && stObj.odjazd && stObj.odjazd !== '-') ? String(stObj.odjazd).trim() : null;
    const stName = (stObj && typeof stObj === 'object' && stObj.nazwa) ? stObj.nazwa : ('Stacja ' + (idx + 1));

    let actTime = null;
    let planTime = null;
    let typeLabel = '';

    if (entry.actualDep && depStr) {
        actTime = entry.actualDep;
        planTime = depStr;
        typeLabel = 'odjazdu';
    } else if (entry.actualArr && arrStr) {
        actTime = entry.actualArr;
        planTime = arrStr;
        typeLabel = 'przyjazdu';
    } else if (entry.actualArr && depStr) {
        actTime = entry.actualArr;
        planTime = depStr;
        typeLabel = 'postoju';
    }

    if (!actTime || !planTime) return;

    const actParts = actTime.split(':');
    const planParts = planTime.split(':');
    if (actParts.length < 2 || planParts.length < 2) return;

    const actH = parseInt(actParts[0], 10);
    const actM = parseInt(actParts[1], 10);
    const planH = parseInt(planParts[0], 10);
    const planM = parseInt(planParts[1], 10);
    if (isNaN(actH) || isNaN(actM) || isNaN(planH) || isNaN(planM)) return;

    let diffMin = (actH * 60 + actM) - (planH * 60 + planM);
    if (diffMin < -720) diffMin += 1440;
    if (diffMin > 720) diffMin -= 1440;

    const calculatedDelay = Math.max(0, diffMin);
    if (calculatedDelay !== window._trainDelayMinutes) {
        window.setTrainDelay(calculatedDelay);
        window.showAutoDelayToast(stName, calculatedDelay, typeLabel);
    }
};

window.setTrainDelay = (minutes) => {
    let delay = parseInt(minutes, 10);
    if (isNaN(delay) || delay < 0) delay = 0;
    window._trainDelayMinutes = delay;

    const trainNum = window._currentActiveTrainNumber || (window._currentTrainObject && window._currentTrainObject.numer) || '';
    if (trainNum) {
        try {
            if (delay > 0) {
                localStorage.setItem('CZUWAK_TRAIN_DELAY_' + trainNum, String(delay));
            } else {
                localStorage.removeItem('CZUWAK_TRAIN_DELAY_' + trainNum);
            }
        } catch (e) {}
    }

    if (window._currentTrainObject) {
        generujWidokTrasy(
            window._currentTrainObject,
            document.getElementById('detailsList'),
            document.getElementById('mainStatusBox'),
            window._currentTrainBestMatch
        );
    }
};

window.closeCzuwakSheet = () => {
    const existing = document.getElementById('czuwakSheetOverlay');
    if (existing) existing.remove();
};

window.openDelaySheet = () => {
    window.closeCzuwakSheet();
    const curDelay = window._trainDelayMinutes || 0;
    const isAuto = window.isAutoDelayEnabled();

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => {
        if (e.target === overlay) window.closeCzuwakSheet();
    };

    const pills = [0, 3, 5, 10, 15, 20, 30, 45, 60];
    let pillsHtml = '';
    pills.forEach((p) => {
        const isActive = (curDelay === p);
        const label = p === 0 ? 'Plan (0m)' : ('+' + p + 'm');
        pillsHtml += '\x3Cbutton type="button" class="quick-delay-pill' + (isActive ? ' active' : '') + '" data-val="' + p + '" onclick="window.setTrainDelay(this.dataset.val); window.openDelaySheet();"\x3E' + label + '\x3C/button\x3E';
    });

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Eschedule\x3C/span\x3E Opóźnienie pociągu' +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="text-align:center; padding:12px; background:var(--input-bg); border-radius:12px; border:1px solid var(--glass-border); margin-bottom:12px;"\x3E' +
                '\x3Cdiv style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); font-weight:800;"\x3EAktualne opóźnienie pociągu\x3C/div\x3E' +
                '\x3Cdiv id="sheetDelayValueBig" style="font-size:2.4rem; font-weight:900; color:' + (curDelay > 0 ? '#fbbf24' : '#22c55e') + '; font-variant-numeric:tabular-nums; margin:4px 0;"\x3E' +
                    (curDelay > 0 ? ('+' + curDelay + ' min') : 'Planowo (0 min)') +
                '\x3C/div\x3E' +
                '\x3Cdiv style="display:flex; gap:8px; justify-content:center; margin-top:8px;"\x3E' +
                    '\x3Cbutton type="button" data-delta="-5" onclick="window.changeDelayBy(-5)" class="hud-btn" style="flex:0 0 auto; min-height:42px; padding:6px 14px; font-weight:800;"\x3E-5m\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-delta="-1" onclick="window.changeDelayBy(-1)" class="hud-btn" style="flex:0 0 auto; min-height:42px; padding:6px 14px; font-weight:800;"\x3E-1m\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-delta="1" onclick="window.changeDelayBy(1)" class="hud-btn" style="flex:0 0 auto; min-height:42px; padding:6px 14px; font-weight:800;"\x3E+1m\x3C/button\x3E' +
                    '\x3Cbutton type="button" data-delta="5" onclick="window.changeDelayBy(5)" class="hud-btn" style="flex:0 0 auto; min-height:42px; padding:6px 14px; font-weight:800;"\x3E+5m\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="margin-bottom:12px;"\x3E' +
                '\x3Clabel style="display:block; font-size:0.8rem; font-weight:800; color:var(--text); margin-bottom:4px;"\x3EWpisz dowolne opóźnienie w minutach:\x3C/label\x3E' +
                '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                    '\x3Cinput type="number" id="sheetManualDelayInput" min="0" max="600" value="' + curDelay + '" placeholder="np. 12" style="flex:1; padding:9px 12px; font-weight:800; font-size:1.05rem; border-radius:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); text-align:center;"\x3E' +
                    '\x3Cbutton type="button" onclick="const v = parseInt(document.getElementById(\'sheetManualDelayInput\').value, 10); window.setTrainDelay(isNaN(v) ? 0 : v); window.openDelaySheet();" class="hud-btn primary" style="min-height:44px; padding:6px 16px; font-weight:900;"\x3E' +
                        'Ustaw' +
                    '\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="font-size:0.8rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:6px;"\x3ESzybki wybór:\x3C/div\x3E' +
            '\x3Cdiv class="quick-delay-grid"\x3E' + pillsHtml + '\x3C/div\x3E' +
            '\x3Clabel style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--input-bg); border-radius:10px; border:1px solid var(--glass-border); margin-bottom:14px; cursor:pointer;"\x3E' +
                '\x3Cinput type="checkbox" id="sheetAutoDelayChk" ' + (isAuto ? 'checked' : '') + ' onchange="window.setAutoDelayEnabled(this.checked)" style="width:20px; height:20px; accent-color:var(--primary); cursor:pointer;"\x3E' +
                '\x3Cspan style="font-size:0.82rem; font-weight:700; color:var(--text); line-height:1.3;"\x3EAutomatycznie aktualizuj opóźnienie z GPS na stacjach (postój / odjazd)\x3C/span\x3E' +
            '\x3C/label\x3E' +
            '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" class="menu-btn menu-btn-primary" style="width:100%; min-height:50px; font-size:1rem; font-weight:900; justify-content:center; gap:6px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined"\x3Echeck_circle\x3C/span\x3E Gotowe' +
            '\x3C/button\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
};

window.changeDelayBy = (delta) => {
    const cur = window._trainDelayMinutes || 0;
    const nextVal = Math.max(0, cur + Number(delta));
    window.setTrainDelay(nextVal);
    window.openDelaySheet();
};

window.promptSetTrainDelay = () => {
    window.openDelaySheet();
};

function getActiveTrainLogStorageKey() {
    const trNum = window._currentActiveTrainNumber || (window._currentTrainObject && window._currentTrainObject.numer) || '';
    const clean = String(trNum).trim();
    return clean ? ('CZUWAK_ACTIVE_ACTUAL_LOG_' + clean) : 'CZUWAK_ACTIVE_ACTUAL_LOG_DEFAULT';
}

function getActualTimesStorageKey() {
    const trNum = window._currentActiveTrainNumber || (window._currentTrainObject && window._currentTrainObject.numer) || 'TR';
    const depDate = window.selectedTrainDepartureDate || getLocalYYYYMMDD(new Date());
    return 'CZUWAK_ACTUAL_TIMES_' + String(trNum).trim() + '_' + depDate;
}

function loadStationActualLog() {
    window._stationActualLog = {};
    try {
        let raw = localStorage.getItem(getActiveTrainLogStorageKey());
        if (!raw) {
            raw = localStorage.getItem(getActualTimesStorageKey());
        }
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                window._stationActualLog = parsed;
                // Zapewnij odtworzenie zaliczonych stacji w _passedStationIndices
                if (!window._passedStationIndices) window._passedStationIndices = new Set();
                Object.keys(parsed).forEach(k => {
                    const stIdx = parseInt(k, 10);
                    if (!isNaN(stIdx) && parsed[k] && parsed[k].checked) {
                        window._passedStationIndices.add(stIdx);
                    }
                });
            }
        }
    } catch (e) {}
}

function saveStationActualLog() {
    try {
        const json = JSON.stringify(window._stationActualLog || {});
        localStorage.setItem(getActiveTrainLogStorageKey(), json);
        localStorage.setItem(getActualTimesStorageKey(), json);
    } catch (e) {}
}

function getCheckmarkSvgHtml(isChecked) {
    if (isChecked) {
        return '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/\x3E\x3C/svg\x3E';
    }
    return '\x3Csvg viewBox="0 0 24 24" aria-hidden="true"\x3E\x3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/\x3E\x3C/svg\x3E';
}

function getStationTagStorageKey(trainNum, idx) {
    return 'CZUWAK_STATION_TAG_' + String(trainNum).trim() + '_' + String(idx);
}
function getStationTagByNameStorageKey(trainNum, stationName) {
    return 'CZUWAK_STATION_TAG_NAME_' + String(trainNum).trim() + '_' + String(stationName || '').toUpperCase().trim();
}

window.getStationTag = (idx, stationName = null) => {
    const trNum = window._currentActiveTrainNumber || (window._currentTrainObject && window._currentTrainObject.numer) || '';
    const cleanNum = String(trNum).trim();
    if (!cleanNum) return null;
    let val = localStorage.getItem(getStationTagStorageKey(cleanNum, idx));
    if (!val) {
        let stName = stationName;
        if (!stName && window._currentTrainObject && window._currentTrainObject.stacje) {
            const arr = Array.isArray(window._currentTrainObject.stacje)
                ? window._currentTrainObject.stacje
                : Object.values(window._currentTrainObject.stacje);
            if (arr[idx]) {
                const s = arr[idx];
                stName = (typeof s === 'object' && s.nazwa) ? s.nazwa : (typeof s === 'string' ? s : '');
            }
        }
        if (stName) {
            val = localStorage.getItem(getStationTagByNameStorageKey(cleanNum, stName));
        }
    }
    return val || null;
};

window.setStationTag = (idx, tagText) => {
    const trNum = window._currentActiveTrainNumber || (window._currentTrainObject && window._currentTrainObject.numer) || '';
    const cleanNum = String(trNum).trim();
    if (!cleanNum) return;

    let stName = '';
    if (window._currentTrainObject && window._currentTrainObject.stacje) {
        const arr = Array.isArray(window._currentTrainObject.stacje)
            ? window._currentTrainObject.stacje
            : Object.values(window._currentTrainObject.stacje);
        if (arr[idx]) {
            const s = arr[idx];
            stName = (typeof s === 'object' && s.nazwa) ? s.nazwa : (typeof s === 'string' ? s : '');
        }
    }

    if (tagText) {
        localStorage.setItem(getStationTagStorageKey(cleanNum, idx), tagText);
        if (stName) localStorage.setItem(getStationTagByNameStorageKey(cleanNum, stName), tagText);
        window.czuwakLog('INFO', 'STATION', 'Zapisano znacznik stacji (' + (stName || idx) + '): ' + tagText);
    } else {
        localStorage.removeItem(getStationTagStorageKey(cleanNum, idx));
        if (stName) localStorage.removeItem(getStationTagByNameStorageKey(cleanNum, stName));
        window.czuwakLog('INFO', 'STATION', 'Usunięto znacznik stacji (' + (stName || idx) + ')');
    }
    if (window._currentTrainObject) {
        generujWidokTrasy(
            window._currentTrainObject,
            document.getElementById('detailsList'),
            document.getElementById('mainStatusBox'),
            window._currentTrainBestMatch
        );
    }
};

window.isStationStopChecked = (idx) => {
    if (idx === null || idx === undefined || idx < 0) return true;
    const entry = window._stationActualLog && window._stationActualLog[idx];
    return !!(entry && entry.checked);
};

window.confirmAndUnblockStationStop = (idxStr) => {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    window.recordStationArrivalStop(idx);
    window.czuwakLog('INFO', 'STATION', 'Ręcznie potwierdzono i odblokowano postój na stacji idx=' + idx);
    if (window.activeTrackingMode === 'gps') {
        window.locateTrainByGPS(true);
    }
};

window.isStationP115 = (idx, name = '') => {
    const tag = window.getStationTag(idx, name);
    if (!tag) return false;
    return /p115/i.test(tag) || /poza\s*peron/i.test(tag) || /kr[oó]tki\s*peron/i.test(tag);
};

window.getStationP115Coaches = (idx, name = '') => {
    const tag = window.getStationTag(idx, name);
    if (!tag) return '';
    const m = tag.match(/p115\s*:\s*([^|]+)/i) || tag.match(/poza\s*peron[a-z]*\s*:\s*([^|]+)/i);
    return m ? m[1].trim() : tag;
};

window.openStationTagModal = (idxStr) => {
    window.closeCzuwakSheet();
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    if (!window._currentTrainObject) return;

    const stacjeArray = Array.isArray(window._currentTrainObject.stacje)
        ? window._currentTrainObject.stacje
        : Object.values(window._currentTrainObject.stacje || {});
    const stObj = stacjeArray[idx] || {};
    const stName = (typeof stObj === 'object' && stObj.nazwa) ? stObj.nazwa : ('Stacja ' + (idx + 1));
    const curTag = window.getStationTag(idx, stName) || '';

    const isCurP115 = /p115/i.test(curTag) || /poza peron/i.test(curTag) || /kr[oó]tki peron/i.test(curTag);
    let p115CoachesVal = '';
    if (isCurP115) {
        const m = curTag.match(/p115\s*:\s*([^|]+)/i) || curTag.match(/poza\s*peron[a-z]*\s*:\s*([^|]+)/i);
        p115CoachesVal = m ? m[1].trim() : '';
    }

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    const presets = [
        { label: '♿ Wózek / PRM', val: '♿ PRM' },
        { label: '🚲 Rowery', val: '🚲 Rowery' },
        { label: '👥 Grupa podróżnych', val: '👥 Grupa' },
        { label: '⚡ Awaria drzwi', val: '⚡ Awaria drzwi' }
    ];

    let presetsHtml = '';
    presets.forEach(p => {
        presetsHtml += '\x3Cbutton type="button" data-val="' + escapeHTML(p.val) + '" onclick="document.getElementById(\'stationTagCustomInput\').value = this.dataset.val;" class="hud-btn" style="min-height:44px; text-align:left; justify-content:flex-start;"\x3E' +
            escapeHTML(p.label) +
        '\x3C/button\x3E';
    });

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content" style="max-height:92vh;"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Ebookmark\x3C/span\x3E Znacznik / Notatka: ' + escapeHTML(stName) +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +

            // DEDYKOWANA KARTA PROCEDURY P115 (KRÓTKI PERON / WAGONY POZA KRAWĘDZIĄ)
            '\x3Cdiv style="background:rgba(220, 38, 38, 0.12); border:1.5px solid #ef4444; border-radius:12px; padding:12px; margin-bottom:12px;"\x3E' +
                '\x3Clabel style="display:flex; align-items:center; gap:8px; cursor:pointer;"\x3E' +
                    '\x3Cinput type="checkbox" id="chkP115Enabled" ' + (isCurP115 ? 'checked' : '') + ' onchange="document.getElementById(\'p115Box\').style.display=this.checked?\'block\':\'none\';" style="width:22px; height:22px; accent-color:#ef4444; cursor:pointer;"\x3E' +
                    '\x3Cdiv\x3E' +
                        '\x3Cdiv style="font-size:0.92rem; font-weight:900; color:#f87171; display:flex; align-items:center; gap:5px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem;"\x3Ewarning\x3C/span\x3E PROCEDURA P115 (Skład poza peronem)' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="font-size:0.75rem; color:var(--text-muted);"\x3EStacja o zbyt krótkiej krawędzi peronowej dla pociągu\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/label\x3E' +
                '\x3Cdiv id="p115Box" style="display:' + (isCurP115 ? 'block' : 'none') + '; margin-top:10px; padding-top:8px; border-top:1px dashed rgba(239, 68, 68, 0.4);"\x3E' +
                    '\x3Clabel style="display:block; font-size:0.78rem; font-weight:800; color:#fca5a5; margin-bottom:4px;"\x3ENumery wagonów poza krawędzią peronu:\x3C/label\x3E' +
                    '\x3Cinput type="text" id="p115CoachesInput" value="' + escapeHTML(p115CoachesVal) + '" placeholder="np. wag. 1, 2 lub 11, 12, 13" style="width:100%; padding:9px 12px; font-weight:800; font-size:0.92rem; border-radius:8px; border:1px solid #ef4444; background:var(--input-bg); color:var(--text);"\x3E' +
                    '\x3Cdiv style="font-size:0.72rem; color:#fca5a5; margin-top:5px; line-height:1.35;"\x3E' +
                        '🚨 \x3Cstrong\x3EAutomatyczny alarm P115:\x3C/strong\x3E Przy zbliżaniu się do tej stacji ekran mruga na czerwono z napisem P115 i numerami wagonów oraz włącza się stroboskop latarki.' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +

            '\x3Cdiv style="font-size:0.8rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;"\x3EInne znaczniki drużyny:\x3C/div\x3E' +
            '\x3Cdiv style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:12px;"\x3E' + presetsHtml + '\x3C/div\x3E' +
            '\x3Cdiv style="margin-bottom:14px;"\x3E' +
                '\x3Clabel style="display:block; font-size:0.8rem; font-weight:800; color:var(--text); margin-bottom:4px;"\x3ETreść notatki / tagu:\x3C/label\x3E' +
                '\x3Cinput type="text" id="stationTagCustomInput" value="' + escapeHTML(curTag.replace(/⚠️\s*P115[^|]*(\|)?/i, '').trim()) + '" placeholder="np. ♿ PRM, pasażer na wózku..." style="width:100%; padding:9px 12px; font-weight:800; font-size:0.95rem; border-radius:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                '\x3Cbutton type="button" data-stidx="' + idx + '" onclick="const p115On=document.getElementById(\'chkP115Enabled\').checked; const p115Txt=document.getElementById(\'p115CoachesInput\').value.trim(); const customTxt=document.getElementById(\'stationTagCustomInput\').value.trim(); let finalTag=\'\'; if (p115On) { finalTag = \'⚠️ P115: \' + (p115Txt || \'skład poza peronem\'); if (customTxt) finalTag += \' | \' + customTxt; } else { finalTag = customTxt; } window.setStationTag(this.dataset.stidx, finalTag || null); window.closeCzuwakSheet();" class="menu-btn menu-btn-primary" style="flex:2; min-height:48px; font-weight:900; justify-content:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Echeck\x3C/span\x3E Zapisz znacznik' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" data-stidx="' + idx + '" onclick="window.setStationTag(this.dataset.stidx, null); window.closeCzuwakSheet();" class="menu-btn menu-btn-secondary" style="flex:1; min-height:48px; color:#f87171; justify-content:center;"\x3E' +
                    'Usuń' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
};

window.openEditStationTimeModal = (idxStr) => {
    window.closeCzuwakSheet();
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    if (!window._currentTrainObject) return;

    const stacjeArray = Array.isArray(window._currentTrainObject.stacje)
        ? window._currentTrainObject.stacje
        : Object.values(window._currentTrainObject.stacje || {});
    const stObj = stacjeArray[idx] || {};
    const stName = (typeof stObj === 'object' && stObj.nazwa) ? stObj.nazwa : ('Stacja ' + (idx + 1));
    const arrPlan = (typeof stObj === 'object' && stObj.przyjazd && stObj.przyjazd !== '-') ? stObj.przyjazd : '-';
    const depPlan = (typeof stObj === 'object' && stObj.odjazd && stObj.odjazd !== '-') ? stObj.odjazd : '-';

    const entry = (window._stationActualLog && window._stationActualLog[idx]) ? window._stationActualLog[idx] : {};
    const curArr = entry.actualArr || '';
    const curDep = entry.actualDep || '';

    const overlay = document.createElement('div');
    overlay.id = 'czuwakSheetOverlay';
    overlay.className = 'czuwak-sheet-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closeCzuwakSheet(); };

    // Szybkie opóźnienia do planu (np. +2m, +5m, +10m)
    let delayPresetButtonsHtml = '';
    const basePlanTime = (arrPlan !== '-' ? arrPlan : depPlan);
    if (basePlanTime && basePlanTime !== '-') {
        [1, 2, 5, 10, 15].forEach(extraM => {
            const calculatedTime = addMinutesToHHMM(basePlanTime, extraM) || '';
            const fullTimeWithSec = calculatedTime ? (calculatedTime + ':00') : '';
            delayPresetButtonsHtml +=
                '\x3Cbutton type="button" class="preset-km-btn" style="min-height:36px; padding:4px 8px; font-weight:800;" data-calc="' + fullTimeWithSec + '" onclick="document.getElementById(\'editActualArrInput\').value = this.dataset.calc; if(document.getElementById(\'editActualDepInput\')) document.getElementById(\'editActualDepInput\').value = this.dataset.calc;"\x3E' +
                    '+' + extraM + 'm (' + calculatedTime + ')' +
                '\x3C/button\x3E';
        });
    }

    const planFullArr = (arrPlan !== '-' ? (arrPlan.length === 5 ? (arrPlan + ':00') : arrPlan) : '');
    const planFullDep = (depPlan !== '-' ? (depPlan.length === 5 ? (depPlan + ':00') : depPlan) : '');

    overlay.innerHTML =
        '\x3Cdiv class="czuwak-sheet-content"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"\x3E' +
                '\x3Cdiv style="font-size:1.05rem; font-weight:900; color:var(--text); display:flex; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="color:var(--primary);"\x3Eedit_calendar\x3C/span\x3E ' + escapeHTML(stName) +
                '\x3C/div\x3E' +
                '\x3Cbutton type="button" onclick="window.closeCzuwakSheet()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Eclose\x3C/span\x3E' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="padding:10px 12px; background:var(--input-bg); border-radius:10px; border:1px solid var(--glass-border); margin-bottom:12px; font-size:0.84rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;"\x3E' +
                '\x3Cspan\x3EPlan. przyjazd: \x3Cstrong style="color:var(--text); font-size:0.95rem;"\x3E' + escapeHTML(arrPlan) + '\x3C/strong\x3E\x3C/span\x3E' +
                '\x3Cspan\x3EPlan. odjazd: \x3Cstrong style="color:var(--text); font-size:0.95rem;"\x3E' + escapeHTML(depPlan) + '\x3C/strong\x3E\x3C/span\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="font-size:0.78rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;"\x3ESzybkie uzupełnienie jednym kliknięciem:\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;"\x3E' +
                '\x3Cbutton type="button" data-planarr="' + escapeHTML(planFullArr) + '" data-plandep="' + escapeHTML(planFullDep) + '" onclick="if(this.dataset.planarr) document.getElementById(\'editActualArrInput\').value = this.dataset.planarr; if(this.dataset.plandep) document.getElementById(\'editActualDepInput\').value = this.dataset.plandep;" class="hud-btn" style="flex:1; min-height:42px; font-weight:800; color:#4ade80;"\x3E' +
                    '✓ Wg planu' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="document.getElementById(\'editActualArrInput\').value = window.formatNowHHMMSS()" class="hud-btn" style="flex:1; min-height:42px; font-weight:800;"\x3E' +
                    '⏱️ Postój TERAZ' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="document.getElementById(\'editActualDepInput\').value = window.formatNowHHMMSS()" class="hud-btn" style="flex:1; min-height:42px; font-weight:800;"\x3E' +
                    '🟢 Odjazd TERAZ' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
            (delayPresetButtonsHtml ? ('\x3Cdiv style="display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:2px;"\x3E' + delayPresetButtonsHtml + '\x3C/div\x3E') : '') +
            '\x3Cdiv style="margin-bottom:12px;"\x3E' +
                '\x3Clabel style="display:block; font-size:0.82rem; font-weight:800; color:var(--text); margin-bottom:4px;"\x3ERzeczywisty przyjazd / postój (HH:MM:SS):\x3C/label\x3E' +
                '\x3Cdiv style="display:flex; gap:6px;"\x3E' +
                    '\x3Cinput type="text" id="editActualArrInput" value="' + escapeHTML(curArr) + '" placeholder="np. 14:25:00" style="flex:1; padding:10px 12px; font-weight:800; font-size:1.05rem; border-radius:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"\x3E' +
                    '\x3Cbutton type="button" onclick="document.getElementById(\'editActualArrInput\').value = window.formatNowHHMMSS()" class="hud-btn" style="min-height:44px; padding:6px 12px; font-weight:800;"\x3ETeraz\x3C/button\x3E' +
                    '\x3Cbutton type="button" onclick="document.getElementById(\'editActualArrInput\').value = \'\'" class="hud-btn" style="min-height:44px; padding:6px 10px; color:#f87171;"\x3EUsuń\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="margin-bottom:14px;"\x3E' +
                '\x3Clabel style="display:block; font-size:0.82rem; font-weight:800; color:var(--text); margin-bottom:4px;"\x3ERzeczywisty odjazd (HH:MM:SS):\x3C/label\x3E' +
                '\x3Cdiv style="display:flex; gap:6px;"\x3E' +
                    '\x3Cinput type="text" id="editActualDepInput" value="' + escapeHTML(curDep) + '" placeholder="np. 14:27:00" style="flex:1; padding:10px 12px; font-weight:800; font-size:1.05rem; border-radius:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"\x3E' +
                    '\x3Cbutton type="button" onclick="document.getElementById(\'editActualDepInput\').value = window.formatNowHHMMSS()" class="hud-btn" style="min-height:44px; padding:6px 12px; font-weight:800;"\x3ETeraz\x3C/button\x3E' +
                    '\x3Cbutton type="button" onclick="document.getElementById(\'editActualDepInput\').value = \'\'" class="hud-btn" style="min-height:44px; padding:6px 10px; color:#f87171;"\x3EUsuń\x3C/button\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Clabel style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--input-bg); border-radius:8px; border:1px solid var(--glass-border); margin-bottom:14px; cursor:pointer;"\x3E' +
                '\x3Cinput type="checkbox" id="editAutoCalcDelayChk" checked style="width:20px; height:20px; accent-color:var(--primary); cursor:pointer;"\x3E' +
                '\x3Cspan style="font-size:0.82rem; font-weight:700; color:var(--text);"\x3EPrzelicz automatycznie opóźnienie pociągu na podstawie tego czasu\x3C/span\x3E' +
            '\x3C/label\x3E' +
            '\x3Cdiv style="display:flex; gap:8px;"\x3E' +
                '\x3Cbutton type="button" data-stidx="' + idx + '" onclick="window.saveEditedStationTime(this.dataset.stidx)" class="menu-btn menu-btn-primary" style="flex:2; min-height:48px; font-weight:900; justify-content:center; gap:6px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Esave\x3C/span\x3E Zapisz czas' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" data-stidx="' + idx + '" onclick="window.deleteStationStopActual(this.dataset.stidx)" class="menu-btn menu-btn-danger" style="flex:1; min-height:48px; font-weight:800; justify-content:center;"\x3E' +
                    'Skasuj' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    document.body.appendChild(overlay);
};

window.saveEditedStationTime = (idxStr) => {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    const arrIn = document.getElementById('editActualArrInput');
    const depIn = document.getElementById('editActualDepInput');
    const autoCalcChk = document.getElementById('editAutoCalcDelayChk');

    const arrVal = arrIn ? arrIn.value.trim() : '';
    const depVal = depIn ? depIn.value.trim() : '';
    const shouldAutoCalc = autoCalcChk ? autoCalcChk.checked : true;

    if (!window._stationActualLog) window._stationActualLog = {};
    if (!arrVal && !depVal) {
        delete window._stationActualLog[idx];
        if (window._passedStationIndices) window._passedStationIndices.delete(idx);
    } else {
        window._stationActualLog[idx] = {
            checked: true,
            actualArr: arrVal || null,
            actualDep: depVal || null
        };
        if (!window._passedStationIndices) window._passedStationIndices = new Set();
        window._passedStationIndices.add(idx);
    }

    saveStationActualLog();
    window.renderStationRowActualUI(idx);
    window.closeCzuwakSheet();
    window.czuwakLog('INFO', 'STATION', 'Zapisano ręcznie czas stacji idx=' + idx + ': Przyj=' + (arrVal || '-') + ', Odj=' + (depVal || '-'));

    if (shouldAutoCalc && (arrVal || depVal)) {
        window.autoCalculateDelayFromActualTime(idx);
    }
    if (window.activeTrackingMode === 'gps') {
        window.locateTrainByGPS(true);
    }
};

window.deleteStationStopActual = (idxStr) => {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    if (window._stationActualLog && window._stationActualLog[idx]) {
        delete window._stationActualLog[idx];
        if (window._passedStationIndices) window._passedStationIndices.delete(idx);
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        window.czuwakLog('INFO', 'STATION', 'Skasowano rzeczywisty czas stacji idx=' + idx);
    }
    window.closeCzuwakSheet();
    if (window.activeTrackingMode === 'gps') {
        window.locateTrainByGPS(true);
    }
};

window.renderStationRowActualUI = (idx) => {
    const entry = (window._stationActualLog && window._stationActualLog[idx]) ? window._stationActualLog[idx] : null;
    const isChecked = !!(entry && entry.checked);

    const checkBtn = document.getElementById('stationCheckBtn_' + idx);
    if (checkBtn) {
        checkBtn.classList.toggle('checked', isChecked);
        checkBtn.innerHTML = getCheckmarkSvgHtml(isChecked);
    }

    const stopTagEl = document.getElementById('stationStopTag_' + idx);
    if (stopTagEl) {
        stopTagEl.style.display = isChecked ? 'inline-flex' : 'none';
    }

    const arrBox = document.getElementById('actualArrBox_' + idx);
    if (arrBox) {
        if (entry && entry.actualArr) {
            arrBox.innerHTML = '\x3Cdiv class="actual-time-badge arr editable" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować rzeczywisty czas zatrzymania"\x3E' +
                'Postój: \x3Cstrong\x3E' + escapeHTML(entry.actualArr) + '\x3C/strong\x3E ' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:0.72rem; opacity:0.8;"\x3Eedit\x3C/span\x3E' +
            '\x3C/div\x3E';
        } else {
            arrBox.innerHTML = '';
        }
    }

    const depBox = document.getElementById('actualDepBox_' + idx);
    if (depBox) {
        if (entry && entry.actualDep) {
            depBox.innerHTML = '\x3Cdiv class="actual-time-badge dep editable" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować rzeczywisty czas odjazdu"\x3E' +
                'Odj.: \x3Cstrong\x3E' + escapeHTML(entry.actualDep) + '\x3C/strong\x3E ' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:0.72rem; opacity:0.8;"\x3Eedit\x3C/span\x3E' +
            '\x3C/div\x3E';
        } else {
            depBox.innerHTML = '';
        }
    }
};

window.recordStationArrivalStop = (idx, customTimeStr = null) => {
    if (idx === null || idx === undefined || idx < 0) return;
    if (!window._stationActualLog) window._stationActualLog = {};
    if (!window._stationActualLog[idx]) {
        window._stationActualLog[idx] = { checked: false, actualArr: null, actualDep: null };
    }
    const entry = window._stationActualLog[idx];
    let changed = false;
    if (!entry.checked) {
        entry.checked = true;
        changed = true;
    }
    if (!entry.actualArr) {
        entry.actualArr = customTimeStr || formatNowHHMMSS();
        changed = true;
    }
    if (!window._passedStationIndices) window._passedStationIndices = new Set();
    window._passedStationIndices.add(idx);

    if (changed) {
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        window.autoCalculateDelayFromActualTime(idx);
        if (typeof window.archiveCurrentTrainToHistory === 'function') {
            window.archiveCurrentTrainToHistory('W trasie');
        }
        if (window._lastNextStationHudData) {
            window.updateNextStationHud(window._lastNextStationHudData);
        }
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('INFO', 'STATION', 'Odnotowano postój stacji idx=' + idx + ': ' + entry.actualArr);
        }
    }
};

window.recordStationDeparture = (idx, customTimeStr = null) => {
    if (idx === null || idx === undefined || idx < 0) return;
    if (!window._stationActualLog) window._stationActualLog = {};
    if (!window._stationActualLog[idx]) {
        window._stationActualLog[idx] = { checked: false, actualArr: null, actualDep: null };
    }
    const entry = window._stationActualLog[idx];
    let changed = false;
    if (!entry.checked) {
        entry.checked = true;
        changed = true;
    }
    if (!entry.actualDep) {
        entry.actualDep = customTimeStr || formatNowHHMMSS();
        changed = true;
    }
    if (!window._passedStationIndices) window._passedStationIndices = new Set();
    window._passedStationIndices.add(idx);

    if (changed) {
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        window.autoCalculateDelayFromActualTime(idx);
        if (typeof window.archiveCurrentTrainToHistory === 'function') {
            window.archiveCurrentTrainToHistory('W trasie');
        }
        if (window._lastNextStationHudData) {
            window.updateNextStationHud(window._lastNextStationHudData);
        }
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('INFO', 'STATION', 'Odnotowano odjazd stacji idx=' + idx + ': ' + entry.actualDep);
        }
    }
};

window.toggleStationStopManual = (idxStr) => {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) return;
    if (!window._stationActualLog) window._stationActualLog = {};
    if (!window._passedStationIndices) window._passedStationIndices = new Set();
    const cur = window._stationActualLog[idx];

    const stObj = (window._currentTrainObject && window._currentTrainObject.stacje)
        ? (Array.isArray(window._currentTrainObject.stacje) ? window._currentTrainObject.stacje[idx] : Object.values(window._currentTrainObject.stacje)[idx])
        : null;
    const stName = (stObj && typeof stObj === 'object' && stObj.nazwa) ? stObj.nazwa : ('Stacja #' + (idx + 1));

    if ('vibrate' in navigator) {
        try { navigator.vibrate(80); } catch (e) {}
    }

    if (!cur || !cur.checked) {
        const arrTime = (cur && cur.actualArr) ? cur.actualArr : formatNowHHMMSS();
        window._stationActualLog[idx] = {
            checked: true,
            actualArr: arrTime,
            actualDep: (cur && cur.actualDep) ? cur.actualDep : null
        };
        window._passedStationIndices.add(idx);
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        window.autoCalculateDelayFromActualTime(idx);
        if (typeof window.showCzuwakWidgetActionToast === 'function') {
            window.showCzuwakWidgetActionToast('✓ Postój: ' + stName + ' (' + arrTime.slice(0, 5) + ')', 'schedule', '#22c55e');
        }
        if (typeof window.archiveCurrentTrainToHistory === 'function') {
            window.archiveCurrentTrainToHistory('W trasie');
        }
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('INFO', 'STATION', 'Ręcznie oznaczono postój stacji idx=' + idx + ': ' + arrTime);
        }
    } else if (!cur.actualDep) {
        cur.actualDep = formatNowHHMMSS();
        window._passedStationIndices.add(idx);
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        window.autoCalculateDelayFromActualTime(idx);
        if (typeof window.showCzuwakWidgetActionToast === 'function') {
            window.showCzuwakWidgetActionToast('✓ Odjazd: ' + stName + ' (' + cur.actualDep.slice(0, 5) + ')', 'departure_board', '#38bdf8');
        }
        if (typeof window.archiveCurrentTrainToHistory === 'function') {
            window.archiveCurrentTrainToHistory('W trasie');
        }
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('INFO', 'STATION', 'Ręcznie oznaczono odjazd stacji idx=' + idx + ': ' + cur.actualDep);
        }
    } else {
        delete window._stationActualLog[idx];
        window._passedStationIndices.delete(idx);
        saveStationActualLog();
        window.renderStationRowActualUI(idx);
        if (typeof window.showCzuwakWidgetActionToast === 'function') {
            window.showCzuwakWidgetActionToast('Skasowano status postoju: ' + stName, 'restart_alt', '#f59e0b');
        }
        if (typeof window.archiveCurrentTrainToHistory === 'function') {
            window.archiveCurrentTrainToHistory('W trasie');
        }
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('INFO', 'STATION', 'Ręcznie skasowano status stacji idx=' + idx);
        }
    }

    if (window._lastNextStationHudData) {
        window.updateNextStationHud(window._lastNextStationHudData);
    }

    if (window.activeTrackingMode === 'gps') {
        window.locateTrainByGPS(true);
    }
};

window._routeFilterMode = localStorage.getItem('CZUWAK_ROUTE_FILTER_MODE') || 'all';

window.setRouteFilterMode = (mode) => {
    window._routeFilterMode = (mode === 'duty') ? 'duty' : 'all';
    localStorage.setItem('CZUWAK_ROUTE_FILTER_MODE', window._routeFilterMode);
    if (window._currentTrainObject) {
        generujWidokTrasy(
            window._currentTrainObject,
            document.getElementById('detailsList'),
            document.getElementById('mainStatusBox'),
            window._currentTrainBestMatch
        );
    }
};


// ==========================================
// WYSZUKIWANIE POCIĄGU DO KONFIGURACJI (KROK 2 -> KROK 3)
// ==========================================
window._pendingTrain = null;
window._pendingTrainBestMatch = null;

window.findTrainForConfiguration = (autoConfirm = false) => {
    try {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    } catch (e) {}

    const trInput = document.getElementById('trainInput');
    const nameInput = document.getElementById('trainNameInput');
    const numVal = trInput ? trInput.value.trim() : '';
    const nameVal = nameInput ? nameInput.value.trim() : '';
    const listContainer = document.getElementById('detailsList');
    const mainBox = document.getElementById('mainStatusBox');
    const ormSec = document.getElementById('openRailwayMapSection');
    const dutyBox = document.getElementById('crewDutyConfigBox');
    const fabContainer = document.getElementById('trainFabContainer');

    if (currentTrainMode === 'number') {
        if (!numVal) {
            alert('Wpisz numer pociągu (np. 13100), a następnie kliknij \u201EZaładuj stacje pociągu\u201D.');
            if (trInput) trInput.focus();
            return;
        }
    } else {
        if (!nameVal) {
            alert('Wpisz nazwę pociągu (np. MALINOWSKI), a następnie kliknij \u201EZaładuj stacje pociągu\u201D.');
            if (nameInput) nameInput.focus();
            return;
        }
    }

    if (!bazaPociagow || bazaPociagow.length === 0) {
        if (listContainer) {
            listContainer.innerHTML = '\x3Cdiv style="text-align:center; padding:20px; color:var(--text-muted);"\x3EBaza pociągów nie została jeszcze wczytana. Odczekaj chwilę...\x3C/div\x3E';
            listContainer.style.display = 'block';
        }
        return;
    }

    let pociagi = [];
    if (currentTrainMode === 'number') {
        const nrPociagu = numVal.includes(' | ') ? numVal.split(' | ')[0].trim() : numVal;
        if (window.forceExactTrainMatch) {
            pociagi = bazaPociagow.filter(p => String(p.numer) === nrPociagu);
        } else {
            const lastChar = nrPociagu.slice(-1);
            let altNumer = nrPociagu;
            if (!isNaN(lastChar)) {
                const lastDigit = parseInt(lastChar, 10);
                const altDigit = lastDigit % 2 === 0 ? lastDigit + 1 : lastDigit - 1;
                altNumer = nrPociagu.slice(0, -1) + altDigit;
            }
            pociagi = bazaPociagow.filter(p => String(p.numer) === nrPociagu || String(p.numer) === altNumer);
        }

        if (pociagi.length === 0) {
            window.stopTrainTracking();
            window._currentTrainObject = null;
            window._pendingTrain = null;
            window.expandTrainConfigPanel();
            if (dutyBox) dutyBox.style.display = 'none';
            if (ormSec) ormSec.style.display = 'none';
            if (fabContainer) fabContainer.style.display = 'none';
            if (mainBox) mainBox.style.display = 'none';
            if (listContainer) {
                listContainer.innerHTML = '\x3Cp style="text-align:center; color:var(--text-muted); padding:20px;"\x3EBrak pociągu o numerze ' + escapeHTML(nrPociagu) + ' w bazie.\x3C/p\x3E';
                listContainer.style.display = 'block';
            }
            return;
        }
    } else {
        const nazwaPociagu = nameVal;
        pociagi = bazaPociagow.filter(p => p.nazwa && String(p.nazwa).toUpperCase() === nazwaPociagu.toUpperCase());
        if (pociagi.length === 0) {
            pociagi = bazaPociagow.filter(p => p.nazwa && String(p.nazwa).toUpperCase().includes(nazwaPociagu.toUpperCase()));
        }
        if (pociagi.length === 0) {
            window.stopTrainTracking();
            window._currentTrainObject = null;
            window._pendingTrain = null;
            window.expandTrainConfigPanel();
            if (dutyBox) dutyBox.style.display = 'none';
            if (ormSec) ormSec.style.display = 'none';
            if (fabContainer) fabContainer.style.display = 'none';
            if (mainBox) mainBox.style.display = 'none';
            if (listContainer) {
                listContainer.innerHTML = '\x3Cp style="text-align:center; color:var(--text-muted); padding:20px;"\x3EBrak pociągu o nazwie \x22' + escapeHTML(nazwaPociagu) + '\x22 w bazie.\x3C/p\x3E';
                listContainer.style.display = 'block';
            }
            return;
        }
    }

    const uniqueNumbers = [...new Set(pociagi.map(p => String(p.numer)))];
    const now = new Date();

    if (uniqueNumbers.length === 1) {
        const scoredTrains = pociagi.map(p => ({ pociag: p, ...scoreTrainVariantForSelectedDate(p, now) }));
        scoredTrains.sort((a, b) => a.score - b.score);
        const bestMatch = scoredTrains[0];
        window.setupCrewDutyStationsForTrain(bestMatch.pociag, bestMatch, autoConfirm);
    } else {
        window.stopTrainTracking();
        window._currentTrainObject = null;
        window._pendingTrain = null;
        window.expandTrainConfigPanel();
        if (dutyBox) dutyBox.style.display = 'none';
        if (ormSec) ormSec.style.display = 'none';
        if (fabContainer) fabContainer.style.display = 'none';
        if (mainBox) {
            mainBox.style.display = 'block';
            mainBox.className = 'bg-secondary';
            mainBox.innerText = 'WYBIERZ KIERUNEK (' + uniqueNumbers.length + ')';
        }

        let wariantyHtml = '\x3Ch3 style="color:var(--primary); margin:10px 0; font-size:1rem; text-align:center;"\x3EWybierz relację (kierunek):\x3C/h3\x3E';
        uniqueNumbers.forEach(num => {
            let variants = pociagi.filter(p => String(p.numer) === num);
            let scored = variants.map(p => ({ pociag: p, ...scoreTrainVariantForSelectedDate(p, now) }));
            scored.sort((a, b) => a.score - b.score);
            const bestMatch = scored[0];
            const p = bestMatch.pociag;
            const stacjeArray = Array.isArray(p.stacje) ? p.stacje : Object.values(p.stacje || {});
            const firstSt = stacjeArray.length > 0 ? stacjeArray[0] : null;
            const lastSt = stacjeArray.length > 0 ? stacjeArray[stacjeArray.length - 1] : null;
            const pierwszaStacja = firstSt ? (typeof firstSt === 'string' ? firstSt : (firstSt.nazwa || '')) : 'Brak danych';
            const pierwszaOdjazd = firstSt && typeof firstSt === 'object' && firstSt.odjazd ? firstSt.odjazd : '-';
            const ostatniaStacja = lastSt ? (typeof lastSt === 'string' ? lastSt : (lastSt.nazwa || '')) : 'Brak danych';
            const ostatniaPrzyjazd = lastSt && typeof lastSt === 'object' && lastSt.przyjazd ? lastSt.przyjazd : '-';

            wariantyHtml +=
                '\x3Cdiv class="card glass-panel" style="border-left-color: var(--primary); cursor:pointer; padding: 15px; margin-bottom: 10px; transition: transform 0.2s;" data-numer="' + escapeHTML(p.numer) + '" onclick="window.selectTrainByNumber(this.dataset.numer)"\x3E' +
                    '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;"\x3E' +
                        '\x3Cdiv class="carrier-title" style="font-size:1.1rem; display:flex; align-items:center; gap:6px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined"\x3Edirections_railway\x3C/span\x3E ' + escapeHTML(p.nazwa || '') + ' (' + escapeHTML(p.numer) + ')' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                    '\x3Cdiv style="font-size: 0.9rem; color: var(--text); display:flex; flex-direction:column; gap:6px;"\x3E' +
                        '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="color: #28a745;"\x3Etrip_origin\x3C/span\x3E ' +
                            '\x3Cspan\x3E\x3Cstrong\x3EOd:\x3C/strong\x3E ' + escapeHTML(pierwszaStacja) + ' \x3Cstrong style="color:var(--text-muted); margin-left: 4px;"\x3E(Odj: ' + escapeHTML(pierwszaOdjazd) + ')\x3C/strong\x3E\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="color: #dc3545;"\x3Elocation_on\x3C/span\x3E ' +
                            '\x3Cspan\x3E\x3Cstrong\x3EDo:\x3C/strong\x3E ' + escapeHTML(ostatniaStacja) + ' \x3Cstrong style="color:var(--text-muted); margin-left: 4px;"\x3E(Przyj: ' + escapeHTML(ostatniaPrzyjazd) + ')\x3C/strong\x3E\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/div\x3E';
        });
        if (listContainer) {
            listContainer.innerHTML = wariantyHtml;
            listContainer.style.display = 'block';
        }
    }
};

window.setupCrewDutyStationsForTrain = (pociag, bestMatch, autoConfirm = false) => {
    if (!pociag) return;
    window._pendingTrain = pociag;
    window._pendingTrainBestMatch = bestMatch;

    const stacjeArray = Array.isArray(pociag.stacje) ? pociag.stacje : Object.values(pociag.stacje || {});
    const totalStations = stacjeArray.length;
    if (totalStations < 2) {
        alert('Ten pociąg nie posiada listy stacji.');
        return;
    }

    const cleanTrainNum = String(pociag.numer || '').trim();
    let savedStartIdx = 0;
    let savedEndIdx = Math.max(1, totalStations - 1);

    if (cleanTrainNum) {
        try {
            const rawSaved = localStorage.getItem('CZUWAK_DUTY_SEG_' + cleanTrainNum);
            if (rawSaved) {
                const parsed = JSON.parse(rawSaved);
                if (typeof parsed.startIdx === 'number' && typeof parsed.endIdx === 'number') {
                    savedStartIdx = Math.max(0, Math.min(totalStations - 2, parsed.startIdx));
                    savedEndIdx = Math.max(savedStartIdx + 1, Math.min(totalStations - 1, parsed.endIdx));
                }
            }
        } catch (e) {}
    }

    window._crewDutyStartIdx = savedStartIdx;
    window._crewDutyEndIdx = savedEndIdx;

    const stationNamesUpper = stacjeArray.map(stObj => {
        const raw = typeof stObj === 'string' ? stObj : (stObj && stObj.nazwa ? stObj.nazwa : '');
        return String(raw).toUpperCase().trim();
    });

    const dutyBox = document.getElementById('crewDutyConfigBox');
    const startSel = document.getElementById('dutyStartStationSelect');
    const endSel = document.getElementById('dutyEndStationSelect');
    if (dutyBox && startSel && endSel) {
        let startOptsHtml = '';
        let endOptsHtml = '';
        stacjeArray.forEach((stObj, idx) => {
            const stName = stationNamesUpper[idx] || ('Stacja ' + (idx + 1));
            const depStr = (typeof stObj === 'object' && stObj && stObj.odjazd && stObj.odjazd !== '-') ? (' (odj. ' + stObj.odjazd + ')') : '';
            const arrStr = (typeof stObj === 'object' && stObj && stObj.przyjazd && stObj.przyjazd !== '-') ? (' (przyj. ' + stObj.przyjazd + ')') : '';
            if (idx < totalStations - 1) {
                startOptsHtml += '\x3Coption value="' + idx + '"' + (idx === savedStartIdx ? ' selected' : '') + '\x3E' +
                    (idx + 1) + '. ' + escapeHTML(stName + depStr) + '\x3C/option\x3E';
            }
            if (idx > 0) {
                endOptsHtml += '\x3Coption value="' + idx + '"' + (idx === savedEndIdx ? ' selected' : '') + '\x3E' +
                    (idx + 1) + '. ' + escapeHTML(stName + arrStr) + '\x3C/option\x3E';
            }
        });
        startSel.innerHTML = startOptsHtml;
        endSel.innerHTML = endOptsHtml;
        dutyBox.style.display = 'block';
    }

    if (autoConfirm) {
        window.confirmAndStartCrewDuty();
        return;
    }

    window.expandTrainConfigPanel();
    const listContainer = document.getElementById('detailsList');
    const mainBox = document.getElementById('mainStatusBox');
    if (mainBox) mainBox.style.display = 'none';

    const firstStName = stationNamesUpper[0] || '';
    const lastStName = stationNamesUpper[totalStations - 1] || '';
    const trainTitle = (pociag.numer || '') + (pociag.nazwa ? (' ' + pociag.nazwa) : '');

    if (listContainer) {
        listContainer.innerHTML =
            '\x3Cdiv class="card glass-panel" style="border-left-color: var(--primary); padding: 16px; margin: 10px 0;"\x3E' +
                '\x3Cdiv style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--primary); font-weight: 800; font-size: 1.05rem;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined"\x3Edirections_railway\x3C/span\x3E ' + escapeHTML(trainTitle) +
                '\x3C/div\x3E' +
                '\x3Cdiv style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 12px;"\x3E' +
                    'Relacja: \x3Cstrong style="color: var(--text);"\x3E' + escapeHTML(firstStName) + ' \u2192 ' + escapeHTML(lastStName) + '\x3C/strong\x3E (' + totalStations + ' stacji)' +
                '\x3C/div\x3E' +
                '\x3Cdiv style="background: rgba(2, 132, 199, 0.1); border-left: 3px solid var(--primary); padding: 12px 14px; border-radius: 8px; font-size: 0.88rem; color: var(--text); line-height: 1.45;"\x3E' +
                    '\x3Cstrong style="color: var(--primary);"\x3EKrok 3 powyżej:\x3C/strong\x3E Wybierz stację objęcia oraz stację zdania służby (zmiany DK), a następnie kliknij zielony przycisk \x3Cstrong style="color: #4ade80;"\x3E\u201EZatwierdź konfigurację pociągu\u201D\x3C/strong\x3E, aby wyświetlić trasę i uruchomić Czuwaka.' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E';
        listContainer.style.display = 'block';
    }

    if (dutyBox) {
        dutyBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
};

window.confirmAndStartCrewDuty = () => {
    if (!window._pendingTrain) {
        const trIn = document.getElementById('trainInput');
        const nameIn = document.getElementById('trainNameInput');
        if ((trIn && trIn.value.trim()) || (nameIn && nameIn.value.trim())) {
            window.findTrainForConfiguration(true);
            return;
        }
        alert('Najpierw wpisz numer lub nazwę pociągu i kliknij \u201EZaładuj stacje pociągu\u201D.');
        return;
    }

    const startSel = document.getElementById('dutyStartStationSelect');
    const endSel = document.getElementById('dutyEndStationSelect');
    const sIdx = parseInt(startSel ? startSel.value : '0', 10) || 0;
    const eIdx = parseInt(endSel ? endSel.value : '0', 10) || 0;

    if (sIdx >= eIdx) {
        alert('Stacja zmiany / zdania DK musi znajdować się ZA stacją objęcia pociągu.');
        return;
    }

    window._crewDutyStartIdx = sIdx;
    window._crewDutyEndIdx = eIdx;
    window._crewDutyCompleted = false;

    const pociag = window._pendingTrain;
    window._currentTrainObject = pociag;
    window._currentTrainBestMatch = window._pendingTrainBestMatch;

    const cleanTrainNum = String(pociag.numer || '').trim();
    try {
        localStorage.setItem('CZUWAK_DUTY_SEG_' + cleanTrainNum, JSON.stringify({ startIdx: sIdx, endIdx: eIdx }));
        localStorage.setItem('CZUWAK_CONFIRMED_TRAIN_NUM', cleanTrainNum);
        localStorage.setItem('CZUWAK_LAST_TRAIN_NUM', cleanTrainNum);
        localStorage.setItem('CZUWAK_LAST_TRAIN_NAME', String(pociag.nazwa || '').trim());
    } catch (e) {}

    const listContainer = document.getElementById('detailsList');
    const mainBox = document.getElementById('mainStatusBox');
    generujWidokTrasy(pociag, listContainer, mainBox, window._currentTrainBestMatch);

    window.collapseTrainConfigPanel();
    window.locateTrainByGPS(true);
    window.downloadCurrentRouteMapOffline(false);

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ==========================================
// RENDEROWANIE WIDOKU TRASY POCIĄGU (STACJA | PRZYJAZD | ODJAZD)
// ==========================================
function wyswietlWidok() {
    const listContainer = document.getElementById('detailsList');
    const mainBox = document.getElementById('mainStatusBox');
    listContainer.innerHTML = '';

    if (currentMode !== 'train') return;

    if (window._currentTrainObject) {
        generujWidokTrasy(window._currentTrainObject, listContainer, mainBox, window._currentTrainBestMatch);
        return;
    }

    const confirmedNum = localStorage.getItem('CZUWAK_CONFIRMED_TRAIN_NUM');
    const trIn = document.getElementById('trainInput');
    const nameIn = document.getElementById('trainNameInput');
    if (confirmedNum && ((trIn && trIn.value.trim()) || (nameIn && nameIn.value.trim()))) {
        window.forceExactTrainMatch = true;
        window.findTrainForConfiguration(true);
        return;
    }

    window.renderSleepState();
}

window._crewDutyStartIdx = 0;
window._crewDutyEndIdx = 0;
window._crewDutyEndStationName = '';
window._crewDutyCompleted = false;
window._currentTrainObject = null;

window.onCrewDutySegmentChange = (autoCollapse = false) => {
    const startSel = document.getElementById('dutyStartStationSelect');
    const endSel = document.getElementById('dutyEndStationSelect');
    if (!startSel || !endSel) return;

    let sIdx = parseInt(startSel.value, 10) || 0;
    let eIdx = parseInt(endSel.value, 10) || 0;
    const maxIdx = endSel.options.length - 1;

    if (sIdx >= eIdx) {
        if (sIdx < maxIdx) {
            eIdx = sIdx + 1;
            endSel.value = String(eIdx);
        } else {
            sIdx = Math.max(0, eIdx - 1);
            startSel.value = String(sIdx);
        }
    }

    window._crewDutyStartIdx = sIdx;
    window._crewDutyEndIdx = eIdx;
    window._crewDutyCompleted = false;
    if (autoCollapse) {
        window._configPanelForceExpanded = false;
    }

    const trainNum = window._currentActiveTrainNumber || '';
    if (trainNum) {
        try {
            localStorage.setItem('CZUWAK_DUTY_SEG_' + trainNum, JSON.stringify({ startIdx: sIdx, endIdx: eIdx }));
        } catch (e) {}
    }

    if (window._currentTrainObject) {
        generujWidokTrasy(
            window._currentTrainObject,
            document.getElementById('detailsList'),
            document.getElementById('mainStatusBox'),
            window._currentTrainBestMatch
        );
    }
};

window.setCrewDutyEndStation = (endIdx) => {
    const endSel = document.getElementById('dutyEndStationSelect');
    const startSel = document.getElementById('dutyStartStationSelect');
    if (!endSel) return;
    const targetEnd = parseInt(endIdx, 10);
    if (isNaN(targetEnd)) return;
    if (startSel && parseInt(startSel.value, 10) >= targetEnd) {
        startSel.value = String(Math.max(0, targetEnd - 1));
    }
    endSel.value = String(targetEnd);
    window.onCrewDutySegmentChange(true);
};

// ==========================================
// KARTA HERO „NASTĘPNA STACJA”, MINI-WIDGET HUD I WIDGET EKRANU BLOKADY (MEDIASESSION)
// ==========================================
window._lastNextStationHudData = null;

window.ensureFloatingMiniHud = () => {
    let miniHud = document.getElementById('floatingMiniHud');
    if (!miniHud) {
        miniHud = document.createElement('div');
        miniHud.id = 'floatingMiniHud';
        miniHud.className = 'floating-mini-hud';
        miniHud.style.display = 'none';
        miniHud.innerHTML =
            '\x3Cdiv class="mini-hud-left"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="color:var(--primary); font-size:1.3rem;"\x3Etrain\x3C/span\x3E' +
                '\x3Cdiv style="min-width:0; flex:1;"\x3E' +
                    '\x3Cdiv id="floatingMiniHudName" class="mini-hud-name"\x3ENastępna stacja\x3C/div\x3E' +
                    '\x3Cdiv id="floatingMiniHudDist" class="mini-hud-dist"\x3E-- km\x3C/div\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv style="display:flex; align-items:center; gap:6px; flex-shrink:0;"\x3E' +
                '\x3Cbutton id="floatingMiniHudStopBtn" type="button" onclick="event.stopPropagation(); window.markCurrentHudStationStop();" style="background:#22c55e; color:#ffffff; border:none; border-radius:999px; padding:6px 12px; font-size:0.75rem; font-weight:900; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Echeck_circle\x3C/span\x3E Postój' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" onclick="event.stopPropagation(); window.centerOnActiveTrainPosition();" style="background:var(--primary); color:#ffffff; border:none; border-radius:999px; padding:6px 12px; font-size:0.75rem; font-weight:900; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Emy_location\x3C/span\x3E Wyśrodkuj' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E';
        miniHud.onclick = () => {
            window.centerOnActiveTrainPosition();
        };
        document.body.appendChild(miniHud);
    }
};

window.addEventListener('scroll', () => {
    const miniHud = document.getElementById('floatingMiniHud');
    if (!miniHud) return;
    if (window._currentTrainObject && !window._crewDutyCompleted && window.scrollY > 280) {
        miniHud.style.display = 'flex';
    } else {
        miniHud.style.display = 'none';
    }
}, { passive: true });

window.markCurrentHudStationStop = () => {
    if (window._lastNextStationHudData && typeof window._lastNextStationHudData.index === 'number') {
        window.toggleStationStopManual(window._lastNextStationHudData.index);
    } else if (typeof window._crewDutyStartIdx === 'number') {
        window.toggleStationStopManual(window._crewDutyStartIdx);
    }
};

window.updateNextStationHud = (hudData) => {
    if (!hudData) return;
    window._lastNextStationHudData = hudData;

    const heroEl = document.getElementById('nextStationHeroCard');
    const miniHud = document.getElementById('floatingMiniHud');

    const stName = hudData.name || '';
    const distKm = hudData.distKm;
    const distStr = (typeof distKm === 'number') ? ('~' + distKm.toFixed(1) + ' km') : (hudData.distStr || '--');
    const isStationStop = !!hudData.isStationStop;
    const isBlockedAdvance = !!hudData.isBlockedAdvance;
    const blockedStationIdx = hudData.blockedStationIdx;
    const blockedStationName = hudData.blockedStationName || stName;
    const etaStr = hudData.etaStr || '';
    const schedArr = hudData.schedArr || '';
    const delayedArr = hudData.delayedArr || '';
    const isHandover = !!hudData.isHandover;
    const tag = hudData.tag || null;

    const targetIdx = isBlockedAdvance
        ? blockedStationIdx
        : (typeof hudData.index === 'number' ? hudData.index : window._crewDutyStartIdx);

    const targetLog = (window._stationActualLog && typeof targetIdx === 'number') ? window._stationActualLog[targetIdx] : null;
    const isTargetStopped = !!(targetLog && targetLog.checked);
    const hasTargetDeparted = !!(targetLog && targetLog.actualDep);

    let stopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Echeck_circle\x3C/span\x3E Odhacz postój teraz';
    let miniStopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Echeck_circle\x3C/span\x3E Postój';
    let stopBtnBg = '#22c55e';
    let stopBtnColor = '#ffffff';

    if (hasTargetDeparted) {
        stopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Etask_alt\x3C/span\x3E Odjazd: ' + targetLog.actualDep.slice(0, 5) + ' (Zaliczony)';
        miniStopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Etask_alt\x3C/span\x3E ' + targetLog.actualDep.slice(0, 5);
        stopBtnBg = 'rgba(34, 197, 94, 0.2)';
        stopBtnColor = '#4ade80';
    } else if (isTargetStopped) {
        stopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Edeparture_board\x3C/span\x3E Odhacz odjazd (' + (targetLog.actualArr ? targetLog.actualArr.slice(0, 5) : 'postój') + ')';
        miniStopBtnText = '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Edeparture_board\x3C/span\x3E Odjazd';
        stopBtnBg = '#0284c7';
        stopBtnColor = '#ffffff';
    }

    const heroStopBtn = document.getElementById('heroHudStopBtn');
    if (heroStopBtn) {
        heroStopBtn.innerHTML = stopBtnText;
        heroStopBtn.style.background = stopBtnBg;
        heroStopBtn.style.color = stopBtnColor;
    }

    const miniStopBtn = document.getElementById('floatingMiniHudStopBtn');
    if (miniStopBtn) {
        miniStopBtn.innerHTML = miniStopBtnText;
        miniStopBtn.style.background = stopBtnBg;
        miniStopBtn.style.color = stopBtnColor;
    }

    if (heroEl) {
        heroEl.classList.toggle('is-handover', isHandover);
        const titleEl = document.getElementById('heroHudStationName');
        if (titleEl) titleEl.innerText = isBlockedAdvance ? blockedStationName : stName;

        const badgeEl = document.getElementById('heroHudTypeBadge');
        if (badgeEl) {
            if (isBlockedAdvance) {
                badgeEl.innerHTML = '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:#f59e0b;"\x3Elock\x3C/span\x3E \x3Cstrong style="color:#fbbf24;"\x3EWYMAGANE ODHACZENIE POSTOJU\x3C/strong\x3E';
            } else if (isHandover) {
                badgeEl.innerHTML = '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:#f59e0b;"\x3Elogout\x3C/span\x3E \x3Cstrong style="color:#fbbf24;"\x3ESTACJA ZMIANY DK (ZDANIE SKŁADU)\x3C/strong\x3E';
            } else if (isStationStop) {
                badgeEl.innerHTML = '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:#22c55e;"\x3Eschedule\x3C/span\x3E \x3Cstrong style="color:#4ade80;"\x3EPOSTÓJ NA STACJI\x3C/strong\x3E';
            } else {
                badgeEl.innerHTML = '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:var(--primary); animation:train-pulse 1.5s infinite;"\x3Eradar\x3C/span\x3E \x3Cspan style="color:var(--text-muted); font-weight:800;"\x3ENASTĘPNA STACJA\x3C/span\x3E';
            }
        }

        const distBadge = document.getElementById('heroHudDistanceBadge');
        if (distBadge) distBadge.innerText = distStr;

        const etaBadge = document.getElementById('heroHudEtaBadge');
        if (etaBadge) etaBadge.innerText = etaStr;

        const timeRow = document.getElementById('heroHudTimesRow');
        if (timeRow) {
            let timeHtml = '\x3Cspan\x3EPlan. przyjazd: \x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(schedArr || '-') + '\x3C/strong\x3E\x3C/span\x3E';
            if (window._trainDelayMinutes > 0 && delayedArr) {
                timeHtml += ' \u2192 \x3Cspan class="delay-forecast-badge"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.75rem;"\x3Eschedule\x3C/span\x3E ' + escapeHTML(delayedArr) + '\x3C/span\x3E';
            }
            timeRow.innerHTML = timeHtml;
        }

        const tagBox = document.getElementById('heroHudTagBox');
        if (tagBox) {
            if (tag) {
                tagBox.innerHTML = '\x3Cspan class="station-crew-tag custom"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.85rem;"\x3Ebookmark\x3C/span\x3E ' + escapeHTML(tag) + '\x3C/span\x3E';
                tagBox.style.display = 'inline-flex';
            } else {
                tagBox.innerHTML = '';
                tagBox.style.display = 'none';
            }
        }

        const blockedContainer = document.getElementById('heroHudBlockedContainer');
        if (blockedContainer) {
            if (isBlockedAdvance && blockedStationIdx !== undefined && blockedStationIdx !== null) {
                blockedContainer.innerHTML =
                    '\x3Cdiv class="hud-blocked-banner"\x3E' +
                        '\x3Cdiv class="hud-blocked-title"\x3E' +
                            '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem; color:#f59e0b;"\x3Ewarning\x3C/span\x3E ' +
                            'BLOKADA PRZESKOKU: Nie odhaczono postoju na stacji ' + escapeHTML(blockedStationName) + '!' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv style="font-size:0.75rem; color:var(--text); opacity:0.9; margin-bottom:4px;"\x3E' +
                            'Czuwak wstrzymuje automatyczne przejście do kolejnych stacji dopóki postój na tej stacji nie zostanie potwierdzony.' +
                        '\x3C/div\x3E' +
                        '\x3Cbutton type="button" class="hud-blocked-btn" data-stidx="' + blockedStationIdx + '" onclick="window.confirmAndUnblockStationStop(this.dataset.stidx)"\x3E' +
                            '\x3Cspan class="material-symbols-outlined" style="font-size:1.1rem;"\x3Echeck_circle\x3C/span\x3E ' +
                            'Odhacz i potwierdź postój (' + escapeHTML(blockedStationName) + ')' +
                        '\x3C/button\x3E' +
                    '\x3C/div\x3E';
                blockedContainer.style.display = 'block';
            } else {
                blockedContainer.innerHTML = '';
                blockedContainer.style.display = 'none';
            }
        }
    }

    if (miniHud) {
        const miniName = document.getElementById('floatingMiniHudName');
        const miniDist = document.getElementById('floatingMiniHudDist');
        if (miniName) {
            if (isBlockedAdvance) {
                miniName.innerText = '⚠️ Odhacz: ' + blockedStationName;
            } else {
                miniName.innerText = (isStationStop ? 'Postój: ' : '\u2794 ') + stName;
            }
        }
        if (miniDist) miniDist.innerText = distStr + (etaStr ? (' • ' + etaStr) : '');
    }

    // MediaSession Widget na ekranie blokady
    if ('mediaSession' in navigator && window._currentTrainObject) {
        try {
            const trNum = window._currentActiveTrainNumber || '';
            const trName = window._currentTrainObject.nazwa ? (' ' + window._currentTrainObject.nazwa) : '';
            const delayStr = window._trainDelayMinutes > 0 ? (' (+' + window._trainDelayMinutes + 'm)') : '';
            const nextPrefix = isStationStop ? 'Postój: ' : 'Następna: ';
            navigator.mediaSession.metadata = new MediaMetadata({
                title: trNum + trName + delayStr + ' \u2192 ' + stName,
                artist: distStr + (etaStr ? (' • ' + etaStr) : '') + (tag ? (' • ' + tag) : ''),
                album: 'Odcinek DK: ' + (window._crewDutyStartStationName || '') + ' \u2192 ' + (window._crewDutyEndStationName || '')
            });
        } catch (e) {}
    }

    // Natywny widget Androida (Ekran Główny AppWidget)
    window.syncNativeAppWidget(hudData);
};

window.syncNativeAppWidget = (hudData) => {
    if (!window.CzuwakNativeWidget) return;
    if (!window._currentTrainObject) return;
    try {
        const data = hudData || window._lastNextStationHudData || {};
        const trNum = window._currentActiveTrainNumber || '';
        const trName = window._currentTrainObject.nazwa ? (' ' + window._currentTrainObject.nazwa) : '';
        const trainInfo = (trNum + trName).trim() || 'Pociąg';

        const stacjeArray = Array.isArray(window._currentTrainObject.stacje)
            ? window._currentTrainObject.stacje
            : Object.values(window._currentTrainObject.stacje || {});
        const totalStations = stacjeArray.length;

        const nextStationIdx = (typeof data.index === 'number') ? data.index : -1;
        const cleanStationName = data.name || (nextStationIdx >= 0 && stacjeArray[nextStationIdx] ? (stacjeArray[nextStationIdx].nazwa || '') : '');
        const isStationStop = !!data.isStationStop;
        const nextPrefix = isStationStop ? 'Postój: ' : '\u2794 ';
        const nextStation = nextPrefix + (cleanStationName || 'W drodze...');

        // Oś szlaku: stacja odjazdu
        let originStation = 'Odjazd: trasa pociągu';
        if (nextStationIdx > 0 && stacjeArray[nextStationIdx - 1]) {
            const prevSt = stacjeArray[nextStationIdx - 1];
            const prevName = (typeof prevSt === 'object' && prevSt.nazwa) ? prevSt.nazwa : (typeof prevSt === 'string' ? prevSt : '');
            const prevDep = (prevSt && prevSt.odjazd && prevSt.odjazd !== '-') ? prevSt.odjazd : (prevSt ? prevSt.przyjazd : '');
            originStation = 'Odj: ' + prevName + (prevDep ? (' (' + prevDep + ')') : '');
        } else if (window._crewDutyStartStationName) {
            originStation = 'Początek DK: ' + window._crewDutyStartStationName;
        } else if (totalStations > 0 && stacjeArray[0]) {
            const firstSt = stacjeArray[0];
            const firstName = (typeof firstSt === 'object' && firstSt.nazwa) ? firstSt.nazwa : '';
            originStation = 'Start: ' + firstName;
        }

        const distKm = data.distKm;
        const distStr = (typeof distKm === 'number') ? ('~' + distKm.toFixed(1) + ' km') : (data.distStr || '-- km');
        const schedArr = data.schedArr || '';
        const delayedArr = data.delayedArr || '';
        const etaStr = data.etaStr || '';
        let timeStr = (schedArr ? ('Plan: ' + schedArr) : '');
        if (delayedArr && delayedArr !== schedArr) {
            timeStr += ' \u2192 ' + delayedArr;
        }
        if (etaStr && !isStationStop) {
            timeStr += (timeStr ? ' • ' : '') + etaStr;
        }

        const delayMinutes = window._trainDelayMinutes || 0;
        const delayStr = (delayMinutes > 0 ? ('+' + delayMinutes + ' min') : 'Planowo');
        const speedVal = (typeof window._smoothedSpeedKmH === 'number' && window._smoothedSpeedKmH >= 4) ? Math.round(window._smoothedSpeedKmH) : 0;
        const speedStr = speedVal > 0 ? (speedVal + ' km/h') : (isStationStop ? 'Postój' : '0 km/h');

        // Dynamiczny status szlaku
        let statusStr = '🔵 NA SZLAKU';
        if (isStationStop || (speedVal <= 4 && distKm !== null && distKm <= 0.35)) {
            statusStr = '🟢 POSTÓJ NA STACJI';
        } else if (distKm !== null && distKm <= 2.0) {
            statusStr = '🟠 ZBLIŻANIE DO STACJI';
        }

        // Znacznik drużyny (Crew Tag)
        const crewTag = (nextStationIdx >= 0) ? (window.getStationTag(nextStationIdx) || '') : '';

        // Czy to stacja zdania składu (Handover)
        const isHandover = !!data.isHandover || (
            typeof window._crewDutyEndStationName === 'string' &&
            window._crewDutyEndStationName &&
            cleanStationName &&
            cleanStationName.toUpperCase().trim() === window._crewDutyEndStationName
        );

        // Czy aktualnie stoi
        const isStanding = (statusStr.indexOf('POSTÓJ') !== -1);

        // Procent postępu służby DK
        let dutyProgressPercent = 0;
        if (typeof window._crewDutyStartIdx === 'number' && typeof window._crewDutyEndIdx === 'number' && window._crewDutyEndIdx > window._crewDutyStartIdx) {
            const span = window._crewDutyEndIdx - window._crewDutyStartIdx;
            const cur = (nextStationIdx >= 0 ? nextStationIdx : 0) - window._crewDutyStartIdx;
            dutyProgressPercent = Math.min(100, Math.max(0, Math.round((cur / span) * 100)));
        } else if (totalStations > 1 && nextStationIdx >= 0) {
            dutyProgressPercent = Math.min(100, Math.max(0, Math.round((nextStationIdx / (totalStations - 1)) * 100)));
        }

        const dutyStationsStr = (window._crewDutyStartStationName && window._crewDutyEndStationName)
            ? (window._crewDutyStartStationName + ' \u2192 ' + window._crewDutyEndStationName)
            : '';

        if (typeof window.CzuwakNativeWidget.updateWidgetFull === 'function') {
            const payload = {
                trainInfo: trainInfo,
                originStation: originStation,
                nextStation: nextStation,
                nextStationClean: cleanStationName,
                nextStationIdx: nextStationIdx,
                distStr: distStr,
                timeStr: timeStr,
                delayMinutes: delayMinutes,
                delayStr: delayStr,
                speedStr: speedStr,
                statusStr: statusStr,
                crewTag: crewTag,
                isHandover: isHandover,
                isStanding: isStanding,
                dutyProgressPercent: dutyProgressPercent,
                dutyStationsStr: dutyStationsStr
            };
            window.CzuwakNativeWidget.updateWidgetFull(JSON.stringify(payload));
        } else if (typeof window.CzuwakNativeWidget.updateWidget === 'function') {
            window.CzuwakNativeWidget.updateWidget(trainInfo, nextStation, distStr, timeStr, delayStr, speedStr, statusStr);
        }
    } catch (e) {
        console.warn('Błąd synchronizacji widgetu:', e);
    }
};

function generujWidokTrasy(pociag, listContainer, mainBox, bestMatch = null) {
    window._currentTrainObject = pociag;
    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'flex';

    const stacjeArray = Array.isArray(pociag.stacje) ? pociag.stacje : Object.values(pociag.stacje || {});
    const totalStations = stacjeArray.length;

    const cleanTrainNum = pociag && pociag.numer ? String(pociag.numer).trim() : '';
    const isNewTrainSelection = (window._currentActiveTrainNumber !== cleanTrainNum);

    if (isNewTrainSelection) {
        window._passedStationIndices = new Set();
        window._prevStationDistances = {};
        window._crewDutyCompleted = false;
        window._smoothedSpeedKmH = null;
        window._currentStandingStationIdx = null;
        if (window._stationApproachAlertsFired) window._stationApproachAlertsFired.clear();
        if (window._alarmAcknowledgedForKey) window._alarmAcknowledgedForKey.clear();
    }

    if (cleanTrainNum) {
        window._currentActiveTrainNumber = cleanTrainNum;
        const firstSt = totalStations > 0 ? stacjeArray[0] : null;
        const lastSt = totalStations > 0 ? stacjeArray[totalStations - 1] : null;
        const pierwszaStacja = firstSt ? (typeof firstSt === 'string' ? firstSt : (firstSt.nazwa || '')) : '';
        const ostatniaStacja = lastSt ? (typeof lastSt === 'string' ? lastSt : (lastSt.nazwa || '')) : '';
        let relacjaStr = (pierwszaStacja && ostatniaStacja) ? (pierwszaStacja + ' \u2192 ' + ostatniaStacja) : '';
        window.addRecentTrain({
            numer: pociag.numer,
            nazwa: pociag.nazwa || '',
            relacja: relacjaStr
        });
    }

    // Wczytaj zapisane rzeczywiste czasy postojów i odjazdów (HH:MM:SS) dla tego pociągu i daty wyjazdu
    loadStationActualLog();

    // Konfiguracja odcinka obsługi DK (Stacja objęcia -> Stacja zmiany DK)
    let savedStartIdx = 0;
    let savedEndIdx = Math.max(0, totalStations - 1);
    if (cleanTrainNum) {
        try {
            const rawSaved = localStorage.getItem('CZUWAK_DUTY_SEG_' + cleanTrainNum);
            if (rawSaved) {
                const parsed = JSON.parse(rawSaved);
                if (typeof parsed.startIdx === 'number' && typeof parsed.endIdx === 'number') {
                    savedStartIdx = Math.max(0, Math.min(totalStations - 2, parsed.startIdx));
                    savedEndIdx = Math.max(savedStartIdx + 1, Math.min(totalStations - 1, parsed.endIdx));
                }
            }
        } catch (e) {}
    }
    window._crewDutyStartIdx = savedStartIdx;
    window._crewDutyEndIdx = savedEndIdx;

    const stationNamesUpper = stacjeArray.map(stObj => {
        const raw = typeof stObj === 'string' ? stObj : (stObj && stObj.nazwa ? stObj.nazwa : '');
        return String(raw).toUpperCase().trim();
    });
    window._crewDutyEndStationName = stationNamesUpper[window._crewDutyEndIdx] || '';
    const crewStartStationName = stationNamesUpper[window._crewDutyStartIdx] || '';

    // Wypełnij selektory odcinka obsługi DK w panelu "Skonfiguruj pociąg"
    const dutyBox = document.getElementById('crewDutyConfigBox');
    const startSel = document.getElementById('dutyStartStationSelect');
    const endSel = document.getElementById('dutyEndStationSelect');
    if (dutyBox && startSel && endSel && totalStations >= 2) {
        dutyBox.style.display = 'block';
        let startOptsHtml = '';
        let endOptsHtml = '';
        stacjeArray.forEach((stObj, idx) => {
            const stName = stationNamesUpper[idx] || ('Stacja ' + (idx + 1));
            const depStr = (typeof stObj === 'object' && stObj && stObj.odjazd && stObj.odjazd !== '-') ? (' (odj. ' + stObj.odjazd + ')') : '';
            const arrStr = (typeof stObj === 'object' && stObj && stObj.przyjazd && stObj.przyjazd !== '-') ? (' (przyj. ' + stObj.przyjazd + ')') : '';
            if (idx < totalStations - 1) {
                startOptsHtml += '\x3Coption value="' + idx + '"' + (idx === window._crewDutyStartIdx ? ' selected' : '') + '\x3E' +
                    (idx + 1) + '. ' + escapeHTML(stName + depStr) + '\x3C/option\x3E';
            }
            if (idx > 0) {
                endOptsHtml += '\x3Coption value="' + idx + '"' + (idx === window._crewDutyEndIdx ? ' selected' : '') + '\x3E' +
                    (idx + 1) + '. ' + escapeHTML(stName + arrStr) + '\x3C/option\x3E';
            }
        });
        startSel.innerHTML = startOptsHtml;
        endSel.innerHTML = endOptsHtml;
    }

    const matchedDate = bestMatch && bestMatch.date ? escapeHTML(bestMatch.date) : 'Wybrana data';
    const currentDistStr = window.getAlertDistanceKm().toFixed(1) + ' km';

    // Aktualizacja paska zwiniętej konfiguracji i samoczynne zwinięcie po skonfigurowaniu
    const shortDateStr = formatPlDate(window.selectedTrainDepartureDate || '');
    const collapsedTitle = (pociag.numer || '') + (pociag.nazwa ? (' \u2022 ' + pociag.nazwa) : '') + (shortDateStr ? (' (' + shortDateStr + ')') : '');
    const collapsedSub = 'DK: ' + crewStartStationName + ' \u2192 ' + window._crewDutyEndStationName;
    window.syncCollapsedConfigBar(collapsedTitle, collapsedSub);

    const activeEl = document.activeElement;
    const isTypingInSearch = activeEl && (activeEl.id === 'trainInput' || activeEl.id === 'trainNameInput');
    if (!window._configPanelForceExpanded && !isTypingInSearch) {
        window.collapseTrainConfigPanel();
    }

    let savedDelay = 0;
    if (cleanTrainNum) {
        try {
            const rawDelay = localStorage.getItem('CZUWAK_TRAIN_DELAY_' + cleanTrainNum);
            if (rawDelay) savedDelay = Math.max(0, parseInt(rawDelay, 10) || 0);
        } catch (e) {}
    }
    window._trainDelayMinutes = savedDelay;

    const delayBadgeHtml = '\x3Cdiv style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"\x3E' +
        '\x3Cspan style="font-size:0.78rem; color:var(--text-muted); font-weight:700;"\x3EOpóźnienie:\x3C/span\x3E' +
        '\x3Cbutton type="button" onclick="window.openDelaySheet()" style="padding:3px 9px; border-radius:6px; border:1px solid ' + (window._trainDelayMinutes > 0 ? '#f59e0b' : 'var(--glass-border)') + '; background:' + (window._trainDelayMinutes > 0 ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255, 255, 255, 0.06)') + '; color:' + (window._trainDelayMinutes > 0 ? '#fbbf24' : 'var(--text)') + '; font-weight:800; font-size:0.75rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Kliknij, aby ustawić bieżące opóźnienie pociągu"\x3E' +
            '\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Eschedule\x3C/span\x3E ' +
            (window._trainDelayMinutes > 0 ? ('+' + window._trainDelayMinutes + ' min') : 'Planowo (0 min)') +
            '\x3Cspan class="material-symbols-outlined" style="font-size:0.8rem; opacity:0.7;"\x3Etune\x3C/span\x3E' +
        '\x3C/button\x3E' +
        (window._trainDelayMinutes > 0
            ? ('\x3Cbutton type="button" onclick="window.setTrainDelay(0)" style="padding:3px 7px; border-radius:5px; border:1px solid rgba(239, 68, 68, 0.4); background:rgba(239, 68, 68, 0.12); color:#f87171; font-size:0.7rem; font-weight:700; cursor:pointer;" title="Skasuj opóźnienie (0 min)"\x3EKasuj\x3C/button\x3E')
            : '') +
    '\x3C/div\x3E';

    const dutyStatusHeaderHtml = window._crewDutyCompleted
        ? ('\x3Cdiv id="crewDutyStatusHeader" style="background: rgba(34, 197, 94, 0.16); border-bottom: 1.5px solid #22c55e; padding: 10px 15px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;"\x3E' +
               '\x3Cdiv style="display:flex; align-items:center; gap:8px; color:#4ade80; font-weight:800; font-size:0.88rem;"\x3E' +
                   '\x3Cspan class="material-symbols-outlined"\x3Etask_alt\x3C/span\x3E' +
                   '\x3Cspan\x3EZakończono obsługę DK na stacji \x3Cstrong style="color:#fff;"\x3E' + escapeHTML(window._crewDutyEndStationName) + '\x3C/strong\x3E – Czuwak wyłączony.\x3C/span\x3E' +
               '\x3C/div\x3E' +
               '\x3Cdiv style="display:flex; align-items:center; gap:6px;"\x3E' +
                   '\x3Cbutton type="button" onclick="window.resumeCrewDutyCzuwak()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--primary); background:var(--input-bg); color:var(--primary); font-weight:800; font-size:0.78rem; cursor:pointer;"\x3EWznów Czuwak\x3C/button\x3E' +
                   '\x3Cbutton type="button" onclick="window.closeActiveTrainAndSleep()" style="padding:6px 12px; border-radius:8px; border:1px solid rgba(239, 68, 68, 0.5); background:rgba(239, 68, 68, 0.15); color:#f87171; font-weight:800; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Zamknij obsługiwany pociąg i uśpij aplikację Czuwak"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem;"\x3Epower_settings_new\x3C/span\x3E Zamknij\x3C/button\x3E' +
               '\x3C/div\x3E' +
           '\x3C/div\x3E')
        : ('\x3Cdiv id="crewDutyStatusHeader" style="background: var(--toggle-bg); padding: 11px 15px; font-size: 0.88rem; border-bottom: 1px solid var(--table-border); display: flex; flex-direction: column; gap: 6px;"\x3E' +
               '\x3Cdiv style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;"\x3E' +
                   '\x3Cdiv style="display:flex; align-items: center; gap: 6px; color: var(--text);"\x3E' +
                       '\x3Cspan class="material-symbols-outlined icon-sm" style="color: var(--primary);"\x3Ecalendar_month\x3C/span\x3E ' +
                       '\x3Cspan\x3EWyjazd: \x3Cstrong style="color: var(--text);"\x3E' + matchedDate + '\x3C/strong\x3E\x3C/span\x3E' +
                   '\x3C/div\x3E' +
                   '\x3Cdiv style="display:flex; align-items:center; gap:8px;"\x3E' +
                       '\x3Cspan style="display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; background:rgba(34, 197, 94, 0.16); border:1px solid #22c55e; color:#4ade80; font-size:0.76rem; font-weight:800;"\x3E' +
                           '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; animation:train-pulse 1.5s infinite;"\x3Eradar\x3C/span\x3E ' +
                           'Czuwak aktywny (' + currentDistStr + ')' +
                       '\x3C/span\x3E' +
                       '\x3Cbutton type="button" onclick="window.closeActiveTrainAndSleep()" style="padding:4px 9px; border-radius:6px; border:1px solid rgba(239, 68, 68, 0.5); background:rgba(239, 68, 68, 0.15); color:#f87171; font-weight:800; font-size:0.75rem; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" title="Zamknij obsługiwany pociąg i uśpij aplikację Czuwak"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem;"\x3Epower_settings_new\x3C/span\x3E Zamknij\x3C/button\x3E' +
                   '\x3C/div\x3E' +
               '\x3C/div\x3E' +
               '\x3Cdiv style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; font-size:0.8rem; color:var(--text-muted); padding-top:4px; border-top:1px dashed var(--glass-border);"\x3E' +
                   '\x3Cspan\x3EOdcinek DK: \x3Cstrong style="color:#22c55e;"\x3E' + escapeHTML(crewStartStationName) + '\x3C/strong\x3E \u2192 \x3Cstrong style="color:#f59e0b;"\x3E' + escapeHTML(window._crewDutyEndStationName) + '\x3C/strong\x3E (auto-wyłączenie)\x3C/span\x3E' +
                   delayBadgeHtml +
               '\x3C/div\x3E' +
           '\x3C/div\x3E');

    const dutyCount = Math.max(1, (window._crewDutyEndIdx - window._crewDutyStartIdx + 1));
    const isDutyActive = (window._routeFilterMode === 'duty');
    const dutyFilterToggleHtml = '\x3Cdiv class="duty-filter-toggle"\x3E' +
        '\x3Cbutton type="button" class="duty-filter-btn' + (!isDutyActive ? ' active' : '') + '" onclick="window.setRouteFilterMode(\'all\')"\x3ECała trasa (' + totalStations + ')\x3C/button\x3E' +
        '\x3Cbutton type="button" class="duty-filter-btn' + (isDutyActive ? ' active' : '') + '" onclick="window.setRouteFilterMode(\'duty\')"\x3EMój odcinek DK (' + dutyCount + ')\x3C/button\x3E' +
    '\x3C/div\x3E';

    const heroHudCardHtml =
        '\x3Cdiv id="nextStationHeroCard" class="next-station-hud-card"\x3E' +
            '\x3Cdiv style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;"\x3E' +
                '\x3Cdiv id="heroHudTypeBadge" style="display:inline-flex; align-items:center; gap:5px; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:0.95rem; color:var(--primary); animation:train-pulse 1.5s infinite;"\x3Eradar\x3C/span\x3E ' +
                    '\x3Cspan style="color:var(--text-muted); font-weight:800;"\x3ENASTĘPNA STACJA\x3C/span\x3E' +
                '\x3C/div\x3E' +
                '\x3Cdiv id="heroHudTagBox" style="display:none;"\x3E\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv id="heroHudStationName" class="hud-station-title"\x3E' +
                escapeHTML(stationNamesUpper[window._crewDutyStartIdx] || 'Wczytywanie...') +
            '\x3C/div\x3E' +
            '\x3Cdiv id="heroHudBlockedContainer" style="display:none;"\x3E\x3C/div\x3E' +
            '\x3Cdiv class="hud-metrics-row"\x3E' +
                '\x3Cdiv id="heroHudDistanceBadge" class="hud-distance-badge"\x3E-- km\x3C/div\x3E' +
                '\x3Cdiv id="heroHudEtaBadge" class="hud-eta-badge"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.85rem;"\x3Eschedule\x3C/span\x3E ETA --:--\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv id="heroHudTimesRow" style="font-size:0.82rem; color:var(--text-muted); display:flex; align-items:center; gap:6px; flex-wrap:wrap;"\x3E' +
                '\x3Cspan\x3EPlan. przyjazd: \x3Cstrong style="color:var(--text);"\x3E-\x3C/strong\x3E\x3C/span\x3E' +
            '\x3C/div\x3E' +
            '\x3Cdiv class="hud-actions-row"\x3E' +
                '\x3Cbutton id="heroHudStopBtn" type="button" class="hud-btn primary" onclick="window.markCurrentHudStationStop()"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Echeck_circle\x3C/span\x3E Odhacz postój' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" class="hud-btn" onclick="window.centerOnActiveTrainPosition()"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Emy_location\x3C/span\x3E Wyśrodkuj' +
                '\x3C/button\x3E' +
                '\x3Cbutton type="button" class="hud-btn" onclick="window.openDelaySheet()"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:1rem;"\x3Eschedule\x3C/span\x3E Opóźnienie' +
                '\x3C/button\x3E' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E';

    let html = heroHudCardHtml +
        '\x3Cdiv class="card glass-panel" style="border-left-color: var(--primary); padding: 0;"\x3E' +
        '\x3Cdiv class="card-header" style="background: var(--primary); color: var(--primary-text); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;"\x3E' +
            '\x3Cdiv class="carrier-title" style="color: var(--primary-text); font-size: 1.2rem; display:flex; align-items:center; gap:6px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined"\x3Eroute\x3C/span\x3E Trasa pociągu' +
            '\x3C/div\x3E' +
            dutyFilterToggleHtml +
        '\x3C/div\x3E' +
        dutyStatusHeaderHtml +
        '\x3Ctable class="train-route-table"\x3E' +
        '\x3Cthead\x3E' +
            '\x3Ctr\x3E' +
                '\x3Cth style="text-align: left;"\x3EStacja\x3C/th\x3E' +
                '\x3Cth\x3EPrzyjazd\x3C/th\x3E' +
                '\x3Cth\x3EOdjazd\x3C/th\x3E' +
            '\x3C/tr\x3E' +
        '\x3C/thead\x3E' +
        '\x3Ctbody\x3E';

    const absTimes = computeTrainAbsSchedule(stacjeArray);
    window._currentTrainBestMatch = bestMatch;

    // Zbuduj listę stacji ze współrzędnymi GPS dla mapy OpenRailwayMap
    const stationsList = window._cachedStationList || [];
    const routeCoords = [];

    const relNow = (bestMatch && bestMatch.relNow !== null) ? (bestMatch.relNow - window._trainDelayMinutes) : null;
    let activeStationIndex = -1;
    let activeBetweenIndex = -1;

    if (relNow !== null) {
        for (let i = 0; i < absTimes.length; i++) {
            const { arr, dep } = absTimes[i];
            const effArr = (i === 0 && dep !== null) ? Math.max(0, dep - 10) : arr;
            if (effArr !== null && dep !== null && relNow >= effArr && relNow <= dep) {
                activeStationIndex = i;
                break;
            }
            if (i < absTimes.length - 1) {
                const nextArr = absTimes[i + 1].arr;
                if (dep !== null && nextArr !== null && relNow > dep && relNow < nextArr) {
                    activeBetweenIndex = i;
                    break;
                }
            }
        }
    }

    stacjeArray.forEach((stacjaObj, idx) => {
        const stacjaNazwa = stationNamesUpper[idx] || '';
        const arrStr = typeof stacjaObj === 'object' && stacjaObj !== null && stacjaObj.przyjazd ? String(stacjaObj.przyjazd) : '-';
        const depStr = typeof stacjaObj === 'object' && stacjaObj !== null && stacjaObj.odjazd ? String(stacjaObj.odjazd) : '-';

        const stCoords = getStationCoordsFast(stacjaNazwa);
        let coordAttrs = ' data-stname="' + escapeHTML(stacjaNazwa) + '"';
        if (stCoords) {
            routeCoords.push({
                index: idx,
                name: stacjaNazwa,
                lat: stCoords.lat,
                lng: stCoords.lng,
                arrStr: arrStr,
                depStr: depStr
            });
            coordAttrs += ' data-lat="' + stCoords.lat + '" data-lng="' + stCoords.lng + '"';
        }

        const isOutsideDuty = (idx < window._crewDutyStartIdx || idx > window._crewDutyEndIdx);
        let rowClass = (idx === activeStationIndex) ? 'active-station-row station-with-train' : '';
        if (isOutsideDuty) rowClass = (rowClass ? rowClass + ' ' : '') + 'outside-duty-row';

        const isHiddenByFilter = (window._routeFilterMode === 'duty' && isOutsideDuty);
        const rowStyleAttr = isHiddenByFilter ? ' style="display:none;"' : '';

        const stAbs = absTimes[idx] || { arr: null, dep: null, onlyBoarding: false, onlyAlighting: false };
        const absArrAttr = (stAbs.arr !== null) ? ' data-abs-arr="' + stAbs.arr + '"' : '';
        const absDepAttr = (stAbs.dep !== null) ? ' data-abs-dep="' + stAbs.dep + '"' : '';

        const actualEntry = (window._stationActualLog && window._stationActualLog[idx]) ? window._stationActualLog[idx] : null;
        const isStopChecked = !!(actualEntry && actualEntry.checked);

        const stationTag = window.getStationTag(idx);
        let tagBadgeHtml = '';
        if (stationTag) {
            let tagClass = 'custom';
            if (stationTag.indexOf('PRM') !== -1 || stationTag.indexOf('Wózek') !== -1) tagClass = 'prm';
            else if (stationTag.indexOf('Rower') !== -1) tagClass = 'bike';
            else if (stationTag.indexOf('peron') !== -1) tagClass = 'platform';
            else if (stationTag.indexOf('Grupa') !== -1) tagClass = 'group';

            tagBadgeHtml = '\x3Cbutton type="button" class="station-crew-tag ' + tagClass + '" data-stidx="' + idx + '" onclick="window.openStationTagModal(this.dataset.stidx)" title="Kliknij, aby edytować znacznik drużyny"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:0.8rem;"\x3Ebookmark\x3C/span\x3E ' + escapeHTML(stationTag) +
            '\x3C/button\x3E';
        } else {
            tagBadgeHtml = '\x3Cbutton type="button" class="station-crew-tag" style="background:transparent; border:1px dashed var(--glass-border); color:var(--text-muted); opacity:0.65;" data-stidx="' + idx + '" onclick="window.openStationTagModal(this.dataset.stidx)" title="Dodaj znacznik drużyny (PRM, Rower, Peron)"\x3E' +
                '\x3Cspan class="material-symbols-outlined" style="font-size:0.85rem;"\x3Ebookmark_add\x3C/span\x3E +Tag' +
            '\x3C/button\x3E';
        }

        let dutyRoleBadgeHtml = '';
        if (idx === window._crewDutyStartIdx) {
            dutyRoleBadgeHtml =
                '\x3Cdiv style="margin-top:4px; display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; background:rgba(34, 197, 94, 0.16); border:1px solid #22c55e; color:#4ade80; font-size:0.68rem; font-weight:800;"\x3E' +
                    '\x3Cspan class="material-symbols-outlined" style="font-size:0.85rem;"\x3Elogin\x3C/span\x3E OBJĘCIE SKŁADU (START DK)' +
                '\x3C/div\x3E';
        } else if (idx === window._crewDutyEndIdx) {
            dutyRoleBadgeHtml =
                '\x3Cdiv style="margin-top:5px; display:flex; flex-wrap:wrap; align-items:center; gap:6px;"\x3E' +
                    '\x3Cspan style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; background:rgba(245, 158, 11, 0.2); border:1px solid #f59e0b; color:#fbbf24; font-size:0.68rem; font-weight:800;"\x3E' +
                        '\x3Cspan class="material-symbols-outlined" style="font-size:0.85rem;"\x3Elogout\x3C/span\x3E STACJA ZMIANY DK (AUTO-WYŁĄCZENIE)' +
                    '\x3C/span\x3E' +
                    (!window._crewDutyCompleted
                        ? ('\x3Cbutton type="button" data-stname="' + escapeHTML(stacjaNazwa) + '" onclick="window.completeCrewDutyAndStopCzuwak(this.dataset.stname, \'Odhaczono ręcznie\')" style="padding:3px 8px; border-radius:6px; border:1px solid #22c55e; background:rgba(34, 197, 94, 0.2); color:#4ade80; font-size:0.68rem; font-weight:800; cursor:pointer;"\x3E✓ Odhacz i wyłącz Czuwak\x3C/button\x3E')
                        : '') +
                '\x3C/div\x3E';
        } else if (idx > window._crewDutyStartIdx) {
            dutyRoleBadgeHtml =
                '\x3Cdiv style="margin-top:3px;"\x3E' +
                    '\x3Cbutton type="button" data-stidx="' + idx + '" onclick="window.setCrewDutyEndStation(this.dataset.stidx)" style="padding:2px 7px; border-radius:5px; border:1px dashed var(--glass-border); background:transparent; color:var(--text-muted); font-size:0.65rem; font-weight:600; cursor:pointer;"\x3EUstaw zmianę DK tutaj\x3C/button\x3E' +
                '\x3C/div\x3E';
        }

        const actualArrHtml = (actualEntry && actualEntry.actualArr)
            ? ('\x3Cdiv class="actual-time-badge arr editable" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować rzeczywisty czas zatrzymania"\x3EPostój: \x3Cstrong\x3E' + escapeHTML(actualEntry.actualArr) + '\x3C/strong\x3E \x3Cspan class="material-symbols-outlined" style="font-size:0.72rem; opacity:0.8;"\x3Eedit\x3C/span\x3E\x3C/div\x3E')
            : '';
        const actualDepHtml = (actualEntry && actualEntry.actualDep)
            ? ('\x3Cdiv class="actual-time-badge dep editable" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować rzeczywisty czas odjazdu"\x3EOdj.: \x3Cstrong\x3E' + escapeHTML(actualEntry.actualDep) + '\x3C/strong\x3E \x3Cspan class="material-symbols-outlined" style="font-size:0.72rem; opacity:0.8;"\x3Eedit\x3C/span\x3E\x3C/div\x3E')
            : '';

        let arrInnerHtml = '\x3Cspan class="time-plan-text"\x3E' + escapeHTML(arrStr) + '\x3C/span\x3E';
        if (stAbs.onlyBoarding) {
            arrInnerHtml = '-\x3Cdiv style="font-size: 0.7rem; color: var(--primary); font-weight: 600; line-height: 1.15; margin-top: 2px;"\x3ETylko wsiadanie\x3C/div\x3E';
        } else if (window._trainDelayMinutes > 0) {
            const delayedArrStr = addMinutesToHHMM(arrStr, window._trainDelayMinutes);
            if (delayedArrStr) {
                arrInnerHtml += '\x3Cdiv class="delay-forecast-badge" title="Prognozowany przyjazd z uwzględnieniem +' + window._trainDelayMinutes + ' min opóźnienia"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.75rem;"\x3Eschedule\x3C/span\x3E ' + escapeHTML(delayedArrStr) + '\x3C/div\x3E';
            }
        }
        if (!actualArrHtml && arrStr !== '-') {
            arrInnerHtml += '\x3Cspan class="time-edit-hint"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.7rem;"\x3Eedit_calendar\x3C/span\x3E edytuj\x3C/span\x3E';
        }
        const arrCellHtml = '\x3Cdiv class="table-time-cell-btn" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować czas przyjazdu/odjazdu lub skorygować opóźnienie"\x3E' +
            arrInnerHtml +
            '\x3Cdiv id="actualArrBox_' + idx + '" style="width:100%;"\x3E' + actualArrHtml + '\x3C/div\x3E' +
        '\x3C/div\x3E';

        let depInnerHtml = '\x3Cspan class="time-plan-text"\x3E' + escapeHTML(depStr) + '\x3C/span\x3E';
        if (stAbs.onlyAlighting) {
            depInnerHtml = '-\x3Cdiv style="font-size: 0.7rem; color: var(--warning, #f59e0b); font-weight: 600; line-height: 1.15; margin-top: 2px;"\x3ETylko wysiadanie (~1m)\x3C/div\x3E';
        } else if (window._trainDelayMinutes > 0) {
            const delayedDepStr = addMinutesToHHMM(depStr, window._trainDelayMinutes);
            if (delayedDepStr) {
                depInnerHtml += '\x3Cdiv class="delay-forecast-badge" title="Prognozowany odjazd z uwzględnieniem +' + window._trainDelayMinutes + ' min opóźnienia"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.75rem;"\x3Eschedule\x3C/span\x3E ' + escapeHTML(delayedDepStr) + '\x3C/div\x3E';
            }
        }
        if (!actualDepHtml && depStr !== '-') {
            depInnerHtml += '\x3Cspan class="time-edit-hint"\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.7rem;"\x3Eedit_calendar\x3C/span\x3E edytuj\x3C/span\x3E';
        }
        const depCellHtml = '\x3Cdiv class="table-time-cell-btn" data-stidx="' + idx + '" onclick="window.openEditStationTimeModal(this.dataset.stidx)" title="Kliknij, aby edytować czas przyjazdu/odjazdu lub skorygować opóźnienie"\x3E' +
            depInnerHtml +
            '\x3Cdiv id="actualDepBox_' + idx + '" style="width:100%;"\x3E' + actualDepHtml + '\x3C/div\x3E' +
        '\x3C/div\x3E';

        html += '\x3Ctr class="' + rowClass + '" data-station-idx="' + idx + '"' + coordAttrs + absArrAttr + absDepAttr + rowStyleAttr + '\x3E' +
            '\x3Ctd class="station-name-td" data-label="Stacja"\x3E' +
                '\x3Cdiv class="station-cell-wrapper"\x3E' +
                    '\x3Cdiv class="station-name-row-line"\x3E' +
                        '\x3Cbutton type="button" id="stationCheckBtn_' + idx + '" class="station-stop-check-btn' + (isStopChecked ? ' checked' : '') + '" data-stidx="' + idx + '" onclick="window.toggleStationStopManual(this.dataset.stidx)" title="Odhaczony postój na stacji"\x3E' +
                            getCheckmarkSvgHtml(isStopChecked) +
                        '\x3C/button\x3E' +
                        '\x3Cspan class="station-clickable" style="text-decoration:none; cursor:default;"\x3E' + escapeHTML(stacjaNazwa) + '\x3C/span\x3E' +
                        '\x3Cspan id="stationStopTag_' + idx + '" class="station-stop-tag" style="display:' + (isStopChecked ? 'inline-flex' : 'none') + ';"\x3E✓ Postój\x3C/span\x3E' +
                        tagBadgeHtml +
                    '\x3C/div\x3E' +
                    dutyRoleBadgeHtml +
                '\x3C/div\x3E' +
            '\x3C/td\x3E' +
            '\x3Ctd data-label="Przyjazd:"\x3E' + arrCellHtml + '\x3C/td\x3E' +
            '\x3Ctd data-label="Odjazd:"\x3E' + depCellHtml + '\x3C/td\x3E' +
        '\x3C/tr\x3E';

        if (idx === activeStationIndex && !isHiddenByFilter) {
            const isOrigin = (idx === 0);
            let standingBadgeText = 'Planowy postój pociągu na stacji: ' + escapeHTML(stacjaNazwa);
            if (isOrigin && relNow !== null && stAbs.dep !== null) {
                const minsLeft = stAbs.dep - relNow;
                if (minsLeft > 0) {
                    standingBadgeText = 'Pociąg na stacji początkowej ' + escapeHTML(stacjaNazwa) + ' (planowy odjazd za ' + minsLeft + ' min)';
                } else {
                    standingBadgeText = 'Pociąg na stacji początkowej ' + escapeHTML(stacjaNazwa) + ' (planowy odjazd za chwilę)';
                }
            }
            html += '\x3Ctr class="station-standing-train-row active-station-row"\x3E' +
                '\x3Ctd colspan="3" style="padding: 0; border: none; background: transparent;"\x3E' +
                    '\x3Cdiv class="station-standing-box"\x3E' +
                        '\x3Cdiv class="station-standing-badge"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm"\x3Eschedule\x3C/span\x3E ' +
                            standingBadgeText +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="table-train-container standing-station-container"\x3E' +
                            (typeof window.getStandingTrainIndicatorHTML === 'function' ? window.getStandingTrainIndicatorHTML(5, stacjaNazwa) : '') +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/td\x3E' +
            '\x3C/tr\x3E';
        }

        if (idx === activeBetweenIndex && !isHiddenByFilter) {
            html += '\x3Ctr class="train-moving-row"\x3E' +
                '\x3Ctd colspan="3" style="padding: 0; border: none; background: transparent;"\x3E' +
                    '\x3Cdiv style="background: rgba(2, 132, 199, 0.1); display: flex; flex-direction: column; padding: 10px 0; overflow: hidden; position: relative; border-radius: 8px;"\x3E' +
                        '\x3Cdiv style="font-size: 0.9rem; font-weight: bold; color: var(--primary); margin-bottom: 5px; text-align: center; z-index: 20;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="vertical-align: middle;"\x3Edirections_railway\x3C/span\x3E Pociąg na szlaku' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="table-train-container"\x3E' +
                            (typeof window.getTrainIndicatorHTML === 'function' ? window.getTrainIndicatorHTML(5) : '') +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/td\x3E' +
            '\x3C/tr\x3E';
        }
    });

    let hiddenNoticeHtml = '';
    if (isDutyActive && (totalStations - dutyCount > 0)) {
        hiddenNoticeHtml = '\x3Cdiv style="padding:10px 14px; background:var(--input-bg); font-size:0.8rem; color:var(--text-muted); display:flex; align-items:center; justify-content:space-between; border-top:1px dashed var(--glass-border); flex-wrap:wrap; gap:8px;"\x3E' +
            '\x3Cspan\x3E\x3Cspan class="material-symbols-outlined" style="font-size:0.9rem; vertical-align:middle; color:var(--primary);"\x3Efilter_alt\x3C/span\x3E Ukryto ' + (totalStations - dutyCount) + ' stacji spoza odcinka służby DK.\x3C/span\x3E' +
            '\x3Cbutton type="button" onclick="window.setRouteFilterMode(\'all\')" style="background:transparent; border:1px solid var(--primary); color:var(--primary); border-radius:6px; padding:3px 8px; font-size:0.75rem; font-weight:700; cursor:pointer;"\x3EPokaż całą trasę\x3C/button\x3E' +
        '\x3C/div\x3E';
    }

    html += '\x3C/tbody\x3E\x3C/table\x3E' + hiddenNoticeHtml + '\x3C/div\x3E';

    window._currentRouteStationsWithGps = routeCoords;
    const ormSec = document.getElementById('openRailwayMapSection');
    if (ormSec) {
        ormSec.style.display = 'block';
        const wrapper = document.getElementById('openRailwayMapWrapper');
        if (wrapper && wrapper.style.display === 'block') {
            window.initOrUpdateOpenRailwayMap();
        }
        // AUTOMATYCZNE POBRANIE MAPY TRASY DO BAZY OFFLINE PO WYBRANIU POCIĄGU
        if (routeCoords.length > 0) {
            window.downloadCurrentRouteMapOffline(false);
        }
    }

    listContainer.innerHTML = html;
    window._cachedRouteRowElements = Array.from(listContainer.querySelectorAll('.train-route-table tr[data-station-idx]'));
    mainBox.style.display = 'block';
    mainBox.className = 'bg-train';
    mainBox.innerText = "POCIĄG - " + escapeHTML(pociag.nazwa || '') + " (" + escapeHTML(pociag.numer) + ")";
    listContainer.style.display = 'block';

    window.ensureFloatingMiniHud();

    // Inicjalna aktualizacja Hero HUD i widgetu blokady ekranu (MediaSession)
    const initTargetIdx = (typeof window._crewDutyStartIdx === 'number') ? window._crewDutyStartIdx : 0;
    const initStObj = stacjeArray[initTargetIdx] || {};
    const initSchedArr = (initStObj && initStObj.przyjazd && initStObj.przyjazd !== '-') ? initStObj.przyjazd : (initStObj ? initStObj.odjazd : '');
    const initDelayedArr = (window._trainDelayMinutes > 0 && initSchedArr) ? addMinutesToHHMM(initSchedArr, window._trainDelayMinutes) : initSchedArr;
    window.updateNextStationHud({
        index: initTargetIdx,
        name: stationNamesUpper[initTargetIdx] || '',
        distKm: null,
        distStr: '-- km',
        isStationStop: false,
        etaStr: initDelayedArr ? ('Plan. ' + initDelayedArr) : '--:--',
        schedArr: initSchedArr,
        delayedArr: initDelayedArr,
        isHandover: (initTargetIdx === window._crewDutyEndIdx),
        tag: window.getStationTag(initTargetIdx)
    });

    // AUTOMATYCZNE URUCHOMIENIE CZUWAKA GPS DLA WYBRANEGO POCIĄGU (DOPÓKI ODCINEK OBSŁUGI TRWA)
    if (!window._crewDutyCompleted) {
        window.locateTrainByGPS(true);
    } else {
        window.updateSpeedAndGpsIndicator(null, 'off');
    }
}

// ==========================================
// CZUWAK GPS – AUTOMATYCZNE ŚLEDZENIE, PRĘDKOŚCIOMIERZ, KALISZ FIX v2, TUNELE I AUTO-STOP PO ZMIANIE DK
// ==========================================
function getStationCoordsFast(stationNameUpper) {
    if (!stationNameUpper) return null;
    const list = window._cachedStationList || [];
    if (list.length === 0) return null;

    if (!window._stationCoordsIndexMap || window._stationCoordsIndexRef !== list || window._stationCoordsIndexSize !== list.length) {
        const map = new Map();
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (!s || !s.stacja) continue;
            let stLat = null;
            let stLng = null;
            if (s.lokalizacja_gps) {
                stLat = s.lokalizacja_gps.latitude !== undefined ? s.lokalizacja_gps.latitude : s.lokalizacja_gps._lat;
                stLng = s.lokalizacja_gps.longitude !== undefined ? s.lokalizacja_gps.longitude : s.lokalizacja_gps._long;
            } else if (s.lat !== undefined && s.lng !== undefined) {
                stLat = s.lat;
                stLng = s.lng;
            }
            if (typeof stLat === 'number' && typeof stLng === 'number' && !isNaN(stLat) && !isNaN(stLng)) {
                map.set(String(s.stacja).trim().toUpperCase(), { lat: stLat, lng: stLng });
            }
        }
        window._stationCoordsIndexMap = map;
        window._stationCoordsIndexRef = list;
        window._stationCoordsIndexSize = list.length;
    }

    return window._stationCoordsIndexMap.get(String(stationNameUpper).trim().toUpperCase()) || null;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

window._lastValidGpsTimestamp = 0;
window._lastActiveSegmentState = null;
window._smoothedSpeedKmH = null;
window._wasInTunnelEstimation = false;
window._processPositionDirect = null;

window.onNativeLocationUpdate = (lat, lng, speedMps, accuracyMeters, timestamp) => {
    if (typeof window._processPositionDirect === 'function') {
        window._processPositionDirect({
            coords: {
                latitude: lat,
                longitude: lng,
                speed: (typeof speedMps === 'number' && speedMps >= 0) ? speedMps : null,
                accuracy: (typeof accuracyMeters === 'number') ? accuracyMeters : 25,
                heading: null
            },
            timestamp: timestamp || Date.now()
        }, (accuracyMeters <= 500));
    } else if (window.activeTrackingMode === 'gps' && !window._crewDutyCompleted && document.querySelector('.train-route-table')) {
        window.locateTrainByGPS(true);
    }
};

window.locateTrainByGPS = async (silent = false) => {
    if (window._crewDutyCompleted) return;
    if (typeof window.syncPendingWidgetEvents === 'function') {
        window.syncPendingWidgetEvents();
    }

    const rows = Array.from(document.querySelectorAll('.train-route-table tr:not(.train-moving-row):not(.station-standing-train-row):not(thead tr)'));
    if (rows.length === 0) return !silent && alert("Najpierw wyszukaj trasę pociągu!");
    if (!navigator.geolocation) return !silent && alert("Twoje urządzenie nie wspiera GPS.");

    window.activeTrackingMode = 'gps';
    window.requestWakeLock();
    if (window.CzuwakNativeWidget && typeof window.CzuwakNativeWidget.startForegroundTracking === 'function') {
        try {
            const trNum = (window._currentTrainObject && window._currentTrainObject.numer) ? window._currentTrainObject.numer : '';
            window.CzuwakNativeWidget.startForegroundTracking(
                'Czuwak GPS aktywny' + (trNum ? (' • Pociąg ' + trNum) : ''),
                'Śledzenie pozycji pociągu na szlaku'
            );
        } catch (e) {}
    }
    window.updateSpeedAndGpsIndicator(window._smoothedSpeedKmH, 'searching');

    // Odblokowanie Web Audio podczas gestu użytkownika
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!window._akbAudioCtx) window._akbAudioCtx = new AudioCtx();
            if (window._akbAudioCtx.state === 'suspended') window._akbAudioCtx.resume();
        }
    } catch (e) {}

    // Prośba o uprawnienia do powiadomień (Web + Capacitor)
    if ('Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
    }
    try {
        const LocalNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
        if (LocalNotifications) {
            LocalNotifications.requestPermissions();
        }
    } catch (e) {}

    const btn = document.getElementById('fabGpsBtn');
    const originalIcon = '\x3Cspan class="material-symbols-outlined"\x3Emy_location\x3C/span\x3E';
    if (btn) btn.classList.add('fab-active');
    if (!silent && btn) {
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E';
    }

    // Załaduj słownik stacji GPS do pamięci RAM
    if (!window._cachedStationList || window._cachedStationList.length === 0) {
        try {
            let rawDict = await localforage.getItem(STATIONS_DICT_KEY);
            if (typeof rawDict === 'string') {
                try { rawDict = JSON.parse(rawDict); } catch (err) {}
            }
            if (Array.isArray(rawDict)) {
                window._cachedStationList = rawDict;
            } else if (rawDict && typeof rawDict === 'object') {
                window._cachedStationList = Object.values(rawDict);
            }
        } catch (e) {}

        if ((!window._cachedStationList || window._cachedStationList.length === 0) && navigator.onLine) {
            try {
                const docSnap = await getDoc(doc(publicDb, 'public_data', 'stations_dict'));
                if (docSnap.exists()) {
                    window._cachedStationList = docSnap.data().data || [];
                }
            } catch (netErr) {
                console.warn("Brak połączenia z chmurą dla stations_dict:", netErr);
            }
        }
    }

    if (!window._passedStationIndices) window._passedStationIndices = new Set();
    if (!window._prevStationDistances) window._prevStationDistances = {};

    const processPosition = (position, isAccurate, shouldCenter = false) => {
        if (window._crewDutyCompleted || window.activeTrackingMode !== 'gps') return;

        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const accuracyMeters = (position.coords && typeof position.coords.accuracy === 'number') ? position.coords.accuracy : (isAccurate ? 25 : 1200);
        const isHighConfidenceGps = isAccurate && accuracyMeters <= 650;

        window._lastValidGpsTimestamp = Date.now();
        window.hideGpsSignalWarning();

        try {
            let currentRows = window._cachedRouteRowElements;
            if (!Array.isArray(currentRows) || currentRows.length === 0 || !currentRows[0].isConnected) {
                currentRows = Array.from(document.querySelectorAll('.train-route-table tr[data-station-idx]'));
                window._cachedRouteRowElements = currentRows;
            }
            if (currentRows.length === 0) return;

            let closestRowIndex = -1;
            let closestMatchedPos = -1;
            let minDistance = Infinity;
            const rowDistances = [];

            for (let i = 0; i < currentRows.length; i++) {
                const row = currentRows[i];
                let stationName = row.dataset.stname || '';
                if (!stationName) {
                    const stationNameCell = row.querySelector('td:first-child');
                    if (!stationNameCell) continue;
                    const clickableEl = stationNameCell.querySelector('.station-clickable');
                    stationName = (clickableEl ? clickableEl.innerText : stationNameCell.innerText).trim().toUpperCase();
                    row.dataset.stname = stationName;
                }

                let stLat = row.dataset.lat !== undefined ? parseFloat(row.dataset.lat) : NaN;
                let stLng = row.dataset.lng !== undefined ? parseFloat(row.dataset.lng) : NaN;

                if (isNaN(stLat) || isNaN(stLng)) {
                    const stCoords = getStationCoordsFast(stationName);
                    if (stCoords) {
                        stLat = stCoords.lat;
                        stLng = stCoords.lng;
                        row.dataset.lat = String(stLat);
                        row.dataset.lng = String(stLng);
                    }
                }

                if (!isNaN(stLat) && !isNaN(stLng)) {
                    const dist = getDistance(userLat, userLng, stLat, stLng);
                    const matchedIdx = rowDistances.length;
                    const absArr = row.dataset.absArr !== undefined ? parseInt(row.dataset.absArr, 10) : null;
                    const absDep = row.dataset.absDep !== undefined ? parseInt(row.dataset.absDep, 10) : null;

                    rowDistances.push({
                        index: i,
                        matchedIdx: matchedIdx,
                        name: stationName,
                        lat: stLat,
                        lng: stLng,
                        distance: dist,
                        absArr: absArr,
                        absDep: absDep,
                        row: row
                    });

                    if (dist < minDistance) {
                        minDistance = dist;
                        closestRowIndex = i;
                        closestMatchedPos = matchedIdx;
                    }
                }
            }

            if (closestRowIndex === -1 || rowDistances.length === 0) {
                if (!silent) alert("Nie udało się dopasować współrzędnych stacji z tej trasy do bazy GPS.");
                if (!silent && btn) btn.innerHTML = originalIcon;
                return;
            }

            // Bufor historii pozycji GPS do ciągłego wygładzania prędkości i eliminacji skoków
            if (!window._gpsFixHistory) window._gpsFixHistory = [];

            // Filtr szumu BTS: jeśli w ciągu ostatnich 20 sekund mieliśmy precyzyjny odczyt satelitarny,
            // ignorujemy odczyty BTS o niskiej dokładności (> 400m), aby uniknąć fałszywych skoków pozycji i prędkości!
            const timeSinceAccurateGps = Date.now() - (window._lastAccurateGpsTimestamp || 0);
            if (!isAccurate || accuracyMeters > 400) {
                if (window._lastAccurateGpsTimestamp && timeSinceAccurateGps < 20000) {
                    if (typeof window.czuwakLog === 'function') {
                        window.czuwakLog('DEBUG', 'GPS', 'Pominięto skok BTS/sieci (' + Math.round(accuracyMeters) + 'm) - aktywny sygnał satelitarny');
                    }
                    return;
                }
            } else {
                window._lastAccurateGpsTimestamp = Date.now();
            }

            // Wyznaczenie wektora ruchu pociągu oraz ciągłej prędkości km/h (jak w nawigacji)
            const cosLat = Math.cos(userLat * Math.PI / 180);
            const KM_PER_DEG = 111.32;
            let moveUx = null;
            let moveUy = null;
            let measuredSpeedKmH = null;

            const rawHeading = position.coords && typeof position.coords.heading === 'number' && !isNaN(position.coords.heading)
                ? position.coords.heading
                : null;
            const rawSpeed = position.coords && typeof position.coords.speed === 'number' && !isNaN(position.coords.speed)
                ? position.coords.speed
                : null;

            // 1. Sprzętowy odczyt prędkości z odbiornika GPS (coords.speed w m/s)
            if (rawSpeed !== null && rawSpeed >= 0) {
                if (rawSpeed < 0.65) {
                    // Prędkość poniżej ~2.3 km/h traktujemy jako postój (eliminacja pływania pozycji na peronie)
                    measuredSpeedKmH = 0;
                } else {
                    measuredSpeedKmH = Math.min(220, rawSpeed * 3.6);
                }
            }

            // 2. Sprzętowy azymut ruchu (heading)
            if (rawHeading !== null && rawHeading >= 0 && (rawSpeed === null || rawSpeed > 1.2)) {
                const headingRad = rawHeading * Math.PI / 180;
                moveUx = Math.sin(headingRad);
                moveUy = Math.cos(headingRad);
            }

            // 3. Ciągła estymacja prędkości z bufora próbek GPS jeśli coords.speed nie jest dostarczane przez urządzenie
            const nowTs = Date.now();
            if (window._gpsFixHistory.length > 0) {
                // Szukamy próbki z okna 2 - 5 sekund temu
                let refFix = null;
                for (let h = 0; h < window._gpsFixHistory.length; h++) {
                    const fix = window._gpsFixHistory[h];
                    const ageSec = (nowTs - fix.time) / 1000;
                    if (ageSec >= 1.8 && ageSec <= 6.0) {
                        refFix = fix;
                        break;
                    }
                }
                if (!refFix && window._gpsFixHistory.length > 0) {
                    refFix = window._gpsFixHistory[window._gpsFixHistory.length - 1];
                }

                if (refFix) {
                    const dtSec = (nowTs - refFix.time) / 1000;
                    const dxKm = (userLng - refFix.lng) * KM_PER_DEG * cosLat;
                    const dyKm = (userLat - refFix.lat) * KM_PER_DEG;
                    const movedKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);

                    if (dtSec >= 1.2) {
                        if (moveUx === null && movedKm >= 0.03) {
                            moveUx = dxKm / movedKm;
                            moveUy = dyKm / movedKm;
                        }

                        if (measuredSpeedKmH === null) {
                            // Poziom szumu: ruch musi przekroczyć promień błędu pomiaru
                            const noiseFloorKm = Math.max(0.015, (accuracyMeters + (refFix.accuracy || 25)) / 1000 * 0.70);
                            if (movedKm >= noiseFloorKm) {
                                const calcSpd = (movedKm / (dtSec / 3600));
                                if (calcSpd >= 4.0 && calcSpd <= 220) {
                                    measuredSpeedKmH = calcSpd;
                                } else {
                                    measuredSpeedKmH = 0;
                                }
                            } else {
                                measuredSpeedKmH = 0;
                            }
                        }
                    }
                }
            }

            // Zapisz pozycję do bufora historii (max 8 próbek)
            window._gpsFixHistory.unshift({
                lat: userLat,
                lng: userLng,
                time: nowTs,
                accuracy: accuracyMeters,
                speed: (measuredSpeedKmH !== null ? measuredSpeedKmH : 0)
            });
            if (window._gpsFixHistory.length > 8) {
                window._gpsFixHistory.pop();
            }

            // 4. Ciągłe wygładzanie wykładnicze (EMA) prędkości – eliminuje nagłe skoki 0 -> 70 -> 0 km/h
            if (measuredSpeedKmH !== null) {
                if (measuredSpeedKmH < 3.0) {
                    if (window._smoothedSpeedKmH === null || window._smoothedSpeedKmH < 3.0) {
                        window._smoothedSpeedKmH = 0;
                    } else {
                        window._smoothedSpeedKmH = Math.round(window._smoothedSpeedKmH * 0.55 * 10) / 10;
                        if (window._smoothedSpeedKmH < 2.5) window._smoothedSpeedKmH = 0;
                    }
                } else if (window._smoothedSpeedKmH === null || window._smoothedSpeedKmH === 0) {
                    window._smoothedSpeedKmH = Math.round(measuredSpeedKmH * 10) / 10;
                } else {
                    window._smoothedSpeedKmH = Math.round((0.40 * measuredSpeedKmH + 0.60 * window._smoothedSpeedKmH) * 10) / 10;
                }
            }

            const currentSpeedKmH = (window._smoothedSpeedKmH !== null && window._smoothedSpeedKmH >= 3.0)
                ? window._smoothedSpeedKmH
                : ((measuredSpeedKmH !== null && measuredSpeedKmH >= 3.0) ? measuredSpeedKmH : 0);

            // Wyświetlana prędkość: pociąg stojący na stacji ma czyste 0 km/h
            const isStoppedAtStation = (minDistance <= 0.32 && currentSpeedKmH < 6.0);
            const displaySpeedKmH = (isStoppedAtStation || currentSpeedKmH < 3.0) ? 0 : Math.round(currentSpeedKmH);

            window.updateSpeedAndGpsIndicator(displaySpeedKmH, isHighConfidenceGps ? 'ok' : 'bts');

            window._lastTrainGpsFix = { lat: userLat, lng: userLng, time: Date.now(), speedKmH: displaySpeedKmH };

            const color = isHighConfidenceGps ? 'var(--success)' : 'var(--warning)';
            const bgColor = isHighConfidenceGps ? 'rgba(22, 163, 74, 0.1)' : 'rgba(245, 158, 11, 0.1)';
            const accuracyText = !isHighConfidenceGps
                ? '\x3Cspan style="font-size: 0.7rem; font-weight: normal; opacity: 0.8; margin-top: 4px; display: block; text-align: center;"\x3E(Lokalizacja przybliżona - BTS/Sieć)\x3C/span\x3E'
                : '';

            rowDistances.forEach(rd => {
                const isClosest = rd.index === closestRowIndex;
                let distDiv = rd.row._cachedDistDiv;
                if (!distDiv || !distDiv.isConnected) {
                    const stationNameTd = rd.row.querySelector('.station-name-td');
                    if (stationNameTd) {
                        let cellWrapper = stationNameTd.querySelector('.station-cell-wrapper');
                        if (!cellWrapper) {
                            cellWrapper = document.createElement('div');
                            cellWrapper.className = 'station-cell-wrapper';
                            while (stationNameTd.firstChild) {
                                cellWrapper.appendChild(stationNameTd.firstChild);
                            }
                            stationNameTd.appendChild(cellWrapper);
                        }
                        distDiv = cellWrapper.querySelector('.gps-distance-indicator');
                        if (!distDiv) {
                            distDiv = document.createElement('div');
                            distDiv.className = 'gps-distance-indicator';
                            cellWrapper.appendChild(distDiv);
                        }
                        rd.row._cachedDistDiv = distDiv;
                    }
                }

                if (distDiv) {
                    const distFormatted = rd.distance.toFixed(1);
                    const stateKey = distFormatted + '|' + (isClosest ? '1' : '0') + '|' + (isHighConfidenceGps ? '1' : '0');
                    if (distDiv.dataset.lastGpsState !== stateKey) {
                        distDiv.dataset.lastGpsState = stateKey;
                        const distColor = isClosest ? color : 'var(--text-muted)';
                        const distBg = isClosest ? bgColor : 'transparent';
                        const distBorder = isClosest ? ('1px solid ' + color) : '1px dashed var(--border)';

                        distDiv.className = 'gps-distance-indicator' + (isClosest ? ' closest' : '');
                        distDiv.style.color = distColor;

                        const extraText = (isClosest && !isHighConfidenceGps) ? accuracyText : '';
                        distDiv.innerHTML =
                            '\x3Cspan class="gps-dist-pill" style="background: ' + distBg + '; border: ' + distBorder + '; font-weight: ' + (isClosest ? '800' : '600') + ';"\x3E' +
                                '\x3Cspan class="material-symbols-outlined icon-sm" style="font-size: 0.95rem;"\x3Enear_me\x3C/span\x3E ~' + distFormatted + ' km' +
                            '\x3C/span\x3E' + extraText;
                    }
                }
            });

            // SPRAWDZENIE BLOKADY PRZESKOCZENIA STACJI:
            // Jeśli drużyna nie odhaczyła postoju na stacji wcześniejszej z odcinka służby DK,
            // Czuwak blokuje automatyczne przejście do kolejnych stacji.
            const dutyStartIdx = (typeof window._crewDutyStartIdx === 'number') ? window._crewDutyStartIdx : 0;
            const trainStations = (window._currentTrainObject && window._currentTrainObject.stacje)
                ? (Array.isArray(window._currentTrainObject.stacje) ? window._currentTrainObject.stacje : Object.values(window._currentTrainObject.stacje))
                : [];

            const findUncheckedStationBefore = (candidateIdx) => {
                for (let k = dutyStartIdx; k < candidateIdx; k++) {
                    if (!window.isStationStopChecked(k)) {
                        const stObj = trainStations[k] || {};
                        const stName = (typeof stObj === 'string' ? stObj : (stObj.nazwa || 'Stacja #' + (k + 1))).toUpperCase();
                        return { isBlocked: true, blockedIdx: k, blockedName: stName };
                    }
                }
                return { isBlocked: false, blockedIdx: -1, blockedName: '' };
            };

            if (minDistance <= 0.32) {
                // TRYB STACJA: Pociąg w odległości <= 320m (0.32 km) od stacji
                window._wasInTunnelEstimation = false;
                window.dismissStationApproachToast();
                window._lastActiveSegmentState = null;

                const closestRow = currentRows[closestRowIndex];
                const closestObj = rowDistances[closestMatchedPos];
                const stationName = closestObj ? closestObj.name : '';

                // Sprawdzenie blokady przeskoczenia stacji:
                const advanceBlock = findUncheckedStationBefore(closestRowIndex);
                if (advanceBlock.isBlocked) {
                    const bIdx = advanceBlock.blockedIdx;
                    const bName = advanceBlock.blockedName;
                    const bMatched = rowDistances.find(r => r.index === bIdx);
                    const bDist = bMatched ? bMatched.distance : minDistance;
                    const bRow = bMatched ? bMatched.row : currentRows[bIdx];

                    const stObjB = trainStations[bIdx] || {};
                    const schedArrB = (stObjB && stObjB.przyjazd && stObjB.przyjazd !== '-') ? stObjB.przyjazd : (stObjB ? stObjB.odjazd : '');
                    const delayedArrB = (window._trainDelayMinutes > 0 && schedArrB) ? addMinutesToHHMM(schedArrB, window._trainDelayMinutes) : schedArrB;

                    window.updateNextStationHud({
                        index: bIdx,
                        name: bName,
                        distKm: bDist,
                        distStr: '~' + (bDist >= 1 ? bDist.toFixed(1) + ' km' : Math.round(bDist * 1000) + ' m'),
                        isStationStop: true,
                        isBlockedAdvance: true,
                        blockedStationIdx: bIdx,
                        blockedStationName: bName,
                        etaStr: 'Wymagane odhaczenie',
                        schedArr: schedArrB,
                        delayedArr: delayedArrB,
                        isHandover: (bIdx === window._crewDutyEndIdx),
                        tag: window.getStationTag(bIdx)
                    });

                    currentRows.forEach((r, idx) => {
                        if (idx !== bIdx) r.classList.remove('active-station-row', 'station-with-train');
                    });
                    if (bRow) bRow.classList.add('active-station-row');
                    return;
                }

                for (let pIdx = 0; pIdx < closestMatchedPos; pIdx++) {
                    window._passedStationIndices.add(pIdx);
                }

                // Sprawdzenie postoju i odjazdu:
                if (currentSpeedKmH < 6.0) {
                    // Pociąg stoi na stacji
                    if (window._currentStandingStationIdx !== closestRowIndex) {
                        window.recordStationArrivalStop(closestRowIndex);
                        window._currentStandingStationIdx = closestRowIndex;
                        window._stationDepartureSustainedCounter = 0;
                    }
                } else if (window._currentStandingStationIdx === closestRowIndex) {
                    // Pociąg ruszył ze stacji: wymagana prędkość >= 12 km/h potwierdzona przez 2 odczyty LUB oddalenie > 350m
                    if (currentSpeedKmH >= 12.0) {
                        window._stationDepartureSustainedCounter = (window._stationDepartureSustainedCounter || 0) + 1;
                        if (window._stationDepartureSustainedCounter >= 2 || minDistance >= 0.35) {
                            window.recordStationDeparture(closestRowIndex);
                            window._currentStandingStationIdx = null;
                            window._stationDepartureSustainedCounter = 0;
                            if (typeof window.czuwakLog === 'function') {
                                window.czuwakLog('INFO', 'STATION', 'Odjazd ze stacji ' + stationName + ' potwierdzony (V=' + currentSpeedKmH.toFixed(1) + ' km/h)');
                            }
                        }
                    } else {
                        // Prędkość 6-11 km/h (np. spacer drużyny po składzie, dryf GPS) -> ignoruj jako odjazd
                        window._stationDepartureSustainedCounter = 0;
                    }
                }

                // Aktualizuj Hero HUD i widget MediaSession
                const stObjAtStation = trainStations[closestRowIndex] || {};
                const schedArrStation = (stObjAtStation && stObjAtStation.przyjazd && stObjAtStation.przyjazd !== '-') ? stObjAtStation.przyjazd : (stObjAtStation ? stObjAtStation.odjazd : '');
                const delayedArrStation = (window._trainDelayMinutes > 0 && schedArrStation) ? addMinutesToHHMM(schedArrStation, window._trainDelayMinutes) : schedArrStation;

                window.updateNextStationHud({
                    index: closestRowIndex,
                    name: stationName,
                    distKm: minDistance,
                    distStr: '~' + (minDistance * 1000).toFixed(0) + ' m',
                    isStationStop: true,
                    isBlockedAdvance: false,
                    etaStr: (currentSpeedKmH < 6.0) ? 'Postój na stacji' : 'Odjazd ze stacji',
                    schedArr: schedArrStation,
                    delayedArr: delayedArrStation,
                    isHandover: (typeof window._crewDutyEndIdx === 'number' && closestRowIndex === window._crewDutyEndIdx),
                    tag: window.getStationTag(closestRowIndex)
                });

                const stLog = (window._stationActualLog && window._stationActualLog[closestRowIndex]) ? window._stationActualLog[closestRowIndex] : null;
                const stopTimeInfo = (stLog && stLog.actualArr) ? (' \u2022 Postój: ' + stLog.actualArr) : '';

                document.querySelectorAll('.train-moving-row').forEach(el => el.remove());

                currentRows.forEach((r, idx) => {
                    if (idx !== closestRowIndex) {
                        r.classList.remove('active-station-row', 'station-with-train');
                    }
                });

                closestRow.classList.add('active-station-row', 'station-with-train');

                const existingStandingTr = document.querySelector('.station-standing-train-row');
                const isStandingAlreadyHere = existingStandingTr && (closestRow.nextElementSibling === existingStandingTr);

                if (isStandingAlreadyHere) {
                    const badge = existingStandingTr.querySelector('.station-standing-badge');
                    if (badge) {
                        badge.className = 'station-standing-badge ' + (isHighConfidenceGps ? 'gps-active' : 'gps-approx');
                        badge.innerHTML =
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                            (isHighConfidenceGps ? 'Twoja lokalizacja (GPS Satelity): ' : 'Lokalizacja przybliżona (BTS): ') +
                            'Pociąg na stacji ' + escapeHTML(stationName) + ' (~' + (minDistance * 1000).toFixed(0) + ' m' + escapeHTML(stopTimeInfo) + ')';
                    }
                } else {
                    if (existingStandingTr) existingStandingTr.remove();

                    const standingTr = document.createElement('tr');
                    standingTr.className = 'station-standing-train-row active-station-row';
                    standingTr.innerHTML =
                        '\x3Ctd colspan="3" style="padding: 0; border: none; background: transparent;"\x3E' +
                            '\x3Cdiv class="station-standing-box"\x3E' +
                                '\x3Cdiv class="station-standing-badge ' + (isHighConfidenceGps ? 'gps-active' : 'gps-approx') + '"\x3E' +
                                    '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                                    (isHighConfidenceGps ? 'Twoja lokalizacja (GPS Satelity): ' : 'Lokalizacja przybliżona (BTS): ') +
                                    'Pociąg na stacji ' + escapeHTML(stationName) + ' (~' + (minDistance * 1000).toFixed(0) + ' m' + escapeHTML(stopTimeInfo) + ')' +
                                '\x3C/div\x3E' +
                                '\x3Cdiv class="table-train-container standing-station-container"\x3E' +
                                    (typeof window.getStandingTrainIndicatorHTML === 'function' ? window.getStandingTrainIndicatorHTML(5, stationName) : '') +
                                '\x3C/div\x3E' +
                            '\x3C/div\x3E' +
                        '\x3C/td\x3E';

                    closestRow.parentNode.insertBefore(standingTr, closestRow.nextSibling);
                }

                if (typeof window.updateOrmLiveTrainPosition === 'function') {
                    const nextSt = rowDistances[closestMatchedPos + 1] || closestObj;
                    window.updateOrmLiveTrainPosition(userLat, userLng, nextSt);
                }

                if (shouldCenter) {
                    window.centerOnElement(closestRow);
                }

                // SAMOCZYNNE WYŁĄCZENIE CZUWAKA PO ZATRZYMANIU NA STACJI ZMIANY DK (<= 300m i < 5 km/h)!
                if (currentSpeedKmH < 5 && typeof window._crewDutyEndIdx === 'number' && closestRowIndex >= window._crewDutyEndIdx && closestRowIndex > window._crewDutyStartIdx) {
                    window.recordStationArrivalStop(closestRowIndex);
                    window.completeCrewDutyAndStopCzuwak(stationName, 'Zatrzymanie na stacji zmiany DK');
                    return;
                }
            } else if (rowDistances.length >= 2) {
                // TRYB SZLAK: Pociąg jedzie pomiędzy stacjami (> 320m od stacji)
                // Odjazd ze stacji zatwierdzamy, jeśli pociąg rzeczywiście ruszył (V >= 12 km/h lub oddalił się > 400m)
                if (window._currentStandingStationIdx !== null) {
                    if (currentSpeedKmH >= 12.0 || minDistance > 0.40) {
                        window.recordStationDeparture(window._currentStandingStationIdx);
                        window._currentStandingStationIdx = null;
                        window._stationDepartureSustainedCounter = 0;
                    }
                }

                document.querySelectorAll('.station-standing-train-row').forEach(el => el.remove());
                document.querySelectorAll('.train-route-table tr.active-station-row').forEach(el => {
                    el.classList.remove('active-station-row', 'station-with-train');
                });

                const nowD = new Date();
                let relMinutesNow = nowD.getHours() * 60 + nowD.getMinutes() - (window._trainDelayMinutes || 0);
                if (window._currentTrainBestMatch && typeof window._currentTrainBestMatch.daysAgo === 'number') {
                    relMinutesNow += window._currentTrainBestMatch.daysAgo * 1440;
                }

                // Ochrona przed cofaniem szlaku na A>B po odjeździe ze stacji B:
                // Znajdź najwyższy indeks w rowDistances stacji, z której już odjechano lub którą zaliczono
                let minAllowedSegIdx = 0;
                for (let m = 0; m < rowDistances.length; m++) {
                    const stIdx = rowDistances[m].index;
                    const log = (window._stationActualLog && window._stationActualLog[stIdx]) ? window._stationActualLog[stIdx] : null;
                    const hasDeparted = !!(log && log.actualDep);
                    const isPassed = window._passedStationIndices && window._passedStationIndices.has(m);
                    if (hasDeparted || isPassed) {
                        if (m > minAllowedSegIdx) {
                            minAllowedSegIdx = m;
                        }
                    }
                }

                let bestSegIdx = Math.min(minAllowedSegIdx, Math.max(0, rowDistances.length - 2));
                let bestScore = Infinity;

                for (let k = 0; k < rowDistances.length - 1; k++) {
                    const A = rowDistances[k];
                    const B = rowDistances[k + 1];

                    const Ax = (A.lng - userLng) * KM_PER_DEG * cosLat;
                    const Ay = (A.lat - userLat) * KM_PER_DEG;
                    const Bx = (B.lng - userLng) * KM_PER_DEG * cosLat;
                    const By = (B.lat - userLat) * KM_PER_DEG;

                    const Vx = Bx - Ax;
                    const Vy = By - Ay;
                    const L2 = Vx * Vx + Vy * Vy;
                    const L = Math.sqrt(L2);

                    const t = L2 > 0.0001 ? (((-Ax) * Vx + (-Ay) * Vy) / L2) : 0;
                    const tc = Math.max(0, Math.min(1, t));
                    const Qx = Ax + tc * Vx;
                    const Qy = Ay + tc * Vy;
                    const dPerp = Math.sqrt(Qx * Qx + Qy * Qy);

                    const dAB = getDistance(A.lat, A.lng, B.lat, B.lng);
                    const dEllipse = Math.max(0, A.distance + B.distance - dAB);
                    const dLongOut = t < 0 ? (-t * L) : (t > 1 ? ((t - 1) * L) : 0);

                    // --- KALISZ FIX v2 + OCHRONA PO WYJEŹDZIE Z TUNELU ---
                    let headingPenalty = 0;
                    const prevDistA = window._prevStationDistances[A.name];
                    const prevDistB = window._prevStationDistances[B.name];
                    const deltaDistA = (typeof prevDistA === 'number') ? (A.distance - prevDistA) : 0;
                    const deltaDistB = (typeof prevDistB === 'number') ? (B.distance - prevDistB) : 0;

                    // BEZWZGLĘDNY ZAKAZ COFANIA SZLAKU:
                    // Jeśli stacja m została już zaliczona lub odnotowano z niej odjazd,
                    // żaden odcinek kończący się na stacji m lub wcześniejszej (k < minAllowedSegIdx) nie może zostać wybrany!
                    if (k < minAllowedSegIdx) {
                        headingPenalty += 5000.0;
                    }

                    // Jeśli stacja B (k + 1) została już zaliczona w _passedStationIndices,
                    // pociąg nie może zbliżać się do niej od tyłu na odcinku k!
                    if (window._passedStationIndices.has(k + 1)) {
                        headingPenalty += 5000.0;
                    }

                    if (moveUx !== null && moveUy !== null) {
                        const distB = Math.sqrt(Bx * Bx + By * By);
                        const distA = Math.sqrt(Ax * Ax + Ay * Ay);
                        if (distB > 0.05) {
                            const cosToB = (moveUx * Bx + moveUy * By) / distB;
                            const cosToA = distA > 0.05 ? ((moveUx * Ax + moveUy * Ay) / distA) : 0;

                            if (B.distance < 15.0 && cosToB > 0.2) {
                                headingPenalty -= 4.5 * cosToB;
                            }
                            if (A.distance < 15.0 && cosToA > 0.2) {
                                headingPenalty += 28.0 * cosToA;
                            }
                        }
                    } else {
                        if (A.distance < 12.0 && k === closestMatchedPos && !window._passedStationIndices.has(k)) {
                            if (A.absDep !== null && relMinutesNow < A.absDep) {
                                headingPenalty += 12.0;
                            } else if (A.distance < 6.5) {
                                headingPenalty += 4.5;
                            }
                        }
                    }

                    if (A.distance < 15.0 && deltaDistA < -0.04) {
                        headingPenalty += 22.0;
                    }
                    if (B.distance < 15.0 && deltaDistB < -0.04) {
                        headingPenalty -= 3.5;
                    }

                    const score = dPerp + 0.75 * dEllipse + 1.25 * dLongOut + headingPenalty;
                    if (score < bestScore) {
                        bestScore = score;
                        bestSegIdx = k;
                    }
                }

                if (isHighConfidenceGps) {
                    if (window._wasInTunnelEstimation && typeof window.czuwakLog === 'function') {
                        window.czuwakLog('INFO', 'TUNNEL', 'Powrót sygnału GPS satelitarnego (dokładność ' + Math.round(accuracyMeters) + ' m). Zakończenie estymacji tunelowej.');
                    }
                    window._wasInTunnelEstimation = false;
                }

                // Zapisz bieżące odległości do stacji dla kolejnego kroku pomiarowego
                rowDistances.forEach(rd => {
                    const prev = window._prevStationDistances[rd.name];
                    if (typeof prev === 'undefined' || Math.abs(rd.distance - prev) >= 0.04) {
                        window._prevStationDistances[rd.name] = rd.distance;
                    }
                });

                const segStart = rowDistances[bestSegIdx];
                const segEnd = rowDistances[bestSegIdx + 1];

                // Jeśli pociąg miał zarejestrowany postój (<= 300m i < 5 km/h) na stacji początkowej odcinka i właśnie z niej ruszył, domknij czas odjazdu HH:MM:SS
                if (window._stationActualLog && window._stationActualLog[segStart.index] && window._stationActualLog[segStart.index].stopped && !window._stationActualLog[segStart.index].actualDep) {
                    window.recordStationDeparture(segStart.index);
                }

                // Zabezpieczenie 1: Jeśli pociąg minął już stację zmiany DK (znajduje się na odcinku za stacją zmiany DK) -> wyłącz Czuwaka!
                if (typeof window._crewDutyEndIdx === 'number' && segStart.index >= window._crewDutyEndIdx && window._passedStationIndices.size > 0) {
                    window.completeCrewDutyAndStopCzuwak(window._crewDutyEndStationName || segStart.name, 'Pociąg minął stację zmiany DK');
                    return;
                }

                // Zabezpieczenie 2: Jeśli użytkownik oddalił się od trasy pociągu na ponad 18 km (np. wysiadł i pojechał do domu) przy dokładnym GPS -> wyłącz Czuwaka!
                if (isHighConfidenceGps && bestScore > 18.0 && minDistance > 18.0 && window._passedStationIndices.size > 0) {
                    window.completeCrewDutyAndStopCzuwak(window._crewDutyEndStationName || segStart.name, 'Oddalono się od trasy pociągu (>18 km)');
                    return;
                }

                // Sprawdzenie blokady przeskoczenia stacji na szlaku:
                const advanceBlock = findUncheckedStationBefore(segEnd.index);
                let targetIdx = segEnd.index;
                let targetName = segEnd.name;
                let targetDist = segEnd.distance;
                let isBlocked = false;

                if (advanceBlock.isBlocked) {
                    isBlocked = true;
                    targetIdx = advanceBlock.blockedIdx;
                    targetName = advanceBlock.blockedName;
                    const bMatched = rowDistances.find(r => r.index === targetIdx);
                    targetDist = bMatched ? bMatched.distance : segEnd.distance;
                    if (typeof window.czuwakLog === 'function') {
                        window.czuwakLog('WARN', 'STATION', 'Szlak: wstrzymano przejście do stacji ' + segEnd.name + ' - brak odhaczenia stacji ' + targetName);
                    }
                }

                const insertBeforeIndex = targetIdx;
                const targetRow = rowDistances.find(r => r.index === insertBeforeIndex)?.row || currentRows[closestRowIndex];

                // Wylicz prędkość rozkładową dla tego odcinka szlaku (do estymacji w tunelu bez GPS i BTS)
                const dAB = Math.max(1.0, getDistance(segStart.lat, segStart.lng, segEnd.lat, segEnd.lng));
                const segMinutes = (segEnd.absArr !== null && segStart.absDep !== null && segEnd.absArr > segStart.absDep)
                    ? (segEnd.absArr - segStart.absDep)
                    : ((dAB / 85) * 60);
                const scheduledSegSpeedKmH = Math.min(160, Math.max(40, dAB / Math.max(0.05, segMinutes / 60)));
                const effectiveSpeedForTunnel = (window._smoothedSpeedKmH && window._smoothedSpeedKmH >= 20)
                    ? window._smoothedSpeedKmH
                    : scheduledSegSpeedKmH;

                // Zapisz pełny stan aktywnego odcinka dla silnika tunelowego (Dead Reckoning v2)
                window._lastActiveSegmentState = {
                    segIdx: bestSegIdx,
                    segStart: segStart,
                    segEnd: segEnd,
                    dAB: dAB,
                    remainingKm: segEnd.distance,
                    originKm: segStart.distance,
                    speedKmH: effectiveSpeedForTunnel,
                    scheduledSpeedKmH: scheduledSegSpeedKmH,
                    timestamp: Date.now(),
                    rowDistancesSnapshot: rowDistances
                };

                // Aktualizuj pozycję na mapie OpenRailwayMap
                if (typeof window.updateOrmLiveTrainPosition === 'function') {
                    window.updateOrmLiveTrainPosition(userLat, userLng, segEnd);
                }

                // Aktualizuj Hero HUD i widget MediaSession na szlaku
                const stEndObj = trainStations[targetIdx] || {};
                const schedArrEnd = (stEndObj && stEndObj.przyjazd && stEndObj.przyjazd !== '-') ? stEndObj.przyjazd : (stEndObj ? stEndObj.odjazd : '');
                const delayedArrEnd = (window._trainDelayMinutes > 0 && schedArrEnd) ? addMinutesToHHMM(schedArrEnd, window._trainDelayMinutes) : schedArrEnd;
                let etaDisplay = '';
                if (isBlocked) {
                    etaDisplay = 'Wymagane odhaczenie';
                } else if (currentSpeedKmH >= 15 && targetDist > 0) {
                    const minsToStation = Math.round((targetDist / currentSpeedKmH) * 60);
                    const etaDate = new Date(Date.now() + minsToStation * 60000);
                    const pad = (n) => String(n).padStart(2, '0');
                    etaDisplay = 'ETA ' + pad(etaDate.getHours()) + ':' + pad(etaDate.getMinutes()) + ' (~' + minsToStation + ' min)';
                } else if (delayedArrEnd) {
                    etaDisplay = 'Plan. ' + delayedArrEnd;
                }

                window.updateNextStationHud({
                    index: targetIdx,
                    name: targetName,
                    distKm: targetDist,
                    distStr: '~' + targetDist.toFixed(1) + ' km',
                    isStationStop: isBlocked,
                    isBlockedAdvance: isBlocked,
                    blockedStationIdx: isBlocked ? targetIdx : null,
                    blockedStationName: isBlocked ? targetName : null,
                    etaStr: etaDisplay,
                    schedArr: schedArrEnd,
                    delayedArr: delayedArrEnd,
                    isHandover: (typeof window._crewDutyEndIdx === 'number' && targetIdx === window._crewDutyEndIdx),
                    tag: window.getStationTag(targetIdx)
                });

                // --- POWIADOMIENIE Z DŹWIĘKIEM NA WYBRANĄ LICZBĘ KM PRZED STACJĄ DOCELOWĄ (TYLKO W ODCINKU OBSŁUGI DK!) ---
                const isWithinCrewDuty = (segEnd.index > window._crewDutyStartIdx && segEnd.index <= window._crewDutyEndIdx);
                const configuredAlertKm = window.getAlertDistanceKm();
                const approachThresholdKm = Math.min(configuredAlertKm, dAB * 0.65);

                if (isWithinCrewDuty && segEnd.distance <= approachThresholdKm && segEnd.distance > 0.30) {
                    window.triggerStationApproachAlert(segEnd.name, segEnd.distance, false, false);
                } else if (segEnd.distance <= 0.30) {
                    window.dismissStationApproachToast();
                }

                const segmentDistancesHtml =
                    '\x3Cdiv class="train-segment-distances"\x3E' +
                        '\x3Cdiv class="train-segment-pill origin"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm train-segment-pill-icon origin-icon"\x3Etrip_origin\x3C/span\x3E' +
                            '\x3Cspan class="train-segment-pill-text"\x3E' +
                                '\x3Cspan class="nowrap-token"\x3EOdjechano z:\x3C/span\x3E ' +
                                '\x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(segStart.name) + '\x3C/strong\x3E ' +
                                '\x3Cspan class="nowrap-token" id="liveOriginKmSpan"\x3E(~' + segStart.distance.toFixed(1) + ' km temu)\x3C/span\x3E' +
                            '\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="train-segment-pill destination"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm train-segment-pill-icon dest-icon"\x3Elocation_on\x3C/span\x3E' +
                            '\x3Cspan class="train-segment-pill-text"\x3E' +
                                '\x3Cspan class="nowrap-token"\x3EDo stacji:\x3C/span\x3E ' +
                                '\x3Cstrong style="color:var(--primary);"\x3E' + escapeHTML(segEnd.name) + '\x3C/strong\x3E ' +
                                '\x3Cspan class="nowrap-token" id="liveDestKmSpan"\x3E(pozostało ~' + segEnd.distance.toFixed(1) + ' km)\x3C/span\x3E' +
                            '\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E';

                const segmentLabel = 'Szlak: ' + escapeHTML(segStart.name) + ' \x3Cspan class="material-symbols-outlined icon-sm" style="font-size:0.95rem; vertical-align:middle;"\x3Earrow_forward\x3C/span\x3E ' + escapeHTML(segEnd.name);
                const segmentSubHtml = '\x3Cdiv class="segment-sub-title" style="font-size: 0.8rem; font-weight: 600; color: var(--text); opacity: 0.9; margin-bottom: 4px; text-align: center; z-index: 20;"\x3E' + segmentLabel + '\x3C/div\x3E';

                const existingMovingTr = document.querySelector('.train-moving-row');
                const isMovingAlreadyHere = existingMovingTr && (targetRow.previousElementSibling === existingMovingTr);

                if (isMovingAlreadyHere) {
                    const headerEl = existingMovingTr.querySelector('.moving-loc-header');
                    if (headerEl) {
                        headerEl.style.color = color;
                        headerEl.innerHTML =
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                            (isHighConfidenceGps ? 'Czuwak aktywny (GPS Satelity)' : 'Czuwak aktywny (Sieć BTS / Hybryda)');
                    }
                    const subTitleEl = existingMovingTr.querySelector('.segment-sub-title');
                    if (subTitleEl) subTitleEl.innerHTML = segmentLabel;

                    let distBox = existingMovingTr.querySelector('.train-segment-distances-wrapper');
                    if (distBox) distBox.innerHTML = segmentDistancesHtml;
                } else {
                    if (existingMovingTr) existingMovingTr.remove();

                    const indicatorTr = document.createElement('tr');
                    indicatorTr.className = 'train-moving-row';
                    indicatorTr.innerHTML =
                        '\x3Ctd colspan="3" style="padding: 0; border: none;"\x3E' +
                            '\x3Cdiv style="background: ' + bgColor + '; display: flex; flex-direction: column; padding: 10px 0; overflow: hidden; position: relative; border-radius: 8px;"\x3E' +
                                '\x3Cdiv class="moving-loc-header" style="font-size: 0.9rem; font-weight: bold; color: ' + color + '; margin-bottom: 2px; text-align: center; z-index: 20; display: flex; align-items: center; justify-content: center; gap: 6px;"\x3E' +
                                    '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                                    (isHighConfidenceGps ? 'Czuwak aktywny (GPS Satelity)' : 'Czuwak aktywny (Sieć BTS / Hybryda)') +
                                '\x3C/div\x3E' +
                                segmentSubHtml +
                                '\x3Cdiv class="train-segment-distances-wrapper"\x3E' +
                                    segmentDistancesHtml +
                                '\x3C/div\x3E' +
                                '\x3Cdiv class="table-train-container"\x3E' +
                                    (typeof window.getTrainIndicatorHTML === 'function' ? window.getTrainIndicatorHTML(5) : '') +
                                '\x3C/div\x3E' +
                            '\x3C/div\x3E' +
                        '\x3C/td\x3E';

                    targetRow.parentNode.insertBefore(indicatorTr, targetRow);
                }

                if (shouldCenter) {
                    const rowToCenter = document.querySelector('.train-moving-row') || targetRow;
                    window.centerOnElement(rowToCenter);
                }
            }
        } catch (e) {
            if (!silent) alert("Błąd kalkulacji GPS: " + e.message);
        }
        if (!silent && btn) btn.innerHTML = originalIcon;
    };

    window._processPositionDirect = (pos, isAccurate) => processPosition(pos, isAccurate, false);

    // 1. Natychmiastowy odczyt GPS
    let hasCentered = false;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            processPosition(pos, true, !hasCentered);
            hasCentered = true;
            if (!silent && btn) btn.innerHTML = originalIcon;
        },
        (err) => {
            if (typeof window.czuwakLog === 'function') {
                window.czuwakLog('WARN', 'GPS', 'Brak natychmiastowego GPS: ' + (err ? (err.message || 'code=' + err.code) : 'timeout'));
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    processPosition(pos, false, !hasCentered);
                    hasCentered = true;
                    if (!silent && btn) btn.innerHTML = originalIcon;
                },
                (err2) => {
                    if (typeof window.czuwakLog === 'function') {
                        window.czuwakLog('WARN', 'GPS', 'Brak pozycji z sieci/BTS: ' + (err2 ? (err2.message || 'code=' + err2.code) : 'timeout'));
                    }
                    window.showGpsSignalWarning('\x3Cstrong\x3EBrak sygnału GPS i BTS (np. tunel):\x3C/strong\x3E Czuwak oczekuje na sygnał i monitoruje trasę w tle...');
                    if (!silent && btn) btn.innerHTML = originalIcon;
                },
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
            );
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );

    // 2. Ciągłe śledzenie przez watchPosition
    if (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) {
        try { navigator.geolocation.clearWatch(window._trainGpsWatchId); } catch (e) {}
        window._trainGpsWatchId = null;
    }
    try {
        window._trainGpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (window.activeTrackingMode === 'gps' && !window._crewDutyCompleted && document.querySelector('.train-route-table')) {
                    processPosition(pos, true, false);
                }
            },
            (err) => {
                const codeNames = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
                const cName = err ? (codeNames[err.code] || ('CODE_' + err.code)) : 'UNKNOWN';
                if (typeof window.czuwakLog === 'function') {
                    window.czuwakLog('WARN', 'GPS', 'Błąd watchPosition (' + cName + '): ' + (err && err.message ? err.message : 'brak szczegółów'));
                }
                console.warn("WatchPosition ostrzeżenie:", err);
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    } catch (e) {
        if (typeof window.czuwakLog === 'function') {
            window.czuwakLog('ERROR', 'GPS', 'Błąd uruchomienia watchPosition: ' + e.message);
        }
    }

    // 3. Inteligentny watchdog GPS (sprawdza czy watchPosition nie zawisł i w razie potrzeby sonduje)
    if (window._trainGpsPollInterval) clearInterval(window._trainGpsPollInterval);
    window._trainGpsPollInterval = setInterval(() => {
        if (window.activeTrackingMode !== 'gps' || window._crewDutyCompleted || !document.querySelector('.train-route-table')) {
            clearInterval(window._trainGpsPollInterval);
            window._trainGpsPollInterval = null;
            return;
        }
        const timeSinceLastFix = Date.now() - (window._lastValidGpsTimestamp || 0);
        // Sondujemy tylko wtedy, gdy watchPosition milczy od ponad 15 sekund!
        if (timeSinceLastFix > 15000) {
            navigator.geolocation.getCurrentPosition(
                (pos) => processPosition(pos, true, false),
                () => {
                    // Tylko w sytuacji głębokiej utraty sygnału (> 30s) i poza stacją zezwól na BTS
                    if (timeSinceLastFix > 30000 && window._currentStandingStationIdx === null) {
                        navigator.geolocation.getCurrentPosition(
                            (posLow) => processPosition(posLow, false, false),
                            null,
                            { enableHighAccuracy: false, timeout: 5000, maximumAge: 5000 }
                        );
                    }
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 2000 }
            );
        }
    }, 8000);

    // 4. SILNIK TUNELOWY (DEAD RECKONING v2 PRZY UTRACIE GPS ORAZ BTS + AUTO-WYŁĄCZENIE PO SŁUŻBIE)
    if (window._gpsWatchdogInterval) clearInterval(window._gpsWatchdogInterval);
    window._gpsWatchdogInterval = setInterval(() => {
        if (window.activeTrackingMode !== 'gps' || window._crewDutyCompleted || !document.querySelector('.train-route-table')) {
            clearInterval(window._gpsWatchdogInterval);
            window._gpsWatchdogInterval = null;
            return;
        }

        // UWAGA: Nie wyłączamy Czuwaka ani nie odhaczamy stacji zmiany DK na podstawie rozkładowego czasu przyjazdu!
        // Pociągi mogą mieć opóźnienia, a wyłączenie stacji zmiany DK następuje wyłącznie po fizycznym zatrzymaniu
        // pociągu na stacji (odległość <= 300m i prędkość < 5km/h), oddaleniu się (> 18 km) lub po ręcznym kliknięciu przez drużynę.

        if (!window._lastValidGpsTimestamp) return;
        const secSinceLastFix = Math.round((Date.now() - window._lastValidGpsTimestamp) / 1000);

        if (secSinceLastFix >= 12 && window._lastActiveSegmentState) {
            if (!window._wasInTunnelEstimation && typeof window.czuwakLog === 'function') {
                window.czuwakLog('WARN', 'TUNNEL', 'Brak sygnału GPS od ' + secSinceLastFix + 's. Uruchomienie nawigacji inercyjnej w kierunku stacji ' + window._lastActiveSegmentState.segEnd.name);
            }
            window._wasInTunnelEstimation = true;
            const st = window._lastActiveSegmentState;
            const tunnelSpeedKmH = Math.round(0.6 * (st.speedKmH || 80) + 0.4 * (st.scheduledSpeedKmH || 80));
            const elapsedHours = (Date.now() - st.timestamp) / 3600000;
            const traveledEstKm = elapsedHours * tunnelSpeedKmH;
            let estRemainingKm = Math.max(0.3, st.remainingKm - traveledEstKm);
            let estOriginKm = st.originKm + traveledEstKm;

            // Aktualizacja kółka prędkościomierza i statusu na TUNEL
            window.updateSpeedAndGpsIndicator(tunnelSpeedKmH, 'tunnel');

            // Jeśli z wyliczenia w długim tunelu pociąg dojechał do stacji zmiany DK -> odhacz i wyłącz Czuwak
            if (estRemainingKm <= 0.55 && st.segEnd.index === window._crewDutyEndIdx) {
                window.completeCrewDutyAndStopCzuwak(st.segEnd.name, 'Osiągnięto stację zmiany DK (estymacja)');
                return;
            }

            // Jeśli w długim tunelu pociąg minął stację pośrednią -> przepnij estymację na kolejny odcinek szlaku!
            if (estRemainingKm <= 0.4 && Array.isArray(st.rowDistancesSnapshot) && (st.segIdx + 2) < st.rowDistancesSnapshot.length) {
                window._passedStationIndices.add(st.segIdx + 1);
                const nextA = st.rowDistancesSnapshot[st.segIdx + 1];
                const nextB = st.rowDistancesSnapshot[st.segIdx + 2];
                const nextDAB = Math.max(1.0, getDistance(nextA.lat, nextA.lng, nextB.lat, nextB.lng));
                window._lastActiveSegmentState = {
                    segIdx: st.segIdx + 1,
                    segStart: nextA,
                    segEnd: nextB,
                    dAB: nextDAB,
                    remainingKm: nextDAB,
                    originKm: 0,
                    speedKmH: tunnelSpeedKmH,
                    scheduledSpeedKmH: st.scheduledSpeedKmH,
                    timestamp: Date.now(),
                    rowDistancesSnapshot: st.rowDistancesSnapshot
                };
                return;
            }

            window.showGpsSignalWarning(
                '\x3Cstrong\x3EBrak zasięgu GPS i BTS (' + secSinceLastFix + ' s – np. tunel):\x3C/strong\x3E ' +
                'Nawigacja inercyjna aktywna (~' + tunnelSpeedKmH + ' km/h). Do stacji \x3Cstrong\x3E' + escapeHTML(st.segEnd.name) + '\x3C/strong\x3E pozostało ok. \x3Cstrong\x3E' + estRemainingKm.toFixed(1) + ' km\x3C/strong\x3E.'
            );

            const liveDestSpan = document.getElementById('liveDestKmSpan');
            if (liveDestSpan) {
                liveDestSpan.innerText = '(pozostało ~' + estRemainingKm.toFixed(1) + ' km [tunel])';
            }
            const liveOrigSpan = document.getElementById('liveOriginKmSpan');
            if (liveOrigSpan) {
                liveOrigSpan.innerText = '(~' + estOriginKm.toFixed(1) + ' km temu)';
            }

            // Interpolacja pozycji pociągu na mapie OpenRailwayMap podczas jazdy w tunelu
            if (typeof window.updateOrmLiveTrainPosition === 'function' && st.dAB > 0.2) {
                const progressFrac = Math.min(0.98, Math.max(0.02, 1 - (estRemainingKm / st.dAB)));
                const estLat = st.segStart.lat + (st.segEnd.lat - st.segStart.lat) * progressFrac;
                const estLng = st.segStart.lng + (st.segEnd.lng - st.segStart.lng) * progressFrac;
                window.updateOrmLiveTrainPosition(estLat, estLng, st.segEnd);
            }

            // Aktualizuj Hero HUD i widget MediaSession dla estymacji tunelowej
            const endIdx = st.segEnd.index;
            const stEndObj = (window._currentTrainObject && window._currentTrainObject.stacje)
                ? (Array.isArray(window._currentTrainObject.stacje) ? window._currentTrainObject.stacje[endIdx] : Object.values(window._currentTrainObject.stacje)[endIdx])
                : null;
            const schedArrTunnel = (stEndObj && stEndObj.przyjazd && stEndObj.przyjazd !== '-') ? stEndObj.przyjazd : (stEndObj ? stEndObj.odjazd : '');
            const delayedArrTunnel = (window._trainDelayMinutes > 0 && schedArrTunnel) ? addMinutesToHHMM(schedArrTunnel, window._trainDelayMinutes) : schedArrTunnel;
            let etaTunnelDisplay = '';
            if (tunnelSpeedKmH >= 15 && estRemainingKm > 0) {
                const minsLeft = Math.round((estRemainingKm / tunnelSpeedKmH) * 60);
                const etaDate = new Date(Date.now() + minsLeft * 60000);
                const pad = (n) => String(n).padStart(2, '0');
                etaTunnelDisplay = 'ETA ' + pad(etaDate.getHours()) + ':' + pad(etaDate.getMinutes()) + ' [tunel]';
            }

            window.updateNextStationHud({
                index: endIdx,
                name: st.segEnd.name,
                distKm: estRemainingKm,
                distStr: '~' + estRemainingKm.toFixed(1) + ' km [tunel]',
                isStationStop: false,
                etaStr: etaTunnelDisplay,
                schedArr: schedArrTunnel,
                delayedArr: delayedArrTunnel,
                isHandover: (typeof window._crewDutyEndIdx === 'number' && endIdx === window._crewDutyEndIdx),
                tag: window.getStationTag(endIdx)
            });

            const isWithinCrewDuty = (st.segEnd.index > window._crewDutyStartIdx && st.segEnd.index <= window._crewDutyEndIdx);
            const configuredAlertKm = window.getAlertDistanceKm();
            const approachThresholdKm = Math.min(configuredAlertKm, st.dAB * 0.65);
            if (isWithinCrewDuty && estRemainingKm <= approachThresholdKm && estRemainingKm > 0.6) {
                window.triggerStationApproachAlert(st.segEnd.name, estRemainingKm, false, true);
            }
        }
    }, 3000);
};

window._lastAppForegroundResumeTs = 0;

function handleAppForegroundResume(source) {
    const now = Date.now();
    if (now - window._lastAppForegroundResumeTs < 1500) {
        return;
    }
    window._lastAppForegroundResumeTs = now;

    if (typeof window.czuwakLog === 'function') {
        window.czuwakLog('INFO', 'LIFECYCLE', 'Aplikacja powróciła na pierwszy plan (' + source + ')');
    }
    if (typeof window.syncPendingWidgetEvents === 'function') {
        window.syncPendingWidgetEvents();
    }
    // Przeładuj log rzeczywistych czasów z pamięci trwałej (ochrona przed utratą po wyjściu z aplikacji)
    loadStationActualLog();
    if (typeof window.syncDutyPlanHomeCardUI === 'function') {
        window.syncDutyPlanHomeCardUI();
    }
    if (window._currentTrainObject && window._currentTrainObject.stacje) {
        const stationsArr = Array.isArray(window._currentTrainObject.stacje)
            ? window._currentTrainObject.stacje
            : Object.values(window._currentTrainObject.stacje);
        for (let k = 0; k < stationsArr.length; k++) {
            window.renderStationRowActualUI(k);
        }
    }
    if (!window._crewDutyCompleted && document.querySelector('.train-route-table')) {
        const hasFreshGpsWatch = (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) &&
                                 (now - (window._lastValidGpsTimestamp || 0) < 5000);
        if (!hasFreshGpsWatch) {
            window.locateTrainByGPS(true);
        }
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handleAppForegroundResume('visibilitychange');
    }
});

// Obsługa natywnego wznowienia na urządzeniach Android / Capacitor
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    try {
        window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
            if (state && state.isActive) {
                handleAppForegroundResume('Capacitor.appStateChange');
            }
        });
    } catch (e) {}
}

// ==========================================
// START APLIKACJI (BOOTLOADER)
// ==========================================
function bootApplication() {
    window.syncAlertConfigUI();
    if (typeof window.syncLogFolderUI === 'function') {
        window.syncLogFolderUI();
    }
    if (typeof window.syncPendingWidgetEvents === 'function') {
        window.syncPendingWidgetEvents();
    }
    window.syncTrainDateButtonsUI();

    ['trainInput', 'trainNameInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.findTrainForConfiguration();
                }
            });
        }
    });

    let forceDbUpdate = false;
    if (localStorage.getItem('FORCE_DB_UPDATE') === 'true') {
        forceDbUpdate = true;
        localStorage.removeItem('FORCE_DB_UPDATE');
    }

    window.pobierzDane('all', forceDbUpdate)
        .then(() => window.checkDbVersion())
        .catch(err => console.error("Błąd inicjalizacji danych na starcie:", err));
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

bootApplication();
