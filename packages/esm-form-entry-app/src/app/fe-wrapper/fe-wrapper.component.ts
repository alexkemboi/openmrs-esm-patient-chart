import * as moment from 'moment';
import { Component, OnInit } from '@angular/core';
import { FormGroup } from '@angular/forms';
import {
  QuestionFactory,
  FormFactory,
  ObsValueAdapter,
  OrderValueAdapter,
  EncounterAdapter,
  DataSources,
  FormErrorsService,
  Form,
} from '@ampath-kenya/ngx-formentry';
import { Observable, forkJoin, ReplaySubject, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { OpenmrsEsmApiService } from '../openmrs-api/openmrs-esm-api.service';
import { FormSchemaService } from '../form-schema/form-schema.service';
import { FormDataSourceService } from '../form-data-source/form-data-source.service';
import { FormSubmissionService } from '../form-submission/form-submission.service';
import { EncounterResourceService } from '../openmrs-api/encounter-resource.service';
import { singleSpaPropsSubject, SingleSpaProps } from '../../single-spa-props';

@Component({
  selector: 'my-app-fe-wrapper',
  templateUrl: './fe-wrapper.component.html',
  styleUrls: ['./fe-wrapper.component.css'],
})
export class FeWrapperComponent implements OnInit {
  data: any;
  sections: {} = {};
  formGroup: FormGroup;
  activeTab = 0;
  form: Form;
  formName: string;
  formUuid: string;
  encounterUuid: string;
  visitUuid: string;
  encounter: any;
  formSchema: any;
  patient: any;
  loadingError: string;
  formSubmitted = false;
  singleSpaProps: SingleSpaProps;
  loggedInUser: LoggedInUser;
  triedSubmitting = false;
  errorPanelOpen = false;

  public get encounterDate(): string {
    return moment(this.encounter.encounterDatetime).format('YYYY-MM-DD');
  }

  public get encounterTime(): string {
    return moment(this.encounter.encounterDatetime).format('HH:mm');
  }

  public get hasValidationErrors(): boolean {
    return this.triedSubmitting && this.form && !this.form.valid;
  }

  constructor(
    private openmrsApi: OpenmrsEsmApiService,
    private formSchemaService: FormSchemaService,
    private encounterResourceService: EncounterResourceService,
    private questionFactory: QuestionFactory,
    private formFactory: FormFactory,
    private obsValueAdapater: ObsValueAdapter,
    private orderAdaptor: OrderValueAdapter,
    private encAdapter: EncounterAdapter,
    private dataSources: DataSources,
    private formDataSourceService: FormDataSourceService,
    private formSubmissionService: FormSubmissionService,
    private formErrorsService: FormErrorsService,
  ) {}

  ngOnInit() {
    this.launchForm().subscribe(
      (form) => {
        // console.log('Form loaded and rendered', form);
      },
      (err) => {
        // TODO: Handle errors
        console.error('Error rendering form', err);
        this.loadingError = 'Error loading form';
      },
    );
  }

  public onSubmit(event: any) {
    if (this.isFormValid()) {
      this.saveForm().subscribe(
        (response) => {
          this.encounterUuid = response[0] && response[0].uuid;
          this.formSubmitted = true;
        },
        (error) => {
          console.error('Error submitting form', error);
        },
      );
    } else {
      this.triedSubmitting = true;
      this.form.showErrors = true;
      setTimeout(() => {
        this.errorPanelOpen = true;
      }, 10);
    }
  }

  public onCancel() {
    this.singleSpaProps.closeWorkspace();
  }

  public onEditSaved() {
    this.singleSpaProps.encounterUuid = this.encounterUuid;
    singleSpaPropsSubject.next(this.singleSpaProps);
    this.resetVariables();
    this.ngOnInit();
  }

  public onExpandCollapseErrorPanel($event) {
    this.errorPanelOpen = !this.errorPanelOpen;
  }

  public onErrorPanelLostFocus() {
    this.errorPanelOpen = false;
  }

  public resetVariables() {
    this.data = undefined;
    this.sections = {};
    this.formGroup = undefined;
    this.activeTab = 0;
    this.form = undefined;
    this.formName = undefined;
    this.formUuid = undefined;
    this.encounterUuid = undefined;
    this.encounter = undefined;
    this.formSchema = undefined;
    this.patient = undefined;
    this.loadingError = undefined;
    this.formSubmitted = false;
    this.singleSpaProps = undefined;
  }

  public getProps(): Observable<SingleSpaProps> {
    const subject = new ReplaySubject<SingleSpaProps>(1);
    singleSpaPropsSubject.pipe(take(1)).subscribe(
      (props) => {
        this.singleSpaProps = props;
        const formUuid = props.formUuid;
        if (!(formUuid && typeof formUuid === 'string')) {
          subject.error('Form UUID is required. props.formUuid missing');
          return;
        }
        subject.next(props);
      },
      (err) => {
        subject.error(err);
      },
    );
    return subject.asObservable();
  }

  public launchForm(): Observable<Form> {
    const subject = new ReplaySubject<Form>(1);
    const loadForm = () => {
      this.loadAllFormDependencies()
        .pipe(take(1))
        .subscribe(
          (data) => {
            this.createForm();
            subject.next(this.form);
          },
          (err) => {
            subject.error(err);
          },
        );
    };

    this.getProps()
      .pipe(take(1))
      .subscribe(
        (props) => {
          this.formUuid = props.formUuid;
          this.patient = props.patient;
          if (props.encounterUuid) {
            this.encounterUuid = props.encounterUuid;
          }
          if (props.visitUuid && !this.encounterUuid) {
            this.visitUuid = props.visitUuid;
          }
          loadForm();
        },
        (err) => {
          subject.error(err);
        },
      );

    return subject.asObservable();
  }

  private loadAllFormDependencies(): Observable<any> {
    const trackingSubject = new ReplaySubject<any>(1);
    const observableBatch: Array<Observable<any>> = [];
    observableBatch.push(this.fetchCompiledFormSchema(this.formUuid).pipe(take(1)));
    observableBatch.push(this.openmrsApi.getCurrentUserLocation().pipe(take(1)));
    if (this.encounterUuid) {
      observableBatch.push(this.getEncounterToEdit(this.encounterUuid).pipe(take(1)));
    }
    forkJoin(observableBatch).subscribe(
      (data: any) => {
        this.formSchema = data[0] || null;
        this.loggedInUser = data[1] || null;
        this.encounter = data[2] || null;
        const formData = {
          formSchema: data[0],
          patient: this.patient,
          user: data[1],
          encounter: data.length === 4 ? data[2] : null,
        };
        trackingSubject.next(formData);
      },
      (err) => {
        trackingSubject.error(new Error('There was an error fetching form data. Details: ' + err));
      },
    );

    return trackingSubject.asObservable();
  }

  private fetchCompiledFormSchema(uuid: string): Observable<any> {
    const subject = new ReplaySubject<any>(1);
    this.formSchemaService
      .getFormSchemaByUuid(uuid, true)
      .pipe(take(1))
      .subscribe(
        (formSchema) => {
          subject.next(formSchema);
        },
        (error) => {
          subject.error(new Error('Error fetching form schema. Details: ' + error));
        },
      );
    return subject.asObservable();
  }

  private getEncounterToEdit(encounterUuid: string): Observable<any> {
    const subject = new ReplaySubject<any>(1);
    const sub: Subscription = this.encounterResourceService.getEncounterByUuid(encounterUuid).subscribe(
      (encounter) => {
        subject.next(encounter);
        sub.unsubscribe();
      },
      (error) => {
        subject.error(error);
        sub.unsubscribe();
      },
    );
    return subject.asObservable();
  }

  private createForm() {
    this.wireDataSources();
    this.formName = this.formSchema.name;
    this.form = this.formFactory.createForm(this.formSchema, this.dataSources.dataSources);
    if (this.encounter) {
      this.populateEncounterForEditing();
    } else {
      this.setDefaultValues();
    }
    this.setUpPayloadProcessingInformation();
  }

  private wireDataSources() {
    this.dataSources.registerDataSource('location', this.formDataSourceService.getDataSources().location);
    this.dataSources.registerDataSource('provider', this.formDataSourceService.getDataSources().provider);
    this.dataSources.registerDataSource('drug', this.formDataSourceService.getDataSources().drug);
    this.dataSources.registerDataSource('problem', this.formDataSourceService.getDataSources().problem);
    this.dataSources.registerDataSource('personAttribute', this.formDataSourceService.getDataSources().location);
    this.dataSources.registerDataSource('conceptAnswers', this.formDataSourceService.getDataSources().conceptAnswers);
  }

  private setDefaultValues() {
    // encounter date and time
    const currentDate = moment().format();
    const encounterDate = this.form.searchNodeByQuestionId('encDate');
    if (encounterDate.length > 0) {
      encounterDate[0].control.setValue(currentDate);
    }

    // location
    const encounterLocation = this.form.searchNodeByQuestionId('location', 'encounterLocation');
    if (encounterLocation.length > 0 && this.loggedInUser && this.loggedInUser.sessionLocation) {
      // const location = { value: this.loggedInUser.sessionLocation.uuid, label: this.loggedInUser.sessionLocation.display };
      encounterLocation[0].control.setValue(this.loggedInUser.sessionLocation.uuid);
    }

    // provider
    const encounterProvider = this.form.searchNodeByQuestionId('provider', 'encounterProvider');
    if (encounterProvider.length > 0 && this.loggedInUser && this.loggedInUser.currentProvider) {
      encounterProvider[0].control.setValue(this.loggedInUser.currentProvider.uuid);
    }
  }

  private setUpPayloadProcessingInformation() {
    this.form.valueProcessingInfo.personUuid = this.patient.id;
    this.form.valueProcessingInfo.patientUuid = this.patient.id;
    this.form.valueProcessingInfo.formUuid = this.formSchema.uuid;
    if (this.formSchema.encounterType) {
      this.form.valueProcessingInfo.encounterTypeUuid = this.formSchema.encounterType.uuid;
    } else {
      throw new Error('Please associate the form with an encounter type.');
    }
    if (this.encounterUuid) {
      this.form.valueProcessingInfo.encounterUuid = this.encounterUuid;
    }
    if (this.visitUuid) {
      this.form.valueProcessingInfo.visitUuid = this.visitUuid;
    }
  }

  private populateEncounterForEditing() {
    if (this.encounter) {
      this.encAdapter.populateForm(this.form, this.encounter);
    }
  }

  // check validity of form
  private isFormValid(): boolean {
    if (!this.form.valid) {
      this.form.markInvalidControls(this.form.rootNode);
    }
    return this.form.valid;
  }

  private saveForm(): Observable<any> {
    return this.formSubmissionService.submitPayload(this.form);
  }
}

export interface LoggedInUser {
  user: any;
  currentProvider: {
    uuid: string;
    display: string;
    identifier: string;
  };
  sessionLocation: {
    uuid: string;
    name: string;
    display: string;
  };
}
