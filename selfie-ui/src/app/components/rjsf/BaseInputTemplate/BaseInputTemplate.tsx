import {
  ariaDescribedByIds,
  BaseInputTemplateProps,
  examplesId,
  FormContextType,
  getInputProps,
  RJSFSchema,
  StrictRJSFSchema,
} from "@rjsf/utils"
import { ChangeEvent, FocusEvent } from "react"

export default function BaseInputTemplate<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>({
  id,
  placeholder,
  required,
  readonly,
  disabled,
  type,
  value,
  onChange,
  onChangeOverride,
  onBlur,
  onFocus,
  autofocus,
  options,
  schema,
  rawErrors = [],
  children,
  extraProps,
}: BaseInputTemplateProps<T, S, F>) {
  const inputProps = {
    ...extraProps,
    ...getInputProps<T, S, F>(schema, type, options),
  }
  const _onChange = ({ target: { value } }: ChangeEvent<HTMLInputElement>) =>
    onChange(value === "" ? options.emptyValue : value)
  const _onBlur = ({ target: { value } }: FocusEvent<HTMLInputElement>) =>
    onBlur(id, value)
  const _onFocus = ({ target: { value } }: FocusEvent<HTMLInputElement>) =>
    onFocus(id, value)

  // TODO: It seems like input-error is never applied.
  const inputClass = `
    input input-bordered w-full
    ${rawErrors.length > 0 ? "input-error" : ""}
    ${((disabled || readonly) ? "input-disabled" : "")}`

  return (
    <>
      <input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        autoFocus={autofocus}
        required={required}
        disabled={disabled}
        readOnly={readonly}
        className={inputClass}
        list={schema.examples ? examplesId<T>(id) : undefined}
        {...inputProps}
        value={value || value === 0 ? value : ""}
        onChange={onChangeOverride || _onChange}
        onBlur={_onBlur}
        onFocus={_onFocus}
        aria-describedby={ariaDescribedByIds<T>(id, !!schema.examples)}
      />
      {children}
      {Array.isArray(schema.examples) ? (
        <datalist id={examplesId<T>(id)}>
          {(schema.examples as string[])
            .concat(
              schema.default && !schema.examples.includes(schema.default)
                ? ([schema.default] as string[])
                : [],
            )
            .map((example: any) => {
              return <option key={example} value={example} />
            })}
        </datalist>
      ) : null}
    </>
  )
}
