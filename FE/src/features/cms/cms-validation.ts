import * as yup from "yup";

/** Port of TrackVid-FE `validations/cms.validation.ts`. */
export const cmsValidation = yup.object().shape({
  subject: yup.string().required("Subject is required").trim().min(3, "Subject is too short!"),
  body: yup.string().required("Body is required").trim().min(20, "Email Body is too short!"),
});

export const cmsTicketValidation = yup.object().shape({
  ticket: yup.string().required("Ticket is required").trim(),
});

export const cmsReasonValidation = yup.object().shape({
  reason: yup.string().required("Reason is required").trim(),
});

/** First validation message for `field`, or "" when valid. */
export function firstError(schema: yup.AnyObjectSchema, values: Record<string, unknown>): Record<string, string> {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (err) {
    if (!(err instanceof yup.ValidationError)) return {};
    const out: Record<string, string> = {};
    for (const e of err.inner.length ? err.inner : [err]) if (e.path && !out[e.path]) out[e.path] = e.message;
    return out;
  }
}
