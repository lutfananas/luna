/*
 * Key Level Confluence & Target Zones [PhenLabs] — indikator + versi strategy untuk Luna.
 *
 * Kode asli: © PhenLabs, Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/).
 * File ini adalah karya turunan dan tetap berlisensi MPL-2.0.
 * Perubahan untuk Luna:
 *  - enum → input.string, tipe Ledger/PlanDraw → array (engine Luna belum mendukung UDT/method)
 *  - gambar memakai xloc bar_index, teks antarmuka sebagian berbahasa Indonesia
 *  - input tambahan "Arah trade" (default Long & Short = perilaku asli)
 *  - versi strategy: order sungguhan mengikuti rencana profil yang dipilih
 *    (masuk di open bar berikutnya, 50/30/20 di TP1/TP2/TP3, SL ke BE setelah TP1, time exit)
 */
(function (root) {
  'use strict';

  const LICENSE = `// This Pine Script® code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © PhenLabs — Key Level Confluence & Target Zones
// Diadaptasi untuk Luna (enum → input.string, UDT → array, + versi strategy). Tetap MPL-2.0.`;

  const COMMON = String.raw`
// ═════════════ INPUTS ═════════════
G1 = "Signals"
G2 = "Confluence Zones"
G3 = "Trade Plan"
G4 = "Display"
iMode    = input.string("Both (Hold + Breakout)", "Trade Mode", options = ["Both (Hold + Breakout)", "Hold Reversals Only", "Confirmed Breakouts Only"], group = G1, tooltip = "HOLD = harga menolak zona confluence lalu close keluar zona. BREAKOUT = harga close tegas menembus zona.")
iProf    = input.string("Auto (Best EV)", "Profile", options = ["Auto (Best EV)", "Balanced", "Strict 3x+ Stack", "Scalp Fast", "Swing Wide"], group = G1, tooltip = "Auto memakai profil dengan rata-rata R terbaik sejauh ini (minimal 3 trade selesai). Auto punya catatan live sendiri.")
iSide    = input.string("Long & Short", "Arah trade", options = ["Long & Short", "Long saja", "Short saja"], group = G1, tooltip = "Tambahan Luna. Default = perilaku asli (dua arah).")
iPiv     = input.string("Traditional", "Pivot Formula", options = ["Traditional", "Fibonacci", "Camarilla"], group = G2, tooltip = "Rumus pivot harian & mingguan.")
iTol     = input.float(0.35, "Merge Tolerance (ATR)", minval = 0.05, maxval = 1.5, step = 0.05, group = G2, tooltip = "Level yang berdekatan (dalam ATR) digabung jadi satu zona.")
iMinSrc  = input.int(2, "Min Sources per Zone", minval = 2, maxval = 6, group = G2, tooltip = "Tiap zona butuh minimal satu level high/low/swing + satu level pivot/angka bulat.")
iSwing   = input.int(10, "Swing Length", minval = 3, maxval = 50, group = G2)
iRound   = input.bool(true, "Include Round Numbers", group = G2)
iSlBuf   = input.float(0.25, "Stop Buffer (ATR)", minval = 0.0, maxval = 2.0, step = 0.05, group = G3, tooltip = "Ruang ekstra di luar tepi zona & sumbu candle sinyal. Jarak stop dibatasi 0.5–3.0 ATR.")
iR1      = input.float(1.0, "TP1 (R)", minval = 0.3, step = 0.1, group = G3)
iR2      = input.float(2.0, "TP2 (R)", minval = 0.5, step = 0.1, group = G3)
iR3      = input.float(3.0, "TP3 (R)", minval = 0.8, step = 0.1, group = G3, tooltip = "Balanced/Strict memakai nilai ini. Scalp ×0.75, Swing ×1.5. Scale-out 50% TP1, 30% TP2, 20% TP3. Stop ke break-even setelah TP1.")
iMagnet  = input.bool(true, "Snap TP2 to Next Opposing Zone", group = G3)
iMaxBars = input.int(60, "Time Exit (bars)", minval = 5, maxval = 400, group = G3)
showPlan = input.bool(true, "Gambar zona & level", group = G4)
iHist    = input.int(4, "Past Plans Shown", minval = 1, maxval = 12, group = G4)
iZones   = input.int(4, "Zones Shown", minval = 1, maxval = 10, group = G4)
iTbl     = input.string("Small", "Table Size", options = ["Tiny", "Small", "Normal"], group = G4)
bullC    = input.color(#00E5A8, "Bull", group = G4)
bearC    = input.color(#FF4D6D, "Bear", group = G4)
zoneC    = input.color(#F5C542, "Zone", group = G4)

// ═════════════ HELPERS ═════════════
f_piv(pt, h, l, c) =>
    p  = (h + l + c) / 3.0
    rg = h - l
    float r1 = na
    float r2 = na
    float r3 = na
    float s1 = na
    float s2 = na
    float s3 = na
    if pt == 0
        r1 := 2.0 * p - l
        s1 := 2.0 * p - h
        r2 := p + rg
        s2 := p - rg
        r3 := h + 2.0 * (p - l)
        s3 := l - 2.0 * (h - p)
    else if pt == 1
        r1 := p + 0.382 * rg
        s1 := p - 0.382 * rg
        r2 := p + 0.618 * rg
        s2 := p - 0.618 * rg
        r3 := p + rg
        s3 := p - rg
    else
        r1 := c + rg * 1.1 / 12.0
        s1 := c - rg * 1.1 / 12.0
        r2 := c + rg * 1.1 / 6.0
        s2 := c - rg * 1.1 / 6.0
        r3 := c + rg * 1.1 / 4.0
        s3 := c - rg * 1.1 / 4.0
    [p, r1, r2, r3, s1, s2, s3]

// src: 0 = struktur (high/low/swing), 1 = rumus (pivot/angka bulat). tier: 2 mingguan, 1 harian, 3 swing, 0 bulat
f_add(ap, aSrc, at, an, v, src, tier, nm) =>
    if not na(v)
        array.push(ap, v)
        array.push(aSrc, src)
        array.push(at, tier)
        array.push(an, nm)
    true

f_final(cnt, hasS, hasF, wk, sw, lo, hi, minSrc, atrX) =>
    ok    = cnt >= minSrc and hasS and hasF
    mid   = (lo + hi) / 2.0
    hh    = math.max(hi - lo, 0.12 * atrX)
    score = math.min(100.0, math.min(cnt, 5) * 18.0 + (wk ? 8.0 : 0.0) + (sw ? 6.0 : 0.0))
    [ok, mid + hh / 2.0, mid - hh / 2.0, score]

// minScore, wick, body, breakout buffer, activity, R scale, stop multiplier
f_params(p) =>
    float minS = 36.0
    float wk   = 0.35
    float bd   = 0.50
    float buf  = 0.10
    float act  = 0.90
    float rsc  = 1.0
    float slm  = 1.0
    if p == 1
        minS := 54.0
        wk   := 0.45
        bd   := 0.60
        buf  := 0.15
        act  := 1.10
    else if p == 2
        wk   := 0.30
        bd   := 0.45
        buf  := 0.05
        act  := 0.80
        rsc  := 0.75
        slm  := 0.75
    else if p == 3
        wk   := 0.40
        bd   := 0.55
        buf  := 0.20
        act  := 1.00
        rsc  := 1.5
        slm  := 1.5
    [minS, wk, bd, buf, act, rsc, slm]

f_pname(p) =>
    p == 0 ? "Balanced" : p == 1 ? "Strict 3x+" : p == 2 ? "Scalp Fast" : p == 3 ? "Swing Wide" : "Auto (live)"

// ═════════════ CORE SERIES ═════════════
atrV   = ta.atr(14)
hasVol = ta.cum(nz(volume)) > 0
volMa  = ta.sma(volume, 20)
actV   = hasVol ? nz(volume) / math.max(nz(volMa), 1e-9) : (high - low) / math.max(nz(atrV), 1e-9)
prevC  = nz(close[1], close)

useD = timeframe.in_seconds() <= 86400
useW = timeframe.in_seconds() <= 604800

// candle harian / mingguan SEBELUMNYA (sudah close → tidak repaint)
[pdh, pdl, pdc] = request.security(syminfo.tickerid, "D", [high[1], low[1], close[1]], lookahead = barmerge.lookahead_on)
[pwh, pwl, pwc] = request.security(syminfo.tickerid, "W", [high[1], low[1], close[1]], lookahead = barmerge.lookahead_on)

pt = iPiv == "Traditional" ? 0 : iPiv == "Fibonacci" ? 1 : 2
[dP, dR1, dR2, dR3, dS1, dS2, dS3] = f_piv(pt, pdh, pdl, pdc)
[wP, wR1, wR2, wR3, wS1, wS2, wS3] = f_piv(pt, pwh, pwl, pwc)

ph = ta.pivothigh(high, iSwing, iSwing)
pl = ta.pivotlow(low, iSwing, iSwing)
var float sh1 = na
var float sh2 = na
var float sl1 = na
var float sl2 = na
if not na(ph)
    sh2 := sh1
    sh1 := ph
if not na(pl)
    sl2 := sl1
    sl1 := pl

rStep = close > 0 ? math.pow(10.0, math.floor(math.log10(close)) - 1.0) * 5.0 : na
rnDn  = na(rStep) ? na : math.floor(close / rStep) * rStep
rnUp  = na(rStep) ? na : rnDn + rStep

// ═════════════ LEVEL COLLECTION ═════════════
var lvP = array.new_float()
var lvS = array.new_int()
var lvT = array.new_int()
var lvN = array.new_string()
array.clear(lvP)
array.clear(lvS)
array.clear(lvT)
array.clear(lvN)

if useD
    f_add(lvP, lvS, lvT, lvN, pdh, 0, 1, "PDH")
    f_add(lvP, lvS, lvT, lvN, pdl, 0, 1, "PDL")
    f_add(lvP, lvS, lvT, lvN, pdc, 0, 1, "PDC")
    f_add(lvP, lvS, lvT, lvN, dP,  1, 1, "P")
    f_add(lvP, lvS, lvT, lvN, dR1, 1, 1, "R1")
    f_add(lvP, lvS, lvT, lvN, dR2, 1, 1, "R2")
    f_add(lvP, lvS, lvT, lvN, dR3, 1, 1, "R3")
    f_add(lvP, lvS, lvT, lvN, dS1, 1, 1, "S1")
    f_add(lvP, lvS, lvT, lvN, dS2, 1, 1, "S2")
    f_add(lvP, lvS, lvT, lvN, dS3, 1, 1, "S3")
if useW
    f_add(lvP, lvS, lvT, lvN, pwh, 0, 2, "PWH")
    f_add(lvP, lvS, lvT, lvN, pwl, 0, 2, "PWL")
    f_add(lvP, lvS, lvT, lvN, wP,  1, 2, "WP")
    f_add(lvP, lvS, lvT, lvN, wR1, 1, 2, "WR1")
    f_add(lvP, lvS, lvT, lvN, wS1, 1, 2, "WS1")
f_add(lvP, lvS, lvT, lvN, sh1, 0, 3, "SWING H")
f_add(lvP, lvS, lvT, lvN, sh2, 0, 3, "SWING H2")
f_add(lvP, lvS, lvT, lvN, sl1, 0, 3, "SWING L")
f_add(lvP, lvS, lvT, lvN, sl2, 0, 3, "SWING L2")
if iRound
    f_add(lvP, lvS, lvT, lvN, rnDn, 1, 0, "ROUND")
    f_add(lvP, lvS, lvT, lvN, rnUp, 1, 0, "ROUND")

// ═════════════ CONFLUENCE CLUSTERING ═════════════
var zTop   = array.new_float()
var zBot   = array.new_float()
var zScore = array.new_float()
var zCnt   = array.new_int()
var zName  = array.new_string()
array.clear(zTop)
array.clear(zBot)
array.clear(zScore)
array.clear(zCnt)
array.clear(zName)

nLv = array.size(lvP)
if nLv >= 2 and not na(atrV)
    idx  = array.sort_indices(lvP, order.ascending)
    tol  = iTol * atrV
    gCnt = 0
    gS   = false
    gF   = false
    gW   = false
    gSw  = false
    float gLo = na
    float gHi = na
    gNm  = ""
    for k = 0 to nLv - 1
        j = array.get(idx, k)
        v = array.get(lvP, j)
        newGrp = gCnt == 0 or v - gHi > tol or v - gLo > 2.0 * tol
        if newGrp and gCnt > 0
            [ok, zt, zb, sc] = f_final(gCnt, gS, gF, gW, gSw, gLo, gHi, iMinSrc, atrV)
            if ok
                array.push(zTop, zt)
                array.push(zBot, zb)
                array.push(zScore, sc)
                array.push(zCnt, gCnt)
                array.push(zName, gNm)
            gCnt := 0
            gS   := false
            gF   := false
            gW   := false
            gSw  := false
            gNm  := ""
        if gCnt == 0
            gLo := v
        gHi  := v
        gCnt := gCnt + 1
        src  = array.get(lvS, j)
        tier = array.get(lvT, j)
        gS  := gS or src == 0
        gF  := gF or src == 1
        gW  := gW or tier == 2
        gSw := gSw or tier == 3
        gNm := gNm == "" ? array.get(lvN, j) : gNm + " + " + array.get(lvN, j)
    if gCnt > 0
        [ok2, zt2, zb2, sc2] = f_final(gCnt, gS, gF, gW, gSw, gLo, gHi, iMinSrc, atrV)
        if ok2
            array.push(zTop, zt2)
            array.push(zBot, zb2)
            array.push(zScore, sc2)
            array.push(zCnt, gCnt)
            array.push(zName, gNm)

// ═════════════ SIGNAL & PLAN ═════════════
sideI = iSide == "Long saja" ? 1 : iSide == "Short saja" ? -1 : 0
// mode: 0 dua-duanya, 1 hold saja, 2 breakout saja. Hasil [dir, kind(1 hold / 2 breakout), indeks zona]
f_signal(p, mode, atrNow, actNow, pc) =>
    [minS, wk, bd, buf, actMin, rsc, slm] = f_params(p)
    dir  = 0
    kind = 0
    zi   = -1
    best = -1.0
    rng   = math.max(high - low, syminfo.mintick)
    lw    = (math.min(open, close) - low) / rng
    uw    = (high - math.max(open, close)) / rng
    bodyR = math.abs(close - open) / rng
    n = array.size(zTop)
    if n > 0 and actNow >= actMin and not na(atrNow)
        for i = 0 to n - 1
            t = array.get(zTop, i)
            b = array.get(zBot, i)
            s = array.get(zScore, i)
            if s >= minS and s > best
                d = 0
                k = 0
                if mode != 2
                    if low <= t and low >= b - 0.5 * atrNow and close > t and close > open and lw >= wk and pc > b
                        d := 1
                        k := 1
                    else if high >= b and high <= t + 0.5 * atrNow and close < b and close < open and uw >= wk and pc < t
                        d := -1
                        k := 1
                if d == 0 and mode != 1
                    if pc <= t and close > t + buf * atrNow and close > open and bodyR >= bd
                        d := 1
                        k := 2
                    else if pc >= b and close < b - buf * atrNow and close < open and bodyR >= bd
                        d := -1
                        k := 2
                if d != 0 and (sideI == 0 or d == sideI)
                    dir  := d
                    kind := k
                    zi   := i
                    best := s
    [dir, kind, zi]

f_plan(d, zi, p, atrNow) =>
    [minS, wk, bd, buf, actMin, rsc, slm] = f_params(p)
    e  = close
    t  = array.get(zTop, zi)
    b  = array.get(zBot, zi)
    s  = d == 1 ? math.min(b, low) - iSlBuf * slm * atrNow : math.max(t, high) + iSlBuf * slm * atrNow
    rk = math.min(math.max(math.abs(e - s), 0.5 * atrNow), 3.0 * atrNow)
    s := e - d * rk
    t1 = e + d * rk * iR1 * rsc
    t2 = e + d * rk * iR2 * rsc
    t3 = e + d * rk * iR3 * rsc
    if iMagnet
        float bestEdge = na
        bestDist = 1e18
        n = array.size(zTop)
        if n > 0
            for i = 0 to n - 1
                edge = d == 1 ? array.get(zBot, i) : array.get(zTop, i)
                inside = d == 1 ? edge > t1 and edge < t3 : edge < t1 and edge > t3
                if inside and math.abs(edge - e) < bestDist
                    bestDist := math.abs(edge - e)
                    bestEdge := edge
        if not na(bestEdge)
            snap = bestEdge - d * 0.05 * atrNow
            t2 := d == 1 ? math.max(snap, t1 + syminfo.mintick) : math.min(snap, t1 - syminfo.mintick)
    [e, s, t1, t2, t3]

// ═════════════ PROFILE TOURNAMENT (ledger virtual per profil) ═════════════
// 5 ledger (Balanced, Strict, Scalp, Swing, Auto) × NF kolom dalam satu array
NF = 21
F_ACT = 0
F_DIR = 1
F_KIND = 2
F_CNT = 3
F_E = 4
F_SL = 5
F_RISK = 6
F_T1 = 7
F_T2 = 8
F_T3 = 9
F_H1 = 10
F_H2 = 11
F_REM = 12
F_ACC = 13
F_BAR = 14
F_TR = 15
F_WIN = 16
F_SUM = 17
F_GW = 18
F_GL = 19
F_LAST = 20
var LG = array.new_float(105, 0.0)
lg(p, f) =>
    array.get(LG, p * NF + f)
lgSet(p, f, v) =>
    array.set(LG, p * NF + f, v)

openPlan(p, d, k, c, e, s, t1, t2, t3) =>
    lgSet(p, F_ACT, 1)
    lgSet(p, F_DIR, d)
    lgSet(p, F_KIND, k)
    lgSet(p, F_CNT, c)
    lgSet(p, F_E, e)
    lgSet(p, F_SL, s)
    lgSet(p, F_RISK, math.abs(e - s))
    lgSet(p, F_T1, t1)
    lgSet(p, F_T2, t2)
    lgSet(p, F_T3, t3)
    lgSet(p, F_H1, 0)
    lgSet(p, F_H2, 0)
    lgSet(p, F_REM, 1.0)
    lgSet(p, F_ACC, 0.0)
    lgSet(p, F_BAR, bar_index)
    true

// Hasil 0 tidak ada, 1 TP1, 2 TP2, 3 TP3 selesai, 4 stop selesai, 5 time exit selesai
stepLedger(p, w1, w2, maxB) =>
    ev = 0
    if lg(p, F_ACT) == 1 and bar_index > lg(p, F_BAR)
        dir   = lg(p, F_DIR)
        e     = lg(p, F_E)
        r     = math.max(lg(p, F_RISK), syminfo.mintick)
        done  = false
        stopH = dir == 1 ? low <= lg(p, F_SL) : high >= lg(p, F_SL)
        if stopH
            lgSet(p, F_ACC, lg(p, F_ACC) + lg(p, F_REM) * (lg(p, F_SL) - e) * dir / r)
            lgSet(p, F_REM, 0.0)
            done := true
            ev   := 4
        else
            h1 = dir == 1 ? high >= lg(p, F_T1) : low <= lg(p, F_T1)
            h2 = dir == 1 ? high >= lg(p, F_T2) : low <= lg(p, F_T2)
            h3 = dir == 1 ? high >= lg(p, F_T3) : low <= lg(p, F_T3)
            if lg(p, F_H1) == 0 and h1
                lgSet(p, F_H1, 1)
                lgSet(p, F_ACC, lg(p, F_ACC) + w1 * (lg(p, F_T1) - e) * dir / r)
                lgSet(p, F_REM, lg(p, F_REM) - w1)
                lgSet(p, F_SL, e)
                ev := 1
            if lg(p, F_H1) == 1 and lg(p, F_H2) == 0 and h2
                lgSet(p, F_H2, 1)
                lgSet(p, F_ACC, lg(p, F_ACC) + w2 * (lg(p, F_T2) - e) * dir / r)
                lgSet(p, F_REM, lg(p, F_REM) - w2)
                ev := 2
            if lg(p, F_H2) == 1 and h3
                lgSet(p, F_ACC, lg(p, F_ACC) + lg(p, F_REM) * (lg(p, F_T3) - e) * dir / r)
                lgSet(p, F_REM, 0.0)
                done := true
                ev   := 3
            if not done and bar_index - lg(p, F_BAR) >= maxB
                lgSet(p, F_ACC, lg(p, F_ACC) + lg(p, F_REM) * (close - e) * dir / r)
                lgSet(p, F_REM, 0.0)
                done := true
                ev   := 5
        if done
            acc = lg(p, F_ACC)
            lgSet(p, F_ACT, 0)
            lgSet(p, F_TR, lg(p, F_TR) + 1)
            lgSet(p, F_SUM, lg(p, F_SUM) + acc)
            lgSet(p, F_LAST, acc)
            if acc > 0
                lgSet(p, F_WIN, lg(p, F_WIN) + 1)
                lgSet(p, F_GW, lg(p, F_GW) + acc)
            else
                lgSet(p, F_GL, lg(p, F_GL) - acc)
    ev

modeI   = iMode == "Both (Hold + Breakout)" ? 0 : iMode == "Hold Reversals Only" ? 1 : 2
dispIdx = iProf == "Auto (Best EV)" ? 4 : iProf == "Balanced" ? 0 : iProf == "Strict 3x+ Stack" ? 1 : iProf == "Scalp Fast" ? 2 : 3

bp     = 0
bestEv = -1e9
for p = 0 to 3
    if lg(p, F_TR) >= 3
        evp = lg(p, F_SUM) / lg(p, F_TR)
        if evp > bestEv
            bestEv := evp
            bp     := p

dOpenDir = 0
dOpenK   = 0
dOpenC   = 0
dEv      = 0
dH1      = false
dH2      = false
dLastR   = 0.0
float dE  = na
float dS  = na
float dT1 = na
float dT2 = na
float dT3 = na

if barstate.isconfirmed and not na(atrV)
    for p = 0 to 4
        prof = p == 4 ? bp : p
        ev   = stepLedger(p, 0.5, 0.3, iMaxBars)
        if p == dispIdx
            dEv    := ev
            dH1    := lg(p, F_H1) == 1
            dH2    := lg(p, F_H2) == 1
            dLastR := lg(p, F_LAST)
        if lg(p, F_ACT) == 0
            [sd, sk, szi] = f_signal(prof, modeI, atrV, actV, prevC)
            if sd != 0
                [e, s, t1, t2, t3] = f_plan(sd, szi, prof, atrV)
                c = array.get(zCnt, szi)
                openPlan(p, sd, sk, c, e, s, t1, t2, t3)
                if p == dispIdx
                    dOpenDir := sd
                    dOpenK   := sk
                    dOpenC   := c
                    dE  := e
                    dS  := s
                    dT1 := t1
                    dT2 := t2
                    dT3 := t3

dlActive = lg(dispIdx, F_ACT) == 1
dlDir    = int(lg(dispIdx, F_DIR))
dlTrades = lg(dispIdx, F_TR)

// ═════════════ NEAREST ZONES ═════════════
supScore = 0.0
resScore = 0.0
supTxt  = "—"
resTxt  = "—"
supDist = 1e18
resDist = 1e18
nZ = array.size(zTop)
if nZ > 0
    for i = 0 to nZ - 1
        t = array.get(zTop, i)
        b = array.get(zBot, i)
        if t < close and close - t < supDist
            supDist  := close - t
            supScore := array.get(zScore, i)
            supTxt   := str.tostring(array.get(zCnt, i)) + "x · " + str.tostring(supScore, "#") + " @ " + str.tostring((t + b) / 2.0, format.mintick)
        if b > close and b - close < resDist
            resDist  := b - close
            resScore := array.get(zScore, i)
            resTxt   := str.tostring(array.get(zCnt, i)) + "x · " + str.tostring(resScore, "#") + " @ " + str.tostring((t + b) / 2.0, format.mintick)

dispEvR = dlTrades > 0 ? lg(dispIdx, F_SUM) / dlTrades : 0.0
plot(dOpenDir, "Signal (+1 Buy / -1 Sell)", display = display.data_window)
plot(dlActive ? dlDir : 0, "Active Plan Direction", display = display.data_window)
plot(supScore, "Nearest Support Score", display = display.data_window)
plot(resScore, "Nearest Resistance Score", display = display.data_window)
plot(nZ, "Active Zones", display = display.data_window)
plot(dispEvR, "Avg R per Trade", display = display.data_window)
`;

  const DRAW = String.raw`
// ═════════════ GAMBAR RENCANA TRADE ═════════════
// tiap rencana: 5 garis (E, SL, TP1-3), 2 box (risk, reward), 7 label (sinyal, E, SL, TP1-3, hasil)
var pLines  = array.new_line()
var pBoxes  = array.new_box()
var pLabels = array.new_label()
var bool drawActive = false
fgC = chart.fg_color
projBars = 25

if showPlan and dEv != 0 and drawActive and array.size(pLines) >= 5
    nl = array.size(pLines) - 5
    nb = array.size(pBoxes) - 2
    nb2 = array.size(pLabels) - 7
    if dH1
        line.set_color(array.get(pLines, nl + 2), bullC)
        line.set_width(array.get(pLines, nl + 2), 2)
        label.set_text(array.get(pLabels, nb2 + 3), "TP1 ✓")
        line.set_style(array.get(pLines, nl + 1), line.style_dashed)
        label.set_text(array.get(pLabels, nb2 + 2), "SL → BE")
    if dH2
        line.set_color(array.get(pLines, nl + 3), bullC)
        line.set_width(array.get(pLines, nl + 3), 2)
        label.set_text(array.get(pLabels, nb2 + 4), "TP2 ✓")
    if dEv >= 3
        tx = bar_index
        for q = 0 to 4
            line.set_x2(array.get(pLines, nl + q), tx)
        box.set_right(array.get(pBoxes, nb), tx)
        box.set_right(array.get(pBoxes, nb + 1), tx)
        for q = 1 to 5
            label.set_x(array.get(pLabels, nb2 + q), tx)
        if dEv == 3
            line.set_color(array.get(pLines, nl + 4), bullC)
            line.set_width(array.get(pLines, nl + 4), 2)
            label.set_text(array.get(pLabels, nb2 + 5), "TP3 ✓")
        tag  = dEv == 3 ? "TP3" : dEv == 4 ? (dH1 ? "BE STOP" : "STOP") : "TIME EXIT"
        rTx  = (dLastR >= 0 ? "+" : "") + str.tostring(dLastR, "#.##") + "R"
        rc   = dLastR > 0 ? bullC : dLastR < 0 ? bearC : fgC
        label.set_text(array.get(pLabels, nb2 + 6), rTx + " · " + tag)
        label.set_xy(array.get(pLabels, nb2 + 6), tx, close)
        label.set_color(array.get(pLabels, nb2 + 6), color.new(rc, 15))
        drawActive := false

if showPlan and dOpenDir != 0
    t0   = bar_index
    tEnd = bar_index + projBars
    dc   = dOpenDir == 1 ? bullC : bearC
    rk   = math.max(math.abs(dE - dS), syminfo.mintick)
    array.push(pBoxes, box.new(t0, math.max(dE, dS), tEnd, math.min(dE, dS), bgcolor = color.new(bearC, 86), border_color = color.new(bearC, 100)))
    array.push(pBoxes, box.new(t0, math.max(dE, dT3), tEnd, math.min(dE, dT3), bgcolor = color.new(bullC, 90), border_color = color.new(bullC, 100)))
    array.push(pLines, line.new(t0, dE, tEnd, dE, color = fgC, width = 2))
    array.push(pLines, line.new(t0, dS, tEnd, dS, color = bearC, width = 2))
    array.push(pLines, line.new(t0, dT1, tEnd, dT1, color = color.new(bullC, 40), width = 1))
    array.push(pLines, line.new(t0, dT2, tEnd, dT2, color = color.new(bullC, 40), width = 1))
    array.push(pLines, line.new(t0, dT3, tEnd, dT3, color = color.new(bullC, 40), width = 1))
    sigTxt = (dOpenDir == 1 ? "BUY" : "SELL") + "\n" + (dOpenK == 1 ? "HOLD" : "BREAKOUT") + " · " + str.tostring(dOpenC) + "x"
    array.push(pLabels, label.new(t0, dOpenDir == 1 ? low : high, sigTxt, style = dOpenDir == 1 ? label.style_label_up : label.style_label_down, color = dc, textcolor = color.black, size = size.small))
    array.push(pLabels, label.new(tEnd, dE, "ENTRY " + str.tostring(dE, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = fgC, size = size.small))
    array.push(pLabels, label.new(tEnd, dS, "SL " + str.tostring(dS, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = bearC, size = size.small))
    array.push(pLabels, label.new(tEnd, dT1, "TP1 " + str.tostring((dT1 - dE) * dOpenDir / rk, "#.#") + "R", style = label.style_label_left, color = color.new(color.black, 100), textcolor = bullC, size = size.small))
    array.push(pLabels, label.new(tEnd, dT2, "TP2 " + str.tostring((dT2 - dE) * dOpenDir / rk, "#.#") + "R", style = label.style_label_left, color = color.new(color.black, 100), textcolor = bullC, size = size.small))
    array.push(pLabels, label.new(tEnd, dT3, "TP3 " + str.tostring((dT3 - dE) * dOpenDir / rk, "#.#") + "R", style = label.style_label_left, color = color.new(color.black, 100), textcolor = bullC, size = size.small))
    array.push(pLabels, label.new(t0, close, "", style = label.style_label_left, color = color.new(color.black, 100), textcolor = color.white, size = size.small))
    drawActive := true
    if array.size(pLines) > iHist * 5
        for q = 0 to 4
            line.delete(array.shift(pLines))
        for q = 0 to 1
            box.delete(array.shift(pBoxes))
        for q = 0 to 6
            label.delete(array.shift(pLabels))

// ═════════════ ZONA (bar terakhir) ═════════════
var zBoxes = array.new_box()
if barstate.islast and showPlan
    if array.size(zBoxes) > 0
        for i = array.size(zBoxes) - 1 to 0
            box.delete(array.get(zBoxes, i))
    array.clear(zBoxes)
    if nZ > 0
        dist = array.new_float()
        for i = 0 to nZ - 1
            array.push(dist, math.abs((array.get(zTop, i) + array.get(zBot, i)) / 2.0 - close))
        ordI  = array.sort_indices(dist, order.ascending)
        shown = math.min(iZones, nZ)
        for k = 0 to shown - 1
            i  = array.get(ordI, k)
            t  = array.get(zTop, i)
            b  = array.get(zBot, i)
            sc = array.get(zScore, i)
            base = b > close ? bearC : t < close ? bullC : zoneC
            tr   = int(math.max(55.0, 88.0 - sc * 0.33))
            txt  = str.tostring(array.get(zCnt, i)) + "x CONFLUENCE [" + array.get(zName, i) + "] · " + str.tostring(sc, "#")
            array.push(zBoxes, box.new(bar_index - 40, t, bar_index + 25, b, bgcolor = color.new(base, tr), border_color = color.new(base, 60), text = txt, text_size = size.tiny, text_color = color.new(fgC, 10), text_halign = text.align_right, text_valign = text.align_center))

// ═════════════ DASHBOARD ═════════════
tblSz = iTbl == "Tiny" ? size.tiny : iTbl == "Small" ? size.small : size.normal
var table dash = table.new(position.top_right, 4, 13, bgcolor = color.new(chart.bg_color, 10), border_color = color.new(chart.fg_color, 80), border_width = 1, frame_color = color.new(chart.fg_color, 70), frame_width = 1)

f_row(tb, r, k, v, vc, sz) =>
    table.cell(tb, 0, r, k, text_color = color.new(chart.fg_color, 30), text_size = sz, text_halign = text.align_left)
    table.cell(tb, 1, r, v, text_color = vc, text_size = sz, text_halign = text.align_left)
    table.merge_cells(tb, 1, r, 3, r)
    true

if barstate.islast
    table.clear(dash, 0, 0, 3, 12)
    table.cell(dash, 0, 0, "KEY LEVEL CONFLUENCE", text_color = zoneC, text_size = tblSz, text_formatting = text.format_bold)
    table.merge_cells(dash, 0, 0, 3, 0)
    f_row(dash, 1, "Mode", iMode, fgC, tblSz)
    profTxt = dispIdx == 4 ? "Auto → " + f_pname(bp) : f_pname(dispIdx)
    f_row(dash, 2, "Profile", profTxt, fgC, tblSz)
    actTxt = dlActive ? (dlDir == 1 ? "LONG" : "SHORT") + " · " + (lg(dispIdx, F_KIND) == 1 ? "HOLD" : "BREAKOUT") + " · " + str.tostring(lg(dispIdx, F_CNT)) + "x" + (lg(dispIdx, F_H1) == 1 ? " · BE ON" : "") : "FLAT — menunggu"
    f_row(dash, 3, "Signal", actTxt, dlActive ? (dlDir == 1 ? bullC : bearC) : color.new(fgC, 40), tblSz)
    f_row(dash, 4, "Support", supTxt, bullC, tblSz)
    f_row(dash, 5, "Resistance", resTxt, bearC, tblSz)
    table.cell(dash, 0, 6, "Profile", text_color = color.new(fgC, 30), text_size = tblSz, text_formatting = text.format_bold)
    table.cell(dash, 1, 6, "Trades", text_color = color.new(fgC, 30), text_size = tblSz, text_formatting = text.format_bold)
    table.cell(dash, 2, 6, "Win %", text_color = color.new(fgC, 30), text_size = tblSz, text_formatting = text.format_bold)
    table.cell(dash, 3, 6, "Avg R", text_color = color.new(fgC, 30), text_size = tblSz, text_formatting = text.format_bold)
    for p = 0 to 4
        ntr = lg(p, F_TR)
        wr  = ntr > 0 ? 100.0 * lg(p, F_WIN) / ntr : 0.0
        ar  = ntr > 0 ? lg(p, F_SUM) / ntr : 0.0
        sel = p == dispIdx or (dispIdx == 4 and p == bp)
        nc  = sel ? zoneC : fgC
        table.cell(dash, 0, 7 + p, (sel ? "▶ " : "") + f_pname(p), text_color = nc, text_size = tblSz, text_halign = text.align_left)
        table.cell(dash, 1, 7 + p, str.tostring(ntr), text_color = fgC, text_size = tblSz)
        table.cell(dash, 2, 7 + p, ntr > 0 ? str.tostring(wr, "#") + "%" : "—", text_color = fgC, text_size = tblSz)
        table.cell(dash, 3, 7 + p, ntr > 0 ? (ar >= 0 ? "+" : "") + str.tostring(ar, "#.##") : "—", text_color = ar > 0 ? bullC : ar < 0 ? bearC : fgC, text_size = tblSz)
    f_row(dash, 12, "Data", hasVol ? "VOLUME" : "RANGE PROXY", color.new(fgC, 40), tblSz)

// ═════════════ ALERTS ═════════════
alertcondition(dOpenDir == 1, "KLCTZ Bullish Entry", "KLCTZ: BUY at key level confluence on {{ticker}} {{interval}} @ {{close}}")
alertcondition(dOpenDir == -1, "KLCTZ Bearish Entry", "KLCTZ: SELL at key level confluence on {{ticker}} {{interval}} @ {{close}}")
alertcondition(dOpenDir != 0, "KLCTZ Any Entry", "KLCTZ: new confluence trade plan on {{ticker}} {{interval}} @ {{close}}")
alertcondition(dEv == 1, "KLCTZ TP1 Hit", "KLCTZ: TP1 reached, stop moved to break-even on {{ticker}}")
alertcondition(dEv == 3, "KLCTZ TP3 Hit", "KLCTZ: TP3 reached, plan closed on {{ticker}}")
alertcondition(dEv == 4, "KLCTZ Stop Hit", "KLCTZ: stop reached, plan closed on {{ticker}}")
`;

  // Strategy: order sungguhan mengikuti rencana profil yang ditampilkan (dispIdx).
  const EXEC = String.raw`
// ═════════════ EKSEKUSI STRATEGY ═════════════
// Rencana dibuat saat candle sinyal close → order market terisi di open bar berikutnya.
// TP1 50% / TP2 30% / TP3 sisa, SL ke break-even (harga isi) setelah TP1, time exit = rencana ditutup.
riskPct = input.float(1.0, "Risiko per trade (% equity)", minval = 0.1, maxval = 100, step = 0.1, group = "Strategy", tooltip = "Ukuran posisi = risiko / jarak SL, dibatasi 100% equity.")
var float xQty = 0.0
var bool  xBE = false
pos = strategy.position_size
idOf(d) =>
    d > 0 ? "Long" : "Short"

// rencana selesai (TP3 / stop / time exit) → pastikan posisi ikut ditutup
if dEv >= 3 and pos != 0
    strategy.close_all(comment = dEv == 5 ? "Time exit" : dEv == 4 ? "Stop" : "TP3")
// TP1 kena → SL sisa posisi pindah ke harga isi (break-even)
if dlActive and dH1 and not xBE and pos != 0 and dOpenDir == 0
    be = strategy.position_avg_price
    id = idOf(dlDir)
    xBE := true
    if not dH2
        strategy.exit("TP2", id, qty_percent = 30, stop = be, limit = lg(dispIdx, F_T2))
    strategy.exit("TP3", id, qty_percent = 100, stop = be, limit = lg(dispIdx, F_T3))
if dOpenDir != 0
    if pos != 0
        strategy.close_all(comment = "Rencana baru")
    risk = math.abs(dE - dS)
    xQty := math.min(strategy.equity * riskPct / 100 / risk, strategy.equity / dE)
    xBE  := false
    id = idOf(dOpenDir)
    strategy.entry(id, dOpenDir > 0 ? strategy.long : strategy.short, qty = xQty)
    strategy.exit("TP1", id, qty_percent = 50, stop = dS, limit = dT1)
    strategy.exit("TP2", id, qty_percent = 30, stop = dS, limit = dT2)
    strategy.exit("TP3", id, qty_percent = 100, stop = dS, limit = dT3)
`;

  const indicator = `${LICENSE}
//@version=6
indicator("Key Level Confluence & Target Zones [PhenLabs]", shorttitle = "KLCTZ [PhenLabs]", overlay = true, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 200)
${COMMON}${DRAW}`;

  const strategy = `${LICENSE}
//@version=6
strategy("KLCTZ Strategy [PhenLabs]", overlay = true, initial_capital = 1000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_value = 0.1, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 200)
${COMMON}${EXEC}${DRAW}`;

  const api = { indicator, strategy };
  root.LunaKLCTZ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
