import { useEffect, useState } from 'react';
import Select, { SingleValue, ActionMeta } from 'react-select';

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

  const handleChange = (selectedOption: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
    if (selectedOption) {
      onSelect(selectedOption.value);
    }
  };

  return (
    <Select
      options={sources}
      onChange={handleChange}
      placeholder="Select a document source..."
      className="mb-4"
    />
  );
};

export default DocumentSourceSelector;
