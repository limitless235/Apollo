export const MARKET_FEEDS = [
  {
    id: "moneycontrol",
    name: "Moneycontrol",
    url: "https://www.moneycontrol.com/rss/latestnews.xml",
  },
  {
    id: "et-markets",
    name: "Economic Times Markets",
    url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
  },
  {
    id: "business-standard",
    name: "Business Standard Markets",
    url: "https://www.business-standard.com/rss/markets-106.rss",
  },
] as const;

export function googleNewsFeedUrl(companyName: string, symbol?: string): string {
  const query = encodeURIComponent(
    symbol
      ? `${companyName} ${symbol} India stock`
      : `${companyName} NSE stock`
  );
  return `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
}
