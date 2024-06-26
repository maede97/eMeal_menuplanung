import {CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList} from '@angular/cdk/drag-drop';
import {Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, ViewChild} from '@angular/core';

import {Day} from '../../classes/day';
import {SpecificMeal} from '../../classes/specific-meal';
import {EditDayComponent} from '../../dialoges/edit-day/edit-day.component';
import {MatDialog} from '@angular/material/dialog';
import {ContextMenuNode, ContextMenuService} from '../../services/context-menu.service';
import {ActivatedRoute, Router} from '@angular/router';
import {HelpService} from '../../services/help.service';
import {MealUsage} from '../../interfaces/firestoreDatatypes';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Observable, Subscription} from 'rxjs';
import {map, take} from 'rxjs/operators';
import Timeout = NodeJS.Timeout;
import {DatabaseService} from '../../services/database.service';
import {SwissDateAdapter} from '../../../../shared/utils/format-datapicker';

@Component({
  selector: 'app-day-overview',
  templateUrl: './day-overview.component.html',
  styleUrls: ['./day-overview.component.sass'],

})
export class DayOverviewComponent implements OnChanges, OnInit, OnDestroy {

  @Input() access: boolean;
  @Input() day: Day;
  @Input() mealsToPrepare: Observable<SpecificMeal[]>;
  @Input() specificMeals: Observable<SpecificMeal[]>;
  @Input() days: Day[];
  @Input() hideIcons = false;

  @Output() mealDropped = new EventEmitter<[SpecificMeal, MealUsage, string]>();
  @Output() mealDeleted = new EventEmitter<[string, string]>();
  @Output() dayEdited = new EventEmitter<[number, Day, SpecificMeal[]]>();
  @Output() addMeal = new EventEmitter<[Day, MealUsage]>();

  @ViewChild('dayElement') dayElement;

  public hidden = false;
  public warning: string;
  public specificMealsByName = {};
  private crashChecker: Timeout;
  private specificMealsSubscription: Subscription;

  constructor(public dialog: MatDialog,
              public swissDateAdapter: SwissDateAdapter,
              private contextMenuService: ContextMenuService,
              private router: Router,
              private activeRoute: ActivatedRoute,
              private helpService: HelpService,
              private snackBar: MatSnackBar,
              private dbService: DatabaseService) {
  }

  ngOnDestroy(): void {
    this.specificMealsSubscription?.unsubscribe();
  }


  ngOnInit(): void {

    this.getMealNames().forEach(name => {

      if (name === 'Vorbereiten') {
        this.specificMealsByName[name] = this.mealsToPrepare;
      } else {
        this.specificMealsByName[name] = this.specificMeals.pipe(
          map(meals =>
            meals.filter(meal =>
              meal.usedAs === name)));
      }
    });


  }


  getMealNames() {

    return ['Zmorgen', 'Znüni', 'Zmittag', 'Zvieri', 'Znacht', 'Dessert', 'Leitersnack', 'Vorbereiten'];

  }

  setContextMenu(includeLateChanges = true) {

    if (includeLateChanges) {
      setTimeout(() => this.setContextMenu(false), 250);
    }

    if (this.specificMeals === null) {
      return;
    }


    const empties = this.dayElement?.nativeElement.querySelectorAll('[data-add-note="true"]');

    // TODO: including this leads to performance issues
    /*
    if (empties === undefined || empties.length === 0) {
      setTimeout(() => {
        console.log("setContextMenu_timeout2");
        this.setContextMenu();
      }, 250);
      return;
    }
    */


    empties.forEach(empty => {

      const node: ContextMenuNode = {
        node: empty as HTMLElement,
        contextMenuEntries: [
          {
            icon: 'add',
            name: 'Hinzufügen',
            shortCut: '',
            disabled: !(empty as HTMLElement).classList.contains('meal-addable'),
            function: () => this.addMeal.emit([this.day, empty.parentElement.getAttribute('data-meal-name')])
          },
          {
            icon: 'sticky_note_2',
            name: 'Notiz einfügen',
            shortCut: '',
            disabled: true,
            function: () => {
              this.snackBar.open('Notizen können zur Zeit nicht hinzugefügt werden!', '', {duration: 2000});
            }
          },
          'Separator',
          {
            icon: 'help',
            name: 'Hilfe / Erklärungen',
            shortCut: 'F1',
            function: () => this.helpService.openHelpPopup()
          }
        ]
      };

      this.contextMenuService.addContextMenuNode(node);

    });

    this.specificMealsSubscription?.unsubscribe();
    this.specificMealsSubscription = this.specificMeals.subscribe(meals => meals.forEach(meal => {

      const elements = document.querySelectorAll('[data-meal-id=ID-' + meal.documentId + ']');

      if (elements === null || elements === undefined) {
        return;
      }

      elements.forEach(element => {

        if (element.parentElement.nodeName !== 'BODY') {

          const node: ContextMenuNode = {
            node: element as HTMLElement,
            contextMenuEntries: [
              {
                icon: 'edit',
                name: 'Bearbeiten',
                shortCut: '',
                function: () => this.router.navigate([`meals/${meal.getMealId()}/${meal.documentId}`],
                  {relativeTo: this.activeRoute})
              },
              {
                icon: 'delete',
                name: 'Mahlzeit entfernen',
                shortCut: '',
                function: () => this.mealDeleted.emit([meal.getMealId(), meal.documentId])
              },
              'Separator'
            ]
          };

          if (((element as HTMLElement).parentElement.parentElement).classList.contains('Vorbereiten')) {
            node.contextMenuEntries.push({
              icon: 'av_timer',
              name: 'Vorbereiten Löschen',
              shortCut: '',
              function: () => this.removePrepareDate(meal)
            });
            node.contextMenuEntries.push('Separator');
          }

          node.contextMenuEntries.push({
            icon: 'help',
            name: 'Hilfe / Erklärungen',
            shortCut: 'F1',
            function: () => this.helpService.openHelpPopup()
          });

          this.contextMenuService.addContextMenuNode(node);
        }
      });
    }));

  }


  ngOnChanges() {

    this.warning = '';
    this.setContextMenu();
    this.mealsToPrepare =
      this.mealsToPrepare?.pipe(map(meals => meals.filter(meal => meal.prepareAsDate.getTime() === this.day.dateAsTypeDate.getTime())));

  }

  /**
   *
   */
  public visible(specificMealId: string) {

    if (document.getElementById(specificMealId)) {

      return !document.getElementById(specificMealId).classList.contains('hidden');

    }

    return true;

  }


  /**
   * Berbeite einen Tag.
   *
   * Öffnet den entsprechenden
   *
   */
  editDay(day: Day) {

    this.specificMeals.pipe(take(1)).subscribe(meals => {

      this.dialog
        .open(EditDayComponent, {
          height: '618px',
          width: '1000px',
          data: {day, specificMeals: meals, days: this.days, access: this.access}
        })
        .afterClosed()
        .subscribe((save: number) => {

          this.dayEdited.emit([save, this.day, meals]);

        });
    });

  }


  mealDroppedAction([meal, event]: [SpecificMeal, CdkDragDrop<any, any>]) {

    console.log('mealDroppedAction');

    const mealDropUsage = event.container.element.nativeElement.dataset.mealName

    // Don't update the model, if the meal has not been moved to another location.
    if (event.container === event.previousContainer || mealDropUsage === 'Vorbereiten') {

      if (mealDropUsage === 'Vorbereiten') {
        this.snackBar
          .open('Mahlzeit konnte nicht verschoben werden. Erfahre, wie du Mahlzeiten vorbereiten kannst.', 'Hilfe', {duration: 2500})
          .onAction().subscribe(() => {
          this.helpService.openHelpPopup('mahlzeit-vorbereiten')
        });
      }

      this.setContextMenu();
      return;
    }


    // hide meal at old place
    event.item.element.nativeElement.style.visibility = 'hidden';

    // remove the meal form the current day. If this line is commented out
    // a wird flicker will occur, where the meal first jumps to the correct time, e.g.
    // form "Zmorgen" to "Znacht" before jumping to the correct day.
    this.specificMeals = this.specificMeals.pipe(map(meals => meals.filter(m => m !== meal)));

    // Move the meal in the model
    const mealUsage: MealUsage =
      event.container.element.nativeElement.getAttribute('data-meal-name') as MealUsage;
    const mealDateString = event.container.element.nativeElement.parentElement.id;
    this.mealDropped.emit([meal, mealUsage, mealDateString]);

    this.setContextMenu(true);

  }


  predicate(drag: CdkDrag, drop: CdkDropList): boolean {

    return drop.element.nativeElement.getAttribute('is-full') !== 'true';

  }

  dragStarted(event: CdkDragStart) {


    this.crashChecker = setInterval(() => {

      if (event.source.dropped.observers.length === 0) {

        clearInterval(this.crashChecker);

        this.router.navigate(['..'], {relativeTo: this.activeRoute}).then(() =>
          this.activeRoute.url.subscribe(segments =>
            this.router.navigate(['app'].concat(segments.map(seg => seg.path)))));

        setTimeout(() =>
            this.snackBar.open(
              'Es ist ein Fehler aufgetreten. Die Seite wurde neu geladen.',
              'Schliessen',
              {duration: 3_500}),
          500);

      }

    }, 25);


    document.querySelectorAll('.has-a-meal, .Vorbereiten').forEach(el => {
      if (el !== event.source.dropContainer.element.nativeElement) {
        el.classList.add('block-drop');
      } else {
        el.classList.add('home-field');
      }
    });


  }

  dragStopped(event: CdkDragStart) {

    console.log('dragStopped');

    clearInterval(this.crashChecker);

    document.querySelectorAll('.has-a-meal, .Vorbereiten').forEach(el => {
      if (el !== event.source.dropContainer.element.nativeElement) {
        el.classList.remove('block-drop');
      } else {
        el.classList.remove('home-field');
      }
    });

    document.querySelectorAll('.block-drop').forEach(el =>
      el.classList.remove('block-drop'));

  }

  addMealToUsage(emit: [Day, string]) {
    this.addMeal.emit(emit as [Day, MealUsage]);
  }

  private removePrepareDate(meal: SpecificMeal) {

    meal.prepare = false;
    this.dbService.updateDocument(meal);

  }
}
