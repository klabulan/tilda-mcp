// Selectors for editor.tilda.cc. Updated via `npx playwright codegen` capture sessions.
// SINGLE SOURCE OF TRUTH — flows/*.ts MUST reference these by key, no string literals.
//
// Each selector has captured_at + tested_against (Tilda version observed at capture time).
// Drift detection: test/transport/playwright.smoke.test.ts runs nightly, asserts each selector
// resolves to expected element count.

export const selectors = {
  login: {
    emailInput: 'input[name="email"]',           // TBD captured_at
    passwordInput: 'input[name="password"]',     // TBD captured_at
    submitButton: 'button[type="submit"]',        // TBD captured_at
  },
  loggedIn: {
    // Selector that confirms a logged-in editor session is active.
    // Used by stale-session detection. TBD — captured in t01b smoke.
    userMenu: '<TBD>',
  },
  projectList: {
    // The list of projects after login at https://tilda.cc/projects/
    projectCard: '<TBD>',                         // a clickable card per project
    addPageButton: '<TBD>',                       // "Add page" inside a project view
  },
  newPage: {
    // The "Create new page" dialog after addPageButton click
    titleInput: '<TBD>',
    aliasInput: '<TBD>',
    submitButton: '<TBD>',
    blankTemplateOption: '<TBD>',                 // pick "Blank" / "Пустая" template
  },
  editor: {
    // editor.tilda.cc page view
    addBlockButton: '<TBD>',                      // "+" / "Add Block" button in editor
    blockTypePanel: '<TBD>',                      // popup with T-block library
    blockTypeOption: (code: string) => `<TBD-${code}>`, // pick T396, T123, etc.
    importZeroBlockTrigger: '<TBD>',              // "Import Zero Block" UI affordance
    publishButton: '<TBD>',                       // "Опубликовать" button
    publishedUrlReadout: '<TBD>',                 // element showing published URL post-click
    captchaIframe: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
  },
  zeroBlock: {
    // Inside an opened Zero Block editor
    addElementButton: '<TBD>',
    elementTypeOption: (type: string) => `<TBD-${type}>`, // "Text", "Image", "Shape", "Button"
    saveButton: '<TBD>',
    closeButton: '<TBD>',
  },
} as const;
