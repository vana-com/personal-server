import {
  FieldTemplateProps,
  FormContextType,
  getTemplate,
  getUiOptions,
  RJSFSchema,
  StrictRJSFSchema,
} from "@rjsf/utils"

export default function FieldTemplate<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>({
  id,
  children,
  displayLabel,
  rawErrors = [],
  errors,
  help,
  description,
  rawDescription,
  classNames,
  style,
  disabled,
  label,
  hidden,
  onDropPropertyClick,
  onKeyChange,
  readonly,
  required,
  schema,
  uiSchema,
  registry,
}: FieldTemplateProps<T, S, F>) {
  const uiOptions = getUiOptions(uiSchema)
  const WrapIfAdditionalTemplate = getTemplate<
    "WrapIfAdditionalTemplate",
    T,
    S,
    F
  >("WrapIfAdditionalTemplate", registry, uiOptions)
  if (hidden) {
    return <div className="hidden">{children}</div>
  }
  return (
    <WrapIfAdditionalTemplate
      classNames={classNames}
      style={style}
      disabled={disabled}
      id={id}
      label={label}
      onDropPropertyClick={onDropPropertyClick}
      onKeyChange={onKeyChange}
      readonly={readonly}
      required={required}
      schema={schema}
      uiSchema={uiSchema}
      registry={registry}
    >
      <div className="form-control">
        {displayLabel && (
          <label
            htmlFor={id}
            className={`label disable-pt-0 ${
              rawErrors.length > 0 ? "error" : ""
            }`}
          >
            <span className="label-text">{label}{required ? "*" : null}</span>
          </label>
        )}
        {children}
        {displayLabel && rawDescription && (
          <div className="label text-sm select-text">
            <span
              className={`label-text-alt ${
                rawErrors.length > 0 ? "error" : ""
              }`}
            >
              {description}
            </span>
          </div>
        )}
        {errors}
        {help}
      </div>
    </WrapIfAdditionalTemplate>
  )
}
