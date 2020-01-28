import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { InformationspageComponent } from './informations-page.component';

describe('HelpPageComponent', () => {
  let component: InformationspageComponent;
  let fixture: ComponentFixture<InformationspageComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ InformationspageComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(InformationspageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
