// js/train.js
// Moduł odpowiedzialny za wstrzykiwanie SVG i renderowanie animowanego pociągu na szlaku

const trainAssets = 
    '\x3Csvg style="display: none;"\x3E' +
      '\x3Cdefs\x3E' +
        '<!-- ========================================== -->' +
        '<!-- LOKOMOTYWA ELEKTRYCZNA (Pc1: reflektory z przodu, bez czerwonego światła z tyłu) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-loco"\x3E' +
           '\x3Crect x="0" y="32" width="120" height="8" rx="2" fill="#1e293b"/\x3E' +
           '\x3Cpath d="M 0 32 L 0 10 Q 0 5 5 5 L 115 5 Q 120 5 120 10 L 120 32 Z" fill="#0284c7" stroke="#0369a1" stroke-width="0.8"/\x3E' +
           '\x3Crect x="0" y="24" width="120" height="4" fill="#38bdf8"/\x3E' +
           '\x3Cpath d="M 5 10 L 15 10 L 15 20 L 5 20 Z" fill="#0f172a"/\x3E' +
           '\x3Cpath d="M 105 10 L 115 10 L 115 20 L 105 20 Z" fill="#0f172a"/\x3E' +
           '\x3Crect x="30" y="12" width="15" height="8" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="52" y="12" width="15" height="8" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="75" y="12" width="15" height="8" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="20" y="8" width="8" height="24" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="92" y="8" width="8" height="24" rx="1" fill="#0f172a"/\x3E' +
           '\x3Ccircle cx="20" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="35" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="85" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="100" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Crect x="120" y="34" width="4" height="4" fill="#1e293b"/\x3E' +
           '\x3Crect x="-4" y="34" width="4" height="4" fill="#1e293b"/\x3E' +
           '<!-- Reflektory czołowe Pc1 (trzy białe/żółte światła z przodu) -->' +
           '\x3Ccircle cx="114" cy="8" r="2.5" fill="#fef08a"/\x3E' +
           '\x3Ccircle cx="118" cy="26" r="3" fill="#fef08a"/\x3E' +
           '\x3Ccircle cx="118" cy="33" r="2.5" fill="#fef08a"/\x3E' +
           '\x3Cpolygon points="120,22 144,16 144,37 120,35" fill="#fef08a" opacity="0.25"/\x3E' +
           '<!-- Pantografy -->' +
           '\x3Cpath d="M 20 5 L 30 2 L 40 5" stroke="#94a3b8" stroke-width="1.5" fill="none"/\x3E' +
           '\x3Cpath d="M 80 5 L 90 -5 L 100 5 M 85 -5 L 95 -5" stroke="#94a3b8" stroke-width="1.5" fill="none"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- PAROWÓZ ZABYTKOWY (Natywnie zwrócony w prawo, wysoki kontrast dark mode, dym z komina) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-steam-loco"\x3E' +
           '<!-- Ostoja czerwona -->' +
           '\x3Crect x="6" y="34" width="132" height="4" fill="#dc2626" stroke="#991b1b" stroke-width="0.8"/\x3E' +
           '<!-- Budka maszynisty (z lewej) -->' +
           '\x3Crect x="8" y="6" width="36" height="28" rx="2" fill="#1e293b" stroke="#64748b" stroke-width="1"/\x3E' +
           '\x3Cpath d="M 4 6 L 46 6 L 44 4 L 6 4 Z" fill="#0f172a" stroke="#475569" stroke-width="0.8"/\x3E' +
           '\x3Crect x="18" y="10" width="16" height="12" rx="2" fill="#fef08a" stroke="#334155" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="26" cy="16" r="3" fill="#1e293b"/\x3E' +
           '<!-- Kocioł parowozu z mosiężnymi opaskami -->' +
           '\x3Crect x="42" y="10" width="74" height="24" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/\x3E' +
           '\x3Crect x="56" y="10" width="2.5" height="24" fill="#f59e0b"/\x3E' +
           '\x3Crect x="78" y="10" width="2.5" height="24" fill="#f59e0b"/\x3E' +
           '\x3Crect x="100" y="10" width="2.5" height="24" fill="#f59e0b"/\x3E' +
           '\x3Cline x1="44" y1="13" x2="116" y2="13" stroke="#cbd5e1" stroke-width="1"/\x3E' +
           '<!-- Zbieralnik pary i piasecznica -->' +
           '\x3Crect x="64" y="4" width="14" height="8" rx="4" fill="#334155" stroke="#64748b" stroke-width="0.8"/\x3E' +
           '\x3Crect x="86" y="5" width="12" height="7" rx="3" fill="#334155" stroke="#64748b" stroke-width="0.8"/\x3E' +
           '<!-- Dymnica, komin i kłęby pary -->' +
           '\x3Crect x="114" y="8" width="22" height="26" rx="2" fill="#0f172a" stroke="#64748b" stroke-width="1"/\x3E' +
           '\x3Crect x="122" y="1" width="8" height="9" rx="1" fill="#0f172a" stroke="#475569" stroke-width="0.8"/\x3E' +
           '\x3Cpath d="M 120 1 L 132 1 L 130 3 L 122 3 Z" fill="#64748b"/\x3E' +
           '<!-- Kłęby dymu i pary z komina -->' +
           '\x3Ccircle class="steam-puff puff-1" cx="126" cy="0" r="3.5"/\x3E' +
           '\x3Ccircle class="steam-puff puff-2" cx="126" cy="0" r="3.5"/\x3E' +
           '\x3Ccircle class="steam-puff puff-3" cx="126" cy="0" r="3.5"/\x3E' +
           '<!-- Wiatrownica dymnicy -->' +
           '\x3Cpath d="M 128 8 L 138 8 L 136 32 L 128 32 Z" fill="#334155" stroke="#94a3b8" stroke-width="0.8"/\x3E' +
           '<!-- Reflektor czołowy Pc1 (garnek parowozowy z przodu) -->' +
           '\x3Crect x="134" y="22" width="7" height="8" rx="1" fill="#334155" stroke="#94a3b8" stroke-width="0.8"/\x3E' +
           '\x3Ccircle cx="139" cy="26" r="3" fill="#fef08a"/\x3E' +
           '\x3Ccircle cx="126" cy="7" r="2" fill="#fef08a"/\x3E' +
           '\x3Cpolygon points="142,22 155,15 155,36 142,29" fill="#fef08a" opacity="0.3"/\x3E' +
           '<!-- Belka zderzakowa i zgarniacz -->' +
           '\x3Crect x="134" y="32" width="8" height="4" fill="#dc2626"/\x3E' +
           '\x3Cpolygon points="138,36 144,36 142,40 136,40" fill="#dc2626"/\x3E' +
           '<!-- Czerwone koła napędowe ze szprychami -->' +
           '\x3Ccircle cx="48" cy="35" r="9" fill="#0f172a" stroke="#ef4444" stroke-width="2.5"/\x3E' +
           '\x3Ccircle cx="74" cy="35" r="9" fill="#0f172a" stroke="#ef4444" stroke-width="2.5"/\x3E' +
           '\x3Ccircle cx="100" cy="35" r="9" fill="#0f172a" stroke="#ef4444" stroke-width="2.5"/\x3E' +
           '\x3Ccircle cx="48" cy="35" r="3" fill="#cbd5e1"/\x3E' +
           '\x3Ccircle cx="74" cy="35" r="3" fill="#cbd5e1"/\x3E' +
           '\x3Ccircle cx="100" cy="35" r="3" fill="#cbd5e1"/\x3E' +
           '\x3Ccircle cx="124" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '\x3Ccircle cx="22" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '<!-- Wiązary i cylinder -->' +
           '\x3Crect x="46" y="34" width="56" height="2.5" rx="1" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.5"/\x3E' +
           '\x3Cline x1="74" y1="35" x2="108" y2="28" stroke="#f1f5f9" stroke-width="2"/\x3E' +
           '\x3Crect x="106" y="26" width="12" height="6" rx="1" fill="#334155" stroke="#94a3b8" stroke-width="0.6"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- TENDER PAROWOZU (Zwrócony w prawo, sprzęgnięty z budką maszynisty) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-tender"\x3E' +
           '\x3Crect x="4" y="34" width="88" height="4" fill="#dc2626" stroke="#991b1b" stroke-width="0.8"/\x3E' +
           '\x3Ccircle cx="18" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '\x3Ccircle cx="36" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '\x3Ccircle cx="58" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '\x3Ccircle cx="76" cy="38" r="6" fill="#0f172a" stroke="#ef4444" stroke-width="1.8"/\x3E' +
           '\x3Crect x="4" y="14" width="88" height="20" rx="2" fill="#1e293b" stroke="#64748b" stroke-width="1"/\x3E' +
           '\x3Cpath d="M 2 14 L 92 14 L 90 12 L 4 12 Z" fill="#334155"/\x3E' +
           '\x3Cpath d="M 12 12 Q 30 5 50 8 Q 65 3 80 12 Z" fill="#0f172a" stroke="#334155" stroke-width="0.8"/\x3E' +
           '\x3Crect x="0" y="12" width="4" height="22" fill="#0f172a"/\x3E' +
           '\x3Crect x="91" y="24" width="4" height="10" fill="#475569"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- WAGON POŚREDNI (Bez świateł końcowych) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-wagon"\x3E' +
           '\x3Cpath d="M 0 32 L 0 5 Q 0 2 2 2 L 138 2 Q 140 2 140 5 L 140 32 Z" fill="currentColor"/\x3E' +
           '\x3Crect x="0" y="32" width="140" height="8" fill="#1e293b"/\x3E' +
           '\x3Crect x="0" y="22" width="140" height="2" fill="rgba(255,255,255,0.3)"/\x3E' +
           '\x3Crect x="10" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="26" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="42" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="58" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="74" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="90" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="106" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="122" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="2" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Crect x="132" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Ccircle cx="25" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="40" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="100" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="115" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Crect x="-4" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
           '\x3Crect x="140" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- WAGON COMBO (Drzwi bagażowo-rowerowe) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-combo"\x3E' +
           '\x3Cpath d="M 0 32 L 0 5 Q 0 2 2 2 L 138 2 Q 140 2 140 5 L 140 32 Z" fill="currentColor"/\x3E' +
           '\x3Crect x="0" y="32" width="140" height="8" fill="#1e293b"/\x3E' +
           '\x3Crect x="0" y="22" width="140" height="2" fill="rgba(255,255,255,0.3)"/\x3E' +
           '\x3Crect x="10" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="26" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="58" y="5" width="24" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Crect x="90" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="106" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="122" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="2" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Crect x="132" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Ccircle cx="25" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="40" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="100" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="115" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Crect x="-4" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
           '\x3Crect x="140" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- WAGON KOŃCOWY (Tb1/Pc2: czerwone sygnały końca pociągu na tylnej ścianie) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-wagon-end"\x3E' +
           '\x3Cpath d="M 0 32 L 0 5 Q 0 2 2 2 L 138 2 Q 140 2 140 5 L 140 32 Z" fill="currentColor"/\x3E' +
           '\x3Crect x="0" y="32" width="140" height="8" fill="#1e293b"/\x3E' +
           '\x3Crect x="0" y="22" width="140" height="2" fill="rgba(255,255,255,0.3)"/\x3E' +
           '\x3Crect x="10" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="26" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="42" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="58" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="74" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="90" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="106" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="122" y="8" width="12" height="10" rx="1" fill="#0f172a"/\x3E' +
           '\x3Crect x="2" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Crect x="132" y="5" width="6" height="27" rx="0.5" fill="#0f172a" opacity="0.8"/\x3E' +
           '\x3Ccircle cx="25" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="40" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="100" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Ccircle cx="115" cy="40" r="5" fill="#0f172a" stroke="#94a3b8" stroke-width="1"/\x3E' +
           '\x3Crect x="140" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
           '<!-- Ściana czołowa zderzaka i sygnałów końca pociągu (z lewej) -->' +
           '\x3Crect x="-4" y="5" width="4" height="27" fill="#0f172a"/\x3E' +
           '\x3Crect x="-4" y="34" width="4" height="4" fill="#1e293b"/\x3E' +
           '<!-- Czerwone sygnały końca pociągu (Pc2 / Tb1) -->' +
           '\x3Ccircle cx="2" cy="26" r="3" fill="#ef4444"/\x3E' +
           '\x3Ccircle cx="2" cy="34" r="2.5" fill="#ef4444"/\x3E' +
           '\x3Ccircle cx="3" cy="7" r="2" fill="#ef4444"/\x3E' +
           '\x3Ccircle cx="0" cy="28" r="8" fill="#ef4444" opacity="0.25"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- SCENERIA KOLEJOWA (Słup trakcji, Drzewa, Semafor, Przejazd, Dworzec) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-catenary-pole"\x3E' +
            '\x3Crect x="6" y="2" width="4" height="46" fill="#64748b"/\x3E' +
            '\x3Cline x1="6" y1="5" x2="10" y2="10" stroke="#475569" stroke-width="0.8"/\x3E' +
            '\x3Cline x1="10" y1="10" x2="6" y2="15" stroke="#475569" stroke-width="0.8"/\x3E' +
            '\x3Cline x1="6" y1="15" x2="10" y2="20" stroke="#475569" stroke-width="0.8"/\x3E' +
            '\x3Cline x1="10" y1="20" x2="6" y2="25" stroke="#475569" stroke-width="0.8"/\x3E' +
            '\x3Cline x1="6" y1="25" x2="10" y2="30" stroke="#475569" stroke-width="0.8"/\x3E' +
            '\x3Crect x="4" y="44" width="8" height="6" fill="#94a3b8"/\x3E' +
            '\x3Cpath d="M 8 6 L 26 2 L 26 8" stroke="#64748b" stroke-width="1.2" fill="none"/\x3E' +
            '\x3Cline x1="8" y1="12" x2="26" y2="8" stroke="#64748b" stroke-width="1"/\x3E' +
            '\x3Crect x="24" y="7" width="4" height="3" rx="1" fill="#84cc16"/\x3E' +
            '\x3Cline x1="0" y1="10" x2="35" y2="10" stroke="#94a3b8" stroke-width="0.7"/\x3E' +
        '\x3C/g\x3E' +

        '\x3Cg id="pkp-trees"\x3E' +
            '\x3Crect x="14" y="18" width="3" height="30" fill="#78350f"/\x3E' +
            '\x3Cpolygon points="15,4 6,24 24,24" fill="#15803d"/\x3E' +
            '\x3Cpolygon points="15,10 8,28 22,28" fill="#166534"/\x3E' +
            '\x3Crect x="30" y="20" width="2.5" height="28" fill="#f8fafc" stroke="#1e293b" stroke-width="0.4"/\x3E' +
            '\x3Ccircle cx="31" cy="18" r="8" fill="#4ade80" opacity="0.9"/\x3E' +
            '\x3Ccircle cx="34" cy="15" r="6" fill="#22c55e" opacity="0.9"/\x3E' +
            '\x3Cellipse cx="44" cy="42" rx="7" ry="5" fill="#16a34a"/\x3E' +
        '\x3C/g\x3E' +

        '\x3Cg id="pkp-semaphore"\x3E' +
            '\x3Crect x="13" y="10" width="4" height="40" fill="#94a3b8"/\x3E' + 
            '\x3Crect x="13" y="15" width="4" height="5" fill="#dc2626"/\x3E' +
            '\x3Crect x="13" y="25" width="4" height="5" fill="#dc2626"/\x3E' +
            '\x3Crect x="9" y="0" width="12" height="20" rx="2" fill="#111827"/\x3E' +
            '\x3Ccircle cx="15" cy="5" r="3" fill="#22c55e"/\x3E' +
            '\x3Cpath d="M 10 2 L 20 2 L 18 0 L 12 0 Z" fill="#374151"/\x3E' +
            '\x3Ccircle cx="15" cy="13" r="3" fill="#dc2626" opacity="0.3"/\x3E' +
            '\x3Cpath d="M 10 10 L 20 10 L 18 8 L 12 8 Z" fill="#374151"/\x3E' +
        '\x3C/g\x3E' +

        '\x3Cg id="pkp-crossing"\x3E' +
            '\x3Crect x="18" y="20" width="4" height="30" fill="#94a3b8"/\x3E' +
            '\x3Crect x="18" y="25" width="4" height="4" fill="#dc2626"/\x3E' +
            '\x3Crect x="18" y="35" width="4" height="4" fill="#dc2626"/\x3E' +
            '\x3Crect x="10" y="10" width="20" height="10" rx="2" fill="#111827"/\x3E' +
            '\x3Ccircle cx="15" cy="15" r="3" fill="#dc2626" class="blink-1"/\x3E' +
            '\x3Ccircle cx="25" cy="15" r="3" fill="#dc2626" class="blink-2"/\x3E' +
            '\x3Cpath d="M 12 2 L 28 8 M 12 8 L 28 2" stroke="#f8fafc" stroke-width="3"/\x3E' +
            '\x3Cpath d="M 13 3 L 27 7 M 13 7 L 27 3" stroke="#dc2626" stroke-width="1.5"/\x3E' +
            '\x3Cpolygon points="20,25 70,5 72,9 22,29" fill="#f8fafc"/\x3E' +
            '\x3Cpolygon points="30,21 40,17 41,21 31,25" fill="#dc2626"/\x3E' +
            '\x3Cpolygon points="50,13 60,9 61,13 51,17" fill="#dc2626"/\x3E' +
        '\x3C/g\x3E' +

        '<!-- ========================================== -->' +
        '<!-- DWORZEC KOLEJOWY (Architektura ceglana) -->' +
        '<!-- ========================================== -->' +
        '\x3Cg id="pkp-station-dworzec"\x3E' +
            '<!-- Lewy pawilon piętrowy -->' +
            '\x3Crect x="8" y="24" width="66" height="52" fill="#991b1b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Cpolygon points="4,24 41,5 78,24" fill="#450a0a"/\x3E' +
            '\x3Crect x="8" y="48" width="66" height="3" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="6" y="24" width="70" height="2" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="16" y="29" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="36" y="29" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="56" y="29" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="16" y="55" width="10" height="16" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="36" y="55" width="10" height="16" rx="2" fill="#1e293b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="56" y="55" width="10" height="16" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="22" y="1" width="6" height="10" fill="#7f1d1d"/\x3E' +

            '<!-- Skrzydło środkowe (parterowe) -->' +
            '\x3Crect x="74" y="34" width="132" height="42" fill="#b91c1c" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Cpolygon points="74,34 140,26 206,34" fill="#571010"/\x3E' +
            '\x3Cpolygon points="94,30 101,23 108,30" fill="#450a0a"/\x3E' +
            '\x3Cpolygon points="172,30 179,23 186,30" fill="#450a0a"/\x3E' +
            '\x3Crect x="74" y="36" width="132" height="2" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="84" y="48" width="12" height="22" rx="2" fill="#1e293b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="104" y="48" width="12" height="22" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="164" y="48" width="12" height="22" rx="2" fill="#1e293b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="184" y="48" width="12" height="22" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '<!-- Budka dyżurnego ruchu na peronie -->' +
            '\x3Crect x="124" y="50" width="32" height="26" rx="1" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/\x3E' +
            '\x3Cpolygon points="122,50 140,43 158,50" fill="#475569"/\x3E' +
            '\x3Crect x="134" y="55" width="12" height="10" fill="#fef08a" stroke="#475569" stroke-width="0.7"/\x3E' +
            '\x3Crect x="128" y="58" width="4" height="16" fill="#334155"/\x3E' +
            '\x3Crect x="126" y="38" width="28" height="6" rx="1" fill="#1e293b" stroke="#f8fafc" stroke-width="0.5"/\x3E' +
            '\x3Ctext x="140" y="43" font-size="4" fill="#f8fafc" font-family="sans-serif" font-weight="900" text-anchor="middle"\x3EDWORZEC\x3C/text\x3E' +

            '<!-- Prawy pawilon piętrowy -->' +
            '\x3Crect x="206" y="20" width="68" height="56" fill="#991b1b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Cpolygon points="202,20 240,4 278,20" fill="#450a0a"/\x3E' +
            '\x3Cpath d="M 230 12 Q 240 6 250 12 Z" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="206" y="46" width="68" height="3" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="204" y="20" width="72" height="2" fill="#7f1d1d"/\x3E' +
            '\x3Crect x="215" y="26" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="235" y="26" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="255" y="26" width="10" height="14" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="215" y="52" width="10" height="18" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="235" y="52" width="10" height="18" rx="2" fill="#1e293b" stroke="#7f1d1d" stroke-width="1"/\x3E' +
            '\x3Crect x="255" y="52" width="10" height="18" rx="2" fill="#fef08a" stroke="#7f1d1d" stroke-width="1"/\x3E' +

            '<!-- Latarnia peronowa -->' +
            '\x3Cline x1="288" y1="32" x2="288" y2="76" stroke="#475569" stroke-width="2"/\x3E' +
            '\x3Cpath d="M 284 32 Q 288 27 292 32 Z" fill="#334155"/\x3E' +
            '\x3Ccircle cx="288" cy="34" r="2.5" fill="#fef08a"/\x3E' +
            '\x3Cpolygon points="278,76 288,36 298,76" fill="#fef08a" opacity="0.15"/\x3E' +
        '\x3C/g\x3E' +
      '\x3C/defs\x3E' +
    '\x3C/svg\x3E';

// Wstrzyknięcie zasobów SVG do drzewa DOM
function injectTrainSvgAssets() {
    if (document.getElementById('akb-train-svg-defs')) return;
    const div = document.createElement("div");
    div.id = 'akb-train-svg-defs';
    div.style.display = 'none';
    div.innerHTML = trainAssets;
    document.body.appendChild(div);
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", injectTrainSvgAssets);
} else {
    injectTrainSvgAssets();
}

// Pamięć podręczna składu pociągu (12 godzin) – eliminuje ciągłe losowanie i miganie taboru
const TRAIN_COMPOSITION_CACHE_PREFIX = 'AKB_TRAIN_PLAN_';
const TRAIN_COMPOSITION_TTL_MS = 12 * 60 * 60 * 1000; // 12 godzin

function getTrainCompositionPlan(trainKey) {
    const key = String(trainKey || window._currentActiveTrainNumber || window.lastSearchedTrainNum || 'DEFAULT').trim();
    const storageKey = TRAIN_COMPOSITION_CACHE_PREFIX + key;
    
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.cars) && parsed.cars.length > 0 && (Date.now() - parsed.ts) < TRAIN_COMPOSITION_TTL_MS) {
                return parsed;
            }
        }
    } catch (e) {}

    // Generujemy nowy, stabilny plan składu na 12 godzin
    const isSteam = Math.random() < 0.2;
    const totalCarsCount = Math.floor(Math.random() * 5) + 3; // Od 3 do 7 wagonów
    const generatedCars = [];

    for (let i = 0; i < totalCarsCount; i++) {
        const isLastCar = (i === totalCarsCount - 1);
        let cls = 'kl2';
        let type = isLastCar ? '#pkp-wagon-end' : '#pkp-wagon';

        if (!isLastCar && i === Math.floor(totalCarsCount / 2)) {
            cls = 'wars';
        } else if (!isLastCar && i === Math.floor(totalCarsCount / 2) + 1 && Math.random() > 0.5) {
            cls = '';
            type = '#pkp-combo';
        } else if (i > totalCarsCount / 2) {
            cls = 'kl1';
        }
        generatedCars.push({ cls: cls, type: type });
    }

    const plan = { isSteam: isSteam, cars: generatedCars, ts: Date.now() };
    try {
        localStorage.setItem(storageKey, JSON.stringify(plan));
    } catch (e) {}
    return plan;
}

// Pomocniczy generator wagonów składu wagonowego (ze stabilnego planu 12h)
function buildTrainCarsHtml(limitCars, isStanding, trainKey) {
    const plan = getTrainCompositionPlan(trainKey);
    let html = '';
    const extraCarCls = isStanding ? ' t-car-standing' : '';

    if (plan.isSteam) {
        // Parowóz i tender są natywnie narysowane w prawo - brak potrzeby obracania/flip-x
        html += '\x3Csvg viewBox="0 0 145 45" class="t-car loco' + extraCarCls + '"\x3E\x3Cuse href="#pkp-steam-loco"/\x3E\x3C/svg\x3E';
        html += '\x3Csvg viewBox="0 0 95 45" class="t-car loco' + extraCarCls + '"\x3E\x3Cuse href="#pkp-tender"/\x3E\x3C/svg\x3E';
    } else {
        // Nowoczesna lokomotywa elektryczna z reflektorami Pc1 z przodu
        html += '\x3Csvg viewBox="0 0 125 45" class="t-car loco' + extraCarCls + '"\x3E\x3Cuse href="#pkp-loco"/\x3E\x3C/svg\x3E';
    }

    const maxCarsToShow = Math.max(1, limitCars - 1);
    const carsToShow = plan.cars.slice(0, maxCarsToShow);
    
    // Gwarancja: ostatni widoczny wagon w składzie to zawsze wagon końcowy z czerwonymi światłami końca pociągu Pc2/Tb1
    if (carsToShow.length > 0) {
        const lastIdx = carsToShow.length - 1;
        carsToShow[lastIdx] = {
            cls: carsToShow[lastIdx].cls === 'wars' ? 'wars' : 'kl2',
            type: '#pkp-wagon-end'
        };
    }

    carsToShow.forEach(c => {
        html += '\x3Csvg viewBox="0 0 140 45" class="t-car ' + c.cls + extraCarCls + '"\x3E\x3Cuse href="' + c.type + '"/\x3E\x3C/svg\x3E';
    });

    return html;
}

// Główny generator pociągu w ruchu (na szlaku) z bogatą, zróżnicowaną scenerią
window.getTrainIndicatorHTML = function(maxCars = 8, trainKey = '') {
    const screenWidth = window.innerWidth;
    const limitCars = screenWidth < 500 ? 4 : (screenWidth < 900 ? 6 : maxCars);
    const trainHtml = buildTrainCarsHtml(limitCars, false, trainKey);

    return '\x3Cdiv class="scenery-layer"\x3E' +
        '\x3Csvg viewBox="0 0 35 50" class="scenery-item scenery-catenary"\x3E\x3Cuse href="#pkp-catenary-pole"/\x3E\x3C/svg\x3E' +
        '\x3Csvg viewBox="0 0 55 50" class="scenery-item scenery-trees"\x3E\x3Cuse href="#pkp-trees"/\x3E\x3C/svg\x3E' +
        '\x3Csvg viewBox="0 0 30 50" class="scenery-item scenery-semaphore"\x3E\x3Cuse href="#pkp-semaphore"/\x3E\x3C/svg\x3E' +
        '\x3Csvg viewBox="0 0 80 50" class="scenery-item scenery-crossing"\x3E\x3Cuse href="#pkp-crossing"/\x3E\x3C/svg\x3E' +
        '\x3Csvg viewBox="0 0 300 80" class="scenery-item scenery-station-pass" preserveAspectRatio="xMidYMax meet"\x3E\x3Cuse href="#pkp-station-dworzec"/\x3E\x3C/svg\x3E' +
    '\x3C/div\x3E' +
    '\x3Cdiv class="train-track-moving"\x3E\x3C/div\x3E' +
    '\x3Cdiv class="train-composition"\x3E' +
        trainHtml +
    '\x3C/div\x3E';
};

// Generator pociągu stojącego na stacji przy zabytkowym dworcu ceglanym (bez poruszających się torów)
window.getStandingTrainIndicatorHTML = function(maxCars = 6, stationName = '', trainKey = '') {
    const screenWidth = window.innerWidth;
    const limitCars = screenWidth < 500 ? 3 : (screenWidth < 900 ? 5 : maxCars);
    const trainHtml = buildTrainCarsHtml(limitCars, true, trainKey);

    return '\x3Cdiv class="station-scenery-layer"\x3E' +
        '\x3Csvg viewBox="0 0 300 80" class="station-dworzec-svg" preserveAspectRatio="xMidYMax meet"\x3E' +
            '\x3Cuse href="#pkp-station-dworzec"/\x3E' +
        '\x3C/svg\x3E' +
    '\x3C/div\x3E' +
    '\x3Cdiv class="train-platform-strip"\x3E\x3C/div\x3E' +
    '\x3Cdiv class="train-track-static"\x3E\x3C/div\x3E' +
    '\x3Cdiv class="train-composition train-composition-standing"\x3E' +
        trainHtml +
    '\x3C/div\x3E';
};