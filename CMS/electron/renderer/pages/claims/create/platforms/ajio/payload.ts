import { trimOrUndef, type UpdateBuilder } from '../common/payload'

/**
 * AJIO's place of business, when the operator has one on the form.
 *
 * SENT ONLY WHEN PRESENT. `/cms/updateCMS` treats a `pobId` it receives as a
 * deliberate pick and stamps `pobIdSource: "manual"`, which permanently opts the
 * row out of the re-resolve that runs at dispatch. Posting a blank is a silent
 * no-op at best; posting another platform's leftover is a wrong-POB stamp that
 * nothing will correct.
 */
export const ajioUpdate: UpdateBuilder = ({ values }) => {
  const pobId = trimOrUndef(values.pobId)
  // The return order number, same rule: only when there is one. Clearing it on
  // the form leaves the stored value, as it does for every other field here.
  const returnOrderId = trimOrUndef(values.returnOrderId)

  return {
    ...(pobId ? { pobId } : {}),
    ...(returnOrderId ? { returnOrderId } : {})
  }
}
