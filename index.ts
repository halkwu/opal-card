import { DateRange, login, getTransactions, askCredentials } from './scraper';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
    // Check for an input JSON file first (either --input <file> or SCRAPER_INPUT env var)
    let username: string | undefined;
    let password: string | undefined;
    let startDate: Date | null | undefined;
    let endDate: Date | null | undefined;
    let showBrowser: boolean | undefined;

    function loadInputFile(p: string) {
        try {
            const resolved = path.resolve(process.cwd(), p);
            if (!fs.existsSync(resolved)) {
                console.warn(`Input file not found: ${resolved}`);
                return false;
            }
            const raw = fs.readFileSync(resolved, 'utf8');
            const obj = JSON.parse(raw);
            username = obj.username;
            password = obj.password;
            // If start/end provided as strings, try to convert to Date
            startDate = obj.startDate ? new Date(obj.startDate) : null;
            endDate = obj.endDate ? new Date(obj.endDate) : null;
            showBrowser = typeof obj.showBrowser === 'boolean' ? obj.showBrowser : true;
            console.log(`Loaded input from ${resolved}`);
            return true;
        } catch (err) {
            console.error('Failed to load input file:', err);
            return false;
        }
    }

    // CLI arg --input <file>
    const inputArgIndex = process.argv.indexOf('--input');
    if (inputArgIndex !== -1 && process.argv.length > inputArgIndex + 1) {
        loadInputFile(process.argv[inputArgIndex + 1]);
    }
    // Environment variable fallback
    if (!username && process.env.SCRAPER_INPUT) {
        loadInputFile(process.env.SCRAPER_INPUT);
    }

    // If no input file provided, fall back to interactive prompts
    if (!username || !password || typeof showBrowser === 'undefined') {
        // Ask for username + password + date range
        const res = await DateRange();
        username = res.username;
        password = res.password;
        startDate = res.startDate;
        endDate = res.endDate;
        showBrowser = res.showBrowser;
    }

    // Attempt login; if credentials are invalid prompt user to re-enter them and retry.
    let context;
    let curUser = username;
    let curPass = password;
    while (true) {
        try {
            context = await login(curUser, curPass, showBrowser);
            break; // success
        } catch (err: any) {
            const msg = err && err.message ? err.message : String(err);
            if (msg === 'InvalidCredentials') {
                console.error('Invalid username or password. Please re-enter your credentials.');
                const creds = await askCredentials();
                curUser = creds.username;
                curPass = creds.password;
                continue; // retry
            }
            // Non-credentials error — rethrow or exit
            console.error('Login error:', msg);
            process.exit(1);
        }
    }
    // Scrape transactions
    const transactions = await getTransactions(context, startDate ?? null, endDate ?? null, (p) => {
        console.log(`[${p.percent}%] ${p.message ?? ''}`);
    });

    // Automatically close browser when it was shown to the user.
    if (showBrowser) {
        try {
            const browser = context.browser();
            if (browser) await browser.close();
            else await context.close();
        } catch (err) {
            console.warn('Failed to close browser or context:', err);
            try { await context.close(); } catch (e) {}
        }
    } else {
        // When running headless, just close the context to free resources.
        try { await context.close(); } catch (e) {}
        // Ensure the Node process exits when running in headless mode
        try { process.exit(0); } catch (e) {}
    }
})();
