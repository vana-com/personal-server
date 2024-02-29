"use client";

import React, {useCallback, useEffect, useState} from 'react';
import {Documents} from "@/app/types";
import {apiBaseUrl} from "@/app/config";
import TaskToast from "@/app/components/TaskToast";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import {DocumentTable} from "@/app/components/DocumentTable";


const ManageData = () => {
  const [documents, setDocuments] = useState<Documents>({});

  const { isTaskRunning, taskMessage, executeTask } = useAsyncTask();

  const fetchDocuments = useCallback(async () => {
    executeTask(async () => {
      const response = await fetch(`${apiBaseUrl}/v1/documents`);
      setDocuments(await response.json());
    }, {
      start: 'Loading documents',
      success: 'Documents loaded',
      error: 'Failed to load documents',
    });
  }, [executeTask, apiBaseUrl]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const deleteDocuments = (docIds: string[]) => {
    const plural = docIds.length > 1 ? 's' : '';
    executeTask(async () => {
      await fetch(`${apiBaseUrl}/v1/documents`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_ids: docIds }),
      });
      await fetchDocuments();
    }, {
      start: `Deleting document${plural}`,
      success: `Document${plural} deleted`,
      error: `Failed to delete document${plural}`,
    });
  }

  return (
    <>
      {/* TODO: this is necessary until useAsyncTask is refactored to use global state */}
      {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}

      <p className="mb-4">
        {/*Index documents to add them to the knowledge bank. Once indexed, data will be used automatically by the AI.*/}
        Documents that have been added to the knowledge bank are shown here. You can add more on the <a className="link" href="#addData">Add Data page</a>.
      </p>

      <div className={[
        "overflow-x-auto",
        documents.length === 0 ? 'hidden' : '',
      ].join(' ')}>

        <DocumentTable
          data={Object.values(documents).flat()}
          onDeleteDocuments={deleteDocuments}
        />
      </div>
    </>
  );
};

ManageData.displayName = 'Manage Data';

export default ManageData;
