/**
 * The ring that marks the one platform being worked on right now.
 *
 * WHY IT IS A SHARED CONSTANT and not three class strings. The Platforms tab
 * answers one question — "where is it up to?" — about three tasks that each
 * had their own idea of how to say it: the Login update ringed the live
 * account in GREEN, which is also the colour of the accounts that are fine;
 * Refill turned the live chip GREY and dropped its own red or green while it
 * worked, so the chip being worked on was the quietest thing in the row; Auto
 * claim tinted it ACCENT. Three answers to one question, none of which stood
 * out from the crowd of coloured chips around it.
 *
 * A DARK RING, over the chip's OWN colour. Dark because nothing else in this
 * panel is — the statuses are all surface tints, so an emphasis ring is the
 * one treatment that cannot be mistaken for a status. Over its own colour
 * because "which platform is working" and "how that platform is doing" are two
 * facts, and the old grey answered the first by erasing the second.
 */
export const WORKING_NOW_RING = 'ring-2 ring-emphasis'
