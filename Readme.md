# Opal Card Transactions Scraper

This project provides a Playwright-based scraper that logs into the NSW Opal website, filters transactions by date range, and exports them to JSON file.

## Features
- Interactive CLI prompts for:
  - Username (email)
  - Password
  - Start date (MM-DD-YYYY or press Enter for earliest)
  - End date (MM-DD-YYYY or press Enter for today)
  - Open browser to show process? (y/n):         

- Scrapes:
  - transactionDate
  - time_local
  - time_utc
  - quantity
  - currency
  - accountId
  - mode
  - description
  - tap_on_location
  - tap_off_location
  - status
  - bankImportedBalance
- Result filtering and JSON export
- Output filename automatically reflects selected date range

## Requirements
- Node.js 18+
- Playwright
- Luxon

Install dependencies:  https://nodejs.org/
```bash
node -v 
npm -v
npm install typescript ts-node @types/node --save-dev
npm install playwright
npm install luxon
```

## Usage
Run the scraper:
```bash
npm run dev
```
You will be prompted for login info(email, password) and date range(strat date, end date).

### Output
The scraper writes a JSON file to the working directory. Examples:
- `transactions_MM-DD-YYYY_MM-DD-YYYY.json`
- `transactions_earliest-latest.json`
- `transactions_earliest_MM-DD-YYYY.json`
- `transactions_MM-DD-YYYY_latest.json`

The script returns the same transaction array for programmatic use.

## File Structure
- `scraper.ts` – Login, scraping logic, date filtering, JSON output
- `index.ts` – CLI entrypoint (prompts user, calls scraper)


## Transactions API

### POST `/api/scrape`

```powershell
$body = @{
  username = "xxx@xxx.com"
  password = "xxxxxx"
  startDate = ""
  endDate = ""
  showBrowser = $false
} | ConvertTo-Json

Invoke-WebRequest -Method Post `
  -Uri "http://localhost:8080/api/scrape" `
  -ContentType "application/json" `
  -Body $body

```

### GET `/api/transactions`

```powershell
Invoke-WebRequest -Method Get -Uri "http://localhost:8080/api/transactions"

Invoke-WebRequest -Method Get -Uri "http://localhost:8080/api/transactions?mode=bus"
Invoke-WebRequest -Uri "http://localhost:8080/api/transactions?mode=lightrail" -OutFile transactions.json

Invoke-WebRequest -Uri "http://localhost:8080/api/transactions?accountId=3085%202204%201089%208809" -OutFile transactions.json

```

### Query Parameters

| parameter | description | type |
|---------|-------------|------|
| `accountId` | Filter by Opal card account ID | string |
| `mode` | Filter by transport mode (e.g. `bus`, `lightrail`, `ferry`) | string |
| `from` | Start date (MM-DD-YYYY) for filtering transactions by `time_utc` | string |
| `to` | End date (MM-DD-YYYY) for filtering transactions by `time_utc` | string |

---

## Disclaimer
This tool automates browsing of the NSW Opal website for personal use only. Ensure usage complies with Opal's terms and conditions.



Invoke-WebRequest -Method Get -Uri "http://localhost:8080/api/transactions?startDate=8-22-2024&endDate="
Invoke-WebRequest -Uri "http://localhost:8080/api/transactions?startDate=8-22-2024&endDate=" -OutFile transactions.json
