import express from 'express';
import path from 'path';
import * as fs from 'fs';
import { login, getTransactions, validateSydneyDate } from './scraper';

type ProgressPayload = {
    percent: number;
    message?: string;
};

type ProgressFn = (p: ProgressPayload) => void;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

app.use(express.json({ limit: '10mb' }));

// Serve static UI
app.use('/', express.static(path.join(__dirname, 'my-app', 'public')));

// In-memory transaction store populated after scraping (fallback if no file)
let transactionStore: any[] = [];

// Helper: read transactions from latest saved JSON file
function readLatestTransactionsFromDisk(): any[] {
    try {
        const dir = process.cwd();
        const files = fs.readdirSync(dir).filter(f => f.startsWith('transactions_') && f.endsWith('.json'));
        if (files.length === 0) return [];
        // Sort by file mtime desc to pick the most recent
        const withStats = files.map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
        withStats.sort((a, b) => b.mtime - a.mtime);
        const latestPath = path.join(dir, withStats[0].f);
        const raw = fs.readFileSync(latestPath, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('Failed to read transactions from disk:', e);
        return [];
    }
}

function fmtDateForName(d: Date | null) {
    if (!d) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dt = new Date(d);
    return `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}-${dt.getFullYear()}`;
}

app.post('/api/scrape', async (req, res) => {
    const { username, password, startDate, endDate, showBrowser } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
    }

    const sDate = startDate ? new Date(startDate) : null;
    const eDate = endDate ? new Date(endDate) : null;

    try {
        const context = await login(username, password, !!showBrowser);
        // const transactions = await getTransactions(context, sDate, eDate);
        const transactions = await getTransactions(
            context,
            sDate,
            eDate,
            (p) => {
                console.log(`[${p.percent}%] ${p.message ?? ''}`);
            }
        );

        // Close context/browser if possible
        try {
            const browser = context.browser();
            if (browser) await browser.close();
            else await context.close();
        } catch (e) {
            try { await context.close(); } catch (e) {}
        }

        // Derive filename from actual transactions dates if available
        const pad = (n: number) => n.toString().padStart(2, '0');
        function fmt(d: Date) {
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
        }

        let startName = sDate ? fmtDateForName(sDate) : 'earliest';
        let endName = eDate ? fmtDateForName(eDate) : 'latest';
        if (Array.isArray(transactions) && transactions.length > 0) {
            const dateStrs = transactions.map((t: any) => t.transactionDate).filter(Boolean);
            const parsedCandidates = dateStrs.map((ds: string) => {
                const parts = ds.split('-');
                if (parts.length !== 3) return null;
                const mm = parseInt(parts[0], 10);
                const dd = parseInt(parts[1], 10);
                const yy = parseInt(parts[2], 10);
                return new Date(yy, mm - 1, dd);
            });
            // Type guard: filter to Date[] where each item is a valid Date
            const parsed = parsedCandidates.filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()));
            if (parsed.length > 0) {
                const minMs = Math.min(...parsed.map((d: Date) => d.getTime()));
                const maxMs = Math.max(...parsed.map((d: Date) => d.getTime()));
                startName = fmt(new Date(minMs));
                endName = fmt(new Date(maxMs));
            }
        }

        const filename = `transactions_${startName}_${endName}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // Update for later GET queries
        if (Array.isArray(transactions)) {
            transactionStore = transactions;
        }
        res.status(200).send(JSON.stringify(transactions, null, 2));
    } catch (err: any) {
        const msg = err && err.message ? err.message : String(err);
        if (msg === 'InvalidCredentials') {
            // Return 401 
            return res.status(401).end();
        }
        console.error('Scrape failed:', err);
        return res.status(500).json({ error: msg });
    }
});

// Query transactions by reading the latest saved JSON file on disk (fallback to memory)
app.get('/api/transactions', (req, res) => {
    // Prefer reading from disk so results persist across restarts
    let result = readLatestTransactionsFromDisk();
    if (!result || result.length === 0) {
        result = transactionStore || [];
    }

    const { accountId, mode, startDate, endDate } = req.query as Record<string, string | undefined>;

    // Validate dates using existing helper (MM-DD-YYYY). Allow future dates for filtering.
    let sDate: Date | null = null;
    let eDate: Date | null = null;
    if (startDate && startDate.trim()) {
        const { date, error } = validateSydneyDate(String(startDate), { allowFuture: true });
        if (!date) {
            return res.status(400).json({ error: `Invalid startDate: ${error}` });
        }
        sDate = date;
    }
    if (endDate && endDate.trim()) {
        const { date, error } = validateSydneyDate(String(endDate), { allowFuture: true });
        if (!date) {
            return res.status(400).json({ error: `Invalid endDate: ${error}` });
        }
        eDate = date;
    }
    if (sDate && eDate && sDate > eDate) {
        return res.status(400).json({ error: 'startDate must be before or equal to endDate' });
    }

    if (accountId) {
        result = result.filter((t: any) => String(t.accountId) === String(accountId));
    }

    if (mode) {
        result = result.filter((t: any) => String(t.mode) === String(mode));
    }

    if (sDate) {
        result = result.filter((t: any) => new Date(String(t.time_utc)) >= sDate!);
    }

    if (eDate) {
        result = result.filter((t: any) => new Date(String(t.time_utc)) <= eDate!);
    }

    // res.json(result);
    res
        .type('application/json')
        .send(JSON.stringify(result, null, 2));

});

app.get('/api/scrape/stream', async (req, res) => {
    const { username, password, startDate, endDate, showBrowser } = req.query;

    if (!username || !password) {
        res.status(400).end();
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const context = await login(
            String(username),
            String(password),
            showBrowser === 'true'
        );

        const transactions = await getTransactions(
            context,
            startDate ? new Date(String(startDate)) : null,
            endDate ? new Date(String(endDate)) : null,
            (p) => send({ type: 'progress', ...p }) 
        );

        send({ type: 'done', transactions });
        res.end();

        const browser = context.browser();
        if (browser) await browser.close();
        else await context.close();
    } catch (err: any) {
        send({ type: 'error', message: err.message || String(err) });
        res.end();
    }
});



app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/scraper.html`);
});
