"use client";

import { useState } from 'react';
import TailwindForm from "../components/rjsf"
import validator from '@rjsf/validator-ajv8';

import DocumentSourceSelector from '../components/DocumentSourceSelector';

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
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Add your data</h1>
      <div className="mb-2 font-medium">Step 1: Choose your document source</div>
      <DocumentSourceSelector onSelect={handleSourceSelect} />
      {formSchema && (
        <TailwindForm
          schema={formSchema}
          uiSchema={uiSchema || {}}
          onSubmit={({formData}) => console.log('Data submitted:', formData)}
          validator={validator}
          className="mt-4"
        />
      )}
    </div>
  );
};

export default DataManagementInterface;
