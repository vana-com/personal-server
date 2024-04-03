import React, { useEffect, useState } from 'react';
import PlaygroundChat from "./PlaygroundChat";
import PlaygroundQuery from "./PlaygroundQuery";
import NoDocumentsBanner from "./NoDocumentsBanner";
import { apiBaseUrl } from "@/app/config";

const Playground = () => {
  const [documents, setDocuments] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/v1/documents`);
        const data = await response.json();
        setDocuments(data);
      } catch (error) {
        console.error("Error fetching documents:", error);
      }
    })();
  }, []);

  return (
    <>
      {documents && <NoDocumentsBanner documents={documents} /> }
      <PlaygroundChat hasIndexedDocuments={(documents ?? []).length > 0} />
      <div className="h-4" />
      <PlaygroundQuery />
    </>
  );
}

Playground.displayName = 'Playground';

export default Playground;
