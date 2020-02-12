import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { Day } from '../../_class/day';
import { SpecificMeal } from '../../_class/specific-meal';

@Component({
  selector: 'app-edit-day',
  templateUrl: './edit-day.component.html',
  styleUrls: ['./edit-day.component.sass']
})
export class EditDayComponent implements OnInit {

  public dayInfo: FormGroup;
  private currentDate;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { day: Day, specificMeals: SpecificMeal[], days: Day[] },
    private formBuilder: FormBuilder) { }

  ngOnInit() {

    this.currentDate = this.data.day.dateAsTypeDate;

    this.dayInfo = this.formBuilder.group({

      description: this.data.day.description,
      date: this.data.day.dateAsTypeDate

    });

  }

  /**
   * Mahlzeiten können nur mind. ein Tag vorhher vorbereitet werden.
   *
   */
  public dateFilter = (d: Date | null): boolean => {

    const withSameDate = this.data.days.filter(day => day.dateAsTypeDate.getTime() === d.getTime());
    return withSameDate.length === 0 || d.getTime() === this.currentDate.getTime();

  }


  saveDayData() {

    this.data.day.dateAsTypeDate = this.dayInfo.value.date;
    this.data.day.description = this.dayInfo.value.description;

  }

}
