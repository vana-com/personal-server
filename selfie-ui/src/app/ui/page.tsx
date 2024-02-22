"use client";

import { useState } from 'react';
import TailwindForm from "../components/rjsf"
import validator from '@rjsf/validator-ajv8';
import { IChangeEvent } from '@rjsf/core';

import DocumentSourceSelector from '../components/DocumentSourceSelector';

interface FormData {
  [key: string]: any; // Use a more specific type if possible
}

const DataManagementInterface = () => {
  const [selectedSource, setSelectedSource] = useState('');
  const [formSchema, setFormSchema] = useState(null);
  const [uiSchema, setUiSchema] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');

  // Handle source selection
  const handleSourceSelect = (sourceId: string) => {
    setSelectedSource(sourceId);

    // Fetch the schema for the selected source
    fetch(`http://localhost:8181/v1/connectors/${sourceId}`)
      .then((response) => response.json())
      .then((data) => {
        setFormSchema(data.form_schema);
        setUiSchema(data.ui_schema);
      })
      .catch((error) => {
        console.error('Error fetching schema:', error);
        setResponseMessage('Failed to fetch schema. Please try again.');
      });
  };

  const handleSubmit = (e: IChangeEvent<FormData>) => {
    const { formData } = e;
    fetch('http://localhost:8181/v1/document-connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connector_id: selectedSource,
        configuration: formData,
      }),
    })
      .then(response => {
        if (response.status === 201) {
          setResponseMessage('Data submitted successfully.');
          return;
        }
        throw new Error('Failed to submit data');
      })
      .catch(error => {
        console.error('Submission error:', error);
        setResponseMessage('Failed to submit data. Please try again.');
      });
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Add your data</h1>
      <div className="mb-2 font-medium">Step 1: Choose your data source</div>
      <DocumentSourceSelector onSelect={handleSourceSelect} />
      {formSchema && (
        <TailwindForm
          schema={formSchema}
          uiSchema={uiSchema || {}}
          onSubmit={handleSubmit}
          validator={validator}
          className="mt-4"
        />
      )}
      {responseMessage && <div className="mt-4 text-red-500">{responseMessage}</div>}
    </div>
  );
};

export default DataManagementInterface;
