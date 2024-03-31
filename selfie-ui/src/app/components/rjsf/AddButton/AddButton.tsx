import { BsPlus } from "@react-icons/all-files/bs/BsPlus"
import {
  FormContextType,
  IconButtonProps,
  RJSFSchema,
  StrictRJSFSchema,
  TranslatableString,
} from "@rjsf/utils"

export default function AddButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>({ uiSchema, registry, ...props }: IconButtonProps<T, S, F>) {
  const { translateString } = registry
  return (
    <button
      {...props}
      className={`btn btn-block text-base ${props.className}`}
      title={translateString(TranslatableString.AddItemButton)}
    >
      <BsPlus />
    </button>
  )
}
