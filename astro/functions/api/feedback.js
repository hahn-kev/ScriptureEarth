// POST /api/feedback — the floating "Feedback" button (src/components/FeedbackButton.astro).
// Saves to the D1 database bound as FEEDBACK_DB; see functions-lib/feedback.js and feedback.sql.
import { makeFeedbackHandler } from '../../functions-lib/feedback.js';

export const onRequestPost = makeFeedbackHandler();
