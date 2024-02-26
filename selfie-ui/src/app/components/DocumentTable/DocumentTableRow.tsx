import React, {useEffect, useState} from "react";
import { formatDate, isDateString } from "@/app/utils";
import { DataSource, Document } from "@/app/types";

interface DocumentTableRowProps {
  doc: Document;
  dataSource: DataSource;
  columnNames: string[];
  onToggle: (docId: string) => void;
  // onIndexDocument: (doc: Document) => void | Promise<void>;
  // onUnindexDocument: (doc: Document) => void | Promise<void>;
  isSelected?: boolean;
  disabled?: boolean;
}

const DocumentTableRow = React.memo<DocumentTableRowProps>(({
  doc,
  dataSource,
  columnNames,
  onToggle,
  // onIndexDocument,
  // onUnindexDocument,
  isSelected = false,
  disabled = false,
}) => {
  const [selected, setSelected] = useState(isSelected);

  useEffect(() => {
    setSelected(isSelected);
  }, [isSelected]);

  const handleCheckboxChange = () => {
    setSelected(!selected);
    onToggle(doc.id);
  };

  return (
    <tr className={`text-xs ${selected ? 'bg-base-200' : ''}`}>
      <td className="p-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={handleCheckboxChange}
          className="checkbox"
        />
      </td>
      <td className="p-2">
        <div className="truncate max-w-xs" title={dataSource.name}>
          {dataSource.name}
        </div>
      </td>
      <td className="p-2">
        <div className="truncate max-w-xs flex justify-center" title={doc.is_indexed ? 'Indexed' : 'Unindexed'}>
          {doc.is_indexed ? '✅' : ''}
        </div>
      </td>
      {columnNames.map((colName) => (
        <td key={`${doc.id}-${colName}`} className={`p-2 ${colName}`}>
          <div className="truncate max-w-xs" title={String(doc[colName])}>
            {isDateString(doc[colName]) ? formatDate(doc[colName]) : String(doc[colName])}
          </div>
        </td>
      ))}
      <td>
        {!doc.is_indexed && <button
            // onClick={() => onIndexDocument(doc)}
            className="btn btn-xs"
            disabled={disabled}
        >
            Index
        </button>}
        {doc.is_indexed && <button
            // onClick={() => onUnindexDocument(doc)}
            className="btn btn-xs btn-error btn-outline"
            disabled={disabled}
        >
            Unindex
        </button>}
      </td>
    </tr>
  );
});

DocumentTableRow.displayName = 'DocumentTableRow';

export default DocumentTableRow;
