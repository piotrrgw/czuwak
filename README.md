# 🚆 Czuwak – Asystent Drużyn Konduktorskich (DK)

**Czuwak** to lekka aplikacja mobilna (`.apk` / PWA) stworzona dla pracowników Drużyn Konduktorskich. Jej głównym zadaniem jest śledzenie pozycji pociągu w czasie rzeczywistym (w 100% offline w czasie jazdy) oraz informowanie przed wjazdem do stacji (domyślnie **6 km**, z regulacją suwakiem **1–15 km**) o zbliżaniu się do postoju i przypominanie o **wygłoszeniu komunikatu pożegnalnego**.

---

## ⚙️ Główne funkcje

1. **Synchronizacja Offline-First:**
   - **Rozkłady pociągów:** Pobierane automatycznie co **24–48h** (lub po wykryciu nowej wersji w `system/db_status`) i zapisywane w pamięci lokalnej urządzenia (`IndexedDB` / `localforage`).
   - **Słownik stacji GPS:** Pobierany jednorazowo do pamięci telefonu i odświeżany wyłącznie wtedy, gdy w bazie pojawi się **publikacja głośna (`LOUD` – `lastUpdateStations`)**.
   - **Mapa Kolejowa OpenRailwayMap Offline:** Podgląd trasy pociągu na mapie szlaków kolejowych z zapisem kafelków offline w bazie `IndexedDB` (`czuwak_orm_tiles_v1`).
2. **Wybór daty wyjazdu i dobór wariantu kursowania:**
   - Ręczny wybór daty wyjazdu pociągu (**Wczoraj | Dzisiaj | Jutro** lub dowolna data z kalendarza).
   - Wyszukiwanie pociągu po **numerze** (z obsługą parzystego/nieparzystego kierunku relacji) lub **nazwie** oraz historia **5 ostatnich pociągów**.
   - Przejrzysta tabela trasy: **Stacja | Przyjazd | Odjazd** wraz z animowanym składem pociągu.
3. **Czuwak GPS, Odporność na utratę sygnału i Konfigurowalny Alarm:**
   - Wyznaczanie bieżącego odcinka szlaku (`Stacja A ➔ Stacja B`) ze wzmocnioną ochroną przed przerzucaniem pociągu za stację na łukach (*Kalisz Fix v2* – analiza wektora ruchu do 15 km, pochodnej dystansu i zaliczonych stacji).
   - **Odporność na utratę GPS / Internetu:** Po utracie sygnału GPS (np. w tunelu lub wagonie ekranowanym) po 20 sekundach włącza się tryb estymacji (**Dead Reckoning**) na podstawie ostatniej prędkości i rozkładu jazdy.
   - **Suwak dystansu alarmu (1–15 km)** oraz wybór trybu powiadomienia:
     - 🔔 **Jednokrotne przypomnienie** (dwukrotny gong + wibracja),
     - ⏰ **Tryb Budzika (do potwierdzenia)** – cykliczny sygnał dźwiękowy i wibracje powtarzane do momentu kliknięcia przycisku **„Potwierdź komunikat / Wycisz Czuwak”**.

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
