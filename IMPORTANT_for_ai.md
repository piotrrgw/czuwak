# KRYTYCZNE ZASADY I INSTRUKCJE DLA SZTUCZNEJ INTELIGENCJI (AI)

Niniejszy plik definiuje nienaruszalne reguły wytwarzania kodu, zarządzania wersjami oraz utrzymania dokumentacji w projekcie **Asystent Kas Biletowych (AKB)**. Każdy model AI pracujący w repozytorium ma bezwzględny obowiązek stosowania się do poniższych wytycznych.

---

## 1. BIEŻĄCA AKTUALIZACJA DOKUMENTACJI TECHNICZNEJ (readme_ai.md)

* **Pojedyncze Źródło Prawdy (Single Source of Truth):** Plik `public/readme_ai.md` stanowi oficjalne, autorytatywne kompendium techniczne całego systemu AKB.
* **Obowiązek synchronizacji:** Po **każdej** zmianie kodu (dodaniu funkcji, refaktoryzacji, modyfikacji stylów, zmianie struktur danych Firestore czy poprawkach responsywności) musisz natychmiast zaktualizować `public/readme_ai.md`.
* **Zakres aktualizacji:**
  1. Aktualny numer wersji i numer kompilacji (`APP_VERSION`, `APP_BUILD`) w nagłówku dokumentu.
  2. Opis nowych lub zmodyfikowanych funkcji w odpowiedniej sekcji modułu.
  3. Ewentualne uaktualnienie diagramów przepływu Mermaid lub inwentarza funkcji.

---

## 2. KONTROLA WERSJONOWANIA I KOMPILACJI APLIKACJI (www/env.js)

* **Zasada oznaczania wersji i kompilacji w projekcie Czuwak:**
  Przy każdym wydaniu nowej wersji w pliku `www/env.js`:
  - **`APP_VERSION` podbijaj o `x.x.1` (`+0.0.1`)** – np. z `"v1.1.0"` na `"v1.1.1"`, następnie `"v1.1.2"`, itd.
  - **`APP_BUILD` podbijaj o pełne liczby całkowite (`+1`)** – np. z `"2"` na `"3"`, następnie `"4"`, itd.
* **Mechanizm Auto-Aktualizacji APK (`checkAppUpdate`):**
  Aplikacja porównuje zdalny plik `www/env.js` na gałęzi `main` GitHub (`https://raw.githubusercontent.com/piotrrgw/czuwak/main/www/env.js`) z lokalnym `window.APP_VERSION` oraz `window.APP_BUILD`. Podbicie `APP_VERSION` o `+0.0.1` oraz `APP_BUILD` o `+1` gwarantuje natychmiastowe wykrycie nowej wersji `.apk` przez wszystkie zainstalowane egzemplarze aplikacji.

---

## 3. OCHRONA PRZED BŁĘDAMI PARSERA MARKDOWN (CRITICAL WORKAROUND)

Z powodu znanych błędów parserów interfejsów czatu Markdown, które błędnie interpretują niektóre znaki i ucinają lub uszkadzają bloki kodu (szczególnie przy łączeniu HTML i JavaScriptu), bezwzględnie stosuj poniższe zasady:

### A. Bezwzględny zakaz template literals z HTML w kodzie JS
Nigdy nie łącz znaczników HTML z interpolacją zmiennych za pomocą grawisów/backticków (`) i `${}`. Używaj klasycznej konkatenacji stringów operatorem dodawania `+`.
* ❌ **ŹLE:** `const html = \`<div>${zmienna}</div>\`;`
* ✅ **DOBRZE:** `const html = "<div>" + zmienna + "</div>";`

### B. Kodowanie szesnastkowe (HEX) ostrych nawiasów w JS
Jeśli w pliku JavaScript dynamicznie budujesz lub przypisujesz elementy HTML (np. przez `.innerHTML` lub `.join('\x3Cbr\x3E')`), ostre nawiasy znaczników HTML musisz kodować szesnastkowo: znak `<` jako `\x3C`, a znak `>` jako `\x3E`.
* ❌ **ŹLE:** `return array.join('<br>');`
* ✅ **DOBRZE:** `return array.join('\x3Cbr\x3E');`
* ❌ **ŹLE:** `let btn = '<strong>Zapisz</strong>';`
* ✅ **DOBRZE:** `let btn = '\x3Cstrong\x3EZapisz\x3C/strong\x3E';`

### C. Rozbijanie encji HTML (Ochrona przed autokorektą)
Gdy w kodzie JS deklarujesz ciągi lub słowniki zawierające encje HTML, rozbijaj je operatorem dodawania:
* ❌ **ŹLE:** `'"': '&quot;'`
* ✅ **DOBRZE:** `'"': '&' + 'quot;'`

---

## 4. BEZPIECZEŃSTWO ZDARZEŃ I ATRYBUTY DANYCH (DATA ATTRIBUTES)

* **Zakaz przekazywania zmiennych tekstowych w inline `onclick`:**
  Nigdy nie przekazuj ciągów znaków (np. nazw stacji, kodów EPA, identyfikatorów) bezpośrednio w nawiasach atrybutu inline: `onclick="jumpToStation('" + stacja + "')"`. Jeśli nazwa stacji zawiera apostrof lub znaki specjalne (np. *Hel*, *d'Orsay*), przeglądarka zinterpretuje to jako błąd składni (SyntaxError).
* **Zawsze stosuj atrybuty danych (`dataset`):**
  * ❌ **ŹLE:** `'\x3Cdiv onclick="window.jumpToStation(\'' + escapeHTML(s) + '\')"\x3E'`
  * ✅ **DOBRZE:** `'\x3Cdiv data-stacja="' + escapeHTML(s) + '" onclick="window.jumpToStation(this.dataset.stacja)"\x3E'`

---

## 5. ERGONOMIA MOBILNA I OCHRONA BATERII

* **Wymiary dotykowe (Touch Targets):** Każdy element klikalny (przyciski, inputy, selektory) musi mieć minimalną wysokość `min-height: 44px - 48px` zgodnie ze standardami WCAG 2.2 / Apple HIG / Material Design.
* **Zarządzanie interwałami:** Przed uruchomieniem dowolnego cyklicznego `setInterval` upewnij się, że poprzedni timer został wyczyszczony (`clearInterval`), chroniąc baterię telefonów drużyn konduktorskich pracujących po 10-12 godzin na służbie.

---

## 6. CYKL PRACY: GIT, GITHUB, NPM I FIREBASE (PROCEDURY OPERACYJNE)

Asystent AI posiada bezpośredni dostęp do powłoki systemowej (zsh/macOS) i ma obowiązek stosować poniższe standardy w każdym cyklu pracy:

### A. Wymagane narzędzia w środowisku (terminal macOS)
* **Git & GitHub CLI:** `git --version`, `gh --version` (autoryzacja: `gh auth login`).
* **Node.js & npm:** `node -v`, `npm -v`.
* **Firebase CLI:** `npx -y firebase-tools@latest --version` lub globalne `firebase-tools`, autoryzacja `firebase login`.

### B. Weryfikacja przed rozpoczęciem zadań (Pre-check)
Zanim zmodyfikujesz jakikolwiek plik w projekcie:
1. Sprawdź stan drzewa roboczego: `git status`.
2. Pobierz aktualne referencje ze zdalnego repozytorium: `git fetch origin`.
3. Jeśli lokalna gałąź jest w tyle (`behind`), poinformuj o tym użytkownika i wykonaj bezpieczny `git pull --rebase` (pod warunkiem, że drzewo robocze jest czyste).
4. Jeśli w `package.json` zaszły zmiany lub pojawiły się nowe zależności, uruchom `npm install`.

### C. Zarządzanie zależnościami (npm)
* Przy pracach związanych z bibliotekami sprawdzaj stan pakietów przez `npm outdated`.
* Aktualizuj zależności kontrolowanie (`npm update` / `npm audit`).
* Po modyfikacjach zależności upewnij się, że projekt buduje się i działa poprawnie (`npm test` lub dedykowany proces budowania/weryfikacji).

### D. Zapisywanie zmian (Commit & Push)
* Po ukończeniu zadania i zweryfikowaniu działania kodu:
  1. Przejrzyj zmodyfikowane pliki: `git status` oraz `git diff`.
  2. Dodaj odpowiednie pliki do indeksu: `git add <pliki>` (unikaj ślepego dodawania plików tymczasowych).
  3. Utwórz commit zgodny z konwencją **Conventional Commits** (np. `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`).
  4. Wyślij zmiany na zdalne repozytorium: `git push origin <aktualna-gałąź>`.

### E. Wdrażanie do Firebase (Deploy)
* Jeśli zadanie wymaga wdrożenia lub synchronizacji danych/reguł Firebase:
  1. **Zawsze upewnij się lub zapytaj o potwierdzenie** przed wdrożeniem na środowisko produkcyjne (chyba że użytkownik wydał bezpośrednie polecenie deployu).
  2. Wykonaj odpowiednie polecenie:
     - Pełne wdrożenie: `firebase deploy`
     - Wyłącznie hosting: `firebase deploy --only hosting`
     - Wyłącznie reguły Firestore: `firebase deploy --only firestore:rules`

### F. Opcjonalna integracja: GitHub MCP Server
Asystent może bezpośrednio zarządzać Pull Requestami, zgłoszeniami (Issues) i gałęziami przez serwer **GitHub MCP** skonfigurowany w `~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<TWÓJ_TOKEN_GITHUB_Z_UPRAWNIENIAMI_REPO>"
      }
    }
  }
}
```
