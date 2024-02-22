"use client";

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import CodeSnippet from "./components/CodeSnippet";
import { Chat } from "./components/Chat";
import { DocumentTable } from "./components/DocumentTable";
import { DataSourceTable } from "./components/DataSourceTable";
import { DataSource, Documents, DocumentStats } from "./types";
import { apiBaseUrl } from "./config";

const SelfieManager = () => {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [documents, setDocuments] = useState<Documents>({});
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [isChat, setIsChat] = useState(true);
  const [loading, setLoading] = useState(true);

  const [isTaskPending, setIsTaskPending] = useState(false);
  const [runningTaskMessage, setRunningTaskMessage] = useState('');
  const [completedTaskMessage, setCompletedTaskMessage] = useState('');
  const [isTaskError, setIsTaskError] = useState(false);
  const [shouldClear, setShouldClear] = useState(false);

  const [hasIndexedDocuments, setHasIndexedDocuments] = useState(false);
  const [disableAugmentation, setDisableAugmentation] = useState(false);

  const [stats, setStats] = useState<DocumentStats>({
    totalDocuments: 0,
    numDocumentsIndexed: 0,
    numEmbeddingIndexDocuments: 0
  });

  useEffect(() => {
    const someDocumentIsIndexed = Object.keys(documents)?.map((key) => documents[key])?.filter((docs) => docs.some((doc) => doc.is_indexed))?.length > 0;
    setHasIndexedDocuments(someDocumentIsIndexed);
  }, [documents]);

  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assistantName') || '';
    }
    return '';
  });

  const [bio, setBio] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assistantBio') || '';
    }
    return '';
  });

  // Effect hook to update localStorage when name or bio changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('assistantName', name);
    }
  }, [name]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('assistantBio', bio);
    }
  }, [bio]);

  const fetchDataSources = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/data-sources`);
      const data = await response.json();
      setDataSources(data);
      data.forEach((dataSource: any) => fetchDocuments(dataSource.id));
    } catch (error) {
      console.error('Error fetching data sources:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDataSources();
  }, [fetchDataSources]);

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
  }, [documents, dataSources, selectedDocuments]);

  const handleScan = async (sourceId: string) => {
    await fetch(`${apiBaseUrl}/v1/data-sources/${sourceId}/scan`, { method: 'POST' });
    await fetchDocuments(sourceId);
  };

  const handleIndex = async (sourceId: string) => {
    await fetch(`${apiBaseUrl}/v1/data-sources/${sourceId}/index`, { method: 'POST' });
  };

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

  // const columnNames = useMemo(() => {
  //   const firstDoc = documents[dataSources[0]?.id]?.[0];
  //   return firstDoc ? Object.keys(firstDoc.metadata) : [];
  // }, [documents, dataSources]);


  // const handleDirectoryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   const files = event.target.files;
  //   const path = files?.[0]?.webkitRelativePath.split('/')[0]; // Get directory name
  //   console.log(files)
  //   console.log('Selected directory:', path);
  //   setSelectedDirectory(path);
  // };

  const handleAddDataSource = async (dataSourceName: string, selectedDirectory: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/data-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dataSourceName,
          loader_module: "llama_index.core.SimpleDirectoryReader",
          constructor_args: [],
          constructor_kwargs: {
            input_dir: selectedDirectory,
            recursive: true
          },
          load_data_args: [],
          load_data_kwargs: {}
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      console.log("Data source added:", result);

      // Now, scan the directory to populate the list of documents
      await handleScan(result.id);

      // Optionally, refresh the list of data sources or update the UI accordingly
      await fetchDataSources();
    } catch (error) {
      console.error("Failed to add data source:", error);
    }
  };

  const handleIndexDocument = async (documentId: string, deleteInstead = false) => {
    await handleIndexSelected([documentId], deleteInstead);
  };


  const handleIndexSelected = async (documentIds = Array.from(selectedDocuments), deleteInstead = false) => {
    setRunningTaskMessage(`${ deleteInstead ? 'Unindexing' : 'Indexing' } documents...`);
    setIsTaskPending(true);
    console.log(`${deleteInstead ? 'Unindexing' : 'Indexing'} documents:`, documentIds);

    try {
      const response = await fetch(`${apiBaseUrl}/v1/documents/${ deleteInstead ? 'unindex' : 'index'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_ids: documentIds.map((id: any) => id.toString()),
          ...(deleteInstead ? {} : {is_chat: isChat})
        })
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }

      const result = await response.json();
      setCompletedTaskMessage(`${ deleteInstead ? 'Unindexing' : 'Indexing' } completed successfully.`);
      // Update the list of documents to reflect the indexing status
      await fetchDataSources();
    } catch (error) {
      setCompletedTaskMessage(`Error occurred during ${ deleteInstead ? 'unindexing' : 'indexing' }.`);
      setIsTaskError(true);
      console.error(`Error ${ deleteInstead ? 'un': '' }indexing documents:`, error);
    } finally {
      setRunningTaskMessage('');
      setIsTaskPending(false);
    }
  };


  const handleDeleteDataSource = async (dataSourceId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/data-sources/${dataSourceId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      // Refresh the list of data sources to reflect the deletion
      await Promise.all([fetchDataSources(), fetchDocuments(dataSourceId)]);
    } catch (error) {
      console.error("Failed to delete data source:", error);
    }
  };

  useEffect(() => {
    if (!completedTaskMessage) {
      return;
    }

    setTimeout(() => {
      setIsTaskPending(false);
      setIsTaskError(false);
      setCompletedTaskMessage('');
    }, 5000);
  }, [completedTaskMessage]);

  if (loading) return <div>Loading data sources...</div>;

//   const jsExample = (<CodeSnippet snippet={`import OpenAI from 'openai';
//
// const openai = new OpenAI({
//   baseURL: 'http://localhost:8181/v1',
//   apiKey: ''
// });
//
// const name = 'Alice';
// const chatCompletion = await openai.chat.completions.create({
//   // model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q5_K_M.gguf', // Optionally, customize the model used
//   messages: [
//     { role: 'system', content: \`Write $\{name\}'s next reply in a fictional chat with $\{name\} and their friends.\` },
//     { role: 'user', content: 'Favorite ice cream?' },
//   ]
// } as any);
//
// console.log(chatCompletion.choices[0].message.content);
// // "Alice enjoys Bahn Mi and Vietnamese coffee."
// `} />);

  // const Usage = () => (
  //   <>
  //     <h1 className="text-4xl font-bold mb-4">Usage</h1>
  //     <section className="mb-8">
  //       <p className="mb-4">To get started, add a directory containing chat files, then index one or more documents to
  //         add them to the knowledge bank.</p>
  //       <p>
  //         Once indexed, data will be used automatically in chat completions.
  //         {jsExample}
  //       </p>
  //       <p>
  //         Explore and test the full set of API features for indexed data on <a className="link"
  //                                                                              href="http://localhost:8181/docs">the
  //         documentation page</a>.
  //         For a quick start, try the <a className="link"
  //                                       href="http://localhost:8181/docs#/default/get_index_documents_summary_v1_index_documents_summary_get"
  //       >Summary API</a>.
  //       </p>
  //     </section>
  //   </>
  // )

  const Tooltip = ({ tip, type = 'primary', iconColor = 'info' }: { tip: string, type?: 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error', iconColor?: string }) => (
      <span className={`tooltip tooltip-${type}`} data-tip={tip}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             className={`stroke-${iconColor} shrink-0 w-6 h-6`}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </span>
  )

  const Playground = ({ disabled = false }: { disabled?: boolean }) => (
    <>
      <div className="flex gap-4">
        <div className="w-1/2">
          <div className="form-control w-100">
            <label className="label cursor-pointer flex justify-start">
              <span className="label-text">Data Augmentation Enabled</span>

              <input
                type="checkbox"
                className="toggle mx-2"
                title={!hasIndexedDocuments ? 'Add and index some documents to enable augmentation.' : ''}
                disabled={false}
                // disabled={disabled}
                // checked={hasIndexedDocuments && !disableAugmentation}
                checked={!disableAugmentation}
                onChange={() => setDisableAugmentation(!disableAugmentation)}
              />
              {!hasIndexedDocuments && <Tooltip tip="Add and index some documents to enable augmentation."/> }
            </label>
          </div>
          <button className="btn btn-sm mb-2" onClick={(e) => {
            e.preventDefault();
            setShouldClear(prev => !prev)
          }}>Clear Messages
          </button>
          <Chat assistantName={name}
                assistantBio={bio}
                disableAugmentation={disableAugmentation}
                // disableAugmentation={!hasIndexedDocuments || disableAugmentation}
                shouldClear={shouldClear}
                instruction={ hasIndexedDocuments ? '' : 'You have no indexed documents. You can still use the playground, but your data will not be used to generate responses. Add and index documents to enable augmentation.' }
          />
        </div>
        <div className="w-1/2 flex flex-col flex-grow">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Assistant Name
                <Tooltip tip="In a future version, name and bio will be configured and applied automatically."/>
              </span>
            </label>

            <input
              type="text"
              placeholder="Enter Assistant Name, e.g. Tim"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input input-sm input-bordered w-full max-w-xs mr-2"/>
          </div>
          <div className="form-control h-full">
            <label className="label">
              <span className="label-text">Assistant Bio</span>
            </label>
            <textarea className="textarea textarea-md h-full"
                      placeholder={`Enter Assistant Bio, e.g. Tim is an Engineer at Vana, deeply motivated, independent thinker, creative problem solver, open to criticism, and team-oriented with a penchant for risk-taking.`}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
            ></textarea>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <div className="container mx-auto p-4">

      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Playground</h1>
        <Playground disabled={!hasIndexedDocuments} />
      </div>

      {/*<h1 className="text-4xl font-bold mb-4">Document Directories</h1>*/}

      {/*<p className="mb-4">*/}
      {/*  Add the directories on your device that contain the documents you want to add to the knowledge bank. Example*/}
      {/*  documents are available, see the README for details.*/}
      {/*</p>*/}

      {/*<div className="overflow-x-auto mb-8">*/}
      {/*  <DataSourceTable*/}
      {/*    dataSources={dataSources}*/}
      {/*    onAddDataSource={handleAddDataSource}*/}
      {/*    onDeleteDataSource={(dataSource) => handleDeleteDataSource(dataSource.id)}*/}
      {/*  />*/}
      {/*</div>*/}

      {/*<h1 className="text-4xl font-bold mb-4">Documents</h1>*/}

      {/*<p className="mb-4">*/}
      {/*  Index documents to add them to the knowledge bank. Once indexed, data will be used automatically by the AI.*/}
      {/*</p>*/}

      {(runningTaskMessage || completedTaskMessage) &&
          <div className="toast toast-top toast-end z-10">
              <div className={`alert alert-${completedTaskMessage && isTaskError ? 'error' : 'info'}`}>
                  <span>{runningTaskMessage || completedTaskMessage}</span>
              </div>
          </div>
      }

      {/*<div className="overflow-x-auto">*/}
      {/*  <DocumentTable*/}
      {/*    dataSources={dataSources}*/}
      {/*    documents={documents}*/}
      {/*    columnNames={columnNames}*/}
      {/*    selectedDocuments={selectedDocuments}*/}
      {/*    disabled={isTaskPending}*/}
      {/*    setSelectedDocuments={setSelectedDocuments}*/}
      {/*    onToggleDocumentSelection={toggleDocumentSelection}*/}
      {/*    onIndexDocument={(doc) => handleIndexSelected([doc.id])}*/}
      {/*    onUnindexDocument={(doc) => handleIndexDocument(doc.id, true)}*/}
      {/*    onIndexDocuments={() => handleIndexSelected()}*/}
      {/*    onUnindexDocuments={() => handleIndexSelected(undefined, true)}*/}
      {/*    stats={stats}*/}
      {/*  />*/}
      {/*</div>*/}
    </div>

  );
};

SelfieManager.displayName = 'SelfieManager';

export default SelfieManager;
