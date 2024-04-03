import {
  ArrayFieldTemplateItemType,
  FormContextType,
  RJSFSchema,
  StrictRJSFSchema,
} from "@rjsf/utils"

export default function ArrayFieldItemTemplate<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>(props: ArrayFieldTemplateItemType<T, S, F>) {
  const {
    children,
    disabled,
    hasToolbar,
    hasCopy,
    hasMoveDown,
    hasMoveUp,
    hasRemove,
    index,
    onCopyIndexClick,
    onDropIndexClick,
    onReorderClick,
    readonly,
    registry,
    uiSchema,
  } = props

  const { CopyButton, MoveDownButton, MoveUpButton, RemoveButton } =
    registry.templates.ButtonTemplates


  const renderToolbar = () => {
    return <>
      {(hasMoveUp || hasMoveDown) && (
        <MoveUpButton
          className="array-item-move-up self-end"
          disabled={disabled || readonly || !hasMoveUp}
          onClick={onReorderClick(index, index - 1)}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
      {(hasMoveUp || hasMoveDown) && (
        <MoveDownButton
          className="self-end"
          disabled={disabled || readonly || !hasMoveDown}
          onClick={onReorderClick(index, index + 1)}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
      {hasCopy && (
        <CopyButton
          className="self-end"
          disabled={disabled || readonly}
          onClick={onCopyIndexClick(index)}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
      {hasRemove && (
        <RemoveButton
          className="self-end"
          disabled={disabled || readonly}
          onClick={onDropIndexClick(index)}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
    </>
  }

  return (
    <div className="mb-2 flex items-center gap-1">
      <div className="w-full">{children}</div>
        {hasToolbar && renderToolbar()}
    </div>
  )
}
