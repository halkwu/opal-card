import { Component, signal } from '@angular/core';
import { Scraper } from './scraper/scraper';

@Component({
  selector: 'app-root',
  imports: [Scraper],
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('my-app');
}
