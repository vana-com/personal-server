import React from 'react';

interface Props {
  documents: any[];
}

const NoDocumentsBanner: React.FC<Props> = ({ documents }) => {
  if (documents.length === 0) {
    return (
      <div role="alert" className="alert alert-info mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             className="stroke-current shrink-0 w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          <h3 className="font-bold">No data found</h3>
          <div className="text-xs">Add some documents with the <a href="/#addData" className="link">Add Data</a> page to get
            started.
          </div>
        </div>
      </div>
    );
  }
  return null;
};

NoDocumentsBanner.displayName = 'NoDocumentsBanner'

export default NoDocumentsBanner;
