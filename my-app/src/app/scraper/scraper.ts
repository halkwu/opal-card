import { Component, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-scraper',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scraper.html',
  styleUrls: ['./scraper.css']
})
export class Scraper {
  username = '';
  password = '';
  startDate: string | null = null;
  endDate: string | null = null;
  showBrowser = true;
  running = false;
  message: string | null = null;
  messageType: 'info' | 'error' = 'info';
  previewColumns: string[] = [];
  previewRows: Array<Record<string, any>> = [];
  tableError: string | null = null;

  progressPercent = 0;
  progressMessage: string | null = null;
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef, private zone: NgZone) {}

  async run() {
    if (!this.username || !this.password) {
      this.showMessage('Please enter username and password.', 'error');
      return;
    }
    // Validate & normalize dates: allow empty; accept MM-DD-YYYY or MM/DD/YYYY; normalize to MM-DD-YYYY
    const isEmpty = (s: string | null | undefined) => !s || s.trim() === '';
    const normalizeDate = (s: string): string | null => {
      const raw = s.trim().replace(/\//g, '-');
      // Accept single-digit month/day and pad to two digits
      const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw);
      if (!m) return null;
      let mm = parseInt(m[1], 10);
      let dd = parseInt(m[2], 10);
      const yyyy = parseInt(m[3], 10);
      if (mm < 1 || mm > 12) return null;
      if (dd < 1 || dd > 31) return null;
      const d = new Date(yyyy, mm - 1, dd);
      if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(mm)}-${pad(dd)}-${yyyy}`;
    };

    if (!isEmpty(this.startDate)) {
      const norm = normalizeDate(this.startDate as string);
      if (!norm) {
        this.showMessage('Start date must be in valid format', 'error');
        return;
      }
      // Future date check for start date
      const [mmS, ddS, yyyyS] = norm.split('-').map((v) => parseInt(v, 10));
      const start = new Date(yyyyS, mmS - 1, ddS);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start.getTime() > today.getTime()) {
        this.showMessage('Start date cannot be in the future', 'error');
        return;
      }
      this.startDate = norm;
    }
    if (!isEmpty(this.endDate)) {
      const norm = normalizeDate(this.endDate as string);
      if (!norm) {
        this.showMessage('End date must be in valid format', 'error');
        return;
      }
      // Future date check for end date
      const [mmE, ddE, yyyyE] = norm.split('-').map((v) => parseInt(v, 10));
      const end = new Date(yyyyE, mmE - 1, ddE);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (end.getTime() > today.getTime()) {
        this.showMessage('End date cannot be in the future', 'error');
        return;
      }
      this.endDate = norm;
    }
    this.running = true;
    try {
      this.progressPercent = 0;
      this.progressMessage = 'Starting...';

      const params = new URLSearchParams({
        username: this.username.trim(),
        password: this.password,
        showBrowser: String(!!this.showBrowser),
      });

      if (this.startDate) params.set('startDate', this.startDate);
      if (this.endDate) params.set('endDate', this.endDate);

      const url = `/api/scrape/stream?${params.toString()}`;

      this.eventSource = new EventSource(url);

      this.eventSource.onmessage = (evt) => {
        this.zone.run(() => {
          const data = JSON.parse(evt.data);

          if (data.type === 'progress') {
            this.progressPercent = data.percent ?? 0;
            this.progressMessage = data.message || null;
          }

          if (data.type === 'done') {
            this.eventSource?.close();
            this.eventSource = null;

            this.progressPercent = 100;
            this.progressMessage = 'Completed';

            this.displayTransactionsFromBlob(
              new Blob([JSON.stringify(data.transactions)], {
                type: 'application/json'
              })
            );

            this.showMessage('Transactions loaded.', 'info');
            this.running = false;
          }

          if (data.type === 'error') {
            this.eventSource?.close();
            this.eventSource = null;

            this.showMessage(data.message || 'Scraping failed', 'error');
            this.running = false;
          }

          this.cdr.detectChanges();
        });
      };
      this.eventSource.onerror = () => {
        this.zone.run(() => {
          // Handle network/connection errors for SSE
          this.eventSource?.close();
          this.eventSource = null;
          if (this.running) {
            this.showMessage('Connection lost while receiving progress.', 'error');
            this.running = false;
          }
          this.cdr.detectChanges();
        });
      };
    } catch (e: any) {
      try {
        // Detect invalid credentials (401) and show a friendly message
        if (e?.status === 401) {
          this.showMessage('Please enter the correct username or password.', 'error');
        } else {
          const txt = await (e?.error?.text ? e.error.text() : Promise.resolve(String(e)));
          const msg = (txt || e?.message || e);
          if (typeof msg === 'string' && /Invalid\s*credentials/i.test(msg)) {
            this.showMessage('Please enter the correct username or password.', 'error');
          } else {
            this.showMessage('Error: ' + msg, 'error');
          }
        }
      } catch (_) {
        if (e?.status === 401) {
          this.showMessage('Please enter the correct username or password', 'error');
        } else {
          this.showMessage('Request failed: ' + (e?.message || e), 'error');
        }
      }
    } finally {
      // Do not toggle running here; it's controlled by SSE events
      this.zone.run(() => {
        this.cdr.detectChanges();
      });
    }
  }

  // Parse a Blob of JSON transactions and render specific columns
  private async displayTransactionsFromBlob(blob: Blob) {
    try {
      const text = await blob.text();
      const data = JSON.parse(text);
      let rows: any[] = [];
      if (Array.isArray(data)) {
        rows = data;
      } else if (data && typeof data === 'object') {
        const candidateKey = ['transactions', 'items', 'data'].find(k => Array.isArray((data as any)[k]));
        rows = candidateKey ? (data as any)[candidateKey] : [data];
      }
      rows = rows.filter(r => r && typeof r === 'object');
      if (!rows.length) {
        this.tableError = 'JSON format not recognized: expected a list of objects.';
        return;
      }

      // Keep only specified fields and set column order
      const desiredColumns = [
        'time_local',
        'quantity',
        'currency',
        'accountId',
        'mode',
        'tap_on_location',
        'tap_off_location',
        'status',
        'bankImportedBalance'
      ];

      const processed = rows.map(r => {
        const o: Record<string, any> = {};
        for (const k of desiredColumns) {
          o[k] = r[k];
        }
        return o;
      });

      this.previewColumns = desiredColumns;
      this.previewRows = processed;
      this.tableError = null;
      this.cdr.detectChanges();
    } catch (err: any) {
      this.tableError = 'Failed to parse transactions: ' + (err?.message || String(err));
    }
  }

  private showMessage(msg: string, type: 'info' | 'error' = 'info', autoClearMs = 5000) {
    this.messageType = type;
    this.message = msg;
    if (autoClearMs > 0) {
      window.clearTimeout((this as any)._msgTimer);
      (this as any)._msgTimer = window.setTimeout(() => {
        this.message = null;
        this.cdr.detectChanges();
      }, autoClearMs);
    }
  }

  // Load a downloaded JSON file and render as a table
  async onFileSelected(evt: Event) {
    this.tableError = null;
    this.previewColumns = [];
    this.previewRows = [];
    const input = evt.target as HTMLInputElement;
    const file = input?.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Accept either an array of objects or a single object with a property containing the array
      let rows: any[] = [];
      if (Array.isArray(data)) {
        rows = data;
      } else if (data && typeof data === 'object') {
        // Try common keys
        const candidateKey = ['transactions', 'items', 'data'].find(k => Array.isArray((data as any)[k]));
        rows = candidateKey ? (data as any)[candidateKey] : [data];
      }
      rows = rows.filter(r => r && typeof r === 'object');
      if (!rows.length) {
        this.tableError = 'JSON format not recognized: expected a list of objects.';
        return;
      }
      // Derive columns from union of keys across first N rows
      const sampleCount = Math.min(rows.length, 20);
      const keySet = new Set<string>();
      for (let i = 0; i < sampleCount; i++) {
        Object.keys(rows[i]).forEach(k => keySet.add(k));
      }
      this.previewColumns = Array.from(keySet);
      this.previewRows = rows;
      this.cdr.detectChanges();
    } catch (err: any) {
      this.tableError = 'Failed to load JSON: ' + (err?.message || String(err));
    }
  }

  formatCell(v: any): string {
    if (v == null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  }
}
