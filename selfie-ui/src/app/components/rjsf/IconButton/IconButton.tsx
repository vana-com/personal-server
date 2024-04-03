import { AiOutlineArrowDown } from "@react-icons/all-files/ai/AiOutlineArrowDown"
import { AiOutlineArrowUp } from "@react-icons/all-files/ai/AiOutlineArrowUp"
import { IoIosCopy } from "@react-icons/all-files/io/IoIosCopy"
import { IoIosRemove } from "@react-icons/all-files/io/IoIosRemove"
import {
  FormContextType,
  IconButtonProps,
  RJSFSchema,
  StrictRJSFSchema,
  TranslatableString,
} from "@rjsf/utils"

export default function IconButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: IconButtonProps<T, S, F>) {
  const {
    icon,
    iconType,
    className,
    uiSchema,
    registry,
    disabled,
    ...otherProps
  } = props
  const buttonClass = iconType === "block" ? "w-full" : ""
  const variantClass =
    // @ts-expect-error incomplete type from rjsf
    props.variant === "danger"
      ? "btn-error"
      : disabled
      ? "btn-disabled"
      : ""

  return (
    <button
      className={`btn grid justify-items-center px-4 py-2 text-base font-normal ${buttonClass} ${variantClass} ${className}`}
      {...otherProps}
    >
      {icon}
    </button>
  )
}

export function CopyButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: IconButtonProps<T, S, F>) {
  const {
    registry: { translateString },
  } = props
  return (
    <IconButton
      title={translateString(TranslatableString.CopyButton)}
      {...props}
      icon={<IoIosCopy />}
    />
  )
}

export function MoveDownButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: IconButtonProps<T, S, F>) {
  const {
    registry: { translateString },
  } = props
  return (
    <IconButton
      title={translateString(TranslatableString.MoveDownButton)}
      {...props}
      icon={<AiOutlineArrowDown />}
    />
  )
}

export function MoveUpButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: IconButtonProps<T, S, F>) {
  const {
    registry: { translateString },
  } = props
  return (
    <IconButton
      title={translateString(TranslatableString.MoveUpButton)}
      {...props}
      icon={<AiOutlineArrowUp />}
    />
  )
}

export function RemoveButton<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: IconButtonProps<T, S, F>) {
  const {
    registry: { translateString },
  } = props
  return (
    <IconButton
      title={translateString(TranslatableString.RemoveButton)}
      {...props}
      className={`btn-error btn-outline ${props?.className}`}
      icon={<IoIosRemove />}
    />
  )
}
