"use client";

import { useState } from 'react';

import TailwindForm from "../../components/rjsf"
import validator from '@rjsf/validator-ajv8';
import { IChangeEvent } from '@rjsf/core';

import DocumentSourceSelector from './DocumentSourceSelector';
import {apiBaseUrl} from "../../config";
import {Markdown} from "../../components/Markdown";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import TaskToast from "@/app/components/TaskToast";

interface FormData {
  [key: string]: any; // Use a more specific type if possible
}

const AddData = () => {
  const [selectedSource, setSelectedSource] = useState('');
  const [formSchema, setFormSchema] = useState(null);
  const [documentation, setDocumentation] = useState('');
  const [uiSchema, setUiSchema] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');

  const { isTaskRunning, taskMessage, executeTask } = useAsyncTask();

  // Handle source selection
  const handleSourceSelect = (sourceId: string) => {
    setSelectedSource(sourceId);

    // Fetch the schema for the selected source
    fetch(`${apiBaseUrl}/v1/connectors/${sourceId}`)
      .then((response) => response.json())
      .then((data) => {
        setDocumentation(data.documentation);
        setFormSchema(data.form_schema);
        setUiSchema(data.ui_schema);
      })
      .catch((error) => {
        console.error('Error fetching schema:', error);
        setResponseMessage('Failed to fetch schema. Please try again.');
      });
  };

  const handleSubmit = async (e: IChangeEvent<FormData>) => {
    const { formData } = e;
    try {
      const response = await fetch(`${apiBaseUrl}/v1/document-connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connector_id: selectedSource,
          configuration: formData,
        }),
      })

      if (response.status === 201) {
        setResponseMessage('Data submitted successfully.');
        return;
      }
      throw new Error('Failed to submit data');
    } catch (error) {
      console.error('Submission error:', error);
      setResponseMessage('Failed to submit data. Please try again.');
    }
  };

  const wrappedHandleSubmit = (e: IChangeEvent<FormData>) => {
    executeTask(() => handleSubmit(e), {
      start: 'Submitting data...',
      success: 'Data submitted successfully.',
      error: 'Failed to submit data. Please try again.',
    });
  }

  return (
    <>
      {/* TODO: this is necessary until useAsyncTask is refactored to use global state */}
      {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}
      <DocumentSourceSelector onSelect={handleSourceSelect} />
      {documentation && (
        <div className="mt-4">
          <Markdown content={documentation} />
        </div>
      )}
      {formSchema && (
        <TailwindForm
          schema={formSchema}
          uiSchema={uiSchema || {}}
          onSubmit={wrappedHandleSubmit}
          validator={validator}
          className="mt-4"
        />
      )}
      {responseMessage && <div className="mt-4 text-red-500">{responseMessage}</div>}
    </>
  );
};

AddData.displayName = 'AddData';

export default AddData;
