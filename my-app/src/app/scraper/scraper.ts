import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-scraper',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
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

  constructor(private http: HttpClient) {}

  async run() {
    if (!this.username || !this.password) {
      alert('Please enter username and password.');
      return;
    }
    this.running = true;
    try {
      const payload = {
        username: this.username.trim(),
        password: this.password,
        startDate: this.startDate || null,
        endDate: this.endDate || null,
        showBrowser: !!this.showBrowser
      };

      const resp = await lastValueFrom(this.http.post('/api/scrape', payload, { responseType: 'blob' } as any));
      if (!resp) {
        alert('No response from server');
        return;
      }
      // resp may be inferred as ArrayBuffer by the compiler in some setups; ensure it's treated as a Blob
      const blob = resp as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Try extract filename from Content-Disposition if present
      // Note: HttpClient in this mode doesn't expose headers easily; rely on default
      a.download = 'transactions.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      try {
        const txt = await (e?.error?.text ? e.error.text() : Promise.resolve(String(e)));
        alert('Error: ' + (txt || e.message || e));
      } catch (_) {
        alert('Request failed: ' + (e?.message || e));
      }
    } finally {
      this.running = false;
    }
  }
}
