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
   - **Hero HUD „Następna stacja”:** Wyróżniona karta nad tabelą trasy z nazwą stacji, odległością w czasie rzeczywistym, wyliczonym ETA, statusem oraz przyciskami szybkiego odhaczenia i opóźnienia.
   - **Pływający Mini-HUD (Top Sticky Dynamic Island):** Dyskretny pasek pojawiający się u góry ekranu (`top: 12px`) podczas przewijania rozkładu jazdy w dół, zapewniający ciągły podgląd następnej stacji bez kolizji z przyciskami FAB i prędkościomierzem.
   - **Widget na ekranie blokady (MediaSession):** Prezentacja numeru pociągu, relacji, najbliższej stacji, odległości i prognozowanego opóźnienia bezpośrednio na zablokowanym ekranie telefonu.
4. **Zarządzanie opóźnieniami i rejestracja postojów:**
   - **One-Tap Delay Bottom Sheet:** Ergonomiczny panel dolny z bezpośrednim polem liczbowym, stepperami `[-5m, -1m, +1m, +5m]` oraz szybkimi kafelkami `[Plan]`, `[+3]`, `[+5]`, `[+10]`, `[+15]`, `[+20]`, `[+30]`, `[+45]`, `[+60]`.
   - **Interaktywne komórki tabeli trasy:** Każda komórka godziny przyjazdu i odjazdu w tabeli jest bezpośrednio klikalna z poziomu widoku trasy, umożliwiając szybkie wprowadzenie rzeczywistego czasu lub korektę opóźnienia składu.
   - **Edycja czasów rzeczywistych i 1-tap presety:** Modal edycji z przyciskami szybkiego uzupełnienia `[✓ Wg planu]`, `[⏱️ Postój TERAZ]`, `[🟢 Odjazd TERAZ]`, `[+2m]`, `[+5m]`, `[+10m]` oraz automatycznym przeliczaniem opóźnienia pociągu.
   - **Trwałość postojów i notatek stacji:** Zapis z podwójnym indeksem sesyjnym i datowym chroni przed utratą odhaczonych postojów oraz tagów (`PRM`, `Rower`, `Peron`) przy minimalizacji aplikacji lub przejściu przez północ.
5. **Blokada przeskoczenia stacji i Bezpieczeństwo Szlaku:**
   - **Wstrzymanie automatycznego przejścia do kolejnej stacji:** Jeśli drużyna nie odhaczyła zatrzymania na planowej stacji postoju z odcinka DK, Czuwak blokuje przeskok Hero HUD oraz wskaźnika trasy.
   - **Baner ostrzegawczy z natychmiastowym odblokowaniem:** Wyróżniony baner w Hero HUD `BLOKADA PRZESKOKU: Nie odhaczono postoju na stacji...` z jednym przyciskiem `[✓ Odhacz i potwierdź postój]`, który natychmiastowo zdejmuje blokadę.
6. **Płynne Śledzenie GPS, Ochrona Postoju i Praca przy Wygaszonym Ekranie:**
   - **Natywny Serwis Pierwszoplanowy (`CzuwakForegroundService`):** Gwarantuje ciągłe śledzenie GPS i utrzymanie procesora (`PARTIAL_WAKE_LOCK`) na systemach Android 10–15 nawet po wygaszeniu ekranu i schowaniu telefonu do kieszeni.
   - **Indeks stacji `O(1)` i różnicowa aktualizacja DOM:** Współrzędne stacji indeksowane są w strukturze `Map` w pamięci RAM, a wiersze trasy aktualizują DOM wyłącznie przy faktycznej zmianie dystansu ($\ge 0.1\text{ km}$), eliminując zbędne przeliczenia układu strony (*Layout Reflow*).
   - **Ciągły prędkościomierz jak w nawigacji:** Zastosowanie filtru wykładniczego (EMA) i bufora próbek GPS eliminuje skoki prędkości (0 ➔ 70 ➔ 0 km/h) oraz gwałtowne wahania.
   - **Ochrona przed fałszywym odjazdem na postoju:** Wyeliminowano przedwczesne oznaczanie odjazdu podczas chodzenia konduktora po składzie lub wahań satelitów (próg odjazdu podniesiony do 12 km/h z wymogiem potwierdzenia w 2 kolejnych pomiarach).
   - **Inteligentny watchdog sygnału i debouncing wznowienia:** Wyeliminowano agresywne odpytywanie wież BTS w tle oraz podwójny restart GPS przy przywracaniu aplikacji z tła.
7. **Dziennik Diagnostyczny Aplikacji (Offline Logs):**
   - Wbudowany lokalny rejestrator zdarzeń GPS, statusów stacji, kalkulacji prędkości i cyklu życia aplikacji (do 300 ostatnich zdarzeń w bazie `IndexedDB`).
   - Dostępny z menu bocznego z możliwością przeglądania, filtrowania kolorystycznego, kopiowania do schowka i eksportu do pliku tekstowego `.txt`.
8. **System Dźwięków Powiadomień Czuwaka i Wybór z Biblioteki Androida:**
   - **3 wbudowane profesjonalne sygnały audio (Web Audio API):**
     1. 🔔 **Gong peronowy PKP** – klasyczny dwukrotny gong stacyjny (Bim-Bam).
     2. 📡 **Radar Czuwaka** – nowoczesny, dynamiczny impuls sonaru pokładowego z echem.
     3. 🚂 **Trąbka pociągu** – wyrazisty akord syreny / sygnału baczność lokomotywy PKP.
   - **Dźwięk własny z telefonu (w `IndexedDB`):** Możliwość załadowania dowolnego pliku dźwiękowego z pamięci urządzenia (mp3, wav, ogg do 12 MB) przechowywanego asynchronicznie w `IndexedDB` (bez obciążania limitu 5 MB `localStorage`).
   - **Integracja z pętlą budzika i powiadomieniami:** Wybrany dźwięk jest automatycznie wykorzystywany w powiadomieniach jednokrotnych oraz w zapętlonym trybie budzika aż do potwierdzenia.
9. **Ergonomia pracy drużyny konduktorskiej:**
   - **Filtr trasy:** Przełącznik `[Mój odcinek DK]` vs `[Cała trasa]` umożliwiający natychmiastowe ukrycie stacji spoza bieżącej służby.
   - **Znaczniki stacji (Crew Tags):** Szybkie notatki drużyny przy stacjach (`♿ PRM`, `🚲 Rowery`, `⚠️ Krótki peron`, `👥 Grupa`, `⚡ Awaria drzwi`) widoczne na liście, w Hero HUD, widgecie oraz w powiadomieniach.
   - **Tryb nocny OLED True Black:** Trzybiegunowy przełącznik motywu (**Ciemny ➔ OLED ➔ Jasny**), optymalizujący zużycie baterii na wyświetlaczach AMOLED/OLED.
   - **Zróżnicowana haptyka wibracji:** Odrębny wzorzec wibracji dla stacji pośredniej oraz wydłużony, alarmujący dla stacji zmiany DK (zdania składu).
10. **Czuwak GPS, Odporność na utratę sygnału i Konfigurowalny Alarm:**
   - Wyznaczanie bieżącego odcinka szlaku (`Stacja A ➔ Stacja B`) ze wzmocnioną ochroną przed przerzucaniem pociągu za stację na łukach (*Kalisz Fix v2*).
   - **Odporność na utratę GPS / Internetu:** Po utracie sygnału GPS (np. w tunelu lub wagonie ekranowanym) włącza się nawigacja inercyjna (**Dead Reckoning**) na podstawie rozkładowej prędkości szlakowej.
   - **Suwak dystansu alarmu (1–15 km)** oraz wybór trybu powiadomienia (**Jednokrotne** vs **Tryb Budzika**).

---

## 🔄 Samodzielna aktualizacja `.apk` (bez Sklepu Google Play)

Aplikacja posiada wbudowany system samodzielnych aktualizacji over-the-air:
1. **Stały klucz podpisu (`android/app/czuwak-release.keystore`):** Każda kompilacja `.apk` jest podpisywana tym samym certyfikatem, dzięki czemu Android pozwala zainstalować nową wersję bezpośrednio na obecną („Aktualizuj”) **bez odinstalowywania i bez utraty pobranych rozkładów czy ustawień**.
2. **Automatyczne wydania GitHub Releases ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)):**
   - Po zmianie `APP_VERSION` / `APP_BUILD` w [`www/env.js`](www/env.js) i wypchnięciu kodu na gałąź `main`, GitHub Actions automatycznie buduje podpisany plik `.apk` i publikuje go w dwóch formatach:
     - **Wersjonowany:** `czuwak(v1.2.1)(13).apk` (format: `czuwak(vX.X.X)(XX).apk`), dzięki czemu pobrane instalatory w folderze *Pobrane* na telefonie posiadają jednoznaczną identyfikację wersji i kompilacji.
     - **Alias stały:** `czuwak.apk` (dla zachowania wstecznej kompatybilności ze stałymi odnośnikami).
     - Bezpośredni link: `https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak(v1.2.1)(13).apk` lub `https://github.com/piotrrgw/czuwak/releases/latest/download/czuwak.apk`.
3. **Wykrywanie aktualizacji w aplikacji:**
   - Przy starcie (oraz po kliknięciu **„Sprawdź aktualizację aplikacji (.apk)”** w menu bocznym) Czuwak porównuje swoją wersję z plikiem `www/env.js` na GitHubie oraz opcjonalnymi polami w Firestore (`system/db_status`: `latestCzuwakVersion`, `minCzuwakVersion`, `czuwakApkUrl`).
   - Gdy pojawi się nowsza wersja, wyświetla niebieski baner **„Dostępna nowa wersja Czuwaka! Kliknij, aby pobrać i zainstalować (.apk)”**, który pobiera plik z precyzyjną nazwą (np. `czuwak(v1.2.1)(13).apk`) i uruchamia instalator aktualizacji.

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
