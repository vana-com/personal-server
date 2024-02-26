import { useEffect, useState } from 'react';

type DocumentSourceSelectorProps = {
  onSelect: (selectedId: string) => void;
};

type OptionType = {
  value: string;
  label: string;
};

const DocumentSourceSelector = ({ onSelect }: DocumentSourceSelectorProps) => {
  const [sources, setSources] = useState<OptionType[]>([]);

  useEffect(() => {
    fetch('http://localhost:8181/v1/connectors')
      .then((response) => response.json())
      .then((data) => {
        const options: OptionType[] = data.connectors.map(
          (connector: { id: string; name: string; }) => ({
          value: connector.id,
          label: connector.name
        }));
        setSources(options);
      })
      .catch((error) => console.error('Error fetching document sources:', error));
  }, []);

  // const handleChange = (selectedOption: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
  const handleChange = (e) => {
    const selectedOption = e.target;
    // console.log(e)
    if (selectedOption) {
      onSelect(selectedOption.value);
    }
  };

  return (
    <select className="select select-bordered w-full max-w-sm" onChange={handleChange}>
      <option disabled selected>Select a document source...</option>
      {sources.map((source) => (
        <option key={source.value} value={source.value}>
          {source.label}
        </option>
      ))}
    </select>
  );
};

export default DocumentSourceSelector;
