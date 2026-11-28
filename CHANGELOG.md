# Changelog

## 1.0.4 (2026-11-28)

- The node reads the file limit of a file input from `maxinputlength`, its name in the Wiro AI catalog after the catalog's rename, so inputs that take several files keep "(Comma-Separated)" in their name. The old, misspelled name is no longer read. Needs the Wiro AI release that renames the field.
- `npm run lint` also runs `npm test`, a check that the old name does not come back.

## 1.0.3 (2026-11-18)

- README: the node is verified by n8n, with a link to its page at https://n8n.io/integrations/wiro-ai/ and how to install it from the nodes panel. The node itself is the same as in 1.0.2.

## 1.0.2 (2026-11-12)

- Model inputs show English text only. Options that the catalog names in another script get their English names, for example the Chinese dialects of OmniVoice. Labels, default values and model descriptions in another language are left out.
- New icon: the Wiro AI mark on its light plate, in both the light and the dark theme.

## 1.0.1 (2026-11-12)

- Published from GitHub Actions with an npm provenance statement. The node itself is the same as in 1.0.0.

## 1.0.0 (2026-11-12)

### New
- **Wiro AI** node with two resources:
  - **Model > Run** runs any of the 1,000+ models on Wiro. Pick the model from a searchable list, by its wiro.ai link or as `owner/model`; its inputs load into the node with their defaults. The node waits for the task and returns the output file links, or the reply of a text model.
  - **Task > Get** and **Task > Wait** read a task by its ID, so a long run can finish in a later step.
- **Wiro AI API** credential: the project API key, plus the API secret for a project that uses signature authentication.
- Works as a tool for the n8n AI Agent.
