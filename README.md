# 🚆 Czuwak – Asystent Drużyn Konduktorskich (DK)

**Czuwak** to lekka aplikacja mobilna (`.apk` / PWA) stworzona dla pracowników Drużyn Konduktorskich PKP Intercity. Jej głównym zadaniem jest śledzenie pozycji pociągu w czasie rzeczywistym (w 100% offline w czasie jazdy) oraz informowanie na **6 km przed wjazdem do stacji** o zbliżaniu się do postoju i przypominanie o **wygłoszeniu komunikatu pożegnalnego**.

---

## ⚙️ Główne funkcje

1. **Synchronizacja Offline-First:**
   - **Rozkłady pociągów (`trasy-ic` / `pociagi_ic`):** Pobierane automatycznie co **24–48h** (lub po wykryciu nowej wersji w `system/db_status`) i zapisywane w pamięci lokalnej urządzenia (`IndexedDB` / `localforage`).
   - **Słownik stacji GPS (`akb-data` / `public_data/stations_dict`):** Pobierany jednorazowo do pamięci telefonu i odświeżany wyłącznie wtedy, gdy w bazie pojawi się **publikacja głośna (`LOUD` – `lastUpdateStations`)**.
2. **Inteligentny dobór trasy i wariantu kursowania:**
   - Wyszukiwanie pociągu po **numerze** (z obsługą parzystego/nieparzystego kierunku relacji) lub **nazwie** oraz historia **5 ostatnich pociągów**.
   - Automatyczna obsługa pociągów nocnych (w trasie z poprzedniej doby).
   - Przejrzysta tabela trasy: **Stacja | Przyjazd | Odjazd** wraz z animowanym składem pociągu.
3. **Czuwak GPS i Alarm 6 km przed stacją:**
   - Wyznaczanie bieżącego odcinka szlaku (`Stacja A ➔ Stacja B`) na podstawie rzutu geometrycznego GPS oraz wektora ruchu (`heading`).
   - Na **6 km przed wjazdem do stacji** (lub w połowie odcinka, jeśli stacje dzielą mniej niż 12 km):
     - 🔊 Dwukrotny akustyczny gong kolejowy PKP (*Bim-Bam... Bim-Bam*, `698.46 Hz` / `880.00 Hz`) ze 100% głośnością cyfrową,
     - 📳 Zsynchronizowana wibracja telefonu,
     - 🔔 Powiadomienie systemowe Android (`@capacitor/local-notifications` / Service Worker) oraz pływający baner z odliczaniem kilometrów na żywo i przypomnieniem: **„Wygłoś komunikat pożegnalny”**.

---

## 🔄 Samodzielna aktualizacja `.apk` (bez Sklepu Google Play)

Aplikacja posiada wbudowany system samodzielnych aktualizacji over-the-air:
1. **Stały klucz podpisu (`android/app/czuwak-release.keystore`):** Każda kompilacja `.apk` jest podpisywana tym samym certyfikatem, dzięki czemu Android pozwala zainstalować nową wersję bezpośrednio na obecną („Aktualizuj”) **bez odinstalowywania i bez utraty pobranych rozkładów czy ustawień**.
2. **Automatyczne wydania GitHub Releases ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)):**
   - Po zmianie `APP_VERSION` / `APP_BUILD` w [`www/env.js`](www/env.js) i wypchnięciu kodu na gałąź `main`, GitHub Actions automatycznie buduje podpisany plik `czuwak.apk` i publikuje go pod stałym adresem:
     `https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk`
3. **Wykrywanie aktualizacji w aplikacji:**
   - Przy starcie (oraz po kliknięciu **„Sprawdź aktualizację aplikacji (.apk)”** w menu bocznym) Czuwak porównuje swoją wersję z plikiem `www/env.js` na GitHubie oraz opcjonalnymi polami w Firestore (`system/db_status`: `latestCzuwakVersion`, `minCzuwakVersion`, `czuwakApkUrl`).
   - Gdy pojawi się nowsza wersja, wyświetla niebieski baner **„Dostępna nowa wersja Czuwaka! Kliknij, aby pobrać i zainstalować (.apk)”**, który jednym dotknięciem pobiera i uruchamia instalator aktualizacji.

---

## 🛠️ Uruchomienie lokalne

```bash
# Instalacja zależności
npm install

# Uruchomienie podglądu w przeglądarce (port 3000)
npm run serve

# Synchronizacja zmian z projektem natywnym Android
npm run sync
```
