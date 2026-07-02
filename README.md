# Apollo — Manager's Desk

Personal NSE/BSE news dashboard with price charts, sentiment overlays, and an AI research assistant.

## Features

- **Watchlist bento grid** — NIFTY 50 seeded, add/remove symbols with search
- **News ingestion** — Google News RSS per company + Moneycontrol/ET/Business Standard feeds
- **FinBERT sentiment** — Hybrid ML + keyword scoring on headlines (Stage 2)
- **Signal ranking** — Composite score from momentum, sentiment, news activity, volume (Stage 1)
- **ML ranker** — Walk-forward ridge model blends with heuristics (Stage 3)
- **Charts** — Candlestick price chart with sentiment-colored news markers
- **Sentiment timeline** — Rolling daily sentiment and article volume
- **Manager's Desk chat** — Claude agent with tools to pull news, analyze sentiment, and explain context

## Setup

```bash
cp .env.example .env.local
# Add ANTHROPIC_API_KEY to .env.local
# Optional: SENTIMENT_MODEL=hybrid (default) | finbert | rules

npm install
npm run db:seed      # Seed NIFTY 50 watchlist
npm run ingest       # Pull news
npm run train:ranker # Train ML ranker on 1y walk-forward data
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run db:seed` | Seed watchlist with NIFTY 50 |
| `npm run ingest` | Pull news for all watchlist symbols |
| `npm run rescore-sentiment` | Rescore all articles with FinBERT/hybrid |
| `npm run eval:sentiment` | Compare rules vs FinBERT on stored headlines |
| `npm run eval:signals` | Walk-forward backtest of signal scores |
| `npm run train:ranker` | Train ridge-linear ranker → `data/ranker-model.json` |
| `npm run eval:ranker` | Compare heuristic vs learned vs blended ranking |
| `npm run build` | Production build |

## API routes

- `GET /api/watchlist` — List watchlist
- `GET /api/sentiment/status` — FinBERT availability and article source counts
- `GET /api/signals` — Ranked watchlist signals (heuristic + optional ML blend)
- `GET /api/signals/[symbol]` — Signal breakdown + 1y backtest metrics for one symbol
- `GET /api/ranker/status` — ML ranker model status and holdout metrics
- `GET /api/charts/[symbol]` — OHLCV, news markers, sentiment timeline
- `GET /api/news?symbol=RELIANCE` — Articles for symbol
- `POST /api/chat` — Streaming agent chat
- `GET /api/cron/ingest-news` — Scheduled news ingest (protected by `CRON_SECRET`)

## Disclaimer

Decision-support tool for personal use only. Not investment advice.
