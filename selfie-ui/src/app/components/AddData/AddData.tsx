"use client";

import React, { useRef, useState } from 'react';

import TailwindForm from "../../components/rjsf"
import validator from '@rjsf/validator-ajv8';
import {IChangeEvent} from '@rjsf/core';

import DocumentSourceSelector from './DocumentSourceSelector';
import {apiBaseUrl} from "../../config";
import {Markdown} from "../../components/Markdown";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import TaskToast from "@/app/components/TaskToast";

const NativeFileInput = ({ options, onChange }) => {
    const inputRef = useRef(null);

    const handleFileChange = (event) => {
        const files = event.target.files;
        if (files.length > 0) {
            // Prepare files for multipart/form-data submission by storing File objects
            // For simplicity, we're directly passing the FileList, but you could also
            // transform this into an array or another structure if needed
            onChange(Array.from(files));
        }
    };

    return (
      <input
        type="file"
        ref={inputRef}
        onChange={handleFileChange}
        multiple
        accept={options.accept}
      />
    );
};

/**
 * This function recursively processes the configuration object and appends any files to the FormData object,
 * replacing the file object with a placeholder string. The placeholder can then be used to reference the file in the
 * configuration object.
 */
const replaceFilesWithReferences = (obj: any, path: string, formData: FormData) => {
    if (obj instanceof File) {
        const placeholder = `file-${path}`;
        formData.append(placeholder, obj, obj.name);
        return placeholder;
    } else if (Array.isArray(obj)) {
        return obj.map((item, index) => replaceFilesWithReferences(item, `${path}_${index}`, formData));
    } else if (typeof obj === 'object' && obj !== null) {
        Object.keys(obj).forEach(key => {
            obj[key] = replaceFilesWithReferences(obj[key], path ? `${path}_${key}` : key, formData);
        });
        return obj;
    } else {
        return obj;
    }
};

interface FormData {
    [key: string]: any; // Use a more specific type if possible
}


const AddData = () => {
    const [selectedSource, setSelectedSource] = useState('');
    const [formSchema, setFormSchema] = useState(null);
    const [documentation, setDocumentation] = useState('');
    const [uiSchema, setUiSchema] = useState(null);
    const [responseMessage, setResponseMessage] = useState({level: 'success', message: ''});

    const {isTaskRunning, taskMessage, executeTask} = useAsyncTask();

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
                setResponseMessage({level: 'error', message: 'Failed to fetch schema. Please try again.'});
            });
    };


    const handleSubmit = async (e: any) => {
        const formData = e.formData;

        // A deep copy would be better, but this should still work
        let configuration = { ...formData };
        const submitData = new FormData();

        configuration = replaceFilesWithReferences(configuration, '', submitData);

        // Append modified configuration as JSON
        submitData.append('configuration', JSON.stringify(configuration));
        submitData.append('connector_id', selectedSource);

        try {
            const response = await fetch(`${apiBaseUrl}/v1/document-connections`, {
                method: 'POST',
                body: submitData,
            });

            if (response.ok) {
                setResponseMessage({ level: 'success', message: 'Data submitted successfully.' });
            } else {
                throw new Error('Failed to submit data');
            }
        } catch (error) {
            console.error('Submission error:', error);
            setResponseMessage({ level: 'error', message: 'Failed to submit data. Please try again.' });
            throw error;
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
            {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage}/>}
            <DocumentSourceSelector onSelect={handleSourceSelect}/>
            {documentation && (
                <div className="mt-4">
                    <Markdown content={documentation}/>
                </div>
            )}
            {formSchema && (
                <TailwindForm
                    schema={formSchema}
                    uiSchema={uiSchema || {}}
                    onSubmit={wrappedHandleSubmit}
                    validator={validator}
                    className="mt-4"
                    widgets={{
                        nativeFile: NativeFileInput
                    }}
                />
            )}
            {responseMessage && <div
                className={`mt-4 ${responseMessage.level === "success" ? "text-green-500" : "text-red-500"}`}>{responseMessage.message}</div>}
        </>
    );
};

AddData.displayName = 'AddData';

export default AddData;
