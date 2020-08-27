import {Injectable} from '@angular/core';
import {Action, AngularFirestore, DocumentChangeAction, DocumentSnapshot, QueryFn} from '@angular/fire/firestore';
import {AngularFireFunctions} from '@angular/fire/functions';
import {AngularFireStorage} from '@angular/fire/storage';
import {firestore} from 'firebase/app';
import {combineLatest, EMPTY, forkJoin, Observable, of, OperatorFunction} from 'rxjs';
import {catchError, delay, map, mergeMap, retryWhen, take} from 'rxjs/operators';
import {Camp} from '../_class/camp';
import {FirestoreObject} from '../_class/firebaseObject';
import {Meal} from '../_class/meal';
import {Recipe} from '../_class/recipe';
import {SpecificMeal} from '../_class/specific-meal';
import {SpecificRecipe} from '../_class/specific-recipe';
import {User} from '../_class/user';
import {
  AccessData,
  FirestoreCamp,
  FirestoreDocument,
  FirestoreMeal,
  FirestoreRecipe,
  FirestoreSpecificMeal,
  FirestoreSpecificRecipe,
  FirestoreUser,
  Ingredient
} from '../_interfaces/firestoreDatatypes';
import {AuthenticationService} from './authentication.service';


/**
 * An angular service to provide data form the AngularFirestore database.
 * This service includes methods to fetch all kind of firebaseObjects form
 * the database.
 *
 */
@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

  // TODO: allgemein besseres Error-Handling
  // als erste Idee kann jeder Fehler einfach als Banner
  // angezeigt werden, dies lässt sich direkt aus dieser Klasse heraus
  // realisieren....

  /**
   * An angular service to provide data form the AngularFirestore database.
   * This service includes methods to fetch all kind of firebaseObjects form
   * the database.
   *
   */
  constructor(
    private db: AngularFirestore,
    private authService: AuthenticationService,
    private functions: AngularFireFunctions,
    private cloud: AngularFireStorage) {
  }

  /**
   *
   * Updates the access of a document (if possible)
   *
   */
  public updateAccessData(access: AccessData, path: string, upgradeOnly = false) {

    return this.functions.httpsCallable('changeAccessData')(
      {documentPath: path, requestedAccessData: access, upgradeOnly}
    );

  }

  /**
   *
   * Refreshes (i.g. updates) the rights of the new added meal.
   * Such that all users with access to the camp can edit the new meal.
   *
   * @param campId id of the camp
   * @param mealPath id of the added meal
   *
   */
  public refreshAccessData(campId: string, mealPath: string) {

    return this.functions.httpsCallable('refreshAccessData')(
      {campId, type: 'meal', path: mealPath}
    );

  }


  /**
   * Gets the last 5 Elements
   *
   * TODO: add Python-Skript, das alte Exports automatisch löscht,
   * eine Cloud-Funktion gibt es hierfür teilweise sogar...
   *
   *
   */
  public getExports(campId: string): Observable<ExportData[]> {

    return this.db.collection('camps/' + campId + '/exports',
      query => query.orderBy('exportDate', 'desc').limit(6))
      .snapshotChanges()
      .pipe(this.getPathsToCloudDocuments())

      // Retry on error (max 10 times with a delay of 500ms after each try)
      .pipe(
        retryWhen(err => err.pipe(delay(500), take(10))),
        catchError(err => EMPTY)
      );

  }

  /**
   *
   * TODO: Hier gibt es ein Information-Leaking...
   * Zur Zeit können somit alle User ausgelesen werden inkl. ihre E-Mail-Adressen.
   * (Es gibt zwar die Möglichkeit, sein eigenes Konto zu verstecken, aber dann
   * kann man auch nicht mehr mit anderen Zusammenarbeiten).
   *
   * Idee neue Freigabe nur über E-Mailadresse möglich, eine Cloud-Funktion gibt dann
   * den entsprechenden Namen zurück und fügt den User hinzu...
   * Oder aber das ganze muss mindestens in den AGBs/Datenschutzbestimmungen stehen
   * diese müssen unbedingt mal angepasst werden.
   *
   */
  public getVisibleUsers() {

    return this.db.collection('users', collRef => collRef.where('visibility', '==', 'visible')).snapshotChanges().pipe(take(2))
      // Create new Users out of the data
      .pipe(map(docActions => docActions.map(docRef =>
        new User(docRef.payload.doc.data() as FirestoreUser, docRef.payload.doc.id)
      )));

  }


  /**
   *
   *
   * @param userIDs
   */
  public getUsers(access: AccessData): Observable<User[]> {

    const arrayOfUsers = Object.keys(access).map(userID => this.getUserById(userID));
    return combineLatest(arrayOfUsers);

  }

  /**
   *
   * In der User-Collection haben grundsätzlich alle Lese-Berechtigung:
   * ausser der Benutzer ist versteckt.
   *
   * @param userId
   */
  public getUserById(userId: string): Observable<User> {

    return this.requestDocument('users/' + userId)
      .pipe(FirestoreObject.createObject<FirestoreUser, User>(User));

  }

  /**
   * Löscht ein Rezept und seine SpecificRecipes
   *
   * TODO: muss als "Transaction" geschehen, damit ein fehlerhafter
   * Status in der Datenbank ausgeschlossen werden könne.
   *
   */
  public removeRecipe(mealId: string, recipeId: string) {

    this.db.doc('recipes/' + recipeId).update({
      used_in_meals: firestore.FieldValue.arrayRemove(mealId)
    });
    this.db.collection('recipes/' + recipeId + '/specificRecipes').get()
      .subscribe(docRefs => docRefs.forEach(docRef => docRef.ref.delete()));

  }

  /**
   * TODO: hier entsteht eine Sicherheitslücke.
   * Firestore lässt es zurzeit nicht zu, dass dem
   * Query noch ein accessQuery mitgeschickt wird.
   * Dadurch muss auf den accessCheck bei einem GroupQuery
   * verzichtet werden.
   *
   * Dieses Sicherheitsrisiko ist kurzfristig aber
   * vertretbar, da für den Query die Id eines bestehenden
   * Rezeptes bekannt sein muss.
   *
   * In Zukunft sollt man sich hier aber Gedanken machen,
   * wie die Situation verbessert werden kann.
   *
   * Achtung: benötigt einen Zusammengesetzten-Index
   *
   */
  public getSpecificMeals(campId: string, dayTimestamp: firestore.Timestamp): Observable<SpecificMeal[]> {

    const queryFn = this.createQuery(
      ['used_in_camp', '==', campId],
      ['meal_date', '==', dayTimestamp]
    );

    return this.db.collectionGroup('specificMeals', queryFn).snapshotChanges()
      .pipe(FirestoreObject.createObjects<FirestoreSpecificMeal, SpecificMeal>(SpecificMeal));

  }


  /**
   *
   * Sends the Feedback to the administrator.
   *
   * @param feedback
   *
   */
  public addFeedback(feedback: any) {

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://emeal.zh11.ch/services/sendMailToTrello.php', true);

    // Send the proper header information along with the request
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

    xhr.onreadystatechange = function () { // Call a function when the state changes.
      if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
        // Request finished. Do processing here.
      }
    };

    xhr.send('title=' + feedback.title + '&feedback=' + feedback.feedback);

  }


  /**
   *
   * TODO: Besser als Cloud Funktion, damit auch wirklich alles gelöscht wird
   * und nicht fehlerhafte Zustände in der Datenbank entstehen...
   *
   * @param mealId
   * @param specificMealId
   */
  public deleteSpecificMealAndRecipes(mealId: string, specificMealId: string) {

    this.db.doc('meals/' + mealId + '/specificMeals/' + specificMealId).delete();

    // https://stackoverflow.com/questions/56149601/firestore-collection-group-query-on-documentid
    // this is a bug in the firestore api...
    this.db.collectionGroup('specificRecipes',
      query => query.where('recipe_specificId', '==', specificMealId))
      .get().subscribe(docRefs => docRefs.forEach(docRef => docRef.ref.delete()));

  }

  /**
   *
   * Loads a meal form a external website.
   *
   * @param url of the external webpage with the meal data
   *
   */
  public importMeal(url: string): Observable<any> {

    return this.functions.httpsCallable('importMeal')({url});

  }


  /**
   *
   * @param mealId
   * @param idToAdd
   */
  public addIdToRecipes(mealId: any, idToAdd: any) {

    this.createAccessQueryFn(['editor', 'owner', 'collaborator', 'viewer'], ['used_in_meals', 'array-contains', mealId])
      .pipe(mergeMap(query =>
        this.db.collection('recipes', query).get()
      )).subscribe(docRefs => docRefs.docs.forEach(doc =>
      doc.ref.update({'used_in_meals': firestore.FieldValue.arrayUnion(idToAdd)})
    ));

  }

  /**
   *
   * @param recipe
   * @param specificId
   * @param mealId
   * @param camp
   */
  public addRecipe(recipe: Recipe, specificId: string, mealId: string, camp: Camp) {

    recipe.createSpecificRecipe(camp, recipe.documentId, specificId, this);

    return this.db.doc('recipes/' + recipe.documentId)
      .update({used_in_meals: firestore.FieldValue.arrayUnion(mealId)});

  }


  /**
   *
   * @return loads the specific meal
   */
  public getSpecificMeal(mealId: string, specificMealId: string): Observable<SpecificMeal> {

    return this.requestDocument('meals/' + mealId + '/specificMeals/' + specificMealId)
      .pipe(FirestoreObject.createObject<FirestoreSpecificMeal, SpecificMeal>(SpecificMeal));

  }

  /**
   * @return loads the specific recipe
   *
   */
  public getSpecificRecipe(specificMealId: string, recipe: Recipe, camp: Camp): Observable<SpecificRecipe> {

    return this.loadSpecificRecipe(recipe, specificMealId, camp)
      .pipe(FirestoreObject.createObject<FirestoreSpecificRecipe, SpecificRecipe>(SpecificRecipe));

  }

  /**
   *
   * @returns a Observable of the camps the currentUser has access
   *
   */
  public getCampsWithAccess(): Observable<Camp[]> {

    return this.createAccessQueryFn(['editor', 'owner', 'collaborator', 'viewer'])
      .pipe(mergeMap(queryFn =>
        this.requestCollection('camps/', queryFn)
          .pipe(FirestoreObject.createObjects<FirestoreCamp, Camp>(Camp))
      ));

  }

  /**
   *
   * @param mealId
   */
  public getCampsThatIncludes(mealId: string) {

    return this.getMealById(mealId).pipe(mergeMap(meal =>

      this.requestCollection('camps/',
        this.createQuery([firestore.FieldPath.documentId(), 'in', meal.usedInCamps]))
        .pipe(FirestoreObject.createObjects<FirestoreCamp, Camp>(Camp))
    ));

  }

  /**
   *
   */
  public getEditableMeals(): Observable<Meal[]> {
    return this.createAccessQueryFn(['editor', 'owner'])
      .pipe(mergeMap(queryFn =>
        this.requestCollection('meals/', queryFn)
          .pipe(FirestoreObject.createObjects<FirestoreMeal, Meal>(Meal))
      ));
  }

  /**
   *
   * @param recipeId
   */
  public getMealsThatIncludes(recipeId: string) {

    return this.getRecipeById(recipeId).pipe(mergeMap(recipe =>

      this.requestCollection('meals/',
        this.createQuery([firestore.FieldPath.documentId(), 'in', recipe.usedInMeals]))
        .pipe(FirestoreObject.createObjects<FirestoreMeal, Meal>(Meal))
    ));

  }

  /**
   *
   * @param id
   */
  public createPDF(id: string): Observable<any> {

    return this.functions.httpsCallable('createPDF')({campId: id});

  }

  /**
   * @returns observable list of all recipes form the current meal.
   *
   * @param mealId id of the current meal
   * @param campId id of the current camp
   */
  public getRecipes(mealId: string): Observable<Recipe[]> {

    return this.createAccessQueryFn(['editor', 'owner', 'collaborator', 'viewer'], ['used_in_meals', 'array-contains', mealId])
      .pipe(mergeMap(queryFn =>
        this.requestCollection('recipes', queryFn)
          .pipe(FirestoreObject.createObjects<FirestoreRecipe, Recipe>(Recipe))
      ));


  }

  /**
   * @returns observable list of all recipes form the current meal.
   *
   * @param mealId id of the current meal
   * @param campId id of the current camp
   */
  public getEditableRecipes(): Observable<Recipe[]> {

    return this.createAccessQueryFn(['editor', 'owner', 'collaborator'])
      .pipe(mergeMap(queryFn =>
        this.requestCollection('recipes', queryFn)
          .pipe(FirestoreObject.createObjects<FirestoreRecipe, Recipe>(Recipe))
      ));

  }

  /**
   *
   * @param recipeId
   */
  public getRecipeById(recipeId: string): Observable<Recipe> {

    return this.requestDocument('recipes/' + recipeId).pipe(
      FirestoreObject.createObject<FirestoreRecipe, Recipe>(Recipe)
    );

  }

  /**
   *
   * @param campId
   */
  public getCampById(campId: string): Observable<Camp> {

    return this.requestDocument('camps/' + campId).pipe(FirestoreObject.createObject<FirestoreCamp, Camp>(Camp));

  }

  /**
   *
   * @param mealId
   */
  public getMealById(mealId: string): Observable<Meal> {

    return this.requestDocument('meals/' + mealId).pipe(
      FirestoreObject.createObject<FirestoreMeal, Meal>(Meal)
    );

  }

  /**
   *
   * Updates an element in the database.
   *
   */
  public async updateDocument(firebaseObject: FirestoreObject) {

    if (!await this.canWrite(firebaseObject)) {
      console.log('No Access!');
      return null;
    }

    console.log('Update document: ' + firebaseObject.path);
    console.log(firebaseObject.toFirestoreDocument());

    return this.db.doc(firebaseObject.path).update(firebaseObject.toFirestoreDocument());

  }

  /**
   * Creates of an element. And clears all access data.
   *
   */
  public createCopy(firebaseObject: FirestoreObject, id?: string): Promise<firestore.DocumentReference> {

    return new Promise((resolve) =>
      this.authService.getCurrentUser().subscribe(async user => {

        // set current user as owner of the document
        firebaseObject.setAccessData({[user.uid]: 'owner'});

        // deletes specific data
        if (firebaseObject instanceof Recipe) {

          firebaseObject.usedInMeals = [];

          if (id !== undefined) {
            firebaseObject.usedInMeals.push(id);
          }

        }

        // deletes specific data
        if (firebaseObject instanceof Meal) {
          firebaseObject.usedInCamps = [];
        }


        console.log('Copied document: ');
        console.log(firebaseObject.toFirestoreDocument());

        const collPath = firebaseObject.path.substring(0, firebaseObject.path.indexOf('/'));
        resolve(await this.db.collection(collPath).add(firebaseObject.toFirestoreDocument()));

      }));
  }

  /**
   *
   * adds any Partial to the database
   * @param collectionPath the path can be a document path or a collection path
   *
   */
  public async addDocument(firebaseDocument: FirestoreDocument, collectionPath: string, documentId?: string):
    Promise<firebase.firestore.DocumentReference> {

    if (documentId === undefined) {
      return await this.db.collection(collectionPath).add(firebaseDocument);

    }

    this.db.doc(collectionPath + '/' + documentId).set(firebaseDocument);
    return this.db.doc(collectionPath + '/' + documentId).ref;

  }

  /**
   *
   * @param campId
   */
  public deleteExports(campId: string) {

    this.db.collection('camps/' + campId + '/exports').get()
      .pipe(take(1))
      .subscribe(refs =>
        refs.docs.forEach(docRef =>
          docRef.ref.delete()
        )
      );

  }

  /**
   *
   * Löscht alle Rezepte und Mahlzeiten eines Lagers
   *
   * TODO: besser als Cloud-Funktion damit fehlerhafte Zustände
   * in der Datenbank vermieden werden könne.
   *
   * @param campId
   *
   */
  public deleteAllMealsAndRecipes(campId: string) {

    this.db.collectionGroup('specificMeals', this.createQuery(['used_in_camp', '==', campId])).get()
      .subscribe(mealsRefs => mealsRefs.docs.forEach(docRef => docRef.ref.delete()));

    this.db.collectionGroup('specificRecipes', this.createQuery(['used_in_camp', '==', campId])).get()
      .subscribe(mealsRefs => mealsRefs.docs.forEach(docRef => docRef.ref.delete()));

  }

  /**
   *
   * @param obj
   */
  public deleteDocument(obj: FirestoreObject) {

    return this.db.doc(obj.path).delete();

  }

  /**
   *
   * @param path
   */
  public requestDocument(path: string): Observable<Action<DocumentSnapshot<unknown>>> {

    return this.db.doc(path).snapshotChanges();

  }

  /**
   *
   * @param path
   * @param queryFn
   */
  public requestCollection(path: string, queryFn?: QueryFn): Observable<DocumentChangeAction<unknown>[]> {

    return this.db.collection(path, queryFn).snapshotChanges();

  }

  /**
   *
   * @param mealId
   */
  public getNumberOfUses(mealId: string): Observable<number> {

    return this.db.collectionGroup('specificMeals', this.createQuery(['meal_id', '==', mealId])).get()
      .pipe(map(refs => refs.docs.length));

  }

  /**
   *
   * TODO: besser als Cloud-Funktion damit fehlerhafte Zustände
   * in der Datenbank vermieden werden könne.
   *
   * @param mealId
   */
  public deleteRecipesRefs(mealId: string) {
    this.createAccessQueryFn(['editor', 'owner', 'collaborator', 'viewer'], ['used_in_meals', 'array-contains', mealId]).pipe(mergeMap(query =>
      this.db.collection('recipes', query).get()))
      .pipe(take(1))
      .subscribe(docRefs => docRefs.docs.forEach(doc =>
        doc.ref.update({used_in_meals: firestore.FieldValue.arrayRemove(mealId)})
      ));

  }

  /**
   *
   * @param firebaseObject
   */
  public canWrite(firebaseObject: FirestoreObject): Promise<boolean> {

    return new Promise(resolve => this.authService.getCurrentUser().subscribe(user =>
      resolve(
        firebaseObject.getAccessData()[user.uid] !== null &&  // user isn't listed
        firebaseObject.getAccessData()[user.uid] !== 'viewer' // if user is listed, user isn't a viewer
      )
    ));

  }

  /**
   *
   * @param firebaseObject
   */
  public isOwner(firebaseObject: FirestoreObject): Promise<boolean> {

    return new Promise(resolve => this.authService.getCurrentUser().subscribe(user =>
      resolve(firebaseObject.getAccessData()[user.uid] === 'owner')
    ));

  }

  /**
   *
   * Loads the ingredients of an overwriting of a recipe
   *
   * @param recipeId id of the recipe
   * @param overwriteId documentId of the overwriting
   *
   */
  public loadRecipeOverwrites(recipeId: string, overwriteId: string) {

    return this.db.doc('recipes/' + recipeId + '/overwrites/' + overwriteId).get();

  }

  /**
   * Saves the overwriting of a recipe
   *
   * @param ingredients overwriting of to be saved
   * @param recipeId id of the recipe
   * @param writer documentId of the overwriting
   */
  async saveOverwrites(ingredients: Ingredient[], recipeId: string, writer: string) {

    await this.db.doc('recipes/' + recipeId + '/overwrites/' + writer)
      .update({
        ingredients
      });

  }


  // *********************************************************************************************
  // private methods
  //
  // TODO: Alle query functions in eine eigene Klasse auslagern
  //
  // *********************************************************************************************


  /**
   *
   * @param recipe
   * @param specificMealId
   * @param camp
   */
  private loadSpecificRecipe(recipe: Recipe, specificMealId: string, camp: Camp) {

    return this.requestDocument('recipes/' + recipe.documentId + '/specificRecipes/' + specificMealId)

      // nicht die schönste Lösung, um die spezifischen Rezepte
      // dynamisch zu erzeugen, falls diese nicht existieren.
      .pipe(mergeMap(ref => {

        if (ref.payload.exists) {
          return of(ref);
        }

        recipe.createSpecificRecipe(camp, recipe.documentId, specificMealId, this);
        return this.loadSpecificRecipe(recipe, specificMealId, camp);

      }));
  }

  /** creates a query function for access restriction (using the currentUser) */
  private createAccessQueryFn(accessRights: string[], ...queries: [string | firestore.FieldPath, firestore.WhereFilterOp, any][]): Observable<QueryFn> {

    return this.authService.getCurrentUser().pipe(map(user =>

      (collRef => {

        let query = collRef.where('access.' + user.uid, 'in', accessRights);
        query = this.createQueryFn(query, ...queries);
        return query;

      })
    ));

  }

  private createQuery(...queries: [string | firestore.FieldPath, firestore.WhereFilterOp, any][]): QueryFn {

    return (collRef => {

      return this.createQueryFn(collRef, ...queries);

    });

  }

  private createQueryFn(query: firestore.Query, ...queries: [string | firestore.FieldPath, firestore.WhereFilterOp, any][]) {

    queries.forEach(queryCond => {
      query = query.where(queryCond[0], queryCond[1], queryCond[2]);
    });

    return query;
  }

  private getPathsToCloudDocuments(): OperatorFunction<DocumentChangeAction<ExportDocData>[], ExportData[]> {

    return mergeMap(docChangeAction =>
      forkJoin(docChangeAction.map(docData => {

          const exportDocData = docData.payload.doc.data();

          const pathsObservables: Observable<string[]> = forkJoin(exportDocData.docs.map(docType =>
            this.cloud.ref(exportDocData.path + '.' + docType).getDownloadURL() as Observable<string>
          ));

          return pathsObservables.pipe(map(paths => ({exportDate: exportDocData.exportDate, paths})));

        }
      ))
    );
  }
}


interface ExportDocData {
  path: string;
  docs: string[];
  exportDate: any;
}

interface ExportData {
  paths: string[];
  exportDate: any;
}



