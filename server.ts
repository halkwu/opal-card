import express from 'express';
import path from 'path';
import { login, getTransactions } from './scraper';

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
        res.status(200).send(JSON.stringify(transactions, null, 2));
    } catch (err: any) {
        const msg = err && err.message ? err.message : String(err);
        if (msg === 'InvalidCredentials') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.error('Scrape failed:', err);
        return res.status(500).json({ error: msg });
    }
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
            (p) => send({ type: 'progress', ...p }) // 👈 关键
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
