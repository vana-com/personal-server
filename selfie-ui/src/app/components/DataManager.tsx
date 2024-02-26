"use client";

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { DocumentConnection, Documents, DocumentStats } from "@/app/types";
import { apiBaseUrl } from "@/app/config";
import TaskToast from "@/app/components/TaskToast";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import { DocumentTable } from "@/app/components/DocumentTable";


const DataManager = () => {
  const [documentConnections, setDocumentConnections] = useState<DocumentConnection[]>([]);
  const [documents, setDocuments] = useState<Documents>({});
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());

  const { isTaskRunning, taskMessage, executeTask } = useAsyncTask();

  const [stats, setStats] = useState<DocumentStats>({
    totalDocuments: 0,
    numDocumentsIndexed: 0,
    numEmbeddingIndexDocuments: 0
  });

  const fetchDocumentConnections = useCallback(async () => {
    executeTask(async () => {
      const response = await fetch(`${apiBaseUrl}/v1/data-sources`);
      const data = await response.json();
      setDocumentConnections(data);
      await Promise.all(data.map((connection: any) => fetchDocuments(connection.id)));
    }, {
      start: 'Loading data sources',
      success: 'Data sources loaded',
      error: 'Failed to load data sources',
    })
  }, [executeTask]);

  useEffect(() => {
    fetchDocumentConnections();
  }, [fetchDocumentConnections]);

  const fetchDocuments = async (sourceId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/documents?source_id=${sourceId}`);
      const docs = await response.json();
      setDocuments(prevDocs => ({ ...prevDocs, [sourceId]: docs }));
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  useEffect(() => {
    if (selectedDocuments.size === 0) {
      setStats({
        totalDocuments: Object.values(documents).flat().length,
        numDocumentsIndexed: Object.values(documents).flat().filter((doc) => doc.is_indexed).length,
        numEmbeddingIndexDocuments: Object.values(documents).flat().filter((doc) => doc.is_indexed).reduce((acc, doc) => acc + (doc?.num_index_documents ?? 0), 0)
      });
    } else {
      setStats({
        totalDocuments: selectedDocuments.size,
        numDocumentsIndexed: Array.from(selectedDocuments).map((docId) => Object.values(documents).flat().find((doc) => doc.id === docId)).filter((doc) => doc?.is_indexed).length,
        numEmbeddingIndexDocuments: Array.from(selectedDocuments).map((docId) => Object.values(documents).flat().find((doc) => doc.id === docId)).filter((doc) => doc?.is_indexed).reduce((acc, doc) => acc + (doc?.num_index_documents ?? 0), 0)
      });
    }
    console.log(documents)
  }, [documents, documentConnections, selectedDocuments]);

  const toggleDocumentSelection = (docId: string) => {
    setSelectedDocuments(prevSelectedDocuments => {
      const newSelection = new Set(prevSelectedDocuments);
      if (newSelection.has(docId)) {
        newSelection.delete(docId);
      } else {
        newSelection.add(docId);
      }
      return newSelection;
    });
  };

  const columnNames = useMemo(() => {
    const firstDoc = documents[documentConnections[0]?.id]?.[0];
    return firstDoc ? Object.keys(firstDoc) : [];
  }, [documents, documentConnections]);


  return (
    <>
      {/* TODO: this is necessary until useAsyncTask is refactored to use global state */}
      {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}

      <p className="mb-4">
        Index documents to add them to the knowledge bank. Once indexed, data will be used automatically by the AI.
      </p>

      <div className="overflow-x-auto">
        <DocumentTable
          dataSources={documentConnections}
          documents={documents}
          columnNames={columnNames}
          selectedDocuments={selectedDocuments}
          disabled={isTaskRunning}
          setSelectedDocuments={setSelectedDocuments}
          onToggleDocumentSelection={toggleDocumentSelection}
          // onIndexDocument={(doc) => handleIndexSelected([doc.id])}
          // onUnindexDocument={(doc) => handleIndexDocument(doc.id, true)}
          // onIndexDocuments={() => handleIndexSelected()}
          // onUnindexDocuments={() => handleIndexSelected(undefined, true)}
          stats={stats}
        />
      </div>
    </>
  );
};

DataManager.displayName = 'DataManager';

export default DataManager;
