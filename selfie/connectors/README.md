# Adding new Connectors

1. Create a folder for your connector (ex: connectors/whatsapp/)
2. Add the following:
   1. `connector.py` (required) – Main implementation of a connector
   1. `schema.json` (required) – A [React Json Schema Form](https://github.com/rjsf-team/react-jsonschema-form) configuration, rendered on the "Add documents" page.
   2. `uischema.json` (optional) – Any form UI configuration for the React Json Schema form
   2. `documentation.md` (optional) – Any documentation associated with your connector that will be rendered on the "Add documents" page
3. Register the connector in `connectors/factory.py` in the `connector_registry`
4. Connector should now appear in the "Connectors" dropdown