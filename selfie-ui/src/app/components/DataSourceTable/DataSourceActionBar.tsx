import React, { useState } from 'react';

interface AddDataSourceFormProps {
  onAddDataSource: (name: string, directory: string) => void | Promise<void>;
}

export const DataSourceActionBar: React.FC<AddDataSourceFormProps> = ({ onAddDataSource }) => {
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onAddDataSource(name, directory);
    // Reset the form fields after submission
    setName('');
    setDirectory('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center mb-4">
      <input
        type="text"
        placeholder="Enter a name for this document directory"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="input input-sm input-bordered w-full max-w-xs mr-2"
        required
      />
      <input
        type="text"
        placeholder="Enter the absolute path to the directory"
        value={directory}
        onChange={(e) => setDirectory(e.target.value?.trim())}
        className="input input-bordered input-sm w-full max-w-xs mr-2"
        required
      />
      <button type="submit" className="btn btn-primary btn-sm">
        Add Directory
      </button>
    </form>
  );
};
