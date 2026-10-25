// --- GŁÓWNY PLIK KONFIGURACYJNY APLIKACJI CZUWAK ---
const APP_VERSION = "v1.1.3";
const APP_BUILD = "5";

if (typeof window !== 'undefined') {
    window.APP_VERSION = APP_VERSION;
    window.APP_BUILD = APP_BUILD;
} else if (typeof self !== 'undefined') {
    self.APP_VERSION = APP_VERSION;
    self.APP_BUILD = APP_BUILD;
}
