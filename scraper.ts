import { chromium, BrowserContext } from 'playwright';
import * as readline from 'readline';
import { DateTime } from "luxon";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper: prompt input
 */
async function ask(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve =>
        rl.question(question, answer => {
            rl.close();
            if (answer.trim().toLowerCase() === 'q') {
                console.log('Exiting.');
                process.exit(0);
            }
            resolve(answer);
        })
    );
}

// (Merged behavior) use `ask()` which already exits on 'q'

/**
 * Ask for username + password + startDate + endDate
 */
export async function DateRange(): Promise<{
    username: string;
    password: string;
    startDate: Date | null;
    endDate: Date | null;
    showBrowser: boolean;
}> {
    console.log("(Type 'q' at any prompt to quit)");
    const username = await ask("Enter username (email): ");
    const password = await ask("Enter password: ");

    function parseDate(dateStr: string): Date | null {
        const parts = dateStr.trim().split("-");
        if (parts.length !== 3) return null;
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
        // Create a DateTime at Australia/Sydney midnight for the given date and validate
        const dt = DateTime.fromObject({ year, month, day }, { zone: 'Australia/Sydney' }).startOf('day');
        if (!dt.isValid) return null;
        return dt.toJSDate();
    }

    // Repeatedly prompt for start and end separately so startDate is validated immediately
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    const todaySydneyDT = DateTime.now().setZone('Australia/Sydney').startOf('day');

    // Loop so that if start > end we only re-prompt start/end (not username/password)
    while (true) {
        // Prompt and validate startDate immediately (re-prompt until valid)
        while (true) {
            const startInput = await ask("Enter start date (MM-DD-YYYY) or press Enter for the earliest date of the system: ");
            if (!startInput.trim()) {
                startDate = null;
                break;
            }
            const parts = startInput.trim().split("-");
            if (parts.length !== 3) {
                console.log("Invalid start date format. Use MM-DD-YYYY. Please try again.");
                continue;
            }
            const mon = parseInt(parts[0], 10);
            const day = parseInt(parts[1], 10);
            const yr = parseInt(parts[2], 10);
            if (isNaN(mon) || isNaN(day) || isNaN(yr) || mon < 1 || mon > 12 || day < 1 || day > 31) {
                console.log("Start date month must be 01-12 and day 01-31. Please try again.");
                continue;
            }
            const parsed = parseDate(startInput);
            if (!parsed) {
                console.log("Invalid start date (non-existent date). Please try again.");
                continue;
            }
            const parsedDT = DateTime.fromJSDate(parsed).setZone('Australia/Sydney').startOf('day');
            if (parsedDT > todaySydneyDT) {
                console.log("Start date cannot be in the future (Sydney local). Please try again.");
                continue;
            }
            startDate = parsed;
            break;
        }

        // Prompt and validate endDate (re-prompt until valid)
        while (true) {
            const endInput = await ask("Enter end date (MM-DD-YYYY) or press Enter for today: ");
            if (!endInput.trim()) {
                endDate = null;
                break;
            }
            const parts = endInput.trim().split("-");
            if (parts.length !== 3) {
                console.log("Invalid end date format. Use MM-DD-YYYY. Please try again.");
                continue;
            }
            const mon = parseInt(parts[0], 10);
            const day = parseInt(parts[1], 10);
            const yr = parseInt(parts[2], 10);
            if (isNaN(mon) || isNaN(day) || isNaN(yr) || mon < 1 || mon > 12 || day < 1 || day > 31) {
                console.log("End date month must be 01-12 and day 01-31. Please try again.");
                continue;
            }
            const parsed = parseDate(endInput);
            if (!parsed) {
                console.log("Invalid end date (non-existent date). Please try again.");
                continue;
            }
            const parsedDT = DateTime.fromJSDate(parsed).setZone('Australia/Sydney').startOf('day');
            if (parsedDT > todaySydneyDT) {
                console.log("End date cannot be in the future (Sydney local). Please try again.");
                continue;
            }
            endDate = parsed;
            break;
        }

        // validate order if both present; if invalid, loop to re-prompt start/end only
        if (startDate && endDate) {
            const s = DateTime.fromJSDate(startDate).setZone('Australia/Sydney');
            const e = DateTime.fromJSDate(endDate).setZone('Australia/Sydney');
            if (s > e) {
                console.log("Start date must be before or equal to end date. Please re-enter start and end dates.");
                continue; // re-run the outer while to re-prompt start and end
            }
        }

        break; // valid start/end collected
    }

    // Prompt whether to open the browser to display the scraping process
    let showBrowser = true;
    while (true) {
        const resp = await ask("Open browser to show process? (y/n): ");
        const t = resp.trim().toLowerCase();
        if (!t) { showBrowser = true; break; }
        if (t === 'y' || t === 'yes') { showBrowser = true; break; }
        if (t === 'n' || t === 'no') { showBrowser = false; break; }
        console.log("Please answer 'y' or 'n'.");
    }

    return { username, password, startDate, endDate, showBrowser };
}

// Export a small helper so callers can re-prompt credentials on login failure
export async function askCredentials(): Promise<{ username: string; password: string }> {
    console.log("(Type 'q' at any prompt to quit)");
    const username = await ask("Enter username (email): ");
    const password = await ask("Enter password: ");
    return { username, password };
}

/**
 * Filter results based on date range rules:
 * 1. start=null & end=null → return ALL
 * 2. start=null & end!=null → return earliest → end
 * 3. start!=null & end=null → return start → latest
 * 4. both exist → standard range
 */
function filterByDateRange(
    results: any[],
    startDate: Date | null,
    endDate: Date | null
): any[] {
    // No filtering at all
    if (!startDate && !endDate) {
        return results;
    }

    // Convert boundaries to Luxon DateTime in Australia/Sydney for reliable comparisons
    const startDT = startDate ? DateTime.fromJSDate(startDate).setZone('Australia/Sydney').startOf('day') : null;
    const endDT = endDate ? DateTime.fromJSDate(endDate).setZone('Australia/Sydney').endOf('day') : null;

    return results.filter(tx => {
        // tx.transactionDate is formatted as MM-DD-YYYY (from parseOpalDate path)
        const txDT = DateTime.fromFormat(tx.transactionDate, 'MM-dd-yyyy', { zone: 'Australia/Sydney' });
        if (!txDT.isValid) return false;
        // Case 2: start null, end not null → earliest → end
        if (!startDT && endDT) {
            return txDT <= endDT;
        }
        // Case 3: start not null, end null → start → latest
        if (startDT && !endDT) {
            return txDT >= startDT;
        }
        // Case 4: both exist
        return txDT >= startDT! && txDT <= endDT!;
    });
}

/**
 * Login using username + password
 */
export async function login(username: string, password: string, showBrowser: boolean): Promise<BrowserContext> {
    let browser: any = null;
    try {
        browser = await chromium.launch({ headless: !showBrowser });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('https://transportnsw.info/tickets-fares/opal-login#/login');
        await page.waitForSelector('iframe[src*="opal"]', { state: 'attached', timeout: 6000 });
        const frame = page.frame({ url: /opal/ });
        if (!frame) throw new Error("Could not find Opal login frame");

        await frame.waitForSelector('input[name="username"]', { timeout: 6000 });
        await frame.fill('input[name="username"]', username);
        await frame.fill('input[name="password"]', password);

        // Click login and wait for either the account page URL or an error message in the login frame.
        await frame.click('button.opal-username-login');

        const successPromise = page.waitForURL('**/opal-view/#/account/cards', { timeout: 6000 })
            .then(() => ({ type: 'success' } as any))
            .catch(() => ({ type: 'no-success' } as any));

        const errorSelector = '[role="alert"], .opal-login-error, .login-error, .error-message, .error';
        const errorPromise = frame.waitForSelector(errorSelector, { timeout: 6000 })
            .then((el: any) => ({ type: 'error', el } as any))
            .catch(() => ({ type: 'no-error' } as any));

        const res: any = await Promise.race([successPromise, errorPromise]);

        if (res && res.type === 'success') {
            console.log('Login successful');
            return context;
        }

        if (res && res.type === 'error') {
            let text = '';
            try { text = (await res.el.innerText()).trim(); } catch (e) { /* ignore */ }
            const lower = (text || '').toLowerCase();
            if (/invalid|incorrect|wrong|not match|password|username|email/.test(lower)) {
                console.error('Login failed: Invalid username or password');
            } else if (text) {
                console.error('Login failed:', text);
            } else {
                console.error('Login failed: unknown error');
            }
            try { if (browser) await browser.close(); } catch (e) {}
            throw new Error('InvalidCredentials');
        }

        // Fallback: check the URL once more; if not successful, signal a generic failure.
        try {
            const cur = page.url();
            if (cur.includes('/opal-view/#/account/cards')) {
                console.log('Login successful');
                return context;
            }
        } catch (e) {}

        console.error('Login failed: timeout or unexpected response');
        try { if (browser) await browser.close(); } catch (e) {}
        throw new Error('LoginFailed');
    } catch (err: any) {
        console.error('Login failed:', err && err.message ? err.message : err);
        // if browser was launched, try to close it to free resources
        try { if (browser) await browser.close(); } catch (e) {}
        throw err;
    }
}

/**
 * Get transactions for each card by month between startDate and endDate
 */
export async function getTransactions(
    context: BrowserContext,
    startDate: Date | null,
    endDate: Date | null
): Promise<any[]> {
    const page = context.pages()[0];
    await page.goto("https://transportnsw.info/opal-view/#/account/cards", { waitUntil: "networkidle" });

    const results: any[] = [];
    const pad = (n: number) => n.toString().padStart(2, "0");

    function fmtDate(d: Date) {
        // Format as MM-DD-YYYY using Australia/Sydney local date parts
        const dt = DateTime.fromJSDate(d).setZone('Australia/Sydney');
        return `${pad(dt.month)}-${pad(dt.day)}-${dt.year}`;
    }

    // -------------------- helpers --------------------
    async function getText(el: any, selector: string) {
        const node = await el.$(selector);
        return node ? (await node.innerText()).trim() : "";
    }

    function parseAmount(raw: string, description?: string) {
        const text = (raw || "").trim();
        const ctx = ((text + " " + (description || "")).trim()).toLowerCase();
        // Detect top-up keywords (common variants) in amount text or description
        const isTopUp = /top\s*-?\s*up|topup|recharge|credited|add funds|load|load funds|added/i.test(ctx) || ctx.includes('top');

        // Extract numeric value from the raw amount (handles $ , and optional +/- and decimals)
        const numericMatch = text.replace(/[$,]/g, "").match(/[+-]?\d+(?:\.\d+)?/);
        let amount = numericMatch ? parseFloat(numericMatch[0]) : 0;
        if (isNaN(amount)) amount = 0;

        if (isTopUp) {
            // Top-ups should be positive
            return { quantity: Math.abs(amount), currency: "AUD" };
        }
        // Charges should be negative
        return { quantity: -Math.abs(amount), currency: "AUD" };
    }

    async function extractMode(item: any) {
        const icons = await item.$$(".icons tni-icon");
        for (const icon of icons) {
            const name = await icon.getAttribute("iconname");
            if (name) return name;
            const useEl = await icon.$("use");
            const href = useEl ? await useEl.getAttribute("xlink:href") : null;
            if (!href) continue;
            if (href.includes("tp_bus")) return "bus";
            if (href.includes("tp_train")) return "train";
            if (href.includes("tp_ferry")) return "ferry";
            if (href.includes("tp_metro")) return "metro";
            if (href.includes("tp_light-rail")) return "light-rail";
        }
        return null;
    }

    function convertTimes(dateBase: any, timeStr: string) {
        if (!timeStr) return { time_local: null, time_utc: null };
        const [hh, mm] = timeStr.split(":").map(n => parseInt(n));
        const local = DateTime.fromObject(
            { year: dateBase.year, month: dateBase.month + 1, day: dateBase.day, hour: hh, minute: mm },
            { zone: "Australia/Sydney" }
        );
        const utc = local.toUTC();
        return {
            time_local: `${pad(local.month)}-${pad(local.day)}-${local.year} ${pad(local.hour)}:${pad(local.minute)}`,
            time_utc: `${pad(utc.month)}-${pad(utc.day)}-${utc.year} ${pad(utc.hour)}:${pad(utc.minute)}`
        };
    }

    function parseOpalDate(dateText: string) {
        const parts = dateText.split(/\s+/);
        if (parts.length < 4) return null;
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[3], 10);
        const months: any = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const month = months[parts[2]];
        if (month === undefined) return null;
        return { day, month, year };
    }

    // -------------------- collect cards --------------------
    await page.waitForSelector('.opal-selector__item', { timeout: 1000 });
    const cardEls = await page.$$('.opal-selector__item');
    const cards = [];
    for (const el of cardEls) {
        const text = (await el.innerText()).trim();
        if (!text || text.toLowerCase().includes("link card")) continue;
        const blocked = text.toLowerCase().includes("blocked");
        cards.push({ element: el, blocked, name: text.split("\n")[0].trim() });
    }

    // -------------------- month selector --------------------
    const monthSelector = await page.$('select.month-view-selector');
    if (!monthSelector) throw new Error("Month selector not found");
    const monthOptions = await monthSelector.$$('option');

    // Parse month labels into {label, value, month, year}
    const monthNameMap: { [k: string]: number } = {
        jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4, jun:5, june:5,
        jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8, oct:9, october:9, nov:10, november:10, dec:11, december:11
    };

    const monthsParsed: Array<{ label: string; value: string | null; month: number; year: number }> = [];
    for (const opt of monthOptions) {
        const label = (await opt.innerText()).trim();
        if (!label || label.toLowerCase().includes("last 7 days")) continue;
        const value = await opt.getAttribute('value');
        // Try to find a 4-digit year and a month name in the label
        const yearMatch = label.match(/(19|20)\d{2}/);
        const monthMatch = label.match(/([A-Za-z]+)/);
        if (!yearMatch || !monthMatch) continue;
        const year = parseInt(yearMatch[0], 10);
        const monName = monthMatch[0].toLowerCase();
        const month = monthNameMap[monName];
        if (month === undefined) continue;
        monthsParsed.push({ label, value, month, year });
    }

    function monthCmp(a: { month: number; year: number }, b: { month: number; year: number }) {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
    }

    // Determine target start/end months based on provided dates and available months
    let startMY: { month: number; year: number } | null = null;
    let endMY: { month: number; year: number } | null = null;
    if (startDate) {
        const dt = DateTime.fromJSDate(startDate).setZone('Australia/Sydney');
        startMY = { month: dt.month - 1, year: dt.year };
    }
    if (endDate) {
        const dt = DateTime.fromJSDate(endDate).setZone('Australia/Sydney');
        endMY = { month: dt.month - 1, year: dt.year };
    }

    // Sort monthsParsed ascending for deriving earliest/latest
    monthsParsed.sort((a, b) => monthCmp(a, b));

    // If user pressed Enter (null) default startDate to earliest available month
    // and default endDate to today's Sydney date.
    const todaySydneyDT = DateTime.now().setZone('Australia/Sydney').startOf('day');
    if (!startDate && monthsParsed.length > 0) {
        const earliest = monthsParsed[0];
        const earliestDT = DateTime.fromObject({ year: earliest.year, month: earliest.month + 1, day: 1 }, { zone: 'Australia/Sydney' }).startOf('day');
        startDate = earliestDT.toJSDate();
        console.log(`startDate not provided; defaulting to earliest available month ${fmtDate(startDate)}`);
    }
    if (!endDate) {
        endDate = todaySydneyDT.toJSDate();
        console.log(`endDate not provided; defaulting to today (Sydney) ${fmtDate(endDate)}`);
    }

    // Compute startMY/endMY from (possibly defaulted) startDate/endDate
    if (startDate) {
        const dt = DateTime.fromJSDate(startDate).setZone('Australia/Sydney');
        startMY = { month: dt.month - 1, year: dt.year };
    }
    if (endDate) {
        const dt = DateTime.fromJSDate(endDate).setZone('Australia/Sydney');
        endMY = { month: dt.month - 1, year: dt.year };
    }

    // If user provided startDate earlier than the earliest month available,
    // clamp startDate to the earliest month start (Sydney local).
    if (startDate && monthsParsed.length > 0) {
        const earliest = monthsParsed[0];
        const startDT = DateTime.fromJSDate(startDate).setZone('Australia/Sydney').startOf('day');
        const earliestDT = DateTime.fromObject({ year: earliest.year, month: earliest.month + 1, day: 1 }, { zone: 'Australia/Sydney' }).startOf('day');
        if (startDT < earliestDT) {
            startDate = earliestDT.toJSDate();
            console.log(`startDate earlier than earliest available month; adjusting startDate to ${fmtDate(startDate)}`);
        }
        // recompute startMY from possibly-updated startDate
        const dt = DateTime.fromJSDate(startDate).setZone('Australia/Sydney');
        startMY = { month: dt.month - 1, year: dt.year };
    }

    if (!startMY && !endMY) {
        // No dates provided → default to available earliest → latest
        if (monthsParsed.length > 0) {
            startMY = { month: monthsParsed[0].month, year: monthsParsed[0].year };
            endMY = { month: monthsParsed[monthsParsed.length - 1].month, year: monthsParsed[monthsParsed.length - 1].year };
        }
    } else {
        // Fill missing boundary from available months
        if (!startMY && monthsParsed.length > 0) startMY = { month: monthsParsed[0].month, year: monthsParsed[0].year };
        if (!endMY && monthsParsed.length > 0) endMY = { month: monthsParsed[monthsParsed.length - 1].month, year: monthsParsed[monthsParsed.length - 1].year };
    }

    // If user provided an endDate and it's before today's date (UTC),
    // we should suppress bankImportedBalance values because the balance at
    // the end of the requested range won't reflect today's/latest balance.
    let disableBankImported = false;
    if (endDate) {
        // Compare endDate to today's date in Australia/Sydney local time
        const todaySydney = DateTime.now().setZone('Australia/Sydney').startOf('day').toJSDate();
        if (DateTime.fromJSDate(endDate).setZone('Australia/Sydney').toMillis() < DateTime.fromJSDate(todaySydney).setZone('Australia/Sydney').toMillis()) {
            disableBankImported = true;
        }
    }

    // Build months to iterate: those between startMY and endMY (inclusive).
    let monthsToUse: Array<{ label: string; value: string | null; month: number; year: number }> = [];
    if (startMY && endMY) {
        monthsToUse = monthsParsed.filter(m => {
            const val = { month: m.month, year: m.year };
            return monthCmp(startMY!, val) <= 0 && monthCmp(val, endMY!) <= 0;
        });
        // Iterate from end -> start as requested (descending)
        monthsToUse.sort((a, b) => monthCmp(b, a));
    } else {
        // Fallback: use all parsed months in descending order
        monthsToUse = monthsParsed.slice().sort((a, b) => monthCmp(b, a));
    }

    // -------------------- iterate cards and months --------------------
    for (const card of cards) {
        if (card.blocked) continue;
        console.log(`Scraping card: ${card.name}`);
        await card.element.click();

        // scraper  to get last balance
        const balanceTextEl = await card.element.$('.opal-selector__card-value');
        let lastBalance: number | null = null;
        if (balanceTextEl) {
            const balanceText = (await balanceTextEl.innerText()).replace("$", "").trim();
            const bal = parseFloat(balanceText);
            if (!isNaN(bal)) lastBalance = bal;
        }
    
        let runningBalance: number | null = lastBalance;
        for (const m of monthsToUse) {
            const beforeCount = results.length;
            await monthSelector.selectOption({ value: m.value ?? undefined });
            await page.waitForResponse(res => res.url().includes("activity") && res.status() === 200).catch(() => {});

            const activityExists = await page.$(".activity-by-date-container");
            if (!activityExists) {
                console.log(`Month ${m.label}: no activity containers; scraped 0 transactions`);
                continue;
            }

            const blocks = await page.$$(".activity-by-date-container");
            for (const block of blocks) {
                const dateText = await block.$eval(".activity-date", el => el.textContent?.trim() || "");
                const parsedDate = parseOpalDate(dateText);
                if (!parsedDate) continue;
                const transactionDate = `${pad(parsedDate.month + 1)}-${pad(parsedDate.day)}-${parsedDate.year}`;

                const items = await block.$$("tni-card-activity .card-activity-item");
                for (const item of items) {
                    const timeText = await getText(item, ".date");
                    const description = await getText(item, ".description");
                    const amountText = await getText(item, ".amount");
                    const { quantity, currency } = parseAmount(amountText, description);
                    const mode = await extractMode(item);
                    const tap_on_location = await getText(item, ".from");
                    const tap_off_location = tap_on_location ? await getText(item, ".to") : null;
                    const { time_local, time_utc } = convertTimes(parsedDate, timeText);

                    // ---------------- bankImportedBalance ----------------
                    let bankImportedBalance: string | null = null;
                    if (!disableBankImported && runningBalance !== null) {
                        bankImportedBalance = runningBalance.toFixed(2);
                    }
                    if (runningBalance !== null) {
                        runningBalance = runningBalance - quantity;
                    }

                    results.push({
                        transactionDate,
                        time_local,
                        time_utc,
                        quantity,
                        currency,
                        accountId: card.name,
                        mode,
                        description,
                        tap_on_location,
                        tap_off_location,
                        status: quantity !== 0 ? "posted" : "pending",
                        bankImportedBalance
                    });
                }
            }

            const afterCount = results.length;
            const monthCount = afterCount - beforeCount;
            console.log(`Month ${m.label}: scraped ${monthCount} transactions`);
        }
    }
    // -------------------- DATE FILTER --------------------
    const filtered = filterByDateRange(results, startDate, endDate);

    // Determine output filename based on provided date boundaries
    let filename: string;
    if (!startDate && !endDate) {
        filename = 'transactions_all.json';
    } else if (!startDate && endDate) {
        filename = `transactions_earliest_${fmtDate(endDate)}.json`;
    } else if (startDate && !endDate) {
        filename = `transactions_${fmtDate(startDate)}_latest.json`;
    } else {
        filename = `transactions_${fmtDate(startDate!)}_${fmtDate(endDate!)}.json`;
    }

    // output json file
    const outPath = path.resolve(process.cwd(), filename);
    fs.writeFileSync(outPath, JSON.stringify(filtered, null, 2), 'utf8');

    return filtered;
}