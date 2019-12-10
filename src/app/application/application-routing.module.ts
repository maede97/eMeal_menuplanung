import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CampListPageComponent } from './_pages/camp-list-page/camp-list-page.component';
import { EditCampPageComponent } from './_pages/edit-camp-page/edit-camp-page.component';
import { EditMealComponent } from './_pages/edit-meal/edit-meal.component';
import { ExportCampComponent } from './_pages/export-camp/export-camp.component';
import { MealListPageComponent } from './_pages/meal-list-page/meal-list-page.component';
import { WelcomPageComponent } from './_pages/welcom-page/welcom-page.component';


const routes: Routes = [

  {
    path: '',
    component: WelcomPageComponent
  },
  {
    path: 'camps',
    component: CampListPageComponent
  },
  {
    path: 'meals',
    component: MealListPageComponent
  },
  {
    path: 'camps/:id',
    component: EditCampPageComponent
  },
  {
    path: 'camps/:id/export',
    component: ExportCampComponent

  },
  {
    path: 'camps/:id/meals/:mealId/:specificId',
    component: EditMealComponent
  }

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ApplicationRoutingModule {



}
