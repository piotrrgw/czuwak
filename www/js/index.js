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
        themeIcon.innerText = theme === 'dark' ? 'light_mode' : 'dark_mode';
    }
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#2563eb');
    }
}

window.resetThemeToAuto = function() {
    localStorage.removeItem('CZUWAK_THEME_PREFERENCE');
    const sysTheme = getSystemTheme();
    syncThemeUI(sysTheme);
    alert('Przywrócono motyw automatyczny (' + (sysTheme === 'dark' ? 'Tryb Ciemny' : 'Tryb Jasny') + '), zgodny z systemem Twojego urządzenia.');
};

if (themeToggle && themeIcon) {
    let savedPref = localStorage.getItem('CZUWAK_THEME_PREFERENCE');
    let effectiveTheme = (savedPref === 'dark' || savedPref === 'light') ? savedPref : getSystemTheme();
    syncThemeUI(effectiveTheme);

    themeToggle.addEventListener('click', () => {
        const themeNow = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = themeNow === 'dark' ? 'light' : 'dark';
        localStorage.setItem('CZUWAK_THEME_PREFERENCE', newTheme);
        syncThemeUI(newTheme);
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
const APPROACH_ALERT_DISTANCE_KM = 6.0;

let bazaPociagow = [];
window._cachedStationList = [];
let currentMode = 'train';
let currentTrainMode = 'number';

window.lastSearchedTrainNum = '';
window.lastSearchedTrainName = '';
window.activeTrackingMode = null;

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
// AKUSTYCZNY GONG PKP I ALARM ZBLIŻANIA (6 KM)
// ==========================================
window._akbAudioCtx = null;

window.isStationApproachAlertsEnabled = () => {
    return localStorage.getItem('CZUWAK_STATION_ALERTS_ENABLED') !== 'false';
};

window.toggleStationApproachAlerts = () => {
    const currentState = window.isStationApproachAlertsEnabled();
    const newState = !currentState;
    localStorage.setItem('CZUWAK_STATION_ALERTS_ENABLED', newState ? 'true' : 'false');
    window.updateStationAlertsMenuButton();
    if (!newState) {
        window.dismissStationApproachToast();
    }
};

window.updateStationAlertsMenuButton = () => {
    const btn = document.getElementById('btnToggleStationAlerts');
    if (!btn) return;
    const isEnabled = window.isStationApproachAlertsEnabled();
    if (isEnabled) {
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--open); font-size:1.15rem;"\x3Enotifications_active\x3C/span\x3E Alarm stacyjny (6 km): WŁĄCZONY';
    } else {
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined" style="color:var(--text-muted); font-size:1.15rem;"\x3Enotifications_off\x3C/span\x3E Alarm stacyjny (6 km): WYŁĄCZONY';
    }
};

// Autentyczny dwukrotny gong kolejowy PKP (Bim-Bam... Bim-Bam) - 100% głośności cyfrowej
window.playStationChime = () => {
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
    } catch (e) {
        console.warn('Błąd odtwarzania sygnału audio:', e);
    }
};

window.dismissStationApproachToast = () => {
    const toast = document.getElementById('stationApproachToast');
    if (toast) {
        toast.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => { if (toast && toast.parentNode) toast.remove(); }, 350);
    }
};

window.updateStationApproachToast = (stationName, distanceKm) => {
    const toast = document.getElementById('stationApproachToast');
    if (!toast) return;
    const nameEl = document.getElementById('stationApproachToastName');
    if (nameEl) nameEl.textContent = stationName;
    const distEl = document.getElementById('stationApproachToastDist');
    if (distEl) {
        distEl.innerHTML = 'Pozostało ok. \x3Cstrong style="color:#38bdf8; font-size:1.05rem;"\x3E' + distanceKm.toFixed(1) + ' km\x3C/strong\x3E. Wygłoś komunikat pożegnalny.';
    }
};

async function fireNativeOrWebNotification(notifTitle, notifBody, alertKey) {
    // 1. Natywne powiadomienie Capacitor (APK Android)
    try {
        const LocalNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
        if (LocalNotifications) {
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== 'granted') {
                await LocalNotifications.requestPermissions();
            }
            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: notifTitle,
                        body: notifBody,
                        id: Math.abs(alertKey.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 100000 || 1001,
                        schedule: { at: new Date(Date.now() + 100) }
                    }
                ]
            });
            return;
        }
    } catch (e) {
        console.warn('Błąd powiadomienia Capacitor:', e);
    }

    // 2. Fallback Web Notification / Service Worker
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
window.triggerStationApproachAlert = (stationName, distanceKm, forceTest = false) => {
    if (!forceTest && !window.isStationApproachAlertsEnabled()) return;

    const trainNum = window._currentActiveTrainNumber || window.lastSearchedTrainNum || 'TRAIN';
    const alertKey = forceTest ? ('TEST_' + Date.now()) : (trainNum + '_' + String(stationName).toUpperCase().trim());

    if (!forceTest && window._stationApproachAlertsFired.has(alertKey)) {
        window.updateStationApproachToast(stationName, distanceKm);
        return;
    }
    if (!forceTest) {
        window._stationApproachAlertsFired.add(alertKey);
    }

    // 1. Akustyczny podwójny gong stacyjny (Bim-Bam Bim-Bam)
    window.playStationChime();

    // 2. Zsynchronizowana wibracja urządzenia
    if ('vibrate' in navigator) {
        try { navigator.vibrate([200, 100, 200, 350, 200, 100, 200]); } catch (e) {}
    }

    // 3. Pływający baner wizualny z dynamicznym odliczaniem kilometrów
    let toast = document.getElementById('stationApproachToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stationApproachToast';
        toast.className = 'glass-panel';
        toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:99999; max-width:92%; width:440px; padding:12px 16px; border-radius:12px; background:rgba(15, 23, 42, 0.96); border:1.5px solid var(--primary); box-shadow:0 10px 25px -5px rgba(0,0,0,0.6), 0 0 20px rgba(2, 132, 199, 0.45); display:flex; align-items:center; gap:12px; animation: slideDownToast 0.35s ease-out;';
        document.body.appendChild(toast);
    }
    toast.innerHTML =
        '\x3Cdiv style="width:40px; height:40px; border-radius:50%; background:rgba(2, 132, 199, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1px solid var(--primary);"\x3E' +
            '\x3Cspan class="material-symbols-outlined" style="color:var(--primary); font-size:1.6rem; animation:train-pulse 1.5s infinite;"\x3Enotification_important\x3C/span\x3E' +
        '\x3C/div\x3E' +
        '\x3Cdiv style="flex:1; min-width:0;"\x3E' +
            '\x3Cdiv style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--primary); font-weight:800; display:flex; align-items:center; gap:6px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined icon-sm" style="font-size:0.9rem;"\x3Etrip_origin\x3C/span\x3E Zbliżasz się do stacji' +
            '\x3C/div\x3E' +
            '\x3Cdiv id="stationApproachToastName" style="font-size:1.1rem; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"\x3E' + escapeHTML(stationName) + '\x3C/div\x3E' +
            '\x3Cdiv id="stationApproachToastDist" style="font-size:0.82rem; color:#94a3b8; margin-top:2px;"\x3E' +
                'Pozostało ok. \x3Cstrong style="color:#38bdf8; font-size:1.05rem;"\x3E' + distanceKm.toFixed(1) + ' km\x3C/strong\x3E. Wygłoś komunikat pożegnalny.' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E' +
        '\x3Cbutton onclick="window.dismissStationApproachToast()" aria-label="Zamknij powiadomienie" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#cbd5e1; cursor:pointer; padding:6px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;"\x3E' +
            '\x3Cspan class="material-symbols-outlined icon-sm"\x3Eclose\x3C/span\x3E' +
        '\x3C/button\x3E';

    // 4. Powiadomienie systemowe Android / PWA
    const notifTitle = 'Zbliżasz się do stacji: ' + stationName;
    const notifBody = 'Pozostało ok. ' + distanceKm.toFixed(1) + ' km. Wygłoś komunikat pożegnalny.';
    fireNativeOrWebNotification(notifTitle, notifBody, alertKey);
};

window.testStationAlert = () => {
    const menuEl = document.getElementById('menuOverlay');
    if (menuEl) menuEl.classList.remove('active');
    window.triggerStationApproachAlert('WARSZAWA CENTRALNA (TEST)', 6.0, true);
};

window.stopTrainTracking = () => {
    window.activeTrackingMode = null;
    window.releaseWakeLock();
    if (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) {
        try { navigator.geolocation.clearWatch(window._trainGpsWatchId); } catch (e) {}
        window._trainGpsWatchId = null;
    }
    if (window._trainGpsPollInterval) {
        clearInterval(window._trainGpsPollInterval);
        window._trainGpsPollInterval = null;
    }
    const gpsBtn = document.getElementById('fabGpsBtn');
    if (gpsBtn) {
        gpsBtn.classList.remove('fab-active');
        gpsBtn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Emy_location\x3C/span\x3E';
    }
    const timeBtn = document.getElementById('fabTimeBtn');
    if (timeBtn) {
        timeBtn.classList.remove('fab-active');
        timeBtn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Eschedule\x3C/span\x3E';
    }
    document.querySelectorAll('.gps-distance-indicator').forEach(el => el.remove());
    if (typeof window.dismissStationApproachToast === 'function') window.dismissStationApproachToast();
};

// ==========================================
// OBSŁUGA SIECI I FORMATOWANIA DAT
// ==========================================
window.addEventListener('online', () => {
    const netMsg = document.getElementById('networkStatus');
    if (netMsg && netMsg.className === "msg-offline") {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecloud_done\x3C/span\x3E Połączenie przywrócone';
        netMsg.className = "msg-online";
    }
});

window.addEventListener('offline', () => {
    const netMsg = document.getElementById('networkStatus');
    if (netMsg) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ewifi_off\x3C/span\x3E Tryb Offline';
        netMsg.className = "msg-offline";
    }
});

function formatPlDate(input) {
    if (!input) return '';
    if (input instanceof Date) {
        if (isNaN(input.getTime())) return '';
        return String(input.getDate()).padStart(2, '0') + '.' +
               String(input.getMonth() + 1).padStart(2, '0') + '.' +
               input.getFullYear();
    }
    if (typeof input === 'number' && input > 0) {
        return formatPlDate(new Date(input));
    }
    const s = String(input).trim();
    if (!s || s === 'Brak danych' || s === 'Brak') return s;
    const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mIso) {
        return mIso[3].padStart(2, '0') + '.' + mIso[2].padStart(2, '0') + '.' + mIso[1];
    }
    const mPl = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (mPl) {
        return mPl[1].padStart(2, '0') + '.' + mPl[2].padStart(2, '0') + '.' + mPl[3];
    }
    return s;
}

function formatPlDateTime(input) {
    if (!input) return '';
    if (input instanceof Date) {
        if (isNaN(input.getTime())) return '';
        return String(input.getDate()).padStart(2, '0') + '.' +
               String(input.getMonth() + 1).padStart(2, '0') + '.' +
               input.getFullYear() + ' ' +
               String(input.getHours()).padStart(2, '0') + ':' +
               String(input.getMinutes()).padStart(2, '0') + ':' +
               String(input.getSeconds()).padStart(2, '0');
    }
    if (typeof input === 'number' && input > 0) {
        return formatPlDateTime(new Date(input));
    }
    const s = String(input).trim();
    if (!s || s === 'Brak' || s === 'Brak danych') return s;
    const parsed = Number(s);
    if (!isNaN(parsed) && parsed > 1000000000) {
        return formatPlDateTime(new Date(parsed));
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        return formatPlDateTime(d);
    }
    return s;
}

function getLocalYYYYMMDD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseYYYYMMDDToDate(dateStr, fallbackDate) {
    if (!dateStr || typeof dateStr !== 'string') return new Date(fallbackDate.getTime());
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return new Date(fallbackDate.getTime());
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

// ==========================================
// ZEGAR I ŚWIĘTA
// ==========================================
let _cachedHolidaysJson = null;
let _cachedHolidaysList = null;

function sprawdzSwieto(targetDate) {
    const d = (targetDate instanceof Date) ? targetDate : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    const targetMMDD = m + "-" + day;
    const targetYYYYMMDD = y + "-" + m + "-" + day;

    try {
        const holidaysJson = localStorage.getItem('CZUWAK_HOLIDAYS');
        if (holidaysJson) {
            if (holidaysJson !== _cachedHolidaysJson) {
                _cachedHolidaysJson = holidaysJson;
                _cachedHolidaysList = JSON.parse(holidaysJson);
            }
            if (Array.isArray(_cachedHolidaysList)) {
                const found = _cachedHolidaysList.find(h => h && (h.date === targetMMDD || h.date === targetYYYYMMDD));
                if (found) return found.name;
            }
        }
    } catch (e) {}
    return null;
}

window.initZegar = function() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const d = new Date();
    let dateStr = d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const timeStr = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const swieto = sprawdzSwieto(d);

    const bar = document.getElementById('dateBar');
    if (bar) {
        let html = '\x3Cdiv class="date-text"\x3E' + escapeHTML(dateStr) + '\x3C/div\x3E' +
            '\x3Cdiv class="time-display"\x3E\x3Cspan class="material-symbols-outlined icon-sm"\x3Eschedule\x3C/span\x3E ' + escapeHTML(timeStr) + '\x3C/div\x3E';
        if (swieto) {
            html += '\x3Cdiv class="holiday-tag"\x3E\x3Cspan class="material-symbols-outlined icon-sm"\x3Estar\x3C/span\x3E ' + escapeHTML(swieto) + '\x3C/div\x3E';
            bar.style.borderColor = "var(--holiday)";
        } else {
            bar.style.borderColor = "var(--glass-border)";
        }
        bar.innerHTML = html;
    }
};

setInterval(window.initZegar, 1000);
window.initZegar();

// ==========================================
// MENU, STATYSTYKI I WERSJONOWANIE (LOUD PUBLISH DLA STACJI, 24-48H DLA POCIĄGÓW)
// ==========================================
window.changeFontSize = (step) => {
    let currentSize = parseInt(localStorage.getItem('fontSize') || '16', 10);
    let newSize = currentSize + step;
    if (newSize >= 12 && newSize <= 24) {
        document.documentElement.style.fontSize = newSize + 'px';
        localStorage.setItem('fontSize', newSize);
    }
};
(function initSavedFontSize() {
    const saved = parseInt(localStorage.getItem('fontSize') || '16', 10);
    if (saved >= 12 && saved <= 24) {
        document.documentElement.style.fontSize = saved + 'px';
    }
})();

window.toggleMenu = () => {
    window.updateStats();
    document.getElementById('menuOverlay').classList.toggle('active');
};

window.updateStats = () => {
    window.updateStationAlertsMenuButton();

    const lastStationsTs = parseInt(localStorage.getItem('STATIONS_SYNC_TIMESTAMP') || '0', 10);
    const elStationsSync = document.getElementById('stat_stations_sync');
    if (elStationsSync) {
        elStationsSync.innerText = lastStationsTs > 0 ? formatPlDateTime(lastStationsTs) : 'Brak';
        elStationsSync.style.color = lastStationsTs > 0 ? '' : 'var(--danger)';
    }

    const lastTrainsSyncStr = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    let trainsTtlStr = localStorage.getItem('TRAINS_SYNC_TTL');
    if (lastTrainsSyncStr && !trainsTtlStr) {
        const minH = parseInt(localStorage.getItem('CZUWAK_CFG_TRAINS_MIN') || '24', 10);
        const maxH = parseInt(localStorage.getItem('CZUWAK_CFG_TRAINS_MAX') || '48', 10);
        const randomTTL = (Math.floor(Math.random() * (maxH - minH + 1)) + minH) * 60 * 60 * 1000;
        localStorage.setItem('TRAINS_SYNC_TTL', randomTTL.toString());
        trainsTtlStr = randomTTL.toString();
    }

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
const DEFAULT_APK_DOWNLOAD_URL = 'https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk';
const REMOTE_ENV_JS_URL = 'https://raw.githubusercontent.com/piotrrgw/czuwak/main/www/env.js';
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
    const targetUrl = window._latestApkDownloadUrl || DEFAULT_APK_DOWNLOAD_URL;
    const verInfo = window._latestDetectedVersionLabel ? (' (' + window._latestDetectedVersionLabel + ')') : '';
    const msg = 'Za chwilę rozpocznie się pobieranie pliku instalacyjnego czuwak.apk' + verInfo + '.\n\nPo pobraniu otwórz plik i kliknij "Aktualizuj" (wszystkie zapisane bazy pociągów i ustawienia zostaną zachowane).';
    if (confirm(msg)) {
        try {
            const link = document.createElement('a');
            link.href = targetUrl;
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
                'Kliknij poniższy przycisk, aby pobrać nowy plik instalacyjny \x3Cstrong\x3Eczuwak.apk\x3C/strong\x3E i zainstalować nakładkę aktualizacyjną.' +
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
        // 1. Sprawdzenie ewentualnych pól w Firestore (system/db_status)
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

        // 2. Sprawdzenie pliku env.js z repozytorium GitHub (automatycznie po każdym pushu i wydaniu GitHub Actions)
        if (!foundNewer) {
            const resp = await fetch(REMOTE_ENV_JS_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (resp.ok) {
                const envText = await resp.text();
                const verMatch = envText.match(/APP_VERSION\s*=\s*"([^"]+)"/);
                const buildMatch = envText.match(/APP_BUILD\s*=\s*"([^"]+)"/);
                const remoteVer = verMatch ? verMatch[1] : null;
                const remoteBuild = buildMatch ? buildMatch[1] : null;
                if (remoteVer) {
                    const remoteScore = parseVersionScore(remoteVer, remoteBuild || '001');
                    if (remoteScore > currentScore) {
                        foundNewer = true;
                        detectedLabel = remoteVer + (remoteBuild ? (' (' + remoteBuild + ')') : '');
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
            alert('Nie udało się sprawdzić aktualizacji APK (brak połączenia z siecią lub repozytorium jeszcze nie zostało opublikowane).');
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

            // Sprawdzenie aktualizacji samego pliku .apk (Firestore + GitHub Releases)
            window.checkAppUpdate(false, data);

            // Zachowujemy zakres TTL dla pociągów (domyślnie 24-48h zgodnie z założeniem Czuwaka)
            if (data.holidays) {
                localStorage.setItem('CZUWAK_HOLIDAYS', JSON.stringify(data.holidays));
            }

            // STACJE (stations_dict): Pobierane wyłącznie wtedy, gdy brak w pamięci lub opublikowano GŁOŚNO (lastUpdateStations)
            // Ignorujemy lastSilentUpdateStations!
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

    // Stacje nie wygasają czasowo same z siebie - reagują na publikację LOUD (lastUpdateStations)
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
// POBIERANIE DANYCH (pociagi_ic co 24-48h + stations_dict przy LOUD)
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

    // 1. Wczytanie słownika stacji z pamięci podręcznej (stations_dict NIE wygasa czasowo - tylko publikacja LOUD lub brak w pamięci)
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

    // 2. Wczytanie rozkładu pociągów z pamięci podręcznej (TTL 24-48h)
    let cachedTrains = await localforage.getItem(TRAINS_KEY);
    if (typeof cachedTrains === 'string') {
        try { cachedTrains = JSON.parse(cachedTrains); } catch (e) {}
    }
    let needTrainsUpdate = true;
    const lastTrainsSyncStr = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    let trainsTtlStr = localStorage.getItem('TRAINS_SYNC_TTL');

    if (!trainsTtlStr) {
        // Losowe okno 24-48h
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

    // Szybkie wyjście jeśli dane są w cache i są ważne
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

    // -> POBIERANIE SŁOWNIKA STACJI GPS (akb-data -> public_data/stations_dict)
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
            renderPct(willDownloadTrains ? 50 : 95);
        } catch (e) {
            console.error("Błąd pobierania stacji GPS:", e);
            errors.push("Słownik Stacji (akb-data): " + e.message);
            stationsDownloadFailed = true;
        }
    }

    // -> POBIERANIE POCIĄGÓW (trasy-ic -> pociagi_ic/bucket_*)
    if (willDownloadTrains) {
        try {
            netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined spin icon-sm"\x3Esync\x3C/span\x3E Pobieram paczki tras IC...';
            window.updateBgSyncBannerStage('Aktualizacja w tle: Pobieram rozkłady pociągów...');
            renderPct(60);

            let loadedTrains = [];
            const trSnap = await getDocs(collection(trainsDb, 'pociagi_ic'));
            renderPct(88);

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
                throw new Error("Pobrano 0 pociągów z bazy trasy-ic.");
            }

            bazaPociagow = loadedTrains;
            await localforage.setItem(TRAINS_KEY, loadedTrains);

            const exactNowTrains = window.pendingServerVersionTrains || Date.now();
            window.pendingServerVersionTrains = null;
            localStorage.setItem('TRAINS_SYNC_TIMESTAMP', exactNowTrains.toString());

            // Ustaw nowy losowy TTL 24-48h
            const newTrainsTtl = (Math.floor(Math.random() * (48 - 24 + 1)) + 24) * 60 * 60 * 1000;
            localStorage.setItem('TRAINS_SYNC_TTL', newTrainsTtl.toString());
            renderPct(98);
        } catch (e) {
            console.error("Błąd pobierania pociągów:", e);
            errors.push("Baza Pociągów (trasy-ic): " + e.message);
            trainsDownloadFailed = true;
            if (Array.isArray(cachedTrains) && cachedTrains.length > 0) {
                bazaPociagow = cachedTrains;
            }
        }
    }

    renderPct(100);
    if (btnMinimizeSync) btnMinimizeSync.style.display = 'none';

    if (willDownloadTrains) {
        window.partialSyncTrainsFailed = trainsDownloadFailed;
    }

    const lastTrTs = localStorage.getItem('TRAINS_SYNC_TIMESTAMP');
    const syncDateDisp = lastTrTs ? formatPlDateTime(parseInt(lastTrTs, 10)) : 'Brak daty';

    if (errors.length > 0) {
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ewifi_off\x3C/span\x3E Tryb Offline / Ograniczony';
        netMsg.className = "msg-offline";
        syncMsg.innerHTML = "Pociągi z cache: " + syncDateDisp;

        if (force && !window._isSyncMinimized) {
            alert("Informacja serwisowa / Błędy sieci:\n\n" + errors.join("\n") + "\n\nAplikacja pracuje w oparciu o pamięć podręczną telefonu.");
        }
    } else {
        window.partialSyncTrainsFailed = false;
        netMsg.innerHTML = '\x3Cspan class="material-symbols-outlined icon-sm"\x3Ecloud_done\x3C/span\x3E Zsynchronizowano';
        netMsg.className = "msg-online";
        syncMsg.innerHTML = "Pociągi pobrane: " + syncDateDisp;
    }

    if (loader) {
        setTimeout(() => { loader.style.display = 'none'; }, 350);
    }
    if (bgBannerInit) {
        setTimeout(() => { bgBannerInit.style.display = 'none'; }, 1200);
    }
    if (progressContainer) progressContainer.style.display = 'none';

    if (btnRefreshAll) { btnRefreshAll.disabled = false; btnRefreshAll.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Ecloud_sync\x3C/span\x3E Synchronizuj wszystko'; }
    if (btnRefreshStacje) { btnRefreshStacje.disabled = false; btnRefreshStacje.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Emap\x3C/span\x3E Odśwież słownik stacji GPS'; }
    if (btnRefreshPociagi) { btnRefreshPociagi.disabled = false; btnRefreshPociagi.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Etrain\x3C/span\x3E Odśwież rozkłady pociągów'; }

    zbudujListePociagow();
    window.updateStats();
    if (!window.stateRestored) {
        window.restoreLastState();
        window.stateRestored = true;
    } else {
        window.triggerSearch();
    }
    window.hideGlobalProgress();
};

// ==========================================
// NAWIGACJA ZAKŁADEK I HISTORIA OSTATNICH POCIĄGÓW
// ==========================================
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
    document.getElementById('subTabTrainNumber').classList.toggle('active', mode === 'number');
    document.getElementById('subTabTrainName').classList.toggle('active', mode === 'name');

    document.getElementById('trainNumberContainer').style.display = mode === 'number' ? 'block' : 'none';
    document.getElementById('trainNameContainer').style.display = mode === 'name' ? 'block' : 'none';

    window.triggerSearch();
};

window.addRecentTrain = (trainObj) => {
    if (!trainObj || !trainObj.numer) return;
    const cleanNum = String(trainObj.numer).trim();
    if (!cleanNum) return;
    try {
        let list = JSON.parse(localStorage.getItem(RECENT_TRAINS_KEY) || '[]');
        if (!Array.isArray(list)) list = [];
        list = list.filter(item => item && String(item.numer).trim() !== cleanNum);
        list.unshift({
            numer: cleanNum,
            nazwa: trainObj.nazwa || '',
            relacja: trainObj.relacja || ''
        });
        if (list.length > MAX_RECENT_ITEMS) list = list.slice(0, MAX_RECENT_ITEMS);
        localStorage.setItem(RECENT_TRAINS_KEY, JSON.stringify(list));
    } catch (e) {}
};

window.clearRecentHistory = () => {
    localStorage.removeItem(RECENT_TRAINS_KEY);
    window.renderRecentView();
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
    window.switchMode('train');
    window.switchTrainMode('number');
    document.getElementById('trainInput').value = numerPociagu;
    window.lastSearchedTrainNum = numerPociagu;
    window.forceExactTrainMatch = true;

    window.triggerSearch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.clearSearch = (inputId) => {
    const el = document.getElementById(inputId);
    if (el) el.value = '';

    window.stopTrainTracking();
    window.forceExactTrainMatch = false;

    document.getElementById('detailsList').innerHTML = '';
    document.getElementById('detailsList').style.display = 'none';
    document.getElementById('mainStatusBox').style.display = 'none';

    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'none';

    window.triggerSearch();
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

    localStorage.setItem('CZUWAK_LAST_TRAIN_NUM', currentTrainInput);
    localStorage.setItem('CZUWAK_LAST_TRAIN_NAME', currentTrainName);

    if (searchTimeout) clearTimeout(searchTimeout);
    document.getElementById('mainStatusBox').style.display = 'none';
    document.getElementById('detailsList').style.display = 'none';
    document.getElementById('skeletonLoader').style.display = 'block';

    searchTimeout = setTimeout(() => {
        if (document.getElementById('skeletonLoader')) document.getElementById('skeletonLoader').style.display = 'none';
        try {
            wyswietlWidok();
        } catch (e) {
            console.error("Błąd renderowania widoku:", e);
            document.getElementById('detailsList').innerHTML = '\x3Cdiv style="color:var(--danger); padding:20px; text-align:center;"\x3EBłąd wyświetlania: ' + escapeHTML(e.message) + '\x3C/div\x3E';
            document.getElementById('detailsList').style.display = 'block';
        }
    }, 250);
};

window.restoreLastState = () => {
    const lastTrNum = localStorage.getItem('CZUWAK_LAST_TRAIN_NUM') || '';
    const lastTrName = localStorage.getItem('CZUWAK_LAST_TRAIN_NAME') || '';

    document.getElementById('trainInput').value = lastTrNum;
    document.getElementById('trainNameInput').value = lastTrName;

    const lastMode = localStorage.getItem('CZUWAK_LAST_MODE') || 'train';
    const lastTrMode = localStorage.getItem('CZUWAK_LAST_TRAIN_MODE') || 'number';

    window.switchTrainMode(lastTrMode);
    window.switchMode(lastMode);
};

window.hardReinstall = async () => {
    if (confirm("Czy na pewno chcesz wyczyścić zapisane bazy w pamięci telefonu i pobrać je od nowa?")) {
        const userThemePref = localStorage.getItem('CZUWAK_THEME_PREFERENCE');
        const userFontSize = localStorage.getItem('fontSize');
        const recentTrains = localStorage.getItem(RECENT_TRAINS_KEY);

        localStorage.clear();
        await localforage.clear();

        if (userThemePref) localStorage.setItem('CZUWAK_THEME_PREFERENCE', userThemePref);
        if (userFontSize) localStorage.setItem('fontSize', userFontSize);
        if (recentTrains) localStorage.setItem(RECENT_TRAINS_KEY, recentTrains);

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
// HARMONOGRAM I WYBÓR WARIANTU DATY POCIĄGU
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

function formatOriginRunLabel(originDateStr, daysAgo) {
    const plOrigin = formatPlDate(originDateStr) || originDateStr;
    if (!daysAgo || daysAgo <= 0) return plOrigin;
    if (daysAgo === 1) {
        return plOrigin + ' (w trasie z wczoraj – dzień 2)';
    }
    return plOrigin + ' (w trasie – dzień ' + (daysAgo + 1) + ', start ' + daysAgo + ' dni temu)';
}

function scoreTrainVariant(train, now) {
    let str = train.data || train.daty_kursowania || train.terminy_kursowania || "";
    let isoMatches = String(str).match(/\d{4}-\d{2}-\d{2}/g) || [];
    let plMatches = (String(str).match(/\d{1,2}\.\d{1,2}\.\d{4}/g) || []).map(dStr => {
        const p = dStr.split('.');
        return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
    });
    let dates = Array.from(new Set([...isoMatches, ...plMatches]));
    const todayStr = getLocalYYYYMMDD(now);
    const todayPlStr = formatPlDate(todayStr);
    const tNow = now.getHours() * 60 + now.getMinutes();
    const stacjeArray = Array.isArray(train.stacje) ? train.stacje : Object.values(train.stacje || {});

    const absStacje = computeTrainAbsSchedule(stacjeArray);
    const startT = absStacje.length > 0 ? (absStacje[0].dep !== null ? absStacje[0].dep : (absStacje[0].arr || 0)) : 0;
    const endT = absStacje.length > 0 ? (absStacje[absStacje.length - 1].arr !== null ? absStacje[absStacje.length - 1].arr : (absStacje[absStacje.length - 1].dep || startT)) : 0;
    const maxDays = Math.floor(endT / 1440);

    if (maxDays >= 1) {
        for (let d = maxDays; d >= 1; d--) {
            const relNow = tNow + d * 1440;
            if (relNow >= startT && relNow <= endT) {
                const originDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
                const originDateStr = getLocalYYYYMMDD(originDateObj);
                const label = formatOriginRunLabel(originDateStr, d);
                if (dates.length === 0) {
                    return { score: 0.9 + d * 0.01, relNow: relNow, date: label, originDateObj: originDateObj, daysAgo: d };
                }
                if (dates.includes(originDateStr)) {
                    return { score: 0.05 + d * 0.001, relNow: relNow, date: label, originDateObj: originDateObj, daysAgo: d };
                }
                if (dates.includes(todayStr)) {
                    return { score: 0.1 + d * 0.001, relNow: relNow, date: label, originDateObj: originDateObj, daysAgo: d };
                }
            }
        }
    }

    const todayDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const originStartT = Math.max(0, startT - 10);

    if (dates.length === 0) {
        if (tNow >= originStartT && tNow <= endT) return { score: 1, relNow: tNow, date: todayPlStr, originDateObj: todayDateObj, daysAgo: 0 };
        return { score: 2, relNow: tNow, date: todayPlStr, originDateObj: todayDateObj, daysAgo: 0 };
    }
    if (dates.includes(todayStr)) {
        if (tNow >= originStartT && tNow <= endT) return { score: 0.2, relNow: tNow, date: todayPlStr, originDateObj: todayDateObj, daysAgo: 0 };
        if (tNow < originStartT) return { score: 1.0, relNow: tNow, date: todayPlStr, originDateObj: todayDateObj, daysAgo: 0 };
        if (tNow > endT) return { score: 2.0, relNow: tNow, date: todayPlStr, originDateObj: todayDateObj, daysAgo: 0 };
    }

    if (maxDays >= 1) {
        for (let d = maxDays; d >= 1; d--) {
            const relNow = tNow + d * 1440;
            if (relNow >= startT && relNow <= endT) {
                const originDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
                const originDateStr = getLocalYYYYMMDD(originDateObj);
                return { score: 3.0 + d * 0.01, relNow: relNow, date: formatOriginRunLabel(originDateStr, d), originDateObj: originDateObj, daysAgo: d };
            }
        }
    }

    let closestFuture = Infinity; let bestFutureDate = null;
    dates.forEach(d => {
        if (d > todayStr) {
            let diff = parseYYYYMMDDToDate(d, todayDateObj).getTime() - todayDateObj.getTime();
            if (diff < closestFuture) { closestFuture = diff; bestFutureDate = d; }
        }
    });
    if (bestFutureDate) {
        return { score: 10 + closestFuture / (1000 * 3600 * 24), relNow: tNow, date: formatPlDate(bestFutureDate), originDateObj: parseYYYYMMDDToDate(bestFutureDate, todayDateObj), daysAgo: 0 };
    }
    let closestPast = Infinity; let bestPastDate = null;
    dates.forEach(d => {
        if (d < todayStr) {
            let diff = todayDateObj.getTime() - parseYYYYMMDDToDate(d, todayDateObj).getTime();
            if (diff < closestPast) { closestPast = diff; bestPastDate = d; }
        }
    });
    if (bestPastDate) {
        return { score: 10000 + closestPast / (1000 * 3600 * 24), relNow: tNow, date: formatPlDate(bestPastDate), originDateObj: parseYYYYMMDDToDate(bestPastDate, todayDateObj), daysAgo: 0 };
    }
    return { score: 99999, relNow: tNow, date: null, originDateObj: todayDateObj, daysAgo: 0 };
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
// RENDEROWANIE WIDOKU TRASY POCIĄGU (STACJA | PRZYJAZD | ODJAZD)
// ==========================================
function wyswietlWidok() {
    const listContainer = document.getElementById('detailsList');
    const mainBox = document.getElementById('mainStatusBox');
    listContainer.innerHTML = '';

    if (currentMode !== 'train') return;

    let pociagi = [];
    if (currentTrainMode === 'number') {
        const nrPociaguRaw = String(document.getElementById('trainInput').value || '').trim();
        const nrPociagu = nrPociaguRaw.includes(' | ') ? nrPociaguRaw.split(' | ')[0].trim() : nrPociaguRaw;

        if (!nrPociagu || nrPociagu.length < 2) {
            window.stopTrainTracking();
            const fabContainer = document.getElementById('trainFabContainer');
            if (fabContainer) fabContainer.style.display = 'none';
            return;
        }

        if (window.forceExactTrainMatch) {
            pociagi = (bazaPociagow || []).filter(p => String(p.numer) === nrPociagu);
        } else {
            const lastChar = nrPociagu.slice(-1);
            let altNumer = nrPociagu;
            if (!isNaN(lastChar)) {
                const lastDigit = parseInt(lastChar, 10);
                const altDigit = lastDigit % 2 === 0 ? lastDigit + 1 : lastDigit - 1;
                altNumer = nrPociagu.slice(0, -1) + altDigit;
            }
            pociagi = (bazaPociagow || []).filter(p => String(p.numer) === nrPociagu || String(p.numer) === altNumer);
        }

        if (pociagi.length === 0) {
            window.stopTrainTracking();
            const fabContainer = document.getElementById('trainFabContainer');
            if (fabContainer) fabContainer.style.display = 'none';
            listContainer.innerHTML = '\x3Cp style="text-align:center; color:var(--text-muted); padding: 20px;"\x3EBrak pociągu o numerze ' + escapeHTML(nrPociagu) + ' w bazie.\x3C/p\x3E';
            listContainer.style.display = 'block';
            return;
        }
    } else {
        const nazwaPociagu = String(document.getElementById('trainNameInput').value || '').trim();
        if (!nazwaPociagu || nazwaPociagu.length < 3) {
            window.stopTrainTracking();
            const fabContainer = document.getElementById('trainFabContainer');
            if (fabContainer) fabContainer.style.display = 'none';
            return;
        }

        pociagi = (bazaPociagow || []).filter(p => p.nazwa && String(p.nazwa).toUpperCase() === nazwaPociagu.toUpperCase());
        if (pociagi.length === 0) {
            window.stopTrainTracking();
            const fabContainer = document.getElementById('trainFabContainer');
            if (fabContainer) fabContainer.style.display = 'none';
            listContainer.innerHTML = '\x3Cp style="text-align:center; color:var(--text-muted); padding: 20px;"\x3EBrak pociągu o nazwie "' + escapeHTML(nazwaPociagu) + '" w bazie.\x3C/p\x3E';
            listContainer.style.display = 'block';
            return;
        }
    }

    const uniqueNumbers = [...new Set(pociagi.map(p => String(p.numer)))];
    const now = new Date();

    if (uniqueNumbers.length === 1) {
        const scoredTrains = pociagi.map(p => ({ pociag: p, ...scoreTrainVariant(p, now) }));
        scoredTrains.sort((a, b) => a.score - b.score);
        const bestMatch = scoredTrains[0];
        generujWidokTrasy(bestMatch.pociag, listContainer, mainBox, bestMatch);
    } else {
        window.stopTrainTracking();
        const fabContainer = document.getElementById('trainFabContainer');
        if (fabContainer) fabContainer.style.display = 'none';
        mainBox.style.display = 'block';
        mainBox.className = 'bg-secondary';
        mainBox.innerText = 'WYBIERZ KIERUNEK (' + uniqueNumbers.length + ')';

        let wariantyHtml = '\x3Ch3 style="color:var(--primary); margin:10px 0; font-size:1rem; text-align:center;"\x3EWybierz relację (kierunek):\x3C/h3\x3E';
        uniqueNumbers.forEach(num => {
            let variants = pociagi.filter(p => String(p.numer) === num);
            let scored = variants.map(p => ({ pociag: p, ...scoreTrainVariant(p, now) }));
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
        listContainer.innerHTML = wariantyHtml;
        listContainer.style.display = 'block';
    }
}

function generujWidokTrasy(pociag, listContainer, mainBox, bestMatch = null) {
    const fabContainer = document.getElementById('trainFabContainer');
    if (fabContainer) fabContainer.style.display = 'flex';

    if (pociag && pociag.numer) {
        window._currentActiveTrainNumber = String(pociag.numer).trim();
        if (window._stationApproachAlertsFired) window._stationApproachAlertsFired.clear();
        const stacjeArray = Array.isArray(pociag.stacje) ? pociag.stacje : Object.values(pociag.stacje || {});
        const firstSt = stacjeArray.length > 0 ? stacjeArray[0] : null;
        const lastSt = stacjeArray.length > 0 ? stacjeArray[stacjeArray.length - 1] : null;
        const pierwszaStacja = firstSt ? (typeof firstSt === 'string' ? firstSt : (firstSt.nazwa || '')) : '';
        const ostatniaStacja = lastSt ? (typeof lastSt === 'string' ? lastSt : (lastSt.nazwa || '')) : '';
        let relacjaStr = (pierwszaStacja && ostatniaStacja) ? (pierwszaStacja + ' \u2192 ' + ostatniaStacja) : '';
        window.addRecentTrain({
            numer: pociag.numer,
            nazwa: pociag.nazwa || '',
            relacja: relacjaStr
        });
    }

    const matchedDate = bestMatch && bestMatch.date ? escapeHTML(bestMatch.date) : 'Brak przypisanej daty (Domyślna)';

    let html = '\x3Cdiv class="card glass-panel" style="border-left-color: var(--primary); padding: 0;"\x3E' +
        '\x3Cdiv class="card-header" style="background: var(--primary); color: var(--primary-text);"\x3E' +
            '\x3Cdiv class="carrier-title" style="color: var(--primary-text); font-size: 1.2rem; display:flex; align-items:center; gap:6px;"\x3E' +
                '\x3Cspan class="material-symbols-outlined"\x3Eroute\x3C/span\x3E Trasa pociągu' +
            '\x3C/div\x3E' +
        '\x3C/div\x3E' +
        '\x3Cdiv style="background: var(--toggle-bg); padding: 12px 15px; font-size: 0.95rem; border-bottom: 1px solid var(--table-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;"\x3E' +
            '\x3Cdiv style="display:flex; align-items: flex-start; gap: 8px; color: var(--text);"\x3E' +
                '\x3Cspan class="material-symbols-outlined icon-sm" style="color: var(--primary); margin-top: 2px;"\x3Ecalendar_month\x3C/span\x3E ' +
                '\x3Cdiv\x3E' +
                    '\x3Cstrong style="color: var(--primary);"\x3EWybrana data kursowania:\x3C/strong\x3E \x3Cbr\x3E' +
                    '\x3Cspan style="line-height: 1.4; font-size: 1.05rem; font-weight: 600;"\x3E' + matchedDate + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
            '\x3C/div\x3E' +
            '\x3Cbutton type="button" onclick="window.locateTrainByGPS()" style="background: var(--primary); color: #fff; border: none; border-radius: 8px; padding: 10px 14px; font-weight: 700; font-size: 0.88rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);"\x3E' +
                '\x3Cspan class="material-symbols-outlined icon-sm"\x3Emy_location\x3C/span\x3E Włącz Czuwak GPS (6 km)' +
            '\x3C/button\x3E' +
        '\x3C/div\x3E' +
        '\x3Ctable class="train-route-table"\x3E' +
        '\x3Cthead\x3E' +
            '\x3Ctr\x3E' +
                '\x3Cth style="text-align: left;"\x3EStacja\x3C/th\x3E' +
                '\x3Cth\x3EPrzyjazd\x3C/th\x3E' +
                '\x3Cth\x3EOdjazd\x3C/th\x3E' +
            '\x3C/tr\x3E' +
        '\x3C/thead\x3E' +
        '\x3Ctbody\x3E';

    const stacjeArray = Array.isArray(pociag.stacje) ? pociag.stacje : Object.values(pociag.stacje || {});
    const absTimes = computeTrainAbsSchedule(stacjeArray);
    window._currentTrainBestMatch = bestMatch;

    const relNow = bestMatch ? bestMatch.relNow : null;
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
        const stacjaNazwaObj = typeof stacjaObj === 'string' ? stacjaObj : (stacjaObj && stacjaObj.nazwa ? stacjaObj.nazwa : '');
        const stacjaNazwa = String(stacjaNazwaObj).toUpperCase().trim();
        const arrStr = typeof stacjaObj === 'object' && stacjaObj !== null && stacjaObj.przyjazd ? String(stacjaObj.przyjazd) : '-';
        const depStr = typeof stacjaObj === 'object' && stacjaObj !== null && stacjaObj.odjazd ? String(stacjaObj.odjazd) : '-';

        let rowClass = (idx === activeStationIndex) ? 'active-station-row station-with-train' : '';

        const stAbs = absTimes[idx] || { arr: null, dep: null, onlyBoarding: false, onlyAlighting: false };
        const absArrAttr = (stAbs.arr !== null) ? ' data-abs-arr="' + stAbs.arr + '"' : '';
        const absDepAttr = (stAbs.dep !== null) ? ' data-abs-dep="' + stAbs.dep + '"' : '';

        let arrCellHtml = escapeHTML(arrStr);
        if (stAbs.onlyBoarding) {
            arrCellHtml = '-\x3Cdiv style="font-size: 0.7rem; color: var(--primary); font-weight: 600; line-height: 1.15; margin-top: 2px;"\x3ETylko wsiadanie\x3C/div\x3E';
        }
        let depCellHtml = escapeHTML(depStr);
        if (stAbs.onlyAlighting) {
            depCellHtml = '-\x3Cdiv style="font-size: 0.7rem; color: var(--warning, #f59e0b); font-weight: 600; line-height: 1.15; margin-top: 2px;"\x3ETylko wysiadanie (~1m)\x3C/div\x3E';
        }

        html += '\x3Ctr class="' + rowClass + '"' + absArrAttr + absDepAttr + '\x3E' +
            '\x3Ctd class="station-name-td" data-label="Stacja"\x3E' +
                '\x3Cdiv class="station-cell-wrapper"\x3E' +
                    '\x3Cspan class="station-clickable" style="text-decoration:none; cursor:default;"\x3E' + escapeHTML(stacjaNazwa) + '\x3C/span\x3E' +
                '\x3C/div\x3E' +
            '\x3C/td\x3E' +
            '\x3Ctd data-label="Przyjazd:"\x3E' + arrCellHtml + '\x3C/td\x3E' +
            '\x3Ctd data-label="Odjazd:"\x3E' + depCellHtml + '\x3C/td\x3E' +
        '\x3C/tr\x3E';

        if (idx === activeStationIndex) {
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

        if (idx === activeBetweenIndex) {
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

    html += '\x3C/tbody\x3E\x3C/table\x3E\x3C/div\x3E';

    listContainer.innerHTML = html;
    mainBox.style.display = 'block';
    mainBox.className = 'bg-train';
    mainBox.innerText = "POCIĄG - " + escapeHTML(pociag.nazwa || '') + " (" + escapeHTML(pociag.numer) + ")";
    listContainer.style.display = 'block';

    if (activeStationIndex !== -1) {
        window.centerOnElement(document.querySelector('.train-route-table tr.active-station-row'));
    } else if (activeBetweenIndex !== -1) {
        window.centerOnElement(document.querySelector('.train-route-table tr.train-moving-row'));
    }
}

// ==========================================
// LOKALIZACJA WG ROZKŁADU JAZDY (IKONA ZEGARA)
// ==========================================
window.locateTrainByTime = (silent = false) => {
    const rows = Array.from(document.querySelectorAll('.train-route-table tr'));
    if (rows.length === 0) return !silent && alert("Najpierw wyszukaj trasę pociągu!");

    window.activeTrackingMode = 'time';

    if (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) {
        try { navigator.geolocation.clearWatch(window._trainGpsWatchId); } catch (e) {}
        window._trainGpsWatchId = null;
    }
    if (window._trainGpsPollInterval) {
        clearInterval(window._trainGpsPollInterval);
        window._trainGpsPollInterval = null;
    }
    const gpsBtn = document.getElementById('fabGpsBtn');
    if (gpsBtn) {
        gpsBtn.classList.remove('fab-active');
        gpsBtn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Emy_location\x3C/span\x3E';
    }
    document.querySelectorAll('.gps-distance-indicator').forEach(el => el.remove());
    window.dismissStationApproachToast();

    const btn = document.getElementById('fabTimeBtn');
    if (btn) btn.classList.add('fab-active');
    if (!silent && btn) {
        btn.innerHTML = '\x3Cspan class="material-symbols-outlined spin"\x3Esync\x3C/span\x3E';
    }

    setTimeout(() => {
        const now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes();
        let targetRow = null;
        let standingRow = null;
        let parsedRows = [];

        const stationRows = rows.filter(r => !r.querySelector('th') && !r.classList.contains('train-moving-row') && !r.classList.contains('station-standing-train-row'));

        for (let i = 0; i < stationRows.length; i++) {
            const row = stationRows[i];
            if (row.dataset.absArr !== undefined && row.dataset.absDep !== undefined) {
                const absArr = parseInt(row.dataset.absArr, 10);
                const absDep = parseInt(row.dataset.absDep, 10);
                if (!isNaN(absArr) && !isNaN(absDep)) {
                    parsedRows.push({ row: row, absArr: absArr, absDep: absDep, absMin: absDep });
                }
            }
        }

        if (parsedRows.length > 0) {
            const firstStation = parsedRows[0];
            const lastStation = parsedRows[parsedRows.length - 1];
            const originDep = firstStation.absDep;
            const originWindowStart = Math.max(0, originDep - 10);
            const endT = lastStation.absDep;
            const maxDays = Math.floor(endT / 1440);

            if (window._currentTrainBestMatch && typeof window._currentTrainBestMatch.daysAgo === 'number' && window._currentTrainBestMatch.daysAgo > 0) {
                currentMinutes = currentMinutes + window._currentTrainBestMatch.daysAgo * 1440;
            } else if (maxDays >= 1) {
                for (let d = maxDays; d >= 1; d--) {
                    const shifted = currentMinutes + d * 1440;
                    if (shifted >= originWindowStart && shifted <= endT + 60) {
                        currentMinutes = shifted;
                        break;
                    }
                }
            }

            for (let i = 0; i < parsedRows.length; i++) {
                const effArr = (i === 0) ? originWindowStart : parsedRows[i].absArr;
                if (currentMinutes >= effArr && currentMinutes <= parsedRows[i].absDep) {
                    standingRow = parsedRows[i].row;
                    break;
                }
            }

            if (!standingRow) {
                for (let i = 0; i < parsedRows.length - 1; i++) {
                    const curDep = parsedRows[i].absDep;
                    const nextArr = parsedRows[i + 1].absArr;
                    if (currentMinutes > curDep && currentMinutes < nextArr) {
                        targetRow = parsedRows[i + 1].row;
                        break;
                    }
                }
            }
        }

        document.querySelectorAll('.train-moving-row').forEach(el => el.remove());
        document.querySelectorAll('.station-standing-train-row').forEach(el => el.remove());
        document.querySelectorAll('.train-route-table tr.active-station-row').forEach(el => {
            el.classList.remove('active-station-row', 'station-with-train');
        });

        if (standingRow) {
            standingRow.classList.add('active-station-row', 'station-with-train');
            const stationNameEl = standingRow.querySelector('.station-clickable') || standingRow.querySelector('td');
            const stationName = stationNameEl ? stationNameEl.innerText.trim() : '';
            const isOriginStation = (parsedRows.length > 0 && standingRow === parsedRows[0].row);

            let standingBadgeText = 'Planowy postój pociągu na stacji: ' + escapeHTML(stationName);
            if (isOriginStation) {
                const minsLeft = parsedRows[0].absDep - currentMinutes;
                standingBadgeText = minsLeft > 0
                    ? 'Pociąg na stacji początkowej ' + escapeHTML(stationName) + ' (planowy odjazd za ' + minsLeft + ' min)'
                    : 'Pociąg na stacji początkowej ' + escapeHTML(stationName) + ' (planowy odjazd za chwilę)';
            }

            const standingTr = document.createElement('tr');
            standingTr.className = 'station-standing-train-row active-station-row';
            standingTr.innerHTML =
                '\x3Ctd colspan="3" style="padding: 0; border: none; background: transparent;"\x3E' +
                    '\x3Cdiv class="station-standing-box"\x3E' +
                        '\x3Cdiv class="station-standing-badge"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm"\x3Eschedule\x3C/span\x3E ' +
                            standingBadgeText +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="table-train-container standing-station-container"\x3E' +
                            (typeof window.getStandingTrainIndicatorHTML === 'function' ? window.getStandingTrainIndicatorHTML(5, stationName) : '') +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/td\x3E';
            standingRow.parentNode.insertBefore(standingTr, standingRow.nextSibling);
            if (!silent) window.centerOnElement(standingRow);
        } else if (targetRow) {
            const indicatorTr = document.createElement('tr');
            indicatorTr.className = 'train-moving-row';
            indicatorTr.innerHTML =
                '\x3Ctd colspan="3" style="padding: 0; border: none;"\x3E' +
                    '\x3Cdiv style="background: rgba(2, 132, 199, 0.1); display: flex; flex-direction: column; padding: 10px 0; overflow: hidden; position: relative; border-radius: 8px;"\x3E' +
                        '\x3Cdiv style="font-size: 0.9rem; font-weight: bold; color: var(--primary); margin-bottom: 5px; text-align: center; z-index: 20;"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="vertical-align: middle;"\x3Eschedule\x3C/span\x3E Planowe położenie pociągu (na szlaku)' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="table-train-container"\x3E' +
                            (typeof window.getTrainIndicatorHTML === 'function' ? window.getTrainIndicatorHTML(5) : '') +
                        '\x3C/div\x3E' +
                    '\x3C/div\x3E' +
                '\x3C/td\x3E';
            targetRow.parentNode.insertBefore(indicatorTr, targetRow);
            if (!silent) window.centerOnElement(indicatorTr);
        } else {
            if (!silent) alert('Według rozkładu pociąg nie znajduje się obecnie w trasie.');
        }

        if (!silent && btn) btn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Eschedule\x3C/span\x3E';
    }, silent ? 0 : 300);
};

// ==========================================
// CZUWAK GPS – ŚLEDZENIE W CZASIE RZECZYWISTYM I ALARM 6 KM PRZED STACJĄ
// ==========================================
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

window.locateTrainByGPS = async (silent = false) => {
    if (!silent && window.activeTrackingMode === 'gps') {
        window.stopTrainTracking();
        return;
    }

    const rows = Array.from(document.querySelectorAll('.train-route-table tr:not(.train-moving-row):not(.station-standing-train-row):not(thead tr)'));
    if (rows.length === 0) return !silent && alert("Najpierw wyszukaj trasę pociągu!");
    if (!navigator.geolocation) return !silent && alert("Twoje urządzenie nie wspiera GPS.");

    window.activeTrackingMode = 'gps';
    window.requestWakeLock();

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
    const timeBtn = document.getElementById('fabTimeBtn');
    if (timeBtn) {
        timeBtn.classList.remove('fab-active');
        timeBtn.innerHTML = '\x3Cspan class="material-symbols-outlined"\x3Eschedule\x3C/span\x3E';
    }
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
    const stationsList = window._cachedStationList || [];

    const processPosition = (position, isAccurate, shouldCenter = false) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;

        try {
            const currentRows = Array.from(document.querySelectorAll('.train-route-table tr:not(.train-moving-row):not(.station-standing-train-row):not(thead tr)'));
            if (currentRows.length === 0) return;

            let closestRowIndex = -1;
            let closestMatchedPos = -1;
            let minDistance = Infinity;
            const rowDistances = [];

            for (let i = 0; i < currentRows.length; i++) {
                const row = currentRows[i];
                const stationNameCell = row.querySelector('td:first-child');
                if (!stationNameCell) continue;

                const clickableEl = stationNameCell.querySelector('.station-clickable');
                const stationName = (clickableEl ? clickableEl.innerText : stationNameCell.innerText).trim().toUpperCase();
                const stationData = stationsList.find(s => s && s.stacja && s.stacja.toUpperCase() === stationName);

                if (stationData) {
                    let stLat = null;
                    let stLng = null;
                    if (stationData.lokalizacja_gps) {
                        stLat = stationData.lokalizacja_gps.latitude !== undefined ? stationData.lokalizacja_gps.latitude : stationData.lokalizacja_gps._lat;
                        stLng = stationData.lokalizacja_gps.longitude !== undefined ? stationData.lokalizacja_gps.longitude : stationData.lokalizacja_gps._long;
                    } else if (stationData.lat !== undefined && stationData.lng !== undefined) {
                        stLat = stationData.lat;
                        stLng = stationData.lng;
                    }

                    if (typeof stLat === 'number' && typeof stLng === 'number' && !isNaN(stLat) && !isNaN(stLng)) {
                        const dist = getDistance(userLat, userLng, stLat, stLng);
                        const matchedIdx = rowDistances.length;
                        rowDistances.push({
                            index: i,
                            matchedIdx: matchedIdx,
                            name: stationName,
                            lat: stLat,
                            lng: stLng,
                            distance: dist,
                            row: row
                        });

                        if (dist < minDistance) {
                            minDistance = dist;
                            closestRowIndex = i;
                            closestMatchedPos = matchedIdx;
                        }
                    }
                }
            }

            if (closestRowIndex === -1 || rowDistances.length === 0) {
                if (!silent) alert("Nie udało się dopasować współrzędnych stacji z tej trasy do bazy GPS.");
                if (!silent && btn) btn.innerHTML = originalIcon;
                return;
            }

            // Wyznaczenie wektora ruchu pociągu (heading lub różnica GPS)
            const cosLat = Math.cos(userLat * Math.PI / 180);
            const KM_PER_DEG = 111.32;
            let moveUx = null;
            let moveUy = null;

            const rawHeading = position.coords && typeof position.coords.heading === 'number' && !isNaN(position.coords.heading)
                ? position.coords.heading
                : null;
            const rawSpeed = position.coords && typeof position.coords.speed === 'number' && !isNaN(position.coords.speed)
                ? position.coords.speed
                : null;

            if (rawHeading !== null && rawHeading >= 0 && (rawSpeed === null || rawSpeed > 1.2)) {
                const headingRad = rawHeading * Math.PI / 180;
                moveUx = Math.sin(headingRad);
                moveUy = Math.cos(headingRad);
            } else if (window._lastTrainGpsFix && (Date.now() - window._lastTrainGpsFix.time) < 10 * 60 * 1000) {
                const dxKm = (userLng - window._lastTrainGpsFix.lng) * KM_PER_DEG * cosLat;
                const dyKm = (userLat - window._lastTrainGpsFix.lat) * KM_PER_DEG;
                const movedKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);
                if (movedKm >= 0.15) {
                    moveUx = dxKm / movedKm;
                    moveUy = dyKm / movedKm;
                }
            }

            if (!window._lastTrainGpsFix || getDistance(userLat, userLng, window._lastTrainGpsFix.lat, window._lastTrainGpsFix.lng) >= 0.15) {
                window._lastTrainGpsFix = { lat: userLat, lng: userLng, time: Date.now() };
            }

            const color = isAccurate ? 'var(--success)' : 'var(--warning)';
            const bgColor = isAccurate ? 'rgba(22, 163, 74, 0.1)' : 'rgba(245, 158, 11, 0.1)';
            const accuracyText = !isAccurate
                ? '\x3Cspan style="font-size: 0.7rem; font-weight: normal; opacity: 0.8; margin-top: 4px; display: block; text-align: center;"\x3E(Lokalizacja przybliżona - sieć komórkowa/Wi-Fi)\x3C/span\x3E'
                : '';

            rowDistances.forEach(rd => {
                const isClosest = rd.index === closestRowIndex;
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

                    const distColor = isClosest ? color : 'var(--text-muted)';
                    const distBg = isClosest ? bgColor : 'transparent';
                    const distBorder = isClosest ? ('1px solid ' + color) : '1px dashed var(--border)';

                    let distDiv = cellWrapper.querySelector('.gps-distance-indicator');
                    if (!distDiv) {
                        distDiv = document.createElement('div');
                        distDiv.className = 'gps-distance-indicator';
                        cellWrapper.appendChild(distDiv);
                    }
                    distDiv.className = 'gps-distance-indicator' + (isClosest ? ' closest' : '');
                    distDiv.style.color = distColor;

                    const extraText = (isClosest && !isAccurate) ? accuracyText : '';
                    distDiv.innerHTML =
                        '\x3Cspan class="gps-dist-pill" style="background: ' + distBg + '; border: ' + distBorder + '; font-weight: ' + (isClosest ? '800' : '600') + ';"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="font-size: 0.95rem;"\x3Enear_me\x3C/span\x3E ~' + rd.distance.toFixed(1) + ' km' +
                        '\x3C/span\x3E' + extraText;
                }
            });

            if (minDistance <= 0.85) {
                // TRYB STACJA: Pociąg w obrębie stacji (<= 850m)
                window.dismissStationApproachToast();

                const closestRow = currentRows[closestRowIndex];
                const closestObj = rowDistances[closestMatchedPos];
                const stationName = closestObj ? closestObj.name : '';

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
                        badge.className = 'station-standing-badge ' + (isAccurate ? 'gps-active' : 'gps-approx');
                        badge.innerHTML =
                            '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                            (isAccurate ? 'Twoja lokalizacja (GPS Satelity): ' : 'Lokalizacja przybliżona: ') +
                            'Pociąg w obrębie stacji ' + escapeHTML(stationName) + ' (~' + minDistance.toFixed(1) + ' km)';
                    }
                } else {
                    if (existingStandingTr) existingStandingTr.remove();

                    const standingTr = document.createElement('tr');
                    standingTr.className = 'station-standing-train-row active-station-row';
                    standingTr.innerHTML =
                        '\x3Ctd colspan="3" style="padding: 0; border: none; background: transparent;"\x3E' +
                            '\x3Cdiv class="station-standing-box"\x3E' +
                                '\x3Cdiv class="station-standing-badge ' + (isAccurate ? 'gps-active' : 'gps-approx') + '"\x3E' +
                                    '\x3Cspan class="material-symbols-outlined icon-sm" style="animation: train-pulse 1.5s infinite;"\x3Emy_location\x3C/span\x3E ' +
                                    (isAccurate ? 'Twoja lokalizacja (GPS Satelity): ' : 'Lokalizacja przybliżona: ') +
                                    'Pociąg w obrębie stacji ' + escapeHTML(stationName) + ' (~' + minDistance.toFixed(1) + ' km)' +
                                '\x3C/div\x3E' +
                                '\x3Cdiv class="table-train-container standing-station-container"\x3E' +
                                    (typeof window.getStandingTrainIndicatorHTML === 'function' ? window.getStandingTrainIndicatorHTML(5, stationName) : '') +
                                '\x3C/div\x3E' +
                            '\x3C/div\x3E' +
                        '\x3C/td\x3E';

                    closestRow.parentNode.insertBefore(standingTr, closestRow.nextSibling);
                }

                if (shouldCenter) {
                    window.centerOnElement(closestRow);
                }
            } else if (rowDistances.length >= 2) {
                // TRYB SZLAK: Pociąg jedzie pomiędzy stacjami
                document.querySelectorAll('.station-standing-train-row').forEach(el => el.remove());
                document.querySelectorAll('.train-route-table tr.active-station-row').forEach(el => {
                    el.classList.remove('active-station-row', 'station-with-train');
                });

                let bestSegIdx = 0;
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

                    let headingPenalty = 0;
                    if (moveUx !== null && moveUy !== null) {
                        const distB = Math.sqrt(Bx * Bx + By * By);
                        const distA = Math.sqrt(Ax * Ax + Ay * Ay);
                        if (distB > 0.1) {
                            const cosToB = (moveUx * Bx + moveUy * By) / distB;
                            const cosFromA = distA > 0.1 ? ((moveUx * (-Ax) + moveUy * (-Ay)) / distA) : 0;
                            if (B.distance < 3.5 && cosToB > 0.3) headingPenalty -= 1.5 * cosToB;
                            if (A.distance < 3.5 && cosFromA < -0.3) headingPenalty += 2.0 * (-cosFromA);
                        }
                    } else if (A.distance < 1.8 && k === closestMatchedPos) {
                        headingPenalty += 0.9;
                    }

                    const score = dPerp + 0.75 * dEllipse + 1.25 * dLongOut + headingPenalty;
                    if (score < bestScore) {
                        bestScore = score;
                        bestSegIdx = k;
                    }
                }

                const segStart = rowDistances[bestSegIdx];
                const segEnd = rowDistances[bestSegIdx + 1];
                const insertBeforeIndex = segEnd.index;
                const targetRow = rowDistances.find(r => r.index === insertBeforeIndex)?.row || currentRows[closestRowIndex];

                // --- POWIADOMIENIE Z DŹWIĘKIEM NA 6 KM PRZED STACJĄ DOCELOWĄ ---
                // Na 6 km przed stacją lub 50% dystansu między stacjami jeśli są bliżej siebie
                const distBetweenStations = getDistance(segStart.lat, segStart.lng, segEnd.lat, segEnd.lng);
                const approachThresholdKm = Math.min(APPROACH_ALERT_DISTANCE_KM, distBetweenStations * 0.5);
                if (segEnd.distance <= approachThresholdKm && segEnd.distance > 0.85) {
                    window.triggerStationApproachAlert(segEnd.name, segEnd.distance);
                } else if (segEnd.distance <= 0.85) {
                    window.dismissStationApproachToast();
                }

                const segmentDistancesHtml =
                    '\x3Cdiv class="train-segment-distances"\x3E' +
                        '\x3Cdiv class="train-segment-pill origin"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm train-segment-pill-icon origin-icon"\x3Etrip_origin\x3C/span\x3E' +
                            '\x3Cspan class="train-segment-pill-text"\x3E' +
                                '\x3Cspan class="nowrap-token"\x3EOdjechano z:\x3C/span\x3E ' +
                                '\x3Cstrong style="color:var(--text);"\x3E' + escapeHTML(segStart.name) + '\x3C/strong\x3E ' +
                                '\x3Cspan class="nowrap-token"\x3E(~' + segStart.distance.toFixed(1) + ' km temu)\x3C/span\x3E' +
                            '\x3C/span\x3E' +
                        '\x3C/div\x3E' +
                        '\x3Cdiv class="train-segment-pill destination"\x3E' +
                            '\x3Cspan class="material-symbols-outlined icon-sm train-segment-pill-icon dest-icon"\x3Elocation_on\x3C/span\x3E' +
                            '\x3Cspan class="train-segment-pill-text"\x3E' +
                                '\x3Cspan class="nowrap-token"\x3EDo stacji:\x3C/span\x3E ' +
                                '\x3Cstrong style="color:var(--primary);"\x3E' + escapeHTML(segEnd.name) + '\x3C/strong\x3E ' +
                                '\x3Cspan class="nowrap-token"\x3E(pozostało ~' + segEnd.distance.toFixed(1) + ' km)\x3C/span\x3E' +
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
                            (isAccurate ? 'Czuwak aktywny (GPS Satelity)' : 'Czuwak aktywny (Przybliżona sieć)');
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
                                    (isAccurate ? 'Czuwak aktywny (GPS Satelity)' : 'Czuwak aktywny (Przybliżona sieć)') +
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

    // 1. Natychmiastowy odczyt GPS
    let hasCentered = silent;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            processPosition(pos, true, !hasCentered);
            hasCentered = true;
            if (!silent && btn) btn.innerHTML = originalIcon;
        },
        (error1) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    processPosition(pos, false, !hasCentered);
                    hasCentered = true;
                    if (!silent && btn) btn.innerHTML = originalIcon;
                },
                () => {
                    if (!silent) {
                        alert("Błąd lokalizacji: Nie udało się ustalić pozycji ani przez satelity GPS, ani przez sieć komórkową (BTS). Spróbuj podejść bliżej okna pociągu.");
                    }
                    if (!silent && btn) btn.innerHTML = originalIcon;
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
            );
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    // 2. Ciągłe śledzenie przez watchPosition
    if (window._trainGpsWatchId !== null && window._trainGpsWatchId !== undefined) {
        try { navigator.geolocation.clearWatch(window._trainGpsWatchId); } catch (e) {}
        window._trainGpsWatchId = null;
    }
    try {
        window._trainGpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (window.activeTrackingMode === 'gps' && document.querySelector('.train-route-table')) {
                    processPosition(pos, true, false);
                }
            },
            (err) => console.warn("WatchPosition ostrzeżenie:", err),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
        );
    } catch (e) {}

    // 3. Interwał sondujący co 8s
    if (window._trainGpsPollInterval) clearInterval(window._trainGpsPollInterval);
    window._trainGpsPollInterval = setInterval(() => {
        if (window.activeTrackingMode === 'gps' && document.querySelector('.train-route-table')) {
            navigator.geolocation.getCurrentPosition(
                (pos) => processPosition(pos, true, false),
                null,
                { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
            );
        } else {
            clearInterval(window._trainGpsPollInterval);
            window._trainGpsPollInterval = null;
        }
    }, 8000);
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.activeTrackingMode === 'gps' && document.querySelector('.train-route-table')) {
        window.locateTrainByGPS(true);
    }
});

// ==========================================
// START APLIKACJI (BOOTLOADER)
// ==========================================
function bootApplication() {
    window.updateStationAlertsMenuButton();

    let forceDbUpdate = false;
    if (localStorage.getItem('FORCE_DB_UPDATE') === 'true') {
        forceDbUpdate = true;
        localStorage.removeItem('FORCE_DB_UPDATE');
    }

    window.pobierzDane('all', forceDbUpdate)
        .then(() => window.checkDbVersion())
        .catch(err => console.error("Błąd inicjalizacji danych na starcie:", err));

    if (window._trainRefreshInterval) clearInterval(window._trainRefreshInterval);
    window._trainRefreshInterval = setInterval(() => {
        if (document.getElementById('mainStatusBox')?.style.display === 'block' && currentMode === 'train') {
            if (window.activeTrackingMode === 'time') {
                window.locateTrainByTime(true);
            }
        }
    }, 60000);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

bootApplication();
