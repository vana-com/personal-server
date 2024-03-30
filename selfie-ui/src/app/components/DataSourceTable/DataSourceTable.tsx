import React from 'react';
import { DataSource } from "@/app/types";
import { DataSourceActionBar } from "@/app/components/DataSourceTable/DataSourceActionBar";

interface DataSourceTableProps {
  dataSources: DataSource[];
  onAddDataSource: (name: string, directory: string) => void | Promise<void>;
  onDeleteDataSource: (dataSource: DataSource) => void | Promise<void>;
}

const DataSourceTable = ({
                           dataSources,
                           onAddDataSource,
                           onDeleteDataSource
                         }: DataSourceTableProps) => {

  return (
    <div>
      <DataSourceActionBar onAddDataSource={onAddDataSource} />

      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
          <tr>
            <th>Name</th>
            <th>Input Directory</th>
            <th>Actions</th>
          </tr>
          </thead>
          <tbody>
          {dataSources.map((dataSource, index) => (
            <tr key={dataSource.id}>
              <td>{dataSource.name}</td>
              <td>{dataSource.config.constructor_kwargs.input_dir}</td>
              <td>
                <button
                  onClick={() => onDeleteDataSource(dataSource)}
                  className="btn btn-error btn-outline btn-xs"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

DataSourceTable.displayName = 'DataSourceTable';

export default DataSourceTable;
