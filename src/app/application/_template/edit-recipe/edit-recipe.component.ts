import {AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output} from '@angular/core';
import {Recipe} from '../../_class/recipe';
import {FormBuilder, FormGroup} from '@angular/forms';
import {MatTableDataSource} from '@angular/material/table';
import {Ingredient} from '../../_interfaces/firestoreDatatypes';
import {HeaderNavComponent} from '../../../_template/header-nav/header-nav.component';
import {DatabaseService} from '../../_service/database.service';

@Component({
  selector: 'app-edit-recipe',
  templateUrl: './edit-recipe.component.html',
  styleUrls: ['./edit-recipe.component.sass']
})
export class EditRecipeComponent implements OnInit, AfterViewInit, OnChanges {

  public displayedColumns: string[] = ['measure', 'calcMeasure', 'unit', 'food', 'comment', 'fresh-product', 'delete'];

  public recipeForm: FormGroup;
  public dataSource: MatTableDataSource<Ingredient>;

  @Input() public recipe: Recipe;
  @Input() public participants: number;
  @Output() newUnsavedChanges = new EventEmitter();
  public hasAccess = false;
  private keyListenerEnter: EventListenerOrEventListenerObject;
  private ingredientFieldNodes: Element[];

  constructor(
    private formBuilder: FormBuilder,
    private databaseService: DatabaseService,
    private hostElement: ElementRef) {
  }

  async ngOnInit() {

    this.ingredientFieldNodes = this.getNodes();
    this.recipe.getIngredients().subscribe(ings => {
      this.dataSource = new MatTableDataSource<Ingredient>(ings);
      console.log(ings);
      console.log('loaded');

    });
    this.recipeForm = this.formBuilder.group({notes: this.recipe.notes});

    // check if the current user has access
    this.hasAccess = await this.databaseService.canWrite(this.recipe);

    this.recipeForm.statusChanges.subscribe(() => {
      this.newUnsavedChanges.emit();
      HeaderNavComponent.turnOn('Speichern');
      this.recipe.notes = this.recipeForm.value.notes;
    });

  }

  ngOnChanges() {

    // add back the calcMeasure field
    if (this.participants <= 1) {
      this.displayedColumns = this.displayedColumns.filter(el => el !== 'calcMeasure');
    } else if (!this.displayedColumns.includes('calcMeasure')) {
      this.displayedColumns.splice(1, 0, 'calcMeasure');
    }

    // reactivates the save button
    setTimeout(() => {

      this.ingredientFieldNodes = this.getNodes();
      this.setFocusChanges();

    }, 500);

  }


  ngAfterViewInit() {

    this.setFocusChanges();

  }


  public toggleFresh(ingredient: Ingredient) {

    if (!this.hasAccess) {
      return;
    }

    ingredient.fresh = !ingredient.fresh;
    this.dataSource._updateChangeSubscription();

    HeaderNavComponent.turnOn('Speichern');
    this.newUnsavedChanges.emit();

  }

  /**
   * Löscht ein Ingredient aus dem Rezept
   *
   * @param index Index des Ingredient = Zeile in der Tabelle
   */
  deleteIngredient(uniqueId: string) {

    if (!this.hasAccess) {
      return;
    }

    this.recipe.removeIngredient(uniqueId, 'a_unique_id');
    HeaderNavComponent.turnOn('Speichern');

    this.newUnsavedChanges.emit();

  }

  /**
   * Fügt ein leeres Ingredient-Field am Ende der Tabelle hinzu.
   */
  addIngredientField() {

    if (!this.hasAccess) {
      return;
    }

    const ingredient = {
      food: '',
      unit: '',
      measure: null,
      comment: '',
      fresh: false,
      unique_id: Recipe.createIngredientId(this.recipe.documentId)
    };
    // generiert leere Daten für ein neues Ingredient
    this.recipe.addIngredient(ingredient); // fügt es in der Datenstruktur ein


    // set focus to new Element
    this.setFocusChanges();
    this.ingredientFieldNodes = this.getNodes();
    (this.ingredientFieldNodes[this.ingredientFieldNodes.length - 5] as HTMLElement).focus();

    this.newUnsavedChanges.emit();
    HeaderNavComponent.turnOn('Speichern');

  }


  /**
   * Aktion bei einer Veränderung eines Ingredient-Feldes
   */
  changeIngredient(value: string, index: number, element: string) {

    // Eingabe von mehreren durch Tabs geteilte Zellen (z.B. Copy-Past aus Excel)
    if (element === 'measure' && value.includes('\t')) {
      this.parseTableInput(index, value);

    } else if (element === 'calcMeasure') {

      // Berechnung für eine Person
      this.dataSource.data[index].measure = Number.parseFloat(value) / this.participants;

    } else {

      // übernahme ins Object Recipe
      this.dataSource.data[index][element] = value;
    }

    this.newUnsavedChanges.emit();

  }


  /**
   *
   */
  private keyListner(i: number): EventListenerOrEventListenerObject {

    return (event: any) => {

      HeaderNavComponent.turnOn('Speichern');

      if (event.key === 'Enter') {

        if (i + 1 < this.ingredientFieldNodes.length) {

          const nextFocus = i % 5 === 0 ? i + 2 : i + 1;
          (this.ingredientFieldNodes[nextFocus] as HTMLElement).focus();
        } else {

          this.addIngredientField();
        }
      }
    };
  }

  /**
   * Parst einen Input als Tabelle
   */
  private parseTableInput(index: number, value: string) {

    // TODO: Fix...
    throw new Error('Not working');

    /*
    this.recipe.getIngredients().splice(index, 1);

    // Regulärer Ausdruck für das Parsing des Inputs
    const ex = /([0-9]|[.][0-9])+\t([a-z]|[ä]|[ü]|[ö]|[.])+\t([a-z]|[ä]|[ü]|[ö]|[0-9]|[ ](?!([0-9]|[.])+\t))+/gi;

    const ingredientsAsArray = value.match(ex).join().split(',');

    let i = index;

    for (const ing of ingredientsAsArray) {

      const ingredientAsArray = ing.split('\t');

      this.recipe.addIngredient({
        unique_id: Recipe.createIngredientId(this.recipe.documentId),
        food: ingredientAsArray[2],
        unit: ingredientAsArray[1],
        measure: Number.parseFloat(ingredientAsArray[0]),
        comment: '',
        fresh: false,
      });

      i++;
    }

    this.dataSource._updateChangeSubscription();


     */

  }

  /**
   *
   */
  private setFocusChanges() {

    // delete old listeners
    for (const node of this.ingredientFieldNodes) {
      node.removeEventListener('keydown', this.keyListenerEnter);
    }

    // add new listeners
    for (let i = 0; i < this.ingredientFieldNodes.length; i++) {
      this.keyListenerEnter = this.keyListner(i);
      this.ingredientFieldNodes[i].addEventListener('keydown', this.keyListenerEnter);
    }

  }

  /**
   * @returns all nodes of an ingredient-field in this recipe-panel
   */
  private getNodes(): any {

    return this.hostElement.nativeElement.getElementsByClassName('ingredient-field');

  }

}
