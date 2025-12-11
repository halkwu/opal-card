import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DateRange } from './date-range';

describe('DateRange', () => {
  let component: DateRange;
  let fixture: ComponentFixture<DateRange>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DateRange]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DateRange);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
