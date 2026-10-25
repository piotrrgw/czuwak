# 🚆 Czuwak – Asystent Drużyn Konduktorskich (DK)

**Czuwak** to lekka aplikacja mobilna (`.apk` / PWA) stworzona dla pracowników Drużyn Konduktorskich. Jej głównym zadaniem jest śledzenie pozycji pociągu w czasie rzeczywistym (w 100% offline w czasie jazdy) oraz informowanie przed wjazdem do stacji (domyślnie **6 km**, z regulacją suwakiem **1–15 km**) o zbliżaniu się do postoju i przypominanie o **wygłoszeniu komunikatu pożegnalnego**.

---

## ⚙️ Główne funkcje

1. **Synchronizacja Offline-First:**
   - **Rozkłady pociągów:** Pobierane automatycznie co **24–48h** (lub po wykryciu nowej wersji w `system/db_status`) i zapisywane w pamięci lokalnej urządzenia (`IndexedDB` / `localforage`).
   - **Słownik stacji GPS:** Pobierany jednorazowo do pamięci telefonu i odświeżany wyłącznie wtedy, gdy w bazie pojawi się **publikacja głośna (`LOUD` – `lastUpdateStations`)**.
   - **Mapa Kolejowa OpenRailwayMap Offline:** Podgląd trasy pociągu na mapie szlaków kolejowych z zapisem kafelków offline w bazie `IndexedDB` (`czuwak_orm_tiles_v1`) oraz trybem pełnoekranowym i wyśrodkowaniem na pozycji pociągu.
2. **Wybór daty wyjazdu i dobór wariantu kursowania:**
   - Ręczny wybór daty wyjazdu pociągu (**Wczoraj | Dzisiaj | Jutro** lub dowolna data z kalendarza).
   - Wyszukiwanie pociągu po **numerze** (z obsługą parzystego/nieparzystego kierunku relacji) lub **nazwie** oraz historia **5 ostatnich pociągów**.
   - Konfiguracja odcinka obsługi DK: stacja objęcia składu oraz stacja zmiany DK z automatycznym uśpieniem Czuwaka po zdaniu pociągu.
3. **Karta Hero HUD, Pływający Mini-Widget i Widget Ekranu Blokady:**
   - **Hero HUD „Następna stacja”:** Wyróżniona karta nad tabelą trasy z nazwą stacji, odległością w czasie rzeczywistym, wyliczonym ETA, statusem (stacja pośrednia vs stacja zmiany DK) oraz przyciskami szybkiego odhaczenia, centrowania mapy i ustawiania opóźnienia.
   - **Pływający Mini-HUD:** Dyskretny pasek pojawiający się podczas przewijania rozkładu jazdy w dół ekranu, zapewniający ciągły podgląd następnej stacji i odległości.
   - **Widget na ekranie blokady (MediaSession):** Prezentacja numeru pociągu, relacji, najbliższej stacji, odległości i prognozowanego opóźnienia bezpośrednio na zablokowanym ekranie telefonu bez konieczności odblokowywania.
4. **Zarządzanie opóźnieniami i rejestracja postojów:**
   - **One-Tap Delay Bottom Sheet:** Ergonomiczny panel dolny z kafelkami szybkiego wyboru opóźnień (`[Plan]`, `[+3]`, `[+5]`, `[+10]`, `[+15]`, `[+20]`, `[+30]`, `[+45]`, `[+60]` oraz `[-5m]`, `[-1m]`, `[+1m]`, `[+5m]`) zastępujący uciążliwe okna systemowe.
   - **Automatyczne uzupełnianie opóźnień z GPS:** Aplikacja automatycznie kalkuluje i aktualizuje opóźnienie pociągu w oparciu o rzeczywisty czas zatrzymania lub odjazdu względem rozkładu jazdy.
   - **Edycja czasów rzeczywistych:** Klikalne plakietki `Postój: HH:MM:SS` oraz `Odj.: HH:MM:SS` na stacjach z możliwością ręcznej korekty godziny, wstawienia bieżącego czasu („Teraz”) lub wyczyszczenia wpisu.
5. **Ergonomia pracy drużyny konduktorskiej:**
   - **Filtr trasy:** Przełącznik `[Mój odcinek DK]` vs `[Cała trasa]` umożliwiający natychmiastowe ukrycie stacji spoza bieżącej służby.
   - **Znaczniki stacji (Crew Tags):** Szybkie notatki drużyny przy stacjach (`♿ PRM`, `🚲 Rowery`, `⚠️ Krótki peron`, `👥 Grupa`, `⚡ Awaria drzwi`) widoczne na liście, w Hero HUD oraz w powiadomieniach.
   - **Tryb nocny OLED True Black:** Trzybiegunowy przełącznik motywu (**Ciemny ➔ OLED ➔ Jasny**), optymalizujący zużycie baterii na wyświetlaczach AMOLED/OLED.
   - **Zróżnicowana haptyka wibracji:** Odrębny wzorzec wibracji dla stacji pośredniej oraz wydłużony, alarmujący dla stacji zmiany DK (zdania składu).
6. **Czuwak GPS, Odporność na utratę sygnału i Konfigurowalny Alarm:**
   - Wyznaczanie bieżącego odcinka szlaku (`Stacja A ➔ Stacja B`) ze wzmocnioną ochroną przed przerzucaniem pociągu za stację na łukach (*Kalisz Fix v2* – analiza wektora ruchu do 15 km, pochodnej dystansu i zaliczonych stacji).
   - **Odporność na utratę GPS / Internetu:** Po utracie sygnału GPS (np. w tunelu lub wagonie ekranowanym) włącza się nawigacja inercyjna (**Dead Reckoning**) na podstawie rozkładowej prędkości szlakowej.
   - **Suwak dystansu alarmu (1–15 km)** oraz wybór trybu powiadomienia:
     - 🔔 **Jednokrotne przypomnienie** (dwukrotny gong + wibracja),
     - ⏰ **Tryb Budzika (do potwierdzenia)** – powtarzany sygnał i wibracja w dolnej strefie kciuka z dużymi przyciskami (min. 52px).

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
