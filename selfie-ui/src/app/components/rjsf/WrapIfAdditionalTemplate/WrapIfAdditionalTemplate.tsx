import {
  ADDITIONAL_PROPERTY_FLAG,
  FormContextType,
  RJSFSchema,
  StrictRJSFSchema,
  TranslatableString,
  WrapIfAdditionalTemplateProps,
} from "@rjsf/utils"
import { FocusEvent } from "react"

export default function WrapIfAdditionalTemplate<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>({
  classNames,
  style,
  children,
  disabled,
  id,
  label,
  onDropPropertyClick,
  onKeyChange,
  readonly,
  required,
  schema,
  uiSchema,
  registry,
}: WrapIfAdditionalTemplateProps<T, S, F>) {
  const { templates, translateString } = registry
  // Button templates are not overridden in the uiSchema
  const { RemoveButton } = templates.ButtonTemplates
  const keyLabel = translateString(TranslatableString.KeyLabel, [label])
  const additional = ADDITIONAL_PROPERTY_FLAG in schema

  if (!additional) {
    return (
      <div className={classNames} style={style}>
        {children}
      </div>
    )
  }

  const handleBlur = ({ target }: FocusEvent<HTMLInputElement>) =>
    onKeyChange(target.value)
  const keyId = `${id}-key`

  return (
    <div className={`flex flex-wrap ${classNames}`} style={style}>
      <div className="flex-1 form-control mr-2">
        <label
          htmlFor={keyId}
          className="label disable-pt-0"
        >
          <span className="label-text">{keyLabel}</span>
        </label>
        <input
          required={required}
          defaultValue={label}
          disabled={disabled || readonly}
          id={keyId}
          name={keyId}
          onBlur={!readonly ? handleBlur : undefined}
          type="text"
          className={`input input-bordered w-full ${(disabled || readonly) ? "input-disabled" : ""}`}
        />
      </div>
      <div className="flex-1 min-w-0">
        {children}
      </div>
      <div className="ml-2 self-end">
        <RemoveButton
          iconType="block"
          className="w-full"
          disabled={disabled || readonly}
          onClick={onDropPropertyClick(label)}
          uiSchema={uiSchema}
          registry={registry}
        />
      </div>
    </div>
  )
}
