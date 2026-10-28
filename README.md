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
3. **Karta Hero HUD, Pływający Mini-HUD i Zaawansowany Widget Pulpitu Androida:**
   - **Interaktywny Widget na Ekran Główny Androida (AppWidget):**
     - **Wizualna oś szlaku (Segment Tracker):** `[Stacja odjazdu] ──🚂──➔ [Następna stacja]` wraz z rozkładową godziną odjazdu i prognozowanym przyjazdem.
     - **Bezpośrednie akcje z poziomu pulpitu:** Interaktywne przyciski `[✓ Odhacz postój]` (zapisuje dokładny czas zatrzymania) oraz `[+5m]` (natychmiastowe podbicie opóźnienia o 5 minut) z pełną dwukierunkową synchronizacją z aplikacją.
     - **Pasek postępu służby DK:** Wizualny pasek `ProgressBar` z procentem ukończenia odcinka obsługi drużyny konduktorskiej.
     - **Kolorowe znaczniki drużyny konduktorskiej (Crew Tags):** Prezentacja tagów przypisanych do stacji (`♿ PRM`, `🚲 Rowery`, `⚠️ Krótki peron`, itp.) bezpośrednio na widgecie.
     - **Wyróżnienie stacji zmiany DK:** Wyrazisty złoto-bursztynowy baner ostrzegawczy `⚠️ STACJA ZMIANY DK (ZDANIE SKŁADU)` przy zbliżaniu się do końca służby.
     - **Dynamiczny status pociągu:** Pigułka stanu pociągu (`🟢 POSTÓJ NA STACJI`, `🔵 NA SZLAKU`, `🟠 ZBLIŻANIE DO STACJI`).
   - **Hero HUD „Następna stacja”:** Wyróżniona karta nad tabelą trasy z nazwą stacji, odległością w czasie rzeczywistym, wyliczonym ETA, statusem oraz bezpośrednim przyciskiem odhaczania postoju / odjazdu (`[Odhacz postój teraz]` ➔ `[Odhacz odjazd (HH:MM)]` ➔ `[✓ Zaliczono]`).
   - **Pływający Mini-HUD ze zintegrowanym przyciskiem postoju:** Dyskretny pasek pojawiający się podczas przewijania rozkładu jazdy w dół, wyposażony w przycisk `[✓ Postój]` oraz `[Wyśrodkuj]`.
   - **Widget na ekranie blokady (MediaSession):** Prezentacja numeru pociągu, relacji, najbliższej stacji, odległości i prognozowanego opóźnienia bezpośrednio na zablokowanym ekranie telefonu.
4. **Procedura P115 (Skład pociągu nie mieści się w peronie):**
   - **Wprowadzanie wagonów poza peronem:** Możliwość wpisania numerów wagonów, które zatrzymają się poza krawędzią peronową (np. `wag. 11, 12`).
   - **Stroboskopowy alarm wizualny:** Podczas zbliżania się do stacji z procedurą P115 ekran telefonu mruga pulsacyjnie na czerwono z wyrazistym banerem `⚠️ PROCEDURA P115: SKŁAD POCIĄGU NIE MIEŚCI SIĘ W PERONIE!` oraz wyróżnionymi numerami wagonów.
   - **Stroboskop latarki aparatu:** Natywny stroboskop latarki LED telefonu (`strobeTorch`) ostrzegający drużynę konduktorską nawet przy odwróconym telefonie.
5. **Historia Obsługi (Zrealizowane pociągi):**
   - **Archiwum pociągów:** Dedykowana zakładka w menu bocznym przechowująca zrealizowane pociągi wraz z rozkładowymi i rzeczywistymi czasami zatrzymań i odjazdów, opóźnieniami, odhaczonymi postojami i notatkami drużyny.
   - **Raport służby:** Możliwość generowania czytelnego raportu tekstowego, skopiowania do schowka telefonu lub pobrania pliku `.txt`.
6. **Zarządzanie opóźnieniami i intuicyjna rejestracja postojów:**
   - **Intuicyjne, jednodotykowe odhaczanie postoju i odjazdu:** Zwiększone pole dotykowe (min. 44x44px), haptyka wibracyjna i toasty potwierdzające odhaczenie postoju i odjazdu.
   - **One-Tap Delay Bottom Sheet:** Ergonomiczny panel dolny z bezpośrednim polem liczbowym, stepperami `[-5m, -1m, +1m, +5m]` oraz szybkimi kafelkami `[Plan]`, `[+3]`, `[+5]`, `[+10]`, `[+15]`, `[+20]`, `[+30]`, `[+45]`, `[+60]`.
   - **Interaktywne komórki tabeli trasy:** Każda komórka godziny przyjazdu i odjazdu w tabeli jest bezpośrednio klikalna z poziomu widoku trasy.
   - **Trwałość postojów i notatek stacji:** Zapis z podwójnym indeksem sesyjnym i datowym chroni przed utratą odhaczonych postojów oraz tagów (`PRM`, `Rower`, `Peron`) przy minimalizacji aplikacji lub przejściu przez północ.
7. **Blokada przeskoczenia stacji i eliminacja cofania szlaku:**
   - **Wstrzymanie automatycznego przejścia do kolejnej stacji:** Jeśli drużyna nie odhaczyła zatrzymania na planowej stacji postoju z odcinka DK, Czuwak blokuje przeskok Hero HUD oraz wskaźnika trasy.
   - **Eliminacja cofania szlaku (`minAllowedSegIdx`):** Po odjeździe ze stacji B pociąg nie cofa się do odcinka A>B – przebyte stacje są trwale wykluczone z doboru odcinka szlaku.
8. **Niezawodna praca przy wygaszonym ekranie i płynne śledzenie GPS:**
   - **Natywny Serwis Pierwszoplanowy (`CzuwakForegroundService`) ze sprzętowym `LocationListener`:** Gwarantuje ciągłe śledzenie GPS w tle i dostarczanie współrzędnych bezpośrednio do silnika aplikacji, zapobiegając usypianiu powiadomień po zablokowaniu ekranu.
   - **Ciągły prędkościomierz jak w nawigacji:** Zastosowanie filtru wykładniczego (EMA) i bufora próbek GPS eliminuje skoki prędkości (0 ➔ 70 ➔ 0 km/h) oraz gwałtowne wahania.
   - **Ochrona przed fałszywym odjazdem na postoju:** Wyeliminowano przedwczesne oznaczanie odjazdu podczas chodzenia konduktora po składzie lub wahań satelitów (próg odjazdu podniesiony do 12 km/h z wymogiem potwierdzenia w 2 kolejnych pomiarach).
9. **Dziennik Diagnostyczny Aplikacji i Ciągły Autozapis Służby (Continuous Stream & SAF):**
   - **Ciągły autozapis w tle (co 5 sekund):** Nowy silnik zapisu strumieniowego na żywo flushuje logi diagnostyczne bezpośrednio na dysk telefonu co 5 sekund oraz natychmiastowo przy zdarzeniach krytycznych.
   - **Wskazanie folderu zapisu na telefonie:** Dzięki integracji z Android Storage Access Framework (SAF), użytkownik może wybrać z menu bocznego dowolny folder w pamięci telefonu.
   - **Podwójna organizacja logów dla długiej służby (12h):** Osobny plik pociągu (`czuwak_log_YYYY-MM-DD_poc_XXXXX.txt`) oraz plik całej służby (`czuwak_sluzba_YYYY-MM-DD.txt`).
10. **System Dźwięków Powiadomień Czuwaka i Wybór z Biblioteki Androida:**
   - 3 wbudowane profesjonalne sygnały audio (Gong PKP, Radar Czuwaka, Trąbka pociągu) oraz dźwięk własny z telefonu (mp3/wav do 12 MB w `IndexedDB`).
   - Suwak dystansu alarmu (1–15 km) oraz wybór trybu powiadomienia (Jednokrotne vs Tryb Budzika).
11. **Planer Służby / Moja Służba (Planowanie z domu i 1-Tap Launcher na peronie):**
   - **Wygodne przygotowanie pociągów z wyprzedzeniem:** Drużyna konduktorska może w domu przed służbą zaplanować cały dzień (lub kolejny dzień służby), wprowadzając kolejne obsługiwane pociągi, stacje objęcia i zdania DK, procedurę P115 z numerami wagonów oraz znaczniki (`♿ PRM`, `🚲 Rowery`, `👥 Grupa`, itp.).
   - **Karta szybkiego startu 1-Tap na ekranie głównym:** Po wejściu do pociągu aplikacja wyświetla zaplanowaną służbę z dużym, natychmiastowym przyciskiem `[🚀 Uruchom pociąg (1-Tap)]` – uruchomienie Czuwaka, wczytanie trasy, odcinka DK i tagów P115 następuje w 1 sekundę bez wpisywania i szukania.
   - **Spokojne przejście między pociągami (Bez wymuszonego auto-startu):** Po zakończeniu obsługi pociągu #1 Czuwak samoczynnie wyłącza GPS i przechodzi w stan uśpienia, chroniąc baterię w trakcie przerwy (np. 1h na stacji węzłowej). Na ekranie głównym wyświetla się pociąg #2 gotowy do manualnego uruchomienia 1 tapem po wejściu na pokład kolejnego składu.

---

## 🔄 Samodzielna aktualizacja `.apk` (bez Sklepu Google Play)

Aplikacja posiada wbudowany system samodzielnych aktualizacji over-the-air:
1. **Stały klucz podpisu (`android/app/czuwak-release.keystore`):** Każda kompilacja `.apk` jest podpisywana tym samym certyfikatem, dzięki czemu Android pozwala zainstalować nową wersję bezpośrednio na obecną („Aktualizuj”) **bez odinstalowywania i bez utraty pobranych rozkładów czy ustawień**.
2. **Automatyczne wydania GitHub Releases ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)):**
   - Po zmianie `APP_VERSION` / `APP_BUILD` w [`www/env.js`](www/env.js) i wypchnięciu kodu na gałąź `main`, GitHub Actions automatycznie buduje podpisany plik `.apk` i publikuje go pod stałą, bezpieczną nazwą **`czuwak.apk`**:
     - **Bezpośredni link do pobrania:** `https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk`.
   - Zrezygnowano ze zmiennych nazw plików z nawiasami, eliminując błędy 404 i bałagan w pobranych plikach.
3. **Wykrywanie aktualizacji w aplikacji:**
   - Przy starcie (oraz po kliknięciu **„Sprawdź aktualizację aplikacji (.apk)”** w menu bocznym) Czuwak porównuje swoją wersję z GitHubem. Gdy pojawi się nowsza wersja, wyświetla powiadomienie z możliwością natychmiastowego pobrania i instalacji.

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
