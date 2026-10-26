// --- GŁÓWNY PLIK KONFIGURACYJNY APLIKACJI CZUWAK ---
const APP_VERSION = "v1.2.0";
const APP_BUILD = "12";
const APP_APK_NAME = "czuwak(" + APP_VERSION + ")(" + APP_BUILD + ").apk";

if (typeof window !== 'undefined') {
    window.APP_VERSION = APP_VERSION;
    window.APP_BUILD = APP_BUILD;
    window.APP_APK_NAME = APP_APK_NAME;
} else if (typeof self !== 'undefined') {
    self.APP_VERSION = APP_VERSION;
    self.APP_BUILD = APP_BUILD;
    self.APP_APK_NAME = APP_APK_NAME;
}
