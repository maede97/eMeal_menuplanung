import { Component, OnInit, Input, Inject } from '@angular/core';
import { AngularFirestore } from '@angular/fire/firestore';
import { Observable, Observer } from 'rxjs';
import { AuthenticationService } from '../_service/authentication.service';
import { Camp } from '../_class/camp';
import { map } from 'rxjs/operators'
import { MatTableDataSource } from '@angular/material/table';
import { FormBuilder, FormGroup } from '@angular/forms';
import { User } from '../_interfaces/user';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';


@Component({
  selector: 'app-camp-list-page',
  templateUrl: './camp-list-page.component.html',
  styleUrls: ['./camp-list-page.component.sass']
})
export class CampListPageComponent implements OnInit {

  // Datasource and colums for the table
  protected displayedColumns: string[] = ['name', 'description', 'year', 'participants', 'menu'];
  private dataSource: MatTableDataSource<Camp>;

  // Camp Data
  private camps: Observable<Camp[]>;
  private user: firebase.User;

  // Form data to create new Camp
  private newCampInfos: FormGroup;
  private newCampParticipants: FormGroup;
  private newCampDate: FormGroup;
  private selectedCoworkers: User[];

  /**
   * 
   * @param auth 
   * @param database 
   */
  constructor(public dialog: MatDialog, private auth: AuthenticationService, private database: AngularFirestore, private formBuilder: FormBuilder) {

    this.dataSource = new MatTableDataSource();

    // Create new camp; data form form
    // Here you can defind defaults values for the form fields
    this.newCampInfos = this.formBuilder.group({
      name: 'Sommerlager',
      description: 'Cevi Züri 11',
    });
    this.newCampParticipants = this.formBuilder.group({
      participants: '21'
    });
    this.newCampDate = this.formBuilder.group({
      date: '23.03.2020'
    });



  }

  /**
   * 
   */
  ngOnInit() {

    this.auth.fireAuth.authState.subscribe(user => {
      if (user) {
        this.user = user
        this.campListPage()

          // Update MatTableDataSource
          .subscribe((camps: Camp[]) => {
            this.dataSource = new MatTableDataSource(camps)
          });

      }
    });

  }

  /**
   * 
   * Filter nach Name des Lagers
   * 
   * @param filterValue 
   */
  applyFilter(filterValue: string) {
    this.dataSource.filterPredicate = (camp: Camp, filter: string) =>
      // Condition for the filter
      camp.name.trim().toLowerCase().includes(filter);

    // apply filter to the table
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  /**
   * 
   */
  campListPage(): Observable<Camp[]> {

    // load Camps as Observable<Camp[]>
    this.camps = Observable.create((observer: Observer<Camp[]>) => {

      this.database.collection('camps',
        collRef => collRef.where('access.owner', "array-contains", this.user.uid)).snapshotChanges()

        // Create new Meals out of the data
        .pipe(map(docActions =>
          docActions.map(docAction =>
            new Camp(docAction.payload.doc.data(), docAction.payload.doc.id, this.database)
          ))
        )
        .subscribe(camps => observer.next(camps));

    });

    return this.camps;

  }

  /**
   * Creats a new Camp
   */
  createCamp() {

    // Creates a new Camp
    let data: any = this.newCampInfos.value;
    Object.assign(data, data, this.newCampParticipants.value);
    Object.assign(data, data, this.newCampDate.value);
    Camp.createNewCamp(data, this.selectedCoworkers, this.database, this.auth);
  }

  /** A user get selected */
  selectUser(selectedCoworkers) {

    this.selectedCoworkers = selectedCoworkers;

  }

  /**
   * Deletes a selected camp
   */
  deleteCamp(camp: Camp) {

    this.dialog.open(DeleteCampComponent, {
      height: '200px',
      width: '300px',
      data: { name: camp.name }
    }).afterClosed().subscribe(deleteConfirmed => {

      if (deleteConfirmed)
        camp.deleteOnFirestoreDB();

    });

  }

}


@Component({
  templateUrl: './delete-camp.component.html',
  styleUrls: ['./delete-camp.component.sass']
})
export class DeleteCampComponent implements OnInit {

  constructor(@Inject(MAT_DIALOG_DATA) public data) { }

  ngOnInit() {

  }

}
