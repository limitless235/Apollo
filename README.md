# Apollo — Manager's Desk

Personal NSE/BSE news dashboard with price charts, sentiment overlays, and an AI research assistant.

## Features

- **Watchlist bento grid** — NIFTY 50 seeded, add/remove symbols with search
- **News ingestion** — Google News RSS per company + Moneycontrol/ET/Business Standard feeds
- **Charts** — Candlestick price chart with sentiment-colored news markers
- **Sentiment timeline** — Rolling daily sentiment and article volume
- **Manager's Desk chat** — Claude agent with tools to pull news, analyze sentiment, and explain context

## Setup

```bash
cp .env.example .env.local
# Add ANTHROPIC_API_KEY to .env.local

npm install
npm run db:seed      # Seed NIFTY 50 watchlist
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run db:seed` | Seed watchlist with NIFTY 50 |
| `npm run ingest` | Pull news for all watchlist symbols |
| `npm run build` | Production build |

## API routes

- `GET /api/watchlist` — List watchlist
- `GET /api/watchlist/summary` — Watchlist with price change, sentiment, news count
- `GET /api/charts/[symbol]` — OHLCV, news markers, sentiment timeline
- `GET /api/news?symbol=RELIANCE` — Articles for symbol
- `POST /api/chat` — Streaming agent chat
- `GET /api/cron/ingest-news` — Scheduled news ingest (protected by `CRON_SECRET`)

## Disclaimer

Decision-support tool for personal use only. Not investment advice.
