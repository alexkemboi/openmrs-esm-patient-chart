import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockPatient } from '../../../../__mocks__/patient.mock';
import { openmrsFetch, usePagination } from '@openmrs/esm-framework';
import { launchPatientWorkspace } from '@openmrs/esm-patient-common-lib';
import { mockConditions, mockFhirConditionsResponse } from '../../../../__mocks__/conditions.mock';
import { patientChartBasePath, swrRender, waitForLoadingToFinish } from '../../../../tools/test-helpers';
import ConditionsOverview from './conditions-overview.component';

const testProps = {
  basePath: patientChartBasePath,
  patient: mockPatient,
};

const mockOpenmrsFetch = openmrsFetch as jest.Mock;
const mockUsePagination = usePagination as jest.Mock;

jest.mock('@openmrs/esm-framework', () => {
  const originalModule = jest.requireActual('@openmrs/esm-framework');

  return {
    ...originalModule,
    usePagination: jest.fn().mockImplementation(() => ({
      currentPage: 1,
      goTo: () => {},
      results: [],
    })),
  };
});

jest.mock('@openmrs/esm-patient-common-lib', () => {
  const originalModule = jest.requireActual('@openmrs/esm-patient-common-lib');

  return {
    ...originalModule,
    launchPatientWorkspace: jest.fn(),
  };
});

describe('ConditionsOverview: ', () => {
  it('renders an empty state view if conditions data is unavailable', async () => {
    mockOpenmrsFetch.mockReturnValueOnce({ data: [] });

    renderConditionsOverview();

    await waitForLoadingToFinish();

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /conditions/i })).toBeInTheDocument();
    expect(screen.getByTitle(/Empty data illustration/i)).toBeInTheDocument();
    expect(screen.getByText(/There are no conditions to display for this patient/i)).toBeInTheDocument();
    expect(screen.getByText(/Record conditions/i)).toBeInTheDocument();
  });

  it('renders an error state view if there is a problem fetching conditions data', async () => {
    const error = {
      message: 'You are not logged in',
      response: {
        status: 401,
        statusText: 'Unauthorized',
      },
    };

    mockOpenmrsFetch.mockRejectedValueOnce(error);

    renderConditionsOverview();

    await waitForLoadingToFinish();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /conditions/i })).toBeInTheDocument();
    expect(screen.getByText(/Error 401: Unauthorized/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Sorry, there was a problem displaying this information. You can try to reload this page, or contact the site administrator and quote the error code above/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders an overview of the patient's conditions when present", async () => {
    mockOpenmrsFetch.mockReturnValueOnce({ data: mockFhirConditionsResponse });
    mockUsePagination.mockImplementation(() => ({
      currentPage: 1,
      goTo: () => {},
      results: mockConditions,
    }));

    renderConditionsOverview();

    await waitForLoadingToFinish();

    expect(screen.getByRole('heading', { name: /conditions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();

    const expectedColumnHeaders = [/active conditions/, /since/];
    expectedColumnHeaders.forEach((header) => {
      expect(screen.getByRole('columnheader', { name: new RegExp(header, 'i') })).toBeInTheDocument();
    });

    const expectedTableRows = [/hiv positive/, /malaria, confirmed/, /malaria sevère/, /anaemia/, /hypertension/];
    expectedTableRows.forEach((row) => {
      expect(screen.getByRole('row', { name: new RegExp(row, 'i') })).toBeInTheDocument();
    });

    expect(screen.getAllByRole('row').length).toEqual(6);
    expect(screen.getByText(/1–5 of 8 items/i)).toBeInTheDocument();

    const nextPageButton = screen.getByRole('button', { name: /next page/i });
    userEvent.click(nextPageButton);

    expect(screen.getAllByRole('row').length).toEqual(6);
  });

  it('clicking the Add button or Record Conditions link launches the conditions form', async () => {
    mockOpenmrsFetch.mockReturnValueOnce({ data: [] });

    renderConditionsOverview();

    await waitForLoadingToFinish();

    const recordConditionsLink = screen.getByText(/record conditions/i);
    userEvent.click(recordConditionsLink);

    expect(launchPatientWorkspace).toHaveBeenCalledTimes(1);
    expect(launchPatientWorkspace).toHaveBeenCalledWith('conditions-form-workspace');
  });
});

function renderConditionsOverview() {
  swrRender(<ConditionsOverview {...testProps} />);
}
