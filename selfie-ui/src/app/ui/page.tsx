"use client";

import { useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

import DocumentSourceSelector from '../components/DocumentSourceSelector'; // Assume this is the component from Step 1

const DataManagementInterface = () => {
  const [selectedSource, setSelectedSource] = useState('');
  const [formSchema, setFormSchema] = useState(null);
  const [uiSchema, setUiSchema] = useState(null);

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
      .catch((error) => console.error('Error fetching schema:', error));
  };

  return (
    <div>
      <h1>Add your data</h1>
      <div>Step 1: Choose your document source</div>
      <br />
      <DocumentSourceSelector onSelect={handleSourceSelect} />
      {formSchema && (
        <Form
          schema={formSchema}
          uiSchema={uiSchema || {}}
          onSubmit={({formData}) => console.log('Data submitted:', formData)}
          validator={validator}
        />
      )}
    </div>
  );
};

export default DataManagementInterface;


