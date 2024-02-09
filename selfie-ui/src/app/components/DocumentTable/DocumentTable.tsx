import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/20/solid";
import { DataSource, Document } from "@/app/types";
import { isDateString, isNumeric } from "@/app/utils";
import { DocumentTableActionBar } from "./DocumentTableActionBar";
import DocumentTableRow from './DocumentTableRow';

interface DocumentTableProps {
  dataSources: DataSource[];
  documents: { [sourceId: string]: Document[] };
  columnNames: string[];
  selectedDocuments: Set<string>;
  setSelectedDocuments: (selected: Set<string>) => void;
  onToggleDocumentSelection: (docId: string) => void;
  onIndexDocument: (doc: Document) => void | Promise<void>;
  onUnindexDocument: (doc: Document) => void | Promise<void>;
  onIndexDocuments: () => void | Promise<void>;
  onUnindexDocuments: () => void | Promise<void>;
  disabled?: boolean;
}

const DocumentTable = ({
                         dataSources,
                         documents,
                         columnNames,
                         selectedDocuments,
                         setSelectedDocuments,
                         onToggleDocumentSelection,
                         onIndexDocument,
                         onUnindexDocument,
                         onIndexDocuments,
                         onUnindexDocuments,
                         disabled = false,
                       }: DocumentTableProps) => {
  const [sortField, setSortField] = useState<string | undefined>();
  const [sortDirection, setSortDirection] = useState<'asc'|'desc'>('asc');
  const [selectAll, setSelectAll] = useState(false);

  const handleToggleSelectAll = () => {
    setSelectAll(!selectAll);
    if (!selectAll) {
      const allDocIds = Object.values(documents).flat().map(doc => doc.id);
      setSelectedDocuments(new Set(allDocIds));
    } else {
      setSelectedDocuments(new Set());
    }
  };

  const handleHeaderClick = (fieldName: string) => {
    if (sortField === fieldName) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(fieldName);
      setSortDirection('asc');
    }
  };

  const getSortableValue = (value: any) => {
    if (isDateString(value)) {
      return new Date(value).getTime();
    } else if (isNumeric(value)) {
      return parseFloat(value);
    }
    return value.toString();
  };

  const sortedDocuments = useMemo(() => {
    if (!sortField) return documents;

    return Object.keys(documents).reduce((sortedDocs: any, key: string) => {
      sortedDocs[key] = [...documents[key]].sort((a, b) => {
        const aValue = getSortableValue(a.metadata[sortField]);
        const bValue = getSortableValue(b.metadata[sortField]);

        if (sortDirection === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
      return sortedDocs;
    }, {});
  }, [documents, sortField, sortDirection]);

  return (
    <>
      <DocumentTableActionBar
        onIndexDocuments={onIndexDocuments}
        onUnindexDocuments={onUnindexDocuments}
        hasSelectedDocuments={selectedDocuments.size > 0}
        disabled={disabled}
      />
      <table className="table w-full">
        <thead>
        <tr className="cursor-pointer">
          <th className="p-2" style={{lineHeight: 0}}>
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleToggleSelectAll}
              className="checkbox"
            />
          </th>
          {/* TODO: make sortable */}
          <th className="p-2 cursor-default">Source</th>
          <th className="p-2 cursor-default">Is Indexed</th>
          {columnNames.map((colName) => (
            <th key={colName} onClick={() => handleHeaderClick(colName)}>
              {colName}
              {sortField === colName && (
                sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 float-right" /> :
                  <ChevronDownIcon className="h-4 w-4 float-right" />
              )}
            </th>
          ))}
          <th>Actions</th>
        </tr>
        </thead>
        <tbody>
        {dataSources.flatMap(dataSource =>
          sortedDocuments[dataSource.id]?.map((doc: Document) => (
            <DocumentTableRow
              key={doc.id}
              doc={doc}
              dataSource={dataSource}
              columnNames={columnNames}
              isSelected={selectedDocuments.has(doc.id)}
              onToggle={onToggleDocumentSelection}
              onIndexDocument={(doc) => onIndexDocument(doc)}
              onUnindexDocument={(doc) => onUnindexDocument(doc)}
              disabled={disabled}
            />
          ))
        )}
        </tbody>
      </table>
    </>
  );
};

DocumentTable.displayName = 'DocumentTable';

export default DocumentTable;
