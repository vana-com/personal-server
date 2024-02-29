import React, { useEffect, useMemo, useState } from 'react';
import { FaRegTrashAlt } from 'react-icons/fa';
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/20/solid";
import { Document } from "@/app/types";
import { filesize } from 'filesize';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  ColumnDef,
} from '@tanstack/react-table';
import { rankItem } from '@tanstack/match-sorter-utils'


const fuzzyFilter = (row: any, columnId: string, value: any, addMeta: any) => {
  const itemRank = rankItem(row.getValue(columnId), value)
  addMeta({ itemRank })
  return itemRank.passed
}

const columnHelper = createColumnHelper<Document>();
const customColumnDefinitions: Partial<Record<keyof Document, { header: string, cell?: (value: any) => JSX.Element | string }>> = {
  id: {
    header: 'ID',
  },
  created_at: {
    header: 'Created At',
    cell: (value: string) => new Date(value).toLocaleString(),
  },
  updated_at: {
    header: 'Updated At',
    cell: (value: string) => new Date(value).toLocaleString(),
  },
  size: {
    header: 'Size',
    cell: (value: number) => filesize(value),
  },
  connector_name: {
    header: 'Connector',
  },
};

const generateColumns = (data: Document[]) => {
  const sample = data[0] || {};
  return Object.keys(sample).map((key) => {
    const id = key as keyof Document;
    const custom = customColumnDefinitions[id];

    return columnHelper.accessor(id, {
      header: () => <span>{custom?.header || id.toString().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>,
      cell: custom?.cell ? (info) => custom?.cell?.(info.getValue()) : (info) => info.getValue(),
    });
  });
};

interface DocumentTableProps {
  data: Document[];
  onDeleteDocuments: (docIds: string[]) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
}

const DocumentTable: React.FC<DocumentTableProps> = ({ data, onDeleteDocuments, onSelectionChange = () => {} }) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [globalFilter, setGlobalFilter] = useState('');

  const allRowsSelected = data.length > 0 && data.every(({ id }) => selectedRows[id]);

  useEffect(() => {
    const newDataIds = new Set(data.map(item => item.id));
    setSelectedRows(prevSelectedRows => {
      return Object.keys(prevSelectedRows).reduce((acc: Record<string, boolean>, cur: string) => {
        if (newDataIds.has(cur)) {
          acc[cur] = prevSelectedRows[cur];
        }
        return acc;
      }, {});
    });
  }, [data]);;

  useEffect(() => {
    onSelectionChange(Object.keys(selectedRows).filter((id) => selectedRows[id]));
  }, [selectedRows, onSelectionChange]);

  const toggleAllRowsSelected = () => {
    if (allRowsSelected) {
      setSelectedRows({});
    } else {
      const newSelectedRows: Record<string, boolean> = {};
      data.forEach(({ id }) => {
        newSelectedRows[id] = true;
      });
      setSelectedRows(newSelectedRows);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const columns = useMemo(() => [
    // Checkbox column
    columnHelper.display({
      id: 'selection',
      header: () => (
        <input
          type="checkbox"
          checked={allRowsSelected}
          onChange={toggleAllRowsSelected}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedRows[row.original.id] || false}
          onChange={() => handleSelectRow(row.original.id)}
        />
      ),
    }),
    ...generateColumns(data),
    ...[onDeleteDocuments ? columnHelper.display({
      id: 'delete',
      header: () => <span>Delete</span>,
      cell: ({ row }) => (
        <button onClick={() => onDeleteDocuments([row.original.id])} className="text-red-500 hover:text-red-700">
          <FaRegTrashAlt className="w-5 h-5 inline"/>
        </button>
      ),
    }) : null].filter(Boolean),
  ].filter((column): column is ColumnDef<Document, any> => column !== null), [data, selectedRows, onDeleteDocuments, allRowsSelected, toggleAllRowsSelected]);

  const table = useReactTable({
    data: data ?? [],
    columns: columns,
    state: {
      sorting,
      globalFilter
    },
    initialState: {
      columnOrder: ['selection', 'id', 'name', 'content_type', 'connector_name', 'document_connection_id', 'size', 'created_at', 'updated_at', 'delete'],
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: fuzzyFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedDocuments = Object.keys(selectedRows).filter((id) => selectedRows[id]);

  return (
    <div>
      <div className="flex justify-between p-1">
          <button
            type="button"
            className="btn btn-sm btn-error btn-outline"
            disabled={selectedDocuments.length === 0}
            onClick={(event) => onDeleteDocuments(selectedDocuments)}
          >
            Delete {selectedDocuments.length}
          </button>

        <input
          value={globalFilter ?? ''}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="Search all columns..."
          className="input input-sm input-bordered"
        />
      </div>

      <table className="table table-zebra my-4 w-full">
        <thead>
        <tr>
          {table.getFlatHeaders().map((header) => (
            <th
              key={header.id}
              onClick={header.column.getToggleSortingHandler()} // Attach sorting toggle click handler
              className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {/* Show sorting direction icons */}
              {header.column.getIsSorted() ? (
                header.column.getIsSorted() === 'desc' ? <ChevronDownIcon className="w-4 h-4 inline"/> :
                  <ChevronUpIcon className="w-4 h-4 inline"/>
              ) : null}
            </th>
          ))}
        </tr>
        </thead>
        <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
};

DocumentTable.displayName = 'DocumentTable';

export default DocumentTable;
