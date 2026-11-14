# Playverse

Mobil ve web'de tarayıcı üzerinden oynanan, basit ama görsel olarak etkili 3D mini oyunlar sitesi.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind** — Vercel'e tek komutla deploy
- **three.js** — 3D oyun motoru
- **Skor / favoriler** — Faz 1'de tamamen `localStorage` (DB yok); Faz 2'de leaderboard için Neon Postgres veya Upstash eklenecek

## Yapı

```
src/
  app/
    page.tsx              # Oyun hub'ı (kartlar, favoriler, en iyi skorlar)
    games/[slug]/page.tsx # Oyun sayfası
  components/
    GameGrid.tsx          # Hub kartları (client, favoriler + skorlar)
    GameStage.tsx         # SSR'siz sahne yükleyici
    StageCanvas.tsx       # Ortak canvas + HUD + skor yönetimi
  games/
    runner.ts             # Oyun modülü: createGame(container) => { dispose }
  lib/
    games.ts              # Oyun kayıt defteri (yeni oyun buraya eklenir)
    storage.ts            # localStorage: skor, favori, nickname
```

## Yeni oyun ekleme

1. `src/games/<slug>.ts` yaz — imza: `createGame(container: HTMLElement) => { dispose(): void }`
2. `src/lib/games.ts`'e meta ekle (`status: "live"` yap)
3. Kart ve sayfa otomatik çalışır

## Komutlar

```bash
npm run dev    # geliştirme
npm run build  # prod build
npx vercel     # deploy
```

## Yol haritası

- [x] İskelet: hub + oyun sayfası + storage modülü + logo
- [ ] Neon Runner: gerçek oyun mekaniği (swipe ile şerit değiştirme, çarpışma, skor)
- [ ] Leaderboard (Neon Postgres + `/api/scores`)
- [ ] Admin mini-dashboard (istatistik, tek kullanıcılı auth)
