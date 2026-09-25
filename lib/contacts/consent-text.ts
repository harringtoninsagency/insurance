// The exact wording shown next to each checkbox on the public opt-in page.
// Imported by both the page and the server action, so what a person saw is
// what gets stored as their consent record. Change the wording => bump the
// version so older records stay traceable to what they actually agreed to.

export const CONSENT_VERSION = "2026-09-25.1";

export const EMAIL_CONSENT_TEXT =
  "I agree to receive emails from Brightway Insurance | The Harrington Agency, including new-listing insurance snapshots and market updates. I can unsubscribe at any time.";

export const SMS_CONSENT_TEXT =
  "I agree to receive recurring marketing text messages from Brightway Insurance | The Harrington Agency at the mobile number I entered, which may be sent using automated technology. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out.";

export const CONTACT_EMAIL = "harringtonagency@brightway.com";
export const CONTACT_PHONE = "727-789-2200";
